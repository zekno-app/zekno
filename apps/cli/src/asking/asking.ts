/**
 * What a single command offers at a terminal when it was not given a server
 * or an app (specs/006-cli-small-features, contracts/questions.md, "The lists
 * each command offers"; data-model.md, "Server row and app row"). Each list
 * is made of what zekno already knows: the servers of the verified profile,
 * the apps the chosen server's runner holds, this machine's verified history,
 * the folder's own name. Nothing here writes a file, and nothing here is
 * reached unless the interface `asks` (research R1).
 *
 * Reading the apps from a server is a read only, in SSH's batch mode, which
 * never asks for anything on the terminal, and limited in time; when it fails
 * for any reason the list comes from this machine's history. A runner that
 * lies can offer only names that fit the app-name pattern (`RunnerStatusSchema`),
 * and they are cleaned before they are drawn; the person still chooses.
 */
import { realpathSync } from "node:fs"
import { basename } from "node:path"

import { appTaken } from "../shared/app-names"
import { appsOf, latestFirst, type RunState } from "../shared/views"
import { reach, type Deps, type Team } from "../cli/context"
import {
  CliError,
  MISSING_APP,
  MISSING_SERVER,
  UsageError,
  WrongInput,
} from "../cli/errors"
import { readOver, stateOf } from "../ops/status"
import { findServer, NAME, type Profile, type Server } from "../profile/profile"
import { batchOnly, READ_LIMIT_MS } from "../server/batch"
import { sanitize } from "../server/sanitize"
import { withSession } from "../server/session"
import { DP1, DP2 } from "../settings/words"
import type { ListRow } from "../ui/types"

/** A1: the one server, used without asking (mock-up 1). */
export const onlyServer = (server: string): string =>
  `Using ${server}, your only server.`

/** A3: a command other than `deploy`, `init`, `doctor` and `version`, at a terminal, with no team. Needs approval (research Q4). */
export const NO_TEAM_AT_TERMINAL =
  "No team on this machine yet. Run `zekno deploy` in a project folder, or `zekno init --name <you>`."

/** A4: a command that needs a server, other than `deploy`, at a terminal, with no server connected. Needs approval (research Q4). */
export const NO_SERVER_YET =
  "No server is connected yet. Run `zekno deploy` in a project folder, or `zekno server add`."

/** A5: a command that needs an app, other than `deploy`, when the server has none to choose from. Needs approval (research Q4). */
export const noApps = (server: string): string =>
  `${server} has no apps yet, so there is nothing to choose from. Name one with \`--app <name>\`.`

/** A11: why a typed app name is refused. It is the rule `--app` is held to (`NAME`). Needs approval (research Q4). */
export const APP_NAME_RULE =
  "Use lowercase letters, digits and hyphens, starting with a letter or a digit."

/** The row deploy adds to the list of apps, last (mock-up 2). */
export const NEW_APP = "+ a new app"

/** How a detail was found: a flag, the linked folder, the one server, a question, or made in this run (the first deploy). */
export type How = "given" | "linked" | "only" | "asked" | "made"

/**
 * The folder's own name, offered as an app name: the last part of its real
 * path, in lowercase, only when it then fits the app-name rule.
 */
export function folderName(cwd: string): string | undefined {
  let real: string
  try {
    real = realpathSync(cwd)
  } catch {
    return undefined
  }
  const name = basename(real).toLowerCase()
  return NAME.test(name) ? name : undefined
}

/** One row per server of the verified profile, in its order: the name, and where it is. */
export function serverRows(
  profile: Pick<Profile, "servers">
): ListRow<Server>[] {
  return profile.servers.map((server) => ({
    value: server,
    label: sanitize(server.name),
    detail:
      server.target.kind === "ssh"
        ? sanitize(server.target.destination)
        : "this machine",
  }))
}

/** What a server's runner said of each app it holds with a deploy, or undefined when it could not be read. */
async function readApps(
  deps: Deps,
  team: Team,
  server: Server,
  limitMs: number
): Promise<{ name: string; deploy: number; state: RunState }[] | undefined> {
  // What SSH writes is kept here and never shown: batch mode never asks, so there is nothing for the person to answer.
  const lines: string[] = []
  try {
    const read = await withSession(
      reach(
        { ...deps, connect: batchOnly(deps.connect, lines) },
        server.target
      ),
      (session) => readOver(session, { team, server }),
      {
        signal: AbortSignal.timeout(limitMs),
      }
    )
    return Object.entries(read.status.lastSequence)
      .filter(([, deploy]) => deploy >= 1)
      .map(([name, deploy]) => ({
        name,
        deploy,
        state: stateOf(read.states, name),
      }))
  } catch {
    // Unreachable, SSH would have asked, a runner too old for `state`, the limit, an answer that does not fit: the history instead.
    return undefined
  }
}

/**
 * The apps on `server` to choose from: read from its runner, under the step
 * `Asking <server>`, as `deploy <n>, <state>` (`deploy <n>` when the state is
 * unknown); when it cannot be read, or `offline` says no server is to be
 * contacted, this machine's verified history for that server, as `deploy
 * <n>`. This machine's latest deploy first, then by name.
 */
