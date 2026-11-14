import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { RUNNER_RELEASE } from "../../runner-release"
import { Confirm } from "../../ui/confirm"
import type { KeyHint } from "../../ui/key-hints"
import { secretsWords } from "../../ui/deploy"
import { useTheme } from "../../ui/theme"
import { Frame, Header, PRE_ALPHA } from "../frame"
import { CHOICES, selectedApp, selectedServer, type AppRow, type Screen, type ServerRow, type State } from "../state"
import { relativeTime } from "../time"
import { Cell, Fields, Marker, Pane, Rule, StateCell } from "./parts"
import { HINTS } from "./placeholder"

type HomeScreenState = Extract<Screen, { name: "home" }>

/**
 * Pane widths. At 100 columns and more, as on the board "Home". Below that,
 * as on the board "Home at 80 columns": the servers pane is as wide (196 px
 * of 720), and there is no details pane; the selected app's details are at
 * the foot of the apps pane and its actions are keys on the last line.
 */
export const SERVERS_WIDTH = 22
export const DETAILS_WIDTH = 28
/** Below this many columns Home is arranged as on the board "Home at 80 columns". */
export const HOME_WIDE = 100
/** The apps table's fixed columns: deploy, state and when, each with the space after it. The app's name takes what is left. */
const DEPLOY_WIDTH = 8
/** Both boards' state column (96 px at 80 columns, 110 px at 100): room for `● running`, `● stopped`, `● unknown`. */
const STATE_WIDTH = 12
/** Room for `● partly running`, given when the app's name keeps at least `MIN_APP_WIDTH`. */
const STATE_FULL_WIDTH = 17
/** The app name column of the 80-column board (140 px): never made narrower to widen the state column. */
const MIN_APP_WIDTH = 16
/** The when column of the boards at 100 and at 80 columns; it widens for a longer time, such as "23 hours ago". */
const WHEN_WIDTH = { wide: 12, narrow: 11 }

/**
 * The state column's width: the boards' at 80 and 100 columns, where
 * `● partly running` is cut at a word (`● partly`, parts.tsx `StateCell`),
 * and wide enough for it where the window leaves the app's name as much room
 * as the 80-column board does.
 */
export function stateWidth(columns: number, whenWidth: number): number {
  const wide = columns >= HOME_WIDE
  // The window's margins, the panes beside the apps pane and the gaps between them, the pane's border and padding, the marker.
  const pane = columns - 2 - SERVERS_WIDTH - (wide ? DETAILS_WIDTH + 2 : 1) - 4 - 2
  return pane - DEPLOY_WIDTH - whenWidth - STATE_FULL_WIDTH >= MIN_APP_WIDTH ? STATE_FULL_WIDTH : STATE_WIDTH
}

/** What a deploy's result is called in the details pane. */
export const OUTCOME_WORDS = { started: "started", start_failed: "did not start", sent: "no answer recorded" } as const

/** How Home names a runner's version beside its server: `runner 0.1.0`, or `old runner` when it does not say. */
export const runnerWords = (version: string | undefined): string => (version === undefined ? "old runner" : `runner ${version}`)

/**
 * One server: the marker, its name, ● once it answered or ✖ when it could not
 * be reached, and its address below. A server whose runner is older than this
 * zekno shows `! runner 0.1.0` until it is updated, as on the board "Two
 * questions the app asks": on a line of its own under the name, because the
 * servers pane is narrower than the board's. Below 100 columns the address
 * is left out, as on the board "Home at 80 columns".
 */
