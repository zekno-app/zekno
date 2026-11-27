/**
 * A repository's `config`, read from the file with no `git` run
 * (specs/016-build-from-source, contracts/cli.md CL4 step 2; plan.md item
 * 9 (a)). The uncommitted-changes line is left out, the reader giving up,
 * when the repository is one zekno's readers cannot follow: objects named
 * otherwise than by SHA-1 (`extensions.objectFormat`), refs kept otherwise
 * than in files (`extensions.refStorage`), no work tree (`core.bare` true),
 * or a format git itself does not know.
 *
 * The file is read as git's own parser reads it (config.c: sections,
 * `[section "sub"]`, keys with no value, quotes, escapes, comments and lines
 * joined by `\`), byte by byte, so a setting written in a form a looser
 * reader would miss still gives up. A file git would call a bad config gives
 * up too. Includes are not followed: git reads a repository's format and
 * extensions from this file alone.
 */
import { join } from "node:path"

import { readBounded } from "./find"

/** The most a `config` file may hold, in bytes (CL4 step 2). */
export const CONFIG_BYTES = 64 * 1024

/** What the uncommitted-changes check needs to know from the config. */
export type GitConfig = {
  /** `core.fileMode`: whether the executable bit of a file counts as a change. */
  readonly fileMode: boolean
}

/** The names, section and key lowercased as git keeps them, whose being set makes the reader give up (CL4 step 2). */
const GIVE_UP = new Set(["extensions.objectformat", "extensions.refstorage"])

/** What git's `isspace` takes as space, in the C locale. */
const isSpace = (c: string): boolean => /^[ \t\n\v\f\r]$/.test(c)
/** A character of a key or of a section's name (git's `iskeychar`). */
const isKeyChar = (c: string): boolean => /^[A-Za-z0-9-]$/.test(c)

/**
 * A value read as git reads a boolean (`git_parse_maybe_bool`): no `=` is
 * true, an empty value false, the words and whole numbers as git takes them.
 * Undefined for anything else, which git refuses.
 */
function booleanOf(value: string | null): boolean | undefined {
  if (value === null) return true
  const word = value.toLowerCase()
  if (word === "true" || word === "yes" || word === "on") return true
  if (word === "" || word === "false" || word === "no" || word === "off")
    return false
  const number = /^[+-]?(\d+)[kmg]?$/i.exec(value)
  return number === null ? undefined : /[1-9]/.test(number[1]!)
}

/** A parser over the bytes of one config file; `next` turns `\r\n` into `\n` and gives `\n` at the end, as git's `get_next_char` does. */
class Source {
  private at = 0
  eof = false
  constructor(private readonly text: string) {}

  next(): string {
    if (this.at >= this.text.length) {
      this.eof = true
      return "\n"
    }
    const c = this.text[this.at++]!
    if (c === "\r" && this.text[this.at] === "\n") return this.text[this.at++]!
    return c
  }
}

/** A section's header after its `[`, as git's `get_base_var` reads it: the stem with its `.`, or undefined when malformed. */
function header(source: Source): string | undefined {
  let name = ""
  for (;;) {
    const c = source.next()
    if (source.eof) return undefined
    if (c === "]") return name === "" ? undefined : `${name}.`
    if (c === "\n") return undefined
    if (isSpace(c)) break
    if (!isKeyChar(c) && c !== ".") return undefined
    name += c.toLowerCase()
  }
  // `[section "sub"]`: the subsection keeps its case.
  let c: string
  do {
    c = source.next()
    if (c === "\n") return undefined
  } while (isSpace(c))
  if (c !== '"' || name === "") return undefined
  let sub = ""
  for (;;) {
    let d = source.next()
    if (d === "\n") return undefined
    if (d === '"') break
    if (d === "\\") {
      d = source.next()
      if (d === "\n") return undefined
    }
    sub += d
  }
  return source.next() === "]" ? `${name}.${sub}.` : undefined
}

