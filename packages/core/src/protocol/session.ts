/**
 * A session: several requests over one connection to a runner. The CLI
 * writes one request per line; the runner answers each with zero or more
 * event lines and exactly one result line. Every schema is strict, as in
 * `protocol.ts`, where the messages of the one-shot commands are.
 */
import { z } from "zod"

import { EnvelopeSchema } from "../crypto/envelope"
import {
  healthBytes,
  HealthInForceSchema,
  RouteSchema,
} from "../deploy/routes-and-checks"
import { APP_NAME } from "../secrets/secrets"
import {
  BuildErrorEventSchema,
  BuildEventSchema,
  BuildLineEventSchema,
} from "./build-messages"
import { LIMITS } from "./limits"
import {
  atMost,
  ownServerId,
  RunnerReportSchema,
  runnerStatusFields,
} from "./protocol"
import { SERVICE_NAME } from "./service-name"
import { RUNNER_VERSION_PATTERN } from "./version"

/**
 * The protocol this version of the messages belongs to. A runner reports it
 * with its version. 6 (specs/016-build-from-source, contracts/core.md CO17;
 * FR-081, FR-084): the runner builds with a Dockerfile, answers `pack`,
 * `builds` and `builder`, and may answer `build_failed` and CO10's refusals
 * (`pack_missing`, `pack_mismatch`, `low_disk`, `docker_too_old`,
 * `no_build_plugin`) to a `deploy`, which also sends the events `build`,
 * `build_line` and `build_error`. The `version` answer stays the strict
 * `{ version, protocol }`, so every released zekno still reads it; zekno's
 * thresholds (`BUILD_PROTOCOL` and the others) are the CLI's, not core's.
 * 5 (specs/015-domains-https, contracts/core.md, "The
 * protocol"; security review, lead A10): the runner stops waiting for
 * `docker compose up` at a time limit, and its report of a version-2
 * `deploy` may carry `startLimit` with `start_failed`; nothing else changes.
 * 4 (specs/015-domains-https, contracts/core.md, "The protocol"): the runner
 * carries out a deploy's `routes` and `health`, answers `status` with routes
 * when asked, and answers `proxy`. 3 (specs/014-deploy-v2,
 * contracts/protocol.md P1): the runner carries out a version-2 deploy with
 * `previous`, `expiresAt` and secrets by version, and answers `deploy` and
 * `records`. Runner 0.1.0 speaks 2.
 */
export const RUNNER_PROTOCOL = 6

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
  // Feature 014: they exist only inside a session, never as one-shot commands.
  "deploy",
  "records",
  // Feature 015: makes the proxy match the routes in force. Only inside a session too.
  "proxy",
  // Feature 016 (contracts/core.md CO12): stages one sealed piece of a deploy;
  // says what the runner keeps of each app's builds; says what the server can
  // build with. Only inside a session too; a runner below protocol 6 answers
  // each `invalid_request`.
  "pack",
  "builds",
  "builder",
] as const
export type SessionCommand = (typeof SESSION_COMMANDS)[number]

/** CLI to runner: one request. `input` is that command's own request message, checked by the runner. */
export const SessionRequestSchema = z.strictObject({
  command: z.enum(SESSION_COMMANDS),
  input: z.unknown().optional(),
})
export type SessionRequest = z.infer<typeof SessionRequestSchema>

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

/**
 * Runner to CLI, during `deploy`: the wait for this service's health has
 * begun (specs/015-domains-https, contracts/core.md, "Event"). A service
 * name only.
 */
export const HealthEventSchema = z.strictObject({
  event: z.literal("health"),
  service: z.string().regex(SERVICE_NAME),
})
export type HealthEvent = z.infer<typeof HealthEventSchema>

/**
 * Runner to CLI: one event. `build`, `build_line` and `build_error` (protocol
 * 6, CO11) come during `deploy`, beside `progress` and `health`; their
 * schemas are in `build-messages.ts`.
 */
