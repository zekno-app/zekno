import type { Deps } from "../context"
import { listSecrets, prepareSecretSet, removeSecret, setSecret, type Where } from "../ops/secret"
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
