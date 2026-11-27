/**
 * The instructions zekno reads from a Dockerfile, in the forms BuildKit's
 * parser reads them (specs/016-build-from-source, contracts/cli.md CL3,
 * "Read"; FR-036a, FR-042), written in the project with no package (plan.md
 * item 8 (a)), as a port of the parts of BuildKit's `parser/line_parsers.go`
 * and `instructions/parse.go` that name an image, a variable, a remote file
 * or a port:
 *
 * - `ARG` before the first `FROM` (global) and in each stage;
 * - `FROM [--platform=…] ref [AS name]`, the name lowercased as BuildKit
 *   keeps it;
 * - `ENV` in both forms (`name=value …` and `name value`);
 * - `COPY --from`, `RUN --mount=…,from=` (comma-separated, with quotes) and
 *   `ADD [--checksum=…]` sources in shell and JSON form;
 * - `EXPOSE`;
 * - `ONBUILD`: the instruction it holds is read, marked as not run in the
 *   stage that holds it (plan.md item 17).
 *
 * Words are kept as written; `dockerfile/expand.ts` expands them in their
 * scope. Where BuildKit refuses an instruction, nothing is built, so the
 * reading only has to be no narrower than BuildKit's: a form BuildKit
 * refuses is read as far as it goes, never thrown on.
 */
import {
  type Command,
  type Directives,
  type Instruction,
  jsonList,
  lexDockerfile,
} from "./lex"
import { isSpace } from "./shell"

/** A name an `ARG` declares, and its default as written, null when it has none. */
export type ArgPair = { readonly key: string; readonly value: string | null }

/** A name an `ENV` sets, and its value as written. */
export type EnvPair = { readonly key: string; readonly value: string }

/** A mount of `RUN --mount`: its type (`bind` unless given) and its `from`, both null when BuildKit cannot read its fields. */
export type Mount = {
  readonly type: string | null
  readonly from: string | null
}

/** A command of a stage that zekno reads, with its first line and whether it is an `ONBUILD` trigger, not run here. */
export type StageCommand = {
  readonly line: number
  readonly onbuild: boolean
} & (
  | { readonly kind: "arg"; readonly pairs: readonly ArgPair[] }
  | { readonly kind: "env"; readonly pairs: readonly EnvPair[] }
  | {
      readonly kind: "copy"
      readonly from: string | null
      readonly sources: readonly string[]
    }
  | {
      readonly kind: "add"
      readonly checksum: string | null
      readonly sources: readonly string[]
    }
  | { readonly kind: "run"; readonly mounts: readonly Mount[] }
  | { readonly kind: "expose"; readonly ports: readonly string[] }
)

/** One stage: its `FROM` as written, and the commands after it. */
export type Stage = {
  readonly index: number
  /** Its `AS` name, lowercased, null when it has none. */
  readonly name: string | null
  /** The base name as written. */
  readonly base: string
  /** `--platform` as written, null when not given. */
  readonly platform: string | null
  readonly line: number
  readonly commands: readonly StageCommand[]
}

/** What zekno reads of a Dockerfile. */
export type DockerfileReading = {
  readonly directives: Directives
  /** The lines core's `isSyntaxLine` matches (CO6). */
  readonly syntaxLines: readonly number[]
  /** The `ARG`s before the first `FROM`, in order, each with its line. */
  readonly globalArgs: readonly (ArgPair & { readonly line: number })[]
  readonly stages: readonly Stage[]
}

/** BuildKit's `reWhitespace`. */
const WHITESPACE = /[\t\v\f\r ]+/

/** `parseStringsWhitespaceDelimited`: words between runs of spaces, quotes not read. */
const spaced = (args: string): string[] =>
  args === "" ? [] : args.split(WHITESPACE)

/**
 * `parseWords`: words split at spaces outside quotes, the quotes and the
 * escape character kept in them, as BuildKit splits `ARG` and `ENV` before
 * it expands each word.
 */
