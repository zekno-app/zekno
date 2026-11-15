import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { KeyHints, type KeyHint } from "../ui/parts/key-hints"
import { Logo } from "../ui/terminal/logo"
import { useTheme } from "../ui/terminal/theme"
import type { Notice } from "./state/types"

/** FR-005: shown on every screen that has nothing of its own on the right of its header. */
export const PRE_ALPHA = "pre-alpha, unaudited"

/** Where a screen is in the app: `› prod › demo › deploy`, the last part bold. */
export function Trail({ parts }: { parts: readonly string[] }) {
  return (
    <Text wrap="truncate-end">
      {parts.map((part, index) => (
        <Text key={index}>
          {index > 0 ? " " : ""}
          <Text dimColor>›</Text> {index === parts.length - 1 ? <Text bold>{part}</Text> : <Text dimColor>{part}</Text>}
        </Text>
      ))}
    </Text>
  )
}

/**
 * The header of every screen: the wordmark, the screen's place in the app
 * and, on the right, `right` (by default "pre-alpha, unaudited"), both on the
 * wordmark's last line.
 */
export function Header({
  place,
  right = <Text dimColor>{PRE_ALPHA}</Text>,
  logo = true,
}: {
  place?: ReactNode
  right?: ReactNode
  logo?: boolean
}) {
  return (
    <Box justifyContent="space-between" alignItems="flex-end" columnGap={2} flexShrink={0}>
      <Box alignItems="flex-end" columnGap={1} flexShrink={1}>
        {logo ? <Logo /> : null}
        {place}
      </Box>
      <Box flexShrink={0}>{right}</Box>
    </Box>
  )
}

/** A line on the current screen about something done elsewhere: a mark and a sentence, never colour alone. */
export function NoticeLine({ notice }: { notice: Notice }) {
  const theme = useTheme()
  if (notice.tone === "info") return <Text dimColor>{notice.text}</Text>
  const mark = { success: ["✔", theme.success], error: ["✖", theme.danger], warning: ["!", theme.warning] }[notice.tone]
  return (
    <Text>
      <Text color={mark[1]}>{mark[0]}</Text> {notice.text}
    </Text>
  )
}

/**
 * One screen of the app: header, body, a line about something done
 * elsewhere when there is one, and the key hints as the last line. The body
 * takes what room is left and is cut, never the hints.
 */
export function Frame({
  header,
  hints,
  status,
  children,
}: {
  header: ReactNode
  hints: readonly KeyHint[]
  status?: ReactNode
  children?: ReactNode
}) {
  return (
    <Box flexDirection="column" flexGrow={1} rowGap={1}>
      {header}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {children}
      </Box>
      {status ? <Box flexShrink={0}>{status}</Box> : null}
      <Box flexShrink={0}>
        <KeyHints hints={hints} />
      </Box>
    </Box>
  )
}
