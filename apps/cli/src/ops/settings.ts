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
 */
import { teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError } from "../cli/errors"
import { findServer, profileStore } from "../profile/profile"
import {
  DEFAULT_COMPOSE,
  findProject,
  isHere,
  type ProjectLink,
} from "../project/file"
import { standingOf } from "../project/signed"
import { sanitize } from "../server/sanitize"
import { deployedSettings } from "../settings/compose"
import {
  isSettingsFile,
  readSettingsFile,
  SETTINGS_FILE,
} from "../settings/file"
import { pipedLines } from "../settings/piped"
import { reportOf } from "../settings/rows"
import { present } from "../settings/source"
import { settingsText } from "../settings/text"
import type { Settings, SettingsRead, SettingsReport } from "../settings/types"
import { SH1, SH2, SH3 } from "../settings/words"
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
