/**
 * The state a runner keeps, marked 5, and how a state of an earlier mark is
 * read forward to it (specs/016-build-from-source, contracts/core.md CO13).
 * The state of version 1 and the older marks' strict rules are in
 * `state-marks.ts`; every name this file exported before they moved there is
 * still exported from here. The functions that change an app's builds or the
 * build in progress, each read back through these rules, are in
 * `kept-builds.ts`.
 */
import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import { APP_NAME } from "../secrets/secrets"
import { isoTime, type TeamTrust } from "../team/roster"
import {
  BUILD_REASONS,
  BUILDING_LIMIT_SECONDS,
  BUILDING_PHASES,
  DIGEST,
  type BuildingPhase,
  type BuildReason,
} from "./build-record"
import {
  initialRunnerState,
  markFour,
  MarkFourSchema,
  MarkThreeSchema,
  MarkTwoSchema,
  parseRunnerState,
  readOlderMark,
  readVersionOneState,
  releasedHold,
  routesHold,
  sameKeys,
  sortedAndUnique,
  type AppRoutes,
  type RunnerState,
} from "./state-marks"

export {
  CONTAINERS_PER_SERVICE,
  initialRunnerState,
  parseRunnerState,
  readVersionOneState,
  RunnerStateSchema,
  type AppRoutes,
  type RunnerState,
} from "./state-marks"

/** How a deploy's builds ended, as the state's `last` records it (CO13). */
export const BUILD_OUTCOMES = ["built", "reused", "build_failed"] as const
export type BuildOutcome = (typeof BUILD_OUTCOMES)[number]

/** An image the runner made: its build key and the digests it recorded (CO13, CO14). */
export type KeptImage = {
  readonly key: string
  readonly manifest: string
  readonly config: string
}

/** One app's builds, as the runner keeps them (CO13; FR-045, FR-066, FR-067). */
export type AppBuilds = {
  /** The deploy whose Compose text is in force, or null. */
  readonly running: number | null
  /** The images kept, sorted by key, each once: exactly the keys `deploys` names. */
  readonly images: readonly KeptImage[]
  /** The deploys whose images are kept, newest first, each with its keys sorted. */
  readonly deploys: readonly {
    readonly sequence: number
    readonly keys: readonly string[]
  }[]
  /** Images to remove, sorted by key, each kept here until its removal succeeded (RB14). */
  readonly drop: readonly KeptImage[]
  /** Each base built fresh, sorted by base, with the deploy that last did. */
  readonly fresh: readonly {
    readonly base: string
    readonly sequence: number
  }[]
  /** How the app's last deploy that built ended, why when it failed, and when (FR-045). */
  readonly last: {
    readonly sequence: number
    readonly outcome: BuildOutcome
    readonly reason: BuildReason | null
    readonly at: string
  } | null
}

/**
 * The deploy that builds, while it holds the deploy lock or a stopped
 * build's record still runs (CO13; FR-045, RB15). Written with the number,
 * before any build client starts, so a runner that dies leaves its run token
 * for the next request.
 */
export type Building = {
  readonly app: string
  /** The app's last number: the deploy that builds. */
  readonly sequence: number
  readonly keys: readonly string[]
  readonly since: string
  /** Seconds its builds may take together. */
  readonly limit: number
  readonly phase: BuildingPhase
  /** The token every build client of this deploy carries (RB15). */
  readonly run: string
  /** When the runner stopped it: a time exactly while `phase` is `stopping`. */
  readonly stopped: string | null
}

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const digest = z.string().regex(DIGEST)
/** A deploy's number: one that was used, so 1 or more. */
const sequence = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

/** An image the runner made, in `images`, in `drop`, and as `keepAfter` takes it. */
export const KeptImageSchema = z.strictObject({
  key: hex64,
  manifest: digest,
  config: digest,
})

const keysOf = (images: readonly KeptImage[]) =>
  images.map((image) => image.key)

/** A list of images, at most `LIMITS.keptImagesPerApp`, sorted by key, each once. */
const images = z
  .array(KeptImageSchema)
  .max(LIMITS.keptImagesPerApp)
  .refine((list) => sortedAndUnique(keysOf(list)))

/** The keys of a deploy, or of the build in progress: 1 to 8, sorted, each once. */
const deployKeys = z
  .array(hex64)
  .min(1)
  .max(LIMITS.buildsPerDeploy)
  .refine(sortedAndUnique)

/**
 * The keys the deploys name together are exactly the images kept, and no
 * image is both kept and to remove, so `deploys` and `images` agree at every
 * write (CO13, FR-067).
 */
