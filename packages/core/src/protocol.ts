import { z } from "zod"

import { fromUtf8, utf8 } from "./encoding"
import { EnvelopeSchema } from "./envelope"
import { isKey, serverIdOf, type ServerPublicKey } from "./keys"
import { LIMITS } from "./limits"
import { DEPLOY_REFUSALS, ok, refuse, type MessageRefusal, type Result } from "./result"
import { isoTime, TEAM_ID } from "./roster"
import { SecretRecordSchema } from "./secret-record"
import { APP_NAME, SealedSecretSchema, SERVER_ID } from "./secrets"

/**
 * Every message exchanged with the control plane. This file is the public
 * record of what the hosted service receives. All schemas are strict: an
 * unknown field is an error, not something to ignore.
 */

const sealedSecrets = z.array(SealedSecretSchema).max(LIMITS.secretsPerDeploy)

/** Client to control plane: one secret, sealed for a server and signed by the member who set it. */
export const PublishSecretRequestSchema = SecretRecordSchema
export type PublishSecretRequest = z.infer<typeof PublishSecretRequestSchema>

/**
 * Control plane to client: the secret records and removals of one app on one
 * server. The client passes them to `currentSecrets`, which verifies each
 * one; the control plane's word is not enough.
 */
export const SecretsResponseSchema = z.strictObject({
  secrets: z.array(SecretRecordSchema).max(LIMITS.secretHistory),
  removals: z.array(EnvelopeSchema).max(LIMITS.secretHistory),
})
export type SecretsResponse = z.infer<typeof SecretsResponseSchema>

/** Client to control plane: a signed statement that a secret is retired. */
export const PublishSecretRemovalRequestSchema = z.strictObject({ envelope: EnvelopeSchema })
export type PublishSecretRemovalRequest = z.infer<typeof PublishSecretRemovalRequestSchema>

/** Client to control plane: a signed deploy and its sealed secrets. */
export const PublishDeployRequestSchema = z.strictObject({
  envelope: EnvelopeSchema,
  secrets: sealedSecrets,
})
export type PublishDeployRequest = z.infer<typeof PublishDeployRequestSchema>

/** Control plane to agent: deploys the agent has not fetched yet. */
export const PendingDeploysResponseSchema = z.strictObject({
  deploys: z.array(PublishDeployRequestSchema).max(LIMITS.pendingDeploys),
})
export type PendingDeploysResponse = z.infer<typeof PendingDeploysResponseSchema>

export const STATUS_OUTCOMES = ["accepted", "refused", "started", "failed"] as const

/**
 * Agent to control plane: what happened to a deploy. Metadata only. There is
 * deliberately no free-text field, so no log line or secret can travel here.
 */
export const StatusReportSchema = z
  .strictObject({
    v: z.literal(1),
    teamId: z.string().regex(TEAM_ID),
    serverId: z.string().regex(SERVER_ID),
    app: z.string().regex(APP_NAME),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    outcome: z.enum(STATUS_OUTCOMES),
    reason: z.enum(DEPLOY_REFUSALS).optional(),
    at: isoTime,
  })
  .refine((report) => (report.outcome === "refused") === (report.reason !== undefined))
export type StatusReport = z.infer<typeof StatusReportSchema>

/** Client to control plane: a new team list. */
export const PublishRosterRequestSchema = z.strictObject({ envelope: EnvelopeSchema })
export type PublishRosterRequest = z.infer<typeof PublishRosterRequestSchema>

/** Control plane to client or agent: team lists in version order. */
export const RosterChainResponseSchema = z.strictObject({
  rosters: z.array(EnvelopeSchema).max(LIMITS.rosterChain),
})
export type RosterChainResponse = z.infer<typeof RosterChainResponseSchema>

/** Agent to control plane: this server's public key. The id must be the one derived from it. */
export const RegisterServerRequestSchema = z
  .strictObject({
    serverPublicKey: z.custom<ServerPublicKey>((value) => isKey("serverPublic", value)),
    serverId: z.string().regex(SERVER_ID),
  })
  .refine((request) => serverIdOf(request.serverPublicKey) === request.serverId)
export type RegisterServerRequest = z.infer<typeof RegisterServerRequestSchema>

/**
 * Validates a message from outside. Raw text or bytes are checked for size
 * before they are parsed, so pass the body as received: a value that was
 * already parsed (for example by `response.json()`) has no size left to
 * check. Returns the typed message or a refusal, and never throws for bad
 * input.
 */
export function parseMessage<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  maxBytes: number = LIMITS.messageBytes
): Result<z.infer<Schema>, MessageRefusal> {
  let value = input
  if (typeof input === "string" || input instanceof Uint8Array) {
    // A string is never longer in UTF-16 units than in UTF-8 bytes, so this is a cheap first cut.
    if (input.length > maxBytes) return refuse("too_large", "The message is larger than the limit.")
    const bytes = typeof input === "string" ? utf8(input) : input
    if (bytes.length > maxBytes) return refuse("too_large", "The message is larger than the limit.")
    const text = typeof input === "string" ? input : fromUtf8(bytes)
    try {
      value = text === undefined ? undefined : (JSON.parse(text) as unknown)
    } catch {
      value = undefined
    }
    if (value === undefined) return refuse("malformed", "The message is not valid JSON.")
  }
  const parsed = schema.safeParse(value)
  return parsed.success
    ? ok(parsed.data)
    : refuse("malformed", "The message does not match its definition.")
}
