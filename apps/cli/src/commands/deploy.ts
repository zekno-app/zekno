import type { Deps } from "../context"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployCallbacks, type DeployPlan } from "../ops/deploy"

type Options = { app?: string; server?: string; json?: boolean }

function callbacks(deps: Deps): DeployCallbacks {
  return {
    warning: (text) => deps.ui.warn(text),
    // Docker's own lines, already cleaned, go where Docker's output has always gone: standard error.
    progress: (line) => void process.stderr.write(`${line}\n`),
  }
}

async function send(deps: Deps, plan: DeployPlan, options: Options): Promise<number> {
  const result = await deps.ui.step(`Deploying ${plan.app} to ${plan.server.name}`, () => sendDeploy(deps, plan, callbacks(deps)), {
    quiet: plan.server.target.kind === "ssh",
  })
  if (options.json) deps.ui.json({ ...result.report, server: result.server })
  if (result.outcome === "start_failed") {
    if (!options.json) {
      deps.ui.error(
        `Deploy ${result.sequence} of ${result.app} was accepted by ${result.server}, but the app did not start. Check Docker on the server.`
      )
    }
    return 1
  }
  if (!options.json) {
    deps.ui.success(`Deploy ${result.sequence} of ${result.app} is running on ${result.server} with ${result.secrets} secret(s).`)
  }
  return 0
}

export async function deploy(deps: Deps, options: Options & { file?: string }): Promise<number> {
  return send(deps, await prepareDeploy(deps, options), options)
}

/** Deploys an earlier service definition again, under the next number, with the current secrets. */
export async function rollback(deps: Deps, options: Options & { to?: string }): Promise<number> {
  const plan = await prepareRollback(deps, options, callbacks(deps))
  if (!options.json) deps.ui.info(`Rolling back ${plan.app} to what deploy ${plan.from} ran.`)
  return send(deps, plan, options)
}
