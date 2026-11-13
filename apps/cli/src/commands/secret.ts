import {
  CoreError,
  createSecret,
  createSecretRemoval,
  currentSecrets,
  isReservedSecretName,
  verifySecret,
  verifySecretRemoval,
  type TeamTrust,
} from "@workspace/core"

import { openTeam, type Deps } from "../context"
import { CliError, UsageError } from "../errors"
import { findServer, NAME, type SecretStore } from "../profile"

type Where = { app?: string; server?: string }

async function locate(deps: Deps, where: Where) {
  const team = await openTeam(deps)
  const server = findServer(team.profile, where.server)
  if (!where.app || !NAME.test(where.app)) {
    throw new UsageError("Say which app with `--app <name>`: lowercase letters, digits and hyphens.")
  }
  return { team, trust: team.trust, server, app: where.app, secrets: team.store.secrets(server.serverId, where.app) }
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

export async function secretSet(deps: Deps, name: string | undefined, options: Where & { stdin?: boolean }): Promise<void> {
  const { team, trust, server, app, secrets } = await locate(deps, options)
  if (!name) throw new UsageError("Say which secret: `zekno secret set <NAME> ...`.")
  if (isReservedSecretName(name)) {
    throw new CliError(`"${name}" is reserved: the runner uses it to start Docker. Choose another name.`)
  }
  const value = await deps.ui.askSecret(`Value for ${name}: `, options.stdin === true)
  // Enter pressed by accident, or an empty pipe, is not a value someone meant to store.
  if (value === "") throw new CliError("No value was given, so nothing was set.")
  const version = latestVersion(trust, server.serverId, app, secrets, name) + 1
  const record = await team
    .withSigner((signer) => createSecret({ trust, serverId: server.serverId, app, name, value, version, signer }))
    .catch(asCliError)
  team.store.saveSecrets(server.serverId, app, { ...secrets, records: [...secrets.records, record] })
  deps.ui.success(`Set ${name} (version ${version}) for ${app} on ${server.name}. It takes effect on the next deploy.`)
}

export async function secretRemove(deps: Deps, name: string | undefined, options: Where): Promise<void> {
  const { team, trust, server, app, secrets } = await locate(deps, options)
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
  deps.ui.success(`Removed ${name} from ${app} on ${server.name}. It takes effect on the next deploy.`)
}

/** Names and versions only. There is no command that shows a value. */
export async function secretList(deps: Deps, options: Where): Promise<void> {
  const { trust, server, app, secrets } = await locate(deps, options)
  const current = currentSecrets({ trust, serverId: server.serverId, app, ...secrets })
  if (current.secrets.length === 0) return deps.ui.info(`${app} on ${server.name} has no secrets.`)
  const rows: string[][] = []
  for (const record of current.secrets) {
    const checked = verifySecret({ record, trust, serverId: server.serverId, app })
    if (checked.ok) rows.push([checked.value.name, `version ${checked.value.version}`])
  }
  deps.ui.table(rows)
}
