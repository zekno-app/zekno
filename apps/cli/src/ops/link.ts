/**
 * `zekno link`: writes zekno.json in the current folder, signed with this
 * member's key, so commands run there need no `--app`, `--server` or `-f`
 * (data-model.md), and records it as used in this folder on this machine
 * (accepted.ts). Only names and the signature go in it, each name checked
 * first: the server against the verified profile, the app against the
 * app-name pattern, the Compose file inside the folder.
 *
 * It is also how a zekno.json that a teammate signed, such as one in a
 * cloned repository, is used here for the first time without a terminal to
 * ask on: with no names given, the one that applies to the folder is checked
 * the same way and recorded as it is, never rewritten. Only a file signed by
 * the team is: any other is refused, and can only be replaced, with names
 * and `--force`.
 */
import { CoreError, createLink } from "@workspace/core"

import { accept, sha256Of } from "../accepted"
import { openTeam, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer } from "../profile"
import {
  composeFor,
  DEFAULT_COMPOSE,
  findProject,
  notSigned,
  notUsedHere,
  projectFileIn,
  projectText,
  shownPath,
  signerOf,
  standingOf,
  writeProject,
  type ProjectLink,
} from "../project"
import { checkApp } from "./deploy"

export type LinkInput = { app?: string; server?: string; file?: string; force?: boolean }

/**
 * What was written or recorded, and where. `written` is false when an
 * existing zekno.json was recorded as it is; `here` when that file is in the
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
 * Records a zekno.json as it is, once it is signed by the team and holds what
 * a written one would: a server of the verified team, an app name, and a
 * Compose file that is a file inside its folder. What is recorded is the
 * SHA-256 of the bytes that were read and checked.
 */
function useAsItIs(deps: OpDeps, team: Team, found: ProjectLink): Linked {
  if (!signerOf(found, team.trust)) throw new UsageError(notSigned(found))
  const server = findServer(team.profile, found.server, shownPath(found.path))
  const app = checkApp(found.app)
  composeFor(found.folder, found.compose)
  accept(deps.home, found)
  return { path: found.path, app, server: server.name, compose: found.compose, written: false, here: found.path === projectFileIn(deps.cwd) }
}

/**
 * Checks what zekno.json would hold, signs it and writes it, never over an
 * existing one without `force`, then records it as used here. An app or
 * server not given is taken from a zekno.json that already applies here (in
 * this folder, or one above), only when it is signed by the team and in use
 * here, so one name can be changed with `--force`; the Compose file is `-f`,
 * or compose.yaml. With no names given at all, that zekno.json is recorded as
 * it is; so is the one in this folder when it is signed by the team and the
 * names given are exactly its own.
 */
export async function linkFolder(deps: OpDeps, input: LinkInput): Promise<Linked> {
  const team = await openTeam(deps)
  const named = input.app !== undefined || input.server !== undefined || input.file !== undefined
  // Given both names, a zekno.json here that cannot be read does not stop `--force` replacing it.
  const found = input.app === undefined || input.server === undefined ? findProject(deps.cwd) : quietly(deps.cwd)
  if (found && !named) return useAsItIs(deps, team, found)
  // A name it would fill in comes only from a file signed by the team and in use here: any other would be written anew and recorded, unread.
  if (found && (input.app === undefined || input.server === undefined)) {
    const standing = standingOf(found, team.trust, deps.home)
    if (standing.kind === "unsigned") throw new UsageError(notSigned(found))
    if (standing.kind === "new") throw new UsageError(notUsedHere(standing.member, found))
  }

  const fromFile = input.server === undefined && found ? shownPath(found.path) : undefined
  const server = findServer(team.profile, input.server ?? found?.server, fromFile)
  const app = checkApp(input.app ?? found?.app)
  const compose = composeFor(deps.cwd, input.file ?? DEFAULT_COMPOSE)
  const link = { app, server: server.name, compose }
  if (
    found &&
    found.path === projectFileIn(deps.cwd) &&
    found.app === app &&
    found.server === link.server &&
    found.compose === compose &&
    signerOf(found, team.trust)
  ) {
    return useAsItIs(deps, team, found)
  }
  const path = await writeLink(deps.home, team, deps.cwd, link, input.force === true)
  return { path, ...link, written: true, here: true }
}

/**
 * Signs zekno.json for `folder` with this member's key, writes it (never
 * over an existing one without `force`) and records it as used here: the
 * bytes written, by the real path a later search finds them at. The server
 * must be one of the verified profile's. Returns where it was written.
 */
export async function writeLink(
  home: string,
  team: Team,
  folder: string,
  link: { app: string; server: string; compose: string },
  force = false
): Promise<string> {
  const server = findServer(team.profile, link.server)
  const signed = await team
    .withSigner((signer) => createLink({ trust: team.trust, serverId: server.serverId, app: link.app, compose: link.compose, signer }))
    .catch((error: unknown) => {
      if (error instanceof CoreError) throw new CliError(`zekno.json could not be signed (${error.code}).`)
      throw error
    })
  const signedLink = { ...link, signed }
  const path = writeProject(folder, signedLink, force)
  accept(home, { path: projectFileIn(folder), sha256: sha256Of(projectText(signedLink)) })
  return path
}
