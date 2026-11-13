import { z } from "zod"

import { fromUtf8, utf8 } from "./encoding"
import { EnvelopeSchema } from "./envelope"
import { isKey, serverIdOf, type ServerPublicKey } from "./keys"
import { LIMITS } from "./limits"
import {
  DEPLOY_REFUSALS,
  ok,
  refuse,
  ROSTER_REFUSALS,
  type MessageRefusal,
  type Result,
} from "./result"
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

/** Control plane to runner: deploys the runner has not fetched yet. */
export const PendingDeploysResponseSchema = z.strictObject({
  deploys: z.array(PublishDeployRequestSchema).max(LIMITS.pendingDeploys),
})
export type PendingDeploysResponse = z.infer<typeof PendingDeploysResponseSchema>

export const STATUS_OUTCOMES = ["accepted", "refused", "started", "failed"] as const

/**
 * Runner to control plane: what happened to a deploy. Metadata only. There is
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

/** Control plane to client or runner: team lists in version order. */
export const RosterChainResponseSchema = z.strictObject({
  rosters: z.array(EnvelopeSchema).max(LIMITS.rosterChain),
})
export type RosterChainResponse = z.infer<typeof RosterChainResponseSchema>

/** Runner to control plane: this server's public key. The id must be the one derived from it. */
export const RegisterServerRequestSchema = z
  .strictObject({
    serverPublicKey: z.custom<ServerPublicKey>((value) => isKey("serverPublic", value)),
    serverId: z.string().regex(SERVER_ID),
  })
  .refine((request) => serverIdOf(request.serverPublicKey) === request.serverId)
export type RegisterServerRequest = z.infer<typeof RegisterServerRequestSchema>

/*
 * Messages between the CLI and the runner when there is no control plane:
 * the CLI runs the runner (over SSH or as a local process), writes one of
 * these to its standard input and reads one back from its standard output.
 */

/** CLI to runner: set this server up for a team. `teamCode` is the code a person confirmed. */
export const RunnerSetupRequestSchema = z.strictObject({
  founding: EnvelopeSchema,
  teamCode: z.string().min(1).max(64),
})
export type RunnerSetupRequest = z.infer<typeof RunnerSetupRequestSchema>

/** Runner to CLI: the server's public key and the code a person compares before adding it. */
export const RunnerSetupResponseSchema = z
  .strictObject({
    serverPublicKey: z.custom<ServerPublicKey>((value) => isKey("serverPublic", value)),
    serverId: z.string().regex(SERVER_ID),
    code: z.string().min(1).max(64),
  })
  .refine((response) => serverIdOf(response.serverPublicKey) === response.serverId)
export type RunnerSetupResponse = z.infer<typeof RunnerSetupResponseSchema>

const rosterChain = z.array(EnvelopeSchema).max(LIMITS.rosterChain)

/** CLI to runner: newer team lists, in version order. */
export const RunnerSyncRequestSchema = z.strictObject({ rosters: rosterChain })
export type RunnerSyncRequest = z.infer<typeof RunnerSyncRequestSchema>

/** CLI to runner: newer team lists, then one deploy. */
export const RunnerApplyRequestSchema = z.strictObject({
  rosters: rosterChain,
  deploy: PublishDeployRequestSchema,
})
export type RunnerApplyRequest = z.infer<typeof RunnerApplyRequestSchema>

/** Reasons that come from the runner itself, not from a check in this library. */
export const RUNNER_REFUSALS = [
  "invalid_request",
  "invalid_state",
  "not_set_up",
  "already_set_up",
  "busy",
] as const

export const RUNNER_OUTCOMES = ["ok", "started", "start_failed", "refused"] as const

/**
 * Runner to CLI: what happened. `refused` always carries a reason; nothing
 * else does. There is no free-text field.
 */
export const RunnerReportSchema = z
  .strictObject({
    outcome: z.enum(RUNNER_OUTCOMES),
    app: z.string().regex(APP_NAME).optional(),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    reason: z.enum([...DEPLOY_REFUSALS, ...ROSTER_REFUSALS, ...RUNNER_REFUSALS]).optional(),
  })
  .refine((report) => (report.outcome === "refused") === (report.reason !== undefined))
export type RunnerReport = z.infer<typeof RunnerReportSchema>

/** Runner to CLI: what the server holds. Versions and numbers only, never a value. */
export const RunnerStatusSchema = z
  .strictObject({
  serverId: z.string().regex(SERVER_ID),
  serverPublicKey: z.custom<ServerPublicKey>((value) => isKey("serverPublic", value)),
  team: z.strictObject({
    teamId: z.string().regex(TEAM_ID),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  // Keys are shown to a person, so they are held to the same patterns as app and secret names.
  lastSequence: z.record(z.string().regex(APP_NAME), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  secrets: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\/[A-Za-z_][A-Za-z0-9_]*$/),
    z.strictObject({ version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), removed: z.boolean() })
  ),
  })
  .refine((status) => serverIdOf(status.serverPublicKey) === status.serverId)
export type RunnerStatus = z.infer<typeof RunnerStatusSchema>

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
