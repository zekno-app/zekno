/**
 * Reading a file of secrets for `zekno secret import <file>`
 * (specs/006-cli-small-features, contracts/import.md, research R8 and R10).
 *
 * The file is the path the person typed, as with `-f`: it may be anywhere,
 * and a link is followed. It is opened once, without waiting on a pipe, held
 * to a regular file and to 1 MiB, read from that one open file, decoded as
 * strict UTF-8, and never copied, changed or deleted.
 *
 * The text holds values, so nothing here ever puts a piece of it into an
 * error, a log or a sentence. A line that does not fit the grammar is named by
 * its number and a fixed reason only, and every exception this module could
 * meet is caught here and turned into one of the sentences below. The only
 * way a value leaves this module is inside an entry, which goes to the secret
 * operation and nowhere else.
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"

import { CliError } from "../errors"

/** The most an import file may be: 1 MiB. A file of 256 values of a few hundred bytes each is far below it. */
export const IMPORT_FILE_LIMIT = 1_048_576

/** One `NAME=value` line, read: its number in the file, the key as written, and the value as the grammar reads it. */
export type ImportEntry = { line: number; name: string; value: string }

/** Why a line does not fit the grammar. Each is one sentence, I2 to I9. */
export type ImportReason = "not_entry" | "unclosed" | "after_quote" | "escape" | "dollar" | "hash" | "control" | "twice"

/** The first line that does not fit: its number and why. `first` is the earlier line of a key given twice (I9). */
export type ImportFailure = { line: number; reason: ImportReason; first?: number }

/** I19: there is nothing at the path. Needs approval (research Q4). */
export const noImportFile = (file: string): string => `No file at ${file}.`
/** I20: something is there, but not a file that can be read. Needs approval (research Q4). */
export const notImportFile = (file: string): string => `${file} is not a file.`
export const importUnreadable = (file: string): string => `${file} could not be read.`
/** I21. Needs approval (research Q4). */
export const importTooLarge = (file: string): string => `${file} is larger than the 1 MiB an import file may be. Nothing was stored.`
/** I22. Needs approval (research Q4). */
export const importNotText = (file: string): string => `${file} is not UTF-8 text. Nothing was stored.`

/** I2 to I9, by reason. Each names the file and a line's number, never anything written on the line. Needs approval (research Q4). */
const SENTENCES: Record<Exclude<ImportReason, "twice">, string> = {
  not_entry: "this is not a NAME=value line.",
  unclosed: "a quoted value does not end on this line. Write a line break as \\n inside double quotes.",
  after_quote: "there is text after the closing quote.",
  escape: 'an escape zekno does not read. Inside double quotes only \\\\ \\" \\n \\r \\t and \\$ are read.',
  dollar: "a $ that zekno would not expand. Put the value in single quotes to keep it as it is.",
  hash: "a # inside a value. Quote the value to keep it, or put a space before # to start a comment.",
  control: "a control character.",
}

/** The sentence for a line that does not fit (I2 to I9), from its number and its reason only. */
export function importLineSentence(file: string, failure: ImportFailure): string {
  const said = failure.reason === "twice" ? `the same name as line ${failure.first}.` : SENTENCES[failure.reason]
  return `${file}, line ${failure.line}: ${said} Nothing was stored.`
}

/** The error for a line that does not fit, built from the line's number and the reason only. */
export const importError = (file: string, failure: ImportFailure): CliError => new CliError(importLineSentence(file, failure))

/**
 * Reads the import file at `path` once, as contracts/import.md, "Reading the
 * file", says. `shown` is the path as typed, cleaned, for the sentences.
 * Returns the text without a leading byte order mark.
 */
export function readImportFile(path: string, shown: string): string {
  let fd: number
  try {
    // A link is followed (it is the person's own path), and a pipe cannot hold the read up.
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ENOENT") throw new CliError(noImportFile(shown))
    throw new CliError(importUnreadable(shown))
  }
  const buffer = Buffer.alloc(IMPORT_FILE_LIMIT + 1)
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile()) throw new CliError(notImportFile(shown))
    if (opened.size > IMPORT_FILE_LIMIT) throw new CliError(importTooLarge(shown))
    // Up to one byte past the limit, from the one open file, so a file that grew after `fstat` is still caught.
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length > IMPORT_FILE_LIMIT) throw new CliError(importTooLarge(shown))
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))
    } catch {
      throw new CliError(importNotText(shown))
    }
    return text.startsWith("﻿") ? text.slice(1) : text
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(importUnreadable(shown))
  } finally {
    // The bytes held values: they are not left lying in memory longer than needed.
    buffer.fill(0)
    try {
      closeSync(fd)
    } catch {
      // Already closed: nothing more to let go of.
    }
  }
}

/** What reading one line gives: nothing (a blank or a comment line), an entry, or why it does not fit. */
type LineRead = { kind: "nothing" } | { kind: "entry"; name: string; value: string } | { kind: "wrong"; reason: ImportReason }

const NOTHING: LineRead = { kind: "nothing" }
const wrong = (reason: ImportReason): LineRead => ({ kind: "wrong", reason })

