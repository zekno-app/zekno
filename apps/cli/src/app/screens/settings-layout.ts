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
import { AS3, AS8, AS9 } from "../../settings/words"
import { wrapPieces, type Piece } from "../../ui/ink/wrap"
import type { KeyHint } from "../../ui/parts/key-hints"
import { LOGO_HEIGHT } from "../../ui/terminal/logo"
import type { Notice } from "../../shared/notice"
import { noticeRows } from "../notice"
import { widthOf } from "./home/rows"

/** The Services pane's width, at every size (contracts/app-screen.md). */
export const SERVICES_WIDTH = 22
/** The narrowest label column of a row: a label padded to 11 (contracts/app-screen.md). */
export const LABEL_WIDTH = 11
/** The selection marker's column. */
export const MARKER_WIDTH = 2
/** The label column of the change's `now` and `new` rows (board `AppSettingsEdit`). */
export const NOW_WIDTH = 5
/**
 * The most lines a value takes on the settings screen, in a row and in the
 * change box, when it does not fit whole: the rest is said by AS9 on the
 * line under it (security review S4).
 */
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

/** The lines of the line above the hints: waiting for a deploy, or a notice, as it is drawn (app/notice.tsx); none without either. */
export function statusRows(
  status: { notice?: Notice; quitting: boolean },
  width: number
): number {
  if (status.quitting) return 1
  if (!status.notice) return 0
  return noticeRows(status.notice, width)
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
 * A mark (AS3, AS8) as pieces in the warning colour, its `!` held to the
 * word after it (`keep`): where the mark wraps, the line breaks before the
 * `!`, never between it and its words.
 */
export function markPieces(mark: string, warning: string): Piece[] {
  if (!mark.startsWith("! ")) return [{ text: mark, color: warning }]
  return [
    { text: "! ", color: warning, keep: true },
    { text: mark.slice(2), color: warning },
  ]
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
    pieces.push(
      { text: "  ", color: warning },
      ...markPieces(AS3(row.changed.was), warning)
    )
  if (row.removed)
    pieces.push(
      { text: "  ", color: warning },
      ...markPieces(AS8(row.removed.was, row.path.key === "volume"), warning)
    )
  return pieces
}

/** A mark's old value, cut to one line of `room` columns: it is what runs now, not what the next deploy runs, and the whole of it is in `zekno settings`. */
function shortWas(row: SettingRow, room: number): SettingRow {
  const was = (text: string) => cut(text, Math.max(room, 8))
  return {
    ...row,
    ...(row.changed?.was === undefined
      ? {}
      : { changed: { was: was(row.changed.was) } }),
    ...(row.removed === undefined
      ? {}
      : { removed: { was: was(row.removed.was) } }),
  }
}

/**
 * The lines of one row's value in `room` columns (security review S4): the
 * whole value and its mark when the value takes at most `VALUE_LINES` lines;
 * else its first `VALUE_LINES` lines and, under them, AS9 (how many more,
 * and that `c` shows them), faint, then the mark. A mark's old value takes
 * one line at most. So no value a deploy runs is drawn partly without a
 * word that more of it is not drawn, and no row is taller than a few lines.
 */
export function rowValueLines(
  row: SettingRow,
  room: number,
  warning: string,
  key = true
): Piece[][] {
  const short = shortWas(row, room)
  const value = linesOf([{ text: row.shown, dim: !row.set }], room)
  if (value.length <= VALUE_LINES)
    return linesOf(valuePieces(short, warning), room)
  const mark = valuePieces(short, warning).slice(1)
  return [
    ...value.slice(0, VALUE_LINES),
    ...linesOf(
      [{ text: AS9(value.length - VALUE_LINES, key), dim: true }, ...mark],
      room
    ),
  ]
}

/**
 * The lines of `rows` in `inner` columns: each section's heading where the
 * section changes, then each row, its value going on under itself, never
 * under the labels, cut as `rowValueLines` says. `key`: whether AS9 names
 * `c`, which does nothing while a change is open.
 */
export function rowLines(
  rows: readonly SettingRow[],
  inner: number,
  warning: string,
  key = true
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
    rowValueLines(row, room, warning, key).forEach((pieces, index) =>
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

/**
 * Which of a service's lines a window draws: `↑ <above> more` when lines are
 * hidden above; `heading`, the section heading of the first row drawn, when
 * that row is not the first of its section, so a row never shows without its
 * heading; the lines `from` to `to`; and `↓ <below> more` when lines are
 * hidden below. `above` counts every line before the first row drawn but its
 * heading, which is drawn; `below` every line after the last row drawn.
 */
export type RowsShown = {
  above: number
  heading?: string
  from: number
  to: number
  below: number
}

/** The lines a window takes: its `more` lines, its heading kept above the rows, and its lines. */
const shownHeight = (shown: RowsShown): number =>
  (shown.above > 0 ? 1 : 0) +
  (shown.heading === undefined ? 0 : 1) +
  (shown.to - shown.from) +
  (shown.below > 0 ? 1 : 0)

/** Where a row's lines start and end, and its section's heading: its line and its words. */
type RowSpan = {
  start: number
  end: number
  heading?: { at: number; text: string }
}

/** Each row's lines, in the order of the rows. */
function rowSpans(lines: readonly RowLine[]): RowSpan[] {
  const spans: RowSpan[] = []
  let heading: RowSpan["heading"]
  lines.forEach((line, at) => {
    if (line.kind === "heading") heading = { at, text: line.text }
    else {
      const span = spans[line.row]
      if (span) span.end = at + 1
      else spans[line.row] = { start: at, end: at + 1, heading }
    }
  })
  return spans
}

/** The window of rows `first` to `last`, each whole, with the heading of the first. */
function rowsFrom(
  lines: readonly RowLine[],
  spans: readonly RowSpan[],
  first: number,
  last: number
): RowsShown {
  const { start, heading } = spans[first]!
  const end = spans[last]!.end
  const below = lines.length - end
  // The first row of its section: its heading is drawn in its own place, just above it.
  if (heading === undefined || heading.at === start - 1) {
    const from = heading?.at ?? start
    return { above: from, from, to: end, below }
  }
  // Rows of its section hidden above: the heading is kept above the row, and only it, of the lines before, is drawn.
  return {
    above: start - 1,
    heading: heading.text,
    from: start,
    to: end,
    below,
  }
}

/**
 * The window of a service's rows in `height` lines (contracts/app-screen.md,
 * "80 by 24" and "As built: after the review of the screens"): every line
 * when they fit; else whole rows around the selected one, never a row's
 * lines in part, and the first row's section heading always drawn: in its
 * place, or kept on the line under `↑ <n> more` when rows of its section are
 * hidden above. The rows are added one at a time on the side with fewer
 * lines drawn, below first, so the selected row stays near the middle, as
 * `listWindow` keeps it. Only a row taller than the whole window, which a
 * long notice at 80 by 24 can make, is drawn from its first line as far as
 * there is room, the rest counted in `↓ <n> more`.
 */
export function rowWindow(
  lines: readonly RowLine[],
  selected: number,
  height: number
): RowsShown {
  const spans = rowSpans(lines)
  if (lines.length <= height || spans.length === 0)
    return { above: 0, from: 0, to: lines.length, below: 0 }
  const at = Math.min(Math.max(0, selected), spans.length - 1)
  let first = at
  let last = at
  let shown = rowsFrom(lines, spans, first, last)
  if (shownHeight(shown) > height) {
    // The selected row alone does not fit: its first lines, at least one, and the rest counted below.
    while (shownHeight(shown) > height && shown.to > spans[at]!.start + 1)
      shown = { ...shown, to: shown.to - 1, below: shown.below + 1 }
    return shown
  }
  for (;;) {
    const up = first > 0 ? rowsFrom(lines, spans, first - 1, last) : undefined
    const down =
      last < spans.length - 1
        ? rowsFrom(lines, spans, first, last + 1)
        : undefined
    const upFits = up !== undefined && shownHeight(up) <= height
    const downFits = down !== undefined && shownHeight(down) <= height
    if (!upFits && !downFits) return shown
    const before = spans[at]!.start - spans[first]!.start
    const after = spans[last]!.end - spans[at]!.end
    if (downFits && (!upFits || after <= before)) {
      last++
      shown = down
    } else {
      first--
      shown = up!
    }
  }
}

/** The fewest lines a window needs to draw the selected row whole, with its heading and its `more` lines. */
export const rowsLeast = (
  lines: readonly RowLine[],
  selected: number
): number => {
  const spans = rowSpans(lines)
  if (spans.length === 0) return 0
  const at = Math.min(Math.max(0, selected), spans.length - 1)
  return shownHeight(rowsFrom(lines, spans, at, at))
}

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
