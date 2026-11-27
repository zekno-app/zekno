/**
 * The ignore file of a deploy that builds, chosen and read as Docker's own
 * code does it (specs/016-build-from-source, contracts/cli.md CL2, "The
 * ignore file", "Reading it"; FR-013), written in the project with no package
 * (plan.md item 8 (a)):
 *
 * - chosen as BuildKit picks it: `<dockerfile>.dockerignore` beside the
 *   Dockerfile, else `.dockerignore` at the root; for Railpack only the root's;
 * - read as `ignorefile.ReadAll` (moby/patternmatcher) reads it, from one
 *   open file inside the root, never through a link, within its bounds;
 * - compiled as `patternmatcher.New` compiles it, and matched by
 *   `pack/ignore-match.ts`.
 *
 * What zekno cannot reproduce exactly is refused before signing, never
 * guessed: a class Go's regexp reads otherwise than its pattern says (a POSIX
 * class among them), an escape Go's regexp reads as a class, a pattern Docker
 * itself refuses, and a file past its bounds. Each is a stop with an id of its
 * own, exit status 1; their sentences wait for rows (T156), and until then
 * the text said is the id (FR-092).
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
} from "node:fs"
import { join } from "node:path"

import { CliError } from "../cli/errors"
import {
  cleanPath,
  compilePattern,
  type IgnorePattern,
  onlyPrefixExceptions,
  type PatternRules,
  trimSpace,
} from "./ignore-match"

export {
  cleanPath,
  entersExcluded,
  type IgnorePattern,
  type MatchInfo,
  matchPath,
} from "./ignore-match"

/** The most an ignore file may hold, in bytes (CL2). */
export const IGNORE_FILE_BYTES = 1024 * 1024

/**
 * The most a line of it may take with its end, in bytes: Go's line scanner,
 * which Docker reads it with, refuses a longer one (CL2: lines at most 64 KiB).
 */
export const IGNORE_LINE_BYTES = 64 * 1024

/**
 * A stop of the ignore file, with no row in design/lines.md yet (T156):
 *
 * - `ignore_file`: the file is past its bounds (`size`, or a `line` too
 *   long), or is not a regular file inside the root (`not_a_file`: a link, a
 *   pipe, a folder, or a file under a linked folder), which is never followed;
 * - `ignore_pattern`: a pattern zekno cannot reproduce exactly (`class`,
 *   `escape`, `text`: not UTF-8, or a byte order mark inside), or one Docker
 *   refuses (`syntax`).
 *
 * `file` is the ignore file's path in the folder sent; `at` its line, null
 * for the whole file.
 */
export type OwnIgnoreLine =
  | {
      id: "ignore_file"
      why: "size" | "line" | "not_a_file"
      file: string
      at: number | null
    }
  | {
      id: "ignore_pattern"
      why: "class" | "escape" | "syntax" | "text"
      file: string
      at: number
    }

/** A stop before signing, exit status 1 (CL11). Its message is its id until T156. */
export class IgnoreStop extends CliError {
  constructor(readonly line: OwnIgnoreLine) {
    super(line.id)
  }
}

/** One pattern of an ignore file as `ReadAll` gives it, with its line in the file. */
export type IgnoreLine = { readonly text: string; readonly line: number }

/** The rules of one ignore file, or none. */
export type IgnoreRules = PatternRules & {
  /** The ignore file in use, as a path in the folder sent; null when there is none. */
  readonly file: string | null
}

/** The builds whose ignore file is chosen here. */
export type IgnoreFor =
  { builder: "dockerfile"; dockerfile: string } | { builder: "railpack" }

/** The ignore files BuildKit looks for, in order: the first found is used (CL2). */
export function ignoreFileNames(build: IgnoreFor): string[] {
  return build.builder === "dockerfile"
    ? [`${build.dockerfile}.dockerignore`, ".dockerignore"]
    : [".dockerignore"]
}

/**
 * The patterns of an ignore file's bytes, as `ignorefile.ReadAll` gives them:
 * lines split as Go's line scanner splits them (a `\r` before the `\n`
 * dropped); a byte order mark at the start of the first dropped; a line
 * starting `#` a comment, before trimming; trimmed; empty lines skipped; `!`
 * an exception; the rest cleaned as `filepath.Clean`, one leading `/` dropped.
 */
