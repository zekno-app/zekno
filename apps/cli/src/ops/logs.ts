/**
 * An app's logs, read straight from its server (FR-020, FR-021): one session,
 * one `logs` request that the runner answers with log events for as long as
 * Docker's log command runs. Nothing is kept here and nothing is written to
 * disk: each line goes to the caller as it arrives, its text already cleaned
 * of anything a terminal would act on (session.ts).
 */
import { RunnerReportSchema, RunnerStatusSchema } from "@workspace/core"

import { openTeam, reach, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer, NAME, type Server } from "../profile"
import { ENDED, withSession } from "../session"
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
export async function prepareLogs(deps: OpDeps, where: { app?: string; server?: string }): Promise<LogsPlan> {
  const team = await openTeam(deps)
  const server = findServer(team.profile, where.server)
  if (!where.app || !NAME.test(where.app)) {
    throw new UsageError("Say which app with `--app <name>`: lowercase letters, digits and hyphens.")
  }
  return { team: { trust: team.trust }, server, app: where.app }
}

/**
 * For `--no-follow`. The runner always follows, as Docker's `--follow` does:
 * it sends the lines Docker has at once, then each new one. So reading stops
 * once no line has come for `quietMs` (or for `firstMs` before the first
 * one, while Docker starts), and in any case `mostMs` after the first line,
 * for an app that writes without a pause.
 */
export type QuietRule = { firstMs: number; quietMs: number; mostMs: number }
export const NO_FOLLOW: QuietRule = { firstMs: 5000, quietMs: 1000, mostMs: 10_000 }

export type LogsOptions = {
  /** Lines from before the request, 0 to `MAX_TAIL`. */
  tail: number
  /** False for `--no-follow`: the lines Docker has, then the end (`quiet`). */
  follow: boolean
  /** Signalled to stop reading. The session is closed, and the runner stops Docker's log command. */
  stop?: AbortSignal
  /** When to stop without `follow`. Tests pass shorter times. */
  quiet?: QuietRule
}

/**
 * How reading ended: Docker's log command ended by itself, the caller
 * stopped it, or Docker was quiet (`--no-follow`). A dropped connection,
 * a refusal or an answer that does not match is an error instead.
 */
export type LogsEnd = "ended" | "stopped" | "quiet"

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
 */
export async function followLogs(
  deps: OpDeps,
  plan: LogsPlan,
  options: LogsOptions,
  onLine: (line: LogLine) => void | Promise<void>
): Promise<LogsEnd> {
  const { team, server, app } = plan
  if (options.stop?.aborted) return "stopped"
  return withSession(reach(deps, server.target), async (session) => {
    if (session.mode !== "session") throw new CliError(logsTooOld(server.name))
    const status = await session.request("status", RunnerStatusSchema)
    checkIdentity(team, server, status)
    if (!Object.hasOwn(status.lastSequence, app) || status.lastSequence[app]! < 1) {
      throw new CliError(`${server.name} has no deploy of ${app}, so there are no logs to read.`)
    }

    let ended: LogsEnd | undefined
    const finish = (how: LogsEnd) => {
      ended ??= how
      void session.close()
    }
    const stopped = () => finish("stopped")
    options.stop?.addEventListener("abort", stopped, { once: true })
    if (options.stop?.aborted) finish("stopped")

    // Without following, the lines Docker has come at once; a pause after them is the end.
    const rule = options.follow ? undefined : (options.quiet ?? NO_FOLLOW)
    let quiet: ReturnType<typeof setTimeout> | undefined
    let most: ReturnType<typeof setTimeout> | undefined
    const wait = (ms: number) => {
      clearTimeout(quiet)
      quiet = setTimeout(() => finish("quiet"), ms)
    }
    if (rule) wait(rule.firstMs)

    try {
      await session.request("logs", RunnerReportSchema, {
        input: { app, tail: options.tail },
        async onEvent(event) {
          if (event.event !== "log" || ended) return
          // The quiet time counts only while waiting for Docker, never while a line is being shown.
          clearTimeout(quiet)
          if (rule && most === undefined) most = setTimeout(() => finish("quiet"), rule.mostMs)
          await onLine({ time: event.time, service: event.service, text: event.line })
          if (rule && !ended) wait(rule.quietMs)
        },
      })
      return ended ?? "ended"
    } catch (error) {
      if (ended) return ended
      if (error instanceof CliError && error.message === ENDED) throw new CliError(logsDropped(server.name))
      throw error
    } finally {
      clearTimeout(quiet)
      clearTimeout(most)
      options.stop?.removeEventListener("abort", stopped)
    }
  })
}
