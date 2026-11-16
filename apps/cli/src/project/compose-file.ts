/**
 * The values a Compose file expects from its environment (research R12):
 * what the app compares with an app's secrets before a deploy, to list the
 * ones not set yet (FR-024).
 *
 * The file is the developer's, but it can come from anywhere, such as a
 * cloned repository, so it is read as untrusted text: its size is limited
 * and its aliases are counted before it is parsed (Bun's parser copies what
 * an alias stands for, so a small file of many aliases to one long string
 * becomes gigabytes), the walk over what was parsed is bounded, and a file
 * that cannot be parsed or walked within the bounds yields no names, never
 * an error. At most `MAX_NAMES` names are given. The names are only ever
 * shown and compared with secret names, and each is held to the secret-name
 * pattern first.
 *
 * Which names count as expected and have no value:
 *
 * - `environment` as a list: `- NAME` (no `=`). Not `- NAME=value`, nor
 *   `- NAME=`, which sets it to nothing on purpose.
 * - `environment` as a map: `NAME:` with no value (YAML null, also `~` and
 *   `null`). Not `NAME: value`, nor `NAME: ""`.
 * - In any string value of the file: `${NAME}`, `$NAME`, and `${NAME:?err}`
 *   and `${NAME?err}`, which make Compose stop when NAME is not set. Not
 *   `${NAME:-default}` or `${NAME-default}` (there is a default), and not
 *   `${NAME:+alt}` or `${NAME+alt}` (only used when NAME is set). The text of
 *   a default or an alternative is not read: it is used only in one of those
 *   two cases. `$$` is a dollar sign, not a variable.
 * - `env_file` is not read, and keys are not read for `$`.
 * - Reserved names (PATH, DOCKER_HOST, COMPOSE_*, ...) are left out: the
 *   runner never takes them from a secret.
 *
 * The names come in this order: those a service's `environment` lists with
 * no value, service by service, then those used in values, as the parsed
 * file gives them (document order, but for keys that are whole numbers,
 * which JavaScript puts first). Past `MAX_NAMES`, the rest are left out.
 */
import { isReservedSecretName, LIMITS, SECRET_NAME } from "@workspace/core"

/** The most of a Compose file that is read: the same limit a deploy has. */
export const COMPOSE_READ_BYTES = LIMITS.composeBytes
/** The most nodes walked. A Compose file has a few hundred; more is aliases expanding. */
export const MAX_NODES = 100_000
/** The deepest a node may be. A Compose file is a handful of levels deep. */
export const MAX_DEPTH = 64
/** The most characters of strings read for `$`. Without aliases a file cannot have more than its size. */
export const MAX_CHARS = 4 * LIMITS.composeBytes
/** The most aliases a file may use to be parsed at all. A Compose file uses a handful. */
export const MAX_ALIASES = 200
/** The most names given: far more than a Compose file expects, few enough for the list before a deploy. */
export const MAX_NAMES = 64

/**
 * Something that may be an alias: `*` followed by a character an anchor's
 * name can start with. Quotes, comments and block scalars are not told apart,
 * so a `*name` there counts too: a count too high only means no names are
 * given, and one too low is never possible.
 */
const ALIAS = /\*[^ \t\r\n,[\]{}]/g

/**
 * Whether a Compose file's text uses more aliases than `MAX_ALIASES`, so it
 * is not parsed. Bun's parser copies what each alias stands for: 30,000
 * aliases to one string of 170 KB took 5 GB before anything could be walked.
 */
export function tooManyAliases(text: string): boolean {
  let count = 0
  ALIAS.lastIndex = 0
  while (ALIAS.exec(text) !== null) {
    if (++count > MAX_ALIASES) return true
  }
  return false
}

