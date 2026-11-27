/**
 * K17 of a version-2 deploy reads the state again under the state lock
 * (specs/016-build-from-source, T065; contracts/runner.md RB1, RB3 K17;
 * FR-044). A `sync` takes the state lock only, so it can land between K14
 * and K17, while the deploy holds the deploy lock alone. The window is too
 * short to reach from another process, so here the deploy runs in this
 * process and the change is made at K16, the step between: `openSecrets` is
 * wrapped, and changes the state on disk once, before it opens the secrets.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import * as core from "@workspace/core"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildDeployV2, recordFiles } from "../support/deploy-v2"
import { deployed } from "../support/helpers"

const realOpen = core.openSecrets
/** Run once, at the next K16, then forgotten. */
let atK16: (() => void) | undefined
void mock.module("@workspace/core", () => ({
  ...core,
  openSecrets: (...args: Parameters<typeof realOpen>) => {
    const change = atK16
    atK16 = undefined
    change?.()
    return realOpen(...args)
  },
}))
const { deploy } = await import("../../src/commands/deploy")

const stateFile = (home: string) => join(home, "state.json")
const stateOf = (home: string) =>
  JSON.parse(readFileSync(stateFile(home), "utf8")) as Record<string, unknown>
/** Writes the state as another request would, between K14 and K17. */
const rewrite = (
  home: string,
  change: (state: Record<string, unknown>) => void
) => {
  const state = stateOf(home)
  change(state)
  writeFileSync(stateFile(home), JSON.stringify(state), { mode: 0o600 })
}

// The deploy runs here, so `up` goes to the stand-in through this process's environment.
const dockerBefore = process.env.ZEKNO_DOCKER
afterAll(() => {
  if (dockerBefore === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = dockerBefore
  atK16 = undefined
})

describe("K17: the state read again under the state lock", () => {
  let w: Awaited<ReturnType<typeof deployed>>
  beforeAll(async () => {
    w = await deployed(["web", "api"])
    process.env.ZEKNO_DOCKER = w.docker.path
  })

  test("a newer team list saved between K14 and K17 is kept, and the deploy signed against the older one is refused stale_team: no number used, Docker not called", async () => {
    const newer = await core.proposeRoster({ trust: w.trust, signer: w.signer })
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
    })
    const records = recordFiles(w.home)
    const calls = w.docker.calls().length
    atK16 = () => rewrite(w.home, (state) => (state.team = newer.trust))

    const answer = await deploy(
      w.home,
      JSON.stringify({ rosters: w.rosters, ...built })
    )
    expect(answer).toEqual({ outcome: "refused", reason: "stale_team" })
    expect(atK16).toBeUndefined()
    const after = stateOf(w.home)
    // Without K17's second look, the deploy would have saved the older team list over the newer one.
    expect(after.team).toEqual(newer.trust)
    expect(after.lastSequence).toEqual({ web: 1, api: 1 })
    expect(recordFiles(w.home)).toEqual(records)
    expect(w.docker.calls()).toHaveLength(calls)
    w.trust = newer.trust
    w.rosters = [...w.rosters, newer.envelope]
  })

  test("any other change made meanwhile: K4 to K16 run again against it, it passes, and the state saved keeps that change beside the deploy's own", async () => {
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
    })
    // Another app's number moved on between K14 and K17.
    atK16 = () =>
      rewrite(w.home, (state) => {
        ;(state.lastSequence as Record<string, number>).api = 2
      })

    const answer = await deploy(
      w.home,
      JSON.stringify({ rosters: w.rosters, ...built })
    )
    expect(answer).toEqual({ outcome: "started", app: "web", sequence: 2 })
    expect(stateOf(w.home).lastSequence).toEqual({ web: 2, api: 2 })
    expect(stateOf(w.home).team).toEqual(w.trust)
  })

  test("nothing changed meanwhile: the deploy is saved as K4 to K14 checked it", async () => {
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 2,
    })
    const answer = await deploy(
      w.home,
      JSON.stringify({ rosters: w.rosters, ...built })
    )
    expect(answer).toEqual({ outcome: "started", app: "web", sequence: 3 })
    expect(stateOf(w.home).lastSequence).toEqual({ web: 3, api: 2 })
  })
})
