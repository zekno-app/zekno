/**
 * A strict JSON reader for the settings file (specs/010-app-settings,
 * contracts/settings-file.md, "The JSON it must be"), written for it rather
 * than `JSON.parse` the whole: `JSON.parse` keeps the last of a key written
 * twice and knows no lines, and every fault of the file must name its line.
 *
 * It reads RFC 8259 JSON and nothing looser: whitespace is space, tab, line
 * feed and carriage return; no comment, trailing comma, single quote, `NaN`
 * or `Infinity`; objects and lists at most `MAX_DEPTH` deep, checked as each
 * opens, so the reader never goes deeper; strings at most `MAX_STRING`
 * characters once read, counted as they are read. Objects become `Map`s in
 * the order written, so no key can reach an object's prototype
 * (`__proto__`, `constructor`) and a key that is a whole number keeps its
 * place. A number keeps the text it was written with.
 *
 * The text may be hostile (a cloned repository). This reader never puts any
 * piece of it into a fault: a fault is a line number, a kind, and for a key
 * written twice the line of the first. Every exception it could meet is
 * caught and turned into a fault.
 */

/** A JSON value as read: objects as `Map`s in the order written. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | ReadonlyMap<string, JsonValue>

/** Why a text is not JSON a settings file can be: where (a line) and what. Never a piece of the text. */
export type JsonFault = {
  line: number
  /** `syntax` SJ1, `twice` SJ2, `deep` SJ3, `long` SJ4, `top` SJ5. */
  kind: "syntax" | "twice" | "deep" | "long" | "top"
  /** For `twice`: the line of the key's first use. */
  first?: number
}

/** A text read: the value, the line of each key and list item, and the text of each number, by `pathKey`. */
export type JsonRead = {
  value: JsonValue
  lines: ReadonlyMap<string, number>
  numbers: ReadonlyMap<string, string>
}

/** The deepest objects and lists nest: the file, `services`, a service, a section, `plain`, and one more. */
export const MAX_DEPTH = 6
/** The most characters (code points) a key or a string holds once its escapes are read. */
export const MAX_STRING = 4096

/**
 * The key of a place in the value: the keys and list indexes on the way,
 * joined with `.`, a key's own `\` and `.` written `\\` and `\.` so that two
 * places never share a key (`services.web.deploy.memory`).
 */
export function pathKey(path: readonly (string | number)[]): string {
  return path
    .map((part) =>
      typeof part === "number"
        ? String(part)
        : part.replace(/[\\.]/g, (char) => `\\${char}`)
    )
    .join(".")
}

/** Thrown inside the reader to stop at a fault. */
class Stop {
  constructor(readonly fault: JsonFault) {}
}

/** A JSON number, by RFC 8259's grammar, read where the text is. */
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

/** What each one-character escape stands for. `\u` is read on its own. */
const ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x22, '"'],
  [0x5c, "\\"],
  [0x2f, "/"],
  [0x62, "\b"],
  [0x66, "\f"],
  [0x6e, "\n"],
  [0x72, "\r"],
  [0x74, "\t"],
])

const HEX4 = /^[0-9A-Fa-f]{4}$/

