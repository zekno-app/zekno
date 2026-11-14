/**
 * `zekno link`: writes zekno.json in the current folder, so commands run
 * there need no `--app`, `--server` or `-f` (data-model.md), and records it as
 * accepted on this machine (accepted.ts). Only names go in it, each checked
 * first: the server against the verified profile, the app against the
 * app-name pattern, the Compose file inside the folder.
 *
 * It is also how a zekno.json that came from elsewhere, such as a cloned
 * repository, is accepted: with no names given, the one that applies to the
 * folder is checked the same way and recorded as it is, never rewritten.
 */
import { accept, sha256Of } from "../accepted"
import { openTeam, type OpDeps, type Team } from "../context"
import { findServer } from "../profile"
import { composeFor, DEFAULT_COMPOSE, findProject, projectFileIn, projectText, shownPath, writeProject, type ProjectLink } from "../project"
import { checkApp } from "./deploy"

export type LinkInput = { app?: string; server?: string; file?: string; force?: boolean }

/**
 * What was written or accepted, and where. `written` is false when an
 * existing zekno.json was accepted as it is; `here` when that file is in the
 * current folder rather than one above it.
 */
export type Linked = { path: string; app: string; server: string; compose: string; written: boolean; here: boolean }

/** The project file that applies here, or undefined, also when it cannot be read: only for comparing names. */
function quietly(cwd: string): ProjectLink | undefined {
  try {
    return findProject(cwd)
  } catch {
    return undefined
  }
}

/**
 * Accepts a zekno.json as it is, once it holds what a written one would: a
 * server of the verified team, an app name, and a Compose file that is a file
 * inside its folder. What is recorded is the SHA-256 of the bytes that were
 * read and checked.
 */
function acceptAsItIs(deps: OpDeps, team: Team, found: ProjectLink): Linked {
  const server = findServer(team.profile, found.server, shownPath(found.path))
  const app = checkApp(found.app)
  composeFor(found.folder, found.compose)
  accept(deps.home, found)
  return { path: found.path, app, server: server.name, compose: found.compose, written: false, here: found.path === projectFileIn(deps.cwd) }
}

/**
 * Checks what zekno.json would hold and writes it, never over an existing
 * one without `force`, then records it as accepted. An app or server not
 * given is taken from a zekno.json that already applies here (in this
 * folder, or one above), so one name can be changed with `--force`; the
 * Compose file is `-f`, or compose.yaml. With no names given at all, that
 * zekno.json is accepted as it is; so is the one in this folder when the
 * names given are exactly its own.
 */
export async function linkFolder(deps: OpDeps, input: LinkInput): Promise<Linked> {
  const team = await openTeam(deps)
  const named = input.app !== undefined || input.server !== undefined || input.file !== undefined
  // Given both names, a zekno.json here that cannot be read does not stop `--force` replacing it.
  const found = input.app === undefined || input.server === undefined ? findProject(deps.cwd) : quietly(deps.cwd)
  if (found && !named) return acceptAsItIs(deps, team, found)

  const fromFile = input.server === undefined && found ? shownPath(found.path) : undefined
  const server = findServer(team.profile, input.server ?? found?.server, fromFile)
  const app = checkApp(input.app ?? found?.app)
  const compose = composeFor(deps.cwd, input.file ?? DEFAULT_COMPOSE)
  const link = { app, server: server.name, compose }
  if (found && found.path === projectFileIn(deps.cwd) && found.app === app && found.server === link.server && found.compose === compose) {
    return acceptAsItIs(deps, team, found)
  }
  const path = writeLink(deps.home, deps.cwd, link, input.force === true)
  return { path, ...link, written: true, here: true }
}

/**
 * Writes zekno.json in `folder` (never over an existing one without
 * `force`) and records it as accepted on this machine: the bytes written, by
 * the real path a later search finds them at. Returns where it was written.
 */
export function writeLink(home: string, folder: string, link: { app: string; server: string; compose: string }, force = false): string {
  const path = writeProject(folder, link, force)
  accept(home, { path: projectFileIn(folder), sha256: sha256Of(projectText(link)) })
  return path
}
