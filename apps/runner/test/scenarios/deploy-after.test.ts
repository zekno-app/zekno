/**
 * Steps U and R of a version-2 deploy (specs/016-build-from-source, T088,
 * T090, T072; contracts/runner.md RB3 U and R and the bullets under its
 * table, RB14; data-model.md, "Kept images, after each deploy"), against
 * the real runner program and the stand-in for Docker:
 *
 * - U: when every build is kept, the deploy becomes the app's running entry
 *   with `last` `reused`, written with U's first state write, before `up`;
 *   once routes and health are done, `building` is cleared while it is this
 *   deploy's, so no later request takes it for a runner that died.
 * - R: kept images, the drop list, the cache prune and the cleaning of
 *   `packs/`, after U and before the answer, for an app that has builds in
 *   the state or a deploy that built; an app with none makes today's calls.
 *
 * B1 to B3 wait for the build command (T086, T087 after check L2), so a
 * deploy with a build not kept goes from K17 to U with no image: `up`
 * fails (E08), and U still clears its `building`.
 */
import { describe, expect, test } from "bun:test"
import { builtImageName } from "@workspace/core"
import { writeFileSync } from "node:fs"

import {
  answerOf,
  APP,
  ready,
  recordKept,
  send,
  stage,
  stateFile,
  stateOf,
  withBuild,
  type Ready,
} from "../support/build-checks"
import { buildDeployV2 } from "../support/deploy-v2"
import { session } from "../support/helpers"
import { ask } from "../support/routes"

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const OLD = "0".repeat(64)
const PRUNE = "buildx prune --builder default --force --max-used-space 10gb"

type Entry = Record<string, unknown>
const webOf = (state: Record<string, unknown>) =>
  (state.builds as Record<string, Entry>)[APP]

/** The call that ran `up` for `web`, as the watched stand-in saw it, with the state it found. */
const upCall = (w: Ready) =>
  w.watch
    .seen()
    .find((call) => call.args.startsWith(`compose -p zekno-${APP} `))

/** A deploy of `web` made against 1 with no build, signed against the newer team list. */
async function withoutBuild(w: Ready) {
  const { envelope, records } = await buildDeployV2({
    trust: w.newer.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 1,
  })
  return { rosters: w.newer.rosters, envelope, records }
}

describe("U: what the deploy leaves in the state", () => {
  test("every build kept: the deploy is the running entry with `last` reused, written before `up`; `building` never set", async () => {
    const w = await ready()
    const kept = await withBuild(w)
    const image = w.docker.image(builtImageName(APP, kept.key))
    recordKept(w, kept.key, image)
    const { result } = await send(w, kept.input)
    expect(result).toEqual({ outcome: "started", app: APP, sequence: 2 })

    const entry = {
      running: 2,
      images: [
        { key: kept.key, manifest: image.manifest, config: image.config },
      ],
      deploys: [{ sequence: 2, keys: [kept.key] }],
      drop: [],
      fresh: [],
      last: {
        sequence: 2,
        outcome: "reused",
        reason: null,
        at: expect.stringMatching(ISO),
      },
    }
    // U's first state write comes before `up`.
    expect(webOf(upCall(w)!.state)).toEqual(entry)
    const state = stateOf(w.home)
    expect(webOf(state)).toEqual(entry)
    expect(state.building).toBeNull()
  }, 30_000)

  test("a build not kept: `building` is cleared once U has run, so a later request that takes the deploy lock records no restart", async () => {
    const w = await ready()
    const first = await withBuild(w)
    stage(w, first.envelope, 1, first.pieces)
    const { result } = await send(w, first.input)
    // No build yet (T086): the image is not there, so `up` fails (E08).
    expect(result).toEqual({ outcome: "start_failed", app: APP, sequence: 2 })
    // K17 wrote `building`, and the state `up` found still had it.
    expect(upCall(w)!.state.building).toMatchObject({
      sequence: 2,
      phase: "building",
    })
    const after = stateOf(w.home)
    expect(after.building).toBeNull()
    expect(after.lastSequence).toEqual({ [APP]: 2 })

    expect(await ask(w, "proxy")).toEqual({ proxy: "none" })
    const later = stateOf(w.home)
    expect(later.building).toBeNull()
    expect(webOf(later)).toBeUndefined()
  }, 30_000)

  test("a deploy with no build, of an app that has builds: it becomes the running deploy, the built images stay kept", async () => {
    const w = await ready()
    const kept = await withBuild(w)
    const image = w.docker.image(builtImageName(APP, kept.key))
    recordKept(w, kept.key, image)
    const { result } = await send(w, await withoutBuild(w))
    expect(result).toEqual({ outcome: "started", app: APP, sequence: 2 })
    expect(webOf(stateOf(w.home))).toEqual({
      running: 2,
      images: [
        { key: kept.key, manifest: image.manifest, config: image.config },
      ],
      deploys: [{ sequence: 1, keys: [kept.key] }],
      drop: [],
      fresh: [],
      last: null,
    })
    expect(w.docker.model().images.map((each) => each.tag)).toEqual([
      builtImageName(APP, kept.key),
    ])
  }, 30_000)
})

describe("R: after U, before the answer (RB14)", () => {
  test("an app with builds in the state: an image waiting in drop removed, then the cache pruned, both before the result frame", async () => {
    const w = await ready()
    const kept = await withBuild(w)
    const image = w.docker.image(builtImageName(APP, kept.key))
    const old = w.docker.image(builtImageName(APP, OLD))
    recordKept(w, kept.key, image)
    const state = stateOf(w.home)
    webOf(state)!.drop = [
      { key: OLD, manifest: old.manifest, config: old.config },
    ]
    writeFileSync(stateFile(w.home), JSON.stringify(state), { mode: 0o600 })

    const s = session(w.home, w.watch.path, {
      ZEKNO_RUNNER_UNPACKED: w.unpacked,
    })
    s.send({ command: "deploy", input: kept.input })
    const { result } = await answerOf(s)
    // What Docker was asked by the time the result frame arrived.
    const asked = w.watch.seen().map((call) => call.args)
    await s.close()
    expect(result).toEqual({ outcome: "started", app: APP, sequence: 2 })

    const up = asked.findIndex((args) => args.startsWith("compose "))
    const removal = asked.indexOf(`image rm ${builtImageName(APP, OLD)}`)
    const prune = asked.indexOf(PRUNE)
    expect(up).toBeGreaterThanOrEqual(0)
    expect(removal).toBeGreaterThan(up)
    expect(prune).toBeGreaterThan(removal)
    expect(asked.slice(prune + 1)).toEqual([])
    expect(webOf(stateOf(w.home))!.drop).toEqual([])
    expect(w.docker.model().images.map((each) => each.tag)).toEqual([
      builtImageName(APP, kept.key),
    ])
    for (const call of w.docker.calls()) expect(call.stateLock).toBe(false)
  }, 30_000)

  test("an app with no builds, a deploy with no build: exactly today's calls, no prune", async () => {
    const w = await ready()
    const calls = w.docker.calls().length
    const { result } = await send(w, await withoutBuild(w))
    expect(result).toEqual({ outcome: "started", app: APP, sequence: 2 })
    const made = w.docker.calls().slice(calls)
    expect(made.map((call) => call.args)).toEqual([
      expect.stringMatching(/^compose -p zekno-web .* up -d /),
    ])
    expect(webOf(stateOf(w.home))).toBeUndefined()
  }, 30_000)
})
