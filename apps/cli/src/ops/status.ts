import {
  RunnerAppStatesSchema,
  RunnerStatusSchema,
  RunnerStatusWithRoutesSchema,
  type Route,
  type RunnerAppStates,
  type RunnerStatus,
  type RunnerStatusWithRoutes,
  type RunnerVersion,
} from "@workspace/core"

import { reach, teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, RunnerRefused } from "../cli/errors"
import { findServer, type Server } from "../profile/profile"
import {
  namedUnreachable,
  withSession,
  type Session,
  type SessionMode,
} from "../server/session"
import type { RunState } from "../shared/views"
import { ROUTES_PROTOCOL } from "./deploy-format"

/** A server of the verified team, found by name. Nothing has been asked of it yet. */
export type Located = { team: Team; server: Server }

/**
 * What reading a server needs of the team: its verified team list, which
 * holds no key. The app keeps this between its reads of what is running, so
 * the keychain is not opened every few seconds.
 */
export type Checked = { team: Pick<Team, "trust">; server: Server }

/** Verifies the team and finds one of its servers. `from`: the project file, when the name was read from it. */
export async function locateServer(
  deps: OpDeps,
  name: string | undefined,
  from?: string
): Promise<Located> {
  const team = await teamOf(deps)
  return { team, server: findServer(team.profile, name, from) }
}

/** The runner must be the server that was connected, and on this team. */
export function checkIdentity(
  team: Pick<Team, "trust">,
  server: Server,
  status: RunnerStatus
): void {
  if (
    status.serverId !== server.serverId ||
    status.team.teamId !== team.trust.teamId
  ) {
    throw new CliError(
      `"${server.name}" answered as a different server than the one that was connected.`
    )
  }
}

/**
 * The routes in force on a server, by app, and its proxy's state, as `status`
 * with routes answers them (specs/015-domains-https, contracts/core.md,
 * "`status` with routes"). Only apps with a route are in `routes`.
 */
export type HeldRoutes = {
  routes: Record<string, Route[]>
  proxy: RunnerStatusWithRoutes["proxy"]
}

/** Whether a runner answers `status` with routes: it speaks sessions and protocol 4 or more. */
export const answersRoutes = (
  session: Pick<Session, "mode" | "runner">
): boolean =>
  session.mode === "session" &&
  session.runner !== undefined &&
  session.runner.protocol >= ROUTES_PROTOCOL

/**
 * Asks `status`: as every zekno asked it before feature 015, or, with
 * `routes` and a runner that answers them (`answersRoutes`), with the input
 * `{ "routes": true }` (CL3 step 2, CL6). The answer's own fields are given
 * apart from the routes and the proxy, so what is shown or compared of
 * `status` stays what it was. A command on an app with no route and no
 * health check asks as before (CL7).
 */
export async function askStatus(
  session: Pick<Session, "mode" | "runner" | "request">,
  routes: boolean
): Promise<{ status: RunnerStatus; held?: HeldRoutes }> {
  if (!routes || !answersRoutes(session))
    return { status: await session.request("status", RunnerStatusSchema) }
  const answer = await session.request("status", RunnerStatusWithRoutesSchema, {
    input: { routes: true },
  })
  const { routes: inForce, proxy, ...status } = answer
  return { status, held: { routes: inForce, proxy } }
}

/** The routes in force for `app`, from a `status` with routes: none when the app has none, or the runner was not asked. */
export const routesOfApp = (
  held: HeldRoutes | undefined,
  app: string
): Route[] =>
  held !== undefined && Object.hasOwn(held.routes, app) ? held.routes[app]! : []

/** One service of an app, as the runner reports it: its name, state, exit code and health, nothing else. */
export type ServiceState = RunnerAppStates["apps"][string]["services"][number]

/** What the runner said is running, by app. */
export type AppStates = RunnerAppStates["apps"]

/**
 * data-model.md: an app is running when every service is running, stopped
 * when none is, and partly running otherwise. An app with no services at all
 * (nothing was created, or everything was removed) has nothing running, so
 * it is stopped.
 */
export function runStateOf(services: readonly ServiceState[]): RunState {
  const running = services.filter(
    (service) => service.state === "running"
  ).length
  if (running === 0) return "stopped"
  return running === services.length ? "running" : "partly running"
}

/**
 * One app's state from the runner's answer. Unknown when the runner was not
 * asked (it is too old, or could not be reached) or left the app out: it
 * leaves out an app Docker could not be asked about, which is not the same
 * as stopped. Only the runner's own entries count, never something an
 * object has by default, such as `constructor`.
 */
export function stateOf(states: AppStates | undefined, app: string): RunState {
  if (states === undefined || !Object.hasOwn(states, app)) return "unknown"
  return runStateOf(states[app]!.services)
}

export type StatusResult = {
  server: string
  /** What the runner holds, after checking it is the server that was connected. */
  status: RunnerStatus
  /** The server has an older team list than this machine. The next deploy brings it up to date. */
  behind: boolean
  mode: SessionMode
  /** The runner's version, when it says. A runner from before sessions does not. */
  runner?: RunnerVersion
  /**
   * What is running for each app, as the runner said. Undefined when it was
   * not said: a runner from before sessions, a refusal, or an answer that is
   * not a state answer. Every app's state is then unknown.
   */
  states?: AppStates
  /** The routes in force and the proxy's state, when they were asked and the runner answers them (`askStatus`). */
  held?: HeldRoutes
}

/**
 * Asks what is running, in a session that already showed it is the right
 * server. A runner from before sessions has no `state`, and is not asked:
 * that would cost a connection to learn nothing. A refusal leaves the state
 * unknown; what the runner holds was already read and checked, so it still
 * counts. So does an answer that does not match, unless `whole`: such an
 * answer also ends the session (session.ts), and a session that is kept for
 * more reads then fails here with the reason, rather than on the next read.
 */
async function readStates(
  session: Session,
  whole: boolean
): Promise<AppStates | undefined> {
  if (session.mode !== "session") return undefined
  try {
    return (await session.request("state", RunnerAppStatesSchema)).apps
  } catch (error) {
    if (error instanceof RunnerRefused || (error instanceof CliError && !whole))
      return undefined
    throw error
  }
}

/**
 * Asks a server what it holds and what is running, over a session that is
 * open, and checks that it is the server that was connected and on this
 * team. The app keeps one session per server for this (app/effects/servers.ts); see
 * `readStates` for `whole`. `routes`: the routes in force too, from a runner
 * that answers them (`zekno status`, specs/015-domains-https, CL6).
 */
export async function readOver(
  session: Session,
  { team, server }: Checked,
  options: { whole?: boolean; routes?: boolean } = {}
): Promise<StatusResult> {
  const { status, held } = await askStatus(session, options.routes === true)
  checkIdentity(team, server, status)
  const states = await readStates(session, options.whole === true)
  return {
    server: server.name,
    status,
    behind: status.team.version < team.trust.version,
    mode: session.mode,
    runner: session.runner,
    ...(states === undefined ? {} : { states }),
    ...(held === undefined ? {} : { held }),
  }
}

/** Asks a server what it holds and what is running, over one session of its own. */
export async function readStatus(
  deps: OpDeps,
  checked: Checked,
  options: { routes?: boolean } = {}
): Promise<StatusResult> {
  return withSession(reach(deps, checked.server.target), (session) =>
    readOver(session, checked, options)
  ).catch((error: unknown) => {
    throw namedUnreachable(error, checked.server.name)
  })
}
