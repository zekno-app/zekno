import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"

import { APP_COLUMN, Logo, LOGO_BITMAP, LOGO_HEIGHT, LOGO_WIDTH, logoLines, logoParts } from "../../../src/ui/terminal/logo"

const DESIGN = join(import.meta.dir, "../../../../../specs/004-cli-app/design")

type Run = { x: number; y: number; width: number; height: number }

/** The filled runs of the wordmark's SVG on a board, by colour: each `M x y h w v h h-w z` is one rectangle. */
function svgRuns(board: string): Map<string, Run[]> {
  const svg = /<svg role="img" aria-label="zekno\.app" viewBox="0 0 41 5"[^>]*>([\s\S]*?)<\/svg>/.exec(readFileSync(join(DESIGN, board), "utf8"))
  if (!svg) throw new Error(`no wordmark in ${board}`)
  const runs = new Map<string, Run[]>()
  for (const [, fill, d] of svg[1]!.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)) {
    const found: Run[] = []
    for (const [whole, x, y, width, height, back] of d!.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)) {
      if (back !== width) throw new Error(`not a rectangle: ${whole}`)
      found.push({ x: Number(x), y: Number(y), width: Number(width), height: Number(height) })
    }
    // Every part of the path must be a run this reads; nothing may be skipped.
    expect(found.length).toBe(d!.split("z").filter(Boolean).length)
    runs.set(fill!, found)
  }
  return runs
}

/** A 5 by 41 grid of the cells the runs fill, `#` for filled. */
function grid(runs: Run[]): string[] {
  const cells = Array.from({ length: 5 }, () => Array<string>(LOGO_WIDTH).fill(" "))
  for (const run of runs) {
    for (let row = run.y; row < run.y + run.height; row++) {
      for (let column = run.x; column < run.x + run.width; column++) cells[row]![column] = "#"
    }
  }
  return cells.map((row) => row.join(""))
}

/** Reads the half blocks back into two rows per line. */
function unfold(lines: string[]): string[] {
  const rows: string[] = []
  for (const line of lines) {
    rows.push([...line].map((cell) => (cell === "▀" || cell === "█" ? "#" : " ")).join(""))
    rows.push([...line].map((cell) => (cell === "▄" || cell === "█" ? "#" : " ")).join(""))
  }
  return rows
}

const boardsWithLogo = readdirSync(DESIGN).filter(
  (file) => file.endsWith(".dc.html") && readFileSync(join(DESIGN, file), "utf8").includes('aria-label="zekno.app"')
)

describe("the wordmark", () => {
  test("is 41 columns by 3 lines of half blocks", () => {
    const lines = logoLines()
    expect(lines).toHaveLength(LOGO_HEIGHT)
    for (const line of lines) {
      expect([...line]).toHaveLength(LOGO_WIDTH)
      expect(line).toMatch(/^[▀▄█ ]+$/)
    }
  })

  test("the bitmap is the canvas's: the SVG paths of the board 'First run', cell for cell", () => {
    const runs = svgRuns("Welcome.dc.html")
    expect(grid([...runs.values()].flat())).toEqual([...LOGO_BITMAP])
  })

  test("the half blocks draw exactly that bitmap, its sixth row empty", () => {
    expect(unfold(logoLines())).toEqual([...LOGO_BITMAP, " ".repeat(LOGO_WIDTH)])
  })

  test("'zekno' is the text-coloured part and '.app' the brand-blue part, split where the canvas splits them", () => {
    const runs = svgRuns("Welcome.dc.html")
    const white = grid(runs.get("#ffffff")!)
    const blue = grid(runs.get("#2383e2")!)
    for (const row of white) expect(row.slice(APP_COLUMN - 1)).toBe(" ".repeat(LOGO_WIDTH - APP_COLUMN + 1))
    for (const row of blue) expect(row.slice(0, APP_COLUMN)).toBe(" ".repeat(APP_COLUMN))
    // Column 24 is the space between "zekno" and ".app": empty in both.
    const parts = logoParts()
    expect(unfold(parts.map((part) => part.name))).toEqual([...white.map((row) => row.slice(0, APP_COLUMN)), " ".repeat(APP_COLUMN)])
    expect(unfold(parts.map((part) => part.app))).toEqual([...blue.map((row) => row.slice(APP_COLUMN)), " ".repeat(LOGO_WIDTH - APP_COLUMN)])
  })

  test("every board draws the same wordmark", () => {
    expect(boardsWithLogo.length).toBeGreaterThanOrEqual(10)
    for (const board of boardsWithLogo) {
      expect({ board, cells: grid([...svgRuns(board).values()].flat()) }).toEqual({ board, cells: [...LOGO_BITMAP] })
    }
  })

  test("is drawn as those three lines, and never wraps in a narrow window", () => {
    expect(renderToString(createElement(Logo), { columns: 80 })).toBe(logoLines().map((line) => line.trimEnd()).join("\n"))
    expect(renderToString(createElement(Logo), { columns: 20 }).split("\n")).toHaveLength(LOGO_HEIGHT)
  })
})
