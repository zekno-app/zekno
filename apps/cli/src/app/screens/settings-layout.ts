/**
 * Where everything of the settings screen goes (specs/010-app-settings,
 * contracts/app-screen.md, "80 by 24"), as plain arithmetic on the window's
 * size: the lines the frame leaves for the panes, the widths of the panes,
 * and the lines each part is drawn in. The screen draws exactly these lines,
 * already broken (`wrapPieces`), so a window of them always keeps the
 * selected row in view; the reducer uses the same numbers to stop scrolling
 * the Compose text at its end. Nothing here draws.
 */
import { sanitize } from "../../server/sanitize"
import type { SettingRow } from "../../settings/types"
import { AS3, AS8 } from "../../settings/words"
import { wrapPieces, type Piece } from "../../ui/ink/wrap"
import type { KeyHint } from "../../ui/parts/key-hints"
import { LOGO_HEIGHT } from "../../ui/terminal/logo"
import type { Notice } from "../../shared/notice"
import { inkRows, widthOf } from "./home/rows"

/** The Services pane's width, at every size (contracts/app-screen.md). */
export const SERVICES_WIDTH = 22
/** The narrowest label column of a row: a label padded to 11 (contracts/app-screen.md). */
export const LABEL_WIDTH = 11
/** The selection marker's column. */
export const MARKER_WIDTH = 2
/** The label column of the change's `now` and `new` rows (board `AppSettingsEdit`). */
export const NOW_WIDTH = 5
/** The most lines the `now` and `new` values of a change take; a longer value ends with "…". */
export const VALUE_LINES = 3
/** The most columns the value after `n keep` takes in the hint line; a longer one ends with "…". */
export const KEEP_WIDTH = 24

/** A pane's border and padding, on each side together. */
const PANE_FRAME = 4

/**
 * The hint lines of the settings screen but the one for showing the
 * settings, which is `HINTS.settings` (placeholder.tsx), as
 * contracts/app-screen.md, "Keys", gives them. Asking y/N takes its hints
 * from the question's answers (state/settings-change.ts, `askChoices`).
 */
export const SENTENCE_HINTS: readonly KeyHint[] = [["esc", "back"]]
export const TYPING_HINTS: readonly KeyHint[] = [
  ["enter", "next"],
  ["esc", "back"],
]
export const PICKING_HINTS: readonly KeyHint[] = [
  ["↑↓", "move"],
  ["enter", "choose"],
  ["esc", "back"],
]
export const COMPOSE_HINTS: readonly KeyHint[] = [
  ["↑↓", "scroll"],
  ["c", "settings"],
  ["esc", "back"],
]

/**
 * The lines the hint line takes in `width` columns: `KeyHints` keeps each
 * hint whole, two columns apart, and starts a new line where one does not fit.
 */
export function hintRows(hints: readonly KeyHint[], width: number): number {
  let rows = 1
  let used = 0
  for (const [key, does] of hints) {
    const wide = widthOf(`${key} ${does}`)
    if (used > 0 && used + 2 + wide > width) {
      rows++
      used = wide
    } else used += (used > 0 ? 2 : 0) + wide
  }
  return rows
}

/** The lines of the line above the hints: waiting for a deploy, or a notice, as Ink wraps it; none without either. */
export function statusRows(
  status: { notice?: Notice; quitting: boolean },
  width: number
): number {
  if (status.quitting) return 1
  if (!status.notice) return 0
  const { tone, text } = status.notice
  return inkRows(tone === "info" ? text : `✖ ${text}`, width)
}

/**
 * The lines the frame leaves for the body (app/frame.tsx): the window less
 * its header, the gap under it, the two gaps around the status line (there
 * even when it is empty), the status line and the hints.
 */
export function bodyRows(
  size: { columns: number; rows: number },
  status: number,
  hints: readonly KeyHint[]
): number {
  return (
    size.rows - LOGO_HEIGHT - 3 - status - hintRows(hints, size.columns - 2)
  )
}

/** The columns inside the service pane, beside the Services pane. */
export const serviceInner = (columns: number): number =>
  columns - 2 - SERVICES_WIDTH - 1 - PANE_FRAME

/** The columns inside the Services pane. */
export const SERVICES_INNER = SERVICES_WIDTH - PANE_FRAME

/** The columns inside the one pane drawn in place of the two, or while a change is open. */
export const wholeInner = (columns: number): number => columns - 2 - PANE_FRAME

/** The columns inside the change's box, in that one pane. */
export const boxInner = (columns: number): number =>
  wholeInner(columns) - PANE_FRAME

/** Words broken into lines of `width` columns, as the screen draws them. */
export const linesOf = (pieces: readonly Piece[], width: number): Piece[][] =>
  wrapPieces(pieces, Math.max(width, 1))

