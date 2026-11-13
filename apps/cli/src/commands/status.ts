import { remoteThroughUi, type Deps } from "../context"
import { isOutdated } from "../ops/server"
import { locateServer, readStatus, stateOf, type RunState } from "../ops/status"
import { RUNNER_RELEASE } from "../runner-release"
import type { MarkedCell } from "../ui/types"
import { outdatedWarning } from "./server"

const TONES: Record<RunState, MarkedCell["tone"]> = { running: "success", stopped: "danger", "partly running": "warning", unknown: "quiet" }

/**
 * Whether an app is running, as `status` shows it (board "Status, lists,
 * errors and piped output"): `● running` at a terminal, in its colour, and
 * the word alone in plain output.
 */
export const stateCell = (state: RunState): MarkedCell => ({ text: state, mark: "●", tone: TONES[state] })

export async function status(deps: Deps, options: { server?: string; json?: boolean }): Promise<void> {
  const located = await locateServer(deps, options.server)
  const { server } = located
  const { status: answer, behind, mode, runner, states } = await deps.ui.step(`Asking ${server.name}`, () => readStatus(remoteThroughUi(deps), located), {
    quiet: server.target.kind === "ssh",
  })
  // An older runner is said once, on standard error, and changes nothing else.
  const carried = (deps.release ?? RUNNER_RELEASE).version
  if (server.target.kind === "ssh" && isOutdated(mode, runner, carried)) deps.ui.warn(outdatedWarning(server.name, runner?.version, carried))
  const apps = Object.keys(answer.lastSequence)
  if (options.json) {
    // For each app the runner holds: its state and its services, as the runner reported them. Names and states only.
    const running = Object.fromEntries(
      apps.map((app) => [app, { state: stateOf(states, app), services: states && Object.hasOwn(states, app) ? states[app]!.services : [] }])
    )
    return deps.ui.json({ server: server.name, ...answer, apps: running })
  }

  const note = behind ? " (behind this machine; the next deploy brings it up to date)" : ""
  deps.ui.info(`${server.name}: team list version ${answer.team.version}${note}`)
  if (apps.length === 0) deps.ui.info("No deploys yet.")
  else deps.ui.table(apps.map((app) => [app, `deploy ${answer.lastSequence[app]}`, stateCell(stateOf(states, app))]))
  const secrets = Object.entries(answer.secrets)
  if (secrets.length > 0) {
    deps.ui.table(secrets.map(([key, known]) => [key, `version ${known.version}${known.removed ? " (removed)" : ""}`]))
  }
}
