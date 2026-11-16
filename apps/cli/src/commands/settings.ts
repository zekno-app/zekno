/**
 * The `zekno settings` commands (specs/010-app-settings, contracts/commands.md;
 * board `CmdSettings`): what they show and ask. What they do is in
 * ops/settings.ts; their words in settings/words.ts. None contacts a server,
 * deploys or signs anything.
 */
import type { Deps } from "../cli/context"
import { CliError, Left } from "../cli/errors"
import {
  createFromAnswers,
  folderCompose,
  prepareInit,
  prepareSettingChange,
  settingsData,
  showSettings,
  writeSettingChange,
} from "../ops/settings"
import { sanitize } from "../server/sanitize"
import { SETTINGS_FILE } from "../settings/file"
import { checkImage, checkServiceName } from "../settings/values"
import {
  CS10,
  CS11,
  CS11_TO,
  CS9,
  IN1,
  IN1_RULE,
  IN2,
  IN2_RULE,
  IN3,
  IN5,
  IN6,
} from "../settings/words"
import { quiet } from "../ui/types"

/**
 * `zekno settings [--json]`: the settings of the file `zekno deploy` here
 * would sign in sections, plain lines when piped, or with `--json` the
 * file's own data as one JSON object, and IN6 apart from it when
 * compose.yaml is beside it with nothing that decides.
 */
export async function settingsShow(
  deps: Deps,
  options: { json?: boolean }
): Promise<void> {
  if (options.json) {
    const { data, note } = settingsData(deps)
    deps.ui.json(data)
    if (note !== undefined) deps.ui.warn(note)
    return
  }
  deps.ui.settingsReport(await showSettings(deps))
}

/**
 * The change line, the question and the write of `set` and `unset`
 * (contracts/commands.md, "Order of checks", 7 and 8): the old and the new
 * value shown, then asked once (CS9) unless `--yes`; with no terminal and no
 * `--yes`, CS10. "No", Enter, Esc and Ctrl-C write nothing: `Nothing was
 * done.`, status 1. A change that writes nothing (CS8, CS16) is said, status
 * 0. Nothing is deployed and no server is contacted.
 */
async function change(
  deps: Deps,
  prepared: ReturnType<typeof prepareSettingChange>,
  yes: boolean
): Promise<number> {
  if ("nothing" in prepared) {
    deps.ui.info(prepared.nothing)
    return 0
  }
  const { change } = prepared
  deps.ui.settingChange({
    service: change.path.service,
    label: change.label,
    now: change.now,
    next: change.next,
  })
  const file = prepared.read.shown
  if (!yes && !(await deps.ui.confirm(CS9(file), CS10(file)))) throw new Left()
  writeSettingChange(prepared)
  // A file other than this folder's own is named: the one a link names, which the person may not expect (security review S7).
  deps.ui.success(
    file === SETTINGS_FILE ? CS11.text : CS11_TO(file),
    CS11.detail
  )
  // A deploy here asks which file to use, or takes -f: the file written is one of two. A warning, as everywhere IN6 is said.
  if (prepared.both) deps.ui.warn(IN6)
  return 0
}

/** `zekno settings set <service>.<setting> <value> [--yes]`: changes one setting of the file `zekno deploy` here would sign. */
export async function settingsSet(
  deps: Deps,
  path: string | undefined,
  value: string | undefined,
  options: { yes: boolean }
): Promise<number> {
  return change(
    deps,
    prepareSettingChange(deps, path, value, false),
    options.yes
  )
}

/** `zekno settings unset <service>.<setting> [--yes]`: removes one setting of the file `zekno deploy` here would sign. */
export async function settingsUnset(
  deps: Deps,
  path: string | undefined,
  options: { yes: boolean }
): Promise<number> {
  return change(
    deps,
    prepareSettingChange(deps, path, undefined, true),
    options.yes
  )
}

/**
 * `zekno settings init` (contracts/commands.md, `init`; research R8): IN4
 * before any question when `zekno.app.json` is here; with no terminal, IN5.
 * Then the image (IN1) and the service's name (IN2, `web` filled in), each
 * held to its rule where it is typed; the file is created whole, never over
 * another (IN3), in this folder, with SH3 as a warning when the zekno.json in
 * use here names another file, else IN6, a warning, when compose.yaml is here too. Esc
 * or Ctrl-C at a question: `Nothing was done.`, status 1, nothing written.
 */
export async function settingsInit(deps: Deps): Promise<number> {
  const { compose, linked } = prepareInit(deps)
  if (!deps.ui.asks) throw new CliError(IN5)
  const image = await deps.ui.ask({
    question: IN1,
    check: (answer) =>
      checkImage(answer) === undefined ? undefined : IN1_RULE,
    missing: new CliError(IN5),
  })
  const service = await deps.ui.ask({
    question: IN2,
    fill: "web",
    check: (answer) =>
      checkServiceName(answer) === undefined ? undefined : IN2_RULE,
    missing: new CliError(IN5),
  })
  createFromAnswers(deps, image, service)
  deps.ui.success(IN3.text, IN3.detail)
  if (linked !== undefined) deps.ui.warn(linked)
  else if (compose) deps.ui.warn(IN6)
  return 0
}

/**
 * `zekno settings compose`: the Compose text the settings turn into, the
 * text a deploy of this folder signs (FR-027). Piped, each line exactly as it
 * is, so standard output is the text, byte for byte, with its last line
 * feed; at a terminal the same lines, dim (board `CmdSettings`), cleaned as
 * every line drawn from the file is. IN6, when compose.yaml is beside the
 * file with nothing that decides, goes after the text, on standard error
 * when piped.
 */
export function settingsCompose(deps: Deps): void {
  const { text, note } = folderCompose(deps)
  const lines = text.split("\n")
  // The text ends with a line feed: the last part is empty, and is not a line.
  lines.pop()
  for (const line of lines) deps.ui.line(line, [quiet(sanitize(line))])
  // At a terminal an empty line sets it apart from the text, as after the settings; piped it is on standard error alone.
  if (note !== undefined) {
    deps.ui.gap()
    deps.ui.warn(note)
  }
}
