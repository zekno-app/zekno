/** An app's logs, followed for the logs screen over a session of their own (research R4). */
import { followLogs, LOG_TAIL, prepareLogs, type LogLine } from "../../ops/logs"
import { sanitize } from "../../server/sanitize"
import type { Effect } from "../state/events"
import {
  LOG_LINES,
  LOG_TEXT_KEPT,
  type LogLine as ShownLine,
} from "../state/types"
import { batcher } from "./batcher"
import { reasonOf, type Context } from "./context"

/** The logs being followed, at most one at a time. */
export function createLogs(context: Context) {
  const { dispatch, fail, ops } = context

  /** The logs being followed for the logs screen. */
  let following: { id: number; stop: AbortController } | undefined
  let followed = 0

  /** Lets go of the logs being followed: their session is closed, and the runner stops Docker's log command. */
  function stopLogs(): void {
    following?.stop.abort()
    following = undefined
  }

  /**
   * Follows an app's logs for the logs screen over a session of its own
   * (research R4), and hands its lines to the reducer in small batches. Each
   * line was cleaned as it arrived (session.ts) and only its first
   * `LOG_TEXT_KEPT` characters are kept. Nothing is written anywhere. When
   * the logs stop coming, the screen is told why, and Enter starts again.
   */
  function startLogs(effect: Extract<Effect, { kind: "logs" }>): void {
    stopLogs()
    const id = ++followed
    const stop = new AbortController()
    following = { id, stop }
    const current = () => following?.id === id && !context.closed
    let fresh = true
    // At most what the screen keeps waits to be drawn; past that the session reads nothing more until it is.
    const batch = batcher<ShownLine>(LOG_LINES, (lines) => {
      // Lines of a session that was let go never reach the screen.
      if (!current()) return
      // The first lines of a connection replace those of an earlier one: Docker sends its last lines again.
      dispatch({ type: "log-lines", lines, ...(fresh ? { fresh: true } : {}) })
      fresh = false
    })
    const flush = batch.flush
    const onLine = (line: LogLine) => {
      if (!current()) return
      const text =
        line.text.length <= LOG_TEXT_KEPT
          ? line.text
          : [...line.text].slice(0, LOG_TEXT_KEPT).join("")
      return batch.add({ time: line.time, service: line.service, line: text })
    }
    void (async () => {
      let problem: string
      try {
        const plan = await prepareLogs(ops, {
          app: effect.app,
          server: effect.server,
        })
        const end = await followLogs(
          ops,
          plan,
          { tail: LOG_TAIL, follow: true, stop: stop.signal },
          onLine
        )
        if (end === "stopped") return
        problem = `Docker stopped sending the logs of ${effect.app}.`
      } catch (error) {
        if (!current()) return
        const reason = reasonOf(error)
        if (reason === undefined) return fail(error)
        problem = sanitize(reason)
      }
      if (!current()) return
      flush()
      following = undefined
      dispatch({ type: "logs-dropped", problem })
    })()
  }

  return { startLogs, stopLogs }
}
