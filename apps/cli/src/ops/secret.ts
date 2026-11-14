import {
  CoreError,
  createSecret,
  createSecretRemoval,
  currentSecrets,
  isReservedSecretName,
  readSignedDeploy,
  verifySecret,
  verifySecretRemoval,
  type TeamTrust,
} from "@workspace/core"

import { openTeam, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer, type SecretStore, type Server } from "../profile"
import { checkApp, type Where } from "./deploy"

export type { Where }

async function locate(deps: OpDeps, where: Where) {
  const team = await openTeam(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  const app = checkApp(where.app)
  return { team, trust: team.trust, server, app, secrets: team.store.secrets(server.serverId, app) }
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

function asCliError(error: unknown): never {
  if (error instanceof CoreError) {
    const messages: Partial<Record<CoreError["code"], string>> = {
      invalid_name: "A secret name uses letters, digits and underscore, and does not start with a digit.",
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

/** Checks where a secret goes and its name, before anyone is asked for its value. */
export async function prepareSecretSet(deps: OpDeps, name: string | undefined, where: Where): Promise<SecretPlan> {
  const { team, server, app, secrets } = await locate(deps, where)
  if (!name) throw new UsageError("Say which secret: `zekno secret set <NAME> ...`.")
  if (isReservedSecretName(name)) {
    throw new CliError(`"${name}" is reserved: the runner uses it to start Docker. Choose another name.`)
  }
  return { team, server, app, name, secrets }
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

/** Signs the removal of a secret the app has now. */
export async function removeSecret(deps: OpDeps, name: string | undefined, where: Where): Promise<SecretChange> {
  const { team, trust, server, app, secrets } = await locate(deps, where)
  if (!name) throw new UsageError("Say which secret: `zekno secret rm <NAME> ...`.")
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
 * signature, as the app screen reads the history (app/views.ts). A history
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
