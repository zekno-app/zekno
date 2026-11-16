import { remoteThroughUi, type Deps } from "../cli/context"
import {
  addServer,
  listServers,
  prepareServerAdd,
  prepareServerUpdate,
  runnerWarning,
  updateRunner,
} from "../ops/server"
import { RUNNER_RELEASE } from "../version/runner-release"

/** Said after a server reached over SSH is added: where its identity rests. The first deploy says it too (asking/first-deploy.ts, F4). */
export const SSH_IDENTITY =
  "You reached this server over SSH, so its identity rests on SSH's host verification."

/**
 * Connects a server: over SSH with no runner path, the runner is found or
 * installed first; then the runner sets itself up for this team and an admin
 * adds it to the team list.
 */
export async function serverAdd(
  deps: Deps,
  name: string | undefined,
  options: {
    ssh?: string
    local?: boolean
    home?: string
    "runner-path"?: string
    "runner-file"?: string
  }
): Promise<void> {
  const plan = await prepareServerAdd(deps, name, {
    ssh: options.ssh,
    local: options.local,
    home: options.home,
    runnerPath: options["runner-path"],
    runnerFile: options["runner-file"],
  })
  const result = await deps.ui.step(
    `Connecting ${plan.name}`,
    () =>
      addServer(remoteThroughUi(deps), plan, {
        resumed: () =>
          deps.ui.info(
            "The runner was already set up for your team by an earlier attempt. Carrying on from there."
          ),
        detail: (line) => deps.ui.remote(line),
      }),
    { quiet: plan.target.kind === "ssh" }
  )

  if (result.target.kind === "ssh" && plan.install) {
    const checked =
      plan.install.source.kind === "file"
        ? "the file this zekno sent"
        : "the checksum this zekno holds"
    deps.ui.info(
      result.installed
        ? `Installed the runner ${plan.install.version} at ${result.target.runnerPath}. It matched ${checked}.`
        : `Using the runner already at ${result.target.runnerPath}.`
    )
  }
  deps.ui.success(`Connected "${result.name}" and added it to the team list.`)
  deps.ui.field("Server code", result.code)
  if (result.target.kind === "ssh") {
    deps.ui.info(SSH_IDENTITY)
  }
  // A runner of another version than this zekno's is said once, on standard error.
  const warning =
    result.relation &&
    runnerWarning(
      result.name,
      result.runner?.version,
      result.relation,
      (deps.release ?? RUNNER_RELEASE).version
    )
  if (warning) deps.ui.warn(warning)
}

/**
 * Replaces the runner on a server with the version this zekno carries, by
 * the same verified route as `server add`. It asks first at a terminal, and
 * needs `--yes` without one: a runner is never updated unasked.
 */
export async function serverUpdate(
  deps: Deps,
  name: string | undefined,
  options: { yes?: boolean }
): Promise<void> {
  const plan = await prepareServerUpdate(deps, name)
  const server = plan.server.name
  const version = plan.request.version
  if (!options.yes) {
    const yes = await deps.ui.confirm(
      `Replace the runner on ${server} with version ${version}? The server downloads it and checks it before it replaces the old one.`,
      `There is no terminal to ask on. Add \`--yes\` to update the runner on ${server}.`
    )
    if (!yes) return deps.ui.info("Nothing was changed.")
  }
  const result = await deps.ui.step(
    `Updating the runner on ${server}`,
    () =>
      updateRunner(remoteThroughUi(deps), plan, {
        detail: (line) => deps.ui.remote(line),
      }),
    { quiet: true }
  )
  if (!result.updated)
    return deps.ui.success(
      `The runner on ${server} already has version ${version}. Nothing was changed.`
    )
  const from = result.from === undefined ? "" : ` from ${result.from}`
  deps.ui.success(
    `Updated the runner on ${server}${from} to ${version}. It matched the checksum this zekno holds.`
  )
}

export async function serverList(deps: Deps): Promise<void> {
  const servers = await listServers(deps)
  if (servers.length === 0) return deps.ui.info("No servers connected yet.")
  deps.ui.table(
    servers.map((server) => [
      server.name,
      server.target.kind === "ssh" ? server.target.destination : "this machine",
      server.serverId,
    ])
  )
}
