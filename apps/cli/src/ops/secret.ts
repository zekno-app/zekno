import {
  CoreError,
  createSecret,
  createSecretRemoval,
  currentSecrets,
  isReservedSecretName,
  LIMITS,
  readSignedDeploy,
  SECRET_NAME,
  verifySecret,
  verifySecretRemoval,
  type SecretRecord,
  type TeamTrust,
} from "@workspace/core"

import { teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, UsageError } from "../cli/errors"
import { findServer, type SecretStore, type Server } from "../profile/profile"
import type { ImportEntry } from "../secrets/import-file"
import { checkApp, type Where } from "./deploy"

export type { Where }

async function locate(deps: OpDeps, where: Where) {
  const team = await teamOf(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  const app = checkApp(where.app)
  return { team, trust: team.trust, server, app, secrets: team.store.secrets(server.serverId, app) }
}

/** The highest version this machine has seen for each name, set or removed: `latestVersion` for every name at once, in one pass. */
function latestVersions(trust: TeamTrust, serverId: string, app: string, held: SecretStore): Map<string, number> {
  const latest = new Map<string, number>()
  const seen = (name: string, version: number) => latest.set(name, Math.max(latest.get(name) ?? 0, version))
  for (const record of held.records) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (checked.ok) seen(checked.value.name, checked.value.version)
  }
  for (const removal of held.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (checked.ok) seen(checked.value.name, checked.value.version)
  }
  return latest
}

/** The highest version this machine has seen for a name, set or removed. */
function latestVersion(trust: TeamTrust, serverId: string, app: string, held: SecretStore, name: string): number {
  let latest = 0
  for (const record of held.records) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (checked.ok && checked.value.name === name) latest = Math.max(latest, checked.value.version)
  }
  for (const removal of held.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (checked.ok && checked.value.name === name) latest = Math.max(latest, checked.value.version)
  }
  return latest
}

/** Said for a name that cannot be a secret's. It states the rule and never repeats what was typed, which may be a value. */
const BAD_NAME = "A secret name uses letters, digits and underscore, and does not start with a digit."

function asCliError(error: unknown): never {
  if (error instanceof CoreError) {
    const messages: Partial<Record<CoreError["code"], string>> = {
      invalid_name: BAD_NAME,
      invalid_value: "That value is not valid text.",
      too_large: "That value is larger than the 64 KiB limit.",
    }
    throw new CliError(messages[error.code] ?? `That could not be done (${error.code}).`)
  }
  throw error
}

/** A secret about to be set, checked as far as it can be before its value is asked for. */
export type SecretPlan = { team: Team; server: Server; app: string; name: string; secrets: SecretStore }

/** The result of setting or removing a secret. It takes effect on the next deploy. */
export type SecretChange = { name: string; version: number; app: string; server: string }

/** Said when `zekno secret set` or `zekno secret rm` is not given a name. */
export const sayWhichSecret = (command: "set" | "rm"): string => `Say which secret: \`zekno secret ${command} <NAME> ...\`.`

/**
 * The name `zekno secret set` stores a value under: given, held to the name
 * rule and not reserved. At a terminal it is checked before any question
 * (specs/006-cli-small-features, research R1); otherwise `prepareSecretSet`
 * checks it once it found where the secret goes, as it always has.
 */
export function checkSecretName(name: string | undefined): string {
  if (!name) throw new UsageError(sayWhichSecret("set"))
  // Checked now, as the core library will check it, so `NAME=value` is refused before a prompt repeats it and asks for more.
  if (!SECRET_NAME.test(name) || name.length > LIMITS.secretNameLength) throw new CliError(BAD_NAME)
  if (isReservedSecretName(name)) {
    throw new CliError(`"${name}" is reserved: the runner uses it to start Docker. Choose another name.`)
  }
  return name
}

/** Checks where a secret goes and its name, before anyone is asked for its value. */
export async function prepareSecretSet(deps: OpDeps, name: string | undefined, where: Where): Promise<SecretPlan> {
  const { team, server, app, secrets } = await locate(deps, where)
  return { team, server, app, name: checkSecretName(name), secrets }
}

