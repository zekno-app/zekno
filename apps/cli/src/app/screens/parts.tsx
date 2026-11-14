/**
 * Pieces Home, the app screen and the deploy screen share: a pane as the
 * boards draw them (a box with its title on its first line), a table cell, a
 * label and its value, and an app's running state.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { MARKER } from "../../ui/select"
import { useTheme } from "../../ui/theme"
import type { RunState } from "../state"

/**
 * A pane of Home or the app screen: a rounded box with its title on its
 * first line and, optionally, something on the right of that line. The pane
 * that has the keys has a brand border and a bold title; the others are faint.
 */
export function Pane({
  title,
  right,
  focused = false,
  width,
  children,
}: {
  title: ReactNode
  right?: ReactNode
  focused?: boolean
  /** A fixed width, or undefined to take the room that is left. */
  width?: number
  children?: ReactNode
}) {
  const theme = useTheme()
  return (
    <Box
      flexDirection="column"
      width={width}
      flexGrow={width === undefined ? 1 : 0}
      flexShrink={width === undefined ? 1 : 0}
      borderStyle="round"
      borderColor={focused ? theme.brand : undefined}
      borderDimColor={!focused}
      paddingX={1}
      rowGap={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between" columnGap={1} flexShrink={0}>
        <Text bold dimColor={!focused} wrap="truncate-end">
          {title}
        </Text>
        {right ? <Box flexShrink={0}>{right}</Box> : null}
      </Box>
      {children}
    </Box>
  )
}

/**
 * One cell of a table row: a fixed width, or the room that is left. It never
 * wraps, and its last column is always left empty, so a cell that is cut
 * short never runs into the next.
 */
export function Cell({ width, children }: { width?: number; children: ReactNode }) {
  return (
    <Box
      width={width}
      flexGrow={width === undefined ? 1 : 0}
      flexShrink={width === undefined ? 1 : 0}
      flexBasis={width === undefined ? 0 : undefined}
      paddingRight={1}
    >
      <Text wrap="truncate-end">{children}</Text>
    </Box>
  )
}

/** The selection marker's column: the arrow for the selected row, the same space empty for the rest. */
export function Marker({ selected }: { selected: boolean }) {
  const theme = useTheme()
  return (
    <Box width={2} flexShrink={0}>
      <Text color={theme.brand}>{selected ? MARKER : " "}</Text>
    </Box>
  )
}

/** Faint labels and their values, one pair to a line, as the boards' details lists. */
export function Fields({ rows, labelWidth }: { rows: readonly (readonly [label: string, value: ReactNode])[]; labelWidth: number }) {
  return (
    <Box flexDirection="column">
      {rows.map(([label, value]) => (
        <Box key={label}>
          <Box width={labelWidth} flexShrink={0}>
            <Text dimColor wrap="truncate-end">
              {label}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} flexBasis={0}>
            <Text wrap="truncate-end">{value}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** A faint rule across a pane, between its list and its details. */
export function Rule() {
  return <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderDimColor flexShrink={0} />
}

/**
 * The words of a state cell with `room` columns: `● partly running`, or
 * where it does not fit, its first words that do (`● partly`), never a word
 * cut in the middle.
 */
export function stateWords(state: RunState, room?: number): string {
  const words = `● ${state}`
  if (room === undefined || words.length <= room) return words
  const parts = words.split(" ")
  let kept = parts[0]!
  for (const part of parts.slice(1)) {
    if (kept.length + 1 + part.length > room) break
    kept = `${kept} ${part}`
  }
  return kept
}

/**
 * Whether an app is running, by a word and a symbol as well as a colour
 * (FR-008): `● running`, `● stopped`, `● partly running`, and a faint
 * `● unknown` when it has not been read. In a column of `room` columns that
 * is too narrow, it is cut at a word (`stateWords`).
 */
export function StateCell({ state, room }: { state: RunState; room?: number }) {
  const theme = useTheme()
  const color = { running: theme.success, stopped: theme.danger, "partly running": theme.warning, unknown: undefined }[state]
  return (
    <Text color={color} dimColor={state === "unknown"}>
      {stateWords(state, room)}
    </Text>
  )
}
