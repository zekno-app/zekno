/**
 * `zekno link`: writes zekno.json in the current folder, so commands run
 * there need no `--app`, `--server` or `-f` (data-model.md). Only names go
 * in it, each checked first: the server against the verified profile, the
 * app against the app-name pattern, the Compose file inside the folder.
 */
import { openTeam, type OpDeps } from "../context"
import { findServer } from "../profile"
import { composeFor, DEFAULT_COMPOSE, withProject, writeProject } from "../project"
import { checkApp } from "./deploy"

export type LinkInput = { app?: string; server?: string; file?: string; force?: boolean }

/** What was written, and where. */
export type Linked = { path: string; app: string; server: string; compose: string }

/**
 * Checks what zekno.json would hold and writes it, never over an existing
 * one without `force`. An app or server not given is taken from a zekno.json
 * that already applies here (in this folder, or one above), so one name can
 * be changed with `--force`; the Compose file is `-f`, or compose.yaml.
 */
export async function linkFolder(deps: OpDeps, input: LinkInput): Promise<Linked> {
  const team = await openTeam(deps)
  const where = withProject(deps.cwd, { app: input.app, server: input.server }, ["app", "server"])
  const server = findServer(team.profile, where.server, where.serverFrom)
  const app = checkApp(where.app)
  const compose = composeFor(deps.cwd, input.file ?? DEFAULT_COMPOSE)
  const path = writeProject(deps.cwd, { app, server: server.name, compose }, input.force === true)
  return { path, app, server: server.name, compose }
}
