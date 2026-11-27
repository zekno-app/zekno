/**
 * Reading the Compose file a deploy signs: once, from one open file, and the
 * text that was read is the text that is signed, and the text the app lists
 * the expected values of. A path is never checked first and read again later,
 * when it may lead somewhere else.
 *
 * A Compose file that must stay inside a folder (the one an accepted
 * zekno.json names, and compose.yaml where nothing names another) is found
 * by its real path, which must be inside the folder; opened without following
 * a link and without waiting on a pipe; held to a regular file of this user's
 * with one name on the disk (a hard link could make a file outside the folder
 * look like one inside) and at most the deploy limit; read from that open
 * file; and then its real path is found again and must still be inside the
 * folder and be the very file that was read. A file swapped in while this
 * happened is refused, not read.
 *
 * A file the person named with `-f` is theirs to name, anywhere: links are
 * followed, but it is still read from one open file, held to a regular file
 * and to the limit, and never waited on as a pipe.
 */
import { LIMITS } from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs"
import { resolve } from "node:path"

import { CliError } from "../cli/errors"
import { handComposeStop } from "./compose-build"
import { DEFAULT_COMPOSE, isAbove, type ProjectLink } from "./file"
import { shownPath } from "./shown"
import { sanitize } from "../server/sanitize"

/** Where a deploy's Compose file comes from. */
export type ComposeSource =
  /** The Compose file an accepted zekno.json names, inside the zekno.json's folder. */
  | { kind: "project"; link: ProjectLink }
  /** compose.yaml in `folder`, the folder a command or the app was started in, when nothing names another file. */
  | { kind: "default"; folder: string }
  /** `-f <path>`, as the person typed it, resolved. */
  | { kind: "given"; path: string }

/** A Compose file as read: its text, and the file it was read from. */
export type ComposeText = { text: string; path: string }

/** The sentences for what can be wrong, each naming the file. A settings file is read with its own (settings/file.ts). */
export type Words = {
  /** The file as a sentence names it before "is not a file" and the like. */
  subject: string
  missing: string
  outside: string
  folder: string
}

export function wordsFor(source: ComposeSource): Words {
  if (source.kind === "project") {
    const shown = shownPath(source.link.path)
    const named = sanitize(source.link.compose)
    return {
      subject: `${named}, named by ${shown},`,
      missing: `${shown} names ${named} as the Compose file, and there is no such file in ${shownPath(source.link.folder)}.`,
      outside: `${named}, named by ${shown}, leads outside the folder that holds it. zekno does not follow it there.`,
      folder: `The folder of ${shown} could not be read.`,
    }
  }
  // A folder's name can hold anything, escape sequences included, so a path is cleaned before it is shown.
  const path = sanitize(
    source.kind === "default"
      ? resolve(source.folder, DEFAULT_COMPOSE)
      : source.path
  )
  return {
    subject: path,
    missing: `No Compose file at ${path}. Point to one with \`-f <file>\`.`,
    outside: `${DEFAULT_COMPOSE} leads outside this folder through a symbolic link, so zekno does not read it. To deploy that file, name it with \`-f <file>\`.`,
    folder: `${source.kind === "default" ? shownPath(source.folder) : path} could not be read.`,
  }
}

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(stat: Stats): boolean {
  const uid = process.getuid?.()
  return uid === undefined || stat.uid === uid
}

const TOO_LARGE = "The Compose file is larger than the 256 KiB limit."

/** Reads an open file to its end, up to one byte past the limit, so a file that grew after `fstat` is still caught. */
function readAll(fd: number, limit: number, tooLarge: string): Buffer {
  const buffer = Buffer.alloc(limit + 1)
  let length = 0
  while (length < buffer.length) {
    const read = readSync(fd, buffer, length, buffer.length - length, null)
    if (read === 0) break
    length += read
  }
  if (length > limit) throw new CliError(tooLarge)
  return buffer.subarray(0, length)
}

/** The bytes of a file as read from one open file, with the file's identity and mode from that descriptor. */
export type ReadBytes = {
  bytes: Buffer
  path: string
  dev: number
  ino: number
  mode: number
}

/**
 * The bytes of a file that must stay inside `folder`, under the relative
 * name `name`, at most `limit` bytes (`tooLarge` said past it). Every check
 * this file's first comment names is made here, for a Compose file and for a
 * settings file alike.
 */