function parseWords(rest: string, escape: string): string[] {
  const words: string[] = []
  const chars = [...rest]
  let phase: "spaces" | "word" | "quote" = "spaces"
  let word = ""
  let quote = ""
  let blankOK = false
  for (let at = 0; at <= chars.length; at++) {
    let char = chars[at] ?? ""
    if (phase === "spaces") {
      if (at === chars.length) break
      if (isSpace(char)) continue
      phase = "word"
    }
    if (at === chars.length) {
      if (blankOK || word.length > 0) words.push(word)
      break
    }
    if (phase === "word") {
      if (isSpace(char)) {
        phase = "spaces"
        if (blankOK || word.length > 0) words.push(word)
        word = ""
        blankOK = false
        continue
      }
      if (char === "'" || char === '"') {
        quote = char
        blankOK = true
        phase = "quote"
      }
      if (char === escape) {
        if (at + 1 === chars.length) continue
        word += char
        char = chars[++at]!
      }
      word += char
      continue
    }
    if (char === quote) phase = "word"
    if (char === escape && quote !== "'") {
      if (at + 1 === chars.length) {
        phase = "word"
        continue
      }
      word += char
      char = chars[++at]!
    }
    word += char
  }
  return words
}

/** The value of a flag `--name=value` (BuildKit's `BFlags`, names in their case), the first when given twice; null when not given. */
function flagValue(flags: readonly string[], name: string): string | null {
  for (const flag of flags)
    if (flag.startsWith(`--${name}=`)) return flag.slice(name.length + 3)
  return null
}

/** The words of `COPY`'s or `ADD`'s arguments: the JSON array, whatever follows it left unread as BuildKit leaves it, or the words between spaces. */
function listOf(command: Command): string[] {
  if (!command.json) return spaced(command.args)
  return jsonList(command.args)!
}

/** A heredoc word among sources (`<<EOF`): content, not a path. */
const HEREDOC_SOURCE = /^[0-9]*<<-?[^<]+$/

/** The sources of `COPY` or `ADD`: every word but the last, the destination, heredocs left out. */
function sourcesOf(command: Command): string[] {
  return listOf(command)
    .slice(0, -1)
    .filter((source) => !HEREDOC_SOURCE.test(source))
}

/**
 * One record of comma-separated fields as Go's `encoding/csv` reads it, which
 * BuildKit reads a mount with: a field in double quotes may hold commas, `""`
 * stands for `"`; a quote anywhere else, or one not closed, is refused.
 */
function csvFields(text: string): string[] | undefined {
  if (text === "") return undefined
  const fields: string[] = []
  let at = 0
  for (;;) {
    if (text[at] === '"') {
      let field = ""
      at++
      for (;;) {
        const close = text.indexOf('"', at)
        if (close < 0) return undefined
        field += text.slice(at, close)
        at = close + 1
        if (text[at] !== '"') break
        field += '"'
        at++
      }
      fields.push(field)
      if (at === text.length) return fields
      if (text[at] !== ",") return undefined
      at++
      continue
    }
    const comma = text.indexOf(",", at)
    const field = comma < 0 ? text.slice(at) : text.slice(at, comma)
    if (field.includes('"')) return undefined
    fields.push(field)
    if (comma < 0) return fields
    at = comma + 1
  }
}

/** A mount's type and `from`, keys in any case, as BuildKit's `parseMount` reads them. */
function mountOf(value: string): Mount {
  const fields = csvFields(value)
  if (fields === undefined) return { type: null, from: null }
  let type = "bind"
  let from: string | null = null
  for (const field of fields) {
    const equals = field.indexOf("=")
    if (equals < 0) continue
    const key = field.slice(0, equals).toLowerCase()
    if (key === "type") type = field.slice(equals + 1)
    if (key === "from") from = field.slice(equals + 1)
  }
  return { type, from }
}

