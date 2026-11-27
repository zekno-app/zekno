import type { Health, Route, RunnerReport } from "@workspace/core"
import { reach, teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, MISSING_APP, UsageError, WrongInput } from "../cli/errors"
import { isRouted } from "../domains/routes"
import { findServer, NAME, type History, type Server } from "../profile/profile"
import type { ProjectLink } from "../project/file"
import { sanitize } from "../server/sanitize"
import { chooseSource } from "../settings/source"
import { DP2 } from "../settings/words"
import {
  namedUnreachable,
  withSession,
  type SessionMode,
} from "../server/session"
import { appTaken } from "../shared/app-names"
import { BuildStop, lineText, type BuildLine } from "../shared/build-lines"
import type { DeployInfo, DeployOutcome, DeployStage } from "../shared/deploy"
import { readDeployEntry } from "../shared/history"
import { RUNNER_RELEASE } from "../version/runner-release"
import {
  checkAgreed,
  prepareBuild,
  readDeploySource,
  type BuildPlan,
  type SourceRead,
} from "./deploy-build"
import { buildsInSession } from "./deploy-build-session"
import { checkDomains, rollbackAsksRoutes } from "./deploy-domains"
import { chooseFormat } from "./deploy-format"
import { deployVersionOne, deployVersionTwo } from "./deploy-send"
import { answersRoutes, askStatus, checkIdentity } from "./status"

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
  /**
   * B1, before anything is signed: a domain new to the app points to the
   * server, at `address` (specs/015-domains-https, contracts/cli.md, CL3).
   * Only a deploy with a domain says it.
   */
  pointed?: (domain: string, address: string) => void
  /** The runner began to wait for `service` to be healthy (C2). Only a deploy with a health check is told. */
  health?: (service: string) => void
  /**
   * A line of specs/016-build-from-source said while the deploy goes on, by
   * its row (B30). Without it, the line goes to `warning` as its text.
   */
  line?: (line: BuildLine) => void
}

/**
 * A deploy that has passed every check made on this machine, and has not been
 * signed or sent. `newApp`: the app's name was typed at a terminal as a new
 * one (asking/first-deploy.ts), so the deploy stops before anything is signed
 * when the runner says it holds that app already (`AppTaken`). `rollback`:
 * made by `prepareRollback`, so what it says names `zekno rollback` (C1).
 */
export type DeployPlan = {
  team: Team
  server: Server
  app: string
  compose: string
  /**
   * The routes the deploy signs, sorted by domain, and its health check
   * (specs/015-domains-https, contracts/cli.md, CL3; domains/routes.ts):
   * from a settings file, as `readSource` gives them. Left out: none, as for
   * a Compose file written by hand and every deploy before feature 015. A
   * rollback leaves them out too: it signs those in force on the server
   * (ops/deploy-domains.ts).
   */
  routes?: readonly Route[]
  health?: Health | null
  newApp?: boolean
  /** `zekno deploy --fresh` (specs/016-build-from-source, CL7): each build signs `fresh` equal to the deploy's own number. */
  fresh?: boolean
  /**
   * A deploy that builds (specs/016-build-from-source, CL7 steps 1 to 4;
   * ops/deploy-build.ts): what was prepared before the session. `compose` is
   * then not signed: the session makes the text from the build keys.
   */
  build?: BuildPlan
  rollback?: true
  /** A rollback's: the deploy whose service definition it deploys again, as B12 names it. */
  rollbackOf?: number
  /** `zekno deploy --skip-dns-check`: no domain is looked up, and B14 says so for each new one (CL3, step 5). */
  skipDnsCheck?: boolean
}

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
  /**
   * The runner's outcome. `routes_failed` and `unhealthy` (protocol 4,
   * specs/015-domains-https, contracts/cli.md, CL3): the deploy was accepted
   * and its app started; its routes are not in force, or it was not healthy
   * in time.
   */
  outcome: DeployOutcome
  /** The runner's report, as it answered. */
  report: RunnerReport
  /** How the runner was reached. `one-shot` is a runner that does not speak sessions. */
  mode: SessionMode
  /** For `routes_failed` and `unhealthy`: its sentence (B16 to B19, C3, C4; domains/outcome.ts). */
  problem?: string
  /** The domains it signed that the server did not hold for the app before: the wait for HTTPS is for them (B4 to B6). */
  newDomains: readonly string[]
}

/**
 * Where a command acts: an app on a server. `serverFrom` is set when the
 * server's name was read from the project file, as a sentence shows the file.
 */
export type Where = { app?: string; server?: string; serverFrom?: string }

/** The app's name, checked against the app-name pattern before anything is read or sent. */
export function checkApp(app: string | undefined): string {
  if (!app) throw new UsageError(MISSING_APP)
  if (!NAME.test(app))
    throw new UsageError(
      "Say which app with `--app <name>`: lowercase letters, digits and hyphens."
    )
  return app
}

