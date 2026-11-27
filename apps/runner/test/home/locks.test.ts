/**
 * The two locks in the runner's folder (specs/016-build-from-source,
 * contracts/runner.md RB1; data-model.md, "The locks"). Each is made
 * complete by a link, only its holder removes it, a lock whose pid is gone is
 * taken over, and a lock that cannot be read counts as held (T003, the deploy
 * lock as it was before step 1). The state lock waits, then answers `busy`;
 * the deploy lock is never taken while the state lock is held (T060).
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

import { acquireLock, withStateLock } from "../../src/home/locks"
import { tempDir, waitFor } from "../support/helpers"

const lockOf = (home: string) => join(home, "lock")
const stateLockOf = (home: string) => join(home, "state.lock")

const LOCKS = join(import.meta.dir, "../../src/home/locks.ts")

/**
 * Another process that takes the lock `name` in `home`, says so, and holds it
 * until its input closes; then it releases it and exits.
 */
async function otherHolder(home: string, name: "lock" | "state.lock") {
  const script = `
    const { acquireLock } = await import(${JSON.stringify(LOCKS)})
    const release = acquireLock(${JSON.stringify(home)}, ${JSON.stringify(name)})
    console.log(release ? "held" : "not held")
    for await (const _ of Bun.stdin.stream()) {}
    release?.()
  `
  const child = Bun.spawn([process.execPath, "-e", script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = child.stdout.getReader()
  const { value } = await reader.read()
  const said = new TextDecoder().decode(value).trim()
  if (said !== "held") throw new Error(`the other process said: ${said}`)
  return {
    pid: child.pid,
    /** Closes its input: it releases the lock and exits. */
    async release() {
      child.stdin.end()
      await child.exited
    },
  }
}

const BUSY = { outcome: "refused", reason: "busy" } as const

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

describe("the state lock (RB1)", () => {
  test("is its own file, state.lock, made as the deploy lock is", () => {
    const home = join(tempDir("locks"), "home")
    const release = acquireLock(home, "state.lock")
    expect(release).toBeFunction()
    expect(statSync(home).mode & 0o777).toBe(0o700)
    expect(readFileSync(stateLockOf(home), "utf8")).toMatch(
      new RegExp(`^${process.pid}:[0-9a-f]{24}$`)
    )
    expect(statSync(stateLockOf(home)).mode & 0o777).toBe(0o600)
    expect(readdirSync(home)).toEqual(["state.lock"])
    release!()
    expect(readdirSync(home)).toEqual([])
  })

  test("the deploy lock and the state lock are independent files: each is taken and released without the other", async () => {
    const home = tempDir("locks")
    const deploy = acquireLock(home)!
    const state = acquireLock(home, "state.lock")!
    expect(readdirSync(home).sort()).toEqual(["lock", "state.lock"])
    expect(readFileSync(lockOf(home), "utf8")).not.toBe(
      readFileSync(stateLockOf(home), "utf8")
    )
    state()
    expect(readdirSync(home)).toEqual(["lock"])
    deploy()
    expect(readdirSync(home)).toEqual([])

    // Another process holds the state lock: the deploy lock is still free here.
    const other = await otherHolder(home, "state.lock")
    try {
      const taken = acquireLock(home)
      expect(taken).toBeFunction()
      taken!()
      expect(readFileSync(stateLockOf(home), "utf8")).toStartWith(
        `${other.pid}:`
      )
    } finally {
      await other.release()
    }
    // And the other way round: another process holds the deploy lock, the state lock is free.
    const holder = await otherHolder(home, "lock")
    try {
      expect(await withStateLock(home, () => "done", { waitMs: 300 })).toBe(
        "done"
      )
    } finally {
      await holder.release()
    }
    expect(readdirSync(home)).toEqual([])
  })

  test("withStateLock holds the state lock for its work only, and gives the work's answer", async () => {
    const home = tempDir("locks")
    const answer = await withStateLock(home, async () => {
      expect(readFileSync(stateLockOf(home), "utf8")).toStartWith(
        `${process.pid}:`
      )
      await Bun.sleep(1)
      return { outcome: "ok" }
    })
    expect(answer).toEqual({ outcome: "ok" })
    expect(existsSync(stateLockOf(home))).toBe(false)
  })

  test("withStateLock releases the state lock when its work throws, and the error goes on", async () => {
    const home = tempDir("locks")
    const failing = withStateLock(home, () => {
      throw new Error("the work failed")
    })
    await expect(failing).rejects.toThrow("the work failed")
    expect(existsSync(stateLockOf(home))).toBe(false)
  })

  test("held by another live process: withStateLock waits, and its work runs once the lock is released", async () => {
    const home = tempDir("locks")
    const other = await otherHolder(home, "state.lock")
    let ran: number | undefined
    const waiting = withStateLock(
      home,
      () => {
        ran = Date.now()
        return "done"
      },
      { waitMs: 10_000 }
    )
    await Bun.sleep(300)
    expect(ran).toBeUndefined()
    const releasedAt = Date.now()
    await other.release()
    expect(await waiting).toBe("done")
    expect(ran!).toBeGreaterThanOrEqual(releasedAt)
    // Tried every 100 ms: the work runs soon after the release.
    expect(ran! - releasedAt).toBeLessThan(1000)
    expect(existsSync(stateLockOf(home))).toBe(false)
  })

  test("held by another live process past the wait: withStateLock answers busy, its work never runs, and the lock is left as it was", async () => {
    const home = tempDir("locks")
    const other = await otherHolder(home, "state.lock")
    try {
      const held = readFileSync(stateLockOf(home), "utf8")
      let ran = false
      const started = Date.now()
      const answer = await withStateLock(
        home,
        () => {
          ran = true
          return "done"
        },
        { waitMs: 300 }
      )
      const waited = Date.now() - started
      expect(answer).toEqual(BUSY)
      expect(ran).toBe(false)
      expect(waited).toBeGreaterThanOrEqual(300)
      expect(waited).toBeLessThan(2000)
      expect(readFileSync(stateLockOf(home), "utf8")).toBe(held)
    } finally {
      await other.release()
    }
  })

  test("a wait of 0 tries once: free, the work runs; held, busy at once", async () => {
    const home = tempDir("locks")
    expect(await withStateLock(home, () => 1, { waitMs: 0 })).toBe(1)
    const other = await otherHolder(home, "state.lock")
    try {
      const started = Date.now()
      expect(await withStateLock(home, () => 1, { waitMs: 0 })).toEqual(BUSY)
      expect(Date.now() - started).toBeLessThan(100)
    } finally {
      await other.release()
    }
  })

  test("a stale state lock, its pid gone, is taken over at once", async () => {
    const home = tempDir("locks")
    writeFileSync(stateLockOf(home), `${GONE}:old`)
    const started = Date.now()
    const answer = await withStateLock(
      home,
      () => readFileSync(stateLockOf(home), "utf8"),
      { waitMs: 300 }
    )
    expect(answer).toStartWith(`${process.pid}:`)
    expect(Date.now() - started).toBeLessThan(100)
    expect(readdirSync(home)).toEqual([])
  })

  test("a stale state lock is taken over by acquireLock too, and nothing of it is left", () => {
    const home = tempDir("locks")
    writeFileSync(stateLockOf(home), `${GONE}:old`)
    const release = acquireLock(home, "state.lock")
    expect(release).toBeFunction()
    expect(readdirSync(home)).toEqual(["state.lock"])
    release!()
    expect(readdirSync(home)).toEqual([])
  })

  test("taking the deploy lock while this process holds the state lock throws: D is always taken before S", async () => {
    const home = tempDir("locks")
    await withStateLock(home, () => {
      expect(() => acquireLock(home)).toThrow()
      expect(() => acquireLock(home, "lock")).toThrow()
      // Nothing was made by the refused try.
      expect(readdirSync(home)).toEqual(["state.lock"])
    })
    const state = acquireLock(home, "state.lock")!
    try {
      expect(() => acquireLock(home)).toThrow()
    } finally {
      state()
    }
    // Once the state lock is released, the deploy lock is taken again.
    const deploy = acquireLock(home)
    expect(deploy).toBeFunction()
    // The right order: D, then S, then both released.
    const state2 = acquireLock(home, "state.lock")
    expect(state2).toBeFunction()
    state2!()
    deploy!()
    expect(readdirSync(home)).toEqual([])
  })

  test("the state lock held in another folder does not stop the deploy lock of this one", () => {
    const one = tempDir("locks")
    const two = tempDir("locks")
    const state = acquireLock(one, "state.lock")!
    try {
      const deploy = acquireLock(two)
      expect(deploy).toBeFunction()
      deploy!()
    } finally {
      state()
    }
  })

  test("taking the state lock while this process already holds it throws, rather than waiting on itself", async () => {
    const home = tempDir("locks")
    await withStateLock(home, async () => {
      expect(() => acquireLock(home, "state.lock")).toThrow()
      await expect(
        withStateLock(home, () => 1, { waitMs: 300 })
      ).rejects.toThrow()
    })
    expect(existsSync(stateLockOf(home))).toBe(false)
  })

  test("a process that does not hold the lock cannot release it: an earlier holder's release leaves another process's lock", async () => {
    const home = tempDir("locks")
    const mine = acquireLock(home, "state.lock")!
    mine()
    const other = await otherHolder(home, "state.lock")
    try {
      const held = readFileSync(stateLockOf(home), "utf8")
      expect(held).toStartWith(`${other.pid}:`)
      mine()
      expect(readFileSync(stateLockOf(home), "utf8")).toBe(held)
      // Nor does this process take it: the holder is alive.
      expect(acquireLock(home, "state.lock")).toBeUndefined()
      expect(readFileSync(stateLockOf(home), "utf8")).toBe(held)
    } finally {
      await other.release()
    }
    expect(existsSync(stateLockOf(home))).toBe(false)
  })

  test("an earlier holder's release leaves this process's own later hold, which can still take the deploy lock after it", async () => {
    const home = tempDir("locks")
    const first = acquireLock(home, "state.lock")!
    first()
    const second = acquireLock(home, "state.lock")!
    first()
    expect(existsSync(stateLockOf(home))).toBe(true)
    // Still held by this process: D is refused.
    expect(() => acquireLock(home)).toThrow()
    second()
    expect(existsSync(stateLockOf(home))).toBe(false)
    const deploy = acquireLock(home)!
    deploy()
  })

  test("another process that waits for a state lock this process holds is answered busy after its wait", async () => {
    const home = tempDir("locks")
    const release = acquireLock(home, "state.lock")!
    const script = `
      const { withStateLock } = await import(${JSON.stringify(LOCKS)})
      const answer = await withStateLock(${JSON.stringify(home)}, () => "done", { waitMs: 300 })
      console.log(JSON.stringify(answer))
    `
    const child = Bun.spawn([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await waitFor(() => child.exitCode !== null, "the other process", 5000)
    release()
    expect(
      JSON.parse((await new Response(child.stdout).text()).trim())
    ).toEqual(BUSY)
  })
})
