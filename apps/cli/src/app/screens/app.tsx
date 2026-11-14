import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { Confirm } from "../../ui/confirm"
import type { KeyHint } from "../../ui/key-hints"
import { clampIndex } from "../../ui/select"
import { secretsWords } from "../../ui/deploy"
import { useTheme } from "../../ui/theme"
import { Frame, Header, Trail } from "../frame"
import { appViewOf, CHOICES, type DeployRow, type RunState, type Screen, type SecretRow, type State } from "../state"
import { clockTime } from "../time"
import { Cell, Fields, Marker, Pane, Rule, StateCell } from "./parts"
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
/** The number and when columns at 100 columns and at 80, each with the space after it. Both widen for what is in them. */
const NUMBER_WIDTH = { wide: 6, narrow: 4 }
const WHEN_WIDTH = { wide: 14, narrow: 12 }
const VERSION_WIDTH = 11

/**
 * A deploy's result as the history shows it: a symbol and words, never
 * colour alone. The deploy the runner runs now, while every service of the
 * app is running, is `● running now`, as on the board (`runningNow`).
 */
function Result({ deploy, runningNow, narrow }: { deploy: DeployRow; runningNow: boolean; narrow: boolean }) {
  const theme = useTheme()
  // Below 100 columns, as on the board "One app at 80 columns": a rollback that started is `✔ rollback to 1`, and the others say their result alone.
  const rollback = deploy.rollbackTo === undefined || narrow ? "" : `, a rollback to ${deploy.rollbackTo}`
  if (narrow && !runningNow && deploy.outcome === "started" && deploy.rollbackTo !== undefined) return <Text>✔ rollback to {deploy.rollbackTo}</Text>
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

/**
 * The selected deploy below 100 columns, as on the board "One app at 80
 * columns": `deploy 4, signed by ada, team list v2` and `web (caddy:2), 1
 * secret`, faint.
 */
function NarrowDeployDetails({ deploy }: { deploy: DeployRow }) {
  const first = [`deploy ${deploy.sequence}`, deploy.signer ? `signed by ${deploy.signer}` : undefined, deploy.teamVersion ? `team list v${deploy.teamVersion}` : undefined]
  const second = [...(deploy.services ?? []), secretsWords(deploy.secrets?.length ?? 0)]
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {first.filter(Boolean).join(", ")}
      </Text>
      <Text dimColor wrap="truncate-end">
        {second.join(", ")}
      </Text>
    </Box>
  )
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
  narrow,
}: {
  deploys?: readonly DeployRow[]
  selected: number
  focused: boolean
  now: Date
  /** The deploy that runs now, when the app is running. */
  running?: number
  /** Below 100 columns: no column names and no "last 50 are kept", as on the board "One app at 80 columns". */
  narrow: boolean
}) {
  const at = clampIndex(selected, deploys?.length ?? 0)
  const chosen = deploys?.[at]
  const when = (deploys ?? []).map((deploy) => clockTime(deploy.at, now))
  // Wide enough for every number and time shown, and never narrower than the board's.
  const numberWidth = Math.max(narrow ? NUMBER_WIDTH.narrow : NUMBER_WIDTH.wide, ...(deploys ?? []).map((deploy) => String(deploy.sequence).length + 1))
  const whenWidth = Math.max(narrow ? WHEN_WIDTH.narrow : WHEN_WIDTH.wide, ...when.map((text) => text.length + 1))
  return (
    <Pane title="Deploys" right={narrow ? undefined : <Text dimColor>last 50 are kept</Text>} focused={focused}>
      {deploys && deploys.length === 0 ? <Text dimColor>No deploys from this machine yet.</Text> : null}
      {deploys && deploys.length > 0 ? (
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {narrow ? null : (
            <Box>
              <Box width={2} flexShrink={0} />
              <Cell width={numberWidth}>
                <Text dimColor>no.</Text>
              </Cell>
              <Cell>
                <Text dimColor>result</Text>
              </Cell>
              <Cell width={whenWidth}>
                <Text dimColor>when</Text>
              </Cell>
            </Box>
          )}
          {deploys.map((deploy, index) => (
            <Box key={deploy.sequence}>
              <Marker selected={index === at} />
              <Cell width={numberWidth}>
                <Text bold={index === at}>{deploy.sequence}</Text>
              </Cell>
              <Cell>
                <Result deploy={deploy} runningNow={deploy.sequence === running} narrow={narrow} />
              </Cell>
              <Cell width={whenWidth}>
                <Text dimColor>{when[index]}</Text>
              </Cell>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {chosen ? (
        <Box flexDirection="column" flexShrink={0}>
          <Rule />
          {narrow ? <NarrowDeployDetails deploy={chosen} /> : <DeployDetails deploy={chosen} />}
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
      <Text color={secret.afterDeploy ? theme.warning : undefined} dimColor={!secret.afterDeploy}>
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
}: {
  secrets?: readonly SecretRow[]
  selected: number
  focused: boolean
  latest?: number
  width: number
  /** Below 100 columns: short versions and short last lines, as on the board "One app at 80 columns". */
  narrow: boolean
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
            {narrow ? (
              <ShortVersion secret={secret} />
            ) : (
              <Cell width={VERSION_WIDTH}>
                <Text dimColor>{secret.removed ? "removed" : `version ${secret.version}`}</Text>
              </Cell>
            )}
          </Box>
        ))}
        <Box>
          <Marker selected={focused && at === rows.length} />
          <Text dimColor>+ set a secret</Text>
        </Box>
      </Box>
      <Box flexGrow={1} />
      {narrow ? (
        <Box flexDirection="column" flexShrink={0}>
          {note ? <Text color={theme.warning}>! not deployed yet</Text> : null}
          <Text dimColor>Values are never shown.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" flexShrink={0}>
          <Text dimColor>Values are never shown. To change one, set it again.</Text>
          {note ? <Text color={theme.warning}>! {note}</Text> : null}
        </Box>
      )}
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
  const narrow = columns < APP_WIDE
  // The 80-column board shows the state alone.
  const right = (
    <Box columnGap={1}>
      <StateCell state={runState} />
      {shown !== undefined && !narrow ? <Text dimColor>deploy {shown}</Text> : null}
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
          narrow={narrow}
        />
        <SecretsPane
          secrets={view?.secrets}
          selected={screen.secret}
          focused={screen.pane === "secrets"}
          latest={latest}
          width={narrow ? NARROW_SECRETS_WIDTH : SECRETS_WIDTH}
          narrow={narrow}
        />
      </Box>
    </Frame>
  )
}
