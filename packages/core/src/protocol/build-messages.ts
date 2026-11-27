/**
 * The messages of building from source (specs/016-build-from-source,
 * contracts/core.md CO10 to CO12), kept here so `protocol.ts` and
 * `session.ts` stay small. Every schema is strict, and no field is free text
 * unless its comment says it is shown to a person and never trusted.
 *
 * Sections, in order: the report's fields (CO10); the events of `deploy`
 * (CO11); the requests and answers of `pack`, `builds` and `builder` (CO12),
 * but the answer of `pack`, which is in `session.ts`.
 */
import { z } from "zod"

import { EnvelopeSchema } from "../crypto/envelope"
import {
  ARCHES,
  BUILD_REASONS,
  BUILDING_LIMIT_SECONDS,
  BUILDING_PHASES,
  BuildRecordSchema,
  DOCKER_VERSION,
} from "../deploy/build-record"
import { APP_NAME } from "../secrets/secrets"
import { isoTime } from "../team/roster"
import { base64UrlLength, LIMITS } from "./limits"

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const dockerVersion = z.string().regex(DOCKER_VERSION)

/** True when each text comes after the one before it, so the list is sorted and has no repeat. */
const sortedAndUnique = (texts: readonly string[]) =>
  texts.every((text, index) => index === 0 || texts[index - 1]! < text)

// The report's fields (CO10; FR-029a, FR-031a, FR-034a, FR-040, FR-043,
// FR-044, FR-078). Each comes only with its outcome or reason
// (`buildFieldsFit`). Core writes no sentence: the CLI says R11 to R14, E1
// to E15, E19, G43 and G44 from these values.

/**
 * `missing`, with `pack_missing`: the pieces a build not kept needs and the
 * runner has not staged, sorted and each once, and the builds the state
 * recorded whose image is gone or leads elsewhere, sorted by key and each
 * once.
 */
export const ReportMissingSchema = z.strictObject({
  pieces: z.array(hex64).max(LIMITS.missingPieces).refine(sortedAndUnique),
  images: z
    .array(z.strictObject({ key: hex64, state: z.enum(["gone", "changed"]) }))
    .max(LIMITS.buildsPerDeploy)
    .refine((images) => sortedAndUnique(images.map((image) => image.key))),
})
export type ReportMissing = z.infer<typeof ReportMissingSchema>

/** `disk`, with `low_disk`: the free disk and the floor, in bytes (FR-040). */
export const ReportDiskSchema = z.strictObject({ free: bytes, floor: bytes })
export type ReportDisk = z.infer<typeof ReportDiskSchema>

/**
 * `docker`, with `docker_too_old`: the engine's version, and buildx's or
 * null. The runner sets `buildx` only when check L2 settles item 11 as (a)
 * and sets a buildx floor; the schema allows both (FR-034a).
 */
export const ReportDockerSchema = z.strictObject({
  engine: dockerVersion,
  buildx: dockerVersion.nullable(),
})
export type ReportDocker = z.infer<typeof ReportDockerSchema>

/**
 * `building`, optional with `busy`: the app whose deploy builds, the seconds
 * since it started, its limit and its phase, read from the state's
 * `building` (CO13). Only in a `deploy` answer.
 */
export const ReportBuildingSchema = z.strictObject({
  app: z.string().regex(APP_NAME),
  seconds: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(BUILDING_LIMIT_SECONDS),
  phase: z.enum(BUILDING_PHASES),
})
export type ReportBuilding = z.infer<typeof ReportBuildingSchema>

/**
 * `build`, exactly with `build_failed`: the failed build's key and why. The
 * reason is never `runner_restarted`, which is only ever in the state and in
 * `builds` (RB16). `arch` (the image's and the server's) comes exactly with
 * `wrong_processor`, `team` (the team list's version) exactly with
 * `team_changed`.
 */
