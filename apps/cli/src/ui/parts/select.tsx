import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { useTheme } from "../terminal/theme"

/** The keys a list reads. A subset of what Ink reports. */
export type ListKey = {
  upArrow?: boolean
  downArrow?: boolean
  return?: boolean
  escape?: boolean
}

/** What one key press does to a list. */
export type SelectResult =
  | { kind: "moved"; index: number }
  | { kind: "chosen"; index: number }
  | { kind: "cancelled" }
  | { kind: "ignored" }

/** Keeps a selection inside a list of `count` rows. An empty list selects row 0, which is not there. */
export const clampIndex = (index: number, count: number): number =>
  Math.max(0, Math.min(index, count - 1))

/**
 * Applies one key to a list with `count` rows and `index` selected. The
 * selection stops at the first and last rows; it does not wrap around.
 */
export function applySelectKey(
  index: number,
  count: number,
  key: ListKey
): SelectResult {
  if (key.escape) return { kind: "cancelled" }
  if (count <= 0) return { kind: "ignored" }
  const at = clampIndex(index, count)
  if (key.upArrow)
    return at > 0 ? { kind: "moved", index: at - 1 } : { kind: "ignored" }
  if (key.downArrow)
    return at < count - 1
      ? { kind: "moved", index: at + 1 }
      : { kind: "ignored" }
  if (key.return) return { kind: "chosen", index: at }
  return { kind: "ignored" }
}

/** The selection marker, in the column every row keeps for it. */
export const MARKER = "❯"

/**
 * One row of a list: the arrow and bold text when selected, the same space
 * left empty when not. Never a shaded bar: the marker and bold text say it.
 */
export function SelectRow({
  selected,
  children,
}: {
  selected: boolean
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text color={theme.brand}>{selected ? MARKER : " "}</Text>
      </Box>
      <Text bold={selected}>{children}</Text>
    </Box>
  )
}

export type SelectItem = { key: string; label: string; muted?: boolean }

/** A plain list of one-line rows with one selected. Lists with columns build their rows from `SelectRow`. */
export function Select({
  items,
  selected,
}: {
  items: readonly SelectItem[]
  selected: number
}) {
  const at = clampIndex(selected, items.length)
  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <SelectRow key={item.key} selected={index === at}>
          <Text dimColor={item.muted}>{item.label}</Text>
        </SelectRow>
      ))}
    </Box>
  )
}
