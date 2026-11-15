import { CoreError, createDeploy, currentSecrets, readSignedDeploy, RunnerReportSchema, RunnerStatusSchema, type RunnerReport } from "@workspace/core"
import { resolve } from "node:path"

import { appTaken } from "../asking/asking"
import { readCompose, type ComposeText } from "../project/compose-read"
import { reach, teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, MISSING_APP, UsageError } from "../cli/errors"
import { findServer, NAME, type History, type Server } from "../profile/profile"
import type { ProjectLink } from "../project/project"
import { sanitize } from "../server/sanitize"
import { namedUnreachable, withSession, type SessionMode } from "../server/session"
import { checkIdentity } from "./status"

/** data-model.md, "Stages of a deploy". A refusal ends a deploy at whatever stage it had reached. */
export type DeployStage = "checked" | "signed" | "sent" | "starting" | "started" | "failed"

/** What a deploy is, from the moment its number is known. */
export type DeployInfo = { app: string; server: string; sequence: number; secrets: number }

export type DeployCallbacks = {
  /** A stage was reached. */
  stage?: (stage: DeployStage, deploy: DeployInfo) => void
  /**
   * One line of Docker's output, already cleaned. Only a runner that speaks
   * sessions sends them. While a promise it returns is pending, nothing more
   * is read from the runner, so lines that come faster than they can be shown
   * wait in the connection instead of in this process.
   */
  progress?: (line: string) => void | Promise<void>
  /** Something the person should notice. The work carries on. */
  warning?: (text: string) => void
}

/**
 * A deploy that has passed every check made on this machine, and has not been
 * signed or sent. `fresh`: the app's name was typed at a terminal as a new
 * one (asking/first-deploy.ts), so the deploy stops before anything is signed
 * when the runner says it holds that app already (`AppTaken`).
 */
export type DeployPlan = { team: Team; server: Server; app: string; compose: string; fresh?: boolean }

/**
 * A12, said by the deploy itself: an app typed as new is one the runner
 * already holds. When the server's apps could not be read before the
 * question, the name was checked against this machine's history only, and a
 * deploy would replace the app on the server (security review S3).
 */
export class AppTaken extends CliError {
  constructor(server: string, app: string) {
    super(appTaken(server, app))
  }
}

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

/**
 * Where a command acts: an app on a server. `serverFrom` is set when the
 * server's name was read from the project file, as a sentence shows the file.
 */
export type Where = { app?: string; server?: string; serverFrom?: string }

/** The app's name, checked against the app-name pattern before anything is read or sent. */
export function checkApp(app: string | undefined): string {
  if (!app) throw new UsageError(MISSING_APP)
  if (!NAME.test(app)) throw new UsageError("Say which app with `--app <name>`: lowercase letters, digits and hyphens.")
  return app
}

async function locate(deps: OpDeps, where: Where) {
  const team = await teamOf(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  return { team, server, app: checkApp(where.app) }
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

/**
 * What a deploy is of: `-f`, as the person typed it; else the Compose file
 * of the accepted project file (`project`, from `withProject`); else
 * compose.yaml in the current folder. `read` is a Compose file the app has
 * already read, whose text is signed as it is.
 */
export type DeployInput = Where & { file?: string; project?: ProjectLink; read?: ComposeText }

/**
 * Checks a deploy of a Compose file. "Run init first" comes before any
 * complaint about files. The file is read once, here (compose-read.ts), and
 * the text read is the text the plan signs: never a path read again later.
 */
export async function prepareDeploy(deps: OpDeps, input: DeployInput): Promise<DeployPlan & { from: string }> {
  const where = await locate(deps, input)
  const read =
    input.read ??
    readCompose(
      input.file !== undefined
        ? { kind: "given", path: resolve(deps.cwd, input.file) }
        : input.project
          ? { kind: "project", link: input.project }
          : { kind: "default", folder: deps.cwd }
    )
  // A folder's name can hold anything, escape sequences included, so a path is cleaned before it is shown.
  if (read.text.trim() === "") throw new CliError(`The Compose file at ${sanitize(read.path)} is empty.`)
  return { ...where, compose: read.text, from: read.path }
}

/**
 * `--to`: a deploy number. At a terminal it is checked before any question
 * (specs/006-cli-small-features, research R1); otherwise `prepareRollback`
 * checks it once it found the server and the app, as it always has.
 */
export function checkTo(to: string | undefined): void {
  if (to !== undefined && !/^[1-9][0-9]{0,15}$/.test(to)) throw new UsageError("`--to` takes a deploy number, such as `--to 3`.")
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
  checkTo(input.to)
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
    // Read on this connection, which the person's answers already made: a name typed as new is never one the runner holds.
    if (plan.fresh === true && accepted >= 1) throw new AppTaken(server.name, app)
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
        return callbacks.progress?.(event.line)
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
  }).catch((error: unknown) => {
    throw namedUnreachable(error, server.name)
  })
}