/** Where a double-quoted scalar that starts at `at` ends, past its closing quote, with only `\\` and `\"` escaped inside, as zekno's settings write one; -1 for anything else. */
function quotedEnd(line: string, at: number): number {
  if (line[at] !== '"') return -1
  for (let index = at + 1; index < line.length; index++) {
    const char = line[index]
    if (char === '"') return index + 1
    if (char === "\\") {
      const next = line[index + 1]
      if (next !== "\\" && next !== '"') return -1
      index++
    }
  }
  return -1
}

/** Whether `line` from `at` is one double-quoted scalar, then exactly `rest`. */
const quotedThen = (line: string, at: number, rest: string): boolean => {
  const end = quotedEnd(line, at)
  return end !== -1 && line.slice(end) === rest
}

/** Whether `line` from `at` is `[` and double-quoted scalars joined by `, ` and `]`, to its end. */
function quotedList(line: string, at: number): boolean {
  if (line[at] !== "[") return false
  for (let index = at + 1; ;) {
    const end = quotedEnd(line, index)
    if (end === -1) return false
    if (line.slice(end) === "]") return true
    if (!line.startsWith(", ", end)) return false
    index = end + 2
  }
}

/** The lines zekno writes from settings (contracts/compose-text.md), by what each starts with. */
const SETTINGS_LINES: readonly ((line: string) => boolean)[] = [
  (line) =>
    [
      "services:",
      "volumes:",
      "    environment:",
      "    volumes:",
      '      - type: "volume"',
    ].includes(line),
  (line) => line.startsWith("  ") && quotedThen(line, 2, ":"),
  (line) => line.startsWith("  ") && quotedThen(line, 2, ": {}"),
  (line) =>
    ["    image: ", "    restart: ", "    mem_limit: "].some(
      (start) => line.startsWith(start) && quotedThen(line, start.length, "")
    ),
  (line) => /^    cpus: [0-9]{1,4}(\.[0-9]{1,2})?$/.test(line),
  (line) =>
    ["    command: ", "    expose: ", "    ports: "].some(
      (start) => line.startsWith(start) && quotedList(line, start.length)
    ),
  (line) => {
    if (!line.startsWith("      ")) return false
    const end = quotedEnd(line, 6)
    return (
      end !== -1 && line.startsWith(": ", end) && quotedThen(line, end + 2, "")
    )
  },
  (line) =>
    ["        source: ", "        target: "].some(
      (start) => line.startsWith(start) && quotedThen(line, start.length, "")
    ),
]

/**
 * Whether a Compose text has only the lines zekno writes from settings
 * (contracts/compose-text.md; `composeText`): fixed keys, and every name and
 * value a double-quoted scalar where a node starts. Such a text holds no
 * anchor, alias or tag, whatever its values hold: a `*` in it is inside a
 * quoted scalar, which `tooManyAliases` cannot tell (security review S9). So
 * it needs no alias count; a text in any other form still does, unchanged.
 */
export function inSettingsForm(text: string): boolean {
  if (!text.endsWith("\n")) return false
  return text
    .slice(0, -1)
    .split("\n")
    .every((line) => SETTINGS_LINES.some((form) => form(line)))
}

/** Whether a Compose text may use more aliases than it can be parsed with: one in zekno's settings form holds none. */
export const aliasesTooMany = (text: string): boolean =>
  !inSettingsForm(text) && tooManyAliases(text)

/** An environment variable's name, as Compose reads one. */
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const VARIABLE_START = /^[A-Za-z_][A-Za-z0-9_]*/

/** Thrown inside the walk when the file is larger, deeper or more repeated than any Compose file. */
const TOO_MUCH = Symbol("too much")

type Budget = { nodes: number; chars: number }

