/**
 * The lock in the runner's folder that keeps runs from overlapping.
 */
import {
  linkSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

import { ensureDir, paths, token } from "./home"

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Takes the lock that keeps runs from overlapping. Returns a function that
 * releases it, or undefined when another run holds it.
 *
 * The lock file is created complete, by linking a finished file into place,
 * so it is never seen empty. Its content is this run's own mark, and only
 * the run whose mark is in the file removes it. A lock left by a run that no
 * longer exists is moved aside before it is replaced, so two runs cannot
 * both take it over. A lock whose content cannot be read counts as held.
 */
export function acquireLock(dir: string): (() => void) | undefined {
  ensureDir(dir)
  const path = paths(dir).lock
  const mark = `${process.pid}:${token()}`

  const tryCreate = (): boolean => {
    const temporary = `${path}.${token()}.new`
    writeFileSync(temporary, mark, { flag: "wx", mode: 0o600 })
    try {
      linkSync(temporary, path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return false
    } finally {
      unlinkSync(temporary)
    }
  }
  const release = () => {
    try {
      if (readFileSync(path, "utf8") === mark) unlinkSync(path)
    } catch {
      // Already gone: nothing to release.
    }
  }

  if (tryCreate()) return release

  let held: string
  try {
    held = readFileSync(path, "utf8")
  } catch {
    return tryCreate() ? release : undefined // released in between
  }
  const holder = Number(held.split(":")[0])
  if (!Number.isInteger(holder) || holder <= 0 || isAlive(holder))
    return undefined

  // The holder is gone. Move its lock aside; only one run can win this rename.
  const aside = `${path}.${token()}.stale`
  try {
    renameSync(path, aside)
  } catch {
    return undefined // another run got there first
  }
  if (readFileSync(aside, "utf8") !== held) {
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
