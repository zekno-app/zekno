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
  TYPING_HINTS,
  VALUE_LINES,
  wholeInner,
} from "./settings-layout"
import { Lines, RowWindow } from "./settings-rows"

/** The hints of the change's stage (contracts/app-screen.md, "Keys"): asking names the value `n` keeps. */
export function changeHints(change: ScreenChange): readonly KeyHint[] {
  if (change.stage === "typing") return TYPING_HINTS
  if (change.stage === "picking") return PICKING_HINTS
  return askChoices(cut(change.now, KEEP_WIDTH)).map(
    (choice) => [choice.key, choice.does] as const
  )
}

/** The words of the setting being changed: its label after `<svc> · ` and its question. */
const wordsOf = (path: SettingPath) =>
  settingWords(
    path.key,
    path.key === "plain" || path.key === "volume" ? path.name : ""
  )

/** Lines of `pieces` in `width` columns, at most `most`; the last one kept ends with "…" when more were cut. */
function capped(pieces: readonly Piece[], width: number, most: number) {
  const lines = linesOf(pieces, width)
  if (lines.length <= most) return lines
  const kept = lines.slice(0, most)
  const last = kept[most - 1]!
  const text = last.map((piece) => piece.text).join("")
  kept[most - 1] = [{ ...last[0], text: cut(`${text}…`, width) }]
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

/** A label of the box, faint, padded to its column, and the lines of its value after it. */
function labelled(label: string, value: Piece[], inner: number): Piece[][] {
  return capped(value, inner - NOW_WIDTH, VALUE_LINES).map((line, index) => [
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
  file = SETTINGS_FILE
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
  lines.push(
    ...labelled(AS5.now, [{ text: change.now }], inner),
    ...labelled(
      AS5.new,
      [{ text: change.next?.shown ?? "", bold: true }],
      inner
    ),
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
  const inner = wholeInner(columns)
  const box = boxLines(
    service,
    change,
    theme,
    boxInner(columns),
    read.report.file
  )
  return (
    <Pane
      title={service}
      right={<Text dimColor>{read.report.file}</Text>}
      gap={0}
      dimTitle={false}
    >
      <RowWindow
        rows={shown}
        selected={Math.max(0, shown.indexOf(rows[at]!))}
        inner={inner}
        // The pane's border, its first line, and the box with its border.
        height={body - 2 - 1 - box.length - 2}
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
