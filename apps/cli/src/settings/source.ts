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
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { DEFAULT_COMPOSE, type ProjectLink } from "../project/file"
import { readCompose } from "../project/compose-read"
import { composeText } from "./compose"
import { isSettingsFile, readSettingsFile, SETTINGS_FILE } from "./file"
import type { DeploySource, DeployText } from "./types"

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
  const compose = existsSync(join(cwd, DEFAULT_COMPOSE))
  const settings = existsSync(join(cwd, SETTINGS_FILE))
  if (compose && settings) return { kind: "both", folder: cwd }
  return settings ? { kind: "settings", source } : { kind: "compose", source }
}

/**
 * Reads the chosen file once: a Compose file as today (`readCompose`); a
 * settings file read and checked whole (`readSettingsFile`), then turned
 * into the Compose text a deploy signs, with its services for the summary.
 * Every problem is the `CliError` of the reader.
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
    settings: { services: read.settings.services.map(([name]) => name) },
  }
}
