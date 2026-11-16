/**
 * The project file, `zekno.json`, as it is on the disk: its name, its form,
 * and how the one that applies to a folder is found and read (project.ts says
 * why each check is made). Whether the team signed it is signed.ts's;
 * whether it is used is project.ts's.
 */
import { EnvelopeSchema, type Envelope } from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { z } from "zod"

import { sha256Of } from "./accepted"
import { CliError } from "../cli/errors"
import { NAME } from "../profile/profile"
import { sanitize } from "../server/sanitize"
import { shownPath } from "./shown"

export const PROJECT_FILE = "zekno.json"
/** The Compose file a folder deploys when nothing names another. */
export const DEFAULT_COMPOSE = "compose.yaml"
/** The most of a project file that is read. Three short names fit many times over. */
export const PROJECT_BYTES = 4096

/**
 * A relative path that stays inside the folder: not absolute, no `..` part,
 * no backslash (it would mean something else on another system), and no
 * control or invisible character.
 */
function isInsidePath(path: string): boolean {
  if (isAbsolute(path) || /[\p{C}\\]/u.test(path)) return false
  return !path.split("/").includes("..")
}

export const ComposePathSchema = z.string().min(1).max(255).refine(isInsidePath)

/**
 * The three plain fields, for people, and `signed`, the team's signature of
 * them (`signerOf`). A file without `signed` is well-formed, and not signed
 * by the team.
 */
export const ProjectSchema = z.strictObject({
  app: z.string().regex(NAME),
  server: z.string().regex(NAME),
  compose: ComposePathSchema.optional(),
  signed: EnvelopeSchema.optional(),
})

/** What a project file says, and where it is. `compose` is relative to `folder`. */
export type ProjectLink = {
  app: string
  server: string
  compose: string
  /** The link a member signed, as the file holds it: not yet checked (`signerOf`). */
  signed?: Envelope
  /** The folder that holds the file. */
  folder: string
  /** The file itself, as a real path: what `links.json` records it by. */
  path: string
  /** The SHA-256 of its bytes, exactly as they were read and parsed. */
  sha256: string
}

/** The sentence for what is wrong with a project file's content. It quotes field names only, cleaned. */
function problemOf(issues: readonly z.core.$ZodIssue[]): string {
  const unknown = issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" && issue.path.length === 0
      ? issue.keys
      : []
  )
  if (unknown.length > 0) {
    const names = unknown
      .map((key) => `"${[...sanitize(key)].slice(0, 40).join("")}"`)
      .join(", ")
    return `has a field zekno does not read: ${names}. It holds only "app", "server", "compose" and "signed".`
  }
  const field = issues[0]?.path[0]
  if (field === "app")
    return `needs "app": an app name of lowercase letters, digits and hyphens.`
  if (field === "server")
    return `needs "server": a server name of lowercase letters, digits and hyphens.`
  if (field === "compose")
    return `has a "compose" that is not a relative path inside its folder.`
  if (field === "signed")
    return `has a "signed" that is not a signature zekno reads. Run \`zekno link --app <name> --server <name> --force\` to sign it again.`
  return `is not a JSON object with an "app", a "server" and a "compose".`
}

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(stat: Stats): boolean {
  const uid = process.getuid?.()
  return uid === undefined || stat.uid === uid
}

const linkSentence = (shown: string) =>
  `${shown} is a symbolic link. zekno reads zekno.json only as a file of its own, never through a link.`

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
  if (!ownedByMe(stat))
    throw new CliError(
      `${shown} belongs to another user, so zekno does not use it.`
    )
}

/**
 * The text of a project file and the SHA-256 of its bytes, read from the
 * file that was checked: never through a link, never more than
 * `PROJECT_BYTES`. What is parsed and what is compared with the accepted
 * list come from this one read.
 */
function readText(
  path: string,
  shown: string
): { text: string; sha256: string } {
  let fd: number
  try {
    // No link is followed, and a pipe swapped in after the check cannot hold the read up.
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    // The file was replaced by a link after it was looked at.
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new CliError(linkSentence(shown))
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
    if (length > PROJECT_BYTES)
      throw new CliError(
        `${shown} is larger than the ${PROJECT_BYTES} bytes a project file may have.`
      )
    const bytes = buffer.subarray(0, length)
    try {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        sha256: sha256Of(bytes),
      }
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

/** A JSON string, as it is written: what is between its quotes is read with `JSON.parse`. */
const JSON_STRING = /"(?:[^"\\\u0000-\u001f]|\\.)*"/y

/** How deep objects nest in a project file: the file, `signed`, and its `signature`. */
const NESTING = 3

/**
 * The keys of a JSON object, in the order written, each as `JSON.parse`
 * reads it, when each value is a string or an object of the same kind, at
 * most `NESTING` deep (as `signed` is). `JSON.parse` keeps only the last of a
 * key written twice, so this is how a second "app" is noticed. The outer
 * object's keys are returned; an object inside it that has a key twice makes
 * the answer undefined, as does text of any other shape.
 */
