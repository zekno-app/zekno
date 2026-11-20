import { remoteThroughUi, type Deps } from "../cli/context"
import {
  prepareDeploy,
  prepareRollback,
  sendDeploy,
  type DeployPlan,
  type Where,
} from "../ops/deploy"
import { httpsAfter } from "../ops/deploy-https"
import { shownFile } from "../project/shown"
import { sanitize } from "../server/sanitize"
import { DP3 } from "../settings/words"
import { plainDeployView, type DeployStart } from "../shared/deploy"

/** Kept where earlier tests and tools look for them. */
export { HELD_LINES, heldLines, leftOut } from "../shared/deploy"
/** Kept here for its callers; it lives in project/shown.ts, where settings/ can use it too. */
export { shownFile } from "../project/shown"

/**
 * `typed`: the `--app` and `--server` the person typed, as opposed to those
 * zekno.json gave, so that what a result suggests running next acts on the
 * same app and server.
 */
type Options = Where & {
  json?: boolean
  typed?: { app?: string; server?: string }
}

/** The flags to type again for the same app and server: those typed, and none that zekno.json gives anyway. Both are names held to a pattern. */
export function flagsAgain(typed: Options["typed"]): string {
  return `${typed?.app === undefined ? "" : ` --app ${typed.app}`}${typed?.server === undefined ? "" : ` --server ${typed.server}`}`
}

/**
 * Signs and sends, shown by the deploy view: at a terminal the summary panel,
 * the stage row and the result (board "zekno deploy: success and failure");
 * in plain output the result line, and Docker's lines when the app did not
 * start. With `--json`, only the JSON object on standard output, and those
 * lines on standard error when the app did not start. `zekno deploy` at a
 * terminal sends through it too (asking/first-deploy.ts).
 *
 * With a domain or a health check (specs/015-domains-https,
 * contracts/cli.md, CL3): B1 before anything is signed and the runner's
 * `health` events reach the view; `routes_failed` and `unhealthy` end with
 * their sentence, exit status 1; a start with domains new to the app waits
 * for HTTPS before the view ends (B4 to B6), exit status 0 whatever it
 * found. With `--json` nothing is waited for: standard output holds the one
 * object.
 */
export async function send(
  deps: Deps,
  plan: DeployPlan,
  options: Options,
  start: DeployStart
): Promise<number> {
  const view = options.json
    ? plainDeployView(deps.ui, false)
    : deps.ui.deploy(start)
  const began = Date.now()
  let result
  try {
    result = await sendDeploy(remoteThroughUi(deps), plan, {
      stage: (stage, info) => view.stage(stage, info),
      progress: (line) => view.progress(line),
      warning: (text) => deps.ui.warn(text),
      // Only a deploy with a domain or a health check calls these (CL7): a view without them is every other deploy's.
      pointed: (domain, address) => view.pointed?.(domain, address),
      health: (service) => view.health?.(service),
    })
  } catch (error) {
    // The stage it stopped at stays on the screen, and the reason is said below it.
    await view.end({ outcome: "error" })
    throw error
  }
  if (options.json) deps.ui.json({ ...result.report, server: result.server })
  const ms = Date.now() - began
  const https = options.json
    ? undefined
    : await httpsAfter(deps, result, (shown) => view.https?.(shown))
  await view.end({
    outcome: result.outcome,
    sequence: result.sequence,
    app: result.app,
    server: result.server,
    secrets: result.secrets,
    ms,
    ...(result.problem === undefined ? {} : { problem: result.problem }),
    ...(https === undefined ? {} : { https }),
    // B20: the runner stopped waiting for the start at its limit (protocol 5).
    ...(result.report.startLimit === undefined
      ? {}
      : { startLimit: result.report.startLimit }),
  })
  return result.outcome === "started" ? 0 : 1
}

/**
 * The summary's `from` row of a deploy from a settings file (specs/010-app-settings,
 * contracts/deploy.md, DP3): the file as the deploy names it, and its
 * services, `2 services: web, worker`. Nothing for a Compose file. Service
 * names passed their rule when the file was read; they are cleaned all the
 * same.
 */
export function fromRow(
  cwd: string,
  plan: { from: string; services?: readonly string[] }
): Pick<DeployStart, "from"> {
  if (plan.services === undefined) return {}
  return {
    from: {
      file: shownFile(cwd, plan.from),
      detail: sanitize(DP3.detail(plan.services)),
    },
  }
}

export async function deploy(
  deps: Deps,
  options: Options & { file?: string; skipDnsCheck?: boolean }
): Promise<number> {
  const plan = {
    ...(await prepareDeploy(deps, options)),
    skipDnsCheck: options.skipDnsCheck === true,
  }
  const start: DeployStart = {
    app: plan.app,
    server: plan.server.name,
    file: shownFile(deps.cwd, plan.from),
    flags: flagsAgain(options.typed),
    ...fromRow(deps.cwd, plan),
  }
  return send(deps, plan, options, start)
}

/** Deploys an earlier service definition again, under the next number, with the current secrets. */
export async function rollback(
  deps: Deps,
  options: Options & { to?: string }
): Promise<number> {
  const plan = await prepareRollback(deps, options, {
    warning: (text) => deps.ui.warn(text),
  })
  if (!options.json)
    deps.ui.info(`Rolling back ${plan.app} to what deploy ${plan.from} ran.`)
  return send(deps, plan, options, {
    app: plan.app,
    server: plan.server.name,
    flags: flagsAgain(options.typed),
  })
}