export async function appRows(
  deps: Deps,
  team: Team,
  server: Server,
  options: { limitMs?: number; offline?: boolean } = {}
): Promise<ListRow<string>[]> {
  const known = appsOf(team, server, deps.home)
  const at = new Map(known.map((row) => [row.name, row.at]))
  // A command that contacts no server (`zekno add`, specs/012-templates SC-005) offers this machine's history only.
  const read = options.offline
    ? undefined
    : await deps.ui.step(`Asking ${server.name}`, () =>
        readApps(deps, team, server, options.limitMs ?? READ_LIMIT_MS)
      )
  const apps =
    read ??
    known.map((row) => ({
      name: row.name,
      deploy: row.deploy,
      state: "unknown" as RunState,
    }))
  return apps
    .map((app) => ({ ...app, at: at.get(app.name) }))
    .sort(latestFirst)
    .map((app) => ({
      value: app.name,
      label: sanitize(app.name),
      detail:
        app.state === "unknown"
          ? `deploy ${app.deploy}`
          : `deploy ${app.deploy}, ${app.state}`,
    }))
}

/**
 * The server a command acts on. A flag, or the linked folder's name
 * (`serverFrom` says where it was read), is used as typed. Otherwise the one
 * server is used and said (A1), several are asked about, and none is A4.
 */
export async function whichServer(
  deps: Deps,
  team: Team,
  given: { server?: string; serverFrom?: string }
): Promise<{ server: Server; how: How }> {
  if (given.server !== undefined) {
    return {
      server: findServer(team.profile, given.server, given.serverFrom),
      how: given.serverFrom === undefined ? "given" : "linked",
    }
  }
  const servers = team.profile.servers
  if (servers.length === 0) throw new CliError(NO_SERVER_YET)
  if (servers.length === 1) {
    deps.ui.note(onlyServer(servers[0]!.name))
    return { server: servers[0]!, how: "only" }
  }
  const server = await deps.ui.choose({
    question: "Which server?",
    rows: serverRows(team.profile),
    collapsed: "Server",
    missing: new UsageError(MISSING_SERVER),
  })
  return { server, how: "asked" }
}

/**
 * DP1 (specs/010-app-settings, contracts/deploy.md, "The question for both
 * files"; board `SettingsDeploy`): which of the two files a deploy uses,
 * when the folder has both and nothing says which. The settings first, as the
 * board draws them. Esc and Ctrl-C leave (`Left`); the plain interface never
 * gets here, and would stop with DP2.
 */
export async function whichFile(
  deps: Deps
): Promise<"zekno.app.json" | "compose.yaml"> {
  const [settings, compose] = DP1.rows
  return deps.ui.choose<"zekno.app.json" | "compose.yaml">({
    question: DP1.question,
    rows: [
      { value: "zekno.app.json", ...settings },
      { value: "compose.yaml", ...compose },
    ],
    collapsed: DP1.collapsed,
    missing: new WrongInput(DP2),
  })
}

/**
 * The app a command acts on. A flag, or the linked folder's (`linked`), is
 * used as typed. Otherwise the person chooses one of `server`'s apps
 * (`appRows`). With `offerNew` (deploy only) the list ends with `+ a new
 * app`, which asks for a name with the folder's filled in, and a server with
 * no apps asks for one straight away; without it, a server with no apps is
 * A5. `fresh` says the name is new: typed, not chosen.
 */
export async function whichApp(
  deps: Deps,
  team: Team,
  server: Server,
  given: { app?: string; linked?: boolean },
  options: {
    offerNew: boolean
    folder: string
    limitMs?: number
    offline?: boolean
  }
): Promise<{ app: string; how: How; fresh: boolean }> {
  if (given.app !== undefined)
    return {
      app: given.app,
      how: given.linked ? "linked" : "given",
      fresh: false,
    }
  const rows = await appRows(deps, team, server, options)
  const fill = folderName(options.folder)
  const named = (question: string, taken: readonly string[]) =>
    deps.ui.ask({
      question,
      ...(fill === undefined ? {} : { fill }),
      check: (answer) =>
        !NAME.test(answer)
          ? APP_NAME_RULE
          : taken.includes(answer)
            ? appTaken(server.name, answer)
            : undefined,
      missing: new UsageError(MISSING_APP),
    })
  if (rows.length === 0) {
    if (!options.offerNew) throw new CliError(noApps(server.name))
    return {
      app: await named("Name for this app", []),
      how: "asked",
      fresh: true,
    }
  }
  const offered: ListRow<string | null>[] = options.offerNew
    ? [...rows, { value: null, label: NEW_APP, asksNext: true }]
    : rows
  const chosen = await deps.ui.choose({
    question: `Which app on ${server.name}?`,
    rows: offered,
    collapsed: "App",
    missing: new UsageError(MISSING_APP),
  })
  if (chosen !== null) return { app: chosen, how: "asked", fresh: false }
  return {
    app: await named(
      "Name for the new app",
      rows.map((row) => row.value)
    ),
    how: "asked",
    fresh: true,
  }
}
