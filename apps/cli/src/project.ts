/**
 * The project file, `zekno.json` (data-model.md): which app a folder
 * deploys, to which server, from which Compose file. It saves typing `--app`
 * and `--server`; flags always win over it.
 *
 * It is not signed and not trusted. It may have come with a cloned
 * repository, or been put in a parent folder by someone else, so:
 *
 * - its schema is strict, an unknown field is an error, and at most
 *   `PROJECT_BYTES` of it are read;
 * - it is looked for from the current folder up to the home folder, never in
 *   a folder above home (above home other people's files live), and it is
 *   used only as a regular file of its own that belongs to this user: never
 *   through a symbolic link, never a pipe or a device;
 * - the Compose file it names must stay inside its folder, also once
 *   symbolic links are followed;
 * - the server it names is looked up in the verified profile, and the app
 *   name is held to the app-name pattern, before anything is sent;
 * - it is written only when asked, never over an existing one without
 *   `--force`, never through a link, and holds three names and nothing else:
 *   no secret and no key.
 */
import { randomBytes } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  type Stats,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { z } from "zod"

import { CliError, UsageError } from "./errors"
import { NAME } from "./profile"
import { sanitize } from "./sanitize"

export const PROJECT_FILE = "zekno.json"
/** The Compose file a folder deploys when nothing names another. */
export const DEFAULT_COMPOSE = "compose.yaml"
/** The most of a project file that is read. Three short names fit many times over. */
export const PROJECT_BYTES = 4096

/** A path as a person reads it: under their home folder it starts with `~`. */
export function tilde(path: string, home = homedir()): string {
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** A path for a sentence. A folder's name can hold anything, escape sequences included, so it is cleaned. */
export const shownPath = (path: string): string => sanitize(tilde(path))

/**
 * A relative path that stays inside the folder: not absolute, no `..` part,
 * no backslash (it would mean something else on another system), and no
 * control or invisible character.
 */
function isInsidePath(path: string): boolean {
  if (isAbsolute(path) || /[\p{C}\\]/u.test(path)) return false
  return !path.split("/").includes("..")
}

const ComposePathSchema = z.string().min(1).max(255).refine(isInsidePath)

const ProjectSchema = z.strictObject({
  app: z.string().regex(NAME),
  server: z.string().regex(NAME),
  compose: ComposePathSchema.optional(),
})

/** What a project file says, and where it is. `compose` is relative to `folder`. */
export type ProjectLink = {
  app: string
  server: string
  compose: string
  /** The folder that holds the file. */
  folder: string
  /** The file itself. */
  path: string
}

/** The sentence for what is wrong with a project file's content. It quotes field names only, cleaned. */
function problemOf(issues: readonly z.core.$ZodIssue[]): string {
  const unknown = issues.flatMap((issue) => (issue.code === "unrecognized_keys" ? issue.keys : []))
  if (unknown.length > 0) {
    const names = unknown.map((key) => `"${[...sanitize(key)].slice(0, 40).join("")}"`).join(", ")
    return `has a field zekno does not read: ${names}. It holds only "app", "server" and "compose".`
  }
  const field = issues[0]?.path[0]
  if (field === "app") return `needs "app": an app name of lowercase letters, digits and hyphens.`
  if (field === "server") return `needs "server": a server name of lowercase letters, digits and hyphens.`
  if (field === "compose") return `has a "compose" that is not a relative path inside its folder.`
  return `is not a JSON object with an "app", a "server" and a "compose".`
}

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(stat: Stats): boolean {
  const uid = process.getuid?.()
  return uid === undefined || stat.uid === uid
}

const linkSentence = (shown: string) => `${shown} is a symbolic link. zekno reads zekno.json only as a file of its own, never through a link.`

/**
 * Checks what is at a project file's path before anything is opened: a
 * regular file of this user's, not a link. A link is refused rather than
 * followed or passed over: followed, it would let the file's content come
 * from anywhere; passed over, a folder that looks linked would quietly
 * deploy as if it were not.
 */
function checkEntry(stat: Stats, shown: string): void {
  if (stat.isSymbolicLink()) throw new CliError(linkSentence(shown))
  if (!stat.isFile()) throw new CliError(`${shown} is not a file.`)
  if (!ownedByMe(stat)) throw new CliError(`${shown} belongs to another user, so zekno does not use it.`)
}

/** The text of a project file, read from the file that was checked: never through a link, never more than `PROJECT_BYTES`. */
function readText(path: string, shown: string): string {
  let fd: number
  try {
    // No link is followed, and a pipe swapped in after the check cannot hold the read up.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    // The file was replaced by a link after it was looked at.
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new CliError(linkSentence(shown))
    throw new CliError(`${shown} could not be read.`)
  }
  try {
    // What was opened is checked again: the path may have changed since it was looked at.
    checkEntry(fstatSync(fd), shown)
    const buffer = Buffer.alloc(PROJECT_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length > PROJECT_BYTES) throw new CliError(`${shown} is larger than the ${PROJECT_BYTES} bytes a project file may have.`)
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))
    } catch {
      throw new CliError(`${shown} is not valid JSON.`)
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${shown} could not be read.`)
  } finally {
    closeSync(fd)
  }
}

/** Reads and checks the project file at `path`, in `folder`. Every problem stops the command and names the file. */
function readProject(path: string, folder: string, entry: Stats): ProjectLink {
  const shown = shownPath(path)
  checkEntry(entry, shown)
  let json: unknown
  try {
    json = JSON.parse(readText(path, shown))
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${shown} is not valid JSON.`)
  }
  const parsed = ProjectSchema.safeParse(json)
  if (!parsed.success) throw new CliError(`${shown} ${problemOf(parsed.error.issues)}`)
  const { app, server, compose = DEFAULT_COMPOSE } = parsed.data
  return { app, server, compose, folder, path }
}