/** Seals and signs a value and keeps the record. The value goes nowhere else. */
export async function setSecret(plan: SecretPlan, value: string): Promise<SecretChange> {
  const { team, server, app, name, secrets } = plan
  const { trust } = team
  // Enter pressed by accident, or an empty pipe, is not a value someone meant to store.
  if (value === "") throw new CliError("No value was given, so nothing was set.")
  const version = latestVersion(trust, server.serverId, app, secrets, name) + 1
  const record = await team
    .withSigner((signer) => createSecret({ trust, serverId: server.serverId, app, name, value, version, signer }))
    .catch(asCliError)
  team.store.saveSecrets(server.serverId, app, { ...secrets, records: [...secrets.records, record] })
  return { name, version, app, server: server.name }
}

/** One value an import stores: its name, its value and the version it gets. `replaces`: the app has a current secret of that name. */
export type ImportValue = { name: string; value: string; version: number; replaces: boolean }

/** A name an import leaves out, as its summary shows it (`shown`), and why (`reason`). */
export type LeftOut = { shown: string; reason: string }

/**
 * An import checked as far as it can be before anything is sealed
 * (specs/006-cli-small-features, data-model.md, "Import entry and import
 * summary"): where the values go, the store as it was read, each value to
 * store in the file's order with its next version, and the names left out.
 * The values are held here in memory for the run, and go to `storeSecrets`
 * and nowhere else.
 */
export type ImportPlan = { team: Team; server: Server; app: string; secrets: SecretStore; values: ImportValue[]; leftOut: LeftOut[] }

/** I12: more values than one deploy carries. `file` as typed, cleaned. Needs approval (research Q4). */
export const importTooMany = (file: string): string => `${file} has more than ${LIMITS.secretsPerDeploy} values, more than one deploy carries. Nothing was stored.`
/** I13: the app would have more secrets than one deploy carries. Needs approval (research Q4). */
export const importTooManySecrets = (app: string, server: string): string =>
  `${app} on ${server} would have more than ${LIMITS.secretsPerDeploy} secrets, more than one deploy carries. Nothing was stored.`
/** I14: the app's records on this machine would pass the limit past which none of them is read. Needs approval (research Q4). */
export const importTooManyRecords = (app: string, server: string): string =>
  `${app} on ${server} would have more than ${LIMITS.secretHistory} secret records on this machine. Nothing was stored.`

/**
 * Why an entry of an import file is left out, or undefined when it can be
 * stored: the rule `zekno secret set` holds a name to, and the value it
 * accepts. Only a reserved name is shown as written: it is a name zekno keeps,
 * not a piece of a value. Every other entry left out is shown by its line
 * only (security review S1): a key that is too long or does not fit the name
 * rule, or whose value is empty or too large, may be the last piece of a
 * value wrapped onto its own line, and a key is never shown in its place.
 */
function leftOut(entry: ImportEntry): LeftOut | undefined {
  const line = `line ${entry.line}`
  if (entry.name.length > LIMITS.secretNameLength) return { shown: line, reason: `a name longer than ${LIMITS.secretNameLength} characters` }
  if (!SECRET_NAME.test(entry.name)) return { shown: line, reason: "not a valid name" }
  if (isReservedSecretName(entry.name)) return { shown: entry.name, reason: "zekno keeps this name" }
  if (entry.value === "") return { shown: line, reason: "empty" }
  if (Buffer.byteLength(entry.value, "utf8") > LIMITS.secretValueBytes) return { shown: line, reason: "larger than 64 KiB" }
  return undefined
}

/**
 * Groups the entries of an import file and checks the limits, before
 * anything is sealed (contracts/import.md, "Names" and "Limits"). `file` is
 * the file as typed, cleaned, for I12. The store is not written.
 */
export async function prepareSecretImport(deps: OpDeps, where: Where, entries: readonly ImportEntry[], file: string): Promise<ImportPlan> {
  const { team, trust, server, app, secrets } = await locate(deps, where)
  const accepted: ImportEntry[] = []
  const out: LeftOut[] = []
  for (const entry of entries) {
    const why = leftOut(entry)
    if (why) out.push(why)
    else accepted.push(entry)
  }
  if (accepted.length > LIMITS.secretsPerDeploy) throw new CliError(importTooMany(file))
  // Counted before anything is verified: past this limit `currentSecrets` would refuse the store whole.
  if (secrets.records.length + secrets.removals.length + accepted.length > LIMITS.secretHistory) throw new CliError(importTooManyRecords(app, server.name))
  const current = new Set(currentSecrets({ trust, serverId: server.serverId, app, ...secrets }).secrets.map((record) => record.sealed.name))
  const fresh = accepted.filter((entry) => !current.has(entry.name)).length
  if (current.size + fresh > LIMITS.secretsPerDeploy) throw new CliError(importTooManySecrets(app, server.name))
  const latest = latestVersions(trust, server.serverId, app, secrets)
  const values = accepted.map((entry) => ({
    name: entry.name,
    value: entry.value,
    version: (latest.get(entry.name) ?? 0) + 1,
    replaces: current.has(entry.name),
  }))
  return { team, server, app, secrets, values, leftOut: out }
}

