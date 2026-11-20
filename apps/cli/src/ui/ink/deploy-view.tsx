/**
 * `zekno deploy` and `zekno rollback` at a terminal, as on the board "zekno
 * deploy: success and failure": the summary panel, the stage row and the
 * result line with what to run next; when the app did not start, what Docker
 * reported. The panel, the stage row and the words are the app's own
 * (ui/parts/deploy-summary.tsx), so the single command and the app look the same.
 */
import { Box, Text, useAnimation } from "ink"
import type { ReactNode } from "react"

import { B4, B5, B6, C2 } from "../../domains/words"
import { seconds } from "../../shared/time"
import {
  earlierLeftOut,
  failedNext,
  startedNext,
  type DeployProgress,
  type DeployStart,
  type HttpsShown,
} from "../../shared/deploy"
import { stoppedWaiting } from "../../shared/start-limit"
import { numberUsed, stagesOf, Summary } from "../parts/deploy-summary"
import { Panel } from "../parts/panel"
import { Spinner, Stages } from "../parts/stages"
import { useTheme } from "../terminal/theme"
import { ErrorLine, MARK, MarkedLine, withoutBackticks } from "./marks"
import { wrapPieces, type Piece } from "./wrap"

/** The widest the panels get, as the app's summary panel. Narrower windows get panels as wide as they are. */
export const DEPLOY_PANEL_WIDTH = 64

/** A deploy as the terminal shows it: while it runs, `deploy.lines` holds the latest of Docker's lines; once it ended, those kept. */
export type DeployShown = {
  start: DeployStart
  deploy: DeployProgress
  /** How many of Docker's lines came before those kept. */
  dropped: number
  /** How long it took, once it ended, or once the wait for HTTPS began. */
  ms?: number
  /** For `routes_failed` and `unhealthy`: their sentence (B16 to B19, C3, C4; specs/015-domains-https, CL3). */
  problem?: string
  /** For `start_failed`: the limit in whole seconds at which the runner stopped waiting for the start, when it did (B20). */
  startLimit?: number
}

/** The whole seconds since `since`, dim, two spaces after the words: B4's and C2's count, redrawn as it goes. */
function SecondsSince({ since }: { since: number }) {
  useAnimation({ interval: 250 })
  return (
    <Text dimColor>
      {"  "}
      {Math.max(0, Math.floor((Date.now() - since) / 1000))}s
    </Text>
  )
}

/** B4, live, on one line: the spinner of the stage row, the words, and the seconds since `since`, dim (board `DomainsDeploy`). */
function Waiting({ text, since }: { text: string; since: number }) {
  return (
    <Text wrap="truncate-end">
      <Spinner /> {text}
      <SecondsSince since={since} />
    </Text>
  )
}

/** The words of B5 and B6 after their mark, as pieces: B5's detail dim, B6's command without its backticks. */
const httpsPieces = (
  shown: Exclude<HttpsShown, { state: "waiting" }>
): Piece[] => {
  if (shown.state === "not_ready")
    return [{ text: withoutBackticks(B6(shown.domain)) }]
  const live = B5(shown.domain, shown.until)
  return [{ text: `${live.text}  ` }, { text: live.detail, dim: true }]
}

/** The rows a new domain's line takes `columns` wide (`HttpsLine`): B4 one, B5 and B6 as their words wrap after the mark. */
export const httpsRows = (shown: HttpsShown, columns: number): number =>
  shown.state === "waiting"
    ? 1
    : wrapPieces(httpsPieces(shown), Math.max(1, columns - 2)).length

/**
 * A new domain's line during and after the wait for HTTPS (specs/015-domains-https,
 * CL3): B4, live; B5 after ✔, its detail dim; B6 after !, a warning. The words
 * go on under themselves when the window is narrower than the line.
 */
export function HttpsLine({
  shown,
  columns,
}: {
  shown: HttpsShown
  columns?: number
}) {
  const theme = useTheme()
  if (shown.state === "waiting")
    return <Waiting text={B4(shown.domain)} since={shown.since} />
  return (
    <MarkedLine
      mark={shown.state === "live" ? MARK.success : MARK.warn}
      color={shown.state === "live" ? theme.success : theme.warning}
      pieces={httpsPieces(shown)}
      columns={columns}
    />
  )
}

