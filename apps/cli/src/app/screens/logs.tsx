import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { KeyHint } from "../../ui/parts/key-hints"
import { TextQuestion } from "../../ui/parts/text-input"
import { useTheme, type Theme } from "../../ui/terminal/theme"
import { Frame, Header, NoticeLine, Trail } from "../frame"
import { servicesOf, visibleLines, type LogLine, type Screen, type State } from "../state/state"
import { logClock } from "../../shared/time"
import { HINTS } from "./placeholder"

type LogsScreenState = Extract<Screen, { name: "logs" }>

/** The board's line under the logs: where they come from. */
export const STRAIGHT = "Read straight from your server over SSH. Nothing passes through Zekno."
/** The same for a runner on this machine, which is not reached over SSH. */
export const STRAIGHT_HERE = "Read straight from the runner on this machine. Nothing passes through Zekno."

/** The time column: `21:52:03` and the gap after it. */
const TIME_WIDTH = 10
/** The widest the service column grows; a longer name is cut. */
const SERVICE_WIDTH = 16
/**
 * Lines of the window the screen uses besides the log lines and the hints:
 * the header, the gaps of the frame, the box's border, and the line under it.
 */
const FIXED_ROWS = 3 + 1 + 2 + 1 + 1 + 1
/** The longest filter shown in full when it is not being typed. */
const FILTER_SHOWN = 40

/** The key hints: the board's while following; `f` resumes while paused; `enter` reconnects once the logs stopped. */
export function logsHints(screen: LogsScreenState): readonly KeyHint[] {
  if (screen.filtering) {
    return [
      ["enter", "keep"],
      ["esc", "clear"],
    ]
  }
  const hints = screen.following ? HINTS.logs : HINTS.logs.map(([key, does]): KeyHint => (key === "f" ? ["f", "resume following"] : [key, does]))
  return screen.dropped ? [["enter", "reconnect"], ...hints] : hints
}

/**
 * How many log lines fit in a window `rows` lines tall: the hints take
 * `hintRows`, the filter its line and a gap, and the line above the hints,
 * with its gap, `statusRows`.
 */
export function logRows(rows: number, hintRows: number, filterLine: boolean, statusRows: number): number {
  return Math.max(1, rows - FIXED_ROWS - hintRows - (filterLine ? 2 : 0) - statusRows)
}

/** Lines the hints take at `columns` columns: each hint, two columns apart, wrapping as a whole. */
function hintRows(hints: readonly KeyHint[], columns: number): number {
  const width = Math.max(columns - 2, 1)
  let rows = 1
  let used = 0
  for (const [key, does] of hints) {
    const size = [...key].length + 1 + [...does].length
    if (used > 0 && used + 2 + size > width) {
      rows++
      used = size
    } else {
      used += (used > 0 ? 2 : 0) + size
    }
  }
  return rows
}

/** Cuts text to at most `width` characters before it is drawn: a line can be 4096 characters, and only its start fits. */
const cut = (text: string, width: number): string => (text.length <= width ? text : [...text].slice(0, width + 1).join(""))

/** Whether the state is following, paused, or no longer connected: a word and a symbol as well as a colour. */
function Following({ screen, theme }: { screen: LogsScreenState; theme: Theme }) {
  if (screen.dropped) return <Text color={theme.danger}>✖ disconnected</Text>
  return screen.following ? <Text color={theme.success}>● following</Text> : <Text color={theme.warning}>● paused</Text>
}

/** One log line: the time, faint; the service, in its colour; the text, cut at the edge of the box. */
function Row({ line, color, serviceWidth, textWidth }: { line: LogLine; color: string; serviceWidth: number; textWidth: number }) {
  return (
    <Box>
      <Box width={TIME_WIDTH} flexShrink={0}>
        <Text dimColor>{logClock(line.time)}</Text>
      </Box>
      <Box width={serviceWidth + 2} flexShrink={0}>
        <Text color={color} wrap="truncate-end">
          {line.service}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} flexBasis={0}>
        <Text wrap="truncate-end">{cut(line.line, textWidth)}</Text>
      </Box>
    </Box>
  )
}

