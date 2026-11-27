/**
 * K17 for a deploy that builds (specs/016-build-from-source, T072;
 * contracts/runner.md RB3 K17, CO13), against the real runner program and
 * the stand-in for Docker: the state K17 writes, read as the first Docker
 * call after the number finds it, holds `building` for the builds not kept
 * (their keys, the sum of their timeouts, phase `building`, a new run token)
 * and none when every build is kept or there is none; a `sync` that lands
 * between K14 and K17 and removes the signer refuses the deploy there, with
 * no number used and no piece left in `building/<app>/`. What follows the
 * number (B1 to R) is T086 to T090's, so no test here reads an outcome past
 * "the number was used".
 */
import { describe, expect, test } from "bun:test"
import {
  builtImageName,
  createSigner,
  generateMemberKeyPair,
  proposeRoster,
} from "@workspace/core"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import {
  answerOf,
  APP,
  buildingFolder,
  FACTS_AND_DISK,
  firstAfterNumber,
  ready,
  recordKept,
  send,
  serverKey,
  stage,
  stateOf,
  withBuild,
} from "../support/build-checks"
import { buildDeployV2, payloadOf } from "../support/deploy-v2"
import { runner, session, waitFor } from "../support/helpers"
import {
  dockerfileBuild,
  packOf,
  project,
  sealAll,
} from "../support/code-packs"

