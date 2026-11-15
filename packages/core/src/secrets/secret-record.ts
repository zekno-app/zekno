import { z } from "zod"

import { utf8 } from "../crypto/encoding"
import {
  EnvelopeSchema,
  hasOtherVersion,
  openEnvelope,
  parseJson,
  PAYLOAD_TYPES,
  signEnvelope,
  type Envelope,
} from "../crypto/envelope"
import { LIMITS } from "../protocol/limits"
import type { Signer } from "../crypto/keys"
import { CoreError, ok, refuse, type Result, type SecretRefusal } from "../protocol/result"
import {
  assertTrust,
  isoTime,
  memberByKeyId,
  serverKeyOf,
  TEAM_ID,
  type Member,
  type TeamTrust,
} from "../team/roster"
import {
  APP_NAME,
  sealedSecretHash,
  SealedSecretSchema,
  sealSecret,
  secretName,
  SERVER_ID,
  type SealedSecret,
} from "./secrets"

export const secretVersion = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

const SecretStatementSchema = z.strictObject({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID),
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  name: secretName,
  version: secretVersion,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: isoTime,
})

/**
 * A sealed secret together with a team member's signed statement that they
 * set it. Anyone can encrypt to a server's public key, so the ciphertext
 * alone proves nothing about where it came from. The statement does: it lets
 * a client fetch secrets back from the control plane and know a teammate,
 * and not the control plane, produced them.
 */
export const SecretRecordSchema = z.strictObject({
  envelope: EnvelopeSchema,
  sealed: SealedSecretSchema,
})
export type SecretRecord = z.infer<typeof SecretRecordSchema>

/** A secret record that passed verification against the team list. */
export type VerifiedSecret = {
  readonly name: string
  /** Goes up each time the secret is set again. A runner never goes back to a lower one. */
  readonly version: number
  readonly hash: string
  /** The member who set it. */
  readonly signer: Member
  readonly sealed: SealedSecret
}

/**
 * Seals a secret for one of the team's servers and signs a statement that
 * binds the ciphertext to this team, server, app, name and version.
 *
 * The server is named by id and its key is taken from the admin-signed team
 * list. A key that only the control plane vouches for is never used.
 */
export async function createSecret(input: {
  trust: TeamTrust
  serverId: string
  app: string
  name: string
  value: string
  /** 1 for a new secret; one more than the current version when setting it again. */
  version: number
  signer: Signer
  now?: Date
}): Promise<SecretRecord> {
  assertTrust(input.trust)
  if (!input.trust.members.some((member) => member.publicKey === input.signer.publicKey)) {
    throw new CoreError("not_member", "The signer is not a member of this team.")
  }
  const serverPublicKey = serverKeyOf(input.trust, input.serverId)
  if (!serverPublicKey) {
    throw new CoreError("unknown_server", "This server is not in the team list. An admin adds it after confirming its code.")
  }
  if (!secretVersion.safeParse(input.version).success) {
    throw new CoreError("invalid_argument", "A secret version is a whole number of 1 or more.")
  }
  const sealed = sealSecret({ serverPublicKey, app: input.app, name: input.name, value: input.value })
  const statement = {
    v: 1 as const,
    teamId: input.trust.teamId,
    serverId: input.serverId,
    app: input.app,
    name: input.name,
    version: input.version,
    hash: sealedSecretHash(sealed)!,
    createdAt: (input.now ?? new Date()).toISOString(),
  }
  const envelope = await signEnvelope(PAYLOAD_TYPES.secret, utf8(JSON.stringify(statement)), input.signer)
  return { envelope, sealed }
}

/**
 * Checks a secret record that came from outside, typically from the control
 * plane: signed by a current team member, for this team, server and app, and
 * describing exactly this ciphertext under this name.
 */
