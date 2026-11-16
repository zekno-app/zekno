/**
 * The settings screen's file (specs/010-app-settings, research R4 and R6;
 * contracts/app-screen.md, "States no board shows"): which settings file
 * this folder's `d` would deploy for an app, read once with the strict
 * reader (settings/file.ts), its rows marked against this machine's last
 * deploy of that app, and the Compose text it turns into.
 *
 * The file is content of the project, possibly from someone else's
 * repository. The reader bounds it and names a place, never its content, in
 * any fault; every value drawn is cleaned (settings/rows.ts). Nothing here
 * opens the team: a zekno.json is judged against the team list the app
 * already verified (`trustKnown`), and the history is read from the profile
 * folder with that list, so the keychain is never read and no server is
 * contacted. A zekno.json that cannot be used here is left aside, as `d`
 * leaves it.
 */
import type { TeamTrust } from "@workspace/core"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { CliError } from "../../cli/errors"
import { profileStore, type Server } from "../../profile/profile"
import type { ComposeSource } from "../../project/compose-read"
import { DEFAULT_COMPOSE, findProject } from "../../project/file"
import { standingOf } from "../../project/signed"
import { sanitize } from "../../server/sanitize"
import { composeText, deployedSettings } from "../../settings/compose"
import { isSettingsFile, readSettingsFile } from "../../settings/file"
import { screenRows } from "../../settings/rows"
import { chooseSource } from "../../settings/source"
import type { Settings } from "../../settings/types"
import { AS6, CS6, laterSentences, SH1, SH2 } from "../../settings/words"
import { lastDeployedCompose } from "../../shared/views"
import type { Effect } from "../state/events"
import type { SettingsView } from "../state/types"
import type { Context } from "./context"

type Outcome = SettingsView["outcome"]

/** Where the screen's settings come from: a settings file to read, or a sentence in their place. */
type Found =
  | { kind: "settings"; source: ComposeSource }
  | { kind: "sentence"; sentence: string }

/** The end of the first sentence every fault of form starts with (`notSettings`). */
const NOT_SETTINGS = " could not be read as settings. "

/** The second sentences of SL0 to SL5, fixed words: what follows the first of a later setting. */
const LATER_SECOND = [
  laterSentences("", "version")[1],
  ...(
    ["build", "predeploy", "healthcheck", "replicas", "domains"] as const
  ).map(CS6),
]

/**
 * A fault's sentences as the screen draws them: the first, and the place and
 * rule after it, or a later setting's second sentence. Any other is one
 * sentence (SR1 to SR9, or a zekno.json's), the first alone.
 */
export function faultOf(message: string): { first: string; rest: string } {
  const at = message.indexOf(NOT_SETTINGS)
  if (at !== -1) {
    const end = at + NOT_SETTINGS.length
    return { first: message.slice(0, end - 1), rest: message.slice(end) }
  }
  const second = LATER_SECOND.find((words) => message.endsWith(` ${words}`))
  return second
    ? {
        first: message.slice(0, -second.length - 1),
        rest: second,
      }
    : { first: message, rest: "" }
}

/**
 * The settings file `d` would deploy for `app` on `server`, from the folder
 * the app was started in (research R6): the one this folder's zekno.json
 * names when it is signed by the team, used here and names that app on that
 * server; AS6 when it names another; SH2 when it names a Compose file. A
 * zekno.json that cannot be used here, or none: `zekno.app.json` here (also
 * beside `compose.yaml`, where `d` asks first), SH2 with only
 * `compose.yaml`, SH1 with neither.
 */
function settingsFor(
  cwd: string,
  home: string,
  server: string,
  app: string,
  trust: TeamTrust | undefined
): Found {
  const link = findProject(cwd)
  if (link && trust && standingOf(link, trust, home).kind === "used") {
    if (link.server !== server || link.app !== app)
      return {
        kind: "sentence",
        sentence: AS6(sanitize(link.app), sanitize(link.server)),
      }
    return isSettingsFile(link.compose)
      ? { kind: "settings", source: { kind: "project", link } }
      : { kind: "sentence", sentence: SH2(sanitize(link.compose)) }
  }
  const chosen = chooseSource(cwd, {})
  if (chosen.kind !== "compose")
    return { kind: "settings", source: { kind: "default", folder: cwd } }
  return existsSync(join(cwd, DEFAULT_COMPOSE))
    ? { kind: "sentence", sentence: SH2(DEFAULT_COMPOSE) }
    : { kind: "sentence", sentence: SH1 }
}

/** Reading the settings screen's file, and the last deploy each app's marks are made against. */
export function createSettings(context: Context) {
  const { deps, ops, dispatch, trustKnown } = context

  /**
   * The settings of each app's last deploy from this machine, as read from
   * the history; undefined when it was not made from settings. Read again
   * only when the screen opens and when a deploy of the app ends.
   */
  const deployed = new Map<string, Settings | undefined>()

  /** The servers of the profile, as last verified in this run, or as the profile stands. */
  function servers(): readonly Server[] {
    if (context.known) return context.known.servers
    try {
      return profileStore(deps.home).load().servers
    } catch {
      return []
    }
  }

  /** The settings of `app`'s last deploy, read again when `again`, else as last read. Nothing without a verified team list. */
  function lastDeployed(
    server: string,
    app: string,
    trust: TeamTrust | undefined,
    again: boolean
  ): Settings | undefined {
    if (!trust) return undefined
    const key = `${server}\n${app}`
    if (!again && deployed.has(key)) return deployed.get(key)
    const entry = servers().find((item) => item.name === server)
    const text = entry
      ? lastDeployedCompose(profileStore(deps.home), trust, entry, app)
      : undefined
    const settings = text === undefined ? undefined : deployedSettings(text)
    deployed.set(key, settings)
    return settings
  }

  /** What the screen shows for the effect's app, or the fault that stops it. */
  function outcomeOf(
    effect: Extract<Effect, { kind: "read-settings" }>
  ): Outcome {
    const trust = trustKnown()
    try {
      const found = settingsFor(
        ops.cwd,
        deps.home,
        effect.server,
        effect.app,
        trust
      )
      if (found.kind === "sentence") return found
      const read = readSettingsFile(found.source, ops.cwd)
      const before = lastDeployed(
        effect.server,
        effect.app,
        trust,
        effect.deployed
      )
      return {
        kind: "read",
        report: {
          app: effect.app,
          file: read.shown,
          services: read.settings.services.map((service) => ({
            name: service[0],
            rows: screenRows(service, before),
          })),
        },
        settings: read.settings,
        sha256: read.sha256,
        compose: composeText(read.settings),
      }
    } catch (error) {
      // Every fault of the file, and of a zekno.json, is one sentence that names a place, never the content.
      if (error instanceof CliError)
        return { kind: "fault", ...faultOf(error.message) }
      throw error
    }
  }

  /** Reads this folder's settings for an app's settings screen, and says what they are. */
  function read(effect: Extract<Effect, { kind: "read-settings" }>): void {
    dispatch({
      type: "settings-read",
      server: effect.server,
      app: effect.app,
      outcome: outcomeOf(effect),
    })
  }

  return { read }
}
