/**
 * What the `zekno settings` commands do (specs/010-app-settings,
 * contracts/commands.md): data only, nothing drawn and nothing asked. Each
 * reads `zekno.app.json` in the folder the command runs in, once, with the
 * reader's every check (settings/file.ts). None contacts a server, deploys,
 * or signs anything (FR-025).
 *
 * `zekno settings` may open the team, once: only when this folder's own
 * zekno.json is here and a profile exists, to judge whether the team signed
 * it and it is in use here (`standingOf`), and then to verify this
 * machine's history of deploys, so that a setting changed since the last
 * deploy is marked (research R4). It never asks, never accepts a zekno.json
 * and never writes `links.json`: a file it cannot use is left as it is.
 * `set`, `unset` and `init` never open the team: they read and write the
 * settings file, through the writer of settings/write.ts only. `compose`
 * never opens it either.
 */
import { lstatSync } from "node:fs"
import { join } from "node:path"

import { teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, UsageError, WrongInput } from "../cli/errors"
import { findServer, profileStore } from "../profile/profile"
import {
  DEFAULT_COMPOSE,
  findProject,
  isHere,
  type ProjectLink,
} from "../project/file"
import { standingOf } from "../project/signed"
import { sanitize } from "../server/sanitize"
import { applyChange, parseSettingPath } from "../settings/change"
import { composeText, deployedSettings } from "../settings/compose"
import {
  isSettingsFile,
  readSettingsFile,
  SETTINGS_FILE,
} from "../settings/file"
import { pipedLines } from "../settings/piped"
import { reportOf } from "../settings/rows"
import { present } from "../settings/source"
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
  SH1,
  SH2,
  SH3,
} from "../settings/words"
import { createSettings, writeSettings } from "../settings/write"
import { lastDeployedCompose } from "../shared/views"

/**
 * This folder's own zekno.json, when it is signed by the team and in use here
 * (`used`), with the team that judged it. Undefined with no profile, with no
 * zekno.json in this folder (one in a folder above does not count), with one
 * that cannot be read, and with one the team did not sign or that is not in
 * use here: nothing is asked about it and nothing recorded.
 */
async function linkInUse(
  deps: OpDeps
): Promise<{ link: ProjectLink; team: Team } | undefined> {
  if (!profileStore(deps.home).exists()) return undefined
  let found: ProjectLink | undefined
  try {
    found = findProject(deps.cwd)
  } catch {
    return undefined
  }
  if (found === undefined || !isHere(found, deps.cwd)) return undefined
  const team = await teamOf(deps)
  return standingOf(found, team.trust, deps.home).kind === "used"
    ? { link: found, team }
    : undefined
}

/**
 * SH1, or SH2 when this folder deploys a Compose file written by hand: the
 * one its own zekno.json names (`link`, signed and in use here), else
 * compose.yaml when it is here. Nothing is read from that file (FR-018).
 */
function noSettings(cwd: string, link?: ProjectLink): CliError {
  if (link !== undefined && !isSettingsFile(link.compose))
    return new CliError(SH2(sanitize(link.compose)))
  if (present(cwd, DEFAULT_COMPOSE)) return new CliError(SH2(DEFAULT_COMPOSE))
  return new CliError(SH1)
}

/** `zekno.app.json` in this folder, read once and checked whole; every problem is the reader's sentence. */
const readHere = (deps: Pick<OpDeps, "cwd">): SettingsRead =>
  readSettingsFile({ kind: "default", folder: deps.cwd }, deps.cwd)

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

/**
 * `zekno settings` (FR-014 to FR-019): the settings of this folder's
 * `zekno.app.json` in sections, with the app and the marks of what changed
 * since this machine's last deploy only when this folder's own zekno.json is
 * signed by the team, in use here and names `zekno.app.json`; SH3 as the
 * note when it names a Compose file instead. The file is read before the
 * team is opened, so a fault in it is said without the keychain.
 */
export async function showSettings(deps: OpDeps): Promise<SettingsReport> {
  if (!present(deps.cwd, SETTINGS_FILE))
    throw noSettings(deps.cwd, (await linkInUse(deps))?.link)
  const read = readHere(deps)
  const used = await linkInUse(deps)
  const piped = pipedLines(read.settings)
  if (used === undefined)
    return {
      ...reportOf(read.settings, undefined, undefined, read.shown),
      piped,
    }
  const { link, team } = used
  if (link.compose === SETTINGS_FILE)
    return {
      ...reportOf(
        read.settings,
        lastDeployed(team, link),
        link.app,
        read.shown
      ),
      piped,
    }
  const report = reportOf(read.settings, undefined, undefined, read.shown)
  return isSettingsFile(link.compose)
    ? { ...report, piped }
    : { ...report, piped, note: SH3(sanitize(link.compose)) }
}

