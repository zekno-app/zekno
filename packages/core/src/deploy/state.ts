import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import { SERVICE_NAME } from "../protocol/service-name"
import { secretVersion } from "../secrets/secret-record"
import { APP_NAME, SERVER_ID } from "../secrets/secrets"
import { TeamTrustSchema, type TeamTrust } from "../team/roster"
import {
  healthBytes,
  HealthInForceSchema,
  isRoutableDomain,
  RouteSchema,
  type Health,
  type Route,
} from "./routes-and-checks"

/**
 * What a runner remembers between deploys. The runner stores it; this library
 * only reads it and returns the next value.
 */
export type RunnerState = {
  readonly serverId: string
  readonly team: TeamTrust
  /** The last accepted deploy number for each app. */
  readonly lastSequence: Readonly<Record<string, number>>
  /**
   * The latest version accepted for each secret, keyed by "app/NAME", with
   * its ciphertext hash, or null when that version was a removal.
   */
  readonly secrets: Readonly<
    Record<string, { readonly version: number; readonly hash: string | null }>
  >
}

export const RunnerStateSchema = z.strictObject({
  serverId: z.string().regex(SERVER_ID),
  team: TeamTrustSchema,
  lastSequence: z.record(
    z.string().regex(APP_NAME),
    z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  ),
  secrets: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\/[A-Za-z_][A-Za-z0-9_]*$/),
    z.strictObject({
      version: secretVersion,
      hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .nullable(),
    })
  ),
})

/** The state of a server that has just pinned its team and accepted nothing yet. */
export function initialRunnerState(input: {
  serverId: string
  team: TeamTrust
}): RunnerState {
  const state = {
    serverId: input.serverId,
    team: input.team,
    lastSequence: {},
    secrets: {},
  }
  if (!RunnerStateSchema.safeParse(state).success) {
    throw new CoreError(
      "invalid_argument",
      "The server id or team trust is not valid."
    )
  }
  return state
}

/**
 * Validates state a runner read back from disk. Throws `CoreError` when it is
 * damaged or incomplete, so a runner never mistakes a broken file for an
 * empty one.
 */
export function parseRunnerState(value: unknown): RunnerState {
  return readVersionOneState(value as RunnerState)
}

/** Stored state is checked in full, so a damaged or incomplete file is an error, not a weaker check. */
export function readVersionOneState(state: RunnerState): RunnerState {
  const parsed = RunnerStateSchema.safeParse(state)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data as RunnerState
}

/*
 * The state a runner of the signed deploy's version 2 keeps (contracts/
 * state.md, as specs/015-domains-https/contracts/core.md changes it). It is
 * today's state with a mark, each app's message format and, since feature
 * 015, the routes and the health check in force: mark 3, as runner
 * 0.1.1-dev.1 writes it; and the released domains whose certificate is not
 * yet known to be deleted: mark 4. Any field runner 0.1.0 does not know makes
 * its strict read fail, so an older runner put back after this one has
 * written refuses everything; a runner of feature 014 refuses mark 3 too, and
 * runner 0.1.1-dev.1 refuses mark 4. No released runner wrote mark 3 before
 * an app's entry held its health check, so a mark-3 entry without one is
 * refused like any other field missing.
 */

/** At most this many containers of one service are routed or checked (core.md, "The state"; runner.md, RN4). */
export const CONTAINERS_PER_SERVICE = 16

/**
 * One app's routes in force, its health check in force, and the names the
 * runner gave its containers. The routes and the health check are written at
 * the same moment, from the same signed deploy (runner.md, RN9).
 */
export type AppRoutes = {
  /** The routes in force, sorted by domain. */
  readonly routes: readonly Route[]
  /** The health check of the deploy whose routes these are, or null when it had none. */
  readonly health: Health | null
  /** For each routed or checked service: the containers found and the name given to each, sorted by container. */
  readonly names: Readonly<
    Record<
      string,
      readonly { readonly container: string; readonly name: string }[]
    >
  >
}

