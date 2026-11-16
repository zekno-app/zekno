/**
 * The project file, `zekno.json` (data-model.md): which app a folder
 * deploys, to which server, from which Compose file. It saves typing `--app`
 * and `--server`; flags always win over it.
 *
 * It travels with a repository, and whoever wrote it chose the app and the
 * server, so it is not trusted as it stands. It may have come with a cloned
 * repository, or been put in a parent folder by someone else, so:
 *
 * - its schema is strict, an unknown field is an error, and at most
 *   `PROJECT_BYTES` of it are read;
 * - it is looked for from the current folder up to the home folder, never in
 *   a folder above home (above home other people's files live), and it is
 *   used only as a regular file of its own that belongs to this user: never
 *   through a symbolic link, never a pipe or a device;
 * - the Compose file it names must stay inside its folder, also once
 *   symbolic links are followed;
 * - the server it names is looked up in the verified profile, and the app
 *   name is held to the app-name pattern, before anything is sent;
 * - it is used only when it is signed by the team (`signerOf`): its `signed`
 *   field is a link a current member signed (packages/core, link.ts), checked
 *   against the verified team list, and it says exactly what the three plain
 *   fields say. A file from someone outside the team cannot carry one, so it
 *   is refused outright and not even offered;
 * - a signature proves who wrote a file, not where it sits: anyone who can
 *   read a repository can copy its zekno.json beside another Compose file.
 *   So a file signed by the team is used without a question only once it
 *   was used in its folder on this machine, byte for byte (accepted.ts,
 *   `links.json`). The first time, the person is shown what it names and
 *   asked once, `zekno link` included; where nobody can answer, the command
 *   stops, and `zekno link` records it only with `--yes`;
 * - the Compose file it names is used only with the app it names (a command
 *   given another `--app` deploys its own folder's compose.yaml);
 * - it is written only when asked, never over an existing one without
 *   `--force`, never through a link, and holds three names and the team's
 *   signature of them: no secret and no key.
 *
 * The pieces, one subject each: file.ts finds and reads the file; signed.ts
 * says whether the team signed it and how it stands here; write.ts writes
 * it; shown.ts writes a path as a person reads it. This file asks about a
 * file signed by the team the first time it is met here (`useOnce`) and
 * gives a command what the file names (`withProject`).
 */
import type { TeamTrust } from "@workspace/core"
import { join } from "node:path"

import { accept, isAccepted } from "./accepted"
import { CliError, NOTHING_DONE, UsageError } from "../cli/errors"
import { findProject, isHere, type ProjectLink } from "./file"
import { sanitize } from "../server/sanitize"
import { notSigned, notSignedHere, standingOf } from "./signed"
import { shownPath } from "./shown"

/** The details a command can take from the project file. `file` is the Compose file, as `-f` gives it. */
export type Details = { app?: string; server?: string; file?: string }

/**
 * What `withProject` adds. `serverFrom` is the project file's path, as a
 * sentence shows it, when the server came from it: for the sentence when no
 * such server is connected. `project` is the project file in use whose
 * Compose file is deployed, when `-f` was not given and the app is its app.
 */
export type FromProject = { serverFrom?: string; project?: ProjectLink }

/** Where a project file and the list of files used here are looked for: the profile folder, and the home folder the search stops at. */
export type ProjectPlaces = { profile: string; home?: string }

/** Said where nobody can answer the question for a file signed by the team and not yet used here (S2). */
export const notUsedHere = (member: string, link: ProjectLink): string =>
  `${member} linked ${shownPath(link.folder)} to ${link.app} on ${link.server}, and it has not been used in this folder on this machine. ` +
  "To use it, run `zekno link` there once and answer its question, or `zekno link --yes` from a script. To leave it aside, give --app and --server."

/** Said by `zekno link` without `--yes` where there is no terminal to ask on. */
export const noTerminalToUse = (member: string, link: ProjectLink): string =>
  `There is no terminal to ask on. ${member} linked ${shownPath(link.folder)} to ${link.app} on ${link.server}. Add \`--yes\` to use it here.`

/**
 * A project file in a folder above the one a command runs in: that folder,
 * and the Compose file it names, as a sentence shows them. A "yes" deploys
 * that Compose file, not the one beside the person, so the question says
 * which. Undefined for a file in the folder the command runs in.
 */
export function aboveOf(
  link: ProjectLink,
  cwd: string
): { folder: string; compose: string } | undefined {
  if (isHere(link, cwd)) return undefined
  return {
    folder: shownPath(link.folder),
    compose: shownPath(join(link.folder, link.compose)),
  }
}

/**
 * The question at a terminal the first time a file signed by the team is
 * met here: who linked which folder to what (the folder and its Compose file
 * named when the file is in a folder above, `aboveOf`), and, when a flag
 * sends the command to another app or server than the file names (`uses`),
 * where it goes instead.
 */
export function useQuestion(
  member: string,
  link: ProjectLink,
  cwd: string,
  uses?: { app: string; server: string }
): string {
  const above = aboveOf(link, cwd)
  const linked = above
    ? `${member} linked ${above.folder} to ${link.app} on ${link.server}, with ${above.compose}.`
    : `${member} linked this folder to ${link.app} on ${link.server}.`
  const elsewhere =
    uses && (uses.app !== link.app || uses.server !== link.server)
      ? ` This command uses ${uses.app} on ${uses.server}.`
      : ""
  return `${linked}${elsewhere} Use it here?`
}

