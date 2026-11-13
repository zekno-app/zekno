import { CoreError, createDeploy, currentSecrets, LIMITS, readSignedDeploy, RunnerReportSchema, RunnerStatusSchema, type RunnerReport } from "@workspace/core"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

import { openTeam, reach, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer, NAME, type History, type Server } from "../profile"
import { withSession, type SessionMode } from "../session"
import { checkIdentity } from "./status"

/** data-model.md, "Stages of a deploy". A refusal ends a deploy at whatever stage it had reached. */
export type DeployStage = "checked" | "signed" | "sent" | "starting" | "started" | "failed"

/** What a deploy is, from the moment its number is known. */
export type DeployInfo = { app: string; server: string; sequence: number; secrets: number }

export type DeployCallbacks = {
  /** A stage was reached. */
  stage?: (stage: DeployStage, deploy: DeployInfo) => void
  /** One line of Docker's output, already cleaned. Only a runner that speaks sessions sends them. */
  progress?: (line: string) => void
  /** Something the person should notice. The work carries on. */
  warning?: (text: string) => void
}

/** A deploy that has passed every check made on this machine, and has not been signed or sent. */
export type DeployPlan = { team: Team; server: Server; app: string; compose: string }

export type DeployResult = DeployInfo & {
  outcome: "started" | "start_failed"
  /** The runner's report, as it answered. */
  report: RunnerReport
  /** How the runner was reached. `one-shot` is a runner that does not speak sessions. */
  mode: SessionMode
}

/**
 * How far a runner's last deploy number may be ahead of the highest one this
 * machine signed. A runner far beyond that is not one this machine has been
 * deploying to, and its word is not a reason to sign a far higher number.
 */
const MAX_AHEAD = 1000

type Where = { app?: string; server?: string }

async function locate(deps: OpDeps, where: Where) {
  const team = await openTeam(deps)
  const server = findServer(team.profile, where.server)
  if (!where.app || !NAME.test(where.app)) {
    throw new UsageError("Say which app with `--app <name>`: lowercase letters, digits and hyphens.")
  }
  return { team, server, app: where.app }
}

type Sent = { sequence: number; compose: string; outcome: History[number]["outcome"] }

/**
 * The deploys this machine sent for one app on one server, oldest first. The
 * history file is not trusted: each entry counts only if it is a deploy
 * signed by a current team member for this app and this server, and its
 * number and service definition are read from under that signature.
 */
function sentDeploys(team: Team, server: Server, app: string, history: History, warning?: (text: string) => void): Sent[] {
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
    warning?.(`Ignored ${ignored} entr${ignored === 1 ? "y" : "ies"} in the deploy history that could not be verified.`)
  }
  return sent.sort((a, b) => a.sequence - b.sequence)
}

/** Checks a deploy of the Compose file in the project folder. "Run init first" comes before any complaint about files. */
export async function prepareDeploy(deps: OpDeps, input: Where & { file?: string }): Promise<DeployPlan> {
  const where = await locate(deps, input)
  const path = resolve(deps.cwd, input.file ?? "compose.yaml")
  if (!existsSync(path)) throw new CliError(`No Compose file at ${path}. Point to one with \`-f <file>\`.`)
  if (statSync(path).size > LIMITS.composeBytes) throw new CliError("The Compose file is larger than the 256 KiB limit.")
  const compose = readFileSync(path, "utf8")
  if (compose.trim() === "") throw new CliError(`The Compose file at ${path} is empty.`)
  return { ...where, compose }
}

/**
 * Picks the earlier deploy to return to: the one before the latest, or
 * `to`. Only deploys the runner answered for count: one that was never
 * accepted is not something to return to. `from` is the number whose
 * service definition will be deployed again.
 */
export async function prepareRollback(
  deps: OpDeps,
  input: Where & { to?: string },
  callbacks: Pick<DeployCallbacks, "warning"> = {}
): Promise<DeployPlan & { from: number }> {
  const where = await locate(deps, input)
  const { team, server, app } = where
  if (input.to !== undefined && !/^[1-9][0-9]{0,15}$/.test(input.to)) {
    throw new UsageError("`--to` takes a deploy number, such as `--to 3`.")
  }
  const history = team.store.history(server.serverId, app)
  const accepted = sentDeploys(team, server, app, history, callbacks.warning).filter((entry) => entry.outcome !== "sent")
  if (accepted.length === 0) throw new CliError(`${app} has not been deployed to ${server.name} from this machine.`)

  let entry
  if (input.to !== undefined) {
    const wanted = Number(input.to)
    entry = accepted.find((item) => item.sequence === wanted)
    if (!entry) {
      throw new CliError(`No deploy numbered ${input.to} in the history. Known: ${accepted.map((item) => item.sequence).join(", ")}.`)
    }
  } else {
    entry = accepted.at(-2)
    if (!entry) throw new CliError("There is only one deploy in the history, so there is nothing to roll back to.")
  }
  return { ...where, compose: entry.compose, from: entry.sequence }
}

/**
 * Signs a deploy of the plan's service definition with the next number and
 * delivers it, over one session: `status`, then `apply`.
 */
export async function sendDeploy(deps: OpDeps, plan: DeployPlan, callbacks: DeployCallbacks = {}): Promise<DeployResult> {
  const { team, server, app, compose } = plan
  const { trust, store } = team

  return withSession(reach(deps, server.target), async (session) => {
    const status = await session.request("status", RunnerStatusSchema)
    checkIdentity(team, server, status)

    // The next number is above both what the runner accepted and what this
    // machine signed, so a number is never signed twice, whatever the runner says.
    const history = store.history(server.serverId, app)
    const signed = sentDeploys(team, server, app, history, callbacks.warning).at(-1)?.sequence ?? 0
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
      callbacks.warning?.(`Left out a ${ignored.kind}${ignored.name ? ` for ${ignored.name}` : ""}: ${ignored.reason}.`)
    }
    const info: DeployInfo = { app, server: server.name, sequence, secrets: current.secrets.length }
    callbacks.stage?.("checked", info)

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
    callbacks.stage?.("signed", info)

    let starting = false
    const start = () => {
      if (starting) return
      starting = true
      callbacks.stage?.("starting", info)
    }
    const answer = session.request("apply", RunnerReportSchema, {
      input: { rosters: team.profile.rosters, deploy },
      onEvent: (event) => {
        if (event.event !== "progress") return
        start()
        callbacks.progress?.(event.line)
      },
    })
    callbacks.stage?.("sent", info)
    const report = await answer

    const outcome = report.outcome
    if ((outcome !== "started" && outcome !== "start_failed") || report.app !== app || report.sequence !== sequence) {
      throw new CliError("The runner did not answer as expected, so it is not known whether the deploy was accepted.")
    }
    start()
    store.saveHistory(server.serverId, app, [...history, { envelope: deploy.envelope, at, outcome }])
    callbacks.stage?.(outcome === "started" ? "started" : "failed", info)
    return { ...info, outcome, report, mode: session.mode }
  })
}
