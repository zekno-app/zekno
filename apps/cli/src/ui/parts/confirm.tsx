import { Box } from "ink"
import type { ReactNode } from "react"

import { KeyHints } from "./key-hints"
import { Panel, type PanelTone } from "./panel"

/** One answer to a question the app asks, and the key that gives it: `enter`, `esc` or one letter. */
export type Choice<Answer extends string> = {
  key: string
  answer: Answer
  does: string
}

type Key = {
  return?: boolean
  escape?: boolean
  ctrl?: boolean
  meta?: boolean
}

/** The name of the key pressed, as choices name keys: `enter`, `esc`, or the letter itself. */
export function keyName(input: string, key: Key): string | undefined {
  if (key.return) return "enter"
  if (key.escape) return "esc"
  if (key.ctrl || key.meta) return undefined
  return input.length === 1 ? input : undefined
}

/** The answer a key gives, or undefined when that key is not one of the choices. */
export function applyConfirmKey<Answer extends string>(
  choices: readonly Choice<Answer>[],
  input: string,
  key: Key
): Answer | undefined {
  const name = keyName(input, key)
  return choices.find((choice) => choice.key === name)?.answer
}

/**
 * A question in a panel with its choices on its last line, as on the board
 * "Two questions the app asks".
 */
export function Confirm<Answer extends string>({
  title,
  tone = "focus",
  choices,
  children,
}: {
  title: string
  tone?: PanelTone
  choices: readonly Choice<Answer>[]
  children?: ReactNode
}) {
  return (
    <Panel title={title} tone={tone}>
      <Box flexDirection="column" rowGap={1}>
        {children}
        <KeyHints
          hints={choices.map((choice) => [choice.key, choice.does] as const)}
        />
      </Box>
    </Panel>
  )
}
