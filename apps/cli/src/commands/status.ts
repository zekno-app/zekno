import { appsOf, latestFirst } from "../app/views"
import { remoteThroughUi, type Deps } from "../context"
import { runnerRelation } from "../ops/server"
import { locateServer, readStatus, stateOf, type RunState } from "../ops/status"
import { RUNNER_RELEASE } from "../runner-release"
import { plainCell, quiet, strong, type MarkedCell } from "../ui/types"
import { outdatedWarning } from "./server"

const TONES: Record<RunState, MarkedCell["tone"]> = { running: "success", stopped: "danger", "partly running": "warning", unknown: "quiet" }

/**
 * Whether an app is running, as `status` shows it (board "Status, lists,
 * errors and piped output"): `● running` at a terminal, in its colour, and
 * the word alone in plain output.
 */
export const stateCell = (state: RunState): MarkedCell => ({ text: state, mark: "●", tone: TONES[state] })

export async function status(deps: Deps, options: { server?: string; serverFrom?: string; json?: boolean }): Promise<void> {
  const located = await locateServer(deps, options.server, options.serverFrom)
  const { server } = located
  const { status: answer, behind, mode, runner, states } = await deps.ui.step(`Asking ${server.name}`, () => readStatus(remoteThroughUi(deps), located), {
    quiet: server.target.kind === "ssh",
  })
  // An older runner is said once, on standard error, and changes nothing else.
  const carried = (deps.release ?? RUNNER_RELEASE).version
  if (server.target.kind === "ssh" && runnerRelation(mode, runner, carried).relation === "older") deps.ui.warn(outdatedWarning(server.name, runner?.version, carried))
  // In Home's order: the latest deploy from this machine's verified history first; an app it has none of last, by name.
  const at = new Map(appsOf(located.team, server, deps.home).map((row) => [row.name, row.at]))
  const apps = Object.keys(answer.lastSequence).sort((a, b) => latestFirst({ name: a, at: at.get(a) }, { name: b, at: at.get(b) }))
  if (options.json) {
    // For each app the runner holds: its state and its services, as the runner reported them. Names and states only.
    const running = Object.fromEntries(
      apps.map((app) => [app, { state: stateOf(states, app), services: states && Object.hasOwn(states, app) ? states[app]!.services : [] }])
    )
    return deps.ui.json({ server: server.name, ...answer, apps: running })
  }

  const note = behind ? " (behind this machine; the next deploy brings it up to date)" : ""
  // At a terminal, as on the board: `prod ● reachable team list v2`. It answered, so it is reachable.
  deps.ui.line(`${server.name}: team list version ${answer.team.version}${note}`, [
    strong(server.name),
    { text: "reachable", mark: "●", tone: "success" },
    quiet(`team list v${answer.team.version}${note}`),
  ])
  if (apps.length === 0) deps.ui.info("No deploys yet.")
  else deps.ui.table(apps.map((app) => [app, plainCell(`deploy ${answer.lastSequence[app]}`), stateCell(stateOf(states, app))]))
  const secrets = Object.entries(answer.secrets)
  if (secrets.length > 0) {
    deps.ui.table(secrets.map(([key, known]) => [key, `version ${known.version}${known.removed ? " (removed)" : ""}`]))
  }
}
