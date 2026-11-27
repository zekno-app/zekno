/**
 * K14c with a stand-in figure for free space (specs/016-build-from-source,
 * T066, T072; contracts/runner.md RB3 K14c, RB6; FR-040): the `statfs`
 * function comes in through the deploy's options, as `start-limit.test.ts`
 * passes its limit, so the floor is tested at its edge without filling a
 * disk. The deploy runs in this process, as a session runs it, against the
 * stand-in for Docker; every place a build writes to reads as the figure
 * given.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import { existsSync } from "node:fs"

import { deploy } from "../../src/commands/deploy"
import type { StatFs } from "../../src/disk/free"
import {
  APP,
  buildingFolder,
  FLOOR,
  ready,
  stateOf,
  withBuild,
} from "../support/build-checks"

const NAMES = ["ZEKNO_DOCKER", "ZEKNO_RUNNER_UNPACKED"]
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]))
afterEach(() => {
  for (const name of NAMES)
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
})

/** A filesystem with `free` bytes free, in blocks of 4 KiB. */
const freeOf =
  (free: number): StatFs =>
  () => ({ bavail: free / 4096, bsize: 4096 })

/** A deploy of `web` that builds, sent in this process with `statfs`; nothing staged for it. */
async function sendWith(statfs: StatFs) {
  const w = await ready()
  process.env.ZEKNO_DOCKER = w.docker.path
  process.env.ZEKNO_RUNNER_UNPACKED = w.unpacked
  const { input } = await withBuild(w)
  const before = stateOf(w.home)
  const answer = await deploy(
    w.home,
    JSON.stringify(input),
    undefined,
    undefined,
    undefined,
    { statfs }
  )
  return { w, answer, before }
}

describe("K14c against the floor, with the deploy's statfs", () => {
  test("one block below the floor: low_disk with the figure, no number used", async () => {
    const free = FLOOR - 4096
    const { w, answer, before } = await sendWith(freeOf(free))
    expect(answer).toEqual({
      outcome: "refused",
      reason: "low_disk",
      disk: { free, floor: LIMITS.diskFloorBytes },
    })
    const after = stateOf(w.home)
    expect(after.lastSequence).toEqual(before.lastSequence)
    expect(after.building).toBeNull()
    expect(existsSync(buildingFolder(w))).toBe(false)
  }, 30_000)

  test("exactly at the floor is not below it: the deploy goes on to K14d, which finds no piece staged", async () => {
    const { w, answer } = await sendWith(freeOf(FLOOR))
    expect(answer).toMatchObject({ outcome: "refused", reason: "pack_missing" })
    expect((stateOf(w.home).lastSequence as Record<string, number>)[APP]).toBe(
      1
    )
  }, 30_000)
})
