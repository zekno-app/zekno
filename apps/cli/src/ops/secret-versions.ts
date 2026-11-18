/**
 * The version a secret of an app gets next on this machine, and whether
 * `zekno secret rm` knows the name. Both commands work offline and never
 * connect (specs/014-deploy-v2, decision B; contracts/cli.md CL18, CL19;
 * research R9).
 *
 * Today's rule counts only records and removals that verify for this team,
 * server and app (`latestVersion`). Feature 014 adds floors: this machine's
 * records of the name that do not verify, and what the server said it holds
 * for the app at the last version-2 deploy (`held/`). A floor only raises the
 * next version, so a deploy is never refused for going back; it is never a
 * hash, and never decides what a deploy lists.
 */
import {
  currentSecrets,
  peekSecretStatement,
  verifySecret,
  verifySecretRemoval,
  type TeamTrust,
} from "@workspace/core"

import type { Held, SecretStore } from "../profile/profile"

/** The highest version this machine has seen for each name, set or removed: `latestVersion` for every name at once, in one pass. */
export function latestVersions(
  trust: TeamTrust,
  serverId: string,
  app: string,
  held: SecretStore
): Map<string, number> {
  const latest = new Map<string, number>()
  const seen = (name: string, version: number) =>
    latest.set(name, Math.max(latest.get(name) ?? 0, version))
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
export function latestVersion(
  trust: TeamTrust,
  serverId: string,
  app: string,
  held: SecretStore,
  name: string
): number {
  let latest = 0
  for (const record of held.records) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (checked.ok && checked.value.name === name)
      latest = Math.max(latest, checked.value.version)
  }
  for (const removal of held.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (checked.ok && checked.value.name === name)
      latest = Math.max(latest, checked.value.version)
  }
  return latest
}

/**
 * The versions this machine knows of `name` without trusting them, read
 * with `peekSecretStatement`: its records of the name that do not verify (a
 * removed member's, say), and the statements `held/` remembers.
 */
function claimed(
  where: { trust: TeamTrust; serverId: string; app: string },
  store: SecretStore,
  held: Held,
  name: string
): number[] {
  const versions: number[] = []
  for (const record of store.records) {
    if (verifySecret({ record, ...where }).ok) continue
    const peek = peekSecretStatement(record.envelope)
    if (peek?.name === name) versions.push(peek.version)
  }
  for (const envelope of held.statements) {
    const peek = peekSecretStatement(envelope)
    if (peek?.name === name) versions.push(peek.version)
  }
  return versions
}

/**
 * CL18: the highest version of `name` this machine holds or remembers, the
 * next being one above it. Today's `latestVersion`; this machine's records of
 * the name that do not verify; the statements of the name in `held/`; and
 * `held/`'s version of the name, removed or not.
 */
export function floorVersion(
  trust: TeamTrust,
  serverId: string,
  app: string,
  store: SecretStore,
  held: Held,
  name: string
): number {
  return Math.max(
    latestVersion(trust, serverId, app, store, name),
    ...claimed({ trust, serverId, app }, store, held, name),
    ...held.versions
      .filter((entry) => entry.name === name)
      .map((entry) => entry.version)
  )
}

/**
 * CL19: whether `zekno secret rm` signs the removal of `name`: this machine
 * holds a current secret of the name (today's rule), or a record of it that
 * does not verify, or `held/` names it (a statement, or a version not
 * removed). What does not verify, and what `held/` says, count only above
 * the highest version this machine holds verified for the name: `held/` is
 * the server as the last version-2 deploy read it, before that deploy ran,
 * so after a deploy that carried this machine's removal it still names the
 * secret as live, and removing it again is refused, as it was before
 * feature 014.
 */
export function remembersName(
  trust: TeamTrust,
  serverId: string,
  app: string,
  store: SecretStore,
  held: Held,
  name: string
): boolean {
  const current = currentSecrets({ trust, serverId, app, ...store })
  if (current.secrets.some((record) => record.sealed.name === name)) return true
  const here = latestVersion(trust, serverId, app, store, name)
  return (
    claimed({ trust, serverId, app }, store, held, name).some(
      (version) => version > here
    ) ||
    held.versions.some(
      (entry) => entry.name === name && !entry.removed && entry.version > here
    )
  )
}