describe("K17: the number used, with `building` for the builds not kept", () => {
  test("the state the first Docker call after the number finds holds `building`: the app, the number, the keys, the limit, phase building and a new run token; Docker was only read before, never under the state lock", async () => {
    const w = await ready()
    const first = await withBuild(w)
    stage(w, first.envelope, 1, first.pieces)
    const started = Date.now()
    const { result } = await send(w, first.input)
    expect(result).toMatchObject({ app: APP, sequence: 2 })
    expect(result.outcome).not.toBe("refused")

    const seen = w.watch.seen()
    const at = seen.findIndex(
      (call) => (call.state.lastSequence as Record<string, number>)[APP] === 2
    )
    expect(seen.slice(0, at).map((call) => call.args)).toEqual(FACTS_AND_DISK)
    const building = seen[at]!.state.building as Record<string, unknown>
    expect(building).toEqual({
      app: APP,
      sequence: 2,
      keys: [first.key],
      since: expect.any(String),
      limit: 600,
      phase: "building",
      run: expect.stringMatching(/^[0-9a-f]{32}$/),
      stopped: null,
    })
    const since = Date.parse(building.since as string)
    expect(since).toBeGreaterThanOrEqual(started - 1000)
    expect(since).toBeLessThanOrEqual(Date.now())
    expect(seen[at]!.state.team).toEqual(w.newer.trust)
    for (const call of w.docker.calls()) expect(call.stateLock).toBe(false)

    // The next deploy that builds: another run token.
    const second = await withBuild(w, { previous: 2 })
    stage(w, second.envelope, 2, second.pieces)
    const again = await send(w, second.input)
    expect(again.result).toMatchObject({ app: APP, sequence: 3 })
    const next = firstAfterNumber(w, 3)!.state.building as Record<
      string,
      unknown
    >
    expect(next).toMatchObject({ app: APP, sequence: 3, phase: "building" })
    expect(next.run).toMatch(/^[0-9a-f]{32}$/)
    expect(next.run).not.toBe(building.run)
  })

  test("the limit is the sum of the signed timeouts of the builds not kept, and the keys theirs, sorted", async () => {
    const w = await ready()
    const pack = packOf(project())
    const pieces = sealAll(pack.tar, serverKey(w))
    const signed = { hash: pack.hash, size: pack.tar.length }
    const { envelope, records } = await buildDeployV2({
      trust: w.newer.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      builds: [
        dockerfileBuild(signed, pieces, { timeout: 7200 }),
        dockerfileBuild(signed, pieces, { network: "none", timeout: 45 }),
      ],
    })
    stage(w, envelope, 1, pieces)
    const keys = (payloadOf(envelope).builds as { key: string }[]).map(
      (build) => build.key
    )
    expect(keys).toEqual([...keys].sort())
    await send(w, { rosters: w.newer.rosters, envelope, records })
    expect(firstAfterNumber(w, 2)!.state.building).toMatchObject({
      keys,
      limit: 7245,
    })
  })

  test("every build kept (K14a): no facts, no disk, no piece asked for; `building` never set", async () => {
    const w = await ready()
    const kept = await withBuild(w)
    const image = w.docker.image(builtImageName(APP, kept.key))
    recordKept(w, kept.key, image)
    const { result } = await send(w, kept.input)
    expect(result).toMatchObject({ app: APP, sequence: 2 })
    const seen = w.watch.seen()
    const at = seen.findIndex(
      (call) => (call.state.lastSequence as Record<string, number>)[APP] === 2
    )
    expect(seen.slice(0, at).map((call) => call.args)).toEqual([
      `image inspect --format {{.Id}} ${builtImageName(APP, kept.key)}`,
    ])
    expect(seen[at]!.state.building).toBeNull()
    expect(existsSync(buildingFolder(w))).toBe(false)
  })

  test("a deploy with no build asks Docker nothing before the number, and leaves no `building`", async () => {
    const w = await ready()
    const { envelope, records } = await buildDeployV2({
      trust: w.newer.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
    })
    const calls = w.docker.calls().length
    const { result } = await send(w, {
      rosters: w.newer.rosters,
      envelope,
      records,
    })
    expect(result).toEqual({ outcome: "started", app: APP, sequence: 2 })
    const made = w.docker.calls().slice(calls)
    expect(made).toHaveLength(1)
    expect(made[0]!.args).toStartWith("compose ")
    expect(stateOf(w.home).building).toBeNull()
  })

  test("a team list a `sync` saved between K14 and K17 that removes the signer: refused at K17, no number, the moved pieces deleted", async () => {
    const w = await ready()
    const bea = createSigner(generateMemberKeyPair().secretKey)
    const withBea = await proposeRoster({
      trust: w.newer.trust,
      members: [
        ...w.newer.trust.members,
        { name: "Bea", publicKey: bea.publicKey, role: "deployer" },
      ],
      signer: w.signer,
    })
    const rosters = [...w.newer.rosters, withBea.envelope]
    const hers = await withBuild(
      { ...w, newer: { trust: withBea.trust, rosters } },
      { signer: bea }
    )
    stage(w, hers.envelope, 1, hers.pieces)

    // K14c's call is held: the deploy has passed K4 to K14 and holds the deploy lock, not the state lock.
    w.watch.hold("info")
    const s = session(w.home, w.watch.path, {
      ZEKNO_RUNNER_UNPACKED: w.unpacked,
    })
    s.send({ command: "deploy", input: hers.input })
    await waitFor(w.watch.held, "K14c's call to Docker")
    const without = await proposeRoster({
      trust: withBea.trust,
      members: w.newer.trust.members,
      signer: w.signer,
    })
    const after = [...rosters, without.envelope]
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters: after })).json
    ).toEqual({ outcome: "ok" })
    w.watch.go()

    const { result, events } = await answerOf(s)
    expect((await s.close()).code).toBe(0)
    expect(events).toEqual([])
    expect(result).toEqual({ outcome: "refused", reason: "unknown_signer" })
    const state = stateOf(w.home)
    expect(state.lastSequence).toEqual({ [APP]: 1 })
    expect(state.building).toBeNull()
    expect(state.team).toEqual(without.trust)
    expect(existsSync(buildingFolder(w))).toBe(false)
    // Moved for the check, then deleted: the same envelope sent again gets pack_missing.
    expect(readdirSync(join(w.home, "packs", APP))).toEqual(["deploy.json"])
  }, 30_000)
})
