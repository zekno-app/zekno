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
 * hash, and never decides what a deploy lists. A floor nobody verified counts
 * only within `MAX_CLAIMED_AHEAD` of what verifies here.
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
 * How far above the highest version of a name that verifies on this machine
 * (0 when none) a version only an unverified source gives may count: `held/`
 * (what a server said, or what anyone who can write the profile folder wrote)
 * and this machine's records that do not verify. A claim beyond it is
 * ignored, as if it were not there. Without a bound, one number in `held/` or
 * in a lying server's answer would make the next `zekno secret set` sign
 * 2^53 - 1, after which the honest server could never take another version
 * of the name, set or removed (security review S1). 1,000 is the bound
 * version 1 puts on a runner's word for deploy numbers (`MAX_AHEAD` in
 * deploy-send.ts): a source that far ahead is not one this machine has been
 * working with, and a real team does not set one secret a thousand times from
 * other machines between two of its own.
 */
export const MAX_CLAIMED_AHEAD = 1000

/**
 * The versions this machine knows of `name` without trusting them, read
 * with `peekSecretStatement`: its records of the name that do not verify (a
 * removed member's, say), and the statements `held/` remembers. Only those
 * at most `MAX_CLAIMED_AHEAD` above `here`, the highest version of the name
 * that verifies on this machine.
 */
function claimed(
  where: { trust: TeamTrust; serverId: string; app: string },
  store: SecretStore,
  held: Held,
  name: string,
  here: number
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
  return versions.filter((version) => version <= here + MAX_CLAIMED_AHEAD)
}

/** `held/`'s entries of `name` from `status`, those at most `MAX_CLAIMED_AHEAD` above `here`. */
const remembered = (held: Held, name: string, here: number) =>
  held.versions.filter(
    (entry) => entry.name === name && entry.version <= here + MAX_CLAIMED_AHEAD
  )

/**
 * CL18: the highest version of `name` this machine holds or remembers, the
 * next being one above it. Today's `latestVersion`; this machine's records of
 * the name that do not verify; the statements of the name in `held/`; and
 * `held/`'s version of the name, removed or not; each of the last three only
 * within `MAX_CLAIMED_AHEAD` of the first.
 */
export function floorVersion(
  trust: TeamTrust,
  serverId: string,
  app: string,
  store: SecretStore,
  held: Held,
  name: string
): number {
  const here = latestVersion(trust, serverId, app, store, name)
  return Math.max(
    here,
    ...claimed({ trust, serverId, app }, store, held, name, here),
    ...remembered(held, name, here).map((entry) => entry.version)
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
 * feature 014. And they count only up to `MAX_CLAIMED_AHEAD` above it: a
 * name only a claim beyond that names is one this machine does not know.
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
    claimed({ trust, serverId, app }, store, held, name, here).some(
      (version) => version > here
    ) ||
    remembered(held, name, here).some(
      (entry) => !entry.removed && entry.version > here
    )
  )
}
