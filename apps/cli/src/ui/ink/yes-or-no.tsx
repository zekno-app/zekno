/**
 * The yes-or-no question single commands ask at a terminal (`Ui.confirm`):
 * answered with one key, no by default. How it opens, with raw mode on and
 * what was typed before it thrown away: raw-mode.tsx.
 */
import { useInput, useWindowSize } from "ink"

import { isCtrlC, QuestionLine, questionPieces } from "./questions"
import type { Piece } from "./wrap"

/** A yes-or-no question. With `leave`, Esc and Ctrl-C leave instead of answering no. */
export type Question = {
  question: string
  leave: boolean
  settle(answer: boolean | "left"): void
}

/** The dim `(y/N)` after a yes-or-no question, a space before it. */
export const yesOrNoPieces: Piece[] = [
  { text: " " },
  { text: "(y/N)", dim: true },
]

/** What a key answers to a yes-or-no question: `y` is yes; `n`, Enter, Esc and Ctrl-C are no; anything else, nothing yet. */
export function yesOrNo(
  input: string,
  key: { return?: boolean; escape?: boolean; ctrl?: boolean }
): boolean | undefined {
  if (key.ctrl) return input === "c" ? false : undefined
  if (key.return || key.escape) return false
  if (input === "y" || input === "Y") return true
  if (input === "n" || input === "N") return false
  return undefined
}

/** A yes-or-no question, answered with one key. Asked with `leave`, Esc and Ctrl-C leave it. */
export function QuestionPrompt({ question }: { question: Question }) {
  const { columns } = useWindowSize()
  useInput((input, key) => {
    if (question.leave && (key.escape || isCtrlC(input, key)))
      return question.settle("left")
    const answer = yesOrNo(input, key)
    if (answer !== undefined) question.settle(answer)
  })
  return (
    <QuestionLine
      pieces={[...questionPieces(question.question), ...yesOrNoPieces]}
      columns={columns}
    />
  )
}
