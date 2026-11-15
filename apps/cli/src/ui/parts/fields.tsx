/** Faint labels and their values, as the boards' details lists: Home, the app screen and the deploy summary panel draw them. */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

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
