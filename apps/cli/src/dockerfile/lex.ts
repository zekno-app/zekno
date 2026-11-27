/**
 * A Dockerfile cut into instructions as BuildKit's parser cuts it
 * (specs/016-build-from-source, contracts/cli.md CL3, "Lexing"; FR-042),
 * written in the project with no package (plan.md item 8 (a)), as a port of
 * BuildKit's `frontend/dockerfile/parser/parser.go`:
 *
 * - directives at the very top (`syntax`, `escape`, `check`, any case), read
 *   until the first line that is not one; one repeated is refused, as
 *   BuildKit refuses it;
 * - the escape character, `\` or the backtick, which continues a line;
 * - continuations, with comment and empty lines inside them dropped;
 * - heredocs of `RUN`, `COPY` and `ADD` (`<<WORD`, `<<-WORD`, quoted forms),
 *   whose lines are never read as instructions.
 *
 * The file is held to 1 MiB and 20,000 lines. Apart from the lexer, core's
 * `isSyntaxLine` is applied to every line, wherever it stands, as the runner
 * applies it (core.md CO6; RB4), so a `# syntax=` line BuildKit reads as a
 * comment is still found.
 *
 * Its stops have no row in design/lines.md yet (T156): until then the text
 * said is the id (FR-092), exit status 1.
 */
import { isSyntaxLine } from "@workspace/core"

import { CliError } from "../cli/errors"
import { isSpace, NO_VARIABLES, shellProcess } from "./shell"

/** The most a Dockerfile may hold, in bytes (CL3). */
export const DOCKERFILE_BYTES = 1024 * 1024

/** The most lines a Dockerfile may have (CL3). */
export const DOCKERFILE_LINES = 20_000

/**
 * A stop of the Dockerfile, with no row in design/lines.md yet (T156):
 *
 * - `dockerfile_size`: past its `bytes` or its `lines`;
 * - `dockerfile_directive`: a directive `repeated`, or an `escape` that is
 *   neither `\` nor the backtick, both of which BuildKit refuses;
 * - `dockerfile_heredoc`: a line that may start a heredoc, whose words
 *   BuildKit finds with a form zekno does not compute (`${V#…}`, `${V%…}`,
 *   `${V/…}`), so which lines are instructions cannot be known.
 *
 * `at` is the line, from 1.
 */
export type OwnDockerfileLine =
  | { id: "dockerfile_size"; why: "bytes" | "lines"; file: string }
  | {
      id: "dockerfile_directive"
      why: "repeated" | "escape"
      name: string
      file: string
      at: number
    }
  | { id: "dockerfile_heredoc"; file: string; at: number }

/** A stop before signing, exit status 1 (CL11). Its message is its id until T156. */
export class DockerfileStop extends CliError {
  constructor(readonly line: OwnDockerfileLine) {
    super(line.id)
  }
}

/** The directives at the top of a Dockerfile; `escape` is `\` when none is given. */
export type Directives = {
  readonly syntax: string | null
  readonly escape: "\\" | "`"
  readonly check: string | null
}

/** A heredoc of an instruction: its name, whether `<<-` drops leading tabs, whether its content expands, its lines. */
export type Heredoc = {
  readonly name: string
  readonly chomp: boolean
  readonly expand: boolean
  readonly content: string
}

/** One instruction's words, as `splitCommand` and `extractBuilderFlags` cut them. */
export type Command = {
  /** The keyword as written, in its case. */
  readonly keyword: string
  /** Leading `--name=value` flags, their quotes and escapes taken off. */
  readonly flags: readonly string[]
  /** The rest after the flags, trimmed. */
  readonly args: string
  /** The rest is a JSON array of strings, the exec form BuildKit reads for `RUN`, `COPY` and `ADD`. */
  readonly json: boolean
}

/** One instruction of the file. */
export type Instruction = Command & {
  /** For `ONBUILD`, the instruction it holds, else null. */
  readonly onbuild: Command | null
  /** Its first and last line in the file, from 1: continuations and heredocs included. */
  readonly start: number
  readonly end: number
  readonly heredocs: readonly Heredoc[]
}

/** A Dockerfile cut into instructions. */
export type Lexed = {
  readonly directives: Directives
  readonly instructions: readonly Instruction[]
  /** The lines core's `isSyntaxLine` matches, wherever they stand, from 1 (CO6). */
  readonly syntaxLines: readonly number[]
}

/** Go's `trimNewline`: line ends at the end dropped. */
const trimNewline = (text: string): string => text.replace(/[\r\n]+$/, "")

/** Go's `trimLeadingWhitespace`: Unicode spaces at the start dropped. */
function trimLeading(text: string): string {
  let at = 0
  for (const char of text) {
    if (!isSpace(char)) break
    at += char.length
  }
  return text.slice(at)
}

/** Go's `strings.TrimSpace`. */
function trimSpace(text: string): string {
  const chars = [...trimLeading(text)]
  while (chars.length > 0 && isSpace(chars.at(-1)!)) chars.pop()
  return chars.join("")
}

