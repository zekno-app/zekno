/**
 * An app's logs, read straight from its server (FR-020, FR-021): one session,
 * one `logs` request that the runner answers with log events for as long as
 * Docker's log command runs. Nothing is kept here and nothing is written to
 * disk: each line goes to the caller as it arrives, its text already cleaned
 * of anything a terminal would act on (session.ts).
 */
import { RunnerReportSchema, RunnerStatusSchema } from "@workspace/core"

import { reach, teamOf, type OpDeps, type Team } from "../context"
import { CliError } from "../errors"
import { findServer, type Server } from "../profile"
import { ENDED, namedUnreachable, openSession, type Session } from "../session"
import { checkApp, type Where } from "./deploy"
import { checkIdentity } from "./status"

/** How many lines Docker sends from before the request, by default (research R7). */
export const LOG_TAIL = 200
/** The most a request may ask for (RunnerLogsRequest). */
export const MAX_TAIL = 1000

/** One line of an app's logs: when Docker says it was written, by which service, and its text, cleaned. */
export type LogLine = { time: string; service: string; text: string }

/**
 * Logs to read, checked on this machine. Nothing has been asked of the server
 * yet. Only the verified team list is kept of the team, never the means to
 * sign: reading logs can last for hours, and needs no key.
 */
export type LogsPlan = { team: Pick<Team, "trust">; server: Server; app: string }

/** Verifies the team and finds the server; the app's name is checked before anything is sent. */
export async function prepareLogs(deps: OpDeps, where: Where): Promise<LogsPlan> {
  const team = await teamOf(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  return { team: { trust: team.trust }, server, app: checkApp(where.app) }
}

export type LogsOptions = {
  /** Lines from before the request, 0 to `MAX_TAIL`. */
  tail: number
  /** False for `--no-follow`: the runner sends the lines Docker has, then ends the request. */
  follow: boolean
  /** Signalled to stop reading. The session is closed, and the runner stops Docker's log command. */
  stop?: AbortSignal
}

/**
 * How reading ended: Docker's log command ended by itself (always so without
 * `follow`), or the caller stopped it. A dropped connection, a refusal or an
 * answer that does not match is an error instead.
 */
export type LogsEnd = "ended" | "stopped"

/** Said when the runner does not speak sessions: it has no logs to give. */
export const logsTooOld = (server: string): string =>
  `The runner on ${server} is older than this zekno, and logs need the newer runner. Run \`zekno server update ${server}\`.`

/** Said when the connection drops while reading. */
export const logsDropped = (server: string): string => `The connection to ${server} ended.`

/**
 * Reads an app's logs over one session and hands each line to `onLine`.
 * While a promise `onLine` returns is pending, nothing more is read, so a
 * reader slower than the app slows Docker down instead of filling memory.
 * The runner is first asked what it holds, so the logs are read only from
 * the server that was connected, on this team, and only for an app it has
 * accepted a deploy of.
 *
 * `stop` may come at any moment. Before the logs are asked for, nothing on
 * the server needs stopping, so the connection is stopped at once, even
 * while SSH is still connecting or the runner has not answered. Once they
 * are being read, the session is closed, so the runner stops Docker's log
 * command before it exits.
 */
export async function followLogs(
  deps: OpDeps,
  plan: LogsPlan,
  options: LogsOptions,
  onLine: (line: LogLine) => void | Promise<void>
): Promise<LogsEnd> {
  const { team, server, app } = plan
  const stop = options.stop
  if (stop?.aborted) return "stopped"
  const now = new AbortController()
  let session: Session | undefined
  let reading = false
  let ended: LogsEnd | undefined
  let letGo = () => {}
  // A line still being handed over when the reading stops is not waited for: its reader may never take it.
  const whenStopped = new Promise<void>((resolve) => (letGo = resolve))
  const stopped = () => {
    ended ??= "stopped"
    letGo()
    if (reading && session) void session.close()
    else now.abort()
  }
  stop?.addEventListener("abort", stopped, { once: true })
  try {
    session = await openSession(reach(deps, server.target), { signal: now.signal })
    if (session.mode !== "session") throw new CliError(logsTooOld(server.name))
    const status = await session.request("status", RunnerStatusSchema)
    checkIdentity(team, server, status)
    if (!Object.hasOwn(status.lastSequence, app) || status.lastSequence[app]! < 1) {
      throw new CliError(`${server.name} has no deploy of ${app}, so there are no logs to read.`)
    }
    reading = true
    await session.request("logs", RunnerReportSchema, {
      // Following is the runner's default, so it is said only when it is not wanted.
      input: options.follow ? { app, tail: options.tail } : { app, tail: options.tail, follow: false },
      async onEvent(event) {
        if (event.event !== "log" || ended) return
        const busy = onLine({ time: event.time, service: event.service, text: event.line })
        if (busy instanceof Promise) await Promise.race([busy, whenStopped])
      },
    })
    return ended ?? "ended"
  } catch (error) {
    if (ended) return ended
    if (error instanceof CliError && error.message === ENDED) throw new CliError(logsDropped(server.name))
    throw namedUnreachable(error, server.name)
  } finally {
    stop?.removeEventListener("abort", stopped)
    await session?.close()
  }
}
