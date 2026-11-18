import { z } from "zod"

import {
  hasOtherVersion,
  openEnvelope,
  parseJson,
  PAYLOAD_TYPES,
  readEnvelope,
  type Envelope,
} from "../crypto/envelope"
import { ok, refuse, type Result, type SecretRefusal } from "../protocol/result"
import {
  isoTime,
  memberByKeyId,
  TEAM_ID,
  type Member,
  type TeamTrust,
} from "../team/roster"
import { APP_NAME, secretName, SERVER_ID } from "./secrets"

/**
 * A secret's version: a whole number of 1 or more. It lives here, beside the
 * statement that carries it, and `secret-record.ts` exports it as before.
 */
export const secretVersion = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER)

/** What a member signs when they set a secret: where it belongs, its version and its ciphertext's hash. */
export const SecretStatementSchema = z.strictObject({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID),
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  name: secretName,
  version: secretVersion,
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: isoTime,
})
export type SecretStatement = z.infer<typeof SecretStatementSchema>

/** A secret statement that passed verification against the team list, without the sealed value it describes. */
export type VerifiedStatement = {
  readonly name: string
  readonly version: number
  /** The hash of the ciphertext the statement describes. */
  readonly hash: string
  /** The member who set it. */
  readonly signer: Member
  readonly envelope: Envelope
}

/**
 * Checks a secret statement on its own: signed by a current team member, for
 * this team, server and app. It says nothing about a ciphertext, so a caller
 * that also holds one checks that it is the one described (`verifySecret`).
 * This is what lets a client list a secret the runner holds without its value
 * passing through the client.
 */
export function verifySecretStatement(input: {
  envelope: unknown
  trust: TeamTrust
  serverId: string
  app: string
}): Result<VerifiedStatement, SecretRefusal> {
  const opened = openEnvelope(
    input.envelope,
    PAYLOAD_TYPES.secret,
    (keyId) => memberByKeyId(input.trust.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const signer = input.trust.members.find(
    (member) => member.publicKey === opened.value.signerKey
  )!

  const json = parseJson(opened.value.payload)
  if (json === undefined)
    return refuse("malformed", "The secret statement is not valid JSON.")
  if (hasOtherVersion(json)) {
    return refuse(
      "unsupported_version",
      "This secret uses a format version this library does not know."
    )
  }
  const statement = SecretStatementSchema.safeParse(json)
  if (!statement.success)
    return refuse(
      "malformed",
      "The secret statement does not match its definition."
    )

  if (statement.data.teamId !== input.trust.teamId) {
    return refuse("wrong_team", "This secret belongs to another team.")
  }
  if (statement.data.serverId !== input.serverId) {
    return refuse("wrong_server", "This secret was set for another server.")
  }
  if (statement.data.app !== input.app) {
    return refuse("wrong_app", "This secret was set for another app.")
  }
  return ok(
    Object.freeze({
      name: statement.data.name,
      version: statement.data.version,
      hash: statement.data.hash,
      signer,
      envelope: opened.value.envelope,
    })
  )
}

/**
 * Reads a secret statement without checking its signature or whom it is for.
 * Untrusted: only to say which secret, and by which key, an item that did not
 * verify was about, or to compare a held record with what a deploy lists
 * before it is verified; never to decide what is signed or run.
 */
function readUnchecked(
  envelope: unknown
): { statement: SecretStatement; keyId: string } | undefined {
  const read = readEnvelope(envelope, PAYLOAD_TYPES.secret)
  if (!read.ok) return undefined
  const statement = SecretStatementSchema.safeParse(
    parseJson(read.value.payload)
  )
  return statement.success
    ? { statement: statement.data, keyId: read.value.envelope.signature.keyId }
    : undefined
}

/** A secret statement's fields, read without checking anything but its shape (`readUnchecked`). */
export function readStatementUnchecked(
  envelope: unknown
): SecretStatement | undefined {
  return readUnchecked(envelope)?.statement
}

/**
 * The name, version and signer's key id a secret statement claims, read
 * without trusting it: no signature is checked. A name is held to
 * `SECRET_NAME`, so it prints safely. Undefined for anything that is not a
 * readable secret statement, a removal among them.
 */
export function peekSecretStatement(
  envelope: unknown
): { name: string; version: number; keyId: string } | undefined {
  const read = readUnchecked(envelope)
  if (!read) return undefined
  return {
    name: read.statement.name,
    version: read.statement.version,
    keyId: read.keyId,
  }
}
