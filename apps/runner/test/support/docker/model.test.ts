/**
 * The lock of the stand-in's model. Each call of the stand-in is a process of
 * its own, and a test that is over may leave one behind: its wait for the
 * lock must end by itself. On 2026-11-28 one such call was found using a
 * whole processor four and a half hours after its test.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../helpers"
import { changeModel, readModel } from "./model"

/** A pid no process has: one past the largest a system gives. */
const NOBODY = 4_194_305

const lockOf = (dir: string) => join(dir, "model.lock")

/** No lock, and no file of a waiting call, is left in the folder. */
const leftBehind = (dir: string) =>
  readdirSync(dir).filter((name) => name.startsWith("model.lock"))

describe("the lock of the stand-in's model", () => {
  test("a change is written and the lock is freed", () => {
    const dir = tempDir("model-lock")
    changeModel(dir, (model) => model.networks.push({ name: "n", labels: {} }))
    expect(readModel(dir).networks).toEqual([{ name: "n", labels: {} }])
    expect(leftBehind(dir)).toEqual([])
  })

  test("a lock whose holder is gone is taken over", () => {
    const dir = tempDir("model-lock")
    writeFileSync(lockOf(dir), String(NOBODY))
    expect(changeModel(dir, () => "done", 50)).toBe("done")
    expect(leftBehind(dir)).toEqual([])
  })

  test("a lock whose holder lives is waited for, and the wait ends", () => {
    const dir = tempDir("model-lock")
    writeFileSync(lockOf(dir), String(process.pid))
    const started = Date.now()
    expect(() => changeModel(dir, () => "done", 50)).toThrow(
      `still held by process ${process.pid} after 50 ms`
    )
    expect(Date.now() - started).toBeLessThan(2000)
    // The holder's lock stays; the waiting call's own file is gone.
    expect(leftBehind(dir)).toEqual(["model.lock"])
  })

  test("a lock that cannot be read ends the call at once", () => {
    const dir = tempDir("model-lock")
    mkdirSync(lockOf(dir))
    expect(() => changeModel(dir, () => "done", 60_000)).toThrow()
    expect(existsSync(lockOf(dir))).toBe(true)
  })

  test("a folder that is gone ends the call at once", () => {
    const dir = join(tempDir("model-lock"), "gone")
    expect(() => changeModel(dir, () => "done", 60_000)).toThrow()
  })
})
