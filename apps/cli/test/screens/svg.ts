/**
 * The README's picture of a screen (contracts/screens.md, "The SVG"): the
 * docs' frame drawn as an SVG, with the stored rows inside it. GitHub shows
 * an SVG as an image and loads no web font into it, so nothing here depends
 * on the reader's font: every character is placed at its own column, the
 * box-drawing characters are drawn as lines that join, and the block
 * characters of the logo as rectangles. No script, no outside file.
 */
import { type Row, type Screen } from "./format"

/** The frame's measures, as on the board DocsFrame: text at 12.5px, rows 15px high. */
const CELL = { width: 7.5, height: 15 }
const BODY = { x: 18, y: 14 }
const BAR = 32
const RADIUS = 10

/** The frame's colours, as contracts/screens.md gives them. */
const COLOURS = {
  ground: "#0b0d10",
  border: "#ffffff",
  borderOpacity: "0.12",
  bar: "#a1a1a1",
  text: "#d7dde4",
  bold: "#ffffff",
  dim: "#8b949e",
  brand: "#2383e2",
  green: "#3fb950",
  yellow: "#d29922",
  red: "#f85149",
}

const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace"
const SANS =
  "system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif"

/** The colour and weight a look is drawn in: the colour named, else dim, else bold's white, else the text colour. */
function paint(look: string): { fill: string; bold: boolean } {
  const names = look === "" ? [] : look.split(",")
  const colour = names.find((name) =>
    ["brand", "green", "yellow", "red"].includes(name)
  ) as keyof typeof COLOURS | undefined
  const bold = names.includes("bold")
  const fill = colour
    ? COLOURS[colour]
    : names.includes("dim")
      ? COLOURS.dim
      : bold
        ? COLOURS.bold
        : COLOURS.text
  return { fill, bold }
}

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** A number as the file writes it: at most two decimals, no trailing zeros. */
const n = (value: number) => String(Math.round(value * 100) / 100)

/**
 * Which way each light box-drawing character reaches from its cell's
 * centre: up, right, down, left; `round` for the rounded corners.
 */
const BOX: Record<string, { reach: string; round?: boolean }> = {
  "─": { reach: "rl" },
  "│": { reach: "ud" },
  "┌": { reach: "rd" },
  "┐": { reach: "dl" },
  "└": { reach: "ur" },
  "┘": { reach: "ul" },
  "╭": { reach: "rd", round: true },
  "╮": { reach: "dl", round: true },
  "╰": { reach: "ur", round: true },
  "╯": { reach: "ul", round: true },
  "├": { reach: "urd" },
  "┤": { reach: "udl" },
  "┬": { reach: "rdl" },
  "┴": { reach: "url" },
  "┼": { reach: "urdl" },
}

/** The block characters, as the part of the cell each fills: top, height (in halves). */
const BLOCKS: Record<string, [top: number, height: number]> = {
  "▀": [0, 1],
  "▄": [1, 1],
  "█": [0, 2],
}

/** The path of one box-drawing character in the cell at `x`, `y`. */
function boxPath(char: string, x: number, y: number): string {
  const shape = BOX[char]!
  const cx = x + CELL.width / 2
  const cy = y + CELL.height / 2
  const ends: Record<string, [number, number]> = {
    u: [cx, y],
    r: [x + CELL.width, cy],
    d: [cx, y + CELL.height],
    l: [x, cy],
  }
  if (shape.round) {
    const [a, b] = [...shape.reach].map((side) => ends[side]!)
    const r = CELL.width / 2
    const toward = (point: [number, number]): [number, number] => [
      cx + Math.sign(point[0] - cx) * r,
      cy + Math.sign(point[1] - cy) * r,
    ]
    const [a1, b1] = [toward(a!), toward(b!)]
    return `M${n(a![0])} ${n(a![1])}L${n(a1[0])} ${n(a1[1])}Q${n(cx)} ${n(cy)} ${n(b1[0])} ${n(b1[1])}L${n(b![0])} ${n(b![1])}`
  }
  return [...shape.reach]
    .map(
      (side) => `M${n(cx)} ${n(cy)}L${n(ends[side]![0])} ${n(ends[side]![1])}`
    )
    .join("")
}