/** A value after its `=`, as git's `parse_value` reads it, or undefined when malformed. */
function value(source: Source): string | undefined {
  let quote = false
  let comment = false
  let text = ""
  let trimAt = -1
  for (;;) {
    let c = source.next()
    if (c === "\n") {
      if (quote) return undefined
      return trimAt >= 0 ? text.slice(0, trimAt) : text
    }
    if (comment) continue
    if (isSpace(c) && !quote) {
      if (trimAt < 0) trimAt = text.length
      if (text !== "") text += c
      continue
    }
    if (!quote && (c === ";" || c === "#")) {
      comment = true
      continue
    }
    trimAt = -1
    if (c === "\\") {
      c = source.next()
      if (c === "\n") continue
      const escaped = { t: "\t", b: "\b", n: "\n", "\\": "\\", '"': '"' }[c]
      if (escaped === undefined) return undefined
      text += escaped
      continue
    }
    if (c === '"') {
      quote = !quote
      continue
    }
    text += c
  }
}

/**
 * Every setting of a config text, as `[name, value]` (`value` null for a key
 * with no `=`), names lowercased but for a subsection. Undefined for a text
 * git calls a bad config.
 */
function settingsOf(text: string): [string, string | null][] | undefined {
  // A byte order mark at the very start is skipped, as git skips it.
  const source = new Source(text.replace(/^\xef\xbb\xbf/, ""))
  const found: [string, string | null][] = []
  let stem = ""
  let comment = false
  for (;;) {
    const c = source.next()
    if (c === "\n") {
      if (source.eof) return found
      comment = false
      continue
    }
    if (comment || isSpace(c)) continue
    if (c === "#" || c === ";") {
      comment = true
      continue
    }
    if (c === "[") {
      const read = header(source)
      if (read === undefined) return undefined
      stem = read
      continue
    }
    if (!/^[A-Za-z]$/.test(c) || stem === "") return undefined
    let key = c.toLowerCase()
    let d: string
    for (;;) {
      d = source.next()
      if (source.eof || !isKeyChar(d)) break
      key += d.toLowerCase()
    }
    while (d === " " || d === "\t") d = source.next()
    if (d === "\n") {
      found.push([stem + key, null])
      if (source.eof) return found
      continue
    }
    if (d !== "=") return undefined
    const read = value(source)
    if (read === undefined) return undefined
    found.push([stem + key, read])
    if (source.eof) return found
  }
}

/**
 * What a config text says, or undefined when the reader gives up: a setting
 * of `GIVE_UP`, `core.bare` true anywhere, a format above 1, or a text git
 * would refuse. The text is the file's bytes, one character each.
 */
export function configFrom(text: string): GitConfig | undefined {
  const settings = settingsOf(text)
  if (settings === undefined) return undefined
  let fileMode = true
  for (const [name, setting] of settings) {
    if (GIVE_UP.has(name)) return undefined
    if (name === "core.bare" && booleanOf(setting) !== false) return undefined
    if (name === "core.repositoryformatversion") {
      const version = setting === null ? undefined : /^\d+$/.exec(setting)
      if (!version || Number(version[0]) > 1) return undefined
    }
    if (name === "core.filemode") {
      const mode = booleanOf(setting)
      if (mode === undefined) return undefined
      fileMode = mode
    }
  }
  return { fileMode }
}

/**
 * The config of the repository whose common folder is `commonDir`, or
 * undefined when the reader gives up: past `CONFIG_BYTES`, not a regular
 * file, or `configFrom` gives up. A repository with no config is read with
 * git's defaults.
 */
export function readConfig(commonDir: string): GitConfig | undefined {
  const read = readBounded(join(commonDir, "config"), CONFIG_BYTES)
  if (read === "missing") return { fileMode: true }
  if (read === "unreadable") return undefined
  return configFrom(read.toString("latin1"))
}
