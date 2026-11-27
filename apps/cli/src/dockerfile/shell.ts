/**
 * BuildKit's shell lexer, as `frontend/dockerfile/shell/lex.go` reads a word
 * (specs/016-build-from-source, contracts/cli.md CL3, "Expansion"; FR-036a,
 * FR-042), written in the project with no package (plan.md item 8 (a)):
 * `$V`, `${V}`, `${V:-w}`, `${V:+w}`, `${V-w}`, `${V+w}`, single and double
 * quotes, the escape character, and the words a text splits into. The
 * scopes a Dockerfile's variables live in are `dockerfile/expand.ts`.
 *
 * Two readings use it:
 *
 * - zekno resolving a name (`forms: "listed"`): any other form, or a
 *   variable a base image might define, makes the result unresolvable, never
 *   guessed (CL3);
 * - the lexer finding heredocs (`forms: "all"`): BuildKit splits the line
 *   into words with no variable set, and every form is read as BuildKit reads
 *   it, but for those whose result zekno does not compute (`#`, `%`, `/`),
 *   which are `unclear`.
 *
 * A variable whose result is not used (the word of `${V:-w}` when `V` is set)
 * never makes the whole unresolvable: BuildKit reads it and drops it.
 */

/** What a variable is to the expansion: set to a value, not set, or not known to zekno (a base image might set it). */
export type Lookup =
  | { readonly kind: "set"; readonly value: string }
  | { readonly kind: "unset" }
  | { readonly kind: "unknown" }

/** The variables in scope, by name. */
export type Env = (name: string) => Lookup

/** No variable set: the environment BuildKit's lexer finds heredocs with. */
export const NO_VARIABLES: Env = () => ({ kind: "unset" })

/** How the lexer reads, as BuildKit's `Lex` options. */
export type LexMode = {
  /** The escape character, `\` or the backtick. */
  readonly escape: string
  /** Quotes are kept in the result. */
  readonly rawQuotes?: boolean
  /** Escape characters are kept in the result. */
  readonly rawEscapes?: boolean
  /** A variable not set is kept as written. */
  readonly skipUnset?: boolean
  /** `listed`: only the six forms CL3 lists are resolved; `all`: every form BuildKit knows. */
  readonly forms: "listed" | "all"
}

/**
 * Why a result cannot be had: `unknown`, a variable zekno cannot know (named);
 * `form`, a form CL3 does not list (`variable` named when the form has one);
 * `error`, a text BuildKit itself refuses; `unclear`, a form whose result
 * zekno does not compute.
 */
export type Unresolved =
  | { readonly why: "unknown"; readonly variable: string }
  | { readonly why: "form"; readonly variable: string | null }
  | { readonly why: "error" }
  | { readonly why: "unclear" }

/** A text processed: the whole result and its words, or why there is none. */
export type Processed =
  | { readonly ok: true; readonly result: string; readonly words: string[] }
  | ({ readonly ok: false } & Unresolved)

/** What BuildKit refuses: thrown inside the lexer and caught at its top. */
class LexError extends Error {}

/** A part of the text processed, with the first reason its value is not known, null when it is. */
type Part = { text: string; taint: Unresolved | null }

/** What Go's `unicode.IsSpace` takes as space. */
const SPACE =
  /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u
export const isSpace = (char: string): boolean => SPACE.test(char)
const isDigit = (char: string): boolean => /^\p{Nd}$/u.test(char)
const isLetter = (char: string): boolean => /^\p{L}$/u.test(char)

/** The special parameters of the shell, which BuildKit reads as one-character names. */
const SPECIAL = new Set(["@", "*", "#", "?", "-", "$", "!", "0"])

/** A name a variable can have: a special parameter or a number is not one. */
const isVariableName = (name: string): boolean =>
  /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(name)

/** Words, split at spaces outside quotes, as BuildKit's `wordsStruct` splits them. */
class Words {
  private word = ""
  private inWord = false
  private readonly list: string[] = []

  addChar(char: string): void {
    if (isSpace(char) && this.inWord) {
      if (this.word.length !== 0) {
        this.list.push(this.word)
        this.word = ""
        this.inWord = false
      }
    } else if (!isSpace(char)) this.addRawChar(char)
  }