/** One row's drawing: text by column, lines for box characters, rectangles for blocks. */
function rowParts(row: Row, top: number): string[] {
  const parts: string[] = []
  let column = 0
  for (const [look, text] of row) {
    const { fill, bold } = paint(look)
    const chars = [...text]
    let word: { at: number; chars: string[] } | undefined
    let line: { from: number; to: number } | undefined
    const endWord = () => {
      if (!word) return
      const xs = word.chars.map((_, index) =>
        n(BODY.x + 1 + (word!.at + index) * CELL.width)
      )
      parts.push(
        `<text x="${xs.join(" ")}" y="${n(top + 11)}" fill="${fill}"${bold ? ' font-weight="600"' : ""}>${escape(word.chars.join(""))}</text>`
      )
      word = undefined
    }
    const endLine = () => {
      if (!line) return
      const y = n(top + CELL.height / 2)
      parts.push(
        `<path d="M${n(BODY.x + 1 + line.from * CELL.width)} ${y}H${n(BODY.x + 1 + line.to * CELL.width)}" stroke="${fill}"/>`
      )
      line = undefined
    }
    for (const char of chars) {
      const x = BODY.x + 1 + column * CELL.width
      const code = char.codePointAt(0)!
      const box = code >= 0x2500 && code <= 0x257f
      const block = code >= 0x2580 && code <= 0x259f
      if (char === "─") {
        endWord()
        if (line && line.to === column) line.to = column + 1
        else {
          endLine()
          line = { from: column, to: column + 1 }
        }
      } else if (box) {
        endWord()
        endLine()
        if (!BOX[char])
          throw new Error(`The picture cannot draw the character ${char}`)
        parts.push(
          `<path d="${boxPath(char, x, top)}" stroke="${fill}" fill="none"/>`
        )
      } else if (block) {
        endWord()
        endLine()
        const shape = BLOCKS[char]
        if (!shape)
          throw new Error(`The picture cannot draw the character ${char}`)
        const half = CELL.height / 2
        parts.push(
          `<rect x="${n(x)}" y="${n(top + shape[0] * half)}" width="${n(CELL.width)}" height="${n(shape[1] * half)}" fill="${fill}"/>`
        )
      } else if (char === " ") {
        endWord()
        endLine()
      } else {
        endLine()
        if (word) word.chars.push(char)
        else word = { at: column, chars: [char] }
      }
      column++
    }
    endWord()
    endLine()
  }
  return parts
}

/** The size shown at the right of the title bar: `100 × 30` for a screen of the app, the command for a command's output. */
const sizeOf = (screen: Screen) =>
  screen.rows === null
    ? `$ ${screen.command}`
    : `${screen.columns} × ${screen.rows}`

/** The SVG of `screen` in the docs' frame. The same screen always gives the same bytes. */
export function svgOf(screen: Screen): string {
  const rows = screen.rows ?? screen.lines.length
  const width = BODY.x * 2 + screen.columns * CELL.width + 2
  const height = BAR + 1 + BODY.y * 2 + rows * CELL.height + 1
  const body = BAR + 1 + BODY.y
  const lines = screen.lines.flatMap((row, index) =>
    rowParts(row, body + index * CELL.height).map((part) => `    ${part}`)
  )
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-labelledby="screen-title">`,
    `  <title id="screen-title">${escape(screen.alt)}</title>`,
    `  <rect x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="${RADIUS}" fill="${COLOURS.ground}" stroke="${COLOURS.border}" stroke-opacity="${COLOURS.borderOpacity}"/>`,
    `  <path d="M1 ${BAR + 0.5}H${n(width - 1)}" stroke="${COLOURS.border}" stroke-opacity="${COLOURS.borderOpacity}"/>`,
    `  <g font-family="${SANS}" font-size="12" fill="${COLOURS.bar}">`,
    `    <text x="15" y="${BAR / 2 + 4}">${escape(screen.title)}</text>`,
    `    <text x="${n(width - 15)}" y="${BAR / 2 + 4}" text-anchor="end">${escape(sizeOf(screen))}</text>`,
    "  </g>",
    `  <g font-family="${MONO}" font-size="12.5" stroke-width="1">`,
    ...lines,
    "  </g>",
    "</svg>",
    "",
  ].join("\n")
}