/** A control character other than a tab: U+0000 to U+001F and U+007F to U+009F (contracts/import.md, CHAR). */
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/
const KEY_CHAR = /^[A-Za-z0-9_.-]$/
const isSpace = (char: string | undefined): boolean => char === " " || char === "\t"

/** The six escapes double quotes allow, and what each stands for. */
const ESCAPES = new Map([
  ["\\", "\\"],
  ['"', '"'],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["$", "$"],
])

/** The first position at or after `at` that is not a space or a tab. */
function skipSpaces(line: string, at: number): number {
  let next = at
  while (isSpace(line[next])) next++
  return next
}

/** A key at `at`, then spaces and `=`: the key and where the value may start, or undefined. */
function keyAt(line: string, at: number): { name: string; after: number } | undefined {
  let end = at
  while (end < line.length && KEY_CHAR.test(line[end]!)) end++
  if (end === at) return undefined
  const equals = skipSpaces(line, end)
  if (line[equals] !== "=") return undefined
  return { name: line.slice(at, end), after: equals + 1 }
}

/** What may follow a closing quote: spaces and tabs, then the end of the line or a comment (I4 otherwise). */
function afterQuote(line: string, at: number): boolean {
  const next = skipSpaces(line, at)
  return next === line.length || line[next] === "#"
}

/**
 * One line, by contracts/import.md's grammar, and the first reason that
 * applies when it does not fit, in the order "Which sentence a line that does
 * not fit gets" gives. A quoted value is read one character at a time, as an
 * unquoted one is, so the first thing met that does not fit decides.
 */
function readLine(line: string): LineRead {
  // 1. A control character anywhere but a tab.
  if (CONTROL.test(line)) return wrong("control")
  const start = skipSpaces(line, 0)
  if (start === line.length || line[start] === "#") return NOTHING
  // 2. An optional `export` and its spaces, then a key, spaces and `=`. `export=1` and `export =1` name the key `export`.
  const exported = line.startsWith("export", start) && isSpace(line[start + 6]) ? keyAt(line, skipSpaces(line, start + 6)) : undefined
  const key = exported ?? keyAt(line, start)
  if (!key) return wrong("not_entry")
  const at = skipSpaces(line, key.after)
  const entry = (value: string): LineRead => ({ kind: "entry", name: key.name, value })

  // 3. A single-quoted value, taken exactly as written.
  if (line[at] === "'") {
    const close = line.indexOf("'", at + 1)
    if (close === -1) return wrong("unclosed")
    return afterQuote(line, close + 1) ? entry(line.slice(at + 1, close)) : wrong("after_quote")
  }

  // 4. A double-quoted value, with its six escapes.
  if (line[at] === '"') {
    let value = ""
    for (let next = at + 1; next < line.length; next++) {
      const char = line[next]!
      if (char === "\\") {
        // A backslash that ends the line would carry the value on to the next one.
        if (next + 1 === line.length) return wrong("unclosed")
        const escaped = ESCAPES.get(line[next + 1]!)
        if (escaped === undefined) return wrong("escape")
        value += escaped
        next++
        continue
      }
      if (char === "$") return wrong("dollar")
      if (char === '"') return afterQuote(line, next + 1) ? entry(value) : wrong("after_quote")
      value += char
    }
    return wrong("unclosed")
  }

  // 5. An unquoted value, up to a comment that follows a space or a tab. Spaces inside it are kept, those around it dropped.
  let end = line.length
  for (let next = at; next < line.length; next++) {
    const char = line[next]!
    if (char === "$") return wrong("dollar")
    if (char === "#") {
      if (isSpace(line[next - 1])) {
        end = next
        break
      }
      return wrong("hash")
    }
    if (char === '"' || char === "'" || char === "`" || char === "\\") return wrong("not_entry")
  }
  return entry(line.slice(at, end).replace(/[ \t]+$/, ""))
}

/**
 * Reads the text of an import file, line by line, by contracts/import.md's
 * grammar. Returns every entry in the file's order, or the first line that
 * does not fit and why. Lines are split at LF; a CR right before an LF is
 * dropped; a last line without an LF counts. A key given twice, letter case
 * counting, is I9 at the second line.
 */
export function parseImport(text: string): { entries: ImportEntry[] } | ImportFailure {
  const pieces = (text.startsWith("﻿") ? text.slice(1) : text).split("\n")
  const entries: ImportEntry[] = []
  const seen = new Map<string, number>()
  for (let index = 0; index < pieces.length; index++) {
    const number = index + 1
    const ended = index < pieces.length - 1
    // The piece after a last line feed is not a line.
    if (!ended && pieces[index] === "") break
    const piece = pieces[index]!
    const line = ended && piece.endsWith("\r") ? piece.slice(0, -1) : piece
    let read: LineRead
    try {
      read = readLine(line)
    } catch {
      // Nothing above throws on a string. Were it to, the line is named by its number, as any other.
      read = wrong("not_entry")
    }
    if (read.kind === "wrong") return { line: number, reason: read.reason }
    if (read.kind === "nothing") continue
    const first = seen.get(read.name)
    if (first !== undefined) return { line: number, reason: "twice", first }
    seen.set(read.name, number)
    entries.push({ line: number, name: read.name, value: read.value })
  }
  return { entries }
}