export function readAll(bytes: Uint8Array, file: string): IgnoreLine[] {
  const lines: IgnoreLine[] = []
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  let start = 0
  let number = 0
  while (start < bytes.length) {
    const found = bytes.indexOf(0x0a, start)
    const end = found < 0 ? bytes.length : found
    number++
    if (end - start >= IGNORE_LINE_BYTES)
      throw new IgnoreStop({ id: "ignore_file", why: "line", file, at: number })
    let line = bytes.subarray(start, end)
    start = end + 1
    if (line.at(-1) === 0x0d) line = line.subarray(0, -1)
    if (
      number === 1 &&
      line[0] === 0xef &&
      line[1] === 0xbb &&
      line[2] === 0xbf
    )
      line = line.subarray(3)
    if (line[0] === 0x23) continue
    let pattern: string
    try {
      pattern = trimSpace(decoder.decode(line))
    } catch {
      throw new IgnoreStop({
        id: "ignore_pattern",
        why: "text",
        file,
        at: number,
      })
    }
    if (pattern === "") continue
    const exception = pattern.startsWith("!")
    if (exception) pattern = trimSpace(pattern.slice(1))
    if (pattern !== "") {
      pattern = cleanPath(pattern)
      if (pattern.length > 1 && pattern.startsWith("/"))
        pattern = pattern.slice(1)
    }
    lines.push({ text: exception ? `!${pattern}` : pattern, line: number })
  }
  return lines
}

/**
 * The rules of an ignore file's patterns, as `patternmatcher.New` makes
 * them: each trimmed and cleaned again, `!` taken off an exception, a lone
 * `!` refused, each compiled. A pattern zekno cannot reproduce exactly, or
 * that Docker refuses, is a stop.
 */
export function compilePatterns(
  lines: readonly IgnoreLine[],
  file: string
): PatternRules {
  const patterns: IgnorePattern[] = []
  for (const { text, line } of lines) {
    let pattern = trimSpace(text)
    if (pattern === "") continue
    pattern = cleanPath(pattern)
    const exception = pattern.startsWith("!")
    if (exception) {
      if (pattern.length === 1)
        throw new IgnoreStop({
          id: "ignore_pattern",
          why: "syntax",
          file,
          at: line,
        })
      pattern = pattern.slice(1)
    }
    const compiled = compilePattern(pattern)
    if (typeof compiled === "string")
      throw new IgnoreStop({
        id: "ignore_pattern",
        why: compiled,
        file,
        at: line,
      })
    patterns.push({ cleaned: pattern, exception, line, ...compiled })
  }
  return { patterns, onlyPrefixExceptions: onlyPrefixExceptions(patterns) }
}

/** Whether a folder holds an entry of exactly this name, byte for byte: a file system that ignores case finds others under it. */
function holdsExactly(folder: string, name: string): boolean {
  const dir = opendirSync(folder)
  try {
    for (let entry = dir.readSync(); entry !== null; entry = dir.readSync())
      if (entry.name === name) return true
    return false
  } finally {
    dir.closeSync()
  }
}

/** Whether an error says a path is not there. */
const absent = (error: unknown): boolean =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")

/**
 * The bytes of the ignore file `name` (`/` between its parts) inside `root`,
 * or undefined when it is not there: every folder on the way a real folder,
 * never a link; the file opened once, without following a link or blocking,
 * held to a regular file of at most `IGNORE_FILE_BYTES`, whose name on disk
 * is `name` byte for byte, as the server's file system would find it.
 */
function readInside(root: string, name: string): Uint8Array | undefined {
  const notAFile = () =>
    new IgnoreStop({
      id: "ignore_file",
      why: "not_a_file",
      file: name,
      at: null,
    })
  const tooLarge = () =>
    new IgnoreStop({ id: "ignore_file", why: "size", file: name, at: null })
  const parts = name.split("/")
  let folder = root
  for (const part of parts.slice(0, -1)) {
    folder = join(folder, part)
    let info
    try {
      info = lstatSync(folder)
    } catch (error) {
      if (absent(error)) return undefined
      throw notAFile()
    }
    if (info.isSymbolicLink()) throw notAFile()
    if (!info.isDirectory()) return undefined
  }
  const path = join(folder, parts.at(-1)!)
  let before
  try {
    before = lstatSync(path)
  } catch (error) {
    if (absent(error)) return undefined
    throw notAFile()
  }
  if (!holdsExactly(folder, parts.at(-1)!)) return undefined
  if (!before.isFile()) throw notAFile()
  let fd: number
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch {
    throw notAFile()
  }
  try {
    const opened = fstatSync(fd)
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw notAFile()
    if (opened.size > IGNORE_FILE_BYTES) throw tooLarge()
    // One byte past the bound shows a file that grew after it was looked at.
    const buffer = Buffer.alloc(IGNORE_FILE_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length > IGNORE_FILE_BYTES) throw tooLarge()
    return buffer.subarray(0, length)
  } finally {
    closeSync(fd)
  }
}

/**
 * The rules of a build's ignore file in the folder sent (`root`, a real
 * path): the first of `ignoreFileNames` that is there, read and compiled;
 * none when neither is. A file past its bounds, one that is not a regular
 * file inside the root, or a pattern zekno cannot reproduce is a stop.
 */
export function readIgnoreFile(root: string, build: IgnoreFor): IgnoreRules {
  for (const name of ignoreFileNames(build)) {
    const bytes = readInside(root, name)
    if (bytes !== undefined)
      return { file: name, ...compilePatterns(readAll(bytes, name), name) }
  }
  return { file: null, patterns: [], onlyPrefixExceptions: true }
}
