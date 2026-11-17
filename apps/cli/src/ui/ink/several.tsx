/**
 * A list to pick several rows from (specs/012-templates, contracts/commands.md,
 * "Who reads the connection secret"; board `AddTemplate`, right column; plan.md,
 * D13), built from the one-row list's pieces (questions.tsx): the question, a
 * row per line with the marker on the selected one and `◉` on each picked
 * row, and the keys. ↑ and ↓ move and stop at the ends; space picks and
 * unpicks the selected row; Enter gives the picked rows, or, with none
 * picked, says why under the rows and stays open; Esc and Ctrl-C leave. It
 * opens with the first row picked.
 *
 * Nothing here decides what is asked or what an answer means: the caller
 * gives the rows and the reason, and is told the result once.
 */
import { Box, Text, useInput, useWindowSize } from "ink"
import { useRef, useState } from "react"

import { applySelectKey, MARKER } from "../parts/select"
import { BRAND } from "../terminal/theme"
import {
  FEWEST_ROWS,
  isCtrlC,
  LIST_SPARE_LINES,
  listWindow,
  moreLine,
  QuestionLine,
  questionPieces,
  Reason,
  type Settled,
} from "./questions"

/** The marks of a row picked and of one not. */
const PICKED = "◉"
const NOT_PICKED = "◯"

/**
 * What the list looks like: the question, the rows in view with their marks,
 * the reason under them when there is one, and the keys. `height` is the
 * window's, of which the list leaves the question, the keys, the reason and
 * two more lines to what is above it.
 */
export function SeveralView({
  question,
  labels,
  picked,
  selected,
  reason,
  columns,
  height,
}: {
  question: string
  labels: readonly string[]
  picked: readonly boolean[]
  selected: number
  reason?: string
  columns: number
  height: number
}) {
  const shown = listWindow(
    labels.length,
    selected,
    Math.max(
      FEWEST_ROWS,
      height - LIST_SPARE_LINES - (reason === undefined ? 0 : 1)
    )
  )
  return (
    <Box flexDirection="column">
      <QuestionLine pieces={questionPieces(question)} columns={columns} />
      {shown.above > 0 ? (
        <Text dimColor>{moreLine("↑", shown.above)}</Text>
      ) : null}
      {labels.slice(shown.from, shown.to).map((label, offset) => {
        const at = shown.from + offset
        return (
          <Box key={at} width={columns}>
            <Text wrap="truncate-end">
              {"  "}
              <Text color={BRAND}>{at === selected ? `${MARKER} ` : "  "}</Text>
              {picked[at] ? (
                <Text color="green">{PICKED}</Text>
              ) : (
                <Text dimColor>{NOT_PICKED}</Text>
              )}{" "}
              <Text bold={at === selected}>{label}</Text>
            </Text>
          </Box>
        )
      })}
      {shown.below > 0 ? (
        <Text dimColor>{moreLine("↓", shown.below)}</Text>
      ) : null}
      {reason === undefined ? null : <Reason text={reason} columns={columns} />}
      <Text>
        {"  "}↑↓ <Text dimColor>move</Text>
        {"   "}space <Text dimColor>pick</Text>
        {"   "}enter <Text dimColor>done</Text>
        {"   "}esc <Text dimColor>leave</Text>
      </Text>
    </Box>
  )
}

/**
 * The list at a terminal, reading keys. `atLeastOne` is the reason said when
 * Enter is pressed with no row picked. Settles once, with the indexes of the
 * picked rows in their order, or left.
 */
export function SeveralPrompt({
  question,
  labels,
  atLeastOne,
  settle,
}: {
  question: string
  labels: readonly string[]
  atLeastOne: string
  settle(result: Settled<number[]>): void
}) {
  const opening = labels.map((_, index) => index === 0)
  const [selected, setSelected] = useState(0)
  const [picked, setPicked] = useState<readonly boolean[]>(opening)
  const [reason, setReason] = useState<string | undefined>(undefined)
  // Several keys read at once reach here before React draws again, so the selection and the picks are kept here too.
  const current = useRef({ selected: 0, picked: opening })
  const settled = useRef(false)
  const { columns, rows: height } = useWindowSize()
  const end = (result: Settled<number[]>) => {
    if (settled.current) return
    settled.current = true
    settle(result)
  }
  useInput((input, key) => {
    if (settled.current) return
    if (isCtrlC(input, key)) return end({ left: true })
    const now = current.current
    if (input === " " && !key.ctrl && !key.meta) {
      const next = now.picked.map((on, index) =>
        index === now.selected ? !on : on
      )
      current.current = { ...now, picked: next }
      setPicked(next)
      return
    }
    const result = applySelectKey(now.selected, labels.length, key)
    if (result.kind === "moved") {
      current.current = { ...now, selected: result.index }
      setSelected(result.index)
    } else if (result.kind === "cancelled") end({ left: true })
    else if (result.kind === "chosen") {
      const chosen = now.picked.flatMap((on, index) => (on ? [index] : []))
      if (chosen.length === 0) setReason(atLeastOne)
      else end({ answer: chosen })
    }
  })
  return (
    <SeveralView
      question={question}
      labels={labels}
      picked={picked}
      selected={selected}
      {...(reason === undefined ? {} : { reason })}
      columns={columns}
      height={height}
    />
  )
}