/** Said when the question is answered no. It lives in errors.ts, with `Left`, and is kept here for whoever imports it from here. */
export { NOTHING_DONE } from "../cli/errors"

/**
 * What judging a project file needs, beyond the files: the verified team
 * list, and a way to ask. `trust` reads the keychain, so it is called only
 * once there is a file to judge; nothing is signed with it. `confirm` asks a
 * yes-or-no question at a terminal and throws a `CliError` with `refusal`
 * where there is none (`Ui.confirm`).
 */
export type ProjectJudge = {
  trust(): Promise<TeamTrust>
  confirm(question: string, refusal: string): Promise<boolean>
}

/**
 * What a single command at a terminal adds (specs/006-cli-small-features,
 * research R6): a file not signed by the team is then named with
 * `leaveAside(sentence)` and left aside, as if it were not there, and the
 * command asks for what is missing. Without it such a file stops the command
 * (S1), as it always has where nobody can answer.
 */
export type ProjectAside = { leaveAside?: (sentence: string) => void }

/**
 * The first time a file signed by the team is met in its folder on this
 * machine: what it names is shown and the person is asked once (`question`).
 * Yes records it in `links.json`; anything else does nothing and stops the
 * command. Where nobody can answer, the command stops with `refusal`, as for
 * wrong usage, with exit status 2. `zekno link` asks this too: recording the
 * file is the same decision.
 */
export async function useOnce(
  link: ProjectLink,
  asking: { question: string; refusal: string },
  places: Pick<ProjectPlaces, "profile"> & Pick<ProjectJudge, "confirm">
): Promise<void> {
  let yes: boolean
  try {
    yes = await places.confirm(asking.question, asking.refusal)
  } catch (error) {
    if (error instanceof CliError) throw new UsageError(error.message)
    throw error
  }
  if (!yes) throw new CliError(NOTHING_DONE)
  accept(places.profile, link)
}

/**
 * What a command was given, with each detail it was not given taken from the
 * project file: flags win, one detail at a time. The file is looked for only
 * when a wanted detail is missing, so a command given every flag never reads
 * it.
 *
 * A name is taken only from a file signed by the team (`standingOf`): one
 * that is not would choose an app and a server unasked, and hand them a
 * Compose file from a folder nobody in the team made, with the app's
 * secrets. Such a file stops the command (S1). A file signed by the team that
 * was not used here before is asked about once at a terminal, and stops the
 * command where nobody can answer (S2). The question says where the command
 * goes when a flag sends it to another app or server than the file names: a
 * "yes" to the file's names must not send its folder somewhere unsaid.
 * Judging reads the verified team list from the keychain; every refusal
 * comes before any signer is made and before anything is signed or sent.
 *
 * Given both `--app` and `--server`, the file is left aside unless it is in
 * use here, and is never asked about; one that cannot be read then counts as
 * no project file. Its Compose file goes with its app: with another app
 * named by `--app`, the Compose file is `-f`, or compose.yaml in the current
 * folder, as without a project file.
 */
export async function withProject<T extends Details>(
  cwd: string,
  given: T,
  wanted: readonly (keyof Details)[],
  places: ProjectPlaces & ProjectJudge & ProjectAside
): Promise<T & FromProject> {
  const missing = wanted.filter((detail) => given[detail] === undefined)
  if (missing.length === 0) return given
  const named = !missing.includes("app") && !missing.includes("server")
  let link: ProjectLink | undefined
  try {
    link = findProject(cwd, places.home)
  } catch (error) {
    // Given both names, only its Compose file could come from it: one that cannot be read gives none.
    if (named && error instanceof CliError) return given
    throw error
  }
  if (!link) return given
  if (named) {
    // Only its Compose file could come from it, for its own app, and only from a file in use here.
    if (
      !missing.includes("file") ||
      given.app !== link.app ||
      !isAccepted(places.profile, link)
    )
      return given
    return standingOf(link, await places.trust(), places.profile).kind ===
      "used"
      ? { ...given, project: link }
      : given
  }
  const standing = standingOf(link, await places.trust(), places.profile)
  if (standing.kind === "unsigned") {
    // At a terminal the person names what is missing instead, as `--app` and `--server` would; nothing of the file is used.
    if (places.leaveAside) {
      places.leaveAside(notSignedHere(link, cwd))
      return given
    }
    throw new UsageError(notSigned(link))
  }
  if (standing.kind === "new") {
    // Where the command goes: a typed name wins, and is cleaned for the sentence. One the command does not take changes nothing.
    const uses = {
      app: wanted.includes("app") ? sanitize(given.app ?? link.app) : link.app,
      server: sanitize(given.server ?? link.server),
    }
    const question = useQuestion(standing.member, link, cwd, uses)
    await useOnce(
      link,
      { question, refusal: notUsedHere(standing.member, link) },
      places
    )
  }
  const filled: T & FromProject = { ...given }
  if (missing.includes("app")) filled.app = link.app
  if (missing.includes("server")) {
    filled.server = link.server
    filled.serverFrom = shownPath(link.path)
  }
  if (missing.includes("file") && filled.app === link.app) filled.project = link
  return filled
}
