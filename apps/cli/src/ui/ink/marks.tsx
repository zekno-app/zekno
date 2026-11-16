/**
 * What the lines of single commands at a terminal are built from: the marks
 * a result, a warning and an error start with (`✔`, `!`, `✖`) in their
 * colours, a line after a mark, the width left inside the window, and
 * commands drawn without the backticks plain output keeps around them.
 */
import { Box, Text } from "ink"

import { Wrapped, type Piece } from "./wrap"

export const MARK = { success: "✔", warn: "!", error: "✖" } as const
export const COLOR = { success: "green", warn: "yellow", error: "red" } as const

/** A command in a sentence, as the boards draw it at a terminal: without the backticks plain output keeps around it. */
export const withoutBackticks = (text: string): string =>
  text.replace(/`([^`\n]+)`/g, "$1")

/** The width left inside a window `columns` wide once `taken` columns are set in, or none when the window's is not known. */
export const inside = (
  columns: number | undefined,
  taken: number
): number | undefined => (columns === undefined ? undefined : columns - taken)

/**
 * A line after a mark (`✔`, `!`, `✖`): the mark in its colour, a space, and
 * the words, which go on under themselves, never under the mark, when the
 * window is narrower than the line.
 */
export function MarkedLine({
  mark,
  color,
  pieces,
  columns,
}: {
  mark: string
  color?: string
  pieces: readonly Piece[]
  columns: number | undefined
}) {
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        <Text color={color}>{mark}</Text>
      </Box>
      <Wrapped pieces={pieces} columns={inside(columns, 2)} />
    </Box>
  )
}