async function locate(deps: OpDeps, where: Where) {
  const team = await teamOf(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  return { team, server, app: checkApp(where.app) }
}

type Sent = {
  sequence: number
  compose: string
  outcome: History[number]["outcome"]
}

/**
 * The deploys this machine sent for one app on one server, oldest first. The
 * history file is not trusted: each entry counts only if it is a deploy, of
 * either kind (`readDeployEntry`), signed by a current team member for this
 * app and this server, and its number and service definition are read from
 * under that signature.
 */
function sentDeploys(
  team: Team,
  server: Server,
  app: string,
  history: History,
  warning?: (text: string) => void
): Sent[] {
  const sent: Sent[] = []
  let ignored = 0
  for (const entry of history) {
    const deploy = readDeployEntry(entry.envelope, team.trust)?.deploy
    if (
      deploy?.teamId === team.trust.teamId &&
      deploy.serverId === server.serverId &&
      deploy.app === app
    ) {
      sent.push({
        sequence: deploy.sequence,
        compose: deploy.compose,
        outcome: entry.outcome,
      })
    } else {
      ignored++
    }
  }
  if (ignored > 0) {
    warning?.(
      `Ignored ${ignored} entr${ignored === 1 ? "y" : "ies"} in the deploy history that could not be verified.`
    )
  }
  return sent.sort((a, b) => a.sequence - b.sequence)
}

/**
 * What a deploy is of (specs/010-app-settings, contracts/deploy.md, "Which
 * file a deploy uses"): `-f`, as the person typed it, either kind; else the
 * file of the accepted project file (`project`, from `withProject`), which
 * may be `zekno.app.json`; else the one of compose.yaml and zekno.app.json
 * in the current folder. `read` is a file already read, whose text is signed
 * as it is: the app's, and `zekno deploy` at a terminal, which asked which
 * file first when both were there.
 */
export type DeployInput = Where & {
  file?: string
  project?: ProjectLink
  read?: SourceRead
  /** `--fresh` (specs/016-build-from-source, CL7 step 2). */
  fresh?: boolean
}

/**
 * Checks a deploy of a Compose file, or of a settings file. "Run init first"
 * comes before any complaint about files. The file is read once, here
 * (`readSource`), and the text read is the text the plan signs: never a path
 * read again later. A settings file's Compose text is made on this machine
 * from the settings it holds, checked whole, and that text is the text
 * signed, sent and recorded, as a Compose file's is (FR-009). With both files
 * here and nothing to say which, nothing is read: DP2, which names `-f`.
 * `services`: a settings file's services, for the summary's `from` row. A
 * settings file's routes and health check are carried as read with its text
 * (specs/015-domains-https, contracts/cli.md, CL3).
 *
 * A settings file with a built service (specs/016-build-from-source, CL7
 * steps 1 to 4) is read whole and prepared before the session
 * (`prepareBuild`): every stop with nothing signed, then its packs sealed.
 * `--fresh` on a deploy that builds nothing is C21.
 */
export async function prepareDeploy(
  deps: OpDeps,
  input: DeployInput
): Promise<DeployPlan & { from: string; services?: readonly string[] }> {
  const where = await locate(deps, input)
  let read = input.read
  if (read === undefined) {
    const source = chooseSource(deps.cwd, {
      file: input.file,
      project: input.project,
    })
    if (source.kind === "both") throw new WrongInput(DP2)
    read = readDeploySource(source, deps.cwd)
  }
  const fresh = input.fresh === true
  if (fresh && read.built === undefined)
    throw new BuildStop({ id: "C21", app: where.app })
  // A folder's name can hold anything, escape sequences included, so a path is cleaned before it is shown.
  if (read.text.trim() === "")
    throw new CliError(`The Compose file at ${sanitize(read.path)} is empty.`)
  const build =
    read.built === undefined
      ? undefined
      : await prepareBuild(deps, { ...where, read: read.built, fresh })
  return {
    ...where,
    compose: read.text,
    from: read.path,
    ...(read.settings === undefined
      ? {}
      : {
          services: read.settings.services,
          routes: read.settings.routes,
          health: read.settings.health,
        }),
    ...(build === undefined ? {} : { build }),
    ...(fresh ? { fresh } : {}),
  }
}

/**
 * `--to`: a deploy number. At a terminal it is checked before any question
 * (specs/006-cli-small-features, research R1); otherwise `prepareRollback`
 * checks it once it found the server and the app, as it always has.
 */
export function checkTo(to: string | undefined): void {
  if (to !== undefined && !/^[1-9][0-9]{0,15}$/.test(to))
    throw new UsageError("`--to` takes a deploy number, such as `--to 3`.")
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
  const accepted = sentDeploys(
    team,
    server,
    app,
    history,
    callbacks.warning
  ).filter((entry) => entry.outcome !== "sent")
  if (accepted.length === 0)
    throw new CliError(
      `${app} has not been deployed to ${server.name} from this machine.`
    )

  let entry
  if (input.to !== undefined) {
    const wanted = Number(input.to)
    entry = accepted.find((item) => item.sequence === wanted)
    if (!entry) {
      throw new CliError(
        `No deploy numbered ${input.to} in the history. Known: ${accepted.map((item) => item.sequence).join(", ")}.`
      )
    }
  } else {
    entry = accepted.at(-2)
    if (!entry)
      throw new CliError(
        "There is only one deploy in the history, so there is nothing to roll back to."
      )
  }
  return {
    ...where,
    compose: entry.compose,
    from: entry.sequence,
    rollback: true,
    rollbackOf: entry.sequence,
  }
}

/**
 * Signs a deploy of the plan's service definition and delivers it, over one
 * session (specs/014-deploy-v2, contracts/cli.md CL1 to CL11): the format
 * first, from the runner's answer to `version` (C7 stops here, before
 * anything is read or signed); then `status`, checked; then the deploy in
 * that format (deploy-send.ts).
 *
 * A deploy with a route or a health check asks `status` with the routes in
 * force from a runner of protocol 4, and so does a rollback whose app may
 * hold some, after asking as before; both check their domains before
 * anything is signed (specs/015-domains-https, contracts/cli.md, CL3;
 * ops/deploy-domains.ts). Any other deploy asks it as before, and checks
 * nothing more (CL7).
 *
 * A deploy that builds (specs/016-build-from-source, CL7 steps 6 to 11) is
 * signed only for a runner of protocol 6 (F1), asks `builder` and `builds`
 * once the domains are checked (ops/deploy-build-session.ts), and signs its
 * builds. With no terminal, a secret-looking file no one agreed to stops it
 * before the session opens (C19). This run's folder of sealed pieces goes
 * when the deploy ends. Any other deploy makes exactly the requests it made.
 */
export async function sendDeploy(
  deps: OpDeps,
  plan: DeployPlan,
  callbacks: DeployCallbacks = {}
): Promise<DeployResult> {
  const { team, server, app, build } = plan
  const carried = (deps.release ?? RUNNER_RELEASE).version
  if (build !== undefined) {
    try {
      checkAgreed(build)
    } catch (error) {
      build.run.remove()
      throw error
    }
  }
  const say =
    callbacks.line ?? ((line: BuildLine) => callbacks.warning?.(lineText(line)))

  return withSession(reach(deps, server.target), async (session) => {
    // CL1. Nothing is signed in a format the runner does not carry out, and nothing is downgraded unsaid. A route or a
    // health check needs a runner that carries them out: B10 (specs/015-domains-https, CL3 step 1).
    const routed = isRouted(plan.routes, plan.health)
    const chosen = chooseFormat({
      server: server.name,
      mode: session.mode,
      runner: session.runner,
      carried,
      routed,
      builds: build !== undefined,
    })

    // CL2. Who answers, and the number it holds for the app; with the routes in force when they matter (CL3 step 2).
    let { status, held } = await askStatus(session, routed)
    checkIdentity(team, server, status)
    const numberOf = () =>
      Object.hasOwn(status.lastSequence, app) ? status.lastSequence[app]! : 0
    // A rollback keeps the routes and the health check in force (CL3 step 4): asked again with them, unless this machine
    // knows there are neither.
    if (
      plan.rollback === true &&
      answersRoutes(session) &&
      rollbackAsksRoutes(team, server, app, numberOf())
    ) {
      ;({ status, held } = await askStatus(session, true))
      checkIdentity(team, server, status)
    }
    const history = team.store.history(server.serverId, app)
    const sent = sentDeploys(team, server, app, history, callbacks.warning)
    const accepted = numberOf()
    // Read on this connection, which the person's answers already made: a name typed as new is never one the runner holds.
    if (plan.newApp === true && accepted >= 1)
      throw new AppTaken(server.name, app)

    // CL3, steps 2 to 6: B9, B11, a rollback's routes and B12, the DNS check. What is signed of the domains comes from here.
    const domained = await checkDomains({
      deps,
      plan,
      held,
      answersRoutes: answersRoutes(session),
      runnerVersion: session.runner?.version,
      callbacks,
    })
    const signing: DeployPlan = {
      ...plan,
      routes: domained.routes,
      health: domained.health,
    }
    // specs/016-build-from-source, CL7 steps 8 and 9: asked only by a deploy that builds.
    const building =
      build === undefined
        ? undefined
        : await buildsInSession({
            session,
            team,
            server,
            app,
            build,
            fresh: plan.fresh === true,
          })
    for (const line of building?.older ?? []) say(line)
    const going = {
      session,
      plan: signing,
      status,
      accepted,
      history,
      // The build's lines (D4 to D6, D17) reach `warning` too when the caller takes no `line` (deploy-send-build.ts).
      callbacks: { ...callbacks, line: say },
      domained,
      ...(building === undefined ? {} : { building }),
    }
    if (chosen.format === 2) return deployVersionTwo(going)
    return deployVersionOne({
      ...going,
      signed: sent.at(-1)?.sequence ?? 0,
      ...(chosen.older === undefined ? {} : { older: chosen.older }),
      carried,
    })
  })
    .catch((error: unknown) => {
      throw namedUnreachable(error, server.name)
    })
    .finally(() => build?.run.remove())
}
