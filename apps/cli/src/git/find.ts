/**
 * Where the git repository of a folder is, read from files alone: `git` is
 * never run (specs/016-build-from-source, plan.md item 9 (a); contracts/cli.md
 * CL4 step 1). The uncommitted-changes line (B13) and the reach of
 * `source.root` (CL1, CL2) start here.
 *
 * The folder a person deploys is hostile input: a `.git` made to mislead must
 * not make zekno hang, read without a bound, or run anything. So every file
 * here is read by `readBounded`: only a regular file, opened without blocking,
 * checked again once open, never more than its bound. Anything else is
 * "unreadable", and the reader gives up, leaving the line out.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

/** How many folders above the one sent are looked at for `.git` (CL4 step 1). */
export const WALK_UP = 64

/** The most a `.git` file (`gitdir: <path>`) or a `commondir` file may hold, in bytes (CL4 step 1). */
export const POINTER_BYTES = 4 * 1024

/** A file's bytes, or why there are none: it is not there, or it is not a regular file within its bound. */
export type ReadResult = Buffer | "missing" | "unreadable"

/**
 * The bytes of a regular file of at most `max` bytes. Links are followed, as
 * git follows them; a pipe, a device or a folder is never opened, and what
 * was opened is checked again, so a file swapped for a pipe after the look
 * cannot hold the read up.
 */
export function readBounded(path: string, max: number): ReadResult {
  let before
  try {
    before = statSync(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable"
  }
  if (!before.isFile() || before.size > max) return "unreadable"
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch {
    return "unreadable"
  }
  try {
    const opened = fstatSync(fd)
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > max
    )
      return "unreadable"
    // One byte past the bound shows a file that grew while it was read.
    const buffer = Buffer.alloc(Math.min(opened.size, max) + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    return length > max ? "unreadable" : buffer.subarray(0, length)
  } catch {
    return "unreadable"
  } finally {
    closeSync(fd)
  }
}

/** Where a repository is: its git folder, the folder that holds its refs and objects, and the top of its work tree. */
export type GitPlace = {
  /** The folder `.git` is or names: HEAD and the index are here. */
  readonly gitDir: string
  /** The folder `commondir` names, else the git folder: refs, objects and `config` are here. */
  readonly commonDir: string
  /** The folder that holds the `.git` entry. */
  readonly top: string
}

/** Whether a path is a folder, following links as git does. */
function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * A path written in a pointer file (`gitdir: <path>` or `commondir`), as git
 * reads it: line ends at its end dropped, relative to `base` when not
 * absolute. Undefined when it is empty, not UTF-8, or holds a line end or NUL
 * inside, which git would not read as one path either.
 */
function pointedPath(bytes: Buffer, base: string): string | undefined {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  text = text.replace(/[\r\n]+$/, "")
  if (text === "" || /[\r\n\0]/.test(text)) return undefined
  return isAbsolute(text) ? resolve(text) : resolve(base, text)
}

/** The real path of a folder, or undefined when it is not one. */
function realFolder(path: string): string | undefined {
  if (!isFolder(path)) return undefined
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * The common folder of a git folder: the one its `commondir` file names
 * (relative to the git folder), else the git folder itself. Undefined when
 * that file is there but cannot be read as one path to a folder.
 */
function commonOf(gitDir: string): string | undefined {
  const read = readBounded(join(gitDir, "commondir"), POINTER_BYTES)
  if (read === "missing") return gitDir
  if (read === "unreadable") return undefined
  const path = pointedPath(read, gitDir)
  return path === undefined ? undefined : realFolder(path)
}

/**
 * The repository a `.git` entry stands for: a folder, or a file
 * `gitdir: <path>` of at most `POINTER_BYTES` naming one, relative to the
 * file's folder (a worktree, a submodule). Undefined when it is neither.
 */
function placeOf(entry: string, top: string): GitPlace | undefined {
  let gitDir: string | undefined
  if (isFolder(entry)) gitDir = realFolder(entry)
  else {
    const read = readBounded(entry, POINTER_BYTES)
    if (typeof read === "string") return undefined
    const prefix = Buffer.from("gitdir: ")
    if (!read.subarray(0, prefix.length).equals(prefix)) return undefined
    const path = pointedPath(read.subarray(prefix.length), top)
    gitDir = path === undefined ? undefined : realFolder(path)
  }
  if (gitDir === undefined) return undefined
  const commonDir = commonOf(gitDir)
  return commonDir === undefined ? undefined : { gitDir, commonDir, top }
}

/** Whether anything named `.git` is in a folder: a link to nothing counts, and then gives nothing. */
function hasEntry(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * From a folder, through its real path, the first `.git` in it or in one of
 * the `WALK_UP` folders above it (CL4 step 1). The first `.git` found decides:
 * one that cannot be read gives nothing, never a repository further up, so
 * the top is never a folder git itself would not use.
 */
export function findGit(folder: string): GitPlace | undefined {
  let here: string
  try {
    here = realpathSync(folder)
  } catch {
    return undefined
  }
  for (let step = 0; step <= WALK_UP; step++) {
    const entry = join(here, ".git")
    if (hasEntry(entry)) return placeOf(entry, here)
    const parent = dirname(here)
    if (parent === here) return undefined
    here = parent
  }
  return undefined
}
