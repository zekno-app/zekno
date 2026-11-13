import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { Confirm } from "../../ui/confirm"
import type { KeyHint } from "../../ui/key-hints"
import { clampIndex } from "../../ui/select"
import { useTheme } from "../../ui/theme"
import { Frame, Header, Trail } from "../frame"
import { appViewOf, CHOICES, type DeployRow, type RunState, type Screen, type SecretRow, type State } from "../state"
import { clockTime } from "../time"
import { Cell, Fields, Marker, Pane, Rule, StateCell } from "./parts"
import { HINTS } from "./placeholder"

type AppScreenState = Extract<Screen, { name: "app" }>

/** The secrets pane's width at 100 columns and more. */
export const SECRETS_WIDTH = 36
const NUMBER_WIDTH = 6
const WHEN_WIDTH = 14
const VERSION_WIDTH = 11

/**
 * A deploy's result as the history shows it: a symbol and words, never
 * colour alone. The deploy the runner runs now, while every service of the
 * app is running, is `● running now`, as on the board (`runningNow`).
 */
function Result({ deploy, runningNow }: { deploy: DeployRow; runningNow: boolean }) {
  const theme = useTheme()
  const rollback = deploy.rollbackTo === undefined ? "" : `, a rollback to ${deploy.rollbackTo}`
  if (runningNow) {
    return (
      <Text>
        <Text color={theme.success}>● running now</Text>
        {rollback}
      </Text>
    )
  }
  switch (deploy.outcome) {
    case "started":
      return <Text>✔ started{rollback}</Text>
    case "start_failed":
      return (
        <Text>
          <Text color={theme.danger}>✖</Text> did not start{rollback}
        </Text>
      )
    case "sent":
      return (
        <Text>
          <Text color={theme.warning}>!</Text> no answer recorded{rollback}
        </Text>
      )
  }
}

/** The selected deploy: who signed it and from which team list, its services and its secrets. */
function DeployDetails({ deploy }: { deploy: DeployRow }) {
  const label = `deploy ${deploy.sequence}`
  const signed = [deploy.signer ? `signed by ${deploy.signer}` : undefined, deploy.teamVersion ? `from team list v${deploy.teamVersion}` : undefined]
    .filter(Boolean)
    .join(", ")
  const secrets = deploy.secrets?.length ? deploy.secrets.map((secret) => `${secret.name} v${secret.version}`).join(", ") : "none"
  const rows: [string, ReactNode][] = [[label, signed]]
  if (deploy.services?.length) rows.push(["services", deploy.services.join(", ")])
  rows.push(["secrets", secrets])
  return <Fields rows={rows} labelWidth={Math.max(10, label.length + 2)} />
}