/**
 * Today's state, with the mark, each app's format, the routes and health
 * checks in force, and the released domains whose certificate is still to
 * delete.
 */
export type StoredRunnerState = RunnerState & {
  readonly v: 4
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
}

/** The same set of keys, so no app has a number without a format or the reverse. */
const sameKeys = (a: object, b: object) => {
  const left = Object.keys(a)
  const right = new Set(Object.keys(b))
  return left.length === right.size && left.every((key) => right.has(key))
}

/** True when each name comes after the one before it, so the list is sorted and has no repeat. */
const sortedAndUnique = (names: readonly string[]) =>
  names.every((name, index) => index === 0 || names[index - 1]! < name)

const formats = z.record(
  z.string().regex(APP_NAME),
  z.union([z.literal(1), z.literal(2)])
)

/** The state of feature 014, marked 2: read as it was, then given no routes, so no health check, and no released domain. */
const MarkTwoSchema = z
  .strictObject({ v: z.literal(2), ...RunnerStateSchema.shape, formats })
  .refine((state) => sameKeys(state.formats, state.lastSequence))

const AppRoutesSchema = z
  .strictObject({
    routes: z.array(RouteSchema).max(LIMITS.routesPerDeploy),
    health: HealthInForceSchema.nullable(),
    names: z.record(
      z.string().regex(SERVICE_NAME),
      z
        .array(
          z.strictObject({
            /** A container's id, as Docker gives it. */
            container: z.string().regex(/^[0-9a-f]{64}$/),
            /** Its name on the app's route network: made by the runner from random bytes, never by a deploy. */
            name: z.string().regex(/^z[0-9a-f]{32}$/),
          })
        )
        .max(CONTAINERS_PER_SERVICE)
    ),
  })
  .refine((entry) => sortedAndUnique(entry.routes.map((route) => route.domain)))
  .refine((entry) =>
    Object.values(entry.names).every((found) =>
      sortedAndUnique(found.map((each) => each.container))
    )
  )
  // An app with neither a route nor a health check is not in `routes`; one
  // with a health check and no route has the names of its checked containers.
  .refine(
    (entry) =>
      entry.routes.length > 0 ||
      (entry.health !== null &&
        Object.values(entry.names).some((found) => found.length > 0))
  )

/**
 * The rules of the routes across apps (core.md, "The state"): every app in
 * `routes` at format 2, so a version-1 deploy can never be taken for an app
 * that holds a domain (FR-036); no domain held by two apps, and at most
 * `LIMITS.domainsPerServer` in all; each name once in the whole state; the
 * health checks in force at most `LIMITS.healthBytesPerServer`, as the
 * answer to `status` with routes writes them.
 */
function routesHold(state: {
  readonly formats: Readonly<Record<string, 1 | 2>>
  readonly routes: Readonly<Record<string, AppRoutes>>
}): boolean {
  const domains = new Set<string>()
  const names = new Set<string>()
  const health: Record<string, Health> = {}
  let held = 0
  for (const [app, entry] of Object.entries(state.routes)) {
    if (!Object.hasOwn(state.formats, app) || state.formats[app] !== 2)
      return false
    for (const route of entry.routes) domains.add(route.domain)
    held += entry.routes.length
    if (entry.health !== null) health[app] = entry.health
    for (const found of Object.values(entry.names))
      for (const each of found) {
        if (names.has(each.name)) return false
        names.add(each.name)
      }
  }
  return (
    domains.size === held &&
    held <= LIMITS.domainsPerServer &&
    healthBytes(health) <= LIMITS.healthBytesPerServer
  )
}

/** The fields of mark 3: today's, each app's format, and the routes and health checks in force. */
const markThree = {
  ...RunnerStateSchema.shape,
  formats,
  routes: z.record(z.string().regex(APP_NAME), AppRoutesSchema),
}