function keptHold(entry: {
  readonly images: readonly KeptImage[]
  readonly deploys: readonly { readonly keys: readonly string[] }[]
  readonly drop: readonly KeptImage[]
}): boolean {
  const kept = new Set(keysOf(entry.images))
  const named = new Set(entry.deploys.flatMap((deploy) => deploy.keys))
  return (
    named.size === kept.size &&
    [...named].every((key) => kept.has(key)) &&
    entry.drop.every((image) => !kept.has(image.key))
  )
}

/**
 * One app's entry in `builds`, by its own rules (CO13). The rules that need
 * the whole state, its format and its last number, are `buildsHold`'s.
 */
export const AppBuildsSchema = z
  .strictObject({
    running: sequence.nullable(),
    images,
    deploys: z
      .array(z.strictObject({ sequence, keys: deployKeys }))
      .max(LIMITS.keptDeploysPerApp)
      // Newest first, each once.
      .refine((list) =>
        list.every(
          (deploy, index) =>
            index === 0 || list[index - 1]!.sequence > deploy.sequence
        )
      ),
    drop: images,
    fresh: z
      .array(z.strictObject({ base: hex64, sequence }))
      .max(LIMITS.freshPerApp)
      .refine((list) => sortedAndUnique(list.map((each) => each.base))),
    last: z
      .strictObject({
        sequence,
        outcome: z.enum(BUILD_OUTCOMES),
        reason: z.enum(BUILD_REASONS).nullable(),
        at: isoTime,
      })
      .nullable(),
  })
  .refine(keptHold)

/** The build in progress, by its own rules (CO13). Its app and number are checked against the state by `buildsHold`. */
export const BuildingSchema = z
  .strictObject({
    app: z.string().regex(APP_NAME),
    sequence,
    keys: deployKeys,
    since: isoTime,
    limit: z.number().int().min(1).max(BUILDING_LIMIT_SECONDS),
    phase: z.enum(BUILDING_PHASES),
    run: z.string().regex(/^[0-9a-f]{32}$/),
    stopped: isoTime.nullable(),
  })
  .refine(
    (building) =>
      (building.phase === "stopping") === (building.stopped !== null)
  )

/**
 * The rules of the builds across the state (CO13): every app in `builds` at
 * format 2; every number an entry holds at most the app's last number; the
 * build in progress of an app the state knows, at its last number. Written
 * so a state that already broke another rule reads as broken, never throws.
 */
function buildsHold(state: {
  readonly lastSequence: Readonly<Record<string, number>>
  readonly formats: Readonly<Record<string, 1 | 2>>
  readonly builds: Readonly<Record<string, AppBuilds>>
  readonly building: Building | null
}): boolean {
  const lastOf = (app: string) =>
    Object.hasOwn(state.lastSequence, app) ? state.lastSequence[app]! : 0
  for (const [app, entry] of Object.entries(state.builds)) {
    if (!Object.hasOwn(state.formats, app) || state.formats[app] !== 2)
      return false
    const numbers = [
      ...(entry.running === null ? [] : [entry.running]),
      ...entry.deploys.map((deploy) => deploy.sequence),
      ...entry.fresh.map((each) => each.sequence),
      ...(entry.last === null ? [] : [entry.last.sequence]),
    ]
    const last = lastOf(app)
    if (numbers.some((number) => number > last)) return false
  }
  const building = state.building
  return (
    building === null ||
    (Object.hasOwn(state.formats, building.app) &&
      lastOf(building.app) === building.sequence)
  )
}

/**
 * Today's state, with the mark, each app's format, the routes and health
 * checks in force, the released domains whose certificate is still to
 * delete, each app's builds kept, and the build in progress.
 */
export type StoredRunnerState = RunnerState & {
  readonly v: 5
  /** Each app's message format: 1 while it may still take version 1, 2 after its first version-2 deploy. */
  readonly formats: Readonly<Record<string, 1 | 2>>
  /** The routes and the health check in force of each app that has a route or a health check. */
  readonly routes: Readonly<Record<string, AppRoutes>>
  /**
   * The domains released whose certificate and key are not yet known to be
   * deleted from the proxy's volume, sorted (runner.md, RN10). None is in
   * force: a domain routed again is taken off, and keeps its certificate.
   */
  readonly released: readonly string[]
  /** The builds of each app that has built, by app (CO13, FR-067). */
  readonly builds: Readonly<Record<string, AppBuilds>>
  /** The deploy that builds, or null (CO13, RB15). */
  readonly building: Building | null
}

