/**
 * The team as Home shows it, changed by what arrives: a new team list, a
 * server's answer, its apps read again from this machine's history, and
 * what its runner says is running. Home's selection stays inside its lists.
 */
import { clampIndex } from "../../ui/parts/select"
import type { EventOf, Step } from "./events"
import { stay, updateScreens } from "./steps"
import type { AppRow, ServerRow, State } from "./types"

/** Keeps each selection on Home inside its list after the team changed. */
export function clampHome(state: State): State {
  return updateScreens(state, "home", (screen) => {
    const servers = state.team?.servers ?? []
    const server = clampIndex(screen.server, servers.length + 1)
    return { ...screen, server, app: clampIndex(screen.app, servers[server]?.apps.length ?? 0) }
  })
}

/**
 * One server's apps, read again. The app that was selected on Home stays
 * selected, wherever its row moved: a deploy moves its app to the top.
 */
export function withApps(state: State, name: string, apps: AppRow[]): State {
  const team = state.team
  const index = team?.servers.findIndex((server) => server.name === name) ?? -1
  if (!team || index === -1) return state
  const before = team.servers[index]!.apps
  // The history does not say what is running, nor what the runner holds; what the runner last said stays until it is read again.
  const known = apps.map((app) => {
    const was = before.find((row) => row.name === app.name)
    return { ...app, state: was?.state ?? app.state, accepted: was?.accepted }
  })
  const servers = team.servers.map((server, at) => (at === index ? { ...server, apps: known } : server))
  const next = updateScreens({ ...state, team: { ...team, servers } }, "home", (screen) => {
    if (screen.server !== index) return screen
    const moved = known.findIndex((app) => app.name === before[screen.app]?.name)
    return moved === -1 ? screen : { ...screen, app: moved }
  })
  return clampHome(next)
}

/** Changes each of one server's apps. Nothing else changes, the selection included. */
export function withAppRows(state: State, name: string, change: (app: AppRow) => AppRow): State {
  const team = state.team
  if (!team?.servers.some((server) => server.name === name)) return state
  const servers = team.servers.map((server) => (server.name === name ? { ...server, apps: server.apps.map(change) } : server))
  return { ...state, team: { ...team, servers } }
}

/** Only the record's own entries count, never something an object has by default, such as `constructor`. */
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

/** A server answered, or could not be reached and why. */
export function serverReached(state: State, event: EventOf<"server-reached">): Step {
  if (!state.team) return stay(state)
  const reached = (server: ServerRow): ServerRow => {
    if (server.name !== event.server) return server
    // Only a server that was not reached can be waiting on SSH's question, and only when the effects say SSH said so.
    const asks = !event.reachable && event.asks === true ? true : undefined
    const next: ServerRow = { ...server, reachable: event.reachable, problem: event.reachable ? undefined : event.problem, asks }
    // A server that cannot be reached has a runner nobody can tell the version of now, and apps whose state is not known:
    // their deploy numbers are this machine's again.
    if (!event.reachable) return { ...next, runner: undefined, apps: server.apps.map((app) => ({ ...app, state: "unknown", accepted: undefined })) }
    return event.runner ? { ...next, runner: event.runner } : next
  }
  return stay({ ...state, team: { ...state.team, servers: state.team.servers.map(reached) } })
}

/** What is running on one server's apps, and the last deploy of each it accepted, as its runner said. */
export const appStates = (state: State, event: EventOf<"app-states">): Step =>
  stay(withAppRows(state, event.server, (app) => ({ ...app, state: own(event.states, app.name) ?? "unknown", accepted: own(event.accepted, app.name) })))
