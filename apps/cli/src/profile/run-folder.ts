/**
 * This run's own folder in the profile folder (specs/016-build-from-source,
 * data-model.md, "On the developer's machine"; contracts/cli.md CL7 step
 * 11): `tmp/<random>/`, mode 700, where a deploy that builds seals its
 * pieces. It is deleted when the run ends: when the work is done, when the
 * process exits, and on Ctrl-C (SIGINT) or SIGTERM.
 *
 * There is no single-instance lock: two terminals, or the app and a
 * terminal, can run at once, each with a folder of its own. So a run never
 * empties `tmp/`: at its start it deletes only the folders there older than
 * 24 hours, which a run that was killed left behind. Nothing in `tmp/` is
 * followed: a link there, or in the place of `tmp/` itself, is never a way
 * out of the profile folder.
 */
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  type Stats,
} from "node:fs"
import { join } from "node:path"

import { CliError } from "../cli/errors"
import { sanitize } from "../server/sanitize"

/** The folder of the profile folder that holds each run's own folder. */
export const RUN_FOLDERS = "tmp"
/** A folder in `tmp/` older than this is one a run left behind (CL7 step 11). */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** A run's own folder: `path`, and `remove`, which deletes it and may be called any number of times. */
export type RunFolder = { readonly path: string; remove(): void }

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(uid: number): boolean {
  const mine = process.getuid?.()
  return mine === undefined || uid === mine
}

function entry(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * Makes `path` a folder of this user's, mode 700, whose parent exists: a
 * link, a file or anything else in its place is removed first, never
 * followed. A folder of another user's there is not used. The sentence is
 * today's for a profile file that cannot be written.
 */
export function privateFolder(path: string): void {
  try {
    const found = entry(path)
    if (found !== undefined && !found.isDirectory()) rmSync(path)
    else if (found !== undefined && !ownedByMe(found.uid)) throw new Error()
    if (found === undefined || !found.isDirectory())
      mkdirSync(path, { mode: 0o700 })
    // Made here or found: it must be a folder now, not a link put there meanwhile, before its mode is set.
    if (entry(path)?.isDirectory() !== true) throw new Error()
    chmodSync(path, 0o700)
  } catch {
    throw new CliError(`Could not write ${sanitize(path)}.`)
  }
}

/**
 * Deletes the folders in `tmp/` last changed more than `STALE_AFTER_MS`
 * before `now`, each as one entry: a link in a folder is removed as a link.
 * A file or a link in `tmp/` is left as it is. One that cannot be deleted
 * is left for a later run.
 */
function sweep(folders: string, now: number): void {
  let names: string[]
  try {
    names = readdirSync(folders)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(folders, name)
    const found = entry(path)
    if (found?.isDirectory() !== true || now - found.mtimeMs <= STALE_AFTER_MS)
      continue
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // Left for a later run.
    }
  }
}

/** The signals that end a run from outside: Ctrl-C, and a polite kill. */
const SIGNALS = ["SIGINT", "SIGTERM"] as const

/**
 * Opens this run's own folder under `home` (CL7 step 11): `tmp/` made a
 * folder of mode 700, the folders there older than 24 hours deleted, then
 * a new folder of a random name, mode 700. It is deleted by `remove`, when
 * the process exits, or on Ctrl-C or SIGTERM: when nothing else in the
 * program listens for the signal, the signal is then raised again, so the
 * run still ends as it would have; when something does, that listener
 * decides.
 */
export function openRunFolder(home: string, now = Date.now()): RunFolder {
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
  } catch {
    throw new CliError(`Could not write ${sanitize(home)}.`)
  }
  const folders = join(home, RUN_FOLDERS)
  privateFolder(folders)
  sweep(folders, now)
  const path = join(folders, randomBytes(16).toString("hex"))
  try {
    // Not recursive: a name already there, of any kind, is refused rather than used.
    mkdirSync(path, { mode: 0o700 })
    chmodSync(path, 0o700)
  } catch {
    throw new CliError(`Could not write ${sanitize(path)}.`)
  }

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    process.off("exit", remove)
    for (const signal of SIGNALS) process.off(signal, onSignal)
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // A later run deletes it once it is 24 hours old.
    }
  }
  function onSignal(signal: NodeJS.Signals) {
    remove()
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
  }
  process.on("exit", remove)
  for (const signal of SIGNALS) process.on(signal, onSignal)
  return { path, remove }
}

/** Runs `work` with this run's own folder, deleted when it ends, however it ends. */
export async function withRunFolder<T>(
  home: string,
  work: (path: string) => Promise<T>
): Promise<T> {
  const folder = openRunFolder(home)
  try {
    return await work(folder.path)
  } finally {
    folder.remove()
  }
}
