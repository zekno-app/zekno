/**
 * The stored form of a screen (specs/013-docs-refresh, contracts/screens.md):
 * what a terminal shows, read back as rows of runs, each run a look and the
 * characters drawn in it, and the file the docs and the README's picture are
 * made from, written one row of the screen per line so a change shows in a
 * diff as the rows that changed.
 */

/** The looks a run can have, in the order a look names them. `brand` is the CLI's blue. */
export const LOOKS = ["bold", "dim", "brand", "green", "yellow", "red"] as const

export type LookName = (typeof LOOKS)[number]

/** The looks that are colours. */
const COLOURS = ["brand", "green", "yellow", "red"] as const

/** A run: its look (names joined by commas, or empty) and its characters. */
export type Run = [look: string, text: string]

/** One row of a screen, left to right. */
export type Row = Run[]

/** A value the recipe replaced so the screen is the same on every run, and what is shown instead. */
export type Fixed = { what: string; shown: string }

/** A stored screen, as `apps/web/content/screens/<name>.json` holds it. */
export type Screen = {
  name: string
  title: string
  command: string
  columns: 80 | 100
  /** The terminal's height for a screen of the full-screen app; null for a command's output. */
  rows: number | null
  alt: string
  fixed: Fixed[]
  lines: Row[]
}

/** The blue of the CLI's theme (src/ui/terminal/theme.ts), as a terminal that shows every colour receives it. */
const BRAND = "#2383e2"

/** The colours of the standard eight, by their SGR number less 30. */
const EIGHT = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
]

/**
 * What the pen draws with: bold, dim, a colour by name or `#rrggbb`, and
 * any other look by its name (`other`), which a cell may carry for a moment,
 * as a text cursor drawn in reverse does, but never on the screen at the end.
 */
type Pen = { bold: boolean; dim: boolean; color?: string; other?: string }

const PLAIN: Pen = { bold: false, dim: false }

/** A pen's look as the stored file names it. A colour outside the list throws with its name. */
export function lookOf(pen: Pen): string {
  if (pen.other !== undefined)
    throw new Error(
      `The program drew with a look the screens do not know: ${pen.other}. Add it to contracts/screens.md, the docs' frame and the SVG together.`
    )
  const names: LookName[] = []
  if (pen.bold) names.push("bold")
  if (pen.dim) names.push("dim")
  if (pen.color !== undefined) {
    const color = pen.color === BRAND ? "brand" : pen.color
    if (!(COLOURS as readonly string[]).includes(color))
      throw new Error(
        `The program drew in a colour the screens do not know: ${pen.color}. Add it to contracts/screens.md, the docs' frame and the SVG together.`
      )
    names.push(color as LookName)
  }
  return names.join(",")
}

/** Looks other than bold, dim and a foreground colour, by the SGR number that starts them, and the one that ends them. */
const OTHERS: Record<number, [name: string, end: number]> = {
  3: ["italic", 23],
  4: ["underline", 24],
  5: ["blink", 25],
  7: ["reverse", 27],
  8: ["hidden", 28],
  9: ["strikethrough", 29],
}

/** The pen after one SGR sequence's numbers. */
function penAfter(pen: Pen, codes: number[]): Pen {
  let next = pen
  for (let at = 0; at < codes.length; at++) {
    const code = codes[at]!
    if (code === 0) next = PLAIN
    else if (code === 1) next = { ...next, bold: true }
    else if (code === 2) next = { ...next, dim: true }
    else if (code === 22) next = { ...next, bold: false, dim: false }
    else if (code === 39) {
      const { color: _color, ...rest } = next
      next = rest
    } else if (code >= 30 && code <= 37)
      next = { ...next, color: EIGHT[code - 30] }
    else if (code >= 90 && code <= 97)
      next = { ...next, color: `bright ${EIGHT[code - 90]}` }
    else if (code === 38 && codes[at + 1] === 2) {
      const hex = codes
        .slice(at + 2, at + 5)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
      next = { ...next, color: `#${hex}` }
      at += 4
    } else if (code === 38 && codes[at + 1] === 5) {
      next = { ...next, color: `colour ${codes[at + 2]}` }
      at += 2
    } else if (OTHERS[code]) next = { ...next, other: OTHERS[code][0] }
    else if (Object.values(OTHERS).some(([, end]) => end === code)) {
      const { other: _other, ...rest } = next
      next = rest
    } else next = { ...next, other: `SGR ${code}` }
  }
  return next
}

/** One cell of the screen: a character and the pen it was drawn with. */
type Cell = { char: string; pen: Pen }

const SPACE: Cell = { char: " ", pen: PLAIN }

