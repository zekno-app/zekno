/**
 * `zekno link`: writes zekno.json in the current folder, signed with this
 * member's key, so commands run there need no `--app`, `--server` or `-f`
 * (data-model.md), and records it as used in this folder on this machine
 * (accepted.ts). Only names and the signature go in it, each name checked
 * first: the server against the verified profile, the app against the
 * app-name pattern, the Compose file inside the folder.
 *
 * It is also how a zekno.json that a teammate signed, such as one in a
 * cloned repository, is used here for the first time: with no names given,
 * the one that applies to the folder is checked the same way and recorded as
 * it is, never rewritten. Recording it is the same decision as the question
 * every command asks the first time it meets such a file, so it is asked
 * here too; with no terminal to ask on, only `--yes` records it. Only a file
 * signed by the team is ever recorded: any other is refused, and can only be
 * replaced, with names and `--force`.
 */
import { CoreError, createLink } from "@workspace/core"
import { lstatSync, readFileSync, rmSync } from "node:fs"

import { accept, acceptedLinks, forget, isAccepted, sha256Of, type AcceptedLink } from "../accepted"
import { teamOf, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer } from "../profile"
import {
  composeFor,
  DEFAULT_COMPOSE,
  findProject,
  noTerminalToUse,
  notSigned,
  notUsedHere,
  projectFileIn,
  projectText,
  shownPath,
  signerOf,
  standingOf,
  useOnce,
  useQuestion,
  writeProject,
  type ProjectJudge,
  type ProjectLink,
} from "../project"
import { sanitize } from "../sanitize"
import { checkApp } from "./deploy"

/** `yes`: the question about a teammate's zekno.json is answered yes beforehand, for a script. */
export type LinkInput = { app?: string; server?: string; file?: string; force?: boolean; yes?: boolean }

/**
 * What was done, and where: zekno.json `written` here, signed; an existing
 * one `accepted`, recorded as used here as it is; or one already `in use`
 * here, with nothing changed. `here` when that file is in the current folder
 * rather than one above it.
 */
export type Linked = { path: string; app: string; server: string; compose: string; done: "written" | "accepted" | "in use"; here: boolean }

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
 * Compose file that is a file inside its folder. One already in use here is
 * left as it is. One that is not is asked about first, with the question
 * every command asks (`confirm`, the interface's), unless `yes`: only yes
 * records it, and where there is no terminal to ask on it stops with status
 * 2 and names `--yes`. What is recorded is the SHA-256 of the bytes that
 * were read and checked.
 */
async function useAsItIs(deps: OpDeps, team: Team, found: ProjectLink, input: LinkInput, confirm: ProjectJudge["confirm"]): Promise<Linked> {
  const signer = signerOf(found, team.trust)
  if (!signer) throw new UsageError(notSigned(found))
  const server = findServer(team.profile, found.server, shownPath(found.path))
  const app = checkApp(found.app)
  composeFor(found.folder, found.compose)
  const linked = { path: found.path, app, server: server.name, compose: found.compose, here: found.path === projectFileIn(deps.cwd) }
  if (isAccepted(deps.home, found)) return { ...linked, done: "in use" }
  if (input.yes) {
    accept(deps.home, found)
  } else {
    const member = sanitize(signer.name)
    await useOnce(found, { question: useQuestion(member, found, deps.cwd), refusal: noTerminalToUse(member, found) }, { profile: deps.home, confirm })
  }
  return { ...linked, done: "accepted" }
}

/**
 * Checks what zekno.json would hold, signs it and writes it, never over an
 * existing one without `force`, then records it as used here. An app or
 * server not given is taken from a zekno.json that already applies here (in
 * this folder, or one above), only when it is signed by the team and in use
 * here, so one name can be changed with `--force`; the Compose file is `-f`,
 * or compose.yaml. With no names given at all, that zekno.json is recorded as
 * it is, once asked (`useAsItIs`); so is the one in this folder when it is
 * signed by the team and the names given are exactly its own.
 */
export async function linkFolder(deps: OpDeps, input: LinkInput, confirm: ProjectJudge["confirm"]): Promise<Linked> {
  const team = await teamOf(deps)
  const named = input.app !== undefined || input.server !== undefined || input.file !== undefined
  // Given both names, a zekno.json here that cannot be read does not stop `--force` replacing it.
  const found = input.app === undefined || input.server === undefined ? findProject(deps.cwd) : quietly(deps.cwd)
  if (found && !named) return useAsItIs(deps, team, found, input, confirm)
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
    return useAsItIs(deps, team, found, input, confirm)
  }
  const path = await writeLink(deps.home, team, deps.cwd, link, input.force === true)
  return { path, ...link, done: "written", here: true }
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

/**
 * A zekno.json written by one run, as the first deploy keeps track of it
 * (asking/first-deploy.ts): where it is, its record of first use (the SHA-256
 * of the bytes written), and the record for the same path that this record
 * replaced, if there was one.
 */
export type WrittenLink = { path: string; record: AcceptedLink; replaced?: AcceptedLink }

/**
 * What `linkFolder` just wrote, from its result and the records of first use
 * read before it ran (`before`); undefined when it wrote nothing, as when it
 * recorded a file that was there already.
 */
export function writtenLink(home: string, cwd: string, linked: Linked, before: readonly AcceptedLink[]): WrittenLink | undefined {
  if (linked.done !== "written") return undefined
  const recordPath = projectFileIn(cwd)
  const record = acceptedLinks(home).find((entry) => entry.path === recordPath)
  if (!record) return undefined
  const replaced = before.find((entry) => entry.path === recordPath)
  return { path: linked.path, record, ...(replaced === undefined ? {} : { replaced }) }
}

/**
 * Takes back a zekno.json written earlier in the same run, when what it names
 * turns out not to be what the person meant: the first deploy, when the
 * deploy stops because the runner holds the app typed as new (security
 * review S3, `AppTaken`). The file is removed only while its bytes are still
 * exactly those written; then its record of first use is taken back and the
 * record it replaced put back. Returns whether no zekno.json of this run is
 * left (also when the file is gone already). A file that changed since is
 * left as it is, with its record, and false is returned.
 */
export function unlinkWritten(home: string, written: WrittenLink): boolean {
  let bytes: Buffer
  try {
    if (!lstatSync(written.path).isFile()) return false
    bytes = readFileSync(written.path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false
    bytes = Buffer.alloc(0)
  }
  if (bytes.length > 0) {
    if (sha256Of(bytes) !== written.record.sha256) return false
    try {
      rmSync(written.path)
    } catch {
      return false
    }
  }
  try {
    forget(home, written.record)
    if (written.replaced) accept(home, written.replaced)
  } catch {
    // The record stays. It counts only for these exact bytes, which no file holds any more.
  }
  return true
}
