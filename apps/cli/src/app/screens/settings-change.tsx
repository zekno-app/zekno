/**
 * Changing a setting on the settings screen (specs/010-app-settings,
 * contracts/app-screen.md, "Changing a value"; board `AppSettingsEdit`):
 * while a change is open the Services pane is not drawn; one pane with a
 * faint border holds the service's first line, the section of the row being
 * changed, and at its foot the change box, its border in the brand colour.
 * The box types the value (`? Memory limit › 1g`), picks the restart rule
 * from a list, or shows the old and the new value and asks y/N before
 * anything is written.
 *
 * The box's lines are built here as pieces and broken before they are
 * drawn, so the rows above it always know the room they have.
 */
import { Box, Text } from "ink"

import { sanitize } from "../../server/sanitize"
import { buildRowId, isBuildPath } from "../../settings/build-values"
import { SETTINGS_FILE } from "../../settings/file"
import type { SettingPath, SettingRow } from "../../settings/types"
import { AS4, AS5, CS9, restartShown, settingWords } from "../../settings/words"
import { firstSentence } from "../../ui/ink/questions"
import type { Piece } from "../../ui/ink/wrap"
import type { KeyHint } from "../../ui/parts/key-hints"
import { useTheme, type Theme } from "../../ui/terminal/theme"
import type { ReadOutcome } from "../state/reading"
import { askChoices, RESTARTS } from "../state/settings-change"
import type { ScreenChange } from "../state/types"
import { Pane } from "./parts"
import { widthOf } from "./home/rows"
import {
  boxInner,
  cut,
  KEEP_WIDTH,
  linesOf,
  NOW_WIDTH,
  PICKING_HINTS,
  rowLines,
  rowsLeast,
  TYPING_HINTS,
  VALUE_LINES,
  wholeInner,
} from "./settings-layout"
import { Lines, RowWindow } from "./settings-rows"

/** The fewest lines a window of rows takes: a `more` line above and below, the heading and two rows. */
const ROWS_LEAST = 5

/** The hints of the change's stage (contracts/app-screen.md, "Keys"): asking names the value `n` keeps. */
export function changeHints(change: ScreenChange): readonly KeyHint[] {
  if (change.stage === "typing") return TYPING_HINTS
  if (change.stage === "picking") return PICKING_HINTS
  return askChoices(cut(change.now, KEEP_WIDTH)).map(
    (choice) => [choice.key, choice.does] as const
  )
}

/**
 * The words of the setting being changed: its label after `<svc> · ` and its
 * question. A Build row's are its row's id until the words tasks
 * (specs/016-build-from-source, J18; FR-092).
 */
const wordsOf = (path: SettingPath): { label: string; question: string } =>
  isBuildPath(path)
    ? { label: buildRowId(path.key), question: buildRowId(path.key) }
    : settingWords(
        path.key,
        path.key === "plain" || path.key === "volume" ? path.name : ""
      )

/** How many characters before the first difference stay in view when a value is cut around it. */
const BEFORE_CHANGE = 16

/** Where two values first differ, in characters: the length of the shorter when one begins the other. */
function firstDifference(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  let at = 0
  while (at < left.length && at < right.length && left[at] === right[at]) at++
  return at
}

/**
 * A value of the box in `width` columns: whole when `most` lines hold it;
 * else cut around `from`, where the old and the new value first differ, so
 * the change itself is in view (the walkthrough's rough edge): a faint `…`
 * for what is left out before it, at most `most` lines from there, and `…`
 * at the end of the last for what is left out after. No key is named: none
 * of the screen's keys works while the box is open.
 */
function around(
  value: string,
  style: Omit<Piece, "text">,
  from: number,
  width: number,
  most: number
): Piece[][] {
  const whole = linesOf([{ ...style, text: value }], width)
  if (whole.length <= most) return whole
  const chars = [...value]
  const start = from > BEFORE_CHANGE ? from - BEFORE_CHANGE : 0
  const lines = linesOf(
    [
      ...(start > 0 ? [{ text: "…", dim: true }] : []),
      { ...style, text: chars.slice(start).join("") },
    ],
    width
  )
  if (lines.length <= most) return lines
  const kept = lines.slice(0, most)
  const last = kept[most - 1]!
  const text = last.map((piece) => piece.text).join("")
  kept[most - 1] = [{ ...style, text: cut(`${text}…`, width) }]
  return kept
}

/**
 * The typed value as the question line shows it: whole when it fits in about
 * two lines, else its end after "…", so the cursor is always in view.
 */
function typedShown(typed: string, question: string, inner: number): string {
  const room = Math.max(8, inner * 2 - widthOf(question) - 6)
  if (widthOf(typed) <= room) return typed
  const chars = [...typed]
  let tail = ""
  for (let at = chars.length - 1; at >= 0; at--) {
    if (widthOf(`…${chars[at]}${tail}`) > room) break
    tail = `${chars[at]}${tail}`
  }
  return `…${tail}`
}