/**
 * The rows a terminal shows once it has received `raw`, each as runs, with
 * the looks of the stored file: text, line breaks, a carriage return,
 * erasing a line, moving up and back to the first column, and SGR. This is
 * what Ink writes for a command at a terminal and for `renderToString`, and
 * the same reading as `screenOf` in test/support/helpers.ts, with the colours
 * kept. Any other sequence is left out, as `screenOf` leaves it. Trailing
 * spaces of a row are removed, whatever their look.
 */
export function rowsOf(raw: string): Row[] {
  const grid: Cell[][] = [[]]
  let row = 0
  let column = 0
  let pen: Pen = PLAIN
  for (const token of raw.split(/(\x1b\[[0-9;?]*[A-Za-z]|\r|\n)/)) {
    if (token === "") continue
    if (token === "\n") {
      row++
      column = 0
      grid[row] ??= []
      continue
    }
    if (token === "\r") {
      column = 0
      continue
    }
    const csi = /^\x1b\[([0-9;?]*)([A-Za-z])$/.exec(token)
    if (csi) {
      const [, count, final] = csi
      if (final === "m")
        pen = penAfter(pen, count === "" ? [0] : count!.split(";").map(Number))
      if (final === "K") grid[row] = []
      if (final === "A") row = Math.max(0, row - Number(count || 1))
      if (final === "G") column = 0
      continue
    }
    for (const char of token) {
      const cells = grid[row]!
      while (cells.length < column) cells.push(SPACE)
      cells[column] = { char, pen }
      column++
    }
  }
  return grid.map(runsOfCells)
}

/** A row of cells as runs, trailing spaces removed, neighbours of one look joined. */
function runsOfCells(cells: Cell[]): Row {
  let end = cells.length
  while (end > 0 && cells[end - 1]!.char === " ") end--
  const runs: Row = []
  for (const cell of cells.slice(0, end)) {
    const look = lookOf(cell.pen)
    const last = runs.at(-1)
    if (last && last[0] === look) last[1] += cell.char
    else runs.push([look, cell.char])
  }
  return runs
}

/** A row's characters, its looks left out. */
export const textOf = (row: Row): string => row.map(([, text]) => text).join("")

/** How many cells a row takes: one per character. */
export const widthOf = (row: Row): number => [...textOf(row)].length

/** A row with its trailing spaces removed and neighbouring runs of one look joined, as `rowsOf` gives them. */
export function tidy(row: Row): Row {
  const runs: Row = []
  for (const [look, text] of row) {
    if (text === "") continue
    const last = runs.at(-1)
    if (last && last[0] === look) last[1] += text
    else runs.push([look, text])
  }
  while (runs.length > 0) {
    const last = runs.at(-1)!
    const trimmed = last[1].replace(/ +$/, "")
    if (trimmed !== "") {
      last[1] = trimmed
      break
    }
    runs.pop()
  }
  return runs
}

/** Checks what the contract asks of every screen, and throws with the screen's name when one fails. */
export function checkScreen(screen: Screen): void {
  const fail = (why: string) => {
    throw new Error(`Screen ${screen.name}: ${why}`)
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(screen.name)) fail("a bad name")
  if (screen.columns !== 80 && screen.columns !== 100)
    fail("columns are 80 or 100")
  if (screen.rows !== null && screen.lines.length !== screen.rows)
    fail(`${screen.lines.length} rows, where the terminal has ${screen.rows}`)
  if (screen.alt.trim() === "") fail("no description")
  screen.lines.forEach((row, index) => {
    if (widthOf(row) > screen.columns)
      fail(`row ${index + 1} is ${widthOf(row)} cells wide`)
    for (const [look] of row)
      for (const name of look === "" ? [] : look.split(","))
        if (!(LOOKS as readonly string[]).includes(name))
          fail(`row ${index + 1} has the look ${name}`)
  })
}

/**
 * The stored file: the fields one per line, each value fixed and each row of
 * the screen on a line of its own, ending with a newline. The same screen
 * always gives the same bytes.
 */
export function storedText(screen: Screen): string {
  checkScreen(screen)
  const field = (name: string, value: unknown) =>
    `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`
  const list = (items: string[]) =>
    items.length === 0 ? "[]" : `[\n${items.join(",\n")}\n  ]`
  return [
    "{",
    field("name", screen.name),
    field("title", screen.title),
    field("command", screen.command),
    field("columns", screen.columns),
    field("rows", screen.rows),
    field("alt", screen.alt),
    `  "fixed": ${list(screen.fixed.map((entry) => `    ${JSON.stringify({ what: entry.what, shown: entry.shown })}`))},`,
    `  "lines": ${list(screen.lines.map((row) => `    ${JSON.stringify(row)}`))}`,
    "}",
    "",
  ].join("\n")
}

/** The screen a stored file holds, checked. */
export function readScreen(text: string): Screen {
  const screen = JSON.parse(text) as Screen
  checkScreen(screen)
  return screen
}
