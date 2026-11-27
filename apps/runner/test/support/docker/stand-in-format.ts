/**
 * Docker's `--format` templates, as far as the runner and its tests use them
 * (specs/016-build-from-source, contracts/runner.md RB5, RB6, RB11, RB17):
 * `{{.Field}}`, `{{.A.B}}`, `{{json .Field}}`, `{{json .}}`, and `json`
 * alone, with plain text between. Used by the stand-in for Docker to answer
 * `version`, `info` and `image inspect` as Docker 29 prints them.
 */

/** A template filled in, or Docker's error for a field it cannot find. */
export type Rendered = { text: string } | { error: string }

const FIELD = /\{\{\s*(json\s+)?\.([A-Za-z0-9_.]*)\s*\}\}/g

/** Go prints a string as is, a number in decimal, and nothing as `<no value>`. */
function plain(value: unknown): string {
  if (value === undefined || value === null) return "<no value>"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return JSON.stringify(value)
}

/** The value at a dotted path, or the first missing name. */
function walk(
  value: unknown,
  path: string
): { found: unknown } | { missing: string } {
  let at = value
  for (const name of path.split(".").filter(Boolean)) {
    if (typeof at !== "object" || at === null || !(name in at))
      return { missing: name }
    at = (at as Record<string, unknown>)[name]
  }
  return { found: at }
}

/** `template` filled from `value`, as `docker … --format <template>` prints it, before its line feed. */
export function render(template: string, value: unknown): Rendered {
  if (template.trim() === "json") return { text: JSON.stringify(value) }
  let error: string | undefined
  const text = template.replace(
    FIELD,
    (_whole, json: string | undefined, path: string) => {
      const step = walk(value, path)
      if ("missing" in step) {
        error ??= `template: :1:2: executing "" at <.${path}>: can't evaluate field ${step.missing}`
        return ""
      }
      return json ? JSON.stringify(step.found) : plain(step.found)
    }
  )
  return error === undefined ? { text } : { error }
}

/** The value of `--format` (`--format x`, `--format=x` or `-f x`) in an argument list, if any. */
export function formatOf(words: readonly string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (word === "--format" || word === "-f") return words[i + 1]
    if (word.startsWith("--format=")) return word.slice("--format=".length)
  }
  return undefined
}
