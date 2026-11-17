/**
 * What the `zekno settings` commands do (specs/010-app-settings,
 * contracts/commands.md): data only, nothing drawn and nothing asked. Each
 * reads, once, with the reader's every check (settings/file.ts), the
 * settings file `zekno deploy` in this folder would sign (security review
 * S1): the one the zekno.json in use here names, in this folder or in one
 * above, else this folder's `zekno.app.json`. Which one is decided by the
 * deploy's own rule (`settingsPlace`, settings/source.ts), as the settings
 * screen decides it, so no command shows or changes a file the next deploy
 * does not use. None contacts a server, deploys, or signs anything (FR-025).
 *
 * A zekno.json is in use here when `links.json` holds it, byte for byte: it
 * was signed by the team and used in its folder on this machine
 * (project/accepted.ts). That is judged without the keychain, so `set`,
 * `unset`, `init` and `compose` never open it. One that carries a signature
 * and is not in use here yet, which a deploy asks about first, stops every
 * command but `init` with SH4 when it names another file than this folder's
 * `zekno.app.json` (security review S6). Any other is left aside as the
 * deploy leaves it. None is ever asked about or recorded: `links.json` is
 * left as it is. One that cannot be read stops the command with its
 * sentence, as it stops a deploy.
 *
 * `zekno settings` may open the team, once: only when the file shown is the
 * one a zekno.json in use here names and a profile exists, to verify that
 * the team signed it and then this machine's history of deploys, so that a
 * setting changed since the last deploy is marked (research R4).
 */
import { lstatSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import { teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, UsageError, WrongInput } from "../cli/errors"
import { findServer, profileStore } from "../profile/profile"
import { isAccepted } from "../project/accepted"
import {
  DEFAULT_COMPOSE,
  findProject,
  isHere,
  type ProjectLink,
} from "../project/file"
import { shownFile, shownPath } from "../project/shown"
import { standingOf } from "../project/signed"
import { applyChange, parseSettingPath } from "../settings/change"
import { composeText, deployedSettings } from "../settings/compose"
import { readSettingsFile, SETTINGS_FILE } from "../settings/file"
import { pipedLines } from "../settings/piped"
import { reportOf } from "../settings/rows"
import {
  namedPath,
  present,
  settingsFileIn,
  settingsPlace,
  type SettingsPlace,
} from "../settings/source"
import { settingsText } from "../settings/text"
import type {
  Change,
  Settings,
  SettingsRead,
  SettingsReport,
} from "../settings/types"
import { checkImage, checkServiceName } from "../settings/values"
import {
  CS1,
  CS13,
  CS2,
  CS5,
  CS6,
  IN1_RULE,
  IN2_RULE,
  IN4,
  IN6,
  IN7,
  SH1,
  SH2,
  SH3,
  SH4,
} from "../settings/words"
import { createSettings, writeSettings } from "../settings/write"
import { lastDeployedCompose } from "../shared/views"

/**
 * The zekno.json that applies here, in this folder or the nearest above:
 * `inUse` when `links.json` holds it byte for byte; `pending` when it does
 * not and the file carries a signature, so it may be the team's and not yet
 * used on this machine, which a deploy at a terminal asks about first and a
 * yes deploys from (security review S6). Neither with none, and with one
 * that carries no signature: it is left aside, as the deploy leaves it.
 * Nothing here reads the keychain, asks, or records anything.
 */
function linkOf(deps: Pick<OpDeps, "cwd" | "home">): {
  inUse?: ProjectLink
  pending?: ProjectLink
} {
  const found = findProject(deps.cwd)
  if (found === undefined) return {}
  if (isAccepted(deps.home, found)) return { inUse: found }
  return found.signed === undefined ? {} : { pending: found }
}

/** A path with the links of its folder followed, as a zekno.json's folder is held: two names of one file compare equal. */
function realFile(path: string): string {
  try {
    return join(realpathSync(dirname(path)), basename(path))
  } catch {
    return path
  }
}

/** The zekno.json in use here, or undefined: what the deploy would follow with no question. */
const linkInUse = (deps: Pick<OpDeps, "cwd" | "home">) => linkOf(deps).inUse

/** The settings a deploy in this folder would sign, read once: the file, and where it came from. */
type Placed = {
  place: Extract<SettingsPlace, { kind: "settings" }>
  read: SettingsRead
}

/** SH3's folder: where the zekno.json is, when it is in a folder above this one. */
export const aboveOf = (cwd: string, link?: ProjectLink): string | undefined =>
  link === undefined || isHere(link, cwd) ? undefined : shownPath(link.folder)

/** Where a deploy in this folder would take its file from: a settings file read, a Compose file written by hand, or neither. */
export type FoundPlace =
  | (Placed & { kind: "settings" })
  | { kind: "compose"; file: string; link?: ProjectLink; settingsHere: boolean }
  | { kind: "none" }

/**
 * The file a deploy in this folder would use, by the deploy's own rule
 * (`settingsPlace`): a settings file, read once and checked whole (every
 * problem the reader's sentence); a Compose file written by hand, named as
 * the deploy names it, with the zekno.json that names it and whether a
 * `zekno.app.json` lies here all the same (nothing of either file is read:
 * FR-018); or neither. SH4 when a zekno.json not in use here yet names
 * another settings file than this folder's (security review S6). Nothing
 * else is thrown: `zekno add` takes the Compose file as an answer
 * (specs/012-templates, research R8), and `readPlaced` makes SH1 to SH3 of
 * the other two.
 */
export function findPlace(deps: Pick<OpDeps, "cwd" | "home">): FoundPlace {
  const { inUse, pending } = linkOf(deps)
  const place = settingsPlace(deps.cwd, inUse)
  // A zekno.json not in use here yet that names another file than this folder's settings: a yes to the deploy's question
  // deploys that file, so this one is not shown or changed as if it were the one deployed (S6).
  if (pending !== undefined && place.kind === "settings") {
    const named = resolve(pending.folder, pending.compose)
    if (realFile(named) !== realFile(namedPath(place.source)))
      throw new CliError(
        SH4(shownFile(deps.cwd, named), aboveOf(deps.cwd, pending))
      )
  }
  if (place.kind === "none") return { kind: "none" }
  if (place.kind === "compose")
    return {
      kind: "compose",
      file: place.file,
      ...(place.link === undefined ? {} : { link: place.link }),
      settingsHere: place.settingsHere,
    }
  return {
    kind: "settings",
    place,
    read: readSettingsFile(place.source, deps.cwd),
  }
}

/**
 * The settings file a deploy in this folder would sign, read once and
 * checked whole; every problem is the reader's sentence. In its place: SH3
 * when the deploy would use a Compose file while a `zekno.app.json` lies
 * here (nothing of it is shown or changed: the next deploy does not use
 * it), SH2 when it would use a Compose file and none lies here, SH1 with
 * neither. Nothing is read from a Compose file (FR-018).
 */
function readPlaced(deps: Pick<OpDeps, "cwd" | "home">): Placed {
  const found = findPlace(deps)
  if (found.kind === "none") throw new CliError(SH1)
  if (found.kind === "compose")
    throw new CliError(
      found.settingsHere
        ? SH3(found.file, aboveOf(deps.cwd, found.link))
        : SH2(found.file)
    )
  return { place: found.place, read: found.read }
}

/**
 * The settings this machine last deployed of `link`'s app, read back from
 * the Compose text of its last deploy, or undefined when that cannot be
 * known: no deploy from this machine, one not made from settings, a server
 * not in the profile, a history that cannot be read (research R4).
 */
function lastDeployed(team: Team, link: ProjectLink): Settings | undefined {
  try {
    const server = findServer(team.profile, link.server)
    const text = lastDeployedCompose(team.store, team.trust, server, link.app)
    return text === undefined ? undefined : deployedSettings(text)
  } catch {
    return undefined
  }
}

/** IN6, when compose.yaml is here too and nothing decides: the deploy asks which, or takes `-f`. */
const bothNote = (place: Placed["place"]): { note?: string } =>
  place.both ? { note: IN6 } : {}

/**
 * `zekno settings` (FR-014 to FR-019): the settings of the file a deploy
 * here would sign, in sections. With the app and the marks of what changed
 * since this machine's last deploy only when that file is the one a
 * zekno.json in use here names and the team signed that zekno.json; IN6 as
 * the note with compose.yaml beside this folder's file and nothing that
 * decides. The file is read before the team is opened, so a fault in it is
 * said without the keychain.
 */
export async function showSettings(deps: OpDeps): Promise<SettingsReport> {
  const { place, read } = readPlaced(deps)
  const piped = pipedLines(read.settings)
  const plain: SettingsReport = {
    ...reportOf(read.settings, undefined, undefined, read.shown),
    piped,
    ...bothNote(place),
  }
  const { source } = place
  if (source.kind !== "project" || !profileStore(deps.home).exists())
    return plain
  const team = await teamOf(deps)
  if (standingOf(source.link, team.trust, deps.home).kind !== "used")
    return plain
  return {
    ...reportOf(
      read.settings,
      lastDeployed(team, source.link),
      source.link.app,
      read.shown
    ),
    piped,
  }
}

/**
 * `zekno settings --json`: the file's own data, in zekno's order of keys and
 * nothing added (contracts/commands.md, "--json"), as one object. Made from
 * the text zekno would write for the settings read (`settingsText`), so the
 * keys are in the order the file is written in. `note`: IN6, said apart.
 */
export function settingsData(deps: Pick<OpDeps, "cwd" | "home">): {
  data: unknown
  note?: string
} {
  const { place, read } = readPlaced(deps)
  return {
    data: JSON.parse(settingsText(read.settings)),
    ...bothNote(place),
  }
}

/**
 * A change of one setting, checked and not yet written: the file as it was
 * read, where its folder names it (`named`, the path written), the change,
 * and whether compose.yaml is beside it with nothing that decides (`both`).
 */
export type SettingPlan = {
  named: string
  read: SettingsRead
  change: Change
  both: boolean
}

/**
 * CS13 when the settings file is itself a symbolic link where its folder
 * names it: the reader may follow one that stays inside the folder, but a
 * change is never written through it (research R5), not even to a file
 * inside the folder.
 */
export function refuseLink(named: string, read: SettingsRead): void {
  let link: boolean
  try {
    link = lstatSync(named).isSymbolicLink()
  } catch {
    return
  }
  if (link) throw new CliError(CS13(read.shown))
}

/**
 * `zekno settings set` and `unset` up to the question (contracts/commands.md,
 * "Order of checks", 1 to 6): the words (CS1, CS2: wrong usage, with the
 * help line), the setting's name (CS6, CS5), the file a deploy here would
 * sign (SH1, SH2, SH3, or the reader's sentence), the service, the value
 * and the file with the change, each checked as the reader checks a file
 * (CS4, CS7, CS15, CS17). A refusal of status 2 is `WrongInput`; one of
 * status 0 (the same value, CS8; a setting not set, CS16) is given back as
 * `nothing`, with nothing to write. A file that is a symbolic link is
 * refused here (CS13), before anything is asked, since it would be refused
 * at the write. `value` undefined with `unset`.
 */
export function prepareSettingChange(
  deps: Pick<OpDeps, "cwd" | "home">,
  path: string | undefined,
  value: string | undefined,
  unset: boolean
): SettingPlan | { nothing: string } {
  if (path === undefined) throw new UsageError(CS1(unset ? "unset" : "set"))
  if (!unset && value === undefined) throw new UsageError(CS2)
  const parsed = parseSettingPath(path)
  if ("later" in parsed) throw new WrongInput(CS6(parsed.later))
  if ("unknown" in parsed) throw new WrongInput(CS5)
  const { place, read } = readPlaced(deps)
  const change = applyChange(
    read.settings,
    parsed,
    unset ? undefined : value,
    read.shown
  )
  if ("refused" in change) {
    if (change.status === 2) throw new WrongInput(change.refused)
    return { nothing: change.refused }
  }
  const named = namedPath(place.source)
  refuseLink(named, read)
  return { named, read, change, both: place.both }
}

/**
 * Writes a change, whole or not at all, never over a file that changed since
 * it was read, never through a link (settings/write.ts; CS12, CS13, CS14).
 * Nothing is deployed and no server is contacted (FR-025).
 */
export function writeSettingChange(plan: SettingPlan): void {
  refuseLink(plan.named, plan.read)
  writeSettings(plan.read, plan.change.settings)
}

/**
 * `zekno settings init` before it asks: IN4 when anything named
 * `zekno.app.json` is in this folder already, a link to nowhere included;
 * IN7 when that name is taken on this disk by a file named in other letter
 * case, which is no settings file and which init cannot add one beside.
 * `linked`: SH3, said once the file is made, when the zekno.json in use here
 * names another file than the one init makes, which the next deploy then
 * does not use; else `compose`: whether compose.yaml is here too (IN6). A
 * zekno.json that cannot be read gives no sentence: init only makes a file.
 */
export function prepareInit(deps: Pick<OpDeps, "cwd" | "home">): {
  compose: boolean
  linked?: string
} {
  // The name taken on this disk, by the settings file or by one that differs from it in letter case only (security review S5).
  if (present(deps.cwd, SETTINGS_FILE))
    throw new CliError(settingsFileIn(deps.cwd) ? IN4 : IN7)
  let link: ProjectLink | undefined
  try {
    link = linkInUse(deps)
  } catch {
    link = undefined
  }
  if (link === undefined) return { compose: present(deps.cwd, DEFAULT_COMPOSE) }
  const file = resolve(link.folder, link.compose)
  if (isHere(link, deps.cwd) && file === join(link.folder, SETTINGS_FILE))
    return { compose: false }
  return {
    compose: false,
    linked: SH3(shownFile(deps.cwd, file), aboveOf(deps.cwd, link)),
  }
}

/**
 * Creates `zekno.app.json` with one service of `image`, as `init` was
 * answered (research R8), never over a file that is there, not even one
 * made in between (IN4). The answers are held to their rules again here.
 * Returns the file's path.
 */
export function createFromAnswers(
  deps: Pick<OpDeps, "cwd">,
  image: string,
  service: string
): string {
  if (checkImage(image) !== undefined) throw new WrongInput(IN1_RULE)
  if (checkServiceName(service) !== undefined) throw new WrongInput(IN2_RULE)
  return createSettings(deps.cwd, {
    version: 1,
    services: [[service, { image }]],
  })
}

/**
 * `zekno settings compose` (FR-026, FR-027): the Compose text the settings
 * file a deploy here would sign turns into, made by `composeText`, the one
 * function that deploy signs the text of (settings/source.ts, `readSource`),
 * so what is printed is what is signed, byte for byte. With no such file,
 * SH1, SH2 or SH3, as for `zekno settings`. No keychain, no server. `note`:
 * IN6, said apart from the text.
 */
export function folderCompose(deps: Pick<OpDeps, "cwd" | "home">): {
  text: string
  note?: string
} {
  const { place, read } = readPlaced(deps)
  return { text: composeText(read.settings), ...bothNote(place) }
}
