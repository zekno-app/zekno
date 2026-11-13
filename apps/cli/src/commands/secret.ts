import type { Deps } from "../context"
import { listSecrets, prepareSecretSet, removeSecret, setSecret, type Where } from "../ops/secret"

export async function secretSet(deps: Deps, name: string | undefined, options: Where & { stdin?: boolean }): Promise<void> {
  const plan = await prepareSecretSet(deps, name, options)
  const value = await deps.ui.askSecret(`Value for ${plan.name}: `, options.stdin === true)
  const set = await setSecret(plan, value)
  deps.ui.success(`Set ${set.name} (version ${set.version}) for ${set.app} on ${set.server}. It takes effect on the next deploy.`)
}

export async function secretRemove(deps: Deps, name: string | undefined, options: Where): Promise<void> {
  const removed = await removeSecret(deps, name, options)
  deps.ui.success(`Removed ${removed.name} from ${removed.app} on ${removed.server}. It takes effect on the next deploy.`)
}

/** Names and versions only. There is no command that shows a value. */
export async function secretList(deps: Deps, options: Where): Promise<void> {
  const { app, server, secrets } = await listSecrets(deps, options)
  if (secrets.length === 0) return deps.ui.info(`${app} on ${server} has no secrets.`)
  deps.ui.table(secrets.map((secret) => [secret.name, `version ${secret.version}`]))
}
