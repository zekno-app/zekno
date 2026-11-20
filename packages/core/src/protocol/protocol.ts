import { z } from "zod"

import { fromUtf8, utf8 } from "../crypto/encoding"
import { EnvelopeSchema } from "../crypto/envelope"
import { isKey, serverIdOf, type ServerPublicKey } from "../crypto/keys"
import { LIMITS } from "./limits"
import {
  DEPLOY_REFUSALS,
  DEPLOY_V2_REFUSALS,
  ok,
  refuse,
  ROSTER_REFUSALS,
  type MessageRefusal,
  type Result,
} from "./result"
import { isoTime, TEAM_ID } from "../team/roster"
import { SecretRecordSchema } from "../secrets/secret-record"
import { APP_NAME, SealedSecretSchema, SERVER_ID } from "../secrets/secrets"
import { SERVICE_NAME } from "./service-name"

/**
 * Every message exchanged with the control plane. This file is the public
 * record of what the hosted service receives. All schemas are strict: an
 * unknown field is an error, not something to ignore. The messages only a
 * session carries are in `session.ts`.
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
export const PublishSecretRemovalRequestSchema = z.strictObject({
  envelope: EnvelopeSchema,
})
export type PublishSecretRemovalRequest = z.infer<
  typeof PublishSecretRemovalRequestSchema
>

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
export type PendingDeploysResponse = z.infer<
  typeof PendingDeploysResponseSchema
>

export const STATUS_OUTCOMES = [
  "accepted",
  "refused",
  "started",
  "failed",
] as const

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
  .refine(
    (report) => (report.outcome === "refused") === (report.reason !== undefined)
  )
export type StatusReport = z.infer<typeof StatusReportSchema>

/** Client to control plane: a new team list. */
export const PublishRosterRequestSchema = z.strictObject({
  envelope: EnvelopeSchema,
})
export type PublishRosterRequest = z.infer<typeof PublishRosterRequestSchema>

/** Control plane to client or runner: team lists in version order. */
export const RosterChainResponseSchema = z.strictObject({
  rosters: z.array(EnvelopeSchema).max(LIMITS.rosterChain),
})
export type RosterChainResponse = z.infer<typeof RosterChainResponseSchema>

/** Runner to control plane: this server's public key. The id must be the one derived from it. */
export const RegisterServerRequestSchema = z
  .strictObject({
    serverPublicKey: z.custom<ServerPublicKey>((value) =>
      isKey("serverPublic", value)
    ),
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
    serverPublicKey: z.custom<ServerPublicKey>((value) =>
      isKey("serverPublic", value)
    ),
    serverId: z.string().regex(SERVER_ID),
    code: z.string().min(1).max(64),
  })
  .refine(
    (response) => serverIdOf(response.serverPublicKey) === response.serverId
  )
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

/**
 * CLI to runner, in a session only: newer team lists, one version-2 deploy
 * (kind `zekno.deploy.v2`), and the whole records (statement and sealed
 * value) of the listed secrets the runner lacks. The records are not signed
 * by the deploy: the runner verifies each against the team list it holds.
 */
export const RunnerDeployRequestSchema = z.strictObject({
  rosters: rosterChain,
  envelope: EnvelopeSchema,
  records: z.array(SecretRecordSchema).max(LIMITS.secretsPerDeploy),
})
export type RunnerDeployRequest = z.infer<typeof RunnerDeployRequestSchema>

/** Reasons that come from the runner itself, not from a check in this library. */
export const RUNNER_REFUSALS = [
  "invalid_request",
  "invalid_state",
  "not_set_up",
  "already_set_up",
  "busy",
] as const

export const RUNNER_OUTCOMES = [
  "ok",
  "started",
  "start_failed",
  "refused",
  // Protocol 4 (specs/015-domains-https, contracts/core.md, "Outcomes"): the
  // app started and its routes could not be put in force; or it started and a
  // service was not healthy in time.
  "routes_failed",
  "unhealthy",
] as const

/**
 * Why a deploy's routes could not be put in force (runner.md, RN4 to RN9): a
 * port the proxy needs is taken; a routed or checked service has no container;
 * a container uses the host's network; the proxy did not load the
 * configuration.
 */
export const ROUTE_FAILURES = [
  "port_taken",
  "no_container",
  "host_network",
  "not_loaded",
] as const

const withService = new Set<string>(["no_container", "host_network"])

