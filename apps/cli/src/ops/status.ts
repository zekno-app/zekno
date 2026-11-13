import { RunnerStatusSchema, type RunnerStatus } from "@workspace/core"

import { openTeam, reach, type OpDeps, type Team } from "../context"
import { CliError } from "../errors"
import { findServer, type Server } from "../profile"
import { withSession, type SessionMode } from "../session"

/** A server of the verified team, found by name. Nothing has been asked of it yet. */
export type Located = { team: Team; server: Server }

/** Verifies the team and finds one of its servers. */
export async function locateServer(deps: OpDeps, name: string | undefined): Promise<Located> {
  const team = await openTeam(deps)
  return { team, server: findServer(team.profile, name) }
}

/** The runner must be the server that was connected, and on this team. */
export function checkIdentity(team: Team, server: Server, status: RunnerStatus): void {
  if (status.serverId !== server.serverId || status.team.teamId !== team.trust.teamId) {
    throw new CliError(`"${server.name}" answered as a different server than the one that was connected.`)
  }
}

export type StatusResult = {
  server: string
  /** What the runner holds, after checking it is the server that was connected. */
  status: RunnerStatus
  /** The server has an older team list than this machine. The next deploy brings it up to date. */
  behind: boolean
  mode: SessionMode
}

/** Asks a server what it holds, over one session. */
export async function readStatus(deps: OpDeps, { team, server }: Located): Promise<StatusResult> {
  return withSession(reach(deps, server.target), async (session) => {
    const status = await session.request("status", RunnerStatusSchema)
    checkIdentity(team, server, status)
    return { server: server.name, status, behind: status.team.version < team.trust.version, mode: session.mode }
  })
}