/** A text cut to `width` columns, with "…" where it was cut. */
export function cut(text: string, width: number): string {
  if (widthOf(text) <= width) return text
  let kept = ""
  for (const char of text) {
    if (widthOf(`${kept}${char}…`) > width) break
    kept += char
  }
  return `${kept}…`
}

/** One line of the service pane's rows: a section's heading, or a line of a row. */
export type RowLine =
  | { kind: "heading"; text: string }
  | {
      kind: "row"
      /** The row's place among the service's rows. */
      row: number
      /** The label on the row's first line; nothing on the lines its value goes on to. */
      label?: string
      pieces: Piece[]
    }

/** The width of the label column: 11, or wider for a longer label, but never more than half the room. */
export function labelWidth(rows: readonly SettingRow[], inner: number): number {
  const longest = Math.max(0, ...rows.map((row) => widthOf(row.label)))
  const half = Math.floor((inner - MARKER_WIDTH) / 2)
  return Math.max(LABEL_WIDTH, Math.min(longest + 2, half))
}

/**
 * A row's value as pieces: the value (dim when it is the words of a setting
 * left out) and, when it changed since the last deploy, two spaces and AS3
 * in the warning colour; when the last deploy had it and the file no
 * longer does, two spaces and AS8 (security review S3).
 */
export function valuePieces(row: SettingRow, warning: string): Piece[] {
  const pieces: Piece[] = [{ text: row.shown, dim: !row.set }]
  if (row.changed)
    pieces.push({ text: `  ${AS3(row.changed.was)}`, color: warning })
  if (row.removed)
    pieces.push({
      text: `  ${AS8(row.removed.was, row.path.key === "volume")}`,
      color: warning,
    })
  return pieces
}

/**
 * The lines of `rows` in `inner` columns: each section's heading where the
 * section changes, then each row, its value going on under itself, never
 * under the labels.
 */
export function rowLines(
  rows: readonly SettingRow[],
  inner: number,
  warning: string
): RowLine[] {
  const label = labelWidth(rows, inner)
  const room = inner - MARKER_WIDTH - label
  const lines: RowLine[] = []
  let section: string | undefined
  rows.forEach((row, at) => {
    if (row.section !== section) {
      section = row.section
      lines.push({ kind: "heading", text: row.section })
    }
    linesOf(valuePieces(row, warning), room).forEach((pieces, index) =>
      lines.push({
        kind: "row",
        row: at,
        ...(index === 0 ? { label: cut(row.label, label - 1) } : {}),
        pieces,
      })
    )
  })
  return lines
}

/** The line of `lines` where row `row` starts. */
export const lineOfRow = (lines: readonly RowLine[], row: number): number =>
  Math.max(
    0,
    lines.findIndex((line) => line.kind === "row" && line.row === row)
  )

/**
 * The Compose text as the lines it is drawn in, `inner` columns wide, faint:
 * a line wider than the pane goes on under itself, at its own indent. Each
 * line is cleaned (`sanitize`), as every line from the file is; the reader
 * already refuses a character drawn as nothing (security review S2).
 */
export function composeLines(compose: string, inner: number): Piece[][] {
  const text = compose.endsWith("\n") ? compose.slice(0, -1) : compose
  return text.split("\n").flatMap((line) => {
    const clean = sanitize(line)
    const words = clean.trimStart()
    // The indent of a line of Compose text is a few spaces; half the pane at most is kept.
    const indent = " ".repeat(
      Math.min(clean.length - words.length, Math.floor(inner / 2))
    )
    return linesOf([{ text: words, dim: true }], inner - indent.length).map(
      (pieces) => [{ text: indent, dim: true }, ...pieces]
    )
  })
}

/** How far a text of `count` lines can be scrolled in `height` lines: until its last line shows, under the `↑ <n> more` line. */
export const maxScroll = (count: number, height: number): number =>
  count <= height ? 0 : count - height + 1

/**
 * Which lines of a text scrolled `scroll` lines down are drawn in `height`
 * lines: from `top` to `to`, with a line `↑ <n> more` above them when lines
 * are hidden above, and `↓ <n> more` below when lines are hidden below.
 * `top` is `scroll` kept within what can be scrolled.
 */
export function scrolled(
  count: number,
  scroll: number,
  height: number
): { top: number; to: number; above: number; below: number } {
  const top = Math.min(Math.max(0, scroll), maxScroll(count, height))
  const room = Math.max(1, height - (top > 0 ? 1 : 0))
  const to = count - top > room ? top + Math.max(1, room - 1) : count
  return { top, to, above: top, below: count - to }
}

/** The lines the Compose text has in the service pane at this window's size, below its first line. */
export function composeHeight(
  size: { columns: number; rows: number },
  status: number
): number {
  // The pane's border and its first line.
  return bodyRows(size, status, COMPOSE_HINTS) - 2 - 1
}
