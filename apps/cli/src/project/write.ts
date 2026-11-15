/**
 * Writing the project file (`zekno link`): the Compose file it names, held
 * inside its folder (`composeFor`); its text, three names and the team's
 * signature of them (`projectText`); and putting it in place as one whole
 * file, never over an existing one without `force` (`writeProject`).
 */
import type { Envelope } from "@workspace/core"
import { randomBytes } from "node:crypto"
import { closeSync, fchmodSync, linkSync, lstatSync, openSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"

import { CliError, UsageError } from "../cli/errors"
import { ComposePathSchema, isAbove, PROJECT_BYTES, PROJECT_FILE, ProjectSchema } from "./file"
import { sanitize } from "../server/sanitize"
import { shownPath } from "./shown"

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
  let root: string
  try {
    real = realpathSync(path)
  } catch {
    throw new CliError(`No Compose file at ${shownPath(path)}. Point to one with \`-f <file>\`.`)
  }
  try {
    root = realpathSync(folder)
  } catch {
    throw new CliError(`${shownPath(folder)} could not be read.`)
  }
  if (!isAbove(root, real)) {
    throw new CliError(`${sanitize(named)} leads outside this folder through a symbolic link, so zekno.json cannot name it.`)
  }
  let isFile: boolean
  try {
    isFile = statSync(real).isFile()
  } catch {
    isFile = false
  }
  if (!isFile) throw new CliError(`${shownPath(path)} is not a file.`)
  return named
}

/**
 * What a project file holds, exactly as it is written: three names, each
 * held to its rule, and the team's signature of them when there is one.
 * Nothing else can go in, and it always fits what is read back.
 */
export function projectText(link: { app: string; server: string; compose: string; signed?: Envelope }): string {
  const fields = { app: link.app, server: link.server, compose: link.compose, ...(link.signed === undefined ? {} : { signed: link.signed }) }
  const parsed = ProjectSchema.safeParse(fields)
  if (!parsed.success) throw new CliError("zekno.json holds only an app name, a server name and a Compose file inside its folder.")
  const { app, server, compose, signed } = parsed.data
  const text = `${JSON.stringify(signed === undefined ? { app, server, compose } : { app, server, compose, signed }, null, 2)}\n`
  if (Buffer.byteLength(text) > PROJECT_BYTES) throw new CliError(`zekno.json would be larger than the ${PROJECT_BYTES} bytes a project file may have.`)
  return text
}

/** Said when zekno.json would be written over one that is there, without `--force` (A15 of specs/006-cli-small-features). */
export const alreadyLinked = (folder: string): string => `There is already a ${PROJECT_FILE} in ${shownPath(folder)}. Run \`zekno link --force\` to replace it.`

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
export function writeProject(folder: string, link: Parameters<typeof projectText>[0], force = false): string {
  const text = projectText(link)
  const path = join(folder, PROJECT_FILE)
  const shown = shownPath(path)
  const already = new CliError(alreadyLinked(folder))
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
