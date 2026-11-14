import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { useTheme } from "./theme"

/**
 * How a panel's border and title look, as on the boards:
 * `focus` brand border (the thing being worked on), `plain` faint border,
 * `quiet` faint border and faint title, `danger` red, `warning` yellow.
 */
export type PanelTone = "focus" | "plain" | "quiet" | "danger" | "warning"

/** Longer than any terminal is wide. The part that does not fit is clipped. */
const RULE = "─".repeat(512)

/**
 * A box with its title on the top line, as on the boards "A deploy in
 * progress" and "Set a secret". Ink's border has no title, so the top line is
 * drawn here and the box below it has no top border.
 */
export function Panel({
  title,
  tone = "plain",
  width,
  flexGrow,
  children,
}: {
  title: string
  tone?: PanelTone
  width?: number
  flexGrow?: number
  children?: ReactNode
}) {
  const theme = useTheme()
  const border = { focus: theme.brand, plain: undefined, quiet: undefined, danger: theme.danger, warning: theme.warning }[tone]
  const faint = border === undefined
  const titleColor = tone === "danger" ? theme.danger : tone === "warning" ? theme.warning : undefined
  return (
    <Box flexDirection="column" width={width} flexGrow={flexGrow} flexShrink={0}>
      <Box>
        <Text color={border} dimColor={faint}>
          {"╭─ "}
        </Text>
        <Text bold color={titleColor} dimColor={tone === "quiet"} wrap="truncate-end">
          {title}
        </Text>
        <Text> </Text>
        <Box flexGrow={1} flexShrink={1} flexBasis={0} height={1} overflow="hidden">
          <Text color={border} dimColor={faint}>
            {RULE}
          </Text>
        </Box>
        <Text color={border} dimColor={faint}>
          ╮
        </Text>
      </Box>
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderTop={false}
        borderColor={border}
        borderDimColor={faint}
        paddingX={1}
      >
        {children}
      </Box>
    </Box>
  )
}