/** A report's `routes`: the failure, the service exactly with `no_container` and `host_network`, the port exactly with `port_taken`. */
const RoutesFailureSchema = z
  .strictObject({
    failure: z.enum(ROUTE_FAILURES),
    service: z.string().regex(SERVICE_NAME).optional(),
    port: z.union([z.literal(80), z.literal(443)]).optional(),
  })
  .refine(
    (routes) =>
      withService.has(routes.failure) === (routes.service !== undefined) &&
      (routes.failure === "port_taken") === (routes.port !== undefined)
  )

/** A report's `health`: the service that was not healthy in time, and whether its check had a path. */
const HealthFailureSchema = z.strictObject({
  service: z.string().regex(SERVICE_NAME),
  http: z.boolean(),
})

/**
 * The longest time limit a report may say a start was stopped at, in
 * seconds: a day (`startLimit`).
 */
const START_LIMIT_SECONDS = 86_400

/**
 * Runner to CLI: what happened. `refused` always carries a reason; nothing
 * else does. `routes_failed` always carries `routes`, and `unhealthy`
 * `health`; nothing else does (core.md, "Outcomes"). `startLimit` (protocol
 * 5) is present exactly when the runner stopped waiting for the app's start
 * at its time limit, which it gives in whole seconds, and only with
 * `start_failed`; a `start_failed` without it failed for another reason.
 * There is no free-text field.
 */
export const RunnerReportSchema = z
  .strictObject({
    outcome: z.enum(RUNNER_OUTCOMES),
    app: z.string().regex(APP_NAME).optional(),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    reason: z
      .enum([
        ...DEPLOY_REFUSALS,
        ...DEPLOY_V2_REFUSALS,
        ...ROSTER_REFUSALS,
        ...RUNNER_REFUSALS,
      ])
      .optional(),
    routes: RoutesFailureSchema.optional(),
    health: HealthFailureSchema.optional(),
    startLimit: z.number().int().min(1).max(START_LIMIT_SECONDS).optional(),
  })
  .refine(
    (report) =>
      (report.outcome === "refused") === (report.reason !== undefined) &&
      (report.outcome === "routes_failed") === (report.routes !== undefined) &&
      (report.outcome === "unhealthy") === (report.health !== undefined) &&
      (report.startLimit === undefined || report.outcome === "start_failed")
  )
export type RunnerReport = z.infer<typeof RunnerReportSchema>

/** At most `limit` entries: a runner holds no more than that, so an answer with more is not a runner's. */
export const atMost = (limit: number) => (record: Record<string, unknown>) =>
  Object.keys(record).length <= limit

/** The server's own id is the one derived from its key. */
export const ownServerId = (status: {
  serverId: string
  serverPublicKey: ServerPublicKey
}) => serverIdOf(status.serverPublicKey) === status.serverId

/** The fields of the answer to `status`: what the server holds. Shared with the answer with routes (`session.ts`). */
export const runnerStatusFields = {
  serverId: z.string().regex(SERVER_ID),
  serverPublicKey: z.custom<ServerPublicKey>((value) =>
    isKey("serverPublic", value)
  ),
  team: z.strictObject({
    teamId: z.string().regex(TEAM_ID),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  // Keys are shown to a person, so they are held to the same patterns as app and secret names.
  lastSequence: z
    .record(
      z.string().regex(APP_NAME),
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
    )
    .refine(atMost(LIMITS.appsPerServer)),
  secrets: z
    .record(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,62}\/[A-Za-z_][A-Za-z0-9_]{0,127}$/),
      z.strictObject({
        version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        removed: z.boolean(),
      })
    )
    .refine(atMost(LIMITS.secretsPerServer)),
}

/** Runner to CLI: what the server holds. Versions and numbers only, never a value. */
export const RunnerStatusSchema = z
  .strictObject(runnerStatusFields)
  .refine(ownServerId)
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
    if (input.length > maxBytes)
      return refuse("too_large", "The message is larger than the limit.")
    const bytes = typeof input === "string" ? utf8(input) : input
    if (bytes.length > maxBytes)
      return refuse("too_large", "The message is larger than the limit.")
    const text = typeof input === "string" ? input : fromUtf8(bytes)
    try {
      value = text === undefined ? undefined : (JSON.parse(text) as unknown)
    } catch {
      value = undefined
    }
    if (value === undefined)
      return refuse("malformed", "The message is not valid JSON.")
  }
  const parsed = schema.safeParse(value)
  return parsed.success
    ? ok(parsed.data)
    : refuse("malformed", "The message does not match its definition.")
}
