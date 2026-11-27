/**
 * The patterns of an ignore file, compiled and matched as Docker's
 * `patternmatcher` (moby/patternmatcher) compiles and matches them, and the
 * folders fsutil's walk enters (specs/016-build-from-source, contracts/cli.md
 * CL2, "Matching"; FR-013). Written in the project with no package (plan.md
 * item 8 (a)); `pack/ignore.ts` chooses and reads the file.
 *
 * `patternmatcher` turns most patterns into a Go regexp, character by
 * character, without knowing what a class is. A pattern is taken only where
 * the same regexp, rebuilt for JavaScript, reads every path as Go's does;
 * anything else is refused by its caller, never guessed (CL2: "A class zekno
 * cannot reproduce exactly ... is refused before signing").
 */

/** What Go's `unicode.IsSpace` takes as space, which `strings.TrimSpace` trims. */
const GO_SPACE =
  "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]"
const TRIM = new RegExp(`^${GO_SPACE}+|${GO_SPACE}+$`, "g")

/** A text with Go's spaces trimmed at both ends, as `strings.TrimSpace`. */
export const trimSpace = (text: string): string => text.replace(TRIM, "")

/**
 * A path cleaned as Go's `filepath.Clean` cleans it on Linux: one `/` between
 * parts, `.` parts dropped, a `..` taking the part before it, a rooted `..`
 * dropped, no `/` at the end but for the root, `.` for nothing.
 */
export function cleanPath(path: string): string {
  if (path === "") return "."
  const rooted = path.startsWith("/")
  const kept: string[] = []
  // How many leading `..` an unrooted path keeps: they are never taken back.
  let backs = 0
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      if (kept.length > backs) kept.pop()
      else if (!rooted) {
        kept.push("..")
        backs++
      }
      continue
    }
    kept.push(part)
  }
  const joined = kept.join("/")
  if (rooted) return `/${joined}`
  return joined === "" ? "." : joined
}

/** How `patternmatcher` compares a pattern with a path: the pattern's text whole, its start, its end, or a regexp. */
export type MatchKind = "exact" | "prefix" | "suffix" | "regexp"

/** One pattern as `patternmatcher.New` keeps it. */
export type IgnorePattern = {
  /** The pattern after cleaning, without its `!`. */
  readonly cleaned: string
  /** An exception: `!` brings back what an earlier pattern left out. */
  readonly exception: boolean
  /** Its line in the ignore file. */
  readonly line: number
  readonly kind: MatchKind
  /** For a `regexp` pattern: Go's regexp, rebuilt so JavaScript reads it the same way. */
  readonly regexp?: RegExp
}

/** The compiled patterns of one ignore file. */
export type PatternRules = {
  readonly patterns: readonly IgnorePattern[]
  /** fsutil's `onlyPrefixExcludeExceptions`: no exception holds a wildcard, but for a trailing `/*` or `/**`. */
  readonly onlyPrefixExceptions: boolean
}

/** Why a pattern cannot be taken: a class or an escape Go reads otherwise, a pattern Docker refuses, a text Go's scanner changes. */
export type Refusal = "class" | "escape" | "syntax" | "text"

/** A character as a JavaScript regexp reads it literally, with the `u` flag, inside a class or out of it. */
const literal = (char: string): string =>
  `\\u{${char.codePointAt(0)!.toString(16)}}`

/**
 * A class after its `[`, from `chars[at]`: as Go's regexp and
 * `filepath.Match` both read it, rebuilt for JavaScript, and where it ends.
 * Only classes both read alike are taken: an optional leading `^`, then single
 * characters and ranges, none of them `\`, `[`, `]`, `-`, `*` or `?`, a range
 * not reversed. Anything else is refused: `syntax` when Docker refuses the
 * pattern itself, `class` when it would read it otherwise than it is written
 * (`[[:digit:]]`, `[*]`, `[\d]`).
 */
function classAt(
  chars: readonly string[],
  at: number
): { source: string; next: number } | Refusal {
  let index = at
  const negated = chars[index] === "^"
  if (negated) index++
  const items: string[] = []
  const plain = (char: string | undefined): Refusal | undefined => {
    if (char === undefined || char === "]" || char === "-") return "syntax"
    if (char === "\\" || char === "[" || char === "*" || char === "?")
      return "class"
    return undefined
  }
  for (;;) {
    const char = chars[index]
    if (char === "]" && items.length > 0) break
    const refused = plain(char)
    if (refused !== undefined) return refused
    index++
    if (chars[index] !== "-") {
      items.push(literal(char!))
      continue
    }
    const high = chars[index + 1]
    const refusedHigh = plain(high)
    if (refusedHigh !== undefined) return refusedHigh
    if (high!.codePointAt(0)! < char!.codePointAt(0)!) return "class"
    items.push(`${literal(char!)}-${literal(high!)}`)
    index += 2
  }
  return { source: `[${negated ? "^" : ""}${items.join("")}]`, next: index + 1 }
}

/** An ASCII character that is neither a letter nor a digit: Go's regexp reads it escaped as itself. */
const ESCAPES_AS_ITSELF = /^[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]$/

/**
 * One cleaned pattern compiled as `patternmatcher`'s `compile` does: the kind
 * of comparison it decides, and for a regexp the same regexp rebuilt for
 * JavaScript, Go's `.` written as what it matches (anything but `\n`). A
 * pattern zekno cannot rebuild exactly gives why.
 */
