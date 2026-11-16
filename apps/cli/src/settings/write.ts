/**
 * Writing a settings file (specs/010-app-settings, research R5, "Writing"
 * and "Creating"): a change replaces the file whole or not at all, never
 * over a file that changed since it was read, never through a link; a new
 * file never replaces one that is there.
 *
 * 1. The new text is made and read back by the reader; it must give the
 *    same settings, so a written file always reads.
 * 2. A new file is made beside it under a name nobody can predict (`wx`
 *    refuses anything already there), given the old file's permission bits,
 *    written whole and flushed to the disk.
 * 3. A change: the file at the path is looked at without following a link
 *    (a link is CS13) and must be the regular file of this user's that was
 *    read, with one name; then it is read again from a descriptor opened
 *    without following a link, and its bytes must have the SHA-256 they had
 *    (CS12). Then the new file is renamed over it. A new file: a hard link
 *    to the name, which fails when anything is there (IN4).
 * 4. The new file's temporary name is removed in every case.
 *
 * Known limit (research R5): a write by another program in the few calls
 * between step 3's check and the rename is lost. No portable lock closes it.
 */
import { createHash, randomBytes } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
  type Stats,
} from "node:fs"
import { dirname, join } from "node:path"

import { CliError } from "../cli/errors"
import { checkSettings, isSettings } from "./schema"
import { settingsText } from "./text"
import type { ServiceSettings, Settings, SettingsRead } from "./types"
import { SETTINGS_BYTES, SETTINGS_FILE } from "./values"
import { CS12, CS13, CS14, IN4 } from "./words"

/** What a test may put in place of a part of writing. */
export type WriteOptions = {
  /** Makes the text written (`settingsText`): a test gives a broken one. */
  text?: (settings: Settings) => string
  /** Called right before a new file is put in place: a test makes a file appear there. */
  beforePlace?: () => void
  /** Puts the new file in place with a hard link (`linkSync`): a test gives one that fails as a disk without hard links does. */
  link?: (existing: string, path: string) => void
  /** Called right before a new file is put in place on a disk without hard links: a test makes a file appear there. */
  beforeFallback?: () => void
}

/** The fields of a service, in one order, to compare two settings whatever order their objects were made in. */
const FIELDS: readonly (keyof ServiceSettings)[] = [
  "image",
  "start",
  "restart",
  "memory",
  "cpus",
  "port",
  "publish",
  "secrets",
  "plain",
  "volumes",
]

/** Settings as one text, a list left empty the same as one left out. */
const canonical = (settings: Settings): string =>
  JSON.stringify(
    settings.services.map(([name, service]) => [
      name,
      FIELDS.map((field) => {
        const value = service[field]
        return Array.isArray(value) && value.length === 0
          ? null
          : (value ?? null)
      }),
    ])
  )

/** Step 1: the text of `settings`, read back as the reader reads a file. */
function textOf(
  settings: Settings,
  file: string,
  options: WriteOptions
): string {
  const text = (options.text ?? settingsText)(settings)
  const back = checkSettings(text, file)
  if (!isSettings(back) || canonical(back) !== canonical(settings))
    throw new CliError(CS14(file))
  return text
}

/** A name beside `path` nobody can predict. */
const temporaryBeside = (path: string): string =>
  join(dirname(path), `.${SETTINGS_FILE}.${randomBytes(8).toString("hex")}.tmp`)

/**
 * Step 2: a new file at `temporary` (`wx` refuses a file or a link already
 * there under this name). `made` is called as soon as it exists, so it is
 * removed whatever fails after.
 */