/**
 * `zekno settings --json`: the file's own data, in zekno's order of keys and
 * nothing added (contracts/commands.md, "--json"), as one object. Made from
 * the text zekno would write for the settings read (`settingsText`), so the
 * keys are in the order the file is written in.
 */
export async function settingsData(deps: OpDeps): Promise<unknown> {
  if (!present(deps.cwd, SETTINGS_FILE))
    throw noSettings(deps.cwd, (await linkInUse(deps))?.link)
  return JSON.parse(settingsText(readHere(deps).settings))
}

/** A change of one setting, checked and not yet written: the file as it was read, and the change. */
export type SettingPlan = { folder: string; read: SettingsRead; change: Change }

/**
 * CS13 when this folder's `zekno.app.json` is itself a symbolic link: the
 * reader may follow one that stays inside the folder, but a change is never
 * written through it (research R5), not even to a file inside the folder.
 */
function refuseLink(folder: string, read: SettingsRead): void {
  let link: boolean
  try {
    link = lstatSync(join(folder, SETTINGS_FILE)).isSymbolicLink()
  } catch {
    return
  }
  if (link) throw new CliError(CS13(read.shown))
}

/**
 * `zekno settings set` and `unset` up to the question (contracts/commands.md,
 * "Order of checks", 1 to 6): the words (CS1, CS2: wrong usage, with the
 * help line), the setting's name (CS6, CS5), the file (SH1, or the reader's
 * sentence), the service, the value and the file with the change, each
 * checked as the reader checks a file (CS4, CS7, CS15, CS17). A refusal of
 * status 2 is `WrongInput`; one of status 0 (the same value, CS8; a setting
 * not set, CS16) is given back as `nothing`, with nothing to write. A file
 * that is a symbolic link is refused here (CS13), before anything is asked,
 * since it would be refused at the write. `value` undefined with `unset`.
 */
export function prepareSettingChange(
  deps: Pick<OpDeps, "cwd">,
  path: string | undefined,
  value: string | undefined,
  unset: boolean
): SettingPlan | { nothing: string } {
  if (path === undefined) throw new UsageError(CS1(unset ? "unset" : "set"))
  if (!unset && value === undefined) throw new UsageError(CS2)
  const parsed = parseSettingPath(path)
  if ("later" in parsed) throw new WrongInput(CS6(parsed.later))
  if ("unknown" in parsed) throw new WrongInput(CS5)
  if (!present(deps.cwd, SETTINGS_FILE)) throw new CliError(SH1)
  const read = readHere(deps)
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
  refuseLink(deps.cwd, read)
  return { folder: deps.cwd, read, change }
}

/**
 * Writes a change, whole or not at all, never over a file that changed since
 * it was read, never through a link (settings/write.ts; CS12, CS13, CS14).
 * Nothing is deployed and no server is contacted (FR-025).
 */
export function writeSettingChange(plan: SettingPlan): void {
  refuseLink(plan.folder, plan.read)
  writeSettings(plan.read, plan.change.settings)
}

/**
 * `zekno settings init` before it asks: IN4 when anything named
 * `zekno.app.json` is in this folder already, a link to nowhere included.
 * `compose`: whether compose.yaml is here too (IN6).
 */
export function prepareInit(deps: Pick<OpDeps, "cwd">): { compose: boolean } {
  if (present(deps.cwd, SETTINGS_FILE)) throw new CliError(IN4)
  return { compose: present(deps.cwd, DEFAULT_COMPOSE) }
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
 * `zekno settings compose` (FR-026, FR-027): the Compose text this folder's
 * `zekno.app.json` turns into, made by `composeText`, the one function a
 * deploy of the same file signs the text of (settings/source.ts,
 * `readSource`), so what is printed is what is signed, byte for byte. With
 * no settings file, SH2 when compose.yaml is here, else SH1: no team is
 * opened, so a zekno.json is not looked at. No keychain, no server.
 */
export function folderCompose(deps: Pick<OpDeps, "cwd">): string {
  if (!present(deps.cwd, SETTINGS_FILE)) throw noSettings(deps.cwd)
  return composeText(readHere(deps).settings)
}
