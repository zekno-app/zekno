import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { KeyHint } from "../../ui/parts/key-hints"
import { Frame, Header, Trail } from "../frame"

/** The board "Help", column by column: each group's heading and its keys. */
export const HELP: readonly (readonly { heading: string; keys: readonly KeyHint[] }[])[] = [
  [
    {
      heading: "Move around",
      keys: [
        ["↑ ↓", "move in a list"],
        ["← →", "next pane"],
        ["tab", "next pane"],
        ["enter", "open, or confirm"],
        ["esc", "go back"],
      ],
    },
    {
      heading: "Anywhere",
      keys: [
        ["?", "this help"],
        ["q", "quit"],
      ],
    },
  ],
  [
    {
      heading: "An app",
      keys: [
        ["d", "deploy this folder"],
        ["r", "roll back"],
        ["l", "logs"],
        ["s", "set a secret"],
        ["x", "remove the selected secret"],
      ],
    },
    {
      heading: "Servers",
      keys: [
        ["a", "add a server"],
        ["u", "update the runner"],
      ],
    },
  ],
  [
    {
      heading: "Logs",
      keys: [
        ["f", "pause or resume following"],
        ["/", "filter by text"],
        ["1-9", "one service"],
        ["0", "all services"],
      ],
    },
    {
      heading: "While deploying",
      keys: [
        ["o", "show Docker's output"],
        ["esc", "back; the deploy carries on"],
      ],
    },
  ],
]

export const HELP_HINTS: readonly KeyHint[] = [["esc", "close help"]]

/** The width of the key column: "enter" and a space. */
const KEY_WIDTH = 6
/** Between the columns. */
const GAP = 3

/**
 * The width of each of the three columns in a window `columns` wide: what is
 * left after the app's margins, the border, its padding and the gaps. Whole
 * columns, so text wraps inside its column and never runs into the next.
 */
export const helpColumnWidth = (columns: number): number => Math.floor((columns - 2 - 2 - 2 - GAP * (HELP.length - 1)) / HELP.length)

/** Every key of the app, grouped as on the board "Help". `esc` closes it. */
export function HelpScreen({ columns, status }: { columns: number; status?: ReactNode }) {
  const width = helpColumnWidth(columns)
  return (
    <Frame header={<Header place={<Trail parts={["help"]} />} />} hints={HELP_HINTS} status={status}>
      <Box flexDirection="column" rowGap={1}>
        <Box borderStyle="round" borderDimColor paddingX={1} columnGap={GAP}>
          {HELP.map((column, index) => (
            <Box key={index} flexDirection="column" width={width} flexShrink={0} rowGap={1}>
              {column.map((group) => (
                <Box key={group.heading} flexDirection="column">
                  <Text bold dimColor>
                    {group.heading}
                  </Text>
                  {group.keys.map(([key, does]) => (
                    <Box key={key + does}>
                      <Box width={KEY_WIDTH} flexShrink={0}>
                        <Text bold>{key}</Text>
                      </Box>
                      <Box width={width - KEY_WIDTH}>
                        <Text>{does}</Text>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        <Text dimColor>Single commands for scripts: zekno --help</Text>
      </Box>
    </Frame>
  )
}
