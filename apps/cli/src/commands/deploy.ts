import {
  CoreError,
  createDeploy,
  currentSecrets,
  LIMITS,
  readSignedDeploy,
  RunnerReportSchema,
  RunnerStatusSchema,
  type RunnerStatus,
} from "@workspace/core"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

import { openTeam, reach, type Deps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer, NAME, type History, type Server } from "../profile"
import { ask } from "../transport"

type Options = { app?: string; server?: string; json?: boolean }

/**
 * How far a runner's last deploy number may be ahead of the highest one this
 * machine signed. A runner far beyond that is not one this machine has been
 * deploying to, and its word is not a reason to sign a far higher number.
 */
const MAX_AHEAD = 1000

async function locate(deps: Deps, options: Options) {
  const team = await openTeam(deps)
  const server = findServer(team.profile, options.server)
  if (!options.app || !NAME.test(options.app)) {
    throw new UsageError("Say which app with `--app <name>`: lowercase letters, digits and hyphens.")
  }
  return { team, server, app: options.app }
}

/** The runner must be the server that was connected, and on this team. */
function checkIdentity(team: Team, server: Server, status: RunnerStatus): void {
  if (status.serverId !== server.serverId || status.team.teamId !== team.trust.teamId) {
    throw new CliError(`"${server.name}" answered as a different server than the one that was connected.`)
  }
}

type Sent = { sequence: number; compose: string; outcome: History[number]["outcome"] }

/**
 * The deploys this machine sent for one app on one server, oldest first. The
 * history file is not trusted: each entry counts only if it is a deploy
 * signed by a current team member for this app and this server, and its
 * number and service definition are read from under that signature.
 */
function sentDeploys(deps: Deps, team: Team, server: Server, app: string, history: History): Sent[] {
  const sent: Sent[] = []
  let ignored = 0
  for (const entry of history) {
    const read = readSignedDeploy({ envelope: entry.envelope, trust: team.trust })
    const deploy = read.ok ? read.value.deploy : undefined
    if (deploy?.teamId === team.trust.teamId && deploy.serverId === server.serverId && deploy.app === app) {
      sent.push({ sequence: deploy.sequence, compose: deploy.compose, outcome: entry.outcome })
    } else {
      ignored++
    }
  }
  if (ignored > 0) {
    deps.ui.warn(`Ignored ${ignored} entr${ignored === 1 ? "y" : "ies"} in the deploy history that could not be verified.`)
  }
  return sent.sort((a, b) => a.sequence - b.sequence)
}

/** Signs a deploy of `compose` with the next number and delivers it to the runner. */
async function deliver(deps: Deps, where: Awaited<ReturnType<typeof locate>>, options: Options, compose: string): Promise<number> {
  const { team, server, app } = where
  const { trust, store } = team
  const transport = reach(deps, server.target)

  const { sequence, secrets, report } = await deps.ui.step(
    `Deploying ${app} to ${server.name}`,
    async () => {
      const status = await ask(transport, "status", RunnerStatusSchema)
      checkIdentity(team, server, status)

      // The next number is above both what the runner accepted and what this
      // machine signed, so a number is never signed twice, whatever the runner says.
      const history = store.history(server.serverId, app)
      const signed = sentDeploys(deps, team, server, app, history).at(-1)?.sequence ?? 0
      const accepted = Object.hasOwn(status.lastSequence, app) ? status.lastSequence[app]! : 0
      if (accepted > signed + MAX_AHEAD) {
        throw new CliError(
          `${server.name} says it has accepted deploy ${accepted} of ${app}, far beyond the ${signed} this machine has signed. Nothing was signed.`
        )
      }
      const sequence = Math.max(accepted, signed) + 1

      const held = store.secrets(server.serverId, app)
      const current = currentSecrets({ trust, serverId: server.serverId, app, ...held })
      for (const ignored of current.ignored) {
        deps.ui.warn(`Left out a ${ignored.kind}${ignored.name ? ` for ${ignored.name}` : ""}: ${ignored.reason}.`)
      }

      const deploy = await team
        .withSigner((signer) =>
          createDeploy({
            trust,
            serverId: server.serverId,
            app,
            sequence,
            compose,
            secrets: current.secrets,
            removals: current.removals,
            signer,
          })
        )
        .catch((error: unknown) => {
          if (error instanceof CoreError) throw new CliError(`The deploy could not be signed (${error.code}).`)
          throw error
        })

      // Recorded before it leaves: once signed, the number is used, whatever comes back.
      const at = new Date().toISOString()
      store.saveHistory(server.serverId, app, [...history, { envelope: deploy.envelope, at, outcome: "sent" }])

      const report = await ask(transport, "apply", RunnerReportSchema, { rosters: team.profile.rosters, deploy })
      const outcome = report.outcome
      if ((outcome !== "started" && outcome !== "start_failed") || report.app !== app || report.sequence !== sequence) {
        throw new CliError("The runner did not answer as expected, so it is not known whether the deploy was accepted.")
      }
      store.saveHistory(server.serverId, app, [...history, { envelope: deploy.envelope, at, outcome }])
      return { sequence, secrets: current.secrets.length, report }
    },
    { quiet: server.target.kind === "ssh" }
  )

  if (options.json) deps.ui.json({ ...report, server: server.name })
  if (report.outcome === "start_failed") {
    if (!options.json) {
      deps.ui.error(`Deploy ${sequence} of ${app} was accepted by ${server.name}, but the app did not start. Check Docker on the server.`)
    }
    return 1
  }
  if (!options.json) deps.ui.success(`Deploy ${sequence} of ${app} is running on ${server.name} with ${secrets} secret(s).`)
  return 0
}