function DeploysPane({
  deploys,
  selected,
  focused,
  now,
  running,
}: {
  deploys?: readonly DeployRow[]
  selected: number
  focused: boolean
  now: Date
  /** The deploy that runs now, when the app is running. */
  running?: number
}) {
  const at = clampIndex(selected, deploys?.length ?? 0)
  const chosen = deploys?.[at]
  return (
    <Pane title="Deploys" right={<Text dimColor>last 50 are kept</Text>} focused={focused}>
      {deploys && deploys.length === 0 ? <Text dimColor>No deploys from this machine yet.</Text> : null}
      {deploys && deploys.length > 0 ? (
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          <Box>
            <Box width={2} flexShrink={0} />
            <Cell width={NUMBER_WIDTH}>
              <Text dimColor>no.</Text>
            </Cell>
            <Cell>
              <Text dimColor>result</Text>
            </Cell>
            <Cell width={WHEN_WIDTH}>
              <Text dimColor>when</Text>
            </Cell>
          </Box>
          {deploys.map((deploy, index) => (
            <Box key={deploy.sequence}>
              <Marker selected={index === at} />
              <Cell width={NUMBER_WIDTH}>
                <Text bold={index === at}>{deploy.sequence}</Text>
              </Cell>
              <Cell>
                <Result deploy={deploy} runningNow={deploy.sequence === running} />
              </Cell>
              <Cell width={WHEN_WIDTH}>
                <Text dimColor>{clockTime(deploy.at, now)}</Text>
              </Cell>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {chosen ? (
        <Box flexDirection="column" flexShrink={0}>
          <Rule />
          <DeployDetails deploy={chosen} />
        </Box>
      ) : null}
    </Pane>
  )
}

/**
 * The note for secrets set or removed after the latest deploy the runner
 * accepted (FR-025), worded as on the board for one, and naming each when
 * there are several.
 */
export function changedNote(secrets: readonly SecretRow[], deploy: number | undefined): string | undefined {
  const changed = secrets.filter((secret) => secret.afterDeploy)
  if (deploy === undefined || changed.length === 0) return undefined
  if (changed.length === 1) {
    const [secret] = changed
    return `${secret!.name} was ${secret!.removed ? "removed" : "set"} after deploy ${deploy}. It takes effect on the next deploy.`
  }
  const names = changed.map((secret) => secret.name)
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} changed after deploy ${deploy}. They take effect on the next deploy.`
}

function SecretsPane({
  secrets,
  selected,
  focused,
  latest,
  width,
}: {
  secrets?: readonly SecretRow[]
  selected: number
  focused: boolean
  latest?: number
  width: number
}) {
  const theme = useTheme()
  const rows = secrets ?? []
  const at = clampIndex(selected, rows.length + 1)
  const note = changedNote(rows, latest)
  return (
    <Pane title="Secrets" focused={focused} width={width}>
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {rows.map((secret, index) => (
          <Box key={secret.name}>
            <Marker selected={focused && index === at} />
            <Cell>
              <Text bold={focused && index === at} dimColor={secret.removed} strikethrough={secret.removed}>
                {secret.name}
              </Text>
            </Cell>
            <Cell width={VERSION_WIDTH}>
              <Text dimColor>{secret.removed ? "removed" : `version ${secret.version}`}</Text>
            </Cell>
          </Box>
        ))}
        <Box>
          <Marker selected={focused && at === rows.length} />
          <Text dimColor>+ set a secret</Text>
        </Box>
      </Box>
      <Box flexGrow={1} />
      <Box flexDirection="column" flexShrink={0}>
        <Text dimColor>Values are never shown. To change one, set it again.</Text>
        {note ? <Text color={theme.warning}>! {note}</Text> : null}
      </Box>
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
export function runningNow(deploys: readonly DeployRow[] | undefined, state: RunState, accepted: number | undefined): number | undefined {
  if (state !== "running" || accepted === undefined) return undefined
  return deploys?.some((deploy) => deploy.sequence === accepted && deploy.outcome === "started") ? accepted : undefined
}

/** The answers to "remove this secret?", the reducer's own (state.ts `CHOICES`). */
const REMOVE_HINTS: readonly KeyHint[] = CHOICES["remove-secret"].map((choice) => [choice.key, choice.does] as const)

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
  const row = state.team?.servers.find((server) => server.name === screen.server)?.apps.find((app) => app.name === screen.app)
  const runState: RunState = row?.state ?? "unknown"
  // The latest deploy the runner accepted, from this machine's history: what a secret changed after is measured against.
  const latest = view?.deploys.find((deploy) => deploy.outcome !== "sent")?.sequence
  // The header names the deploy the runner holds, once it has said; until then, or when it cannot be reached, this machine's.
  const shown = row?.accepted ?? latest
  const right = (
    <Box columnGap={1}>
      <StateCell state={runState} />
      {shown !== undefined ? <Text dimColor>deploy {shown}</Text> : null}
    </Box>
  )
  const header = <Header place={<Trail parts={[screen.server, screen.app]} />} right={right} />
  const question = state.question?.kind === "remove-secret" ? state.question : undefined
  if (question) {
    return (
      <Frame header={header} hints={REMOVE_HINTS} status={status}>
        <Box width={Math.min(columns - 2, 64)}>
          <Confirm title={`Remove ${question.name}?`} tone="warning" choices={CHOICES["remove-secret"]}>
            <Text>
              {question.app} on {question.server} keeps it until the next deploy. The removal is signed now.
            </Text>
          </Confirm>
        </Box>
      </Frame>
    )
  }
  return (
    <Frame header={header} hints={HINTS.app} status={status}>
      <Box flexGrow={1} columnGap={1}>
        <DeploysPane
          deploys={view?.deploys}
          selected={screen.deploy}
          focused={screen.pane === "deploys"}
          now={new Date()}
          running={runningNow(view?.deploys, runState, row?.accepted)}
        />
        <SecretsPane
          secrets={view?.secrets}
          selected={screen.secret}
          focused={screen.pane === "secrets"}
          latest={latest}
          width={columns >= 100 ? SECRETS_WIDTH : 30}
        />
      </Box>
    </Frame>
  )
}
