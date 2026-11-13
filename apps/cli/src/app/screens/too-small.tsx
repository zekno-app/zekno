import { Box, Text } from "ink"

import { KeyHints } from "../../ui/key-hints"
import { MIN_COLUMNS, MIN_ROWS } from "../state"

/** The width of the labels "this window" and "needed", and a space. */
const LABEL_WIDTH = 13

/**
 * Board "Terminal too small": shown instead of the screen below 80 columns or
 * 24 lines. The screen underneath is kept, and comes back when there is room.
 */
export function TooSmall({ columns, rows }: { columns: number; rows: number }) {
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="center" rowGap={1}>
      <Text bold>zekno needs a larger window.</Text>
      <Box flexDirection="column">
        <Box>
          <Box width={LABEL_WIDTH} flexShrink={0}>
            <Text dimColor>this window</Text>
          </Box>
          <Text>
            {columns} columns, {rows} lines
          </Text>
        </Box>
        <Box>
          <Box width={LABEL_WIDTH} flexShrink={0}>
            <Text dimColor>needed</Text>
          </Box>
          <Text>
            {MIN_COLUMNS} columns, {MIN_ROWS} lines
          </Text>
        </Box>
      </Box>
      <Text dimColor>Make the window larger and the app comes back where you were.</Text>
      <KeyHints hints={[["q", "quit"]]} />
    </Box>
  )
}
