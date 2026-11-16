/**
 * The logs screen (board "Live logs"): following, pausing and scrolling, one
 * service or all, the filter, and the lines as they arrive, the oldest let
 * go past `LOG_LINES`.
 */
import { applyTextInput } from "../../ui/parts/text-input"
import type { AppKey } from "../keys"
import type { Step } from "./events"
import type { InputFlags } from "./input"
import { go, keep, pop, push, replaceTop, stay } from "./steps"
import { LOG_LINES, type LogLine, type Screen, type State } from "./types"

type LogsScreen = Extract<Screen, { name: "logs" }>

/** The services seen in a log, in the order they first appeared: what `1`–`9` choose from. */
export function servicesOf(lines: readonly LogLine[]): string[] {
  return [...new Set(lines.map((line) => line.service))]
}

/**
 * Whether a log line is shown under the screen's choices: its service, when
 * one is chosen, and the filter. The filter is the text the person typed,
 * found anywhere in the line, whatever the case of its letters. It is plain
 * text, never a pattern: no character in it has a meaning of its own.
 */
export function shows(
  screen: Pick<LogsScreen, "service" | "filter">
): (line: LogLine) => boolean {
  const filter = screen.filter.toLowerCase()
  return (line) =>
    (screen.service === undefined || line.service === screen.service) &&
    (filter === "" || line.line.toLowerCase().includes(filter))
}

/** The log lines the screen shows, oldest first. */
export const visibleLines = (screen: LogsScreen): LogLine[] =>
  screen.lines.filter(shows(screen))

/** Lines back from the newest shown, kept inside the lines there are. */
const clampScroll = (scroll: number, count: number): number =>
  Math.max(0, Math.min(scroll, count - 1))

export const openLogs = (state: State, server: string, app: string): Step =>
  push(
    state,
    {
      name: "logs",
      server,
      app,
      lines: [],
      following: true,
      filter: "",
      filtering: false,
      scroll: 0,
      dropped: false,
    },
    { kind: "logs", server, app }
  )

/** Typing the filter. */
export function typeFilter(
  state: State,
  screen: LogsScreen,
  input: string,
  flags: InputFlags
): Step {
  const result = applyTextInput(screen.filter, input, flags)
  if (result.kind === "cancelled")
    return stay(
      replaceTop(state, { ...screen, filter: "", filtering: false, scroll: 0 })
    )
  const scroll = result.value === screen.filter ? screen.scroll : 0
  return stay(
    replaceTop(state, {
      ...screen,
      filter: result.value,
      filtering: result.kind !== "done",
      scroll,
    })
  )
}

/**
 * The logs screen. `↑` and `↓` scroll through the lines shown, never past
 * the ends. `f` pauses where the view is, and resuming goes back to the
 * newest line. Choosing a service, or changing the filter, shows the newest
 * of the lines that then match.
 */
export function onLogs(
  state: State,
  screen: LogsScreen,
  key: AppKey
): Step | undefined {
  if (key.kind === "up") {
    return stay(
      replaceTop(state, {
        ...screen,
        scroll: clampScroll(screen.scroll + 1, visibleLines(screen).length),
      })
    )
  }
  if (key.kind === "down")
    return stay(
      replaceTop(state, { ...screen, scroll: Math.max(screen.scroll - 1, 0) })
    )
  if (key.kind === "escape") return pop(state, { kind: "stop-logs" })
  if (key.kind === "enter") {
    if (!screen.dropped) return stay(state)
    return go(
      replaceTop(state, { ...screen, dropped: false, problem: undefined }),
      { kind: "logs", server: screen.server, app: screen.app }
    )
  }
  if (key.kind !== "text") return undefined
  if (key.text === "f")
    return stay(
      replaceTop(state, {
        ...screen,
        following: !screen.following,
        scroll: screen.following ? screen.scroll : 0,
      })
    )
  if (key.text === "/")
    return stay(replaceTop(state, { ...screen, filtering: true }))
  if (key.text === "0")
    return stay(replaceTop(state, { ...screen, service: undefined, scroll: 0 }))
  if (/^[1-9]$/.test(key.text)) {
    const service = servicesOf(screen.lines)[Number(key.text) - 1]
    return service
      ? stay(replaceTop(state, { ...screen, service, scroll: 0 }))
      : stay(state)
  }
  return undefined
}

/**
 * New lines on a logs screen, the oldest let go past `LOG_LINES`. While it
 * follows at the newest line, the view moves on with them. While it is
 * paused, or scrolled back, the view stays on the lines it shows: the scroll
 * grows by the new lines it would show. Lines keep arriving while paused, so
 * past `LOG_LINES` the oldest go even then; once the lines in view have gone
 * the view shows the oldest kept. `fresh` lines, the first of a new
 * connection, replace what was there.
 */
export function withLogLines(
  screen: LogsScreen,
  added: readonly LogLine[],
  fresh: boolean
): LogsScreen {
  const lines = keep(fresh ? [] : screen.lines, added, LOG_LINES)
  const next = { ...screen, lines }
  const held = !fresh && (!screen.following || screen.scroll > 0)
  const scroll = held ? screen.scroll + added.filter(shows(screen)).length : 0
  return { ...next, scroll: clampScroll(scroll, visibleLines(next).length) }
}
