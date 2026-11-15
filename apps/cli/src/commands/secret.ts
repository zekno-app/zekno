import { resolve } from "node:path"

import type { Deps } from "../cli/context"
import { CliError, Left, UsageError } from "../cli/errors"
import { listSecrets, prepareSecretImport, prepareSecretSet, removeSecret, setSecret, storeSecrets, type ImportPlan, type Where } from "../ops/secret"
import { sanitize } from "../server/sanitize"
import { importError, parseImport, readImportFile, type ImportEntry } from "../secrets/import-file"
import { quiet } from "../ui/types"

export async function secretSet(deps: Deps, name: string | undefined, options: Where & { stdin?: boolean }): Promise<void> {
  const plan = await prepareSecretSet(deps, name, options)
  // Where the value goes is said before it is typed: the app and server may have come from zekno.json.
  const value = await deps.ui.askSecret(`Value for ${plan.name} (${plan.app} on ${plan.server.name}): `, options.stdin === true)
  const set = await setSecret(plan, value)
  deps.ui.success(`Set ${set.name} (version ${set.version}) for ${set.app} on ${set.server}. It takes effect on the next deploy.`)
}

export async function secretRemove(deps: Deps, name: string | undefined, options: Where): Promise<void> {
  const removed = await removeSecret(deps, name, options)
  deps.ui.success(`Removed ${removed.name} from ${removed.app} on ${removed.server}. It takes effect on the next deploy.`)
}

/** I10: `zekno secret import` with no file. A usage error. Needs approval (research Q4). */
export const SAY_WHICH_FILE = "Say which file: `zekno secret import <file>`."

/** I1: the first line of an import's summary (mock-up 4). */
export const importFor = (file: string, app: string, server: string): string => `${file}, for ${app} on ${server}`

/** I11: every name of the file was left out. Needs approval (research Q4). */
export const nothingToImport = (file: string): string => `No value in ${file} can be stored, so nothing was stored.`

/** I15: the one question (mock-up 4). */
export const storeQuestion = (count: number): string => `Store ${count} ${count === 1 ? "value" : "values"}? Values are never shown.`

/** I16: no terminal and no `--yes`. Needs approval (research Q4). */
export const importNeedsYes = (file: string): string => `There is no terminal to ask on. Add \`--yes\` to store the values from ${file}.`

/** I17: what was stored (mock-up 4). */
export const importStored = (count: number, app: string, server: string): string =>
  count === 1
    ? `Stored 1 value for ${app} on ${server}. It takes effect on the next deploy.`
    : `Stored ${count} values for ${app} on ${server}. They take effect on the next deploy.`

/** I18: the file is still there (mock-up 4). */
export const importStillThere = (file: string, count: number): string =>
  `${file} still holds ${count === 1 ? "it" : "them"} in plain text. Delete it, or keep it out of git.`

/** The labels of an import's groups (mock-up 4). */
const GROUPS = { fresh: "new", replaces: "replaces", leftOut: "left out" } as const

/** An import file, read and parsed whole: the path as typed, cleaned, and its entries. */
export type ImportRead = { file: string; entries: ImportEntry[] }

/**
 * Reads and parses the file of `zekno secret import <file>` whole, before
 * anything else is looked at (contracts/import.md, "Order of checks"): no
 * file is I10; a file that cannot be read, or a line that does not fit, stops
 * the import with a sentence that names the file and a line's number only.
 */
export function readImport(cwd: string, file: string | undefined): ImportRead {
  if (!file) throw new UsageError(SAY_WHICH_FILE)
  const shown = sanitize(file)
  const parsed = parseImport(readImportFile(resolve(cwd, file), shown))
  if (!("entries" in parsed)) throw importError(shown, parsed)
  return { file: shown, entries: parsed.entries }
}

/** The lines of an import's summary, for `Ui.groups`: the names of each group in the file's order, a group with no name left out. */
export function importGroups(plan: Pick<ImportPlan, "values" | "leftOut">): [string, string][] {
  const fresh = plan.values.filter((value) => !value.replaces).map((value) => value.name)
  const replaces = plan.values.filter((value) => value.replaces).map((value) => value.name)
  const out = plan.leftOut.map((entry) => `${entry.shown} (${entry.reason})`)
  const rows: [string, string[]][] = [
    [GROUPS.fresh, fresh],
    [GROUPS.replaces, replaces],
    [GROUPS.leftOut, out],
  ]
  return rows.filter(([, names]) => names.length > 0).map(([label, names]) => [label, names.join(", ")])
}

/**
 * `zekno secret import <file>` (mock-up 4): the summary by name only, the one
 * question unless `--yes`, then every value stored in one write, or none. The
 * values go from the file to `storeSecrets` and nowhere else: no line here
 * holds one.
 */
export async function secretImport(deps: Deps, read: ImportRead, where: Where, options: { yes: boolean }): Promise<void> {
  const plan = await prepareSecretImport(deps, where, read.entries, read.file)
  const server = plan.server.name
  deps.ui.note(importFor(read.file, plan.app, server))
  deps.ui.gap()
  deps.ui.groups(importGroups(plan))
  deps.ui.gap()
  const count = plan.values.length
  if (count === 0) throw new CliError(nothingToImport(read.file))
  // "No", Enter, Esc and Ctrl-C store nothing. With no terminal the question is not asked: it says to add `--yes`.
  if (!options.yes && !(await deps.ui.confirm(storeQuestion(count), importNeedsYes(read.file)))) throw new Left()
  await storeSecrets(plan)
  // At a terminal its first sentence is bold, as the board "zekno secret import" draws it; plain output is the same words.
  deps.ui.success(importStored(count, plan.app, server), undefined, { firstBold: true })
  deps.ui.note(importStillThere(read.file, count))
}

/**
 * Names and versions only. There is no command that shows a value. At a
 * terminal, as on the board "Status, lists, errors and piped output", a
 * secret set after the latest deploy says so, and a last line says where
 * these are and that values are never shown; plain output is unchanged.
 */
export async function secretList(deps: Deps, options: Where): Promise<void> {
  const { app, server, secrets } = await listSecrets(deps, options)
  if (secrets.length === 0) return deps.ui.info(`${app} on ${server} has no secrets.`)
  deps.ui.table(
    secrets.map((secret) => {
      const version = `version ${secret.version}`
      return [secret.name, quiet(version, secret.notDeployed ? `${version}, not deployed yet` : undefined)]
    })
  )
  deps.ui.line(undefined, [quiet(`${app} on ${server}. Values are never shown.`)])
}
