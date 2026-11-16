import { z } from "zod"

import { fromUtf8, utf8 } from "../crypto/encoding"
import { EnvelopeSchema } from "../crypto/envelope"
import { isKey, serverIdOf, type ServerPublicKey } from "../crypto/keys"
import { LIMITS } from "./limits"
import {
  DEPLOY_REFUSALS,
  ok,
  refuse,
  ROSTER_REFUSALS,
  type MessageRefusal,
  type Result,
} from "./result"
import { isoTime, TEAM_ID } from "../team/roster"
import { SecretRecordSchema } from "../secrets/secret-record"
import { APP_NAME, SealedSecretSchema, SERVER_ID } from "../secrets/secrets"
import { RUNNER_VERSION_PATTERN } from "./version"

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
] as const

/**
 * Runner to CLI: what happened. `refused` always carries a reason; nothing
 * else does. There is no free-text field.
 */
export const RunnerReportSchema = z
  .strictObject({
    outcome: z.enum(RUNNER_OUTCOMES),
    app: z.string().regex(APP_NAME).optional(),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    reason: z
      .enum([...DEPLOY_REFUSALS, ...ROSTER_REFUSALS, ...RUNNER_REFUSALS])
      .optional(),
  })
  .refine(
    (report) => (report.outcome === "refused") === (report.reason !== undefined)
  )
export type RunnerReport = z.infer<typeof RunnerReportSchema>

/** At most `limit` entries: a runner holds no more than that, so an answer with more is not a runner's. */
const atMost = (limit: number) => (record: Record<string, unknown>) =>
  Object.keys(record).length <= limit

/** Runner to CLI: what the server holds. Versions and numbers only, never a value. */
export const RunnerStatusSchema = z
  .strictObject({
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
  })
  .refine((status) => serverIdOf(status.serverPublicKey) === status.serverId)
export type RunnerStatus = z.infer<typeof RunnerStatusSchema>

/*
 * A session: several requests over one connection to a runner. The CLI
 * writes one request per line; the runner answers each with zero or more
 * event lines and exactly one result line.
 */

/** The protocol this version of the messages belongs to. A runner reports it with its version. */
export const RUNNER_PROTOCOL = 2

/** Runner to CLI: which runner this is. */
export const RunnerVersionSchema = z.strictObject({
  version: z.string().regex(RUNNER_VERSION_PATTERN),
  protocol: z.number().int().min(1).max(1_000_000),
})
export type RunnerVersion = z.infer<typeof RunnerVersionSchema>

export const SESSION_COMMANDS = [
  "setup",
  "sync",
  "apply",
  "status",
  "state",
  "logs",
  "version",
] as const
export type SessionCommand = (typeof SESSION_COMMANDS)[number]

/** CLI to runner: one request. `input` is that command's own request message, checked by the runner. */
export const SessionRequestSchema = z.strictObject({
  command: z.enum(SESSION_COMMANDS),
  input: z.unknown().optional(),
})
export type SessionRequest = z.infer<typeof SessionRequestSchema>

/** The name of one service of an app, as Docker Compose reports it. */
export const SERVICE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

/** A time as Docker writes it: RFC 3339 with up to nanoseconds. */
const LOG_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

/** Runner to CLI, during `apply`: one line of what Docker printed. Text for a person, never trusted. */
export const ProgressEventSchema = z.strictObject({
  event: z.literal("progress"),
  line: z.string().max(4096),
})
export type ProgressEvent = z.infer<typeof ProgressEventSchema>

/** Runner to CLI, during `logs`: one line an app's container wrote. Text for a person, never trusted. */
export const LogEventSchema = z.strictObject({
  event: z.literal("log"),
  service: z.string().regex(SERVICE_NAME),
  time: z.string().regex(LOG_TIME),
  line: z.string().max(16384),
})
export type LogEvent = z.infer<typeof LogEventSchema>

export const SessionEventSchema = z.discriminatedUnion("event", [
  ProgressEventSchema,
  LogEventSchema,
])
export type SessionEvent = z.infer<typeof SessionEventSchema>

/** Runner to CLI: the end of one request. `result` is that command's own answer, checked by the CLI. */
export const SessionResultSchema = z.strictObject({ result: z.unknown() })

/** Runner to CLI: one line of a session. */
export const SessionFrameSchema = z.union([
  SessionEventSchema,
  SessionResultSchema,
])
export type SessionFrame = z.infer<typeof SessionFrameSchema>

const KiB = 1024
const MiB = 1024 * KiB

/**
 * The longest line a runner sends while it answers each request, in bytes:
 * about twice the longest frame the messages above allow, written out as
 * JSON (an escape turns one character into at most six bytes). A session
 * client reads no further, so a runner that lies cannot make it hold or
 * parse more than that. Requests are still bounded by `LIMITS.messageBytes`.
 */
export const SESSION_FRAME_BYTES: Readonly<Record<SessionCommand, number>> = {
  version: 64 * KiB,
  setup: 64 * KiB,
  sync: 64 * KiB,
  // A progress event: at most 4096 characters, at most about 24 KiB written out.
  apply: 64 * KiB,
  // A log event: at most 16384 characters, at most about 96 KiB written out.
  logs: 192 * KiB,
  // At most 1024 apps and 4096 services: about 0.6 MiB.
  state: 1 * MiB,
  // At most 1024 apps and 8192 secrets: about 2.1 MiB.
  status: 4 * MiB,
}

export const SERVICE_STATES = [
  "running",
  "exited",
  "created",
  "restarting",
  "paused",
  "dead",
  "removing",
  "unknown",
] as const
export const SERVICE_HEALTH = ["healthy", "unhealthy", "starting", ""] as const

/**
 * Runner to CLI: what is running for each app. Names and states only. At
 * most `LIMITS.appsPerServer` apps, and `LIMITS.servicesPerServer` services
 * in all: a runner leaves out the apps past that, which reads as "not known".
 */
export const RunnerAppStatesSchema = z.strictObject({
  apps: z
    .record(
      z.string().regex(APP_NAME),
      z.strictObject({
        services: z
          .array(
            z.strictObject({
              service: z.string().regex(SERVICE_NAME),
              state: z.enum(SERVICE_STATES),
              exitCode: z.number().int().min(0).max(255),
              health: z.enum(SERVICE_HEALTH),
            })
          )
          .max(LIMITS.servicesPerApp),
      })
    )
    .refine(atMost(LIMITS.appsPerServer))
    .refine(
      (apps) =>
        Object.values(apps).reduce(
          (total, app) => total + app.services.length,
          0
        ) <= LIMITS.servicesPerServer
    ),
})
export type RunnerAppStates = z.infer<typeof RunnerAppStatesSchema>

/**
 * CLI to runner: the logs of one app, starting with its last `tail` lines.
 * They are followed unless `follow` is false: then the runner sends the lines
 * Docker has and ends the request. Absent means true.
 */
export const RunnerLogsRequestSchema = z.strictObject({
  app: z.string().regex(APP_NAME),
  tail: z.number().int().min(0).max(1000),
  follow: z.boolean().optional(),
})
export type RunnerLogsRequest = z.infer<typeof RunnerLogsRequestSchema>

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