/** Whether a line is a comment to BuildKit: `#` first, after spaces. */
const isComment = (line: string): boolean =>
  trimLeading(trimNewline(line)).startsWith("#")

/** BuildKit's directive pattern, Go's `\s` and `.` written out. */
const DIRECTIVE =
  /^#[\t\n\f\r ]*([a-zA-Z][a-zA-Z0-9]*)[\t\n\f\r ]*=[\t\n\f\r ]*([^\n]+?)[\t\n\f\r ]*$/

/** Go's `\d`: an ASCII digit. */
const HEREDOC = /^([0-9]*)<<(-?)([^<]*)$/

/**
 * `extractBuilderFlags`: the leading words that start `--`, quotes and
 * escapes taken off, and the rest. BuildKit reads this byte by byte, so a
 * byte past ASCII is read as the Latin-1 character of that value, as here.
 */
function extractFlags(line: string): { args: string; flags: string[] } {
  const bytes = new TextEncoder().encode(line)
  const charAt = (at: number) => String.fromCharCode(bytes[at]!)
  const flags: string[] = []
  let phase: "spaces" | "word" | "quote" = "spaces"
  let word = ""
  let quote = ""
  let blankOK = false
  for (let at = 0; at <= bytes.length; at++) {
    const char = at < bytes.length ? charAt(at) : ""
    if (phase === "spaces") {
      if (at === bytes.length) break
      if (isSpace(char)) continue
      if (char !== "-" || at + 1 === bytes.length || charAt(at + 1) !== "-")
        return { args: new TextDecoder().decode(bytes.subarray(at)), flags }
      phase = "word"
    }
    if (at === bytes.length) {
      if (word !== "--" && (blankOK || word.length > 0)) flags.push(word)
      break
    }
    if (phase === "word") {
      if (isSpace(char)) {
        phase = "spaces"
        if (word === "--")
          return { args: new TextDecoder().decode(bytes.subarray(at)), flags }
        if (blankOK || word.length > 0) flags.push(word)
        word = ""
        blankOK = false
        continue
      }
      if (char === "'" || char === '"') {
        quote = char
        blankOK = true
        phase = "quote"
        continue
      }
      if (char === "\\") {
        if (at + 1 === bytes.length) continue
        at++
      }
      word += charAt(at)
      continue
    }
    if (char === quote) {
      phase = "word"
      continue
    }
    if (char === "\\") {
      if (at + 1 === bytes.length) {
        phase = "word"
        continue
      }
      at++
    }
    word += charAt(at)
  }
  return { args: "", flags }
}

/** Where the JSON array at the start of `text` ends (one past its `]`), outside its strings; undefined when it does not end. */
function arrayEnd(text: string): number | undefined {
  let depth = 0
  let inString = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (inString) {
      if (char === "\\") at++
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === "[") depth++
    else if (char === "]" && --depth === 0) return at + 1
  }
  return undefined
}

/**
 * The JSON array of strings arguments start with, as BuildKit's `parseJSON`
 * reads it, or undefined for the shell form. BuildKit decodes with Go's
 * `json.Decoder`, which reads the first JSON value and leaves the rest
 * unread, so `ADD ["https://…", "/x"] x` is the JSON form there, and is read
 * here as BuildKit builds it (CL3; FR-042).
 */
export function jsonList(args: string): string[] | undefined {
  const rest = trimLeading(args)
  if (!rest.startsWith("[")) return undefined
  const end = arrayEnd(rest)
  if (end === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(rest.slice(0, end))
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? (parsed as string[])
      : undefined
  } catch {
    return undefined
  }
}

/** Whether arguments are in the JSON form, as BuildKit's `parseJSON` takes them (`jsonList`). */
const isJsonArray = (args: string): boolean => jsonList(args) !== undefined

/** `splitCommand`: the keyword, then flags and arguments. */
function commandOf(line: string): Command {
  const trimmed = trimSpace(line)
  const space = /[\t\v\f\r ]+/.exec(trimmed)
  if (space === null)
    return { keyword: trimmed, flags: [], args: "", json: false }
  const { args, flags } = extractFlags(
    trimmed.slice(space.index + space[0].length)
  )
  const rest = trimSpace(args)
  return {
    keyword: trimmed.slice(0, space.index),
    flags,
    args: rest,
    json: isJsonArray(rest),
  }
}

/** Instructions whose lines may hold heredocs, when not in the JSON form. */
const HEREDOC_KEYWORDS = new Set(["add", "copy", "run"])

/**
 * The heredocs a line starts, as `heredocsFromLine` finds them: its words,
 * with no variable set, each `[n]<<[-]word` among them. A word BuildKit
 * cannot read gives none, as there; a form whose result zekno does not
 * compute is a stop.
 */
