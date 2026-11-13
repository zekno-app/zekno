import {
  CoreError,
  proposeRoster,
  RunnerReportSchema,
  RunnerSetupResponseSchema,
  RunnerStatusSchema,
  serverConfirmationCode,
  type ServerPublicKey,
} from "@workspace/core"
import { join, resolve } from "node:path"

import { openTeam, reach, type OpDeps, type Team } from "../context"
import { CliError, RunnerRefused, UsageError } from "../errors"
import { NAME, type Server } from "../profile"
import { withSession, type Session, type SessionMode } from "../session"
import { RUNNER_PATH, SSH_DESTINATION, type Target } from "../transport"

export type ServerAddOptions = { ssh?: string; local?: boolean; home?: string; runnerPath?: string }

/** A server to connect, checked on this machine. Nothing has been asked of it yet. */
export type ServerAddPlan = { team: Team; name: string; target: Target }

/** What has been done on the server so far. */
export type ServerAddStage = "connected" | "set_up" | "added"

export type ServerAddCallbacks = {
  stage?: (stage: ServerAddStage) => void
  /** The runner was already set up for this team by an earlier attempt that stopped half way. */
  resumed?: () => void
}

export type ServerAddResult = {
  name: string
  target: Target
  /** The server code, derived on this machine from the key the server sent. */
  code: string
  mode: SessionMode
}

/** Checks the name and how to reach the server. */
export async function prepareServerAdd(deps: OpDeps, name: string | undefined, options: ServerAddOptions): Promise<ServerAddPlan> {
  const team = await openTeam(deps)
  if (!name || !NAME.test(name)) {
    throw new UsageError("Give the server a name of lowercase letters, digits and hyphens.")
  }
  if (team.profile.servers.some((server) => server.name === name)) {
    throw new CliError(`A server named "${name}" is already connected.`)
  }
  if (Boolean(options.ssh) === Boolean(options.local)) {
    throw new UsageError("Say how to reach the server: `--ssh <destination>` or `--local`.")
  }

  let target: Target
  if (options.ssh) {
    const runnerPath = options.runnerPath ?? "zekno-runner"
    if (!SSH_DESTINATION.test(options.ssh)) throw new CliError("That SSH destination is not valid. Use the form user@host.")
    if (!RUNNER_PATH.test(runnerPath)) throw new CliError("That runner path is not valid.")
    target = { kind: "ssh", destination: options.ssh, runnerPath }
  } else {
    target = { kind: "local", home: options.home ? resolve(deps.cwd, options.home) : join(deps.home, "runner", name) }
  }
  return { team, name, target }
}

/**
 * Asks the runner to set itself up for this team. A runner that says it is
 * already set up is accepted only when it shows this team: that is what an
 * earlier `server add` leaves behind when it stops half way.
 */
async function setUp(
  team: Team,
  session: Session,
  resumed: (() => void) | undefined
): Promise<{ serverId: string; serverPublicKey: ServerPublicKey }> {
  try {
    return await session.request("setup", RunnerSetupResponseSchema, {
      input: { founding: team.profile.rosters[0], teamCode: team.teamCode },
    })
  } catch (refusal) {
    if (!(refusal instanceof RunnerRefused) || refusal.reason !== "already_set_up") throw refusal
    const status = await session.request("status", RunnerStatusSchema)
    const known = team.chain[status.team.version - 1]
    if (status.team.teamId !== team.trust.teamId || known?.hash !== status.team.hash) throw refusal
    const existing = team.trust.servers.find((server) => server.serverId === status.serverId)
    if (existing) throw new CliError(`That server is already connected as "${existing.name}".`)
    resumed?.()
    return status
  }
}

/**
 * Connects a server, over one session: the runner sets itself up for this
 * team, then an admin adds it to the team list and the runner is given the
 * new list.
 */
export async function addServer(deps: OpDeps, plan: ServerAddPlan, callbacks: ServerAddCallbacks = {}): Promise<ServerAddResult> {
  const { team, name, target } = plan
  const { profile, trust } = team
  return withSession(reach(deps, target), async (session) => {
    callbacks.stage?.("connected")
    const answer = await setUp(team, session, callbacks.resumed)
    if (trust.servers.some((server) => server.serverId === answer.serverId)) {
      throw new CliError("That server is already connected under another name.")
    }
    callbacks.stage?.("set_up")

    const next = await team
      .withSigner((signer) => proposeRoster({ trust, servers: [...trust.servers, { name, publicKey: answer.serverPublicKey }], signer }))
      .catch((error: unknown) => {
        if (error instanceof CoreError) throw new CliError(`The server could not be added to the team list (${error.code}).`)
        throw error
      })

    const rosters = [...profile.rosters, next.envelope]
    team.store.save({ ...profile, rosters, servers: [...profile.servers, { name, serverId: answer.serverId, target }] })
    await session.request("sync", RunnerReportSchema, { input: { rosters } })
    callbacks.stage?.("added")
    // The code is derived here from the key that came back, never taken on the runner's word.
    return { name, target, code: serverConfirmationCode(answer.serverPublicKey), mode: session.mode }
  })
}

/** The servers of the verified team. */
export async function listServers(deps: OpDeps): Promise<Server[]> {
  const { profile } = await openTeam(deps)
  return profile.servers
}
