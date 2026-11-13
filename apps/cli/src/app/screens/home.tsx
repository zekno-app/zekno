import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { useTheme } from "../../ui/theme"
import { Frame, Header, PRE_ALPHA } from "../frame"
import { selectedApp, selectedServer, type AppRow, type Screen, type ServerRow, type State } from "../state"
import { relativeTime } from "../time"
import { Cell, Fields, Marker, Pane, Rule, StateCell } from "./parts"
import { HINTS } from "./placeholder"

type HomeScreenState = Extract<Screen, { name: "home" }>

/** Pane widths at 100 columns. Below that the details pane is left out (the 80-column board arranges it differently). */
export const SERVERS_WIDTH = 22
export const DETAILS_WIDTH = 28
/** The apps table's fixed columns: deploy, state and when. The app's name takes what is left. */
const DEPLOY_WIDTH = 8
const STATE_WIDTH = 12
const WHEN_WIDTH = 12

/** What a deploy's result is called in the details pane. */
export const OUTCOME_WORDS = { started: "started", start_failed: "did not start", sent: "no answer recorded" } as const

/** One server: the marker, its name, ● once it answered or ✖ when it could not be reached, and its address below. */
function ServerItem({ server, selected }: { server: ServerRow; selected: boolean }) {
  const theme = useTheme()
  return (
    <Box flexDirection="column">
      <Box>
        <Marker selected={selected} />
        <Cell>
          <Text bold={selected}>{server.name}</Text>
        </Cell>
        {server.reachable === true ? <Text color={theme.success}> ●</Text> : null}
        {server.reachable === false ? <Text color={theme.danger}> ✖</Text> : null}
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor wrap="truncate-end">
          {server.destination ?? "this machine"}
        </Text>
      </Box>
    </Box>
  )
}

function ServersPane({ servers, selected, focused }: { servers: readonly ServerRow[]; selected: number; focused: boolean }) {
  return (
    <Pane title="Servers" focused={focused} width={SERVERS_WIDTH}>
      <Box flexDirection="column">
        {servers.map((server, index) => (
          <ServerItem key={server.name} server={server} selected={index === selected} />
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

function AppTable({ apps, selected, now }: { apps: readonly AppRow[]; selected: number; now: Date }) {
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
        <Cell width={STATE_WIDTH}>
          <Text dimColor>state</Text>
        </Cell>
        <Cell width={WHEN_WIDTH}>
          <Text dimColor>when</Text>
        </Cell>
      </Box>
      {apps.map((app, index) => (
        <Box key={app.name}>
          <Marker selected={index === selected} />
          <Cell>
            <Text bold={index === selected}>{app.name}</Text>
          </Cell>
          <Cell width={DEPLOY_WIDTH}>{app.deploy ?? ""}</Cell>
          <Cell width={STATE_WIDTH}>
            <StateCell state={app.state} />
          </Cell>
          <Cell width={WHEN_WIDTH}>
            <Text dimColor>{app.at ? relativeTime(app.at, now) : ""}</Text>
          </Cell>
        </Box>
      ))}
    </Box>
  )
}

/** The foot of the apps pane: whether the server could be reached, and whether this folder is linked. */
function AppsFoot({ state, server }: { state: State; server: ServerRow }) {
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
  if (state.linked?.server === server.name) {
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

function AppsPane({ state, server, selected, focused, now }: { state: State; server?: ServerRow; selected: number; focused: boolean; now: Date }) {
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
        <AppTable apps={server.apps} selected={selected} now={now} />
      ) : (
        <Text dimColor>Nothing deployed to {server.name} from this machine yet.</Text>
      )}
      <Box flexGrow={1} />
      <AppsFoot state={state} server={server} />
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

function DetailsPane({ app }: { app?: AppRow }) {
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
  const wide = columns >= 100
  const right = (
    <Box columnGap={2}>
      {team && wide ? <Text dimColor>team list v{team.version}</Text> : null}
      <Text dimColor>{PRE_ALPHA}</Text>
    </Box>
  )
  const place = team ? (
    <Text dimColor wrap="truncate-end">
      {team.member}'s team
    </Text>
  ) : null
  return (
    <Frame header={<Header place={place} right={right} />} hints={HINTS.home} status={status}>
      <Box flexGrow={1} columnGap={1}>
        <ServersPane servers={servers} selected={screen.server} focused={screen.pane === "servers"} />
        <AppsPane state={state} server={server} selected={screen.app} focused={screen.pane === "apps"} now={new Date()} />
        {wide ? <DetailsPane app={app} /> : null}
      </Box>
    </Frame>
  )
}