function heredocsOf(
  line: string,
  stop: () => DockerfileStop
): Omit<Heredoc, "content">[] {
  const words = shellProcess(line, NO_VARIABLES, {
    escape: "\\",
    rawQuotes: true,
    rawEscapes: true,
    forms: "all",
  })
  if (!words.ok) {
    if (words.why === "unclear") throw stop()
    return []
  }
  const found: Omit<Heredoc, "content">[] = []
  for (const word of words.words) {
    const match = HEREDOC.exec(word)
    if (match === null || match[3] === "") continue
    const read = (rawQuotes: boolean) =>
      shellProcess(match[3]!, NO_VARIABLES, {
        escape: "\\",
        rawQuotes,
        skipUnset: true,
        forms: "all",
      })
    const quoteless = read(false)
    const quoted = read(true)
    // BuildKit refuses the whole file here; nothing of it is built.
    if (!quoteless.ok || !quoted.ok) continue
    if (quoteless.words.length !== 1 || quoted.words.length !== 1) continue
    found.push({
      name: quoteless.words[0]!,
      chomp: match[2] === "-",
      expand: quoted.words[0] === quoteless.words[0],
    })
  }
  return found
}

/**
 * The directives, instructions and `# syntax=` lines of a Dockerfile's
 * bytes. A file past its bounds, a directive BuildKit refuses, or a heredoc
 * line zekno cannot read as BuildKit does is a stop.
 */
export function lexDockerfile(bytes: Uint8Array, file: string): Lexed {
  if (bytes.length > DOCKERFILE_BYTES)
    throw new DockerfileStop({ id: "dockerfile_size", why: "bytes", file })
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  const physical = text.split("\n")
  if (physical.at(-1) === "") physical.pop()
  if (physical.length > DOCKERFILE_LINES)
    throw new DockerfileStop({ id: "dockerfile_size", why: "lines", file })
  const lines = physical.map((line, at) => ({
    line,
    newline: at < physical.length - 1 || text.endsWith("\n"),
  }))
  const syntaxLines = text
    .split("\n")
    .flatMap((line, at) => (isSyntaxLine(line) ? [at + 1] : []))

  const directives: {
    syntax: string | null
    escape: "\\" | "`"
    check: string | null
  } = { syntax: null, escape: "\\", check: null }
  const seen = new Set<string>()
  let directivesDone = false
  const directive = (token: string, at: number) => {
    if (directivesDone) return
    const match = DIRECTIVE.exec(token)
    const name = match?.[1]!.toLowerCase()
    if (name !== "syntax" && name !== "escape" && name !== "check") {
      directivesDone = true
      return
    }
    if (seen.has(name))
      throw new DockerfileStop({
        id: "dockerfile_directive",
        why: "repeated",
        name,
        file,
        at,
      })
    seen.add(name)
    const value = match![2]!
    if (name === "escape") {
      if (value !== "\\" && value !== "`")
        throw new DockerfileStop({
          id: "dockerfile_directive",
          why: "escape",
          name,
          file,
          at,
        })
      directives.escape = value
    } else directives[name] = value
  }
  const continued = (line: string): [string, boolean] => {
    const pattern = new RegExp(
      `${directives.escape === "`" ? "`" : "\\\\"}[ \\t]*$`
    )
    return pattern.test(line)
      ? [line.replace(pattern, ""), false]
      : [line, true]
  }

  const instructions: Instruction[] = []
  let index = 0
  while (index < lines.length) {
    let raw = lines[index]!.line
    if (index === 0) raw = raw.replace(/^\ufeff/, "")
    index++
    const start = index
    const token = trimLeading(trimNewline(raw))
    directive(token, start)
    let [line, ended] = continued(isComment(token) ? "" : token)
    if (ended && line === "") continue
    while (!ended && index < lines.length) {
      const next = lines[index++]!.line
      if (isComment(next) || trimLeading(trimNewline(next)) === "") continue
      const [more, end] = continued(trimNewline(next))
      line += more
      ended = end
    }
    const command = commandOf(line)
    const onbuild =
      command.keyword.toLowerCase() === "onbuild" && command.args !== ""
        ? commandOf(command.args)
        : null
    const holder = onbuild ?? command
    const heredocs: Heredoc[] = []
    if (
      HEREDOC_KEYWORDS.has(holder.keyword.toLowerCase()) &&
      !holder.json &&
      line.includes("<<")
    ) {
      const stop = () =>
        new DockerfileStop({ id: "dockerfile_heredoc", file, at: start })
      reading: for (const heredoc of heredocsOf(line, stop)) {
        let content = ""
        while (index < lines.length) {
          const next = lines[index++]!
          let end = trimNewline(next.line)
          if (heredoc.chomp) end = end.replace(/^\t+/, "")
          if (end === heredoc.name) {
            heredocs.push({ ...heredoc, content })
            continue reading
          }
          content += next.newline ? `${next.line}\n` : next.line
        }
        // BuildKit refuses a heredoc with no end: the rest of the file is its content, and nothing is built.
        break
      }
    }
    instructions.push({ ...command, onbuild, start, end: index, heredocs })
  }
  return { directives, instructions, syntaxLines }
}
