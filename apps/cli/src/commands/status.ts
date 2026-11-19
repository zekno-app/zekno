import { appsOf, latestFirst, type RunState } from "../shared/views"
import { remoteThroughUi, type Deps } from "../cli/context"
import { runnerRelation, runnerWarning } from "../ops/server"
import { locateServer, readStatus, stateOf } from "../ops/status"
import { RUNNER_RELEASE } from "../version/runner-release"
import { domainPlain, E2 } from "../domains/words"
import {
  cellText,
  plainCell,
  quiet,
  strong,
  type MarkedCell,
  type StyledCell,
} from "../ui/types"

const TONES: Record<RunState, MarkedCell["tone"]> = {
  running: "success",
  stopped: "danger",
  "partly running": "warning",
  unknown: "quiet",
}

/**
 * Whether an app is running, as `status` shows it (board "Status, lists,
 * errors and piped output"): `● running` at a terminal, in its colour, and
 * the word alone in plain output.
 */
export const stateCell = (state: RunState): MarkedCell => ({
  text: state,
  mark: "●",
  tone: TONES[state],
})

/**
 * The apps of a server that holds domains (specs/015-domains-https,
 * contracts/cli.md, CL6; board `DomainsList`, "Changed · zekno status"):
 * each app's line, then a line a domain the server holds for it, E2 at a
 * terminal, `domain<TAB>app<TAB>domain` with no terminal. Each app's line is
 * a table of its own, so each domain's line comes right after it; at a
 * terminal the columns are padded to the widest of every app, so the lines
 * stay lined up as one table's. Plain output prints each line as one table
 * would.
 */
function appsWithDomains(
  deps: Deps,
  apps: readonly string[],
  rows: readonly [string, StyledCell, MarkedCell][],
  routes: Readonly<Record<string, readonly { domain: string }[]>>
): void {
  const widest = (column: 0 | 1) =>
    Math.max(...rows.map((row) => cellText(row[column]).length))
  const names = widest(0)
  const deploys = widest(1)
  rows.forEach((row, index) => {
    const app = apps[index]!
    deps.ui.table([
      [
        { text: row[0], style: "plain", terminal: row[0].padEnd(names) },
        { ...row[1], terminal: row[1].text.padEnd(deploys) },
        row[2],
      ],
    ])
    for (const { domain } of Object.hasOwn(routes, app) ? routes[app]! : [])
      deps.ui.line(domainPlain(app, domain), [
        plainCell(E2(app.padEnd(names), domain)),
      ])
  })
}

export async function status(
  deps: Deps,
  options: { server?: string; serverFrom?: string; json?: boolean }
): Promise<void> {
  const located = await locateServer(deps, options.server, options.serverFrom)
  const { server } = located
  // With the routes in force from a runner of protocol 4 (specs/015-domains-https, contracts/cli.md, CL6).
  const {
    status: answer,
    behind,
    mode,
    runner,
    states,
    held,
  } = await deps.ui.step(
    `Asking ${server.name}`,
    () => readStatus(remoteThroughUi(deps), located, { routes: true }),
    {
      quiet: server.target.kind === "ssh",
    }
  )
  const routes = held === undefined ? {} : held.routes
  // A runner older or newer than this zekno's is said once, on standard error, and changes nothing else.
  const carried = (deps.release ?? RUNNER_RELEASE).version
  const warning =
    server.target.kind === "ssh"
      ? runnerWarning(
          server.name,
          runner?.version,
          runnerRelation(mode, runner, carried),
          carried
        )
      : undefined
  if (warning) deps.ui.warn(warning)
  // In Home's order: the latest deploy from this machine's verified history first; an app it has none of last, by name.
  const at = new Map(
    appsOf(located.team, server, deps.home).map((row) => [row.name, row.at])
  )
  const apps = Object.keys(answer.lastSequence).sort((a, b) =>
    latestFirst({ name: a, at: at.get(a) }, { name: b, at: at.get(b) })
  )
  if (options.json) {
    // For each app the runner holds: its state and its services, as the runner reported them. Names and states only.
    const running = Object.fromEntries(
      apps.map((app) => [
        app,
        {
          state: stateOf(states, app),
          services:
            states && Object.hasOwn(states, app) ? states[app]!.services : [],
        },
      ])
    )
    // The runner's routes, for a server that holds any: the object of a server with none is what it always was (CL7).
    return deps.ui.json({
      server: server.name,
      ...answer,
      apps: running,
      ...(Object.keys(routes).length === 0 ? {} : { routes }),
    })
  }

  const note = behind
    ? " (behind this machine; the next deploy brings it up to date)"
    : ""
  // At a terminal, as on the board: `prod ● reachable team list v2`. It answered, so it is reachable.
  deps.ui.line(
    `${server.name}: team list version ${answer.team.version}${note}`,
    [
      strong(server.name),
      { text: "reachable", mark: "●", tone: "success" },
      quiet(`team list v${answer.team.version}${note}`),
    ]
  )
  const rows = apps.map((app): [string, StyledCell, MarkedCell] => [
    app,
    plainCell(`deploy ${answer.lastSequence[app]}`),
    stateCell(stateOf(states, app)),
  ])
  if (apps.length === 0) deps.ui.info("No deploys yet.")
  else if (Object.keys(routes).length === 0) deps.ui.table(rows)
  else appsWithDomains(deps, apps, rows, routes)
  const secrets = Object.entries(answer.secrets)
  if (secrets.length > 0) {
    deps.ui.table(
      secrets.map(([key, known]) => [
        key,
        `version ${known.version}${known.removed ? " (removed)" : ""}`,
      ])
    )
  }
}