export function objectKeys(text: string): string[] | undefined {
  let at = 0
  const space = () => {
    while (at < text.length && " \t\n\r".includes(text[at]!)) at++
  }
  const string = (): string | undefined => {
    JSON_STRING.lastIndex = at
    const found = JSON_STRING.exec(text)?.[0]
    if (found === undefined) return undefined
    at += found.length
    return JSON.parse(found) as string
  }
  const object = (depth: number): string[] | undefined => {
    if (depth > NESTING || text[at++] !== "{") return undefined
    const keys: string[] = []
    space()
    if (text[at] === "}") {
      at++
      return keys
    }
    for (;;) {
      space()
      const key = string()
      if (key === undefined) return undefined
      keys.push(key)
      space()
      if (text[at++] !== ":") return undefined
      space()
      if (text[at] === "{") {
        const inner = object(depth + 1)
        if (inner === undefined || new Set(inner).size !== inner.length)
          return undefined
      } else if (string() === undefined) return undefined
      space()
      const next = text[at++]
      if (next === "}") return keys
      if (next !== ",") return undefined
    }
  }
  space()
  const keys = object(1)
  space()
  return at === text.length ? keys : undefined
}

/** Reads and checks the project file at `path`, in `folder`. Every problem stops the command and names the file. */
function readProject(path: string, folder: string, entry: Stats): ProjectLink {
  const shown = shownPath(path)
  checkEntry(entry, shown)
  const { text, sha256 } = readText(path, shown)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new CliError(`${shown} is not valid JSON.`)
  }
  const parsed = ProjectSchema.safeParse(json)
  if (!parsed.success)
    throw new CliError(`${shown} ${problemOf(parsed.error.issues)}`)
  // A field written twice is read as its last value, which someone reading the file from the top may not notice.
  const keys = objectKeys(text)
  if (keys === undefined || new Set(keys).size !== keys.length)
    throw new CliError(`${shown} has the same field more than once.`)
  const { app, server, compose = DEFAULT_COMPOSE, signed } = parsed.data
  return {
    app,
    server,
    compose,
    ...(signed === undefined ? {} : { signed }),
    folder,
    path,
    sha256,
  }
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
export const isAbove = (dir: string, path: string): boolean =>
  dir !== path && path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`)

/**
 * Whether a folder's listing has an entry named exactly `name`. On a file
 * system that ignores case, `ZEKNO.JSON` is found under the name
 * `zekno.json` too, and it is not that file: what a person sees in the
 * folder, and what a disk that heeds case would find, is what counts. Throws
 * when the folder cannot be listed. `zekno.app.json` is held to it as well
 * (specs/010-app-settings, security review S5).
 */
export const listsExactly = (dir: string, name: string): boolean =>
  readdirSync(dir).includes(name)

/** Whether a folder's listing has a file named exactly zekno.json (`listsExactly`). */
function listedExactly(dir: string, shown: string): boolean {
  try {
    return listsExactly(dir, PROJECT_FILE)
  } catch {
    throw new CliError(`${shown} could not be read.`)
  }
}

/**
 * The project file that applies to `start`: the one in `start`, or else in
 * the nearest folder above it. The folders are those `start` really is in,
 * as the working folder a program is given always is. The search ends at the
 * home folder (whose own zekno.json counts) or at the filesystem root, and
 * never reads one from a folder above home. Undefined when there is none. A
 * file that is there but not right (a link, another user's, too large,
 * malformed) is an error that names it. Whether this machine accepted it is
 * not decided here (`isAccepted`).
 */
export function findProject(
  start: string,
  home = homedir()
): ProjectLink | undefined {
  const homes = homesOf(home)
  for (let dir = real(resolve(start)); ;) {
    if (homes.some((folder) => isAbove(dir, folder))) return undefined
    const path = join(dir, PROJECT_FILE)
    let entry: Stats | undefined
    try {
      entry = lstatSync(path)
    } catch {
      // Not there, or a folder that cannot be looked into: nothing applies from it.
      entry = undefined
    }
    if (entry && listedExactly(dir, shownPath(path)))
      return readProject(path, dir, entry)
    const parent = dirname(dir)
    if (homes.includes(dir) || parent === dir) return undefined
    dir = parent
  }
}

/** Where zekno.json in `folder` is, as `findProject` and `links.json` name it: by its real path. */
export const projectFileIn = (folder: string): string =>
  join(real(resolve(folder)), PROJECT_FILE)

/** Whether a project file is in the folder a command runs in, `cwd`, rather than in one above it. */
export const isHere = (
  link: Pick<ProjectLink, "folder">,
  cwd: string
): boolean => link.folder === real(resolve(cwd))
