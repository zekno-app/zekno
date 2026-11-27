import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { Confirm } from "../../ui/parts/confirm"
import type { KeyHint } from "../../ui/parts/key-hints"
import { clampIndex } from "../../ui/parts/select"
import { useTheme } from "../../ui/terminal/theme"
import { Frame, Header, Trail } from "../frame"
import { appViewOf } from "../state/app"
import { CHOICES } from "../state/questions"
import type { Screen, State } from "../state/types"
import type { DeployRow, RunState, SecretRow } from "../../shared/views"
import { appDomainsOf, DomainsPane } from "./app-domains"
import { DeploysPane } from "./app-deploys"
import { Cell, Marker, Pane, StateCell } from "./parts"
import { HINTS } from "./placeholder"

type AppScreenState = Extract<Screen, { name: "app" }>

/** The secrets pane's width at 100 columns and more (board "One app: deploys and secrets"). */
export const SECRETS_WIDTH = 36
/**
 * Below 100 columns, as on the board "One app at 80 columns" (236 px of
 * 720): one column more than 236 px makes, so that its last line, "Values
 * are never shown.", fits on one line inside the border and padding as it
 * does on the board.
 */
export const NARROW_SECRETS_WIDTH = 27
/** Below this many columns the app screen is arranged as on the board "One app at 80 columns". */
export const APP_WIDE = 100
const VERSION_WIDTH = 11

/**
 * The note for secrets set or removed after the latest deploy the runner
 * accepted (FR-025), worded as on the board for one, and naming each when
 * there are several.
 */