  addRawChar(char: string): void {
    this.word += char
    this.inWord = true
  }

  addString(text: string): void {
    for (const char of text) this.addChar(char)
  }

  addRawString(text: string): void {
    this.word += text
    this.inWord = true
  }

  get(): string[] {
    if (this.word.length > 0) {
      this.list.push(this.word)
      this.word = ""
      this.inWord = false
    }
    return this.list
  }
}

/** One run of BuildKit's lexer over one text. */
class ShellWord {
  private at = 0
  private readonly chars: string[]
  private rawEscapes: boolean

  constructor(
    text: string,
    private readonly env: Env,
    private readonly mode: LexMode
  ) {
    this.chars = [...text]
    // Go's text scanner skips a byte order mark at the very start.
    if (this.chars[0] === "\ufeff") this.at = 1
    this.rawEscapes = mode.rawEscapes === true
  }

  private peek(): string | undefined {
    return this.chars[this.at]
  }

  private next(): string | undefined {
    return this.chars[this.at++]
  }

  /** The text up to `stop` (consumed), or to the end when `stop` is undefined, as `processStopOn`. */
  processStopOn(
    stop: string | undefined,
    rawEscapes: boolean
  ): Part & { words: string[] } {
    const saved = this.rawEscapes
    this.rawEscapes = rawEscapes
    try {
      let text = ""
      let taint: Unresolved | null = null
      const words = new Words()
      while (this.peek() !== undefined) {
        const char = this.peek()!
        if (stop !== undefined && char === stop) {
          this.next()
          return { text, taint, words: words.get() }
        }
        if (char === "$" || char === "'" || char === '"') {
          const part =
            char === "$"
              ? this.processDollar()
              : char === "'"
                ? { text: this.processSingleQuote(), taint: null }
                : this.processDoubleQuote()
          text += part.text
          taint ??= part.taint
          if (char === "$") words.addString(part.text)
          else words.addRawString(part.text)
          continue
        }
        let next = this.next()!
        if (next === this.mode.escape) {
          if (this.rawEscapes) {
            words.addRawChar(next)
            text += next
          }
          const escaped = this.next()
          if (escaped === undefined) break
          next = escaped
          words.addRawChar(next)
        } else words.addChar(next)
        text += next
      }
      if (stop !== undefined) throw new LexError()
      return { text, taint, words: words.get() }
    } finally {
      this.rawEscapes = saved
    }
  }

  /** `'…'`: every character as it is; no escape. */
  private processSingleQuote(): string {
    const raw = this.mode.rawQuotes === true
    const open = this.next()!
    let text = raw ? open : ""
    for (;;) {
      const char = this.next()
      if (char === undefined) throw new LexError()
      if (char === "'") return raw ? text + char : text
      text += char
    }
  }

  /** `"…"`: `$` expanded; the escape character escapes `"`, `$` and itself, and is kept before anything else. */
  private processDoubleQuote(): Part {
    const raw = this.mode.rawQuotes === true
    const open = this.next()!
    let text = raw ? open : ""
    let taint: Unresolved | null = null
    for (;;) {
      const peeked = this.peek()
      if (peeked === undefined) throw new LexError()
      if (peeked === '"') {
        const char = this.next()!
        return { text: raw ? text + char : text, taint }
      }
      if (peeked === "$") {
        const part = this.processDollar()
        text += part.text
        taint ??= part.taint
        continue
      }
      let char = this.next()!
      if (char === this.mode.escape) {
        if (this.rawEscapes) text += char
        const after = this.peek()
        if (after === undefined) continue
        if (after === '"' || after === "$" || after === this.mode.escape)
          char = this.next()!
      }
      text += char
    }
  }

  /** A name after `$` or `${`, as `processName`: letters, digits and `_`, or a number, or one special parameter. */
  private processName(): string {
    let name = ""
    while (this.peek() !== undefined) {
      const char = this.peek()!
      if (name === "" && isDigit(char)) {
        while (this.peek() !== undefined && isDigit(this.peek()!))
          name += this.next()
        return name
      }
      if (name === "" && SPECIAL.has(char)) return this.next()!
      if (!isLetter(char) && !isDigit(char) && char !== "_") break
      name += this.next()
    }
    return name
  }