/** Reads `text` as one JSON value, which must be an object. See the file's first comment. */
export function readJson(text: string): JsonRead | JsonFault {
  let at = 0
  let line = 1
  const lines = new Map<string, number>()
  const numbers = new Map<string, string>()
  const stop = (kind: JsonFault["kind"], first?: number): Stop =>
    new Stop(first === undefined ? { line, kind } : { line, kind, first })

  /** Skips whitespace, counting lines: a line feed, a carriage return, or the two together, end a line. */
  const space = (): void => {
    for (;;) {
      const char = text.charCodeAt(at)
      if (char === 0x20 || char === 0x09) at++
      else if (char === 0x0a) {
        at++
        line++
      } else if (char === 0x0d) {
        at++
        if (text.charCodeAt(at) === 0x0a) at++
        line++
      } else return
    }
  }

  /** A string at `at` (its opening quote), its escapes read, at most `MAX_STRING` characters counted as they are read. */
  const string = (): string => {
    at++
    let out = ""
    let start = at
    let count = 0
    let highBefore = false
    /** Counts one UTF-16 unit: a low surrogate right after a high one is the same character. */
    const unit = (code: number): void => {
      if (highBefore && code >= 0xdc00 && code <= 0xdfff) {
        highBefore = false
        return
      }
      highBefore = code >= 0xd800 && code <= 0xdbff
      if (++count > MAX_STRING) throw stop("long")
    }
    for (;;) {
      if (at >= text.length) throw stop("syntax")
      const char = text.charCodeAt(at)
      if (char === 0x22) {
        out += text.slice(start, at)
        at++
        return out
      }
      if (char === 0x5c) {
        out += text.slice(start, at)
        const escape = text.charCodeAt(at + 1)
        let read: string
        if (escape === 0x75) {
          const hex = text.slice(at + 2, at + 6)
          if (!HEX4.test(hex)) throw stop("syntax")
          read = String.fromCharCode(Number.parseInt(hex, 16))
          at += 6
        } else {
          const simple = ESCAPES.get(escape)
          if (simple === undefined) throw stop("syntax")
          read = simple
          at += 2
        }
        unit(read.charCodeAt(0))
        out += read
        start = at
        continue
      }
      // A control character, a line break among them, cannot stand in a string unescaped.
      if (char < 0x20) throw stop("syntax")
      unit(char)
      at++
    }
  }

  const number = (path: readonly (string | number)[]): number => {
    NUMBER.lastIndex = at
    const found = NUMBER.exec(text)?.[0]
    if (found === undefined) throw stop("syntax")
    at += found.length
    numbers.set(pathKey(path), found)
    return Number(found)
  }

  const word = <T>(name: string, meaning: T): T => {
    if (!text.startsWith(name, at)) throw stop("syntax")
    at += name.length
    return meaning
  }

  const object = (
    path: readonly (string | number)[],
    depth: number
  ): ReadonlyMap<string, JsonValue> => {
    if (depth > MAX_DEPTH) throw stop("deep")
    at++
    const members = new Map<string, JsonValue>()
    const seen = new Map<string, number>()
    space()
    if (text.charCodeAt(at) === 0x7d) {
      at++
      return members
    }
    for (;;) {
      space()
      if (text.charCodeAt(at) !== 0x22) throw stop("syntax")
      const keyLine = line
      const key = string()
      // Keys are compared once their escapes are read: "a" and "a" are the same name.
      const first = seen.get(key)
      if (first !== undefined) throw stop("twice", first)
      seen.set(key, keyLine)
      space()
      if (text.charCodeAt(at) !== 0x3a) throw stop("syntax")
      at++
      space()
      const inner = [...path, key]
      lines.set(pathKey(inner), keyLine)
      members.set(key, value(inner, depth))
      space()
      const next = text.charCodeAt(at)
      at++
      if (next === 0x7d) return members
      if (next !== 0x2c) {
        at--
        throw stop("syntax")
      }
    }
  }

  const list = (
    path: readonly (string | number)[],
    depth: number
  ): readonly JsonValue[] => {
    if (depth > MAX_DEPTH) throw stop("deep")
    at++
    const items: JsonValue[] = []
    space()
    if (text.charCodeAt(at) === 0x5d) {
      at++
      return items
    }
    for (;;) {
      space()
      const inner = [...path, items.length]
      lines.set(pathKey(inner), line)
      items.push(value(inner, depth))
      space()
      const next = text.charCodeAt(at)
      at++
      if (next === 0x5d) return items
      if (next !== 0x2c) {
        at--
        throw stop("syntax")
      }
    }
  }

  const value = (
    path: readonly (string | number)[],
    depth: number
  ): JsonValue => {
    const char = text.charCodeAt(at)
    if (char === 0x7b) return object(path, depth + 1)
    if (char === 0x5b) return list(path, depth + 1)
    if (char === 0x22) return string()
    if (char === 0x2d || (char >= 0x30 && char <= 0x39)) return number(path)
    if (char === 0x74) return word("true", true)
    if (char === 0x66) return word("false", false)
    if (char === 0x6e) return word("null", null)
    throw stop("syntax")
  }

  try {
    space()
    if (at >= text.length) throw stop("syntax")
    const top = value([], 0)
    space()
    if (at < text.length) throw stop("syntax")
    if (!(top instanceof Map)) return { line: 1, kind: "top" }
    return { value: top, lines, numbers }
  } catch (error) {
    if (error instanceof Stop) return error.fault
    // Nothing above throws but `Stop`. Were it to, the place is named by its line, as any other fault.
    return { line, kind: "syntax" }
  }
}
