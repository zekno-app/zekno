/**
 * What each server holds and runs, read in the background every few seconds
 * and on purpose (contracts/app.md, "Refresh"). Each server has a kept
 * session, opened once and read over again and again. A read in the
 * background never asks anything on the terminal and is limited in time; a
 * server that is lost is connected to again no sooner than `RETRY_MS` after.
 */
import type { RunnerStatus, RunnerVersion } from "@workspace/core"

import { openTeam, reach, type Team } from "../../cli/context"
import { runnerRelation, runnerWarning, type RunnerRelation } from "../../ops/server"
import { locateServer, readOver, stateOf, type AppStates, type RunState, type StatusResult } from "../../ops/status"
import type { Server } from "../../profile/profile"
import { sanitize } from "../../server/sanitize"
import { openSession, SshUnreachable, type Session, type SessionMode } from "../../server/session"
import type { Target } from "../../server/transport"
import { appNames } from "../../shared/views"
import { batchOnly, recording, wouldHaveAsked } from "../hand-over"
import type { RunnerRow } from "../state/types"
import { reasonOf, routeErrorLines, type Context } from "./context"

/**
 * How long a read in the background may take: over a server's kept session,
 * or connecting again in batch mode and reading. Past it the session is
 * closed and the server shown as not reached, never with state that looks
 * current when it is not.
 */
export const READ_LIMIT_MS = 20_000

/**
 * A server whose kept session ended, or that could not be reached, is
 * connected to again in the background no sooner than this after it was
 * lost or last tried: never a new login every few seconds.
 */
export const RETRY_MS = 30_000

/** How long each kept session has, once the app closes, to end before it is stopped. */
const CLOSE_MS = 1000

/**
 * Said for a server that SSH could not reach without asking something: when
 * the app read it on its own, or when the question SSH asked was not
 * answered. Only what the person does on purpose may ask, such as `enter` on
 * the server on Home.
 */
export const needsAnswer = (destination: string, server: string): string =>
  `SSH needs an answer to reach ${sanitize(destination)}. Press enter on ${sanitize(server)} to connect. zekno never asks in the background.`

/** Said for a server whose read in the background got no answer within `ms`. */
export const noAnswer = (server: string, ms = READ_LIMIT_MS): string => `${server} did not answer within ${ms / 1000} seconds.`

/**
 * Each app's state from a runner's answer, for `app-states`. With no answer,
 * none is known. With `names`, only those apps are kept: the ones this
 * machine has a history for, which are the only ones Home shows.
 */
export function statesFor(states: AppStates | undefined, names?: readonly string[]): Record<string, RunState> {
  if (states === undefined) return {}
  const apps = names ?? Object.keys(states)
  return Object.fromEntries(apps.filter((app) => Object.hasOwn(states, app)).map((app) => [app, stateOf(states, app)]))
}

/** The last deploy the runner accepted of each of `names`, as its status says, for `app-states`. */
export function acceptedFor(status: RunnerStatus, names: readonly string[]): Record<string, number> {
  const last = status.lastSequence
  return Object.fromEntries(names.filter((app) => Object.hasOwn(last, app) && last[app]! >= 1).map((app) => [app, last[app]!]))
}

/** How a server's runner stands to the one this zekno carries. Undefined for a runner on this machine, which is never compared. */
export function relationOf(target: Target, mode: SessionMode, runner: RunnerVersion | undefined, carried: string): RunnerRelation | undefined {
  return target.kind === "ssh" ? runnerRelation(mode, runner, carried) : undefined
}

/** The runner as Home shows it: its version, older, the same or newer, and what needs it updated. */
export const runnerRow = (runner: RunnerVersion | undefined, relation: RunnerRelation | undefined): RunnerRow | undefined =>
  relation && { version: runner?.version, relation: relation.relation, missing: relation.missing }

