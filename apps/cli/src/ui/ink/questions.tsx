/**
 * The questions single commands ask at a terminal (specs/006-cli-small-features,
 * contracts/questions.md): a list to pick from, and a one-line answer to type.
 * The keys follow what the full-screen app's lists and answers already do
 * (`applySelectKey`, `applyTextInput`), which are imported and not changed.
 *
 * Nothing here decides what is asked or what an answer means: the caller
 * gives the rows and the check, and is told the result once. Leaving (Esc,
 * Ctrl-C) is told too, and the caller turns it into `Left`.
 */
import { Box, Text, useInput, useWindowSize } from "ink"
import { useRef, useState } from "react"

import { sanitize } from "../../server/sanitize"
import { applySelectKey, MARKER } from "../parts/select"
import { applyTextInput } from "../parts/text-input"
import { BRAND } from "../terminal/theme"
import type { ListRow } from "../types"
import { Wrapped, type Piece } from "./wrap"

/** A9: the hidden prompt that can be skipped, given nothing. Needs approval (research Q4). */
export const VALUE_EMPTY = "A value cannot be empty. Press esc to skip it."

/** A10: the same prompt, given a value of several lines. Needs approval (research Q4). */
export const valueHasLines = (name: string): string =>
  `That value has more than one line. Press esc to skip it, and set it later with \`zekno secret set ${sanitize(name)} --stdin\`.`

/** The narrowest label column of a list, as mock-ups 1 and 2 draw it. */
const LABEL_COLUMN = 11

/**
 * The width of a list's label column: `max(11, longest label + 2)`. Only rows
 * with a detail count: a row with no detail, such as `+ a new app`, ends after
 * its label, and lines nothing up (mock-up 2).
 */
export function labelWidth(rows: readonly Pick<ListRow<unknown>, "label" | "detail">[]): number {
  const longest = Math.max(0, ...rows.filter((row) => row.detail !== undefined).map((row) => [...row.label].length))
  return Math.max(LABEL_COLUMN, longest + 2)
}

/** The fewest rows a list ever shows, however small the window. */
const FEWEST_ROWS = 3

/** Which rows of a list are drawn, and how many are hidden above and below them. */
export type ListWindow = { from: number; to: number; above: number; below: number }

/**
 * The rows drawn when a list of `count` rows has `height` lines for its rows
 * and its `↑ <n> more` and `↓ <n> more` lines (A13): all of them when they
 * fit, else a window around the selected row, of at least three rows.
 */
export function listWindow(count: number, selected: number, height: number): ListWindow {
  if (count <= height) return { from: 0, to: count, above: 0, below: 0 }
  const fit = (shown: number): ListWindow => {
    const rows = Math.min(count, Math.max(FEWEST_ROWS, shown))
    const from = Math.max(0, Math.min(selected - Math.floor((rows - 1) / 2), count - rows))
    return { from, to: from + rows, above: from, below: count - from - rows }
  }
  // Room for one "more" line first; when rows are hidden on both sides, for two.
  const one = fit(height - 1)
  return one.above > 0 && one.below > 0 ? fit(height - 2) : one
}

/** A13: the line that says how many rows are hidden above or below. Needs approval (research Q4). */
export const moreLine = (direction: "↑" | "↓", count: number): string => `  ${direction} ${count} more`

/**
 * The lines of the window a list may not use: its question, its hint, and two
 * more, so that the list stays inside the window and what is above it shows.
 */
const LIST_SPARE_LINES = 4

/** Where a question's first sentence ends: a full stop or a question mark before a space. */
const FIRST_SENTENCE = /[.?](?=\s)/

/**
 * A text's first sentence and the rest after it, the space between included
 * in `rest`; all of it is `first` when it is one sentence. `0.2.0.` ends a
 * sentence only at its last full stop, the one a space follows.
 */
export function firstSentence(text: string): { first: string; rest: string } {
  const end = text.search(FIRST_SENTENCE)
  return end === -1 ? { first: text, rest: "" } : { first: text.slice(0, end + 1), rest: text.slice(end + 1) }
}

/**
 * Words whose first sentence is bold and the rest in the text colour, as the
 * boards of feature 006 draw a question (`Remember this folder? It writes
 * zekno.json, ...`; a question of one sentence is bold whole) and the newer
 * release `zekno version` reports (board "The version, and a newer release"),
 * as pieces for words that wrap (`Wrapped`).
 */
export function questionPieces(text: string): Piece[] {
  const { first, rest } = firstSentence(text)
  return rest === "" ? [{ text: first, bold: true }] : [{ text: first, bold: true }, { text: rest }]
}

/**
 * A question's line: `?` in the brand colour, then its words, which go on
 * under themselves, from column 2, when the window is narrower than the line
 * (`Wrapped`). `columns` is the window's width.
 */
export function QuestionLine({ pieces, columns }: { pieces: readonly Piece[]; columns: number | undefined }) {
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        <Text color={BRAND}>?</Text>
      </Box>
      <Wrapped pieces={pieces} columns={columns === undefined ? undefined : columns - 2} />
    </Box>
  )
}

/** The pieces of a typed answer's line after its question: the dim `›`, then the answer. */
export const answerPieces = (answer: string): Piece[] => [{ text: " " }, { text: "›", dim: true }, { text: ` ${answer}` }]

