/**
 * What a deploy lists, what it supplies, and which secret stops it
 * (contracts/cli.md CL12 to CL17; data-model.md, "What a deploy lists";
 * research R7 and R8). One function for both message formats, so a later
 * client (CI) lists secrets exactly as the CLI does.
 *
 * Versions and hashes come only from items that verify against the team list
 * held now (FR-021). What the runner reports as live (`status`) and what an
 * item that does not verify claims are read only to stop a deploy, never to
 * choose what is signed.
 */
import { z } from "zod"

import type { Envelope } from "../crypto/envelope"
import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import { assertTrust, type TeamTrust } from "../team/roster"
import {
  SecretRecordSchema,
  verifySecret,
  verifySecretRemoval,
  type IgnoredSecret,
  type SecretRecord,
} from "./secret-record"
import { secretName } from "./secrets"
import {
  peekSecretStatement,
  secretVersion,
  verifySecretStatement,
} from "./statement"

/** A name that stops the deploy: C4 (`former_member`) or C5 (`cannot_check`). */
export type BlockedSecret = {
  readonly name: string
  readonly why: "former_member" | "cannot_check"
}

const LiveSchema = z
  .array(z.strictObject({ name: secretName, version: secretVersion }))
  .max(LIMITS.secretsPerServer)

type Candidate =
  | {
      kind: "record"
      version: number
      hash: string
      envelope: Envelope
      record: SecretRecord
    }
  | { kind: "statement"; version: number; hash: string; envelope: Envelope }
  | { kind: "removal"; version: number; hash: null; envelope: Envelope }

/** An item that did not verify, with what it claims when its signer was a member of an earlier team list. */
type Failure = {
  kind: IgnoredSecret["kind"]
  reason: IgnoredSecret["reason"]
  former?: { name: string; version: number }
}

/**
 * Works out what a deploy of one app lists, from this machine's records and
 * removals and, for version 2, the statements the runner holds (`held`).
 *
 * - **Listed** (CL12, CL13): per name, the verified item of the highest
 *   version; two different items at that version are a conflict and the name
 *   is left out.
 * - **Supplied** (CL14): version 2, this machine's chosen records the runner
 *   holds no statement of; version 1, every chosen record.
 * - **Blocked, C4** (CL15, both formats): an item of the name that fails as
 *   `unknown_signer`, signed by a key of `former` (members of an earlier team
 *   list the current one lacks), at or above the newest verified version, or
 *   with none.
 * - **Blocked, C5** (CL16, version 2 only): a name `live` says the runner
 *   holds, with no chosen item or one below the version it reports.
 * - **Ignored** (CL17): everything else that was left out, as
 *   `currentSecrets` reports it.
 *
 * With version 1 and no runner statements the result is `currentSecrets`'s.
 */