export function compilePattern(
  pattern: string
): { kind: MatchKind; regexp?: RegExp } | Refusal {
  // Go's scanner skips a byte order mark at the start of a regexp, never in a plain comparison.
  if (pattern.includes("\ufeff")) return "text"
  const chars = [...pattern]
  let kind: MatchKind = "exact"
  let source = "^"
  for (let at = 0, step = 0; at < chars.length; step++) {
    const char = chars[at++]!
    if (char === "*") {
      if (chars[at] === "*") {
        at++
        // `**/` is read as `**`.
        if (chars[at] === "/") at++
        if (at === chars.length) {
          if (kind === "exact") kind = "prefix"
          else {
            source += "[^\\n]*"
            kind = "regexp"
          }
        } else {
          source += "(?:[^\\n]*/)?"
          kind = "regexp"
        }
        if (step === 0) kind = "suffix"
      } else {
        source += "[^/]*"
        kind = "regexp"
      }
    } else if (char === "?") {
      source += "[^/]"
      kind = "regexp"
    } else if (char === "\\") {
      const next = chars[at++]
      if (next === undefined) return "syntax"
      if (!ESCAPES_AS_ITSELF.test(next)) return "escape"
      source += literal(next)
      kind = "regexp"
    } else if (char === "[") {
      const read = classAt(chars, at)
      if (typeof read === "string") return read
      source += read.source
      at = read.next
      kind = "regexp"
    } else if (char === "]") {
      source += literal(char)
      kind = "regexp"
    } else if (char === "^") source += "^"
    // Any other character is itself, `.+()|{}$` among them, which patternmatcher escapes for Go's regexp.
    else source += literal(char)
  }
  return kind === "regexp"
    ? { kind, regexp: new RegExp(`${source}$`, "u") }
    : { kind }
}

/** A pattern without one trailing `/**`, then one trailing `/*`, as fsutil looks at exceptions. */
function withoutTrailingGlob(pattern: string): string {
  let text = pattern
  if (text.endsWith("/**")) text = text.slice(0, -3)
  if (text.endsWith("/*")) text = text.slice(0, -2)
  return text
}

/** fsutil's `onlyPrefixExcludeExceptions` for these patterns: no exception holds `*`, `[`, `]`, `?`, `^` or `\` but in a trailing `/*` or `/**`. */
export const onlyPrefixExceptions = (
  patterns: readonly IgnorePattern[]
): boolean =>
  !patterns.some(
    (pattern) =>
      pattern.exception &&
      /[*[\]?^\\]/.test(withoutTrailingGlob(pattern.cleaned))
  )

/** Whether one pattern matches one path, as `Pattern.match` decides. */
function matches(pattern: IgnorePattern, path: string): boolean {
  switch (pattern.kind) {
    case "exact":
      return path === pattern.cleaned
    case "prefix":
      return path.startsWith(pattern.cleaned.slice(0, -2))
    case "suffix": {
      const suffix = pattern.cleaned.slice(2)
      return (
        path.endsWith(suffix) ||
        (suffix.startsWith("/") && path === suffix.slice(1))
      )
    }
    case "regexp":
      return pattern.regexp!.test(path)
  }
}

/** Which patterns matched a folder or one above it, passed to the entries in it (patternmatcher's `MatchInfo`). */
export type MatchInfo = readonly boolean[]

/**
 * Whether a path of the folder sent (`/` between its parts, no `./`) is left
 * out, as `MatchesUsingParentResults` decides: the last pattern that matches
 * it or one of its parents wins. With `parent`, the results of the folder it
 * is in, a pattern that matched there counts as matching here, and a pattern
 * is otherwise matched against this path alone; with none, against the path
 * and each folder above it. `info` is what to pass to the entries under it.
 */
export function matchPath(
  rules: Pick<PatternRules, "patterns">,
  path: string,
  parent?: MatchInfo
): { excluded: boolean; info: MatchInfo } {
  const given = parent !== undefined && parent.length > 0
  const info = rules.patterns.map(() => false)
  let matched = false
  rules.patterns.forEach((pattern, index) => {
    let match = given ? parent[index] === true : false
    if (!match) {
      // An exception cannot change a path not left out, nor a pattern one left out.
      if (pattern.exception !== matched) return
      match = matches(pattern, path)
      if (!match && !given) {
        const above = cleanPath(path.slice(0, path.lastIndexOf("/") + 1))
        if (above !== ".") {
          const parts = above.split("/")
          match = parts.some((_, at) =>
            matches(pattern, parts.slice(0, at + 1).join("/"))
          )
        }
      }
    }
    info[index] = match
    if (match) matched = !pattern.exception
  })
  return { excluded: matched, info }
}

/**
 * Whether the walk goes into a folder the rules leave out, as fsutil decides:
 * when an exception holds a wildcard, every such folder is walked, since what
 * is under it may come back (check L17 saw BuildKit send a file two folders
 * down that `**` left out and an exception with a wildcard brought back);
 * else only a folder an exception's path starts with, `/` after it (CL2).
 * Nothing under it is sent unless the rules bring it back.
 */
export function entersExcluded(rules: PatternRules, folder: string): boolean {
  if (!rules.onlyPrefixExceptions) return true
  return rules.patterns.some(
    (pattern) =>
      pattern.exception && `${pattern.cleaned}/`.startsWith(`${folder}/`)
  )
}