function writeNew(
  temporary: string,
  text: string,
  mode: number,
  made: () => void
): void {
  const fd = openSync(temporary, "wx", 0o600)
  made()
  try {
    fchmodSync(fd, mode)
    const bytes = Buffer.from(text, "utf8")
    let written = 0
    while (written < bytes.length)
      written += writeSync(fd, bytes, written, bytes.length - written)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(stat: Stats): boolean {
  const uid = process.getuid?.()
  return uid === undefined || stat.uid === uid
}

/** Step 3 of a change: the file at `read.path` is still the very file and bytes that were read. */
function checkUnchanged(read: SettingsRead): void {
  const changed = new CliError(CS12(read.shown))
  let entry: Stats
  try {
    entry = lstatSync(read.path)
  } catch {
    throw changed
  }
  if (entry.isSymbolicLink()) throw new CliError(CS13(read.shown))
  if (
    !entry.isFile() ||
    entry.nlink !== 1 ||
    !ownedByMe(entry) ||
    entry.dev !== read.dev ||
    entry.ino !== read.ino
  )
    throw changed
  let fd: number
  try {
    fd = openSync(
      read.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new CliError(CS13(read.shown))
    throw changed
  }
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.dev !== read.dev || opened.ino !== read.ino)
      throw changed
    const buffer = Buffer.alloc(SETTINGS_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const got = readSync(fd, buffer, length, buffer.length - length, null)
      if (got === 0) break
      length += got
    }
    const sha256 = createHash("sha256")
      .update(buffer.subarray(0, length))
      .digest("hex")
    if (sha256 !== read.sha256) throw changed
  } finally {
    closeSync(fd)
  }
}

/**
 * Replaces the settings file that was read with `settingsText(settings)`,
 * keeping its permission bits, as the steps above say. Every failure is a
 * `CliError`: CS12 (changed since it was read), CS13 (a symbolic link), CS14
 * (could not be written); the file is then as it was.
 */
export function writeSettings(
  read: SettingsRead,
  settings: Settings,
  options: WriteOptions = {}
): void {
  const text = textOf(settings, read.shown, options)
  const temporary = temporaryBeside(read.path)
  let made = false
  try {
    writeNew(temporary, text, read.mode & 0o777, () => (made = true))
    checkUnchanged(read)
    options.beforePlace?.()
    renameSync(temporary, read.path)
    made = false
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(CS14(read.shown))
  } finally {
    // Only a file this made is removed: `wx` failing means the name was someone else's.
    if (made) rmSync(temporary, { force: true })
  }
}

/** File systems where a hard link cannot be made; creating there makes the file in place, exclusively (`createInPlace`). */
const NO_HARD_LINKS = new Set([
  "EPERM",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EMLINK",
  "ENOSYS",
])

/**
 * Makes the file at `path` in place, on a disk without hard links: opened
 * with `O_CREAT | O_EXCL`, which fails when anything has that name, a link
 * to nowhere included, at the moment of the call, so no file is ever
 * replaced, not even one made in between (IN4; the security review's second
 * "needs validation"). Then written whole and flushed. A failure after it
 * was made removes it, and only while it is still the file this made.
 */
function createInPlace(path: string, text: string): void {
  let fd: number
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o644
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CliError(IN4)
    throw error
  }
  const made = fstatSync(fd)
  try {
    fchmodSync(fd, 0o644)
    const bytes = Buffer.from(text, "utf8")
    let written = 0
    while (written < bytes.length)
      written += writeSync(fd, bytes, written, bytes.length - written)
    fsyncSync(fd)
  } catch (error) {
    try {
      const now = lstatSync(path)
      if (now.dev === made.dev && now.ino === made.ino) rmSync(path)
    } catch {
      // Gone already, or not this file any more: nothing of someone else's is removed.
    }
    throw error
  } finally {
    closeSync(fd)
  }
}

/**
 * Creates `zekno.app.json` in `folder` holding `settings` (`zekno settings
 * init`), mode 644, put in place with a hard link, which fails if anything
 * is already there, so an existing file is never replaced, not even one that
 * appears in between (IN4). On a disk without hard links it is made in place
 * with an exclusive create instead, which refuses the same. Returns the
 * file's path.
 */
export function createSettings(
  folder: string,
  settings: Settings,
  options: WriteOptions = {}
): string {
  const path = join(folder, SETTINGS_FILE)
  const text = textOf(settings, SETTINGS_FILE, options)
  const temporary = temporaryBeside(path)
  let made = false
  try {
    writeNew(temporary, text, 0o644, () => (made = true))
    options.beforePlace?.()
    try {
      ;(options.link ?? linkSync)(temporary, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (code === "EEXIST") throw new CliError(IN4)
      if (!NO_HARD_LINKS.has(code)) throw error
      // No check and then a rename, which would replace a file made in between: one call that refuses a name taken.
      options.beforeFallback?.()
      createInPlace(path, text)
    }
    return path
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(CS14(SETTINGS_FILE))
  } finally {
    if (made) rmSync(temporary, { force: true })
  }
}
