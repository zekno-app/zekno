/**
 * Properties of a version-2 deploy on the runner that held when the
 * security review of feature 014 read the code, and that no test checked
 * (specs/014-deploy-v2/security-review.md, part 4): `records` takes no lock,
 * so it may read while a deploy replaces and deletes record files; and a
 * deploy whose record writes fail part way uses no number, and what it left
 * is never named by the state and goes at the app's next deploy.
 */
import { describe, expect, test } from "bun:test"
import type { SecretRecord } from "@workspace/core"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  deployV2,
  hashOf,
  recordFiles,
  recordsOf,
} from "../support/deploy-v2"
import { session, waitFor, world } from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

const stateText = (w: World) => readFileSync(join(w.home, "state.json"), "utf8")
const fileOf = (w: World, record: SecretRecord) =>
  join(w.home, "records", "web", `${hashOf(record)}.json`)

describe("records takes no lock", () => {
  test("it answers while a deploy holds the lock, from the state that deploy saved before `up`", async () => {
    const w = await world()
    const first = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      values: { GREETING: "one" },
    })
    expect(
      (await deployV2(w, { rosters: w.rosters, ...first })).result
    ).toMatchObject({ outcome: "started" })
    const again = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      values: { GREETING: "two" },
    })
    w.docker.holdUp()
    const s = session(w.home, w.docker.path)
    const running = s.request({
      command: "deploy",
      input: { rosters: w.rosters, ...again },
    })
    await waitFor(() => w.docker.upStarted(), "the deploy's up")
    // The deploy holds the lock; the old file is gone, the new one kept.
    expect(existsSync(join(w.home, "lock"))).toBe(true)
    expect(existsSync(fileOf(w, first.records[0]!))).toBe(false)
    expect(await recordsOf(w, "web")).toEqual({
      statements: [again.records[0]!.envelope],
    })
    w.docker.releaseUp()
    expect((await running).result).toMatchObject({ outcome: "started" })
    await s.close()
  }, 30_000)
})

describe("a deploy whose record writes fail part way", () => {
  test("is refused with no number used; the file it left is named by no state, and goes at the app's next deploy", async () => {
    const w = await world()
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      values: { A_FIRST: "a", B_SECOND: "b" },
    })
    const [a, b] = built.records as [SecretRecord, SecretRecord]
    // The second record's place is taken by a folder: its write fails after the first one's.
    mkdirSync(fileOf(w, b), { recursive: true, mode: 0o700 })
    const state = stateText(w)
    expect(
      (await deployV2(w, { rosters: w.rosters, ...built })).result
    ).toEqual({ outcome: "refused", reason: "invalid_state" })
    expect(stateText(w)).toBe(state)
    expect(w.docker.calls()).toEqual([])
    expect(existsSync(fileOf(w, a))).toBe(true)

    // The next deploy is made against the same number, and lists neither: A's file goes.
    rmSync(fileOf(w, b), { recursive: true })
    const next = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      values: { C_THIRD: "c" },
    })
    expect((await deployV2(w, { rosters: w.rosters, ...next })).result).toEqual(
      { outcome: "started", app: "web", sequence: 1 }
    )
    expect(recordFiles(w.home).map((file) => file.path)).toEqual([
      join("records", "web", `${hashOf(next.records[0]!)}.json`),
    ])
  }, 30_000)
})
