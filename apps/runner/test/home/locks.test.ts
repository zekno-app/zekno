/**
 * The lock that keeps runs from overlapping, as it is before step 1 of
 * feature 016 changes it (specs/016-build-from-source, T003): a lock is made
 * complete by a link, only its holder removes it, a lock whose pid is gone is
 * taken over, and a lock that cannot be read counts as held.
 */
import { describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { acquireLock } from "../../src/home/locks"
import { tempDir } from "../support/helpers"

const lockOf = (home: string) => join(home, "lock")

/** A pid no process has here: the highest a pid can be on Linux, and beyond any macOS gives. */
const GONE = 4194304

describe("acquireLock", () => {
  test("makes the lock complete, by a link: the file holds this run's mark, private, and nothing is left beside it", () => {
    const home = join(tempDir("locks"), "home")
    const release = acquireLock(home)
    expect(release).toBeFunction()
    expect(statSync(home).mode & 0o777).toBe(0o700)
    const mark = readFileSync(lockOf(home), "utf8")
    expect(mark).toMatch(new RegExp(`^${process.pid}:[0-9a-f]{24}$`))
    expect(lstatSync(lockOf(home)).isFile()).toBe(true)
    expect(statSync(lockOf(home)).mode & 0o777).toBe(0o600)
    // The finished file was linked into place, then its first name removed.
    expect(statSync(lockOf(home)).nlink).toBe(1)
    expect(readdirSync(home)).toEqual(["lock"])
    release!()
    expect(existsSync(lockOf(home))).toBe(false)
  })

  test("a lock held by a live run is not taken, and is left as it was", () => {
    const home = tempDir("locks")
    const held = `${process.pid}:held`
    writeFileSync(lockOf(home), held) // this test process is alive
    expect(acquireLock(home)).toBeUndefined()
    expect(readFileSync(lockOf(home), "utf8")).toBe(held)
    expect(readdirSync(home)).toEqual(["lock"])
  })

  test("a second run in the same process waits for the first to release", () => {
    const home = tempDir("locks")
    const first = acquireLock(home)!
    expect(acquireLock(home)).toBeUndefined()
    first()
    const second = acquireLock(home)
    expect(second).toBeFunction()
    second!()
  })

  test("only the holder removes it: a release after another run took the lock leaves that run's lock", () => {
    const home = tempDir("locks")
    const release = acquireLock(home)!
    const other = `${GONE}:another`
    writeFileSync(lockOf(home), other)
    release()
    expect(readFileSync(lockOf(home), "utf8")).toBe(other)
  })

  test("a release with the lock already gone does nothing, and a second release does nothing either", () => {
    const home = tempDir("locks")
    const release = acquireLock(home)!
    rmSync(lockOf(home))
    expect(() => release()).not.toThrow()
    const again = acquireLock(home)!
    release()
    expect(existsSync(lockOf(home))).toBe(true)
    again()
    expect(() => again()).not.toThrow()
    expect(existsSync(lockOf(home))).toBe(false)
  })

  test("a lock whose pid is gone is taken over, and nothing of the old lock is left", () => {
    const home = tempDir("locks")
    writeFileSync(lockOf(home), `${GONE}:old`)
    const release = acquireLock(home)
    expect(release).toBeFunction()
    expect(readFileSync(lockOf(home), "utf8")).toStartWith(`${process.pid}:`)
    expect(readdirSync(home)).toEqual(["lock"])
    release!()
    expect(existsSync(lockOf(home))).toBe(false)
  })

  test("a lock whose pid lives under another user counts as held: pid 1 is always there", () => {
    const home = tempDir("locks")
    writeFileSync(lockOf(home), "1:init")
    expect(acquireLock(home)).toBeUndefined()
    expect(readFileSync(lockOf(home), "utf8")).toBe("1:init")
  })

  test("a lock of the format before the mark, a bare pid that is gone, is taken over too", () => {
    const home = tempDir("locks")
    writeFileSync(lockOf(home), String(GONE))
    const release = acquireLock(home)
    expect(release).toBeFunction()
    release!()
  })

  test("a lock that does not name a pid counts as held", () => {
    for (const held of ["", "nobody", "0:x", "-4:x", "1.5:x", ":x"]) {
      const home = tempDir("locks")
      writeFileSync(lockOf(home), held)
      expect(acquireLock(home)).toBeUndefined()
      expect(readFileSync(lockOf(home), "utf8")).toBe(held)
    }
  })

  test.skipIf(process.getuid?.() === 0)(
    "a lock whose content cannot be read counts as held, and is left in place",
    () => {
      const home = tempDir("locks")
      writeFileSync(lockOf(home), `${GONE}:old`)
      chmodSync(lockOf(home), 0o000)
      try {
        expect(acquireLock(home)).toBeUndefined()
        expect(existsSync(lockOf(home))).toBe(true)
      } finally {
        chmodSync(lockOf(home), 0o600)
      }
      expect(readFileSync(lockOf(home), "utf8")).toBe(`${GONE}:old`)
    }
  )

  test("a lock that is a folder, which cannot be read either, counts as held", () => {
    const home = tempDir("locks")
    mkdirSync(lockOf(home))
    expect(acquireLock(home)).toBeUndefined()
    expect(statSync(lockOf(home)).isDirectory()).toBe(true)
  })
})
