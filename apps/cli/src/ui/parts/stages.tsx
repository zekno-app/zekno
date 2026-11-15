import { Box, Text, useAnimation } from "ink"

import { useTheme } from "../terminal/theme"

/** Where one stage of a piece of work is. */
export type StageState = "done" | "active" | "failed" | "pending"

export type Stage = { label: string; state: StageState }

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** The spinner the boards show beside the stage in progress. The only motion in the app. */
export function Spinner() {
  const theme = useTheme()
  const { frame } = useAnimation({ interval: 80 })
  return <Text color={theme.brand}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>
}

/**
 * One stage: done is ✔, failed is ✖ and the label in red, the one in progress
 * has the spinner and a bold label, one not reached yet is ○ and faint (as on
 * the board "Add a server"). The symbol always says it, colour only adds to it.
 */
export function StageMark({ stage }: { stage: Stage }) {
  const theme = useTheme()
  switch (stage.state) {
    case "done":
      return (
        <Text>
          <Text color={theme.success}>✔</Text> {stage.label}
        </Text>
      )
    case "failed":
      return <Text color={theme.danger}>✖ {stage.label}</Text>
    case "active":
      return (
        <Text bold>
          <Spinner /> {stage.label}
        </Text>
      )
    case "pending":
      return <Text dimColor>○ {stage.label}</Text>
  }
}

/** The stage row of a deploy: Checked, Signed, Sent, Starting then Started. */
export function Stages({ stages, gap = 3 }: { stages: readonly Stage[]; gap?: number }) {
  return (
    <Box columnGap={gap} flexWrap="wrap">
      {stages.map((stage) => (
        <StageMark key={stage.label} stage={stage} />
      ))}
    </Box>
  )
}