/** `ARG`'s pairs: each word a name, or a name, `=` and a default. */
function argPairs(args: string, escape: string): ArgPair[] {
  return parseWords(args, escape).map((word) => {
    const equals = word.indexOf("=")
    return equals < 0
      ? { key: word, value: null }
      : { key: word.slice(0, equals), value: word.slice(equals + 1) }
  })
}

/** `ENV`'s pairs, as BuildKit's `parseNameVal`: `name=value …`, or the old `name value` when the first word holds no `=`. */
function envPairs(args: string, escape: string): EnvPair[] {
  const words = parseWords(args, escape)
  if (words.length === 0) return []
  if (!words[0]!.includes("=")) {
    const space = WHITESPACE.exec(args)
    if (space === null) return []
    return [
      {
        key: args.slice(0, space.index),
        value: args.slice(space.index + space[0].length),
      },
    ]
  }
  return words
    .filter((word) => word.includes("="))
    .map((word) => {
      const equals = word.indexOf("=")
      return { key: word.slice(0, equals), value: word.slice(equals + 1) }
    })
}

/** The command a stage keeps for one instruction, or none for an instruction that names no image, variable or port. */
function stageCommand(
  command: Command,
  line: number,
  onbuild: boolean,
  escape: string
): StageCommand | undefined {
  const at = { line, onbuild }
  switch (command.keyword.toLowerCase()) {
    case "arg":
      return { ...at, kind: "arg", pairs: argPairs(command.args, escape) }
    case "env":
      return { ...at, kind: "env", pairs: envPairs(command.args, escape) }
    case "copy":
      return {
        ...at,
        kind: "copy",
        from: flagValue(command.flags, "from") || null,
        sources: sourcesOf(command),
      }
    case "add":
      return {
        ...at,
        kind: "add",
        checksum: flagValue(command.flags, "checksum") || null,
        sources: sourcesOf(command),
      }
    case "run":
      return {
        ...at,
        kind: "run",
        mounts: command.flags
          .filter((flag) => flag.startsWith("--mount="))
          .map((flag) => mountOf(flag.slice("--mount=".length))),
      }
    case "expose":
      return { ...at, kind: "expose", ports: spaced(command.args) }
    default:
      return undefined
  }
}

/** A stage from its `FROM`: `ref`, or `ref AS name` with `AS` in any case. */
function stageOf(
  instruction: Instruction,
  index: number
): Omit<Stage, "commands"> {
  const words = spaced(instruction.args)
  const named = words.length === 3 && words[1]!.toLowerCase() === "as"
  return {
    index,
    name: named ? words[2]!.toLowerCase() : null,
    base: words[0] ?? "",
    platform: flagValue(instruction.flags, "platform"),
    line: instruction.start,
  }
}

/**
 * What zekno reads of a Dockerfile's bytes. The lexer's stops (its bounds, a
 * directive BuildKit refuses, a heredoc line zekno cannot read) are thrown as
 * they are.
 */
export function readDockerfile(
  bytes: Uint8Array,
  file: string
): DockerfileReading {
  const lexed = lexDockerfile(bytes, file)
  const escape = lexed.directives.escape
  const globalArgs: (ArgPair & { line: number })[] = []
  const stages: Stage[] = []
  let commands: StageCommand[] | undefined
  for (const instruction of lexed.instructions) {
    const keyword = instruction.keyword.toLowerCase()
    if (keyword === "from") {
      commands = []
      stages.push({ ...stageOf(instruction, stages.length), commands })
      continue
    }
    if (commands === undefined) {
      if (keyword === "arg")
        for (const pair of argPairs(instruction.args, escape))
          globalArgs.push({ ...pair, line: instruction.start })
      continue
    }
    const read =
      instruction.onbuild === null
        ? stageCommand(instruction, instruction.start, false, escape)
        : stageCommand(instruction.onbuild, instruction.start, true, escape)
    if (read !== undefined) commands.push(read)
  }
  return {
    directives: lexed.directives,
    syntaxLines: lexed.syntaxLines,
    globalArgs,
    stages,
  }
}