/** The times the reads in the background keep to. Tests pass their own. */
export type Timing = {
  /** The clock `RETRY_MS` is measured with. */
  now?: () => number
  /** How long a read in the background may take (`READ_LIMIT_MS`). */
  readLimitMs?: number
  /** How long before a server that was lost is connected to again in the background (`RETRY_MS`). */
  retryMs?: number
}

/**
 * A server's kept session, for reading what it holds and runs every few
 * seconds over one connection (contracts/app.md, "Refresh"). `session` is
 * undefined while it is being opened.
 */
type Watch = {
  /** Stops it at once: the runner process, or SSH, is stopped, while opening or after. */
  stop: AbortController
  session?: Session
  /** It is being opened or read: one read per server at a time. */
  busy: boolean
}

/** The servers' kept sessions and the reads over them. */
export function createServers(context: Context, timing: Timing = {}) {
  const { deps, dispatch, fail, asking, purposeful, ops, remember, carried, notice, perform } = context
  const now = timing.now ?? Date.now
  const readLimitMs = timing.readLimitMs ?? READ_LIMIT_MS
  const retryMs = timing.retryMs ?? RETRY_MS

  /** Each server's kept session, by name (`Watch`). */
  const watches = new Map<string, Watch>()
  /** Kept sessions that were replaced or lost and are being closed: closing the app waits for them too. */
  const lettingGo = new Set<Watch>()
  /** When each server that was lost may next be connected to in the background. */
  const retryAt = new Map<string, number>()
  /**
   * Servers whose runner does not speak sessions: there is no session to
   * keep, and state cannot be read from it, so it is not read in the
   * background at all. Its update (`u`) reads it again.
   */
  const oneShot = new Set<string>()
  let closing: Promise<void> | undefined

  /**
   * Servers whose runner was found newer than this zekno in this run. That is
   * said once per server each time the app runs, when it is first read
   * (contracts/versions.md, "The app"); for a server added in this run, the
   * line that says it was added says so instead. An older runner needs no
   * notice: the line under its name and `u` say it.
   */
  const toldNewer = new Set<string>()
  const tellNewer = (name: string, runner: RunnerVersion | undefined, relation: RunnerRelation | undefined) => {
    if (relation?.relation !== "newer" || toldNewer.has(name)) return
    toldNewer.add(name)
    const text = runnerWarning(name, runner?.version, relation, carried)
    if (text) notice("warning", text)
  }

  /**
   * Keeps a session that was opened on purpose elsewhere, the one a server
   * was just added over, as that server's kept session, and reads over it
   * at once. The read checks, as `connect` does, that it is the server that
   * was connected and on this team. `stop` stops it at once.
   */
  async function adopt(team: Pick<Team, "trust">, server: Server, session: Session, stop: AbortController): Promise<void> {
    if (context.closed) {
      stop.abort()
      return void session.close()
    }
    const before = watches.get(server.name)
    if (before) {
      watches.delete(server.name)
      letGo(before)
    }
    const entry: Watch = { stop, session, busy: false }
    watches.set(server.name, entry)
    oneShot.delete(server.name)
    retryAt.delete(server.name)
    await readKept(team, server, entry, session)
  }

  /** What a server answered, for the reducer: reached, its runner's version, and its apps' state and last deploy numbers. */
  function report(server: Server, result: StatusResult): void {
    const relation = relationOf(server.target, result.mode, result.runner, carried)
    dispatch({ type: "server-reached", server: server.name, reachable: true, runner: runnerRow(result.runner, relation) })
    tellNewer(server.name, result.runner, relation)
    // Only the apps this machine has a history for: Home shows no other, so no other is kept.
    const names = appNames(deps.home, server)
    dispatch({ type: "app-states", server: server.name, states: statesFor(result.states, names), accepted: acceptedFor(result.status, names) })
  }

  /** Closes a kept session that is no longer the server's, and keeps track of it until its process has exited. */
  function letGo(entry: Watch): void {
    lettingGo.add(entry)
    const exited = entry.session ? entry.session.close() : (entry.stop.abort(), Promise.resolve(undefined))
    void exited.finally(() => lettingGo.delete(entry))
  }

  /** The server is no longer read over `entry`: it is closed, and connected to again in the background no sooner than `retryMs` from now. */
  function lose(name: string, entry: Watch): void {
    if (watches.get(name) === entry) watches.delete(name)
    retryAt.set(name, now() + retryMs)
    letGo(entry)
  }

  /**
   * Gives a read in the background `readLimitMs`. Past it, the session is
   * closed, so the read fails at once, and its process is stopped if it does
   * not end by itself; a connection still being made is stopped outright.
   */
  function timeLimit(entry: Watch) {
    let late = false
    const timer = setTimeout(() => {
      late = true
      if (entry.session) void entry.session.close()
      else entry.stop.abort()
    }, readLimitMs)
    return {
      get late() {
        return late
      },
      clear: () => clearTimeout(timer),
    }
  }

  /**
   * Connects to a server, checks that it is the server that was connected
   * and on this team, reads what it holds and runs, and keeps the session for
   * the reads that follow. The identity is checked here, once per session;
   * each later read checks the status it gets against it again.
   *
   * `deliberately`: as the app does when it starts, after an update, or on
   * `enter` on a server where SSH needs an answer. SSH may then ask, and the
   * terminal is handed over (hand-over.ts); there is no time limit while it
   * connects, since SSH may be waiting for a password, but once the session
   * is open SSH asks nothing more, and the read over it has `readLimitMs`.
   * Otherwise, in the background: batch mode only, the terminal never handed
   * over, and `readLimitMs` for all of it.
   *
   * Where SSH stopped at a question it could not ask (in batch mode), or one
   * that was not answered (on the terminal handed over), the server is shown
   * as needing an answer and is not connected to in the background again
   * until the person connects to it on purpose (`asking`). Only SSH's own
   * failure counts: its status, before the runner said a word, and its own
   * closing line last on standard error (hand-over.ts `wouldHaveAsked`).
   */
  async function connect(team: Pick<Team, "trust">, server: Server, deliberately: boolean): Promise<void> {
    const name = server.name
    const destination = server.target.kind === "ssh" ? server.target.destination : undefined
    const before = watches.get(name)
    if (before) {
      watches.delete(name)
      letGo(before)
    }
    const entry: Watch = { stop: new AbortController(), busy: true }
    watches.set(name, entry)
    const current = () => !context.closed && watches.get(name) === entry
    // What SSH writes on standard error is looked at only to tell whether it stopped at a question; on purpose, it is also kept for showing.
    const lines: string[] = []
    const via = deliberately
      ? routeErrorLines(purposeful, recording(lines, (line) => dispatch({ type: "runner-line", line })))
      : { ...deps, connect: batchOnly(deps.connect, lines) }
    let limit = deliberately ? undefined : timeLimit(entry)
    try {
      const session = await openSession(reach(via, server.target), { signal: entry.stop.signal })
      if (session.mode === "session") entry.session = session
      if (!current()) return letGo(entry)
      // The connection is up. A runner from before sessions connects again for each read, where SSH may ask again.
      if (session.mode === "session") limit ??= timeLimit(entry)
      const result = await readOver(session, { team, server }, { whole: true })
      if (!current()) return letGo(entry)
      if (session.mode !== "session") {
        // Nothing is kept open for a runner from before sessions, and it is not read in the background.
        oneShot.add(name)
        watches.delete(name)
      } else {
        oneShot.delete(name)
      }
      retryAt.delete(name)
      report(server, result)
    } catch (error) {
      const reason = reasonOf(error)
      if (reason === undefined) throw error
      if (!current()) return letGo(entry)
      lose(name, entry)
      const asks = destination !== undefined && error instanceof SshUnreachable && wouldHaveAsked(lines)
      if (asks) {
        asking.add(destination)
        return dispatch({ type: "server-reached", server: name, reachable: false, problem: needsAnswer(destination, name), asks: true })
      }
      const problem = limit?.late ? noAnswer(name, readLimitMs) : sanitize(reason)
      dispatch({ type: "server-reached", server: name, reachable: false, problem })
    } finally {
      limit?.clear()
      entry.busy = false
    }
  }

  /**
   * `enter` on a server where SSH needs an answer: the profile is verified
   * again, and the server connected to on purpose, as when the app starts.
   * SSH may ask, on the terminal handed over; the session is kept. While a
   * connection to it is being made, another is not started.
   */
  async function connectOnPurpose(name: string): Promise<void> {
    const { team, server } = await locateServer(ops, name)
    remember(team)
    if (context.closed || watches.get(server.name)?.busy) return
    await connect(team, server, true)
  }

  /** Reads what a server holds and runs over its kept session, within `readLimitMs`. A read that fails or takes too long loses the session. */
  async function readKept(team: Pick<Team, "trust">, server: Server, entry: Watch, session: Session): Promise<void> {
    const name = server.name
    entry.busy = true
    const limit = timeLimit(entry)
    try {
      const result = await readOver(session, { team, server }, { whole: true })
      if (context.closed || watches.get(name) !== entry) return
      report(server, result)
    } catch (error) {
      const reason = reasonOf(error)
      if (reason === undefined) throw error
      if (context.closed || watches.get(name) !== entry) return
      lose(name, entry)
      dispatch({ type: "server-reached", server: name, reachable: false, problem: limit.late ? noAnswer(name, readLimitMs) : sanitize(reason) })
    } finally {
      limit.clear()
      entry.busy = false
    }
  }

  /**
   * Reads a server in the background (contracts/app.md, "Refresh"): over its
   * kept session, with no new connection. Without one, it is connected to
   * again in batch mode, at most once every `retryMs`, and never when SSH
   * would have to ask. One read per server at a time, however slow it is.
   */
  async function readInBackground(team: Pick<Team, "trust">, server: Server): Promise<void> {
    const name = server.name
    const entry = watches.get(name)
    if (entry?.busy) return
    if (entry?.session) return readKept(team, server, entry, entry.session)
    if (oneShot.has(name)) return
    const destination = server.target.kind === "ssh" ? server.target.destination : undefined
    if (destination !== undefined && asking.has(destination)) return
    if (now() < (retryAt.get(name) ?? 0)) return
    return connect(team, server, false)
  }

  /** Reads again, in the background, what is running: on one server, or on every server the app knows. */
  function refreshStates(server: string | undefined): void {
    if (!context.known || context.closed) return
    const { team } = context.known
    for (const entry of context.known.servers) {
      if (server === undefined || entry.name === server) void readInBackground(team, entry).catch(fail)
    }
  }

  return {
    oneShot,
    toldNewer,
    adopt,
    connect,
    connectOnPurpose,
    readInBackground,
    refreshStates,
    /** As `Effects.checkServers`: every server, all at once, on purpose. */
    checkServers: () =>
      perform(async () => {
        const team = await openTeam(ops)
        remember(team)
        if (context.closed) return
        await Promise.all(team.profile.servers.map((server) => connect(team, server, true)))
      }),
    /** Closes every kept session: given a moment to end, then stopped; at once with `now`. */
    close(options: { now?: boolean }): Promise<void> {
      for (const entry of watches.values()) {
        // Each is given a moment to end by itself, then stopped.
        void entry.session?.close(CLOSE_MS)
        letGo(entry)
      }
      watches.clear()
      // On a signal nothing can be waited for: every process is stopped now.
      if (options.now) for (const entry of lettingGo) entry.stop.abort()
      closing ??= Promise.all([...lettingGo].map((entry) => entry.session?.close())).then(() => {})
      return closing
    },
  }
}

export type Servers = ReturnType<typeof createServers>