/**
 * How a question ends: with an answer, or left (Esc, Ctrl-C). `typed` is the
 * answer so far of a typed question that was left, kept on its line.
 */
export type Settled<T> = { answer: T } | { left: true; typed?: string }

/** A key, as Ink reports it, of the kinds a question reads. */
type QuestionKey = { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; ctrl?: boolean; meta?: boolean; backspace?: boolean; delete?: boolean }

/** Whether a key is Ctrl-C, which leaves every question. Ink does not act on it here (`exitOnCtrlC: false`). */
export const isCtrlC = (input: string, key: QuestionKey): boolean => key.ctrl === true && input === "c"

/**
 * A list to pick one row from (mock-ups 1 and 2): the question, a row per
 * line with the marker on the selected one, and the keys. ↑ and ↓ move and
 * stop at the ends; Enter chooses; Esc and Ctrl-C leave. The selected row's
 * label is bold; a row with no detail, such as `+ a new app`, is dim until it
 * is selected (board "Questions in single commands").
 */
export function ListPrompt<T>({ question, rows, settle }: { question: string; rows: readonly ListRow<T>[]; settle(result: Settled<number>): void }) {
  const [selected, setSelected] = useState(0)
  // Several keys read at once reach here before React draws again, so the selection is kept here too.
  const current = useRef(0)
  const settled = useRef(false)
  const { columns, rows: height } = useWindowSize()
  const end = (result: Settled<number>) => {
    if (settled.current) return
    settled.current = true
    settle(result)
  }
  useInput((input, key) => {
    if (settled.current) return
    if (isCtrlC(input, key)) return end({ left: true })
    const result = applySelectKey(current.current, rows.length, key)
    if (result.kind === "moved") {
      current.current = result.index
      setSelected(result.index)
    } else if (result.kind === "chosen") end({ answer: result.index })
    else if (result.kind === "cancelled") end({ left: true })
  })
  const width = labelWidth(rows)
  const shown = listWindow(rows.length, selected, Math.max(FEWEST_ROWS, height - LIST_SPARE_LINES))
  return (
    <Box flexDirection="column">
      <QuestionLine pieces={questionPieces(question)} columns={columns} />
      {shown.above > 0 ? <Text dimColor>{moreLine("↑", shown.above)}</Text> : null}
      {rows.slice(shown.from, shown.to).map((row, offset) => {
        const at = shown.from + offset === selected
        return (
          <Box key={shown.from + offset} width={columns}>
            <Text wrap="truncate-end">
              {"  "}
              <Text color={BRAND}>{at ? `${MARKER} ` : "  "}</Text>
              <Text bold={at} dimColor={!at && row.detail === undefined}>
                {row.detail === undefined ? row.label : row.label.padEnd(width)}
              </Text>
              {row.detail === undefined ? null : <Text dimColor>{row.detail}</Text>}
            </Text>
          </Box>
        )
      })}
      {shown.below > 0 ? <Text dimColor>{moreLine("↓", shown.below)}</Text> : null}
      <Text>
        {"  "}↑↓ <Text dimColor>move</Text>
        {"   "}enter <Text dimColor>choose</Text>
        {"   "}esc <Text dimColor>leave</Text>
      </Text>
    </Box>
  )
}

/**
 * A one-line answer to type: `? <question> › <answer>` and the cursor. Enter
 * checks it: a wrong answer stays as typed, with the reason under it, until
 * Enter is pressed again. The reason is drawn as the board "Questions in
 * single commands" draws it: in the warning colour, in line with the
 * question's words (column 2), with no mark. Esc and Ctrl-C leave. A paste of
 * several lines changes nothing (`applyTextInput`).
 */
export function TypedPrompt({
  question,
  fill,
  check,
  settle,
}: {
  question: string
  fill?: string
  check(answer: string): string | undefined
  settle(result: Settled<string>): void
}) {
  const [answer, setAnswer] = useState(fill ?? "")
  const [reason, setReason] = useState<string | undefined>(undefined)
  // Several keys read at once reach here before React draws again, so the answer so far is kept here too.
  const current = useRef(fill ?? "")
  const settled = useRef(false)
  const { columns } = useWindowSize()
  const end = (result: Settled<string>) => {
    if (settled.current) return
    settled.current = true
    settle(result)
  }
  useInput((input, key) => {
    if (settled.current) return
    if (isCtrlC(input, key)) return end({ left: true, typed: current.current })
    const next = applyTextInput(current.current, input, key)
    if (next.kind === "cancelled") return end({ left: true, typed: current.current })
    current.current = next.value
    setAnswer(next.value)
    if (next.kind !== "done") return
    const wrong = check(next.value)
    setReason(wrong)
    if (wrong === undefined) end({ answer: next.value })
  })
  return (
    <Box flexDirection="column">
      <QuestionLine pieces={[...questionPieces(question), ...answerPieces(answer), { text: " ", inverse: true, keep: true }]} columns={columns} />
      {reason === undefined ? null : (
        <Box paddingLeft={2}>
          <Wrapped pieces={[{ text: reason, color: "yellow" }]} columns={columns - 2} />
        </Box>
      )}
    </Box>
  )
}
