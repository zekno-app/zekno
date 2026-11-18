/**
 * The secrets of a version-2 deploy as the runner checks them: K11 to K14 of
 * contracts/runner-checks.md, with "The record of one listed secret", and the
 * secret part of the state the deploy leaves. The design's part 4.5 is the
 * source: every live secret is listed, none goes back, and each listed
 * secret's record is supplied with the deploy, or held by the runner with
 * every field of its statement equal to the listing, and verified now.
 */
import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { ok, refuse, type Result } from "../protocol/result"
import {
  SecretRecordSchema,
  verifySecret,
  type SecretRecord,
} from "../secrets/secret-record"
import type { SealedSecret } from "../secrets/secrets"
import { readStatementUnchecked } from "../secrets/statement"
import type { DeployV2 } from "./message"
import type { StoredRunnerState } from "./state"

const SuppliedSchema = z.array(SecretRecordSchema).max(LIMITS.secretsPerDeploy)

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

/** What the secrets of an accepted deploy give the runner. */
export type ListedSecrets = {
  /** The sealed value of each listed secret, in name order, for `openSecrets` alone. */
  readonly sealed: readonly SealedSecret[]
  /** The supplied records, each listed and verified, in name order. */
  readonly write: readonly SecretRecord[]
  /** Every secret entry of the state after the deploy. */
  readonly secrets: StoredRunnerState["secrets"]
  /** The hashes of every live secret of the app after the deploy, sorted. */
  readonly keep: readonly string[]
}

/**
 * K11 to K14, in their order; the first that fails is the answer. `held`
 * gives the record the runner keeps as `records/<app>/<hash>.json`, or
 * undefined; one that throws counts as nothing held.
 */
export function checkListedSecrets(input: {
  deploy: DeployV2
  state: StoredRunnerState
  records: unknown
  held: (app: string, hash: string) => unknown
}): Result<
  ListedSecrets,
  | "secrets_mismatch"
  | "stale_secret"
  | "untrusted_secret"
  | "secret_missing"
  | "too_large"
> {
  const { deploy, state } = input
  const app = deploy.app
  const prefix = `${app}/`

  // K11. Every live secret of the app is listed, or removed: leaving one out takes a removal.
  const listed = new Set(
    [...deploy.secrets, ...deploy.removed].map((entry) => entry.name)
  )
  for (const [key, entry] of Object.entries(state.secrets)) {
    if (
      key.startsWith(prefix) &&
      entry.hash !== null &&
      !listed.has(key.slice(prefix.length))
    ) {
      return refuse(
        "secrets_mismatch",
        "The deploy does not account for every secret this server holds for the app."
      )
    }
  }

  // K12. No secret goes back: not below the version held, nor to another value at it.
  //      A removal counts as a version too, so a retired secret stays retired.
  const entries = [
    ...deploy.secrets.map(({ name, version, hash }) => ({
      name,
      version,
      hash: hash as string | null,
    })),
    ...deploy.removed.map(({ name, version }) => ({
      name,
      version,
      hash: null,
    })),
  ].sort(byName)
  for (const entry of entries) {
    const key = `${app}/${entry.name}`
    const known = Object.hasOwn(state.secrets, key)
      ? state.secrets[key]
      : undefined
    if (
      known &&
      (entry.version < known.version ||
        (entry.version === known.version && entry.hash !== known.hash))
    ) {
      return refuse(
        "stale_secret",
        "This deploy carries an older version of a secret than one already accepted."
      )
    }
  }

  // K13. The record of each listed secret, in name order: supplied, or held under its hash.
  const supplied = SuppliedSchema.safeParse(input.records)
  if (!supplied.success) {
    return refuse(
      "secrets_mismatch",
      "The records sent with the deploy are not a list of secret records within the limit."
    )
  }
  const check = (record: unknown) =>
    verifySecret({ record, trust: state.team, serverId: state.serverId, app })
  const sealed: SealedSecret[] = []
  const write: SecretRecord[] = []
  for (const listing of deploy.secrets) {
    const given = supplied.data.filter(
      (record) => record.sealed.name === listing.name
    )
    if (given.length > 1) {
      return refuse(
        "secrets_mismatch",
        "More than one record was sent for one secret."
      )
    }
    if (given.length === 1) {
      // Supplied: no longer than a statement is, so nothing padded is kept and handed out at `records`.
      if (given[0]!.envelope.payload.length > LIMITS.statementPayloadLength) {
        return refuse(
          "too_large",
          "A secret sent with the deploy has a statement longer than a statement may be."
        )
      }
      // It must verify against the team list held now, and be the listed version and hash.
      const checked = check(given[0])
      if (!checked.ok) {
        return refuse(
          "untrusted_secret",
          `A secret sent with the deploy was not set by a current team member for this server and app (${checked.error.code}).`
        )
      }
      if (
        checked.value.version !== listing.version ||
        checked.value.hash !== listing.hash
      ) {
        return refuse(
          "secrets_mismatch",
          "A secret sent with the deploy is not the version the deploy lists."
        )
      }
      sealed.push(checked.value.sealed)
      write.push(given[0]!)
      continue
    }
    // Held: every field of its statement equal to the listing, then verified again now.
    let kept: unknown
    try {
      kept = input.held(app, listing.hash)
    } catch {
      kept = undefined
    }
    const record = SecretRecordSchema.safeParse(kept)
    const claimed = record.success
      ? readStatementUnchecked(record.data.envelope)
      : undefined
    if (
      !record.success ||
      claimed?.teamId !== state.team.teamId ||
      claimed.serverId !== state.serverId ||
      claimed.app !== app ||
      claimed.name !== listing.name ||
      claimed.version !== listing.version ||
      claimed.hash !== listing.hash
    ) {
      return refuse(
        "secret_missing",
        "This server does not hold a secret the deploy lists, and it was not sent with it."
      )
    }
    const checked = check(record.data)
    if (!checked.ok) {
      return refuse(
        "untrusted_secret",
        `A secret this server holds no longer counts (${checked.error.code}).`
      )
    }
    sealed.push(checked.value.sealed)
  }

  // K14. What is supplied is exactly what is needed: each record names a listed secret, once.
  const secretNames = new Set(deploy.secrets.map((secret) => secret.name))
  if (
    supplied.data.some((record) => !secretNames.has(record.sealed.name)) ||
    write.length !== supplied.data.length
  ) {
    return refuse(
      "secrets_mismatch",
      "A record was sent with the deploy for a secret it does not list."
    )
  }

  // The secret entries after the deploy, and the record files they name.
  const secrets: Record<string, { version: number; hash: string | null }> = {
    ...state.secrets,
  }
  for (const entry of entries)
    secrets[`${app}/${entry.name}`] = Object.freeze({
      version: entry.version,
      hash: entry.hash,
    })
  const keep = new Set<string>()
  for (const [key, entry] of Object.entries(secrets))
    if (key.startsWith(prefix) && entry.hash !== null) keep.add(entry.hash)
  return ok({
    sealed: Object.freeze(sealed),
    write: Object.freeze(write),
    secrets: Object.freeze(secrets),
    keep: Object.freeze([...keep].sort()),
  })
}
