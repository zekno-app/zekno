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

import { sanitize } from "../sanitize"
import { applySelectKey, MARKER } from "./select"
import { applyTextInput } from "./text-input"
import { BRAND } from "./theme"
import type { ListRow } from "./types"

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

/** How a question ends: with an answer, or left (Esc, Ctrl-C). */
export type Settled<T> = { answer: T } | { left: true }

/** A key, as Ink reports it, of the kinds a question reads. */
type QuestionKey = { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; ctrl?: boolean; meta?: boolean; backspace?: boolean; delete?: boolean }

/** Whether a key is Ctrl-C, which leaves every question. Ink does not act on it here (`exitOnCtrlC: false`). */
export const isCtrlC = (input: string, key: QuestionKey): boolean => key.ctrl === true && input === "c"

/**
 * A list to pick one row from (mock-ups 1 and 2): the question, a row per
 * line with the marker on the selected one, and the keys. ↑ and ↓ move and
 * stop at the ends; Enter chooses; Esc and Ctrl-C leave.
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
      <Text>
        <Text color={BRAND}>?</Text> {question}
      </Text>
      {shown.above > 0 ? <Text dimColor>{moreLine("↑", shown.above)}</Text> : null}
      {rows.slice(shown.from, shown.to).map((row, offset) => {
        const at = shown.from + offset === selected
        return (
          <Box key={shown.from + offset} width={columns}>
            <Text wrap="truncate-end">
              {"  "}
              <Text color={BRAND}>{at ? `${MARKER} ` : "  "}</Text>
              <Text bold={at}>{row.detail === undefined ? row.label : row.label.padEnd(width)}</Text>
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
 * checks it: a wrong answer stays as typed, with `! <reason>` under it, until
 * Enter is pressed again. Esc and Ctrl-C leave. A paste of several lines
 * changes nothing (`applyTextInput`).
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
  const end = (result: Settled<string>) => {
    if (settled.current) return
    settled.current = true
    settle(result)
  }
  useInput((input, key) => {
    if (settled.current) return
    if (isCtrlC(input, key)) return end({ left: true })
    const next = applyTextInput(current.current, input, key)
    if (next.kind === "cancelled") return end({ left: true })
    current.current = next.value
    setAnswer(next.value)
    if (next.kind !== "done") return
    const wrong = check(next.value)
    setReason(wrong)
    if (wrong === undefined) end({ answer: next.value })
  })
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={BRAND}>?</Text> {question} <Text dimColor>›</Text> {answer}
        <Text inverse> </Text>
      </Text>
      {reason === undefined ? null : (
        <Text>
          <Text color="yellow">!</Text> {reason}
        </Text>
      )}
    </Box>
  )
}
