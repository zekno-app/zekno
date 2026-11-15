/**
 * `zekno deploy` and `zekno rollback` at a terminal, as on the board "zekno
 * deploy: success and failure": the summary panel, the stage row and the
 * result line with what to run next; when the app did not start, what Docker
 * reported. The panel, the stage row and the words are the app's own
 * (app/screens/deploy.tsx), so the single command and the app look the same.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { numberUsed, stagesOf, Summary } from "../../app/screens/deploy"
import type { DeployProgress } from "../../app/state/types"
import { seconds } from "../../shared/time"
import { earlierLeftOut, failedNext, startedNext, type DeployStart } from "../../shared/deploy"
import { Panel } from "../parts/panel"
import { Stages } from "../parts/stages"
import { useTheme } from "../terminal/theme"

/** The widest the panels get, as the app's summary panel. Narrower windows get panels as wide as they are. */
export const DEPLOY_PANEL_WIDTH = 64

/** A deploy as the terminal shows it: while it runs, `deploy.lines` holds the latest of Docker's lines; once it ended, those kept. */
export type DeployShown = {
  start: DeployStart
  deploy: DeployProgress
  /** How many of Docker's lines came before those kept. */
  dropped: number
  /** How long it took, once it ended. */
  ms?: number
}

/** A sentence that leads a result: its mark, and the sentence in bold. */
function Lead({ mark, color, children }: { mark: string; color: string; children: ReactNode }) {
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        <Text color={color}>{mark}</Text>
      </Box>
      <Text>{children}</Text>
    </Box>
  )
}

/** A faint line under a result, in line with its sentence. */
function After({ children }: { children: ReactNode }) {
  return (
    <Box paddingLeft={2}>
      <Text dimColor>{children}</Text>
    </Box>
  )
}

/**
 * The deploy, drawn at `columns` wide. While it runs: the panel, the stage
 * row and the latest of Docker's lines. Once it ended: the result, and for a
 * start that failed, Docker's lines in the panel "Docker said". A deploy that
 * was refused or broke off ends with its stage row; the error is said after
 * it. Every part fits the window: panels are no wider than it, and text
 * wraps inside its own box, so a narrow window wraps, it never breaks lines.
 */
/** How far Docker's live line is set in from the left edge. */
export const LIVE_LINE_INDENT = 2

export function DeployBlock({ shown, columns }: { shown: DeployShown; columns: number }) {
  const theme = useTheme()
  const { start, deploy } = shown
  const width = Math.max(4, Math.min(columns, DEPLOY_PANEL_WIDTH))
  const failed = !deploy.running && deploy.outcome === "start_failed"
  return (
    // A line's space before it, as on the board below the command typed, and once it ended, after it.
    <Box flexDirection="column" rowGap={1} width={Math.max(4, columns)} paddingTop={1} paddingBottom={deploy.running ? 0 : 1}>
      <Summary deploy={deploy} width={width} tone="plain" />
      <Stages stages={stagesOf(deploy)} gap={2} />
      {deploy.running ? (
        // Docker's words, not zekno's: dim, and set in by two columns, so nothing a server says
        // starts at the left edge, where zekno's own lines start.
        <Box paddingLeft={LIVE_LINE_INDENT}>
          <Text dimColor wrap="truncate-end">
            {deploy.lines.at(-1)?.trimStart() || " "}
          </Text>
        </Box>
      ) : null}
      {!deploy.running && deploy.outcome === "started" ? (
        <Box flexDirection="column">
          <Lead mark="✔" color={theme.success}>
            <Text bold>
              {deploy.app} is live on {deploy.server}
            </Text>
            {shown.ms === undefined ? null : <Text dimColor> in {seconds(shown.ms)}</Text>}
          </Lead>
          <After>{startedNext(start.flags)}</After>
        </Box>
      ) : null}
      {failed ? (
        <Box flexDirection="column">
          <Lead mark="✖" color={theme.danger}>
            <Text bold>
              {deploy.server} accepted deploy {deploy.sequence}, but the app did not start.
            </Text>
          </Lead>
          {numberUsed(deploy) ? (
            <After>
              Number {deploy.sequence} is used, so the next deploy will be {deploy.sequence! + 1}.
            </After>
          ) : null}
        </Box>
      ) : null}
      {failed && deploy.lines.length > 0 ? (
        <Panel title="Docker said" tone="danger" width={width}>
          {shown.dropped > 0 ? <Text dimColor>{earlierLeftOut(shown.dropped)}</Text> : null}
          {deploy.lines.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Panel>
      ) : null}
      {failed ? <Text dimColor>{failedNext(start)}</Text> : null}
    </Box>
  )
}
