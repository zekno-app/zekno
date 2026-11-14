import { Box, Text } from "ink"

/** One key and what it does here, as the last line of every screen shows it: `esc back`. */
export type KeyHint = readonly [key: string, does: string]

/**
 * The last line of every screen: each key that works there and what it does.
 * The key is in the text colour and its meaning is faint. When the line is
 * wider than the window it wraps; nothing is left out.
 */
export function KeyHints({ hints }: { hints: readonly KeyHint[] }) {
  return (
    <Box columnGap={2} flexWrap="wrap">
      {hints.map(([key, does]) => (
        <Text key={key}>
          {key} <Text dimColor>{does}</Text>
        </Text>
      ))}
    </Box>
  )
}
