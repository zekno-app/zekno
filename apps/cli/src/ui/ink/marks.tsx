/**
 * What the lines of single commands at a terminal are built from: the marks
 * a result, a warning and an error start with (`✔`, `!`, `✖`) in their
 * colours, a line after a mark, an error in its two looks, the width left
 * inside the window, and commands drawn without the backticks plain output
 * keeps around them. The app draws its own lines from the same parts
 * (app/notice.tsx), so an error looks the same in both.
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

/** A sentence's end: a full stop before a space or a line break. */
export const SENTENCE_END = /\.(?=\s)/

/**
 * An error's words as they are drawn: its first sentence, and the rest,
 * without the backticks plain output keeps around commands.
 */
export function errorParts(text: string): { first: string; rest: string } {
  const shown = withoutBackticks(text)
  const end = shown.search(SENTENCE_END)
  return end === -1
    ? { first: shown, rest: "" }
    : { first: shown.slice(0, end + 1), rest: shown.slice(end + 1).trim() }
}

/**
 * An error as the board "Status, lists, errors and piped output" draws it:
 * its first sentence, in bold after ✖, and the rest faint on the lines
 * below, in line with that sentence. Commands are drawn as the board draws
 * them, without the backticks plain output keeps around them. `color` is
 * the mark's: the terminal's red, or the app's own red for its theme.
 */
export function ErrorLine({
  text,
  columns,
  color = COLOR.error,
}: {
  text: string
  columns?: number
  color?: string
}) {
  const { first, rest } = errorParts(text)
  return (
    <Box flexDirection="column">
      <MarkedLine
        mark={MARK.error}
        color={color}
        pieces={[{ text: first, bold: true }]}
        columns={columns}
      />
      {rest ? (
        <Box paddingLeft={2}>
          <Wrapped
            pieces={[{ text: rest, dim: true }]}
            columns={inside(columns, 2)}
          />
        </Box>
      ) : null}
    </Box>
  )
}