export function secretsForDeploy(input: {
  trust: TeamTrust
  serverId: string
  app: string
  records: readonly unknown[]
  removals: readonly unknown[]
  held: readonly unknown[]
  live: readonly { name: string; version: number }[]
  former: readonly string[]
  format: 1 | 2
}): {
  statements: Envelope[]
  removals: Envelope[]
  supply: SecretRecord[]
  blocked: BlockedSecret[]
  ignored: IgnoredSecret[]
} {
  assertTrust(input.trust)
  if (
    !Array.isArray(input.records) ||
    !Array.isArray(input.removals) ||
    input.records.length + input.removals.length > LIMITS.secretHistory ||
    !Array.isArray(input.held) ||
    input.held.length > LIMITS.secretsPerDeploy
  ) {
    throw new CoreError(
      "too_large",
      "There are more secret records and removals than the limit."
    )
  }
  const live = LiveSchema.safeParse(input.live)
  if (
    (input.format !== 1 && input.format !== 2) ||
    (input.format === 1 && input.held.length > 0) ||
    !live.success ||
    !Array.isArray(input.former) ||
    !input.former.every((keyId) => typeof keyId === "string")
  ) {
    throw new CoreError(
      "invalid_argument",
      "The format, the runner's statements, the live secrets or the former members are not valid."
    )
  }
  const { trust, serverId, app } = input
  const former = new Set(input.former)
  const failures: Failure[] = []
  const byName = new Map<string, Candidate[]>()
  const add = (name: string, candidate: Candidate) => {
    const list = byName.get(name)
    if (list) list.push(candidate)
    else byName.set(name, [candidate])
  }
  /** What a statement that failed as `unknown_signer` claims, when a former member signed it. */
  const byFormer = (envelope: unknown, reason: string) => {
    if (reason !== "unknown_signer") return undefined
    const peek = peekSecretStatement(envelope)
    return peek && former.has(peek.keyId)
      ? { name: peek.name, version: peek.version }
      : undefined
  }

  // CL12. Candidates: what verifies for this team, server and app, against the current list.
  for (const record of input.records) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (!checked.ok) {
      const envelope = (record as { envelope?: unknown } | null)?.envelope
      failures.push({
        kind: "record",
        reason: checked.error.code,
        former: byFormer(envelope, checked.error.code),
      })
      continue
    }
    const parsed = SecretRecordSchema.parse(record)
    add(checked.value.name, {
      kind: "record",
      version: checked.value.version,
      hash: checked.value.hash,
      envelope: parsed.envelope,
      record: parsed,
    })
  }
  for (const removal of input.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (!checked.ok) {
      failures.push({ kind: "removal", reason: checked.error.code })
      continue
    }
    add(checked.value.name, {
      kind: "removal",
      version: checked.value.version,
      hash: null,
      envelope: checked.value.envelope,
    })
  }
  for (const envelope of input.held) {
    const checked = verifySecretStatement({ envelope, trust, serverId, app })
    if (!checked.ok) {
      failures.push({
        kind: "record",
        reason: checked.error.code,
        former: byFormer(envelope, checked.error.code),
      })
      continue
    }
    add(checked.value.name, {
      kind: "statement",
      version: checked.value.version,
      hash: checked.value.hash,
      envelope: checked.value.envelope,
    })
  }

  const liveVersion = new Map(
    input.format === 2
      ? live.data.map((entry) => [entry.name, entry.version] as const)
      : []
  )
  const names = new Set([...byName.keys(), ...liveVersion.keys()])
  for (const failure of failures)
    if (failure.former) names.add(failure.former.name)

  const statements: Envelope[] = []
  const removals: Envelope[] = []
  const supply: SecretRecord[] = []
  const blocked: BlockedSecret[] = []
  const conflicts: IgnoredSecret[] = []
  const blocking = new Set<Failure>()
  for (const name of [...names].sort()) {
    const candidates = byName.get(name) ?? []
    const newest = candidates.length
      ? Math.max(...candidates.map((candidate) => candidate.version))
      : undefined
    const top = candidates.filter((candidate) => candidate.version === newest)
    // The same secret delivered twice, or held by the runner too, is one item. Two different ones at one version are not.
    const distinct = new Set(
      top.map((candidate) => candidate.hash ?? "removal")
    )
    const chosen =
      distinct.size === 1
        ? (top.find((candidate) => candidate.kind === "record") ?? top[0])
        : undefined

    // CL15. C4: a removed member's statement that is the newest of its name.
    const fromFormer = failures.filter(
      (failure) =>
        failure.former?.name === name &&
        (newest === undefined || failure.former.version >= newest)
    )
    if (fromFormer.length > 0) {
      for (const failure of fromFormer) blocking.add(failure)
      blocked.push({ name, why: "former_member" })
      continue
    }
    // CL16. C5: a secret the runner holds that this machine cannot list at its version.
    const reported = liveVersion.get(name)
    if (
      reported !== undefined &&
      (chosen === undefined || chosen.version < reported)
    ) {
      blocked.push({ name, why: "cannot_check" })
      continue
    }
    if (distinct.size > 1) {
      conflicts.push({
        kind: top[0]!.kind === "removal" ? "removal" : "record",
        name,
        reason: "conflict",
      })
      continue
    }
    if (!chosen) continue

    // CL13, CL14. Listed, and supplied when the runner lacks it.
    if (chosen.kind === "removal") {
      removals.push(chosen.envelope)
      continue
    }
    statements.push(chosen.envelope)
    if (chosen.kind !== "record") continue
    const runnerHasIt = candidates.some(
      (candidate) =>
        candidate.kind === "statement" &&
        candidate.version === chosen.version &&
        candidate.hash === chosen.hash
    )
    if (input.format === 1 || !runnerHasIt) supply.push(chosen.record)
  }

  // CL17. Everything else left out, as `currentSecrets` reports it.
  const ignored: IgnoredSecret[] = [
    ...failures
      .filter((failure) => !blocking.has(failure))
      .map(({ kind, reason }) => ({ kind, reason })),
    ...conflicts,
  ]
  return { statements, removals, supply, blocked, ignored }
}