function spend(budget: Budget, depth: number, chars = 0): void {
  budget.nodes += 1
  budget.chars += chars
  if (budget.nodes > MAX_NODES || budget.chars > MAX_CHARS || depth > MAX_DEPTH)
    throw TOO_MUCH
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Where `${` at `from` closes, counting `${` inside it; -1 when it does not. */
function closing(text: string, from: number): number {
  let depth = 1
  for (let at = from; at < text.length; at++) {
    if (text.startsWith("$$", at)) at++
    else if (text.startsWith("${", at)) {
      depth++
      at++
    } else if (text[at] === "}" && --depth === 0) return at
  }
  return -1
}

/** The names one string uses without a default, in the forms listed above. */
export function interpolated(text: string): string[] {
  const names: string[] = []
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== "$") continue
    const next = text[at + 1]
    if (next === "$") {
      at++
      continue
    }
    if (next === "{") {
      const end = closing(text, at + 2)
      // Compose refuses a `${` that is never closed; nothing after it is read.
      if (end === -1) break
      const inner = text.slice(at + 2, end)
      const name = VARIABLE_START.exec(inner)?.[0]
      const rest = name === undefined ? "" : inner.slice(name.length)
      if (
        name !== undefined &&
        (rest === "" || rest.startsWith(":?") || rest.startsWith("?"))
      )
        names.push(name)
      at = end
      continue
    }
    const name = VARIABLE_START.exec(text.slice(at + 1, at + 1 + 256))?.[0]
    if (name !== undefined) {
      names.push(name)
      at += name.length
    }
  }
  return names
}

/** Every string value in what was parsed, in document order, for `$`. Keys are not read. */
function walkStrings(
  node: unknown,
  depth: number,
  budget: Budget,
  found: (name: string) => void
): void {
  if (typeof node === "string") {
    spend(budget, depth, node.length)
    for (const name of interpolated(node)) found(name)
    return
  }
  spend(budget, depth)
  if (Array.isArray(node))
    for (const item of node) walkStrings(item, depth + 1, budget, found)
  else if (isMap(node))
    for (const value of Object.values(node))
      walkStrings(value, depth + 1, budget, found)
}

/** The names each service's `environment` lists with no value. */
function environmentNames(
  services: Record<string, unknown>,
  budget: Budget,
  found: (name: string) => void
): void {
  for (const service of Object.values(services)) {
    spend(budget, 2)
    const environment = isMap(service) ? service.environment : undefined
    if (Array.isArray(environment)) {
      for (const item of environment) {
        spend(budget, 4)
        if (typeof item === "string" && VARIABLE.test(item)) found(item)
      }
    } else if (isMap(environment)) {
      for (const [name, value] of Object.entries(environment)) {
        spend(budget, 4)
        if (value === null && VARIABLE.test(name)) found(name)
      }
    }
  }
}

/** A name that can be shown and compared with secrets: the secret-name pattern, and not reserved. */
const usable = (name: string): boolean =>
  name.length <= LIMITS.secretNameLength &&
  SECRET_NAME.test(name) &&
  !isReservedSecretName(name)

/**
 * The names a Compose file's text expects that have no value, each once, in
 * the order above, at most `MAX_NAMES`. No names for text that is too large,
 * uses too many aliases, cannot be parsed, is not one mapping, or goes past
 * the walk's bounds.
 */
export function expectedValues(compose: string): string[] {
  if (compose.length > COMPOSE_READ_BYTES || aliasesTooMany(compose)) return []
  let parsed: unknown
  try {
    // Bun's parser refuses excessive aliasing and stops on nesting too deep for it.
    parsed = Bun.YAML.parse(compose)
  } catch {
    return []
  }
  if (!isMap(parsed)) return []
  const names = new Set<string>()
  const found = (name: string) => {
    if (names.size < MAX_NAMES && usable(name)) names.add(name)
  }
  const budget: Budget = { nodes: 0, chars: 0 }
  try {
    if (isMap(parsed.services)) environmentNames(parsed.services, budget, found)
    walkStrings(parsed, 0, budget, found)
  } catch (error) {
    if (error === TOO_MUCH || error instanceof RangeError) return []
    throw error
  }
  return [...names]
}
