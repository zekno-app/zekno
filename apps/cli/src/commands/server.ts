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

import { openTeam, reach, type Deps, type Team } from "../context"
import { CliError, RunnerRefused, UsageError } from "../errors"
import { NAME } from "../profile"
import { ask, RUNNER_PATH, SSH_DESTINATION, type Target, type Transport } from "../transport"

/**
 * Asks the runner to set itself up for this team. A runner that says it is
 * already set up is accepted only when it shows this team: that is what an
 * earlier `server add` leaves behind when it stops half way.
 */
async function setUp(deps: Deps, team: Team, transport: Transport): Promise<{ serverId: string; serverPublicKey: ServerPublicKey }> {
  try {
    return await ask(transport, "setup", RunnerSetupResponseSchema, {
      founding: team.profile.rosters[0],
      teamCode: team.teamCode,
    })
  } catch (refusal) {
    if (!(refusal instanceof RunnerRefused) || refusal.reason !== "already_set_up") throw refusal
    const status = await ask(transport, "status", RunnerStatusSchema)
    const known = team.chain[status.team.version - 1]
    if (status.team.teamId !== team.trust.teamId || known?.hash !== status.team.hash) throw refusal
    const existing = team.trust.servers.find((server) => server.serverId === status.serverId)
    if (existing) throw new CliError(`That server is already connected as "${existing.name}".`)
    deps.ui.info("The runner was already set up for your team by an earlier attempt. Carrying on from there.")
    return status
  }
}

/** Connects a server: the runner sets itself up for this team, then an admin adds it to the team list. */
export async function serverAdd(
  deps: Deps,
  name: string | undefined,
  options: { ssh?: string; local?: boolean; home?: string; "runner-path"?: string }
): Promise<void> {
  const team = await openTeam(deps)
  const { profile, trust } = team
  if (!name || !NAME.test(name)) {
    throw new UsageError("Give the server a name of lowercase letters, digits and hyphens.")
  }
  if (profile.servers.some((server) => server.name === name)) {
    throw new CliError(`A server named "${name}" is already connected.`)
  }
  if (Boolean(options.ssh) === Boolean(options.local)) {
    throw new UsageError("Say how to reach the server: `--ssh <destination>` or `--local`.")
  }

  let target: Target
  if (options.ssh) {
    const runnerPath = options["runner-path"] ?? "zekno-runner"
    if (!SSH_DESTINATION.test(options.ssh)) throw new CliError("That SSH destination is not valid. Use the form user@host.")
    if (!RUNNER_PATH.test(runnerPath)) throw new CliError("That runner path is not valid.")
    target = { kind: "ssh", destination: options.ssh, runnerPath }
  } else {
    target = { kind: "local", home: options.home ? resolve(deps.cwd, options.home) : join(deps.home, "runner", name) }
  }
  const transport = reach(deps, target)

  const code = await deps.ui.step(
    `Connecting ${name}`,
    async () => {
      const answer = await setUp(deps, team, transport)
      if (trust.servers.some((server) => server.serverId === answer.serverId)) {
        throw new CliError("That server is already connected under another name.")
      }

      const next = await team
        .withSigner((signer) =>
          proposeRoster({ trust, servers: [...trust.servers, { name, publicKey: answer.serverPublicKey }], signer })
        )
        .catch((error: unknown) => {
          if (error instanceof CoreError) throw new CliError(`The server could not be added to the team list (${error.code}).`)
          throw error
        })

      const rosters = [...profile.rosters, next.envelope]
      team.store.save({ ...profile, rosters, servers: [...profile.servers, { name, serverId: answer.serverId, target }] })
      await ask(transport, "sync", RunnerReportSchema, { rosters })
      // The code is derived here from the key that came back, never taken on the runner's word.
      return serverConfirmationCode(answer.serverPublicKey)
    },
    { quiet: target.kind === "ssh" }
  )

  deps.ui.success(`Connected "${name}" and added it to the team list.`)
  deps.ui.field("Server code", code)
  if (target.kind === "ssh") {
    deps.ui.info("You reached this server over SSH, so its identity rests on SSH's host verification.")
  }
}

export async function serverList(deps: Deps): Promise<void> {
  const { profile } = await openTeam(deps)
  if (profile.servers.length === 0) return deps.ui.info("No servers connected yet.")
  deps.ui.table(
    profile.servers.map((server) => [
      server.name,
      server.target.kind === "ssh" ? server.target.destination : "this machine",
      server.serverId,
    ])
  )
}