export function verifySecret(input: {
  record: unknown
  trust: TeamTrust
  serverId: string
  app: string
}): Result<VerifiedSecret, SecretRefusal> {
  const record = SecretRecordSchema.safeParse(input.record)
  if (!record.success) {
    const read = openEnvelope(
      (input.record as { envelope?: unknown } | null)?.envelope,
      PAYLOAD_TYPES.secret,
      () => undefined
    )
    // Keep the more specific reason when the envelope alone explains the failure.
    if (!read.ok && (read.error.code === "too_large" || read.error.code === "wrong_payload_type")) return read
    return refuse("malformed", "Not a secret record.")
  }
  const opened = openEnvelope(
    record.data.envelope,
    PAYLOAD_TYPES.secret,
    (keyId) => memberByKeyId(input.trust.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const signer = input.trust.members.find((member) => member.publicKey === opened.value.signerKey)!

  const json = parseJson(opened.value.payload)
  if (json === undefined) return refuse("malformed", "The secret statement is not valid JSON.")
  if (hasOtherVersion(json)) {
    return refuse("unsupported_version", "This secret uses a format version this library does not know.")
  }
  const statement = SecretStatementSchema.safeParse(json)
  if (!statement.success) return refuse("malformed", "The secret statement does not match its definition.")

  if (statement.data.teamId !== input.trust.teamId) {
    return refuse("wrong_team", "This secret belongs to another team.")
  }
  if (statement.data.serverId !== input.serverId) {
    return refuse("wrong_server", "This secret was set for another server.")
  }
  if (statement.data.app !== input.app) {
    return refuse("wrong_app", "This secret was set for another app.")
  }
  if (
    statement.data.name !== record.data.sealed.name ||
    statement.data.hash !== sealedSecretHash(record.data.sealed)
  ) {
    return refuse("secrets_mismatch", "The encrypted value is not the one the statement describes.")
  }
  return ok(
    Object.freeze({
      name: statement.data.name,
      version: statement.data.version,
      hash: statement.data.hash,
      signer,
      sealed: record.data.sealed,
    })
  )
}

const RemovalStatementSchema = z.strictObject({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID),
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  name: secretName,
  version: secretVersion,
  createdAt: isoTime,
})

/** A removal that passed verification against the team list. */
export type VerifiedRemoval = {
  readonly name: string
  /** One more than the version of the secret being removed. */
  readonly version: number
  /** The member who removed it. */
  readonly signer: Member
  readonly envelope: Envelope
}

/**
 * A team member's signed statement that a secret is no longer in use. Without
 * it, the control plane could keep offering the old, genuinely signed record
 * of a secret the team retired. With it, clients leave the secret out, and a
 * server that has seen the removal refuses the old record for good.
 */
export async function createSecretRemoval(input: {
  trust: TeamTrust
  serverId: string
  app: string
  name: string
  /** One more than the current version of the secret. */
  version: number
  signer: Signer
  now?: Date
}): Promise<Envelope> {
  assertTrust(input.trust)
  if (!input.trust.members.some((member) => member.publicKey === input.signer.publicKey)) {
    throw new CoreError("not_member", "The signer is not a member of this team.")
  }
  if (!serverKeyOf(input.trust, input.serverId)) {
    throw new CoreError("unknown_server", "This server is not in the team list.")
  }
  const statement = {
    v: 1 as const,
    teamId: input.trust.teamId,
    serverId: input.serverId,
    app: input.app,
    name: input.name,
    version: input.version,
    createdAt: (input.now ?? new Date()).toISOString(),
  }
  if (!RemovalStatementSchema.safeParse(statement).success) {
    throw new CoreError("invalid_argument", "The app, secret name or version is not valid.")
  }
  return signEnvelope(PAYLOAD_TYPES.secretRemoval, utf8(JSON.stringify(statement)), input.signer)
}

/** Checks a removal that came from outside: signed by a current member, for this team, server and app. */
export function verifySecretRemoval(input: {
  removal: unknown
  trust: TeamTrust
  serverId: string
  app: string
}): Result<VerifiedRemoval, SecretRefusal> {
  const opened = openEnvelope(
    input.removal,
    PAYLOAD_TYPES.secretRemoval,
    (keyId) => memberByKeyId(input.trust.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const signer = input.trust.members.find((member) => member.publicKey === opened.value.signerKey)!

  const json = parseJson(opened.value.payload)
  if (json === undefined) return refuse("malformed", "The removal is not valid JSON.")
  if (hasOtherVersion(json)) {
    return refuse("unsupported_version", "This removal uses a format version this library does not know.")
  }
  const statement = RemovalStatementSchema.safeParse(json)
  if (!statement.success) return refuse("malformed", "The removal does not match its definition.")
  if (statement.data.teamId !== input.trust.teamId) return refuse("wrong_team", "This removal belongs to another team.")
  if (statement.data.serverId !== input.serverId) return refuse("wrong_server", "This removal is for another server.")
  if (statement.data.app !== input.app) return refuse("wrong_app", "This removal is for another app.")
  return ok(
    Object.freeze({
      name: statement.data.name,
      version: statement.data.version,
      signer,
      envelope: opened.value.envelope,
    })
  )
}

/** Why an item the control plane supplied was left out of an app's current secrets. */
export type IgnoredSecret = {
  readonly kind: "record" | "removal"
  /** Known only when the item itself was readable. */
  readonly name?: string
  /** A refusal code, or "conflict" when two different items claim the same version of a name. */
  readonly reason: SecretRefusal | "conflict"
}

/**
 * Works out an app's current secrets from everything the control plane holds
 * for it. Each item is verified; for each name the highest version wins; a
 * name whose highest version is a removal is left out, and the removal is
 * returned so the next deploy can carry it to the server.
 *
 * Pass `secrets` and `removals` straight to `createDeploy`, and show
 * `ignored` to the person deploying: it is where tampering shows up.
 */
export function currentSecrets(input: {
  trust: TeamTrust
  serverId: string
  app: string
  records: readonly unknown[]
  removals: readonly unknown[]
}): { secrets: SecretRecord[]; removals: Envelope[]; ignored: IgnoredSecret[] } {
  assertTrust(input.trust)
  if (
    !Array.isArray(input.records) ||
    !Array.isArray(input.removals) ||
    input.records.length + input.removals.length > LIMITS.secretHistory
  ) {
    throw new CoreError("too_large", "There are more secret records and removals than the limit.")
  }
  const { trust, serverId, app } = input
  const ignored: IgnoredSecret[] = []
  type Candidate =
    | { kind: "record"; version: number; hash: string; record: SecretRecord }
    | { kind: "removal"; version: number; hash: null; envelope: Envelope }
  const byName = new Map<string, Candidate[]>()
  const add = (name: string, candidate: Candidate) => {
    const list = byName.get(name)
    if (list) list.push(candidate)
    else byName.set(name, [candidate])
  }

  for (const record of input.records) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (!checked.ok) {
      ignored.push({ kind: "record", reason: checked.error.code })
      continue
    }
    add(checked.value.name, {
      kind: "record",
      version: checked.value.version,
      hash: checked.value.hash,
      record: SecretRecordSchema.parse(record),
    })
  }
  for (const removal of input.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (!checked.ok) {
      ignored.push({ kind: "removal", reason: checked.error.code })
      continue
    }
    add(checked.value.name, { kind: "removal", version: checked.value.version, hash: null, envelope: checked.value.envelope })
  }

  const secrets: SecretRecord[] = []
  const removals: Envelope[] = []
  for (const name of [...byName.keys()].sort()) {
    const candidates = byName.get(name)!
    const highest = Math.max(...candidates.map((candidate) => candidate.version))
    const top = candidates.filter((candidate) => candidate.version === highest)
    // The same item delivered twice is fine. Two different items at one version are not.
    const distinct = new Set(top.map((candidate) => `${candidate.kind}:${candidate.hash ?? ""}`))
    if (distinct.size > 1) {
      ignored.push({ kind: top[0]!.kind, name, reason: "conflict" })
      continue
    }
    const chosen = top[0]!
    if (chosen.kind === "record") secrets.push(chosen.record)
    else removals.push(chosen.envelope)
  }
  return { secrets, removals, ignored }
}