/**
 * Stores every value of an import, or none (FR-019, research R9): each is
 * sealed and signed inside one `withSigner`, as `setSecret` seals one, and
 * only then is the app's store written once, with every new record appended.
 * A failure while sealing writes nothing; a failed write leaves the old file
 * and removes its temporary one (`profileStore`'s write); the one rename
 * makes all of them visible at once.
 */
export async function storeSecrets(plan: ImportPlan): Promise<SecretChange[]> {
  const { team, server, app, secrets, values } = plan
  if (values.length === 0) return []
  const { trust } = team
  const made = await team
    .withSigner(async (signer) => {
      const records: SecretRecord[] = []
      for (const entry of values) {
        records.push(await createSecret({ trust, serverId: server.serverId, app, name: entry.name, value: entry.value, version: entry.version, signer }))
      }
      return records
    })
    .catch(asCliError)
  team.store.saveSecrets(server.serverId, app, { ...secrets, records: [...secrets.records, ...made] })
  return values.map((entry) => ({ name: entry.name, version: entry.version, app, server: server.name }))
}

/** Signs the removal of a secret the app has now. */
export async function removeSecret(deps: OpDeps, name: string | undefined, where: Where): Promise<SecretChange> {
  const { team, trust, server, app, secrets } = await locate(deps, where)
  if (!name) throw new UsageError(sayWhichSecret("rm"))
  const current = currentSecrets({ trust, serverId: server.serverId, app, ...secrets })
  if (!current.secrets.some((record) => record.sealed.name === name)) {
    throw new CliError(`${app} on ${server.name} has no secret named ${name}.`)
  }
  const version = latestVersion(trust, server.serverId, app, secrets, name) + 1
  const removal = await team
    .withSigner((signer) => createSecretRemoval({ trust, serverId: server.serverId, app, name, version, signer }))
    .catch(asCliError)
  team.store.saveSecrets(server.serverId, app, { ...secrets, removals: [...secrets.removals, removal] })
  return { name, version, app, server: server.name }
}

/**
 * The secrets the latest deploy the runner accepted carries, by name and
 * version, from this machine's history; undefined when there is none. Only a
 * deploy signed for this team, server and app counts, read from under its
 * signature, as the app screen reads the history (shared/views.ts). A history
 * that cannot be read counts as no deploy: this only adds a note to a list.
 */
function deployedSecrets(team: Team, server: Server, app: string): Map<string, number> | undefined {
  let history
  try {
    history = team.store.history(server.serverId, app)
  } catch {
    return undefined
  }
  let latest: { sequence: number; secrets: readonly { name: string; version: number }[] } | undefined
  for (const entry of history) {
    if (entry.outcome === "sent") continue
    const read = readSignedDeploy({ envelope: entry.envelope, trust: team.trust })
    const deploy = read.ok ? read.value.deploy : undefined
    if (deploy?.teamId !== team.trust.teamId || deploy.serverId !== server.serverId || deploy.app !== app) continue
    if (!latest || deploy.sequence >= latest.sequence) latest = deploy
  }
  return latest && new Map(latest.secrets.map((secret) => [secret.name, secret.version]))
}

/** One secret of an app now. `notDeployed`: set after the latest deploy the runner accepted, so that deploy does not carry this version. */
export type ListedSecret = { name: string; version: number; notDeployed: boolean }

/** The secrets an app has now: names and versions only. Nothing here ever holds a value. */
export async function listSecrets(deps: OpDeps, where: Where): Promise<{ app: string; server: string; secrets: ListedSecret[] }> {
  const { team, trust, server, app, secrets } = await locate(deps, where)
  const current = currentSecrets({ trust, serverId: server.serverId, app, ...secrets })
  const deployed = deployedSecrets(team, server, app)
  const listed: ListedSecret[] = []
  for (const record of current.secrets) {
    const checked = verifySecret({ record, trust, serverId: server.serverId, app })
    if (!checked.ok) continue
    const { name, version } = checked.value
    const carried = deployed?.get(name)
    listed.push({ name, version, notDeployed: deployed !== undefined && (carried === undefined || carried < version) })
  }
  return { app, server: server.name, secrets: listed }
}
