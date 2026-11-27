/**
 * The two locks in the runner's folder (specs/016-build-from-source,
 * contracts/runner.md RB1; data-model.md, "The locks"; FR-044): the deploy
 * lock "D" (`lock`), held for a whole deploy, and the state lock "S"
 * (`state.lock`), held only for short spans around each read-then-write of
 * the state. D is always taken before S, never the reverse, so two requests
 * can never each hold one and wait for the other. Nothing here calls Docker
 * or reads a piece.
 */
import {
  linkSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"

import type { RunnerReport } from "@workspace/core"

import { ensureDir, paths, token } from "./home"

/** The deploy lock's file name, and the state lock's. */
export type LockName = "lock" | "state.lock"

/** How long a request waits for the state lock before it answers `busy` (RB1). */
export const STATE_WAIT_MS = 120_000
/** How often the state lock is tried while a request waits for it. */
const TRY_EVERY_MS = 100

const BUSY: RunnerReport = { outcome: "refused", reason: "busy" }

/** The locks this process holds, by the lock file's absolute path, each with this hold's mark. */
const held = new Map<string, string>()

const lockPath = (dir: string, name: LockName) =>
  resolve(name === "lock" ? paths(dir).lock : paths(dir).stateLock)

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Takes one of the two locks: the deploy lock by default, or the state lock
 * with `"state.lock"`. Returns a function that releases it, or undefined
 * when another run holds it.
 *
 * The lock file is created complete, by linking a finished file into place,
 * so it is never seen empty. Its content is this run's own mark, and only
 * the run whose mark is in the file removes it. A lock left by a run that no
 * longer exists is moved aside before it is replaced, so two runs cannot
 * both take it over. A lock whose content cannot be read counts as held.
 *
 * Throws when this process holds the state lock of `dir` and asks for its
 * deploy lock (D is always taken before S, RB1), or asks for the state lock
 * again: a process never waits on a lock it holds itself.
 */
export function acquireLock(
  dir: string,
  name: LockName = "lock"
): (() => void) | undefined {
  const path = lockPath(dir, name)
  if (held.has(lockPath(dir, "state.lock")))
    throw new Error(
      name === "lock"
        ? "The deploy lock is taken before the state lock, never while it is held."
        : "The state lock is already held by this process."
    )
  ensureDir(dir)
  const mark = `${process.pid}:${token()}`

  const tryCreate = (): boolean => {
    const temporary = `${path}.${token()}.new`
    writeFileSync(temporary, mark, { flag: "wx", mode: 0o600 })
    try {
      linkSync(temporary, path)
      held.set(path, mark)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return false
    } finally {
      unlinkSync(temporary)
    }
  }
  const release = () => {
    if (held.get(path) === mark) held.delete(path)
    try {
      if (readFileSync(path, "utf8") === mark) unlinkSync(path)
    } catch {
      // Already gone: nothing to release.
    }
  }

  if (tryCreate()) return release

  let holding: string
  try {
    holding = readFileSync(path, "utf8")
  } catch {
    return tryCreate() ? release : undefined // released in between
  }
  const holder = Number(holding.split(":")[0])
  if (!Number.isInteger(holder) || holder <= 0 || isAlive(holder))
    return undefined

  // The holder is gone. Move its lock aside; only one run can win this rename.
  const aside = `${path}.${token()}.stale`
  try {
    renameSync(path, aside)
  } catch {
    return undefined // another run got there first
  }
  if (readFileSync(aside, "utf8") !== holding) {
    // We moved a fresh lock, not the stale one. Put it back and step away.
    try {
      linkSync(aside, path)
    } catch {
      // A newer lock is already in place.
    }
    unlinkSync(aside)
    return undefined
  }
  unlinkSync(aside)
  return tryCreate() ? release : undefined
}

/**
 * Runs `work` while holding the state lock of `dir`, and gives its answer.
 * The lock is tried every 100 ms until it is held or `waitMs` has passed
 * (120 seconds by default), then the answer is `busy` and `work` never runs
 * (RB1). The lock is released when `work` ends, also when it throws. The
 * caller checks the folder first, as it does before the deploy lock.
 */
export async function withStateLock<Answer>(
  dir: string,
  work: () => Answer | Promise<Answer>,
  { waitMs = STATE_WAIT_MS }: { waitMs?: number } = {}
): Promise<Answer | RunnerReport> {
  const until = Date.now() + waitMs
  for (;;) {
    const release = acquireLock(dir, "state.lock")
    if (release)
      try {
        return await work()
      } finally {
        release()
      }
    const left = until - Date.now()
    if (left <= 0) return BUSY
    await Bun.sleep(Math.min(TRY_EVERY_MS, left))
  }
}
