import type { Deps } from "../context"
import { locateServer, readStatus } from "../ops/status"

export async function status(deps: Deps, options: { server?: string; json?: boolean }): Promise<void> {
  const located = await locateServer(deps, options.server)
  const { server } = located
  const { status: answer, behind } = await deps.ui.step(`Asking ${server.name}`, () => readStatus(deps, located), {
    quiet: server.target.kind === "ssh",
  })
  if (options.json) return deps.ui.json({ server: server.name, ...answer })

  const note = behind ? " (behind this machine; the next deploy brings it up to date)" : ""
  deps.ui.info(`${server.name}: team list version ${answer.team.version}${note}`)
  const apps = Object.entries(answer.lastSequence)
  if (apps.length === 0) deps.ui.info("No deploys yet.")
  else deps.ui.table(apps.map(([app, sequence]) => [app, `deploy ${sequence}`]))
  const secrets = Object.entries(answer.secrets)
  if (secrets.length > 0) {
    deps.ui.table(secrets.map(([key, known]) => [key, `version ${known.version}${known.removed ? " (removed)" : ""}`]))
  }
}