/**
 * C2, while the runner waits for a service's health with a path, under the
 * stage row in the live line's place: dim, with the seconds since the wait
 * began at a terminal (board `DomainsHealth`) and without them in the app,
 * whose header counts the time (board `DomainsApp`). Nothing for a health
 * check without a path, which has no line of its own: Docker's line stays.
 */
export function HealthWait({
  deploy,
  seconds,
}: {
  deploy: DeployProgress
  seconds: boolean
}) {
  const waiting = deploy.waitingFor
  if (waiting?.path === undefined) return null
  return (
    <Text dimColor wrap="truncate-end">
      {C2(waiting.service, waiting.path)}
      {seconds ? <SecondsSince since={waiting.since} /> : null}
    </Text>
  )
}

/** Whether a running deploy draws C2 in the live line's place (`HealthWait`). */
export const healthWaitShown = (deploy: DeployProgress): boolean =>
  deploy.running && deploy.waitingFor?.path !== undefined

/** A sentence that leads a result: its mark, and the sentence in bold. */
function Lead({
  mark,
  color,
  children,
}: {
  mark: string
  color: string
  children: ReactNode
}) {
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

export function DeployBlock({
  shown,
  columns,
}: {
  shown: DeployShown
  columns: number
}) {
  const theme = useTheme()
  const { start, deploy } = shown
  const width = Math.max(4, Math.min(columns, DEPLOY_PANEL_WIDTH))
  const failed = !deploy.running && deploy.outcome === "start_failed"
  // The app started and new domains are waited for (B4): drawn as started while it lasts (board `DomainsDeploy`).
  const waiting = deploy.running && deploy.https !== undefined
  const live = waiting || (!deploy.running && deploy.outcome === "started")
  return (
    // A line's space before it, as on the board below the command typed, and once it ended, after it.
    <Box
      flexDirection="column"
      rowGap={1}
      width={Math.max(4, columns)}
      paddingTop={1}
      paddingBottom={deploy.running ? 0 : 1}
    >
      <Summary deploy={deploy} width={width} tone="plain" />
      <Stages stages={stagesOf(deploy)} gap={2} />
      {deploy.running && !waiting ? (
        // Docker's words, not zekno's: dim, and set in by two columns, so nothing a server says
        // starts at the left edge, where zekno's own lines start. C2 while a service's health is waited for.
        <Box paddingLeft={LIVE_LINE_INDENT}>
          {healthWaitShown(deploy) ? (
            <HealthWait deploy={deploy} seconds />
          ) : (
            <Text dimColor wrap="truncate-end">
              {deploy.lines.at(-1)?.trimStart() || " "}
            </Text>
          )}
        </Box>
      ) : null}
      {live ? (
        <Box flexDirection="column">
          <Lead mark="✔" color={theme.success}>
            <Text bold>
              {deploy.app} is live on {deploy.server}
            </Text>
            {shown.ms === undefined ? null : (
              <Text dimColor> in {seconds(shown.ms)}</Text>
            )}
          </Lead>
          {(deploy.https ?? []).map((each) => (
            <HttpsLine key={each.domain} shown={each} columns={columns} />
          ))}
          {waiting ? null : <After>{startedNext(start.flags)}</After>}
        </Box>
      ) : null}
      {!deploy.running && shown.problem !== undefined ? (
        <ErrorLine text={shown.problem} columns={columns} />
      ) : null}
      {failed ? (
        <Box flexDirection="column">
          <Lead mark="✖" color={theme.danger}>
            <Text bold>
              {shown.startLimit === undefined ? (
                <>
                  {deploy.server} accepted deploy {deploy.sequence}, but the app
                  did not start.
                </>
              ) : (
                stoppedWaiting(
                  deploy.server,
                  deploy.sequence!,
                  deploy.app,
                  shown.startLimit
                )
              )}
            </Text>
          </Lead>
          {numberUsed(deploy) ? (
            <After>
              Number {deploy.sequence} is used, so the next deploy will be{" "}
              {deploy.sequence! + 1}.
            </After>
          ) : null}
        </Box>
      ) : null}
      {failed && deploy.lines.length > 0 ? (
        <Panel title="Docker said" tone="danger" width={width}>
          {shown.dropped > 0 ? (
            <Text dimColor>{earlierLeftOut(shown.dropped)}</Text>
          ) : null}
          {deploy.lines.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Panel>
      ) : null}
      {failed ? <Text dimColor>{failedNext(start)}</Text> : null}
    </Box>
  )
}
