import type { Deps } from "../context"
import { addServer, listServers, prepareServerAdd } from "../ops/server"

/** Connects a server: the runner sets itself up for this team, then an admin adds it to the team list. */
export async function serverAdd(
  deps: Deps,
  name: string | undefined,
  options: { ssh?: string; local?: boolean; home?: string; "runner-path"?: string }
): Promise<void> {
  const plan = await prepareServerAdd(deps, name, {
    ssh: options.ssh,
    local: options.local,
    home: options.home,
    runnerPath: options["runner-path"],
  })
  const result = await deps.ui.step(
    `Connecting ${plan.name}`,
    () =>
      addServer(deps, plan, {
        resumed: () => deps.ui.info("The runner was already set up for your team by an earlier attempt. Carrying on from there."),
      }),
    { quiet: plan.target.kind === "ssh" }
  )

  deps.ui.success(`Connected "${result.name}" and added it to the team list.`)
  deps.ui.field("Server code", result.code)
  if (result.target.kind === "ssh") {
    deps.ui.info("You reached this server over SSH, so its identity rests on SSH's host verification.")
  }
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