function ServerItem({ server, selected, narrow }: { server: ServerRow; selected: boolean; narrow: boolean }) {
  const theme = useTheme()
  const outdated = server.reachable !== false && server.runner?.outdated === true
  return (
    <Box flexDirection="column">
      <Box>
        <Marker selected={selected} />
        <Cell>
          <Text bold={selected}>{server.name}</Text>
        </Cell>
        {server.reachable === true && !outdated ? <Text color={theme.success}> ●</Text> : null}
        {server.reachable === false ? <Text color={theme.danger}> ✖</Text> : null}
      </Box>
      {outdated ? (
        <Box paddingLeft={2}>
          <Text color={theme.warning} wrap="truncate-end">
            ! {runnerWords(server.runner?.version)}
          </Text>
        </Box>
      ) : null}
      {narrow ? null : (
        <Box paddingLeft={2}>
          <Text dimColor wrap="truncate-end">
            {server.destination ?? "this machine"}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function ServersPane({ servers, selected, focused, narrow }: { servers: readonly ServerRow[]; selected: number; focused: boolean; narrow: boolean }) {
  return (
    <Pane title="Servers" focused={focused} width={SERVERS_WIDTH}>
      <Box flexDirection="column">
        {servers.map((server, index) => (
          <ServerItem key={server.name} server={server} selected={index === selected} narrow={narrow} />
        ))}
        <Box>
          <Marker selected={selected === servers.length} />
          <Text dimColor wrap="truncate-end">
            + add a server
          </Text>
        </Box>
      </Box>
    </Pane>
  )
}

function AppTable({ apps, selected, now, columns }: { apps: readonly AppRow[]; selected: number; now: Date; columns: number }) {
  const when = apps.map((app) => (app.at ? relativeTime(app.at, now) : ""))
  const whenWidth = Math.max(columns >= HOME_WIDE ? WHEN_WIDTH.wide : WHEN_WIDTH.narrow, ...when.map((text) => text.length + 1))
  const state = stateWidth(columns, whenWidth)
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={2} flexShrink={0} />
        <Cell>
          <Text dimColor>app</Text>
        </Cell>
        <Cell width={DEPLOY_WIDTH}>
          <Text dimColor>deploy</Text>
        </Cell>
        <Cell width={state}>
          <Text dimColor>state</Text>
        </Cell>
        <Cell width={whenWidth}>
          <Text dimColor>when</Text>
        </Cell>
      </Box>
      {apps.map((app, index) => (
        <Box key={app.name}>
          <Marker selected={index === selected} />
          <Cell>
            <Text bold={index === selected}>{app.name}</Text>
          </Cell>
          <Cell width={DEPLOY_WIDTH}>{app.accepted ?? app.deploy ?? ""}</Cell>
          <Cell width={state}>
            <StateCell state={app.state} room={state - 1} />
          </Cell>
          <Cell width={whenWidth}>
            <Text dimColor>{when[index]}</Text>
          </Cell>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The foot of the apps pane: whether the server could be reached, and
 * whether this folder is linked. Below 100 columns the selected app's
 * details say "this folder is linked" for the app it is linked to, so the
 * sentence is left out while that app is selected.
 */
function AppsFoot({ state, server, said }: { state: State; server: ServerRow; said: boolean }) {
  const theme = useTheme()
  const lines: ReactNode[] = []
  if (server.reachable === false) {
    lines.push(
      <Box key="unreachable" flexDirection="column">
        <Text>
          <Text color={theme.danger}>✖</Text> {server.name} could not be reached. Numbers are from this machine's history.
        </Text>
        {server.problem ? <Text dimColor>{server.problem}</Text> : null}
      </Box>
    )
  }
  if (state.linked?.server === server.name && !said) {
    lines.push(
      <Text key="linked" dimColor>
        This folder is linked to <Text dimColor={false}>{state.linked.app}</Text> on <Text dimColor={false}>{state.linked.server}</Text> by
        zekno.json.
      </Text>
    )
  }
  if (lines.length === 0) return null
  return (
    <Box flexDirection="column" flexShrink={0} rowGap={1}>
      {lines}
    </Box>
  )
}

/**
 * The selected app's details at the foot of the apps pane, below 100
 * columns, as on the board "Home at 80 columns": `demo deploy 4, started,
 * signed by ada` and `2 secrets, compose.yaml, this folder is linked`.
 */
function AppDetailsFoot({ app, file }: { app: AppRow; file?: string }) {
  const deploy = app.deploy === undefined ? "none yet" : `${app.deploy}${app.outcome ? `, ${OUTCOME_WORDS[app.outcome]}` : ""}`
  const signed = app.signer === undefined ? "" : `, signed by ${app.signer}`
  const second = [app.secrets === undefined ? undefined : secretsWords(app.secrets), file, file === undefined ? undefined : "this folder is linked"]
    .filter((part) => part !== undefined)
    .join(", ")
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Rule />
      <Text wrap="truncate-end">
        <Text bold>{app.name}</Text>{" "}
        <Text dimColor>
          deploy {deploy}
          {signed}
        </Text>
      </Text>
      {second ? (
        <Text dimColor wrap="truncate-end">
          {second}
        </Text>
      ) : null}
    </Box>
  )
}

function AppsPane({
  state,
  server,
  selected,
  focused,
  now,
  columns,
  details,
}: {
  state: State
  server?: ServerRow
  selected: number
  focused: boolean
  now: Date
  columns: number
  /** Below 100 columns: the selected app, whose details go at the foot, and its Compose file when this folder is linked to it. */
  details?: { app?: AppRow; file?: string }
}) {
  if (!server) {
    return (
      <Pane title="Apps" focused={focused}>
        <Text dimColor>No server selected.</Text>
      </Pane>
    )
  }
  return (
    <Pane title={`Apps on ${server.name}`} right={<Text dimColor>{server.apps.length}</Text>} focused={focused}>
      {server.apps.length > 0 ? (
        <AppTable apps={server.apps} selected={selected} now={now} columns={columns} />
      ) : (
        <Text dimColor>Nothing deployed to {server.name} from this machine yet.</Text>
      )}
      <Box flexGrow={1} />
      <AppsFoot state={state} server={server} said={details?.file !== undefined} />
      {details?.app ? <AppDetailsFoot app={details.app} file={details.file} /> : null}
    </Pane>
  )
}

/** One action of the details pane: its letter in the brand colour, and what it does. */
function Action({ letter, children }: { letter: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <Box>
      <Box width={3} flexShrink={0}>
        <Text color={theme.brand} bold>
          {letter}
        </Text>
      </Box>
      <Text wrap="truncate-end">{children}</Text>
    </Box>
  )
}

function DetailsPane({ app, file }: { app?: AppRow; file?: string }) {
  if (!app) {
    return (
      <Pane title=" " width={DETAILS_WIDTH}>
        <Text dimColor>No app selected.</Text>
      </Pane>
    )
  }
  const deploy = app.deploy === undefined ? "none yet" : `${app.deploy}${app.outcome ? `, ${OUTCOME_WORDS[app.outcome]}` : ""}`
  const rows: [string, ReactNode][] = [["deploy", deploy]]
  if (app.signer !== undefined) rows.push(["signed by", app.signer])
  if (app.secrets !== undefined) rows.push(["secrets", String(app.secrets)])
  if (file !== undefined) rows.push(["file", file])
  return (
    <Pane title={app.name} width={DETAILS_WIDTH}>
      <Fields rows={rows} labelWidth={11} />
      <Rule />
      <Box flexDirection="column">
        <Action letter="d">Deploy this folder</Action>
        {app.previous !== undefined ? <Action letter="r">Roll back to deploy {app.previous}</Action> : null}
        <Action letter="l">Logs</Action>
        <Action letter="s">Secrets</Action>
      </Box>
    </Pane>
  )
}

/** The Compose file `d` deploys for an app: known when this folder is linked to that app on that server. */
function linkedFile(state: State, server: ServerRow | undefined, app: AppRow | undefined): string | undefined {
  const linked = state.linked
  return linked && linked.server === server?.name && linked.app === app?.name ? linked.compose : undefined
}

/**
 * Home's key hints below 100 columns, as on the board "Home at 80 columns":
 * there is no details pane, so its actions are keys here.
 */
export const NARROW_HOME_HINTS: readonly KeyHint[] = [
  ["↑↓", "move"],
  ["←→", "pane"],
  ["enter", "open"],
  ["d", "deploy"],
  ["r", "roll back"],
  ["l", "logs"],
  ["s", "secrets"],
  ["a", "add"],
  ["?", "help"],
  ["q", "quit"],
]

/** Home's key hints: the board's for the width, and `u` while the selected server's runner is out of date (contracts/app.md). */
export function homeHints(server: ServerRow | undefined, narrow = false): readonly KeyHint[] {
  const hints = narrow ? NARROW_HOME_HINTS : HINTS.home
  if (!server?.runner?.outdated) return hints
  const at = hints.findIndex(([key]) => key === "?")
  return [...hints.slice(0, at), ["u", "update runner"], ...hints.slice(at)]
}

/** The answers to "update the runner?", the reducer's own (state.ts `CHOICES`). */
const UPDATE_HINTS: readonly KeyHint[] = CHOICES["update-runner"].map((choice) => [choice.key, choice.does] as const)

/**
 * Board "Two questions the app asks", right half: the runner on a server is
 * older than this zekno. Deploys still work; updating is offered and done
 * only on `u`.
 */
function UpdateQuestion({ server, columns }: { server: ServerRow; columns: number }) {
  return (
    <Box width={Math.min(columns - 2, 64)}>
      <Confirm title={`The runner on ${server.name} is out of date`} tone="warning" choices={CHOICES["update-runner"]}>
        <Box flexDirection="column">
          <Box>
            <Box width={14} flexShrink={0}>
              <Text dimColor>on {server.name}</Text>
            </Box>
            <Text>{server.runner?.version ?? "from before 0.2.0"}</Text>
          </Box>
          <Box>
            <Box width={14} flexShrink={0}>
              <Text dimColor>this zekno</Text>
            </Box>
            <Text>{RUNNER_RELEASE.version}</Text>
          </Box>
        </Box>
        <Text>Deploys still work. Running state and logs need the newer runner.</Text>
        <Text dimColor>
          Updating downloads the runner on {server.name} and checks it before it replaces the old one. Your apps keep running.
        </Text>
      </Confirm>
    </Box>
  )
}

/**
 * Board "Home": the servers, the selected server's apps with deploy number,
 * state and when, and the selected app's details and actions. An
 * unreachable server is marked and its apps keep the numbers from this
 * machine's history (T021).
 */
export function HomeScreen({ state, screen, columns, status }: { state: State; screen: HomeScreenState; columns: number; status?: ReactNode }) {
  const team = state.team
  const servers = team?.servers ?? []
  const server = selectedServer(state, screen)
  const app = selectedApp(state, screen)
  const wide = columns >= HOME_WIDE
  // The 80-column board says "pre-alpha" alone; the details pane's words are at the foot of the apps pane.
  const right = (
    <Box columnGap={2}>
      {team && wide ? <Text dimColor>team list v{team.version}</Text> : null}
      <Text dimColor>{wide ? PRE_ALPHA : "pre-alpha"}</Text>
    </Box>
  )
  const place = team ? (
    <Text dimColor wrap="truncate-end">
      {team.member}'s team
    </Text>
  ) : null
  const question = state.question?.kind === "update-runner" ? state.question : undefined
  const asked = question ? servers.find((entry) => entry.name === question.server) : undefined
  if (asked) {
    return (
      <Frame header={<Header place={place} right={right} />} hints={UPDATE_HINTS} status={status}>
        <UpdateQuestion server={asked} columns={columns} />
      </Frame>
    )
  }
  return (
    <Frame header={<Header place={place} right={right} />} hints={homeHints(server, !wide)} status={status}>
      <Box flexGrow={1} columnGap={1}>
        <ServersPane servers={servers} selected={screen.server} focused={screen.pane === "servers"} narrow={!wide} />
        <AppsPane
          state={state}
          server={server}
          selected={screen.app}
          focused={screen.pane === "apps"}
          now={new Date()}
          columns={columns}
          details={wide ? undefined : { app, file: linkedFile(state, server, app) }}
        />
        {wide ? <DetailsPane app={app} file={linkedFile(state, server, app)} /> : null}
      </Box>
    </Frame>
  )
}