export function readInsideBytes(
  folder: string,
  name: string,
  words: Words,
  limit: number,
  tooLarge: string
): ReadBytes {
  let root: string
  try {
    root = realpathSync(folder)
  } catch {
    throw new CliError(words.folder)
  }
  let path: string
  try {
    path = realpathSync(resolve(folder, name))
  } catch {
    throw new CliError(words.missing)
  }
  if (!isAbove(root, path)) throw new CliError(words.outside)
  let fd: number
  try {
    // The real path has no link left in it; one put there since is not followed, and a pipe cannot hold the read up.
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new CliError(
        `${words.subject} was changed while zekno read it. Try again.`
      )
    throw new CliError(`${words.subject} could not be read.`)
  }
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile()) throw new CliError(`${words.subject} is not a file.`)
    if (opened.nlink !== 1) {
      throw new CliError(
        `${words.subject} has more than one name on this disk (a hard link), so zekno cannot tell that it stays inside its folder.`
      )
    }
    if (!ownedByMe(opened))
      throw new CliError(
        `${words.subject} belongs to another user, so zekno does not use it.`
      )
    if (opened.size > limit) throw new CliError(tooLarge)
    const bytes = readAll(fd, limit, tooLarge)
    // What was read must still be the file inside the folder: a folder on the way may have been swapped for a link meanwhile.
    let again: string
    let now: Stats
    try {
      again = realpathSync(path)
      now = statSync(again)
    } catch {
      throw new CliError(
        `${words.subject} was changed while zekno read it. Try again.`
      )
    }
    if (
      !isAbove(root, again) ||
      now.dev !== opened.dev ||
      now.ino !== opened.ino
    ) {
      throw new CliError(
        `${words.subject} was changed while zekno read it. Try again.`
      )
    }
    return {
      bytes,
      path,
      dev: opened.dev,
      ino: opened.ino,
      mode: opened.mode,
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${words.subject} could not be read.`)
  } finally {
    closeSync(fd)
  }
}

/** A Compose file that must stay inside `folder`, under the relative name `name`. */
function readInside(folder: string, name: string, words: Words): ComposeText {
  const read = readInsideBytes(
    folder,
    name,
    words,
    LIMITS.composeBytes,
    TOO_LARGE
  )
  return { text: read.bytes.toString("utf8"), path: read.path }
}

/**
 * The bytes of a file named with `-f`: followed where it leads, but read
 * from one open file, a regular file of at most `limit` bytes (`tooLarge`
 * said past it).
 */
export function readGivenBytes(
  path: string,
  words: Words,
  limit: number,
  tooLarge: string
): ReadBytes {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new CliError(words.missing)
    throw new CliError(`${words.subject} could not be read.`)
  }
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile()) throw new CliError(`${words.subject} is not a file.`)
    if (opened.size > limit) throw new CliError(tooLarge)
    return {
      bytes: readAll(fd, limit, tooLarge),
      path,
      dev: opened.dev,
      ino: opened.ino,
      mode: opened.mode,
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${words.subject} could not be read.`)
  } finally {
    closeSync(fd)
  }
}

/** A Compose file named with `-f`: followed where it leads, but read from one open file, a regular file within the limit. */
function readGiven(path: string, words: Words): ComposeText {
  const read = readGivenBytes(path, words, LIMITS.composeBytes, TOO_LARGE)
  return { text: read.bytes.toString("utf8"), path: read.path }
}

/** The Compose file as a line names it: its name, as the zekno.json names it, or the path given, cleaned. */
function shownName(source: ComposeSource): string {
  switch (source.kind) {
    case "project":
      return sanitize(source.link.compose)
    case "default":
      return DEFAULT_COMPOSE
    case "given":
      return shownPath(source.path)
  }
}

/**
 * Reads the Compose file a deploy will sign, once. Every problem is a
 * sentence that names the file; a file written by hand that asks Docker to
 * build, or names `zekno.invalid`, is C8 or C9, before signing
 * (specs/016-build-from-source, CL6; compose-build.ts).
 */
export function readCompose(source: ComposeSource): ComposeText {
  const words = wordsFor(source)
  let read: ComposeText
  switch (source.kind) {
    case "project":
      read = readInside(source.link.folder, source.link.compose, words)
      break
    case "default":
      read = readInside(source.folder, DEFAULT_COMPOSE, words)
      break
    case "given":
      read = readGiven(source.path, words)
      break
  }
  const stop = handComposeStop(read.text, shownName(source))
  if (stop !== undefined) throw stop
  return read
}