export async function deploy(deps: Deps, options: Options & { file?: string }): Promise<number> {
  const where = await locate(deps, options) // "run init first" comes before any complaint about files
  const path = resolve(deps.cwd, options.file ?? "compose.yaml")
  if (!existsSync(path)) throw new CliError(`No Compose file at ${path}. Point to one with \`-f <file>\`.`)
  if (statSync(path).size > LIMITS.composeBytes) throw new CliError("The Compose file is larger than the 256 KiB limit.")
  const compose = readFileSync(path, "utf8")
  if (compose.trim() === "") throw new CliError(`The Compose file at ${path} is empty.`)
  return deliver(deps, where, options, compose)
}

/** Deploys an earlier service definition again, under the next number, with the current secrets. */
export async function rollback(deps: Deps, options: Options & { to?: string }): Promise<number> {
  const where = await locate(deps, options)
  const { team, server, app } = where
  if (options.to !== undefined && !/^[1-9][0-9]{0,15}$/.test(options.to)) {
    throw new UsageError("`--to` takes a deploy number, such as `--to 3`.")
  }
  // Only deploys the runner answered for: one that was never accepted is not something to return to.
  const accepted = sentDeploys(deps, team, server, app, team.store.history(server.serverId, app)).filter(
    (entry) => entry.outcome !== "sent"
  )
  if (accepted.length === 0) throw new CliError(`${app} has not been deployed to ${server.name} from this machine.`)

  let entry
  if (options.to !== undefined) {
    const wanted = Number(options.to)
    entry = accepted.find((item) => item.sequence === wanted)
    if (!entry) {
      throw new CliError(`No deploy numbered ${options.to} in the history. Known: ${accepted.map((item) => item.sequence).join(", ")}.`)
    }
  } else {
    entry = accepted.at(-2)
    if (!entry) throw new CliError("There is only one deploy in the history, so there is nothing to roll back to.")
  }
  if (!options.json) deps.ui.info(`Rolling back ${app} to what deploy ${entry.sequence} ran.`)
  return deliver(deps, where, options, entry.compose)
}

export async function status(deps: Deps, options: { server?: string; json?: boolean }): Promise<void> {
  const team = await openTeam(deps)
  const server = findServer(team.profile, options.server)
  const answer = await deps.ui.step(
    `Asking ${server.name}`,
    async () => {
      const answer = await ask(reach(deps, server.target), "status", RunnerStatusSchema)
      checkIdentity(team, server, answer)
      return answer
    },
    { quiet: server.target.kind === "ssh" }
  )
  if (options.json) return deps.ui.json({ server: server.name, ...answer })

  const behind = answer.team.version < team.trust.version ? " (behind this machine; the next deploy brings it up to date)" : ""
  deps.ui.info(`${server.name}: team list version ${answer.team.version}${behind}`)
  const apps = Object.entries(answer.lastSequence)
  if (apps.length === 0) deps.ui.info("No deploys yet.")
  else deps.ui.table(apps.map(([app, sequence]) => [app, `deploy ${sequence}`]))
  const secrets = Object.entries(answer.secrets)
  if (secrets.length > 0) {
    deps.ui.table(secrets.map(([key, known]) => [key, `version ${known.version}${known.removed ? " (removed)" : ""}`]))
  }
}