export function changedNote(
  secrets: readonly SecretRow[],
  deploy: number | undefined
): string | undefined {
  const changed = secrets.filter((secret) => secret.afterDeploy)
  if (deploy === undefined || changed.length === 0) return undefined
  if (changed.length === 1) {
    const [secret] = changed
    return `${secret!.name} was ${secret!.removed ? "removed" : "set"} after deploy ${deploy}. It takes effect on the next deploy.`
  }
  const names = changed.map((secret) => secret.name)
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} changed after deploy ${deploy}. They take effect on the next deploy.`
}

/**
 * A secret's version below 100 columns, as on the board "One app at 80
 * columns": `v3`, or `removed`, and `!` after it when it changed after the
 * deploy that runs, in the warning colour; the pane's last lines say what
 * `!` means. Drawn at the pane's right edge, with no space after it.
 */
function ShortVersion({ secret }: { secret: SecretRow }) {
  const theme = useTheme()
  const words = `${secret.removed ? "removed" : `v${secret.version}`}${secret.afterDeploy ? " !" : ""}`
  return (
    <Box flexShrink={0}>
      <Text
        color={secret.afterDeploy ? theme.warning : undefined}
        dimColor={!secret.afterDeploy}
      >
        {words}
      </Text>
    </Box>
  )
}

function SecretsPane({
  secrets,
  selected,
  focused,
  latest,
  width,
  narrow,
  compact = false,
}: {
  secrets?: readonly SecretRow[]
  selected: number
  focused: boolean
  latest?: number
  width: number
  /** Below 100 columns: short versions and short last lines, as on the board "One app at 80 columns". */
  narrow: boolean
  /** Above the Domains box: as tall as it needs, no taller (board `DomainsApp`). */
  compact?: boolean
}) {
  const theme = useTheme()
  const rows = secrets ?? []
  const at = clampIndex(selected, rows.length + 1)
  const note = changedNote(rows, latest)
  const list = (
    <Box flexDirection="column" flexShrink={1} overflow="hidden">
      {/* Each row whole or not at all: a box too short for the rows cuts them, it never draws one over another. */}
      {rows.map((secret, index) => (
        <Box key={secret.name} flexShrink={0}>
          <Marker selected={focused && index === at} />
          <Cell>
            <Text
              bold={focused && index === at}
              dimColor={secret.removed}
              strikethrough={secret.removed}
            >
              {secret.name}
            </Text>
          </Cell>
          {narrow ? (
            <ShortVersion secret={secret} />
          ) : (
            <Cell width={VERSION_WIDTH}>
              <Text dimColor>
                {secret.removed ? "removed" : `version ${secret.version}`}
              </Text>
            </Cell>
          )}
        </Box>
      ))}
      <Box flexShrink={0}>
        <Marker selected={focused && at === rows.length} />
        <Text dimColor>+ set a secret</Text>
      </Box>
    </Box>
  )
  const foot = narrow ? (
    <Box flexDirection="column" flexShrink={0}>
      {note ? <Text color={theme.warning}>! not deployed yet</Text> : null}
      <Text dimColor>Values are never shown.</Text>
    </Box>
  ) : (
    <Box flexDirection="column" flexShrink={0}>
      <Text dimColor>Values are never shown. To change one, set it again.</Text>
      {note ? <Text color={theme.warning}>! {note}</Text> : null}
    </Box>
  )
  // Above the Domains box (board `DomainsApp`): as tall as what it holds, its foot right under its last row.
  if (compact)
    return (
      <Pane title="Secrets" focused={focused} flexGrow={0} flexShrink={1}>
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {list}
          {foot}
        </Box>
      </Pane>
    )
  return (
    <Pane title="Secrets" focused={focused} width={width}>
      {list}
      <Box flexGrow={1} />
      {foot}
    </Pane>
  )
}

/**
 * The deploy that runs now, from what the runner said: its last accepted
 * deploy, while every service of the app is running, and only if this
 * machine's history says that deploy started. A deploy that did not start
 * runs nothing, so then none is marked, and neither is any deploy before
 * the one the runner holds now. Undefined before the runner has answered.
 */
export function runningNow(
  deploys: readonly DeployRow[] | undefined,
  state: RunState,
  accepted: number | undefined
): number | undefined {
  if (state !== "running" || accepted === undefined) return undefined
  return deploys?.some(
    (deploy) => deploy.sequence === accepted && deploy.outcome === "started"
  )
    ? accepted
    : undefined
}

/** The answers to "remove this secret?", the reducer's own (state/questions.ts `CHOICES`). */
const REMOVE_HINTS: readonly KeyHint[] = CHOICES["remove-secret"].map(
  (choice) => [choice.key, choice.does] as const
)

/**
 * Board "One app: deploys and secrets": the deploy history from this
 * machine's verified history, the selected deploy's details, the secrets by
 * name and version, and the note for a secret changed after the latest
 * deploy. While "remove this secret?" is open it is the screen's body.
 */
export function AppScreen({
  state,
  screen,
  columns,
  status,
}: {
  state: State
  screen: AppScreenState
  columns: number
  status?: ReactNode
}) {
  const view = appViewOf(state, screen)
  const row = state.team?.servers
    .find((server) => server.name === screen.server)
    ?.apps.find((app) => app.name === screen.app)
  const runState: RunState = row?.state ?? "unknown"
  // The latest deploy the runner accepted, from this machine's history: what a secret changed after is measured against.
  const latest = view?.deploys.find(
    (deploy) => deploy.outcome !== "sent"
  )?.sequence
  // The header names the deploy the runner holds, once it has said; until then, or when it cannot be reached, this machine's.
  const shown = row?.accepted ?? latest
  const narrow = columns < APP_WIDE
  // The 80-column board shows the state alone.
  const right = (
    <Box columnGap={1}>
      <StateCell state={runState} />
      {shown !== undefined && !narrow ? (
        <Text dimColor>deploy {shown}</Text>
      ) : null}
    </Box>
  )
  const header = (
    <Header
      place={<Trail parts={[screen.server, screen.app]} />}
      right={right}
    />
  )
  const question =
    state.question?.kind === "remove-secret" ? state.question : undefined
  if (question) {
    return (
      <Frame header={header} hints={REMOVE_HINTS} status={status}>
        <Box width={Math.min(columns - 2, 64)}>
          <Confirm
            title={`Remove ${question.name}?`}
            tone="warning"
            choices={CHOICES["remove-secret"]}
          >
            <Text>
              {question.app} on {question.server} keeps it until the next
              deploy. The removal is signed now.
            </Text>
          </Confirm>
        </Box>
      </Frame>
    )
  }
  const domains = appDomainsOf(state, screen)
  const secretsWidth = narrow ? NARROW_SECRETS_WIDTH : SECRETS_WIDTH
  const secrets = (
    <SecretsPane
      secrets={view?.secrets}
      selected={screen.secret}
      focused={screen.pane === "secrets"}
      latest={latest}
      width={secretsWidth}
      narrow={narrow}
      compact={domains !== undefined}
    />
  )
  return (
    <Frame header={header} hints={HINTS.app} status={status}>
      <Box flexGrow={1} columnGap={1}>
        <DeploysPane
          deploys={view?.deploys}
          selected={screen.deploy}
          focused={screen.pane === "deploys"}
          now={new Date()}
          running={runningNow(view?.deploys, runState, row?.accepted)}
          narrow={narrow}
        />
        {domains === undefined ? (
          secrets
        ) : (
          // The Domains box under Secrets, in the same column (specs/015-domains-https, E7).
          <Box flexDirection="column" width={secretsWidth} flexShrink={0}>
            {secrets}
            <DomainsPane rows={domains} narrow={narrow} width={secretsWidth} />
          </Box>
        )}
      </Box>
    </Frame>
  )
}