/**
 * Board "Live logs": the time, service and text of each line, the newest at
 * the bottom, in a box; following or paused; one service or all; the filter;
 * and the line saying the logs are read straight from the server. Each line
 * is one row, cut at the edge of the box: a line never wraps, so no text
 * from a server can move the layout. When the logs stop coming, the screen
 * says why, and `enter` reconnects.
 */
export function LogsScreen({
  state,
  screen,
  columns,
  rows,
  status,
}: {
  state: State
  screen: LogsScreenState
  columns: number
  rows: number
  status?: ReactNode
}) {
  const theme = useTheme()
  const hints = logsHints(screen)
  const visible = visibleLines(screen)
  const filterLine = screen.filtering || screen.filter !== ""
  const problem = screen.dropped && screen.problem !== undefined
  const shownStatus = problem ? <NoticeLine notice={{ tone: "error", text: screen.problem! }} /> : status
  // The line above the hints is there when it says something; its gap is there whenever the frame has one.
  const statusRows = shownStatus === undefined ? 0 : problem || state.notice !== undefined || state.quitting ? 2 : 1
  const page = logRows(rows, hintRows(hints, columns), filterLine, statusRows)
  // `scroll` lines, the newest, are below the view. Near the top of more lines than fit, the view is the first full page.
  const end = visible.length - Math.min(screen.scroll, visible.length)
  const shown = visible.length > page && end < page ? visible.slice(0, page) : visible.slice(Math.max(0, end - page), end)
  const services = servicesOf(screen.lines)
  const colors = [theme.brand, "magenta", "cyan"]
  const colorOf = (service: string) => colors[Math.max(services.indexOf(service), 0) % colors.length]!
  const serviceWidth = Math.min(Math.max(0, ...shown.map((line) => [...line.service].length)), SERVICE_WIDTH)
  // The app's margins, the box's border and padding, and the two columns before the text.
  const textWidth = Math.max(columns - 2 - 4 - TIME_WIDTH - (serviceWidth + 2), 1)
  const local = state.team?.servers.find((server) => server.name === screen.server)?.destination === undefined
  // Below 100 columns "all services" is left out, so the screen's place still fits beside the wordmark.
  const which = screen.service ?? (columns >= 100 ? "all services" : undefined)
  const right = (
    <Box columnGap={2}>
      {which !== undefined ? <Text dimColor>{which}</Text> : null}
      <Following screen={screen} theme={theme} />
    </Box>
  )
  const filter = screen.filter.length > FILTER_SHOWN ? `${[...screen.filter].slice(0, FILTER_SHOWN).join("")}…` : screen.filter
  return (
    <Frame header={<Header place={<Trail parts={[screen.server, screen.app, "logs"]} />} right={right} />} hints={hints} status={shownStatus}>
      <Box flexDirection="column" flexGrow={1} rowGap={1}>
        <Box
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          justifyContent="flex-end"
          borderStyle="round"
          borderDimColor
          paddingX={1}
          overflow="hidden"
        >
          {shown.length > 0 ? (
            shown.map((line, index) => (
              <Row key={index} line={line} color={colorOf(line.service)} serviceWidth={serviceWidth} textWidth={textWidth} />
            ))
          ) : (
            <Text dimColor>{screen.lines.length === 0 ? "No lines yet." : "No line matches."}</Text>
          )}
        </Box>
        {screen.filtering ? <TextQuestion label="Filter" value={screen.filter} /> : null}
        {!screen.filtering && screen.filter !== "" ? (
          <Text wrap="truncate-end">
            <Text dimColor>filter ›</Text> {filter}
          </Text>
        ) : null}
        <Text dimColor>{local ? STRAIGHT_HERE : STRAIGHT}</Text>
      </Box>
    </Frame>
  )
}
