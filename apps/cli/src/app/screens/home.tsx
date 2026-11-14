import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { RUNNER_RELEASE } from "../../runner-release"
import { Confirm } from "../../ui/confirm"
import type { KeyHint } from "../../ui/key-hints"
import { secretsWords } from "../../ui/deploy"
import { useTheme } from "../../ui/theme"
import { Frame, Header, PRE_ALPHA } from "../frame"
import { CHOICES, selectedApp, selectedServer, type AppRow, type Linked, type Screen, type ServerRow, type State } from "../state"
import { relativeTime } from "../time"
import { Cell, Fields, Marker, Pane, Rule, StateCell, wordsThatFit } from "./parts"
import { HINTS } from "./placeholder"

type HomeScreenState = Extract<Screen, { name: "home" }>

/**
 * Pane widths. At 100 columns and more, as on the board "Home": the servers
 * pane has its 220 px, which hold `deploy@203.0.113.7` whole after the
 * marker's indent (eighteen columns, with the pane's border and padding and
 * that indent six more). Below that, as on the board "Home at 80 columns":
 * the servers pane is as wide (196 px of 720), and there is no details pane;
 * the selected app's details are at the foot of the apps pane and its
 * actions are keys on the last line.
 */
export const SERVERS_WIDTH = { wide: 24, narrow: 22 }
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
/**
 * The when column of the boards at 100 and at 80 columns (96 px at 100: ten
 * columns and the gap after the state); it widens for a longer time, such as
 * "23 hours ago". At exactly 100 columns this is what leaves `worker` whole
 * beside the servers pane's 24.
 */
const WHEN_WIDTH = { wide: 11, narrow: 11 }

/**
 * The state column's width: the boards' at 80 and 100 columns, where
 * `● partly running` is cut at a word (`● partly`, parts.tsx `StateCell`),
 * and wide enough for it where the window leaves the app's name as much room
 * as the 80-column board does.
 */
export function stateWidth(columns: number, whenWidth: number): number {
  const wide = columns >= HOME_WIDE
  // The window's margins, the panes beside the apps pane and the gaps between them, the pane's border and padding, the marker.
  const pane = columns - 2 - (wide ? SERVERS_WIDTH.wide : SERVERS_WIDTH.narrow) - (wide ? DETAILS_WIDTH + 2 : 1) - 4 - 2
  return pane - DEPLOY_WIDTH - whenWidth - STATE_FULL_WIDTH >= MIN_APP_WIDTH ? STATE_FULL_WIDTH : STATE_WIDTH
}

/** What a deploy's result is called in the details pane. */
export const OUTCOME_WORDS = { started: "started", start_failed: "did not start", sent: "no answer recorded" } as const

/**
 * The line under a server whose runner is not this zekno's version
 * (contracts/versions.md, "The app"). Fourteen columns: they fit the sixteen
 * the servers pane leaves under a name at 80 columns, which a version such as
 * `0.1.0-dev.1` beside "runner" would not.
 */
export const RUNNER_MARKS = { older: "! older runner", newer: "! newer runner" } as const

/** What does not work with an older runner until it is updated, as the question `u` asks says it. */
export const MISSING_WORDS = {
  "state and logs": "Deploys still work. Running state and logs need the newer runner.",
  some: "Deploys still work. Some of what this zekno does needs the newer runner.",
  nothing: "Everything works with it.",
} as const

/** The runner line to show under a server, if any: none while it cannot be reached, and none when its runner is this zekno's version. */
const runnerLineOf = (server: ServerRow): string | undefined => {
  const relation = server.reachable === false ? undefined : server.runner?.relation
  return relation === "older" || relation === "newer" ? RUNNER_MARKS[relation] : undefined
}

/** The line under a server's name while SSH needs an answer to reach it (`ServerRow.asks`). */
/** Short enough to stand whole under a server's name at 80 columns, where 16 are free. */
export const ASKS_LINE = "needs an answer"

