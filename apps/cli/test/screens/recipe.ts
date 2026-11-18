/**
 * What a recipe of a screen is (contracts/screens.md, "The command"): the
 * screen's title, command, size and description, and how to draw it from the
 * real program with the stand-ins. Each recipe is a file of `recipes/`
 * whose default export is one of these.
 */
import type { Fixed, Row } from "./format"

/** What a recipe drew: the rows of the screen, and every value it replaced so the screen is the same on each run. */
export type Drawn = { lines: Row[]; fixed: Fixed[] }

export type Recipe = {
  title: string
  command: string
  columns: 80 | 100
  /** The terminal's height for a screen of the full-screen app; null for a command's output. */
  rows: number | null
  alt: string
  draw: () => Promise<Drawn>
}