export const ReportBuildSchema = z
  .strictObject({
    key: hex64,
    reason: z.enum(BUILD_REASONS).exclude(["runner_restarted"]),
    arch: z
      .strictObject({ image: z.enum(ARCHES), server: z.enum(ARCHES) })
      .optional(),
    team: z
      .strictObject({
        version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
  })
  .refine(
    (build) =>
      (build.reason === "wrong_processor") === (build.arch !== undefined) &&
      (build.reason === "team_changed") === (build.team !== undefined)
  )
export type ReportBuild = z.infer<typeof ReportBuildSchema>

/** The report's fields of building from source, each optional, for `RunnerReportSchema`. */
export const reportBuildFields = {
  missing: ReportMissingSchema.optional(),
  disk: ReportDiskSchema.optional(),
  docker: ReportDockerSchema.optional(),
  building: ReportBuildingSchema.optional(),
  build: ReportBuildSchema.optional(),
}

/**
 * Each field of building from source comes only with its own outcome or
 * reason (CO10): `missing` exactly with `pack_missing`, `disk` exactly with
 * `low_disk`, `docker` exactly with `docker_too_old`, `building` only with
 * `busy`, and `build` exactly with `build_failed`, which also carries `app`
 * and `sequence`, since the number was used.
 */
export function buildFieldsFit(report: {
  readonly outcome: string
  readonly reason?: string
  readonly app?: string
  readonly sequence?: number
  readonly missing?: unknown
  readonly disk?: unknown
  readonly docker?: unknown
  readonly building?: unknown
  readonly build?: unknown
}): boolean {
  const failed = report.outcome === "build_failed"
  return (
    (report.reason === "pack_missing") === (report.missing !== undefined) &&
    (report.reason === "low_disk") === (report.disk !== undefined) &&
    (report.reason === "docker_too_old") === (report.docker !== undefined) &&
    (report.building === undefined || report.reason === "busy") &&
    failed === (report.build !== undefined) &&
    (!failed || (report.app !== undefined && report.sequence !== undefined))
  )
}

// The events of `deploy` (CO11; FR-031a, FR-070, FR-071). `progress` and
// `health` stay in `session.ts`; `SessionEventSchema` there takes these
// three too. The text of `build_line` and `build_error` is for a person and
// never trusted: zekno passes `line`, `step` and `error` through `sanitize`
// before anything is drawn or printed (CL7). Their bounds keep the `deploy`
// frame within its 64 KiB written out as JSON (CO19).

/** The states one build goes through, each said once (CO11). */
export const BUILD_EVENT_STATES = [
  "reused",
  "building",
  "built",
  "failed",
] as const

/** Runner to CLI, during `deploy`: one build, by its key, reached a state. */
export const BuildEventSchema = z.strictObject({
  event: z.literal("build"),
  key: hex64,
  state: z.enum(BUILD_EVENT_STATES),
})
export type BuildEvent = z.infer<typeof BuildEventSchema>

/**
 * Runner to CLI, during `deploy`: one line the builder printed, at most
 * `LIMITS.buildLineCharacters`, which the runner cuts to. Text for a person,
 * never trusted; dropped as `progress` is when the reader is far behind.
 */
export const BuildLineEventSchema = z.strictObject({
  event: z.literal("build_line"),
  key: hex64,
  line: z.string().max(LIMITS.buildLineCharacters),
})
export type BuildLineEvent = z.infer<typeof BuildLineEventSchema>

/**
 * Runner to CLI, during `deploy`: the step that failed and its error, once,
 * before the result of a `step_failed`, and never dropped. The runner cuts
 * `step` to `LIMITS.buildStepCharacters` (1,024: at 4,096, 1.5 times the
 * frame would pass 64 KiB) and `error` to a line's 4,096. Text for a person,
 * never trusted.
 */
export const BuildErrorEventSchema = z.strictObject({
  event: z.literal("build_error"),
  key: hex64,
  step: z.string().max(LIMITS.buildStepCharacters),
  error: z.string().max(LIMITS.buildLineCharacters),
})
export type BuildErrorEvent = z.infer<typeof BuildErrorEventSchema>

// The requests and answers of `pack`, `builds` and `builder` (CO12). Each is
// a command of a session only; a runner below protocol 6 answers each
// `invalid_request`. The answer of `pack` is in `session.ts`, beside
// `RunnerProxySchema`, since it takes the report from `protocol.ts`, which
// imports this file.

/**
 * CLI to runner: one sealed piece of a signed deploy, before the deploy
 * (FR-028, FR-029a). The piece is base64url of at most
 * `LIMITS.sealedPieceBytes`; the runner checks the envelope (K4 to K10) and
 * that the deploy lists the piece's fingerprint (`admitPiece`). The longest
 * request line, an envelope at its bound and the longest piece, is about
 * 12 MiB, within `LIMITS.messageBytes`.
 */
export const RunnerPackRequestSchema = z.strictObject({
  envelope: EnvelopeSchema,
  piece: z
    .string()
    .max(base64UrlLength(LIMITS.sealedPieceBytes))
    .regex(/^[A-Za-z0-9_-]+$/),
})
export type RunnerPackRequest = z.infer<typeof RunnerPackRequestSchema>

const appName = z.string().regex(APP_NAME)
const sequence = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

/** True when the texts are each there once, in any order. */
const eachOnce = (texts: readonly string[]) =>
  new Set(texts).size === texts.length

/**
 * CLI to runner: `builds` with no input asks which apps have builds; with
 * `apps`, 1 to `LIMITS.buildsAppsPerRequest` names sorted and each once, it
 * asks what the runner keeps of each (FR-045, FR-064, FR-066). `check`, 1 to
 * 8 build keys each once and only with exactly one app, asks whether each
 * image is still the one recorded (FR-021a, FR-080).
 */
export const RunnerBuildsRequestSchema = z.union([
  z.strictObject({}),
  z
    .strictObject({
      apps: z
        .array(appName)
        .min(1)
        .max(LIMITS.buildsAppsPerRequest)
        .refine(sortedAndUnique),
      check: z
        .array(hex64)
        .min(1)
        .max(LIMITS.buildsPerDeploy)
        .refine(eachOnce)
        .optional(),
    })
    .refine(
      (request) => request.check === undefined || request.apps.length === 1
    ),
])
export type RunnerBuildsRequest = z.infer<typeof RunnerBuildsRequestSchema>

/** How each image `check` asked about stands: kept as recorded, gone, or leading elsewhere. */
export const BUILD_CHECK_STATES = ["kept", "gone", "changed"] as const

/**
 * Runner to CLI: what the runner keeps of one app (CO12's `AppBuildsAnswer`),
 * read from its state (CO13) and its build records (CO14). The server's word,
 * shown as such and never signed. `running` is the deploy whose Compose text
 * is in force; `deploys` at most `LIMITS.keptDeploysPerApp`, newest first,
 * their keys 1 to 8, sorted and each once; `fresh` at most
 * `LIMITS.freshPerApp`, sorted by base and each once; `records` the builds of
 * the deploy that runs, at most 8, sorted by key and each once; `last` the
 * last deploy that built or reused, with a reason from `BUILD_REASONS` or
 * null; `building` the deploy that holds the lock to build, or null; `check`
 * only when asked, at most 8 keys. About 42 KB at most.
 */
export const AppBuildsAnswerSchema = z.strictObject({
  running: sequence.nullable(),
  deploys: z
    .array(
      z.strictObject({
        sequence,
        keys: z
          .array(hex64)
          .min(1)
          .max(LIMITS.buildsPerDeploy)
          .refine(sortedAndUnique),
      })
    )
    .max(LIMITS.keptDeploysPerApp)
    .refine((deploys) =>
      deploys.every(
        (deploy, index) =>
          index === 0 || deploys[index - 1]!.sequence > deploy.sequence
      )
    ),
  fresh: z
    .array(z.strictObject({ base: hex64, sequence }))
    .max(LIMITS.freshPerApp)
    .refine((fresh) => sortedAndUnique(fresh.map((entry) => entry.base))),
  records: z
    .array(BuildRecordSchema)
    .max(LIMITS.buildsPerDeploy)
    .refine((records) => sortedAndUnique(records.map((record) => record.key))),
  last: z
    .strictObject({
      sequence,
      outcome: z.enum(["built", "reused", "build_failed"]),
      reason: z.enum(BUILD_REASONS).nullable(),
      at: isoTime,
    })
    .nullable(),
  building: z
    .strictObject({
      sequence,
      seconds: count,
      limit: z.number().int().min(1).max(BUILDING_LIMIT_SECONDS),
      phase: z.enum(BUILDING_PHASES),
    })
    .nullable(),
  check: z
    .record(hex64, z.enum(BUILD_CHECK_STATES))
    .refine((check) => Object.keys(check).length <= LIMITS.buildsPerDeploy)
    .optional(),
})
export type AppBuildsAnswer = z.infer<typeof AppBuildsAnswerSchema>

/**
 * Runner to CLI: the answer to `builds`. With no input, the apps that have
 * builds, sorted and each once, at most `LIMITS.appsPerServer`; with `apps`,
 * what the runner keeps of each, 1 to `LIMITS.buildsAppsPerRequest` of them,
 * so the answer stays within its 1 MiB frame (CO19). That it names exactly
 * the apps asked is the CLI's check.
 */
export const RunnerBuildsSchema = z.union([
  z.strictObject({
    built: z.array(appName).max(LIMITS.appsPerServer).refine(sortedAndUnique),
  }),
  z.strictObject({
    apps: z.record(appName, AppBuildsAnswerSchema).refine((apps) => {
      const named = Object.keys(apps).length
      return named >= 1 && named <= LIMITS.buildsAppsPerRequest
    }),
  }),
])
export type RunnerBuilds = z.infer<typeof RunnerBuildsSchema>

/** CLI to runner: `builder`, and with `usage` what images and the build cache take too, which costs the runner a slower Docker call (item 28). */
export const RunnerBuilderRequestSchema = z.strictObject({
  usage: z.literal(true).optional(),
})
export type RunnerBuilderRequest = z.infer<typeof RunnerBuilderRequestSchema>

/** Whether the server can build, as `builder` says it: the reasons are the refusals a deploy would get (CO10). */
export const BUILDER_CAN = [
  "yes",
  "no_docker",
  "docker_too_old",
  "no_build_plugin",
] as const

/** A buildx driver's name, as `docker buildx inspect` gives it. */
const DRIVER = /^[a-z][a-z0-9-]{0,31}$/

/**
 * Runner to CLI: what the server can build with (CO12's `BuilderAnswer`;
 * FR-034a, FR-078, FR-079). Docker Engine's, buildx's and BuildKit's
 * versions and buildx's driver, each null when not found; the processor;
 * memory and free disk in bytes, null when not known, and the floor; whether
 * it can build; `stale`, the build refs whose Docker record could not be
 * removed (item 28); and `usage`, the bytes images and the build cache take,
 * only when asked, null when Docker did not say. Versions and numbers only.
 */
export const RunnerBuilderSchema = z.strictObject({
  docker: z.strictObject({
    engine: dockerVersion.nullable(),
    buildx: dockerVersion.nullable(),
    buildkit: dockerVersion.nullable(),
    driver: z.string().regex(DRIVER).nullable(),
  }),
  arch: z.enum(ARCHES),
  memory: bytes.nullable(),
  disk: z.strictObject({ free: bytes.nullable(), floor: bytes }),
  can: z.enum(BUILDER_CAN),
  stale: count,
  usage: z.strictObject({ images: bytes, cache: bytes }).nullable().optional(),
})
export type RunnerBuilder = z.infer<typeof RunnerBuilderSchema>