/** The state of runner 0.1.1-dev.1, marked 3: read by its strict rules, then given no released domain. */
const MarkThreeSchema = z
  .strictObject({ v: z.literal(3), ...markThree })
  .refine((state) => sameKeys(state.formats, state.lastSequence))
  .refine(routesHold)

/**
 * The rules of the released domains (core.md, "The state"): sorted and each
 * once; none in force for any app, so a domain that is routed is never
 * deleted; and the domains in force with them at most
 * `LIMITS.domainsPerServer`, which K15 holds every deploy to (runner.md,
 * RN2). Each is a domain by the domain rule, checked by the schema.
 */
function releasedHold(state: {
  readonly routes: Readonly<Record<string, AppRoutes>>
  readonly released: readonly string[]
}): boolean {
  if (!sortedAndUnique(state.released)) return false
  const inForce = new Set<string>()
  for (const entry of Object.values(state.routes))
    for (const route of entry.routes) inForce.add(route.domain)
  return (
    state.released.every((domain) => !inForce.has(domain)) &&
    inForce.size + state.released.length <= LIMITS.domainsPerServer
  )
}

const StoredRunnerStateSchema = z
  .strictObject({
    v: z.literal(4),
    ...markThree,
    released: z
      .array(z.string().refine(isRoutableDomain))
      .max(LIMITS.domainsPerServer),
  })
  .refine((state) => sameKeys(state.formats, state.lastSequence))
  .refine(routesHold)
  .refine(releasedHold)

/** Reads a state marked 4 strictly, or throws `CoreError`. A state with another mark, or none, is not read here. */
export function readMarked(value: unknown): StoredRunnerState {
  const parsed = StoredRunnerStateSchema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data as StoredRunnerState
}

/** `value` read by an older mark's strict schema, or `CoreError`. */
function readOlderMark<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data
}

/**
 * Reads the state a runner read back from disk (ST1, as core.md changes it).
 * Marked 4, it is read strictly. Marked 3, as runner 0.1.1-dev.1 wrote it,
 * it is read by mark 3's strict rules and given no released domain. Marked
 * 2, as a runner of feature 014 wrote it, it is read by that feature's
 * strict rules and given no routes, so no health check in force either, and
 * no released domain. Without a mark, it is a state from before version 2:
 * read by today's strict schema, then marked in memory (ST2), each app with a
 * number of 1 or more at format 1 and each at 0 at format 2, and given no
 * routes and no released domain. Nothing is written by reading, and the
 * value given is not changed. Throws `CoreError` for anything else, which a
 * runner answers `invalid_state`, never "nothing accepted yet".
 */
export function readRunnerState(value: unknown): StoredRunnerState {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "v")
  ) {
    const mark = (value as { v: unknown }).v
    if (mark === 3) {
      const three = readOlderMark(MarkThreeSchema, value)
      return readMarked({ ...three, v: 4, released: [] })
    }
    if (mark === 2) {
      const two = readOlderMark(MarkTwoSchema, value)
      return readMarked({ ...two, v: 4, routes: {}, released: [] })
    }
    return readMarked(value)
  }
  const older = parseRunnerState(value)
  const formats: Record<string, 1 | 2> = {}
  for (const [app, last] of Object.entries(older.lastSequence))
    formats[app] = last >= 1 ? 1 : 2
  return readMarked({ v: 4, ...older, formats, routes: {}, released: [] })
}

/**
 * The state a runner of this feature writes at setup (ST3): marked 4, with
 * no route and no released domain. It has no format for any app, so it takes
 * no version-1 deploy at all.
 */
export function newRunnerState(input: {
  serverId: string
  team: TeamTrust
}): StoredRunnerState {
  return readMarked({
    v: 4,
    ...initialRunnerState(input),
    formats: {},
    routes: {},
    released: [],
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
 * part as it was, the routes in force and the released domains among them.
 * Saving `next` itself would drop the mark, the formats, the routes and the
 * released domains (V21). Throws `CoreError` when `next` drops an app or adds one without a
 * format (ST8): the version-1 path takes only apps it already holds.
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