const StoredRunnerStateSchema = z
  .strictObject({
    v: z.literal(5),
    ...markFour,
    builds: z.record(z.string().regex(APP_NAME), AppBuildsSchema),
    building: BuildingSchema.nullable(),
  })
  .refine((state) => sameKeys(state.formats, state.lastSequence))
  .refine(routesHold)
  .refine(releasedHold)
  .refine(buildsHold)

/** Reads a state marked 5 strictly, or throws `CoreError`. A state with another mark, or none, is not read here. */
export function readMarked(value: unknown): StoredRunnerState {
  const parsed = StoredRunnerStateSchema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data as StoredRunnerState
}

/** A state of an earlier mark, with mark 4's fields, marked 5 with no builds and no build in progress. */
const readForward = (older: object): StoredRunnerState =>
  readMarked({ ...older, v: 5, builds: {}, building: null })

/**
 * Reads the state a runner read back from disk (ST1, as CO13 changes it).
 * Marked 5, it is read strictly. Marked 4, as runner 0.1.1 wrote it, it is
 * read by mark 4's strict rules. Marked 3, as runner 0.1.1-dev.1 wrote it,
 * it is read by mark 3's strict rules and given no released domain. Marked
 * 2, as a runner of feature 014 wrote it, it is read by that feature's
 * strict rules and given no routes, so no health check in force either, and
 * no released domain. Without a mark, it is a state from before version 2:
 * read by today's strict schema, then marked in memory (ST2), each app with a
 * number of 1 or more at format 1 and each at 0 at format 2, and given no
 * routes and no released domain. Each earlier mark is given no builds and no
 * build in progress. Nothing is written by reading, and the value given is
 * not changed. Throws `CoreError` for anything else, a mark of 6 or more
 * among it, which a runner answers `invalid_state`, never "nothing accepted
 * yet".
 */
export function readRunnerState(value: unknown): StoredRunnerState {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "v")
  ) {
    const mark = (value as { v: unknown }).v
    if (mark === 4) return readForward(readOlderMark(MarkFourSchema, value))
    if (mark === 3) {
      const three = readOlderMark(MarkThreeSchema, value)
      return readForward({ ...three, released: [] })
    }
    if (mark === 2) {
      const two = readOlderMark(MarkTwoSchema, value)
      return readForward({ ...two, routes: {}, released: [] })
    }
    return readMarked(value)
  }
  const older = parseRunnerState(value)
  const formats: Record<string, 1 | 2> = {}
  for (const [app, last] of Object.entries(older.lastSequence))
    formats[app] = last >= 1 ? 1 : 2
  return readForward({ ...older, formats, routes: {}, released: [] })
}

/**
 * The state a runner of this feature writes at setup (ST3): marked 5, with
 * no route, no released domain, no builds and no build in progress. It has
 * no format for any app, so it takes no version-1 deploy at all.
 */
export function newRunnerState(input: {
  serverId: string
  team: TeamTrust
}): StoredRunnerState {
  return readMarked({
    v: 5,
    ...initialRunnerState(input),
    formats: {},
    routes: {},
    released: [],
    builds: {},
    building: null,
  })
}

/** The part of the stored state that `verifyDeploy` reads (ST5). */
export function versionOneView(state: StoredRunnerState): RunnerState {
  const marked = readMarked(state)
  return {
    serverId: marked.serverId,
    team: marked.team,
    lastSequence: marked.lastSequence,
    secrets: marked.secrets,
  }
}

/**
 * The state to save after a version-1 deploy (ST5): `state` with the numbers
 * and secret versions of `next`, what `verifyDeploy` gave, and every other
 * part as it was, the routes in force, the released domains, the builds and
 * the build in progress among them. Saving `next` itself would drop the
 * mark, the formats, the routes, the released domains and the builds (V21).
 * Throws `CoreError` when `next` drops an app or adds one without a format
 * (ST8): the version-1 path takes only apps it already holds.
 */
export function afterVersionOneDeploy(
  state: StoredRunnerState,
  next: RunnerState
): StoredRunnerState {
  const marked = readMarked(state)
  const view = readVersionOneState(next)
  return readMarked({
    ...marked,
    lastSequence: view.lastSequence,
    secrets: view.secrets,
  })
}

/** Whether an app may still take a version-1 deploy (ST6): only at format 1. */
export function takesVersionOne(
  state: StoredRunnerState,
  app: string
): boolean {
  return Object.hasOwn(state.formats, app) && state.formats[app] === 1
}
