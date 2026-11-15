/**
 * Home's apps pane (home.tsx): the selected server's apps with deploy number,
 * state and when, and at its foot whether the server could be reached and
 * whether this folder is linked; below 100 columns, the selected app's
 * details too (details.tsx).
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { useTheme } from "../../../ui/terminal/theme"
import type { Linked, ServerRow, State } from "../../state/types"
import type { AppRow } from "../../../shared/views"
import { relativeTime } from "../../../shared/time"
import { Cell, Marker, Pane, StateCell } from "../parts"
import { AppDetailsFoot, detailsSecondLine } from "./details"
import { inkRows, rowsOf } from "./rows"
import { needsAnswerHere } from "./servers"
import { DEPLOY_WIDTH, DETAILS_WIDTH, HOME_WIDE, SERVERS_WIDTH, stateWidth, WHEN_WIDTH } from "./widths"

/** The table is never made shorter: what is below it gives way (`footRoom`), so each row stays whole. */
function AppTable({ apps, selected, now, columns }: { apps: readonly AppRow[]; selected: number; now: Date; columns: number }) {
  const when = apps.map((app) => (app.at ? relativeTime(app.at, now) : ""))
  const whenWidth = Math.max(columns >= HOME_WIDE ? WHEN_WIDTH.wide : WHEN_WIDTH.narrow, ...when.map((text) => text.length + 1))
  const state = stateWidth(columns, whenWidth)
  return (
    <Box flexDirection="column" flexShrink={0}>
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

/** The sentence under the apps of a server that could not be reached. */
const unreachedWords = (server: ServerRow): string => `${server.name} could not be reached. Numbers are from this machine's history.`

/** The sentence that says which app this folder is linked to. */
const linkedWords = (linked: Linked): string => `This folder is linked to ${linked.app} on ${linked.server} by zekno.json.`

/**
 * The foot of the apps pane: whether the server could be reached and why
 * not, and whether this folder is linked. A server where SSH needs an answer
 * is marked `!` here too, as beside its name. Below 100 columns the selected
 * app's details say "this folder is linked" for the app it is linked to, so
 * the sentence is left out while that app is selected.
 *
 * It takes no more than the `room` rows the window leaves it at `width`
 * columns, so the apps table above it is never squeezed: first the sentence
 * that the server could not be reached, then the sentence about the link,
 * and the reason, which a server or SSH may make long, in the rows that are
 * left, cut at a word with "…".
 */
function AppsFoot({ state, server, said, room, width }: { state: State; server: ServerRow; said: boolean; room: number; width: number }) {
  const theme = useTheme()
  const unreached = server.reachable === false
  const asks = needsAnswerHere(server)
  const mark = asks ? "!" : "✖"
  const linked = state.linked?.server === server.name && !said ? state.linked : undefined
  const sentence = unreached ? inkRows(`${mark} ${unreachedWords(server)}`, width) : 0
  const short = unreached && sentence > room
  const linkRows = linked ? inkRows(linkedWords(linked), width) : 0
  const showLink = linked !== undefined && !short && (unreached ? sentence + 1 + linkRows : linkRows) <= room
  const reason = unreached && !short && server.problem ? rowsOf(server.problem, room - sentence - (showLink ? 1 + linkRows : 0), width) : []
  const lines: ReactNode[] = []
  if (short) {
    // Not even the sentence fits whole: as much of it as there is room for.
    const cut = rowsOf(`${mark} ${unreachedWords(server)}`, room, width)
    if (cut.length > 0) {
      lines.push(
        <Box key="unreachable" flexDirection="column">
          {cut.map((line, index) => (
            <Text key={index} wrap="truncate-end">
              {index === 0 ? <Text color={asks ? theme.warning : theme.danger}>{mark}</Text> : null}
              {index === 0 ? line.slice(mark.length) : line}
            </Text>
          ))}
        </Box>
      )
    }
  } else if (unreached) {
    lines.push(
      <Box key="unreachable" flexDirection="column">
        <Text>
          <Text color={asks ? theme.warning : theme.danger}>{mark}</Text> {unreachedWords(server)}
        </Text>
        {reason.map((line, index) => (
          <Text key={index} dimColor wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    )
  }
  if (linked && showLink) {
    // Dim pieces beside the names: inside a dim text, Ink cannot draw a part that is not dim.
    lines.push(
      <Text key="linked">
        <Text dimColor>This folder is linked to </Text>
        {linked.app}
        <Text dimColor> on </Text>
        {linked.server}
        <Text dimColor> by zekno.json.</Text>
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

export function AppsPane({
  state,
  server,
  selected,
  focused,
  now,
  columns,
  inside,
  details,
}: {
  state: State
  server?: ServerRow
  selected: number
  focused: boolean
  now: Date
  columns: number
  /** The rows inside the pane's border. */
  inside: number
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
  const wide = columns >= HOME_WIDE
  // The window's margins, the panes beside this one and the gaps between them, and this pane's border and padding.
  const width = columns - 2 - (wide ? SERVERS_WIDTH.wide + DETAILS_WIDTH + 2 : SERVERS_WIDTH.narrow + 1) - 4
  const empty = `Nothing deployed to ${server.name} from this machine yet.`
  const table = server.apps.length > 0 ? 1 + server.apps.length : inkRows(empty, width)
  const below = details?.app ? 2 + (detailsSecondLine(details.app, details.file) === "" ? 0 : 1) + 1 : 0
  // What the foot may take: the rows inside the pane less its title, the table, the details below it, and the gaps between them.
  const room = inside - 1 - 1 - table - 1 - below
  return (
    <Pane title={`Apps on ${server.name}`} right={<Text dimColor>{server.apps.length}</Text>} focused={focused}>
      {server.apps.length > 0 ? (
        <AppTable apps={server.apps} selected={selected} now={now} columns={columns} />
      ) : (
        <Text dimColor>{empty}</Text>
      )}
      {/* The foot sits at the bottom of the room the table leaves; were it ever taller than that room, it is cut, never the table. */}
      <Box flexGrow={1} flexDirection="column" justifyContent="flex-end" overflow="hidden">
        <AppsFoot state={state} server={server} said={details?.file !== undefined} room={room} width={width} />
      </Box>
      {details?.app ? <AppDetailsFoot app={details.app} file={details.file} /> : null}
    </Pane>
  )
}