/** A label of the box, faint, padded to its column, and the lines of its value after it (`around`). */
function labelled(label: string, lines: Piece[][]): Piece[][] {
  return lines.map((line, index) => [
    { text: (index === 0 ? label : "").padEnd(NOW_WIDTH), dim: true },
    ...line,
  ])
}

/**
 * Every line inside the change box, in its look: `Change a setting` and the
 * setting; then the typed question and why it was refused; or the list of
 * restart rules; or the old and the new value and the question y/N.
 */
export function boxLines(
  service: string,
  change: ScreenChange,
  theme: Theme,
  inner: number,
  file = SETTINGS_FILE,
  most = VALUE_LINES
): Piece[][] {
  const words = wordsOf(change.path)
  const lines: Piece[][] = linesOf(
    [
      { text: AS4, bold: true },
      { text: "  " },
      { text: `${service} · ${words.label}`, dim: true },
    ],
    inner
  )
  const ask = (question: Piece[]): Piece[] => [
    { text: "?", color: theme.brand },
    { text: " " },
    ...question,
  ]
  if (change.stage === "typing") {
    lines.push(
      ...linesOf(
        ask([
          { text: words.question, bold: true },
          { text: " " },
          { text: "›", dim: true },
          // Filled in from the file: cleaned, as every value shown is, though the reader refuses what cleaning would take out.
          {
            text: ` ${typedShown(sanitize(change.typed), words.question, inner)}`,
          },
          { text: " ", inverse: true, keep: true },
        ]),
        inner
      )
    )
    // Why it was refused, in the warning colour, in line with the question's words.
    if (change.reason !== undefined)
      for (const line of linesOf(
        [{ text: change.reason, color: theme.warning }],
        inner - 2
      ))
        lines.push([{ text: "  " }, ...line])
    return lines
  }
  if (change.stage === "picking") {
    lines.push(ask([{ text: words.question, bold: true }]))
    RESTARTS.forEach((rule, index) => {
      const at = index === change.pick
      lines.push([
        { text: "  " },
        { text: at ? "❯ " : "  ", color: theme.brand },
        { text: restartShown(rule), bold: at, dim: !at },
      ])
    })
    return lines
  }
  const { first, rest } = firstSentence(CS9(file))
  const next = change.next?.shown ?? ""
  const from = firstDifference(change.now, next)
  const width = inner - NOW_WIDTH
  lines.push(
    ...labelled(AS5.now, around(change.now, {}, from, width, most)),
    ...labelled(AS5.new, around(next, { bold: true }, from, width, most)),
    ...linesOf(
      ask([
        { text: first, bold: true },
        { text: rest },
        { text: " " },
        { text: "(y/N)", dim: true },
      ]),
      inner
    )
  )
  return lines
}

/** Whether a row is the one a path names. */
const isRowOf = (row: SettingRow, path: SettingPath): boolean =>
  !("adding" in row.path) &&
  row.path.service === path.service &&
  row.path.key === path.key &&
  (path.key !== "plain" && path.key !== "volume"
    ? true
    : "name" in row.path && row.path.name === path.name)

/**
 * Board `AppSettingsEdit`: one pane, its border faint, with the service's
 * name and the file on its first line, the section of the row being changed
 * with that row marked, and the change box at its foot.
 */
export function ChangePane({
  read,
  service,
  rows,
  change,
  columns,
  body,
}: {
  read: ReadOutcome
  service: string
  rows: readonly SettingRow[]
  change: ScreenChange
  columns: number
  /** The lines the frame leaves for this pane. */
  body: number
}) {
  const theme = useTheme()
  const at = rows.findIndex((row) => isRowOf(row, change.path))
  const section = rows[at]?.section
  const shown = rows.filter((row) => row.section === section)
  const selected = Math.max(0, shown.indexOf(rows[at]!))
  const inner = wholeInner(columns)
  // The fewest lines the rows above take: `ROWS_LEAST`, and never less than the row being changed whole, with its heading and the more lines.
  const least = Math.max(
    ROWS_LEAST,
    rowsLeast(rowLines(shown, inner, theme.warning, false), selected)
  )
  // The old and the new value whole when the pane holds them; else each cut around their first difference to the lines that fit.
  // The room: the pane's border, its first line, the box's border, and the fewest lines the rows above take.
  const room = body - 2 - 1 - 2 - least
  const boxOf = (most: number) =>
    boxLines(service, change, theme, boxInner(columns), read.report.file, most)
  let box = boxOf(Infinity)
  for (let most = VALUE_LINES; box.length > room && most >= 1; most--)
    box = boxOf(most)
  return (
    <Pane
      title={service}
      right={<Text dimColor>{read.report.file}</Text>}
      gap={0}
      dimTitle={false}
    >
      <RowWindow
        rows={shown}
        selected={selected}
        inner={inner}
        // The pane's border, its first line, and the box with its border.
        height={body - 2 - 1 - box.length - 2}
        keyNamed={false}
      />
      <Box flexGrow={1} />
      <Box
        flexDirection="column"
        flexShrink={0}
        borderStyle="round"
        borderColor={theme.brand}
        paddingX={1}
      >
        <Lines lines={box} />
      </Box>
    </Pane>
  )
}
