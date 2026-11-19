/**
 * Which file a deploy uses, and reading it once (specs/010-app-settings,
 * contracts/deploy.md, "Which file a deploy uses"; design.md, decision 3).
 * The first rule that applies decides:
 *
 * 1. `-f <file>`, either kind: a file named exactly `zekno.app.json` is read
 *    as settings, any other as a Compose file.
 * 2. The file this folder's link names: the zekno.json the caller found
 *    signed by the team and in use here (`project`). It may name
 *    `zekno.app.json`.
 * 3. The one that exists, when only one of `compose.yaml` and
 *    `zekno.app.json` is in the folder.
 * 4. Both, and nothing above: `both`, which the caller asks about at a
 *    terminal (DP1) and stops on with none (DP2). Neither file is ever
 *    picked silently over the other. With neither, the Compose file, so
 *    today's sentence comes out of `readCompose`.
 *
 * Nothing here asks, and nothing here judges a zekno.json: the caller has
 * already decided whether its link may be used.
 *
 * For rules 3 and 4 a file is there when anything has its name in the
 * folder, and for `zekno.app.json` that name exactly (`settingsFileIn`): a
 * link is not followed to decide it. A link that leads nowhere, or
 * out of the folder, and a folder of that name all count, so neither of the
 * two names can be made to vanish and let the other win without a question.
 * The reader then says what is wrong with the one chosen.
 */
import { lstatSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  DEFAULT_COMPOSE,
  listsExactly,
  type ProjectLink,
} from "../project/file"
import { healthOf, routesOf } from "../domains/routes"
import { readCompose, type ComposeSource } from "../project/compose-read"
import { shownFile } from "../project/shown"
import { composeText } from "./compose"
import { isSettingsFile, readSettingsFile, SETTINGS_FILE } from "./file"
import type { DeploySource, DeployText } from "./types"

/**
 * Whether anything has the name `name` in `folder`, without following a
 * link: a link to nowhere is there. Only "no such entry" is absence; any
 * other failure to look counts as there, so a file is never left out of the
 * choice because it could not be looked at.
 */
export function present(folder: string, name: string): boolean {
  try {
    lstatSync(join(folder, name))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code !== "ENOENT" && code !== "ENOTDIR"
  }
}

/**
 * Whether `folder` holds a settings file: an entry named exactly
 * `zekno.app.json` in its listing, looked at as `present` looks. On a disk
 * that ignores letter case `ZEKNO.APP.JSON` is found under that name too,
 * and it is not a settings file, as `ZEKNO.JSON` is not a zekno.json (the
 * file-name case note of feature 004; security review S5): one folder gives
 * the same choice on every machine. A folder that cannot be listed counts as
 * holding one, so the reader says what is wrong with it.
 */
export function settingsFileIn(folder: string): boolean {
  if (!present(folder, SETTINGS_FILE)) return false
  try {
    return listsExactly(folder, SETTINGS_FILE)
  } catch {
    return true
  }
}

/** The file a deploy in `cwd` uses, by the rules above. `file` is `-f` as typed; `project` a link that may be used here. */
export function chooseSource(
  cwd: string,
  input: { file?: string; project?: ProjectLink }
): DeploySource {
  if (input.file !== undefined) {
    const source = { kind: "given", path: resolve(cwd, input.file) } as const
    return isSettingsFile(input.file)
      ? { kind: "settings", source }
      : { kind: "compose", source }
  }
  if (input.project !== undefined) {
    const source = { kind: "project", link: input.project } as const
    return isSettingsFile(input.project.compose)
      ? { kind: "settings", source }
      : { kind: "compose", source }
  }
  const source = { kind: "default", folder: cwd } as const
  const compose = present(cwd, DEFAULT_COMPOSE)
  const settings = settingsFileIn(cwd)
  if (compose && settings) return { kind: "both", folder: cwd }
  return settings ? { kind: "settings", source } : { kind: "compose", source }
}

/**
 * Which settings a person is shown, and may change, in `cwd` (specs/010-app-settings,
 * security review S1): those of the file a deploy in `cwd` would sign,
 * decided by `chooseSource` itself, given `link`, the zekno.json that
 * applies here when the caller found it may be used here, as the deploy
 * judges it. The settings commands and the settings screen both take their
 * file from here, so neither can show one file while a deploy signs another.
 *
 * - `settings`: the settings file a deploy would read, wherever it is (the
 *   one the link names, or this folder's). `both`: compose.yaml is here too
 *   and nothing decides, so a deploy asks which (DP1) or stops (DP2).
 * - `compose`: a deploy would read a Compose file written by hand, named as
 *   the deploy names it. `settingsHere`: a `zekno.app.json` lies in this
 *   folder all the same, which the next deploy does not use.
 * - `none`: neither file.
 */
export type SettingsPlace =
  | { kind: "settings"; source: ComposeSource; both: boolean }
  | { kind: "compose"; file: string; link?: ProjectLink; settingsHere: boolean }
  | { kind: "none" }

/** Where the settings shown in `cwd` come from, by the deploy's rule; `link` is a zekno.json the caller found may be used here. */
export function settingsPlace(cwd: string, link?: ProjectLink): SettingsPlace {
  const chosen = chooseSource(cwd, link === undefined ? {} : { project: link })
  if (chosen.kind === "both")
    return {
      kind: "settings",
      source: { kind: "default", folder: cwd },
      both: true,
    }
  if (chosen.kind === "settings")
    return { kind: "settings", source: chosen.source, both: false }
  if (chosen.source.kind === "project")
    return {
      kind: "compose",
      file: shownFile(
        cwd,
        resolve(chosen.source.link.folder, chosen.source.link.compose)
      ),
      link: chosen.source.link,
      settingsHere: settingsFileIn(cwd),
    }
  return present(cwd, DEFAULT_COMPOSE)
    ? { kind: "compose", file: DEFAULT_COMPOSE, settingsHere: false }
    : { kind: "none" }
}

/** The settings file of `source` as its folder names it, before any link in its place is followed: where a change is written. */
export function namedPath(source: ComposeSource): string {
  switch (source.kind) {
    case "default":
      return join(source.folder, SETTINGS_FILE)
    case "project":
      return resolve(source.link.folder, source.link.compose)
    case "given":
      return source.path
  }
}

/**
 * Reads the chosen file once: a Compose file as today (`readCompose`); a
 * settings file read and checked whole (`readSettingsFile`), then turned
 * into the Compose text a deploy signs, with its services for the summary,
 * and the routes and the health check the deploy signs beside the text
 * (specs/015-domains-https, contracts/cli.md, CL3; domains/routes.ts), from
 * the same settings read. A Compose file written by hand has neither. Every
 * problem is the `CliError` of the reader.
 */
export function readSource(
  source: DeploySource & { kind: "compose" | "settings" },
  cwd: string
): DeployText {
  if (source.kind === "compose") return readCompose(source.source)
  const read = readSettingsFile(source.source, cwd)
  return {
    text: composeText(read.settings),
    path: read.path,
    settings: {
      services: read.settings.services.map(([name]) => name),
      sha256: read.sha256,
      routes: routesOf(read.settings),
      health: healthOf(read.settings),
    },
  }
}