/** SSH needs an answer to reach it: not reached, and read again only once the person connects to it on purpose. */
export const needsAnswerHere = (server: ServerRow | undefined): boolean => server?.reachable === false && server.asks === true

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
function ServerItem({ server, selected, narrow }: { server: ServerRow; selected: boolean; narrow: boolean }) {
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
        {server.reachable === true && runnerLine === undefined ? <Text color={theme.success}> ●</Text> : null}
        {server.reachable === false && !asks ? <Text color={theme.danger}> ✖</Text> : null}
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

function ServersPane({ servers, selected, focused, narrow }: { servers: readonly ServerRow[]; selected: number; focused: boolean; narrow: boolean }) {
  return (
    <Pane title="Servers" focused={focused} width={narrow ? SERVERS_WIDTH.narrow : SERVERS_WIDTH.wide}>
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

/**
 * Columns one character takes: two for the wide scripts (Hangul, the CJK
 * blocks, full-width forms) and for pictographs, one for anything else, the
 * marks and arrows zekno draws included.
 */
function columnsOf(char: string): number {
  const code = char.codePointAt(0)!
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f300
  return wide ? 2 : 1
}
const widthOf = (text: string): number => [...text].reduce((sum, char) => sum + columnsOf(char), 0)

/**
 * The rows Ink draws a sentence of plain words in at `width` columns: wrapped
 * at spaces, a word longer than a row broken where the row ends, and a space
 * that falls just past a full row starting the next one, as Ink wraps.
 */
export function inkRows(text: string, width: number): number {
  const room = Math.max(width, 1)
  let rows = 1
  let used = 0
  text.split(" ").forEach((word, index) => {
    if (index > 0) {
      if (used >= room) {
        rows++
        used = 0
      }
      used++
    }
    const length = widthOf(word)
    if (used + length > room && used > 0 && length > 0) {
      rows++
      used = 0
    }
    used += length
    while (used > room) {
      rows++
      used -= room
    }
  })
  return rows
}

/**
 * `text` wrapped at spaces into rows of at most `width` columns, a word
 * longer than a row broken where the row ends, and at most `rows` of them.
 * When it does not fit, it is cut after the last word that does, with "…".
 * Each row is drawn as it is: Ink does not wrap it again.
 */
export function rowsOf(text: string, rows: number, width: number): string[] {
  if (rows <= 0) return []
  const room = Math.max(width, 2)
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    // A word longer than a row, such as a path, is broken into pieces that each fit one.
    const pieces: string[] = []
    let piece = ""
    for (const char of word) {
      if (widthOf(piece) + columnsOf(char) > room) {
        pieces.push(piece)
        piece = ""
      }
      piece += char
    }
    pieces.push(piece)
    for (const part of pieces) {
      const joined = line === "" ? part : `${line} ${part}`
      if (widthOf(joined) <= room) line = joined
      else {
        lines.push(line)
        line = part
      }
    }
  }
  if (line !== "") lines.push(line)
  if (lines.length <= rows) return lines
  const kept = lines.slice(0, rows)
  let last = kept[rows - 1]!
  // Room for "…" after the last whole word that fits; a single piece too long for it loses its end.
  while (widthOf(`${last}…`) > room) {
    const space = last.lastIndexOf(" ")
    last = space > 0 ? last.slice(0, space) : [...last].slice(0, -1).join("")
  }
  kept[rows - 1] = `${last}…`
  return kept
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

/** The second line of the selected app's details below 100 columns: its secrets, and its Compose file when this folder is linked to it. Empty when there is neither. */
function detailsSecondLine(app: AppRow, file?: string): string {
  return [app.secrets === undefined ? undefined : secretsWords(app.secrets), file, file === undefined ? undefined : "this folder is linked"]
    .filter((part) => part !== undefined)
    .join(", ")
}

/**
 * The selected app's details at the foot of the apps pane, below 100
 * columns, as on the board "Home at 80 columns": `demo deploy 4, started,
 * signed by ada` and `2 secrets, compose.yaml, this folder is linked`.
 */
function AppDetailsFoot({ app, file }: { app: AppRow; file?: string }) {
  const deploy = app.deploy === undefined ? "none yet" : `${app.deploy}${app.outcome ? `, ${OUTCOME_WORDS[app.outcome]}` : ""}`
  const signed = app.signer === undefined ? "" : `, signed by ${app.signer}`
  const second = detailsSecondLine(app, file)
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

/**
 * Home's key hints: the board's for the width; `u` while the selected
 * server's runner is older than this zekno (contracts/versions.md); and `enter connect` in
 * place of `enter open` while the servers pane has the keys and its marked
 * server is one SSH needs an answer to reach.
 */
export function homeHints(server: ServerRow | undefined, narrow = false, pane: "servers" | "apps" = "apps"): readonly KeyHint[] {
  const board = narrow ? NARROW_HOME_HINTS : HINTS.home
  const hints = pane === "servers" && needsAnswerHere(server) ? board.map((hint): KeyHint => (hint[0] === "enter" ? ["enter", "connect"] : hint)) : board
  if (server?.runner?.relation !== "older") return hints
  const at = hints.findIndex(([key]) => key === "?")
  return [...hints.slice(0, at), ["u", "update runner"], ...hints.slice(at)]
}

/** The answers to "update the runner?", the reducer's own (state.ts `CHOICES`). */
const UPDATE_HINTS: readonly KeyHint[] = CHOICES["update-runner"].map((choice) => [choice.key, choice.does] as const)

/**
 * Board "Two questions the app asks", right half: the runner on a server is
 * older than this zekno. What does not work until it is updated is said by
 * what it lacks (contracts/versions.md, "The app"); updating is offered and
 * done only on `u`.
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
            <Text>{server.runner?.version ?? "no version reported"}</Text>
          </Box>
          <Box>
            <Box width={14} flexShrink={0}>
              <Text dimColor>this zekno</Text>
            </Box>
            <Text>{RUNNER_RELEASE.version}</Text>
          </Box>
        </Box>
        <Text>{MISSING_WORDS[server.runner?.missing ?? "state and logs"]}</Text>
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
  return inkRows(state.notice.tone === "info" ? state.notice.text : `✖ ${state.notice.text}`, columns - 2)
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
  const question = state.question?.kind === "update-runner" ? state.question : undefined
  const asked = question ? servers.find((entry) => entry.name === question.server) : undefined
  if (asked) {
    return (
      <Frame header={<Header place={place} right={right} />} hints={UPDATE_HINTS} status={status}>
        <UpdateQuestion server={asked} columns={columns} />
      </Frame>
    )
  }
  const hints = homeHints(server, !wide, screen.pane)
  // The header, the gaps around the body and the line above the hints (Frame), the hints, and the panes' borders.
  const inside = rows - 3 - 1 - 1 - 1 - statusRows(state, columns) - hintRows(hints, columns) - 2
  return (
    <Frame header={<Header place={place} right={right} />} hints={hints} status={status}>
      <Box flexGrow={1} columnGap={1}>
        <ServersPane servers={servers} selected={screen.server} focused={screen.pane === "servers"} narrow={!wide} />
        <AppsPane
          state={state}
          server={server}
          selected={screen.app}
          focused={screen.pane === "apps"}
          now={new Date()}
          columns={columns}
          inside={inside}
          details={wide ? undefined : { app, file: linkedFile(state, server, app) }}
        />
        {wide ? <DetailsPane app={app} file={linkedFile(state, server, app)} /> : null}
      </Box>
    </Frame>
  )
}