export const SessionEventSchema = z.discriminatedUnion("event", [
  ProgressEventSchema,
  LogEventSchema,
  HealthEventSchema,
  BuildEventSchema,
  BuildLineEventSchema,
  BuildErrorEventSchema,
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
  // At most 1024 apps and 8192 secrets: about 2.1 MiB; with routes, 1,024
  // domains and 256 KiB of health checks more: about 2.6 MiB.
  status: 4 * MiB,
  // As apply: a progress event, at most about 24 KiB written out, a health
  // event, or a report. Protocol 6 (CO11): a build event, a build_line (as a
  // progress event), or a build_error, a step of 1,024 characters and an
  // error of 4,096, at most about 30 KiB written out. It stays equal to
  // apply's.
  deploy: 64 * KiB,
  // At most 256 secret statements of about 0.8 KiB each: about 0.2 MiB. The
  // design allows 8 MiB; every bound here stays within an eighth of a message.
  records: 4 * MiB,
  // The proxy's state, or a report: well under 1 KiB.
  proxy: 4 * KiB,
  // Protocol 6 (CO12, CO19). The fingerprint staged, or a refusal: well under
  // 1 KiB.
  pack: 4 * KiB,
  // At most 8 apps of about 42 KB each: about 0.34 MB; with no input, at
  // most 1,024 app names: about 67 KB.
  builds: 1 * MiB,
  // Versions and numbers only: well under 1 KiB.
  builder: 16 * KiB,
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

/** CLI to runner, in a session: the statements the runner holds for one app. */
export const RunnerRecordsRequestSchema = z.strictObject({
  app: z.string().regex(APP_NAME),
})
export type RunnerRecordsRequest = z.infer<typeof RunnerRecordsRequestSchema>

/**
 * Runner to CLI: the statement of each record the runner holds for the app,
 * sorted by name. Never a sealed value: a statement says a secret's name,
 * version and hash and who set it. The CLI verifies each one; the runner's
 * word is not enough.
 */
export const RunnerRecordsSchema = z.strictObject({
  statements: z.array(EnvelopeSchema).max(LIMITS.secretsPerDeploy),
})
export type RunnerRecords = z.infer<typeof RunnerRecordsSchema>

/**
 * CLI to runner, in a session: the input of `status` that asks for the routes
 * in force (specs/015-domains-https, contracts/core.md, "`status` with
 * routes"). A runner of protocol 4 refuses any other input `invalid_request`;
 * older runners never read it and answer `RunnerStatusSchema`.
 */
export const RunnerStatusRequestSchema = z.strictObject({
  routes: z.literal(true),
})
export type RunnerStatusRequest = z.infer<typeof RunnerStatusRequestSchema>

/**
 * The proxy's state, as `status` with routes says it: `none` when no app has
 * a route and no proxy runs; `missing` when an app has a route and the
 * proxy's container is not there; `other_image` when it runs from an image
 * that is not the pinned one.
 */
export const PROXY_STATES = [
  "none",
  "running",
  "stopped",
  "missing",
  "other_image",
] as const

/**
 * Runner to CLI: the answer to `status` with the input `{ "routes": true }`.
 * Today's fields, the routes in force of each app that has any, the health
 * check in force of each app that has one, and the proxy's state. Within the
 * stored state's limits: at most `LIMITS.routesPerDeploy` routes an app and
 * `LIMITS.domainsPerServer` in all; each health check by the rules of a
 * signed deploy's, and at most `LIMITS.healthBytesPerServer` of them as
 * written. A rollback signs the routes and the health check given here for
 * its app. Without the input the answer is `RunnerStatusSchema`, unchanged,
 * so every older zekno reads it.
 */
export const RunnerStatusWithRoutesSchema = z
  .strictObject({
    ...runnerStatusFields,
    routes: z
      .record(
        z.string().regex(APP_NAME),
        z.array(RouteSchema).min(1).max(LIMITS.routesPerDeploy)
      )
      .refine(
        (routes) =>
          Object.values(routes).reduce((total, app) => total + app.length, 0) <=
          LIMITS.domainsPerServer
      ),
    health: z
      .record(z.string().regex(APP_NAME), HealthInForceSchema)
      .refine(atMost(LIMITS.appsPerServer))
      .refine((health) => healthBytes(health) <= LIMITS.healthBytesPerServer),
    proxy: z.enum(PROXY_STATES),
  })
  .refine(ownServerId)
export type RunnerStatusWithRoutes = z.infer<
  typeof RunnerStatusWithRoutesSchema
>

/**
 * Runner to CLI: the answer to `proxy`, which makes the proxy match the
 * routes in force (specs/015-domains-https, contracts/core.md, "`proxy`").
 * The proxy's state when that worked, or a report with outcome
 * `routes_failed` and a failure of `port_taken` or `not_loaded`. A refusal
 * (`not_set_up`, `busy`, …) is a report as for every command.
 */
export const RunnerProxySchema = z.union([
  z.strictObject({ proxy: z.enum(["none", "running"]) }),
  RunnerReportSchema.refine(
    (report) =>
      report.outcome === "routes_failed" &&
      (report.routes?.failure === "port_taken" ||
        report.routes?.failure === "not_loaded")
  ),
])
export type RunnerProxy = z.infer<typeof RunnerProxySchema>

/**
 * Runner to CLI: the answer to `pack` (specs/016-build-from-source,
 * contracts/core.md CO12; FR-028, FR-029a): the fingerprint of the piece it
 * staged, or a report with outcome `refused`, as for every command: a reason
 * of the gate (K4 to K10), `pack_mismatch` (a piece not listed or over its
 * bound), `too_large` (staging past `LIMITS.stagingBytes`), `low_disk` (the
 * piece would bring free disk below the floor) or `busy`. Never `missing` or
 * `building`, which only a `deploy` answer carries (CO10), so the longest
 * answer stays well within its 4 KiB frame.
 */
export const RunnerPackSchema = z.union([
  z.strictObject({ staged: z.string().regex(/^[0-9a-f]{64}$/) }),
  RunnerReportSchema.refine(
    (report) =>
      report.outcome === "refused" &&
      report.missing === undefined &&
      report.building === undefined
  ),
])
export type RunnerPack = z.infer<typeof RunnerPackSchema>
