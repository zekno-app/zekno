/**
 * `setup` and its two locks (specs/016-build-from-source, T065;
 * contracts/runner.md RB1): it takes the deploy lock, then the state lock.
 * When the state lock cannot even be made (the disk full, a name too long:
 * `acquireLock` throws), the deploy lock it already holds is released
 * before the error goes on, so a later request is not told `busy` for as
 * long as the process that failed lives. The failure is made here by
 * wrapping `acquireLock`, which passes every other call through.
 */
import { afterAll, describe, expect, mock, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
} from "@workspace/core"
import { existsSync } from "node:fs"
import { join } from "node:path"

import * as locks from "../../src/home/locks"
import { tempDir } from "../support/helpers"

const realAcquire = locks.acquireLock
/** While set, making the state lock throws as a full disk would. */
let stateLockFails = false
void mock.module("../../src/home/locks", () => ({
  ...locks,
  acquireLock: (...args: Parameters<typeof realAcquire>) => {
    if (stateLockFails && args[1] === "state.lock")
      throw Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      })
    return realAcquire(...args)
  },
}))
const { setup } = await import("../../src/commands/commands")

afterAll(() => {
  stateLockFails = false
})

describe("setup when the state lock cannot be made", () => {
  test("the deploy lock is released before the error goes on, and a later setup works", async () => {
    const signer = createSigner(generateMemberKeyPair().secretKey)
    const team = await createTeam({ founderName: "Ada", signer })
    const input = JSON.stringify({
      founding: team.envelope,
      teamCode: team.confirmationCode,
    })
    const home = tempDir("setup-locks")

    stateLockFails = true
    expect(() => setup(home, input)).toThrow("no space left on device")
    stateLockFails = false
    expect(existsSync(join(home, "lock"))).toBe(false)
    expect(existsSync(join(home, "state.lock"))).toBe(false)

    expect(setup(home, input)).toHaveProperty("serverId")
  })
})
