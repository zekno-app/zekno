import { realpathSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

import { remoteThroughUi, type Deps } from "../cli/context"
import {
  prepareDeploy,
  prepareRollback,
  sendDeploy,
  type DeployPlan,
  type Where,
} from "../ops/deploy"
import { shownPath } from "../project/shown"
import { sanitize } from "../server/sanitize"
import { plainDeployView, type DeployStart } from "../shared/deploy"

/** Kept where earlier tests and tools look for them. */
export { HELD_LINES, heldLines, leftOut } from "../shared/deploy"

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

/** A Compose file as the person knows it: from the folder they are in when it is inside it, else from their home. Cleaned: a folder's name can hold anything. */
export function shownFile(cwd: string, path: string): string {
  const folders = [resolve(cwd)]
  try {
    // A file found by its real path is inside the folder's real path.
    folders.push(realpathSync(folders[0]!))
  } catch {
    // A folder that cannot be found again is compared as it was given.
  }
  for (const folder of folders) {
    const inside = relative(folder, path)
    if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside))
      return sanitize(inside)
  }
  return shownPath(path)
}

/**
 * Signs and sends, shown by the deploy view: at a terminal the summary panel,
 * the stage row and the result (board "zekno deploy: success and failure");
 * in plain output the result line, and Docker's lines when the app did not
 * start. With `--json`, only the JSON object on standard output, and those
 * lines on standard error when the app did not start. `zekno deploy` at a
 * terminal sends through it too (asking/first-deploy.ts).
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
    })
  } catch (error) {
    // The stage it stopped at stays on the screen, and the reason is said below it.
    await view.end({ outcome: "error" })
    throw error
  }
  if (options.json) deps.ui.json({ ...result.report, server: result.server })
  await view.end({
    outcome: result.outcome,
    sequence: result.sequence,
    app: result.app,
    server: result.server,
    secrets: result.secrets,
    ms: Date.now() - began,
  })
  return result.outcome === "start_failed" ? 1 : 0
}

export async function deploy(
  deps: Deps,
  options: Options & { file?: string }
): Promise<number> {
  const plan = await prepareDeploy(deps, options)
  const start = {
    app: plan.app,
    server: plan.server.name,
    file: shownFile(deps.cwd, plan.from),
    flags: flagsAgain(options.typed),
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
