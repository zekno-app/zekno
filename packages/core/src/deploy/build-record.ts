/**
 * The build record and the values it shares with the report, the state and
 * the answers (specs/016-build-from-source, contracts/core.md CO14, CO10;
 * FR-031a, FR-066). `protocol/build-messages.ts` and `deploy/state.ts` import
 * these values from here, so neither imports the other.
 *
 * A record is the server's word, shown as such and never signed. Every field
 * is held to a pattern or a list, so no line the builder printed can travel
 * in it.
 */
import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import { isoTime } from "../team/roster"
import { ImageRefSchema } from "./image-ref"

/**
 * Why a build failed or was stopped, chosen by the runner from what it did and
 * saw (CO10, FR-031a). `runner_restarted` is only ever in the state and in
 * `builds`, never in a `deploy` answer (RB16).
 */
export const BUILD_REASONS = [
  "step_failed",
  "out_of_memory",
  "out_of_disk",
  "time_limit",
  "wrong_processor",
  "cache_used",
  "team_changed",
  "runner_restarted",
] as const
export type BuildReason = (typeof BUILD_REASONS)[number]

/** A processor, as an image or a server has it (CO10, `Arch`). */
export const ARCHES = ["amd64", "arm64", "other"] as const
export type Arch = (typeof ARCHES)[number]

/**
 * Where a deploy that builds stands while it holds the deploy lock: the
 * state's `building`, the `busy` report's and the `builds` answer's (CO10,
 * CO12, CO13).
 */
export const BUILDING_PHASES = ["building", "stopping", "starting"] as const
export type BuildingPhase = (typeof BUILDING_PHASES)[number]

/** The longest time a deploy's builds may take together, in seconds: 8 builds of 2 hours, 57,600 (CO10, CO13). */
export const BUILDING_LIMIT_SECONDS =
  LIMITS.buildsPerDeploy * LIMITS.buildSeconds

/** An image's manifest or config digest, or a frontend's (CO13, CO14). */
export const DIGEST = /^sha256:[0-9a-f]{64}$/

/**
 * A version of Docker Engine, buildx or BuildKit: three numbers and an
 * optional suffix (CO10, CO14). The runner drops a leading `v` before it
 * writes one, so a `v` here is refused.
 */
export const DOCKER_VERSION =
  /^\d{1,4}\.\d{1,4}\.\d{1,6}([-+][0-9A-Za-z.-]{1,64})?$/

/** A Railpack version, by the rule of the signed build entry (CO1, `builder.version`). */
const RAILPACK_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/

const digest = z.string().regex(DIGEST)
const dockerVersion = z.string().regex(DOCKER_VERSION)

/** True when each text comes after the one before it, so the list is sorted and has no repeat. */
const sortedAndUnique = (texts: readonly string[]) =>
  texts.every((text, index) => index === 0 || texts[index - 1]! < text)

/**
 * What read the build's instructions: Docker's built-in Dockerfile reader
 * with its version, or the Railpack frontend by its digest (CO14).
 */
const ReaderSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dockerfile"), version: dockerVersion }),
  z.strictObject({ kind: z.literal("railpack"), frontend: digest }),
])

/**
 * The runner's record of one build: its side file `kept/<app>/<key>.json`
 * and an entry of `records` in the answer to `builds` (CO12, CO14). Strict,
 * with its keys in CO14's order. `railpack` is the Railpack version exactly
 * for a Railpack build, and the reader's kind is the builder's.
 */
export const BuildRecordSchema = z
  .strictObject({
    key: z.string().regex(/^[0-9a-f]{64}$/),
    manifest: digest,
    config: digest,
    builder: z.enum(["dockerfile", "railpack"]),
    railpack: z.string().regex(RAILPACK_VERSION).nullable(),
    docker: z.strictObject({
      engine: dockerVersion,
      buildx: dockerVersion,
      buildkit: dockerVersion,
    }),
    reader: ReaderSchema,
    /** A cached step other than `FROM` was used. */
    cache: z.boolean(),
    /** The base images by digest, sorted, each once. */
    bases: z
      .array(ImageRefSchema)
      .max(LIMITS.baseDigestsPerBuild)
      .refine(sortedAndUnique),
    arch: z.enum(ARCHES),
    built: isoTime,
  })
  .refine(
    (record) =>
      (record.builder === "railpack") === (record.railpack !== null) &&
      record.reader.kind === record.builder
  )
export type BuildRecord = z.infer<typeof BuildRecordSchema>

/**
 * Reads a build record, from the runner's side file or a `builds` answer,
 * with its keys in CO14's order. Throws `CoreError("invalid_argument")` for
 * anything outside the schema; the message never repeats the input.
 */
export function readBuildRecord(value: unknown): BuildRecord {
  const parsed = BuildRecordSchema.safeParse(value)
  if (!parsed.success)
    throw new CoreError(
      "invalid_argument",
      "The build record does not match its definition."
    )
  return parsed.data
}