/** A folder as it really is, with no link in its path; as given when that cannot be found out. */
function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** The home folder as given and as it really is, when that differs: a folder above either is above home. */
function homesOf(home: string): string[] {
  const given = resolve(home)
  const found = real(given)
  return found === given ? [given] : [given, found]
}

/** Whether `dir` holds `path` somewhere below it. */
const isAbove = (dir: string, path: string): boolean => dir !== path && path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`)

/**
 * The project file that applies to `start`: the one in `start`, or else in
 * the nearest folder above it. The folders are those `start` really is in,
 * as the working folder a program is given always is. The search ends at the
 * home folder (whose own zekno.json counts) or at the filesystem root, and
 * never reads one from a folder above home. Undefined when there is none. A
 * file that is there but not right (a link, another user's, too large,
 * malformed) is an error that names it.
 */
export function findProject(start: string, home = homedir()): ProjectLink | undefined {
  const homes = homesOf(home)
  for (let dir = real(resolve(start)); ; ) {
    if (homes.some((folder) => isAbove(dir, folder))) return undefined
    const path = join(dir, PROJECT_FILE)
    let entry: Stats | undefined
    try {
      entry = lstatSync(path)
    } catch {
      // Not there, or a folder that cannot be looked into: nothing applies from it.
      entry = undefined
    }
    if (entry) return readProject(path, dir, entry)
    const parent = dirname(dir)
    if (homes.includes(dir) || parent === dir) return undefined
    dir = parent
  }
}

/**
 * The Compose file a project file names, as a real path with no link left
 * in it. It must exist, be a regular file, and stay inside the project
 * file's folder once symbolic links are followed: a link that leads out of
 * the folder is refused, so a project file can never make zekno read and
 * send a file from elsewhere on this machine.
 */
export function projectCompose(link: ProjectLink): string {
  const shown = shownPath(link.path)
  const named = sanitize(link.compose)
  let folder: string
  let real: string
  try {
    folder = realpathSync(link.folder)
  } catch {
    throw new CliError(`The folder of ${shown} could not be read.`)
  }
  try {
    real = realpathSync(resolve(link.folder, link.compose))
  } catch {
    throw new CliError(`${shown} names ${named} as the Compose file, and there is no such file in ${shownPath(link.folder)}.`)
  }
  if (!isAbove(folder, real)) {
    throw new CliError(`${named}, named by ${shown}, leads outside the folder that holds it. zekno does not follow it there.`)
  }
  if (!statSync(real).isFile()) throw new CliError(`${named}, named by ${shown}, is not a file.`)
  return real
}

/**
 * The Compose file `zekno link -f <file>` names, as zekno.json keeps it:
 * relative to `folder`, where zekno.json is written. It must be a file inside
 * that folder, also once symbolic links are followed.
 */
export function composeFor(folder: string, file: string): string {
  const path = resolve(folder, file)
  const named = relative(folder, path).split(sep).join("/")
  if (named === "" || isAbove(path, folder) || !ComposePathSchema.safeParse(named).success) {
    throw new UsageError("The Compose file has to be inside this folder, since zekno.json names it from here.")
  }
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    throw new CliError(`No Compose file at ${shownPath(path)}. Point to one with \`-f <file>\`.`)
  }
  if (!isAbove(realpathSync(folder), real)) {
    throw new CliError(`${sanitize(named)} leads outside this folder through a symbolic link, so zekno.json cannot name it.`)
  }
  if (!statSync(real).isFile()) throw new CliError(`${shownPath(path)} is not a file.`)
  return named
}

