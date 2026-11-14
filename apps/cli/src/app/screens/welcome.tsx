import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { Logo } from "../../ui/logo"
import { Panel } from "../../ui/panel"
import { Spinner } from "../../ui/stages"
import { TextQuestion } from "../../ui/text-input"
import { useTheme } from "../../ui/theme"
import { Frame, Header } from "../frame"
import type { Screen } from "../state"
import { HINTS } from "./placeholder"

type WelcomeState = Extract<Screen, { name: "welcome" }>

/** The three steps of first run, as both first-run boards show them across the top. */
export const FIRST_RUN_STEPS = ["Your key", "A server", "First deploy"] as const

/**
 * The three steps: those done marked ✔, the current one bold with its number
 * in the brand colour, the rest faint.
 */
export function FirstRunSteps({ current }: { current: 1 | 2 | 3 }) {
  const theme = useTheme()
  return (
    <Box columnGap={3} flexShrink={0}>
      {FIRST_RUN_STEPS.map((label, index) => {
        const number = index + 1
        if (number < current) {
          return (
            <Text key={label}>
              <Text color={theme.success}>✔</Text> <Text dimColor>{label}</Text>
            </Text>
          )
        }
        if (number === current) {
          return (
            <Text key={label} bold>
              <Text color={theme.brand}>{number}</Text> {label}
            </Text>
          )
        }
        return (
          <Text key={label} dimColor>
            {number} {label}
          </Text>
        )
      })}
    </Box>
  )
}

/** The name question, or while the key is being created, the name with the spinner. */
function NameQuestion({ screen }: { screen: WelcomeState }) {
  const theme = useTheme()
  if (!screen.creating) return <TextQuestion label="Your name" value={screen.value} />
  return (
    <Text>
      <Text color={theme.brand}>?</Text> Your name <Text dimColor>›</Text> {screen.value} <Spinner />
    </Text>
  )
}

/**
 * Board "First run: no team yet": the wordmark, what zekno does, the three
 * steps with the first current, the question for a name, and where the key
 * is kept. The header has no wordmark of its own: it is in the body, as on
 * the board.
 */
export function WelcomeScreen({ screen, columns, rows, status }: { screen: WelcomeState; columns: number; rows: number; status?: ReactNode }) {
  const width = Math.min(columns - 10, 72)
  // In a short window the panel's blank lines go first, so the whole screen still fits.
  const roomy = rows >= 28
  return (
    <Frame header={<Header place={<Text dimColor>welcome</Text>} logo={false} />} hints={HINTS.welcome} status={status}>
      <Box flexDirection="column" rowGap={1} paddingX={3} flexShrink={0}>
        <Logo />
        <Box flexDirection="column" flexShrink={0}>
          <Text bold>Deploy to servers you own.</Text>
          <Text dimColor>Secrets are encrypted and deploys are signed on this machine.</Text>
        </Box>
        <FirstRunSteps current={1} />
        <Box width={width} flexShrink={0}>
          <Panel title="Create your signing key" tone="focus" flexGrow={1}>
            <Box flexDirection="column" rowGap={roomy ? 1 : 0}>
              <Text>Every deploy and every secret is signed with this key. Your servers refuse anything it did not sign.</Text>
              <NameQuestion screen={screen} />
              <Text dimColor>Shown to teammates next to what you sign.</Text>
            </Box>
          </Panel>
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          <Text dimColor>The key goes into your system keychain. It is never written to a file.</Text>
          <Text dimColor>If you lose this machine's keychain, the key cannot be recovered.</Text>
        </Box>
      </Box>
    </Frame>
  )
}
