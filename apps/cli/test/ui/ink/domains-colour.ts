/**
 * What the colour tests of feature 015's lines at a terminal share
 * (domains-terminal.test.ts, domains-terminal-lists.test.ts;
 * specs/015-domains-https, tasks T075): a run's look, the text and the runs
 * of a drawing, and a line single commands write once (`Line`), each drawn as
 * a terminal that shows every colour receives it.
 */
import { join } from "node:path"

import {
  drawnInColour,
  plainOf,
  wordRuns,
  type Run,
} from "../../support/colour"

export const SRC = join(import.meta.dir, "../../../src")
export const BRAND = "#2383e2"

/** A run's look: its words, bold, dim and its colour. */
export const look = (
  text: string,
  options: { bold?: boolean; dim?: boolean; color?: string } = {}
): Run => ({
  text,
  bold: options.bold ?? false,
  dim: options.dim ?? false,
  ...(options.color === undefined ? {} : { color: options.color }),
})
export const plain = (text: string) => look(text)
export const dim = (text: string) => look(text, { dim: true })
export const bold = (text: string) => look(text, { bold: true })

/** The lines of a drawing that hold words, as their text. */
export const textOf = (drawn: string): string[] =>
  drawn
    .split("\n")
    .map((line) => plainOf(line).trimEnd())
    .filter((line) => line.trim() !== "")

/** The runs of the drawing's first line whose text holds `part`. */
export function runsAt(drawn: string, part: string): Run[] {
  const line = drawn.split("\n").find((each) => plainOf(each).includes(part))
  if (line === undefined) throw new Error(`no line with ${part}`)
  return wordRuns(line)
}

/** One of the lines single commands write once (`Line`), in colour. */
export const line = (item: Record<string, unknown>) =>
  drawnInColour(
    join(SRC, "ui/ink/lines.tsx"),
    "Line",
    { item: { id: 0, ...item }, columns: 100 },
    100
  )
