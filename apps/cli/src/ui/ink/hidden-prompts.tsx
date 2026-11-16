/**
 * The hidden prompts single commands open at a terminal: the one of `zekno
 * secret set` (`Ui.askSecret`), and the one of a first deploy, which can be
 * skipped (`Ui.askValue`). Nothing of a value is drawn, not even its length,
 * and it is never kept in React state. How a prompt opens, with raw mode on
 * and what was typed before it thrown away, and how raw mode stays on between
 * two hidden values: raw-mode.tsx.
 */
import { Box, useInput, useWindowSize } from "ink"
import { useRef, useState } from "react"

import { CliError } from "../../cli/errors"
import {
  isCtrlC,
  QuestionLine,
  questionPieces,
  Reason,
  VALUE_EMPTY,
  valueHasLines,
} from "./questions"
import { applySecretInput } from "../parts/secret-input"
import { withoutBackticks } from "./marks"
import type { Piece } from "./wrap"

export type Prompt = {
  question: string
  settle(result: { value: string } | { error: Error }): void
}
/** The hidden prompt that can be skipped. `name` is the secret's, for the sentence about a value of several lines. */
export type ValueOpen = {
  id: number
  question: string
  name: string
  settle(
    result:
      { kind: "value"; value: string } | { kind: "skipped" } | { kind: "left" }
  ): void
}

/** What follows the question of the hidden prompt that can be skipped while it is open: `(hidden)` and `esc skips it`, dim. Nothing of the value. */
export const hiddenPieces: Piece[] = [
  { text: "(hidden)", dim: true },
  { text: "   " },
  { text: "esc skips it", dim: true },
]

/**
 * Asks for a value and shows nothing of it, not even its length. A value it
 * refuses (several lines) ends the command with that error, as before: it
 * draws no reason of its own (specs/008-cli-decisions).
 */
export function SecretPrompt({ prompt }: { prompt: Prompt }) {
  // Kept out of React state: nothing is drawn from it, so nothing redraws as it grows.
  const value = useRef("")
  const { columns } = useWindowSize()
  useInput((input, key) => {
    const next = applySecretInput(value.current, input, key)
    if (next.kind === "typing") value.current = next.value
    else if (next.kind === "done") prompt.settle({ value: next.value })
    else if (next.kind === "cancelled")
      prompt.settle({ error: new CliError("Cancelled.") })
    else prompt.settle({ error: new CliError(next.reason) })
  })
  return (
    <QuestionLine
      pieces={[
        ...questionPieces(prompt.question),
        { text: "(hidden)", dim: true },
      ]}
      columns={columns}
    />
  )
}

/**
 * The hidden prompt of a first deploy (contracts/questions.md): nothing of
 * the value is drawn, not even its length, and it is never kept in React
 * state. Esc skips the value; Ctrl-C leaves. Nothing, or several lines, is
 * refused with its reason under the line, drawn as a refused typed answer's
 * (`Reason`: the warning colour, column 2, no `!`), and the prompt stays open.
 * A command in the reason is drawn without its backticks, as in an error line
 * (specs/008-cli-decisions).
 */
export function ValuePrompt({ open }: { open: ValueOpen }) {
  const value = useRef("")
  const { columns } = useWindowSize()
  const [reason, setReason] = useState<string | undefined>(undefined)
  useInput((input, key) => {
    if (isCtrlC(input, key)) return open.settle({ kind: "left" })
    if (key.escape) {
      value.current = ""
      return open.settle({ kind: "skipped" })
    }
    const next = applySecretInput(value.current, input, key)
    if (next.kind === "typing") {
      value.current = next.value
      return
    }
    value.current = ""
    if (next.kind === "done" && next.value !== "")
      return open.settle({ kind: "value", value: next.value })
    setReason(next.kind === "done" ? VALUE_EMPTY : valueHasLines(open.name))
  })
  return (
    <Box flexDirection="column">
      <QuestionLine
        pieces={[...questionPieces(open.question), ...hiddenPieces]}
        columns={columns}
      />
      {reason === undefined ? null : (
        <Reason text={withoutBackticks(reason)} columns={columns} />
      )}
    </Box>
  )
}
