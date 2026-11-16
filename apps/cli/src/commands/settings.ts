/**
 * The `zekno settings` commands (specs/010-app-settings, contracts/commands.md;
 * board `CmdSettings`): what they show and ask. What they do is in
 * ops/settings.ts; their words in settings/words.ts. None contacts a server,
 * deploys or signs anything.
 */
import type { Deps } from "../cli/context"
import { settingsData, showSettings } from "../ops/settings"

/**
 * `zekno settings [--json]`: the settings of this folder's `zekno.app.json`
 * in sections, plain lines when piped, or with `--json` the file's own data
 * as one JSON object.
 */
export async function settingsShow(
  deps: Deps,
  options: { json?: boolean }
): Promise<void> {
  if (options.json) return deps.ui.json(await settingsData(deps))
  deps.ui.settingsReport(await showSettings(deps))
}
