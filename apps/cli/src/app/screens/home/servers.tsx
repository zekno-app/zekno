/**
 * Home's servers pane (home.tsx): each server, whether it answered, whether
 * its runner is this zekno's version, and whether SSH needs an answer to
 * reach it.
 */
import { Box, Text } from "ink"

import type { ServerRow } from "../../state/types"
import { useTheme } from "../../../ui/terminal/theme"
import { Cell, Marker, Pane, wordsThatFit } from "../parts"
import { SERVERS_WIDTH } from "./widths"

/**
 * The line under a server whose runner is not this zekno's version
 * (contracts/versions.md, "The app"). Fourteen columns: they fit the sixteen
 * the servers pane leaves under a name at 80 columns, which a version such as
 * `0.1.0-dev.1` beside "runner" would not.
 */
export const RUNNER_MARKS = {
  older: "! older runner",
  newer: "! newer runner",
} as const

/** The runner line to show under a server, if any: none while it cannot be reached, and none when its runner is this zekno's version. */
const runnerLineOf = (server: ServerRow): string | undefined => {
  const relation =
    server.reachable === false ? undefined : server.runner?.relation
  return relation === "older" || relation === "newer"
    ? RUNNER_MARKS[relation]
    : undefined
}

/** The line under a server's name while SSH needs an answer to reach it (`ServerRow.asks`). */
/** Short enough to stand whole under a server's name at 80 columns, where 16 are free. */
export const ASKS_LINE = "needs an answer"

/** SSH needs an answer to reach it: not reached, and read again only once the person connects to it on purpose. */
export const needsAnswerHere = (server: ServerRow | undefined): boolean =>
  server?.reachable === false && server.asks === true

/**
 * One server: the marker, its name, ● once it answered, ✖ when it could not
 * be reached, or `!` when SSH needs an answer to reach it, and its address
 * below. A server whose runner is older or newer than this zekno shows
 * `! older runner` or `! newer runner` in place of ●, on a line of its own
 * under the name, because the servers pane is narrower than the board's
 * (contracts/versions.md, "The app"). A server where SSH needs an answer has
 * `needs an answer` on that line instead; its runner cannot be known then.
 * Below 100 columns the address is left out, as on the board "Home at 80
 * columns".
 */
function ServerItem({
  server,
  selected,
  narrow,
}: {
  server: ServerRow
  selected: boolean
  narrow: boolean
}) {
  const theme = useTheme()
  const asks = needsAnswerHere(server)
  const runnerLine = runnerLineOf(server)
  // The pane's border and padding, and the indent under the name.
  const room = (narrow ? SERVERS_WIDTH.narrow : SERVERS_WIDTH.wide) - 4 - 2
  return (
    <Box flexDirection="column">
      <Box>
        <Marker selected={selected} />
        <Cell>
          <Text bold={selected}>{server.name}</Text>
        </Cell>
        {server.reachable === true && runnerLine === undefined ? (
          <Text color={theme.success}> ●</Text>
        ) : null}
        {server.reachable === false && !asks ? (
          <Text color={theme.danger}> ✖</Text>
        ) : null}
        {asks ? <Text color={theme.warning}> !</Text> : null}
      </Box>
      {asks ? (
        <Box paddingLeft={2}>
          <Text color={theme.warning} wrap="truncate-end">
            {wordsThatFit(ASKS_LINE, room)}
          </Text>
        </Box>
      ) : null}
      {runnerLine !== undefined ? (
        <Box paddingLeft={2}>
          <Text color={theme.warning} wrap="truncate-end">
            {runnerLine}
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

export function ServersPane({
  servers,
  selected,
  focused,
  narrow,
}: {
  servers: readonly ServerRow[]
  selected: number
  focused: boolean
  narrow: boolean
}) {
  return (
    <Pane
      title="Servers"
      focused={focused}
      width={narrow ? SERVERS_WIDTH.narrow : SERVERS_WIDTH.wide}
    >
      <Box flexDirection="column">
        {servers.map((server, index) => (
          <ServerItem
            key={server.name}
            server={server}
            selected={index === selected}
            narrow={narrow}
          />
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
