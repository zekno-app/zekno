import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The screens of the CLI the docs show (specs/013-docs-refresh,
 * contracts/screens.md, "The stored file"). Each is a JSON file in
 * `content/screens`, written by `bun run screens` in `apps/cli` from the real
 * program and never by hand. This reader checks every field by hand, with no
 * package, and names the screen when a file is missing or unsound, so a page
 * that shows a broken screen stops the build.
 */

/** The looks a run may have, as the CLI draws them. */
export const LOOKS = ["bold", "dim", "brand", "green", "yellow", "red"] as const

/** One look of a run. */
export type Look = (typeof LOOKS)[number]

/** A piece of a row in one look: the look ("" or names joined by commas) and its text. */
export type Run = [look: string, text: string]

/** A value the capture replaced so the screen is the same on each run. */
export type Fixed = { what: string; shown: string }

/** A stored screen, as `contracts/screens.md` describes it. */
export type StoredScreen = {
  name: string
  title: string
  command: string
  columns: 100 | 80
  /** The terminal's height for a screen of the full-screen app; `null` for a command's output. */
  rows: number | null
  alt: string
  fixed: Fixed[]
  lines: Run[][]
}

/** Where the stored screens are, from the site's folder (as `templates.ts` finds its folder). */
export function screensFolder(): string {
  return join(process.cwd(), "content/screens")
}

/** A screen's name: lower-case letters, digits and hyphens. */
const NAME = /^[a-z0-9-]+$/

/** The fields of a stored file, in the contract's order; no other field is allowed. */
const FIELDS = [
  "name",
  "title",
  "command",
  "columns",
  "rows",
  "alt",
  "fixed",
  "lines",
]

/** True when a text holds a control character: a stored row holds text, never a terminal's escape codes, tabs or line breaks. */
function hasControl(text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0)!
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) return true
  }
  return false
}

/** Combining marks take no cell of their own. */
const MARK = /^[\p{Mn}\p{Me}]$/u

/** Emoji drawn as pictures take two cells. */
const PICTURE = /^\p{Emoji_Presentation}$/u

/** Code points that take no cell: zero-width spaces and joiners, the word joiner, variation selectors. */
const ZERO_WIDTH: [number, number][] = [
  [0x200b, 0x200f],
  [0x2060, 0x2060],
  [0xfe00, 0xfe0f],
]

/** Code points that take two cells: the wide East Asian blocks. */
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
]

/** True when `point` is in one of `ranges`. */
function within(point: number, ranges: [number, number][]): boolean {
  return ranges.some(([first, last]) => point >= first && point <= last)
}

/** How many cells of the terminal a text takes. */
export function cellsOf(text: string): number {
  let cells = 0
  for (const character of text) {
    const point = character.codePointAt(0)!
    if (MARK.test(character) || within(point, ZERO_WIDTH)) continue
    cells += PICTURE.test(character) || within(point, WIDE) ? 2 : 1
  }
  return cells
}

/** True for a plain object (not a list, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True for a string with something in it other than spaces. */
function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

/** True for a look the contract knows: "" or names from `LOOKS` joined by commas, each once. */
export function isLook(look: string): boolean {
  if (look === "") return true
  const names = look.split(",")
  return (
    names.every((name) => (LOOKS as readonly string[]).includes(name)) &&
    new Set(names).size === names.length
  )
}

/**
 * Checks a parsed file against the contract and returns it as a screen.
 * `name` is the file's name without `.json`. Throws with the screen's name
 * and the first rule the file breaks.
 */
export function checkScreen(name: string, value: unknown): StoredScreen {
  const fail = (reason: string): never => {
    throw new Error(`The stored screen "${name}" is unsound: ${reason}.`)
  }
  if (!isRecord(value)) return fail("it is not a JSON object")
  const extra = Object.keys(value).filter((key) => !FIELDS.includes(key))
  if (extra.length > 0)
    fail(`it has fields the format does not: ${extra.join(", ")}`)
  const { title, command, columns, rows, alt, fixed, lines } = value

  if (typeof value.name !== "string" || !NAME.test(value.name))
    fail("name is not lower-case letters, digits and hyphens")
  if (value.name !== name)
    fail(`name is "${String(value.name)}", not the file's name`)
  for (const [field, text] of [
    ["title", title],
    ["command", command],
    ["alt", alt],
  ] as const) {
    if (!isFilled(text)) fail(`${field} is missing or empty`)
    if (hasControl(text as string)) fail(`${field} holds a control character`)
  }
  if (columns !== 100 && columns !== 80) fail("columns is not 100 or 80")
  if (rows !== null && !(Number.isInteger(rows) && (rows as number) > 0))
    fail("rows is not a whole number above 0 or null")

  if (!Array.isArray(fixed)) return fail("fixed is not a list")
  fixed.forEach((entry, at) => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 2 ||
      !isFilled(entry.what) ||
      !isFilled(entry.shown)
    )
      fail(`fixed entry ${at + 1} is not { what, shown } with text in both`)
  })

  if (!Array.isArray(lines)) return fail("lines is not a list")
  lines.forEach((row, at) => {
    const where = `row ${at + 1}`
    if (!Array.isArray(row)) return fail(`${where} is not a list of runs`)
    let text = ""
    for (const run of row) {
      if (
        !Array.isArray(run) ||
        run.length !== 2 ||
        typeof run[0] !== "string" ||
        typeof run[1] !== "string"
      )
        fail(`${where} has a run that is not [look, text]`)
      if (!isLook(run[0])) fail(`${where} has an unknown look "${run[0]}"`)
      if (hasControl(run[1])) fail(`${where} holds a control character`)
      text += run[1]
    }
    if (text.endsWith(" ")) fail(`${where} ends with spaces`)
    const cells = cellsOf(text)
    if (cells > (columns as number))
      fail(`${where} is ${cells} cells wide, more than ${String(columns)}`)
  })
  if (rows === null) {
    const first = (lines[0] as Run[] | undefined)?.map((run) => run[1]).join("")
    if (first !== `$ ${command as string}`)
      fail(
        `the first row of a command's output is not "$ ${command as string}"`
      )
  } else if (lines.length !== rows)
    fail(`it has ${lines.length} rows, not the ${rows as number} of the screen`)

  return value as StoredScreen
}

/**
 * Reads and checks the stored screen `name` from `folder` (the site's
 * `content/screens` by default). Throws with the name when there is no such
 * file or it breaks the format.
 */
export function readScreen(
  name: string,
  folder = screensFolder()
): StoredScreen {
  if (!NAME.test(name))
    throw new Error(
      `"${name}" is not a screen's name: lower-case letters, digits and hyphens.`
    )
  const file = join(folder, `${name}.json`)
  if (!existsSync(file))
    throw new Error(
      `There is no stored screen "${name}": content/screens/${name}.json does not exist. Draw it with \`bun run screens ${name}\` in apps/cli.`
    )
  const source = readFileSync(file, "utf8")
  if (!source.endsWith("\n"))
    throw new Error(
      `The stored screen "${name}" is unsound: the file does not end with a newline.`
    )
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error(`The stored screen "${name}" is unsound: it is not JSON.`)
  }
  return checkScreen(name, parsed)
}

/** The names of every stored screen in `folder`, sorted. */
export function storedScreenNames(folder = screensFolder()): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort()
}
