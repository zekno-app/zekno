/**
 * The rules a recipe replaces a value by, where the stand-ins cannot fix it
 * (research.md §4): a pattern in the drawn text, and what is shown in its
 * place. A rule that finds nothing throws, so a rule never stays in a recipe
 * after the program stopped drawing what it replaces.
 */
import { tidy, type Fixed, type Row } from "../format"

/** A value replaced: where it is, what is shown instead, and the line said under `fixed`. */
export type Rule = {
  pattern: RegExp
  shown: string
  what: string
  /** Only the first match is replaced, for a value that shows once among others of its shape. */
  once?: boolean
}

/**
 * `lines` with every rule applied inside the runs it matches, and the
 * entries for `fixed`. A rule's pattern must be global and match inside one
 * run; with `sameWidth`, as on a screen of the app, the text shown must take
 * as many cells as what it replaces.
 */
export function applyRules(
  lines: Row[],
  rules: Rule[],
  options: { sameWidth?: boolean } = {}
): { lines: Row[]; fixed: Fixed[] } {
  let result = lines.map((row) =>
    row.map(([look, text]) => [look, text] as [string, string])
  )
  // A value an earlier rule put in is not replaced again by a later rule of the same shape.
  const put = new Set<string>()
  for (const rule of rules) {
    if (!rule.pattern.global)
      throw new Error(`The rule for ${rule.what} must be global`)
    let found = 0
    result = result.map((row) =>
      row.map(([look, text]) => [
        look,
        text.replace(rule.pattern, (match) => {
          if (put.has(match) || (rule.once && found > 0)) return match
          found++
          if (options.sameWidth && [...match].length !== [...rule.shown].length)
            throw new Error(
              `The rule for ${rule.what} would move the columns: "${match}" is not as wide as "${rule.shown}"`
            )
          return rule.shown
        }),
      ])
    )
    if (found === 0)
      throw new Error(`The rule for ${rule.what} found nothing to replace`)
    put.add(rule.shown)
  }
  return {
    lines: result.map(tidy),
    fixed: rules.map((rule) => ({ what: rule.what, shown: rule.shown })),
  }
}