  /** A variable's value where it is used whole (`$V`, `${V}`): `written` is kept when `skipUnset` and it is not set. */
  private valueOf(name: string, written: string): Part {
    if (this.mode.forms === "listed" && !isVariableName(name))
      return { text: "", taint: { why: "form", variable: null } }
    const found = this.env(name)
    if (found.kind === "unknown")
      return { text: "", taint: { why: "unknown", variable: name } }
    if (found.kind === "set") return { text: found.value, taint: null }
    return { text: this.mode.skipUnset === true ? written : "", taint: null }
  }

  /** `$…`, as `processDollar`. */
  private processDollar(): Part {
    this.next()
    if (this.peek() !== "{") {
      const name = this.processName()
      if (name === "") return { text: "$", taint: null }
      return this.valueOf(name, `$${name}`)
    }
    this.next()
    const first = this.peek()
    if (first === undefined || first === "{" || first === "}" || first === ":")
      throw new LexError()
    const name = this.processName()
    let char = this.next()
    let written = char ?? "\ufffd"
    if (char === "}") return this.valueOf(name, `\${${name}}`)
    if (char === "/") return this.replacement(name)
    let nullIsUnset = false
    if (char === ":") {
      nullIsUnset = true
      char = this.next()
      written += char ?? "\ufffd"
    } else if (!["+", "-", "?", "#", "%"].includes(char ?? ""))
      throw new LexError()
    const trims = char === "#" || char === "%"
    if (nullIsUnset && trims) throw new LexError()
    const word = this.processStopOn("}", trims)
    const listed = this.mode.forms === "listed"
    if (listed && (!isVariableName(name) || !["+", "-"].includes(char ?? "")))
      return { text: "", taint: { why: "form", variable: null } }
    const found = this.env(name)
    if (found.kind === "unknown")
      return { text: "", taint: { why: "unknown", variable: name } }
    const set = found.kind === "set"
    const value = set ? found.value : ""
    if (this.mode.skipUnset === true && !set)
      return { text: `\${${name}${written}${word.text}}`, taint: null }
    const empty = !set || (nullIsUnset && value === "")
    switch (char) {
      case "-":
        return empty ? word : { text: value, taint: null }
      case "+":
        return empty ? { text: "", taint: null } : word
      case "?":
        // BuildKit refuses a variable not set, or empty with `:`.
        if (!set || (nullIsUnset && value === "")) throw new LexError()
        return { text: value, taint: null }
      case "#":
      case "%":
        if (word.text === "") throw new LexError()
        return { text: "", taint: { why: "unclear" } }
      default:
        throw new LexError()
    }
  }

  /**
   * `${V/pattern/replacement}` and `${V//pattern/replacement}`: read whole;
   * kept as written when `skipUnset` and `V` is not set, as BuildKit keeps it
   * (one `/` of `//` lost, as there), else its result is not computed.
   */
  private replacement(name: string): Part {
    if (this.peek() === "/") this.next()
    const pattern = this.processStopOn("/", true)
    const replacement = this.processStopOn("}", true)
    if (this.mode.forms === "listed")
      return { text: "", taint: { why: "form", variable: null } }
    if (this.mode.skipUnset === true && this.env(name).kind !== "set")
      return {
        text: `\${${name}/${pattern.text}/${replacement.text}}`,
        taint: null,
      }
    return { text: "", taint: { why: "unclear" } }
  }
}

/**
 * A text processed as BuildKit's `ProcessWord` and `ProcessWords` process it:
 * the whole result (quotes and escapes taken off unless `mode` keeps them)
 * and its words, or why zekno has none.
 */
export function shellProcess(text: string, env: Env, mode: LexMode): Processed {
  try {
    const {
      text: result,
      taint,
      words,
    } = new ShellWord(text, env, mode).processStopOn(
      undefined,
      mode.rawEscapes === true
    )
    return taint === null
      ? { ok: true, result, words }
      : { ok: false, ...taint }
  } catch (error) {
    if (error instanceof LexError) return { ok: false, why: "error" }
    throw error
  }
}
