/**
 * Home, the full-screen app's main screen (boards "Home" and "Home at 80
 * columns"). `HomeScreen` puts the pieces of this folder together:
 *
 * - the widths of the panes and of the apps table's columns: widths.ts;
 * - the servers pane: servers.tsx;
 * - the apps pane, with what is said at its foot: apps.tsx;
 * - the selected app's details and actions: details.tsx;
 * - the key hints: hints.ts;
 * - the question when a server's runner is older than this zekno: update.tsx;
 * - the rows a sentence takes, and a sentence cut to fit them: rows.ts.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { KeyHint } from "../../../ui/parts/key-hints"
import { Frame, Header, PRE_ALPHA } from "../../frame"
import { noticeRows } from "../../notice"
import { selectedApp, selectedServer } from "../../state/home"
import type { Screen, State } from "../../state/types"
import { AppsPane } from "./apps"
import { DetailsPane, linkedFile } from "./details"
import { homeHints } from "./hints"
import { widthOf } from "./rows"
import { ServersPane } from "./servers"
import { UPDATE_HINTS, UpdateQuestion } from "./update"
import { HOME_WIDE } from "./widths"

type HomeScreenState = Extract<Screen, { name: "home" }>

/**
 * Board "Home": the servers, the selected server's apps with deploy number,
 * state and when, and the selected app's details and actions. An
 * unreachable server is marked and its apps keep the numbers from this
 * machine's history (T021).
 */
/** The rows the key hints take at `columns`: they wrap between hints, two columns apart, inside the window's margins. */
function hintRows(hints: readonly KeyHint[], columns: number): number {
  const room = columns - 2
  let rows = 1
  let used = 0
  for (const [key, does] of hints) {
    const width = widthOf(`${key} ${does}`)
    if (used > 0 && used + 2 + width > room) {
      rows++
      used = 0
    }
    used += (used > 0 ? 2 : 0) + width
  }
  return rows
}

/** The rows the line above the key hints takes: waiting for a deploy before closing, or a line about something done elsewhere (app.tsx `Status`). */
function statusRows(state: State, columns: number): number {
  if (state.quitting) return 1
  if (!state.notice) return 0
  return noticeRows(state.notice, columns - 2)
}

export function HomeScreen({
  state,
  screen,
  columns,
  rows,
  status,
}: {
  state: State
  screen: HomeScreenState
  columns: number
  rows: number
  status?: ReactNode
}) {
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
  const question =
    state.question?.kind === "update-runner" ? state.question : undefined
  const asked = question
    ? servers.find((entry) => entry.name === question.server)
    : undefined
  if (asked) {
    return (
      <Frame
        header={<Header place={place} right={right} />}
        hints={UPDATE_HINTS}
        status={status}
      >
        <UpdateQuestion server={asked} columns={columns} />
      </Frame>
    )
  }
  const hints = homeHints(server, !wide, screen.pane)
  // The header, the gaps around the body and the line above the hints (Frame), the hints, and the panes' borders.
  const inside =
    rows -
    3 -
    1 -
    1 -
    1 -
    statusRows(state, columns) -
    hintRows(hints, columns) -
    2
  return (
    <Frame
      header={<Header place={place} right={right} />}
      hints={hints}
      status={status}
    >
      <Box flexGrow={1} columnGap={1}>
        <ServersPane
          servers={servers}
          selected={screen.server}
          focused={screen.pane === "servers"}
          narrow={!wide}
        />
        <AppsPane
          state={state}
          server={server}
          selected={screen.app}
          focused={screen.pane === "apps"}
          now={new Date()}
          columns={columns}
          inside={inside}
          details={
            wide ? undefined : { app, file: linkedFile(state, server, app) }
          }
        />
        {wide ? (
          <DetailsPane app={app} file={linkedFile(state, server, app)} />
        ) : null}
      </Box>
    </Frame>
  )
}