/** The details a command can take from the project file. `file` is the Compose file. */
export type Details = { app?: string; server?: string; file?: string }

/**
 * What a command was given, with each detail it was not given taken from the
 * project file: flags win, one detail at a time. The file is looked for only
 * when a wanted detail is missing, so a command given every flag never reads
 * it. `serverFrom` is the project file's path, as a sentence shows it, when
 * the server came from it: for the sentence when no such server is connected.
 */
export function withProject<T extends Details>(
  cwd: string,
  given: T,
  wanted: readonly (keyof Details)[],
  home?: string
): T & { serverFrom?: string } {
  const missing = wanted.filter((detail) => given[detail] === undefined)
  if (missing.length === 0) return given
  const link = findProject(cwd, home)
  if (!link) return given
  const filled: T & { serverFrom?: string } = { ...given }
  if (missing.includes("app")) filled.app = link.app
  if (missing.includes("server")) {
    filled.server = link.server
    filled.serverFrom = shownPath(link.path)
  }
  if (missing.includes("file")) filled.file = projectCompose(link)
  return filled
}

/** What a project file holds, exactly as it is written: three names, each held to its rule, and nothing else can go in. */
export function projectText(link: { app: string; server: string; compose: string }): string {
  const parsed = ProjectSchema.safeParse({ app: link.app, server: link.server, compose: link.compose })
  if (!parsed.success) throw new CliError("zekno.json holds only an app name, a server name and a Compose file inside its folder.")
  const { app, server, compose } = parsed.data
  return `${JSON.stringify({ app, server, compose }, null, 2)}\n`
}

/** File systems where a hard link cannot be made; writing there checks first, then renames. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK", "ENOSYS"])

/**
 * Writes `zekno.json` in `folder`, as one whole file or not at all: a new
 * file under a name nobody can predict, mode 644, then put in place. Without
 * `force` it is put in place with a hard link, which fails if anything is
 * already there, so an existing file is never replaced, not even one that
 * appears in between. With `force` a rename replaces what is there: a link
 * is replaced itself, never written through. Returns the file's path.
 */
export function writeProject(folder: string, link: { app: string; server: string; compose: string }, force = false): string {
  const text = projectText(link)
  const path = join(folder, PROJECT_FILE)
  const shown = shownPath(path)
  const already = new CliError(`There is already a ${PROJECT_FILE} in ${shownPath(folder)}. Run \`zekno link --force\` to replace it.`)
  const temporary = join(folder, `.${PROJECT_FILE}.${randomBytes(8).toString("hex")}.tmp`)
  try {
    // `wx` refuses a file or link that is already there under this name.
    const fd = openSync(temporary, "wx", 0o644)
    try {
      fchmodSync(fd, 0o644)
      writeSync(fd, text)
    } finally {
      closeSync(fd)
    }
    if (force) {
      renameSync(temporary, path)
      return path
    }
    try {
      linkSync(temporary, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (code === "EEXIST") throw already
      if (!NO_HARD_LINKS.has(code)) throw error
      if (exists(path)) throw already
      renameSync(temporary, path)
    }
    return path
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`Could not write ${shown}.`)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Whether anything is at a path, a link to nowhere included. */
function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
