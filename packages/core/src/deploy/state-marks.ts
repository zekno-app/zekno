/**
 * The state of version 1 and the strict rules of the older marks, which
 * `state.ts` reads forward to mark 5. It imports nothing from `state.ts`.
 */
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
 * 0.1.1-dev.1 writes it; the released domains whose certificate is not yet
 * known to be deleted: mark 4, as runner 0.1.1 writes it; and, since feature
 * 016, the builds kept and the build in progress: mark 5 (`state.ts`). Any
 * field runner 0.1.0 does not know makes its strict read fail, so an older
 * runner put back after this one has written refuses everything; a runner of
 * feature 014 refuses mark 3 too, runner 0.1.1-dev.1 refuses mark 4, and
 * runner 0.1.1 refuses mark 5 (FR-085). No released runner wrote mark 3 before
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

/** The same set of keys, so no app has a number without a format or the reverse. */
export const sameKeys = (a: object, b: object) => {
  const left = Object.keys(a)
  const right = new Set(Object.keys(b))
  return left.length === right.size && left.every((key) => right.has(key))
}

/** True when each name comes after the one before it, so the list is sorted and has no repeat. */
export const sortedAndUnique = (names: readonly string[]) =>
  names.every((name, index) => index === 0 || names[index - 1]! < name)

export const formats = z.record(
  z.string().regex(APP_NAME),
  z.union([z.literal(1), z.literal(2)])
)

/** The state of feature 014, marked 2: read as it was, then given no routes, so no health check, and no released domain. */
export const MarkTwoSchema = z
  .strictObject({ v: z.literal(2), ...RunnerStateSchema.shape, formats })
  .refine((state) => sameKeys(state.formats, state.lastSequence))

export const AppRoutesSchema = z
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
export function routesHold(state: {
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
export const markThree = {
  ...RunnerStateSchema.shape,
  formats,
  routes: z.record(z.string().regex(APP_NAME), AppRoutesSchema),
}

/** The state of runner 0.1.1-dev.1, marked 3: read by its strict rules, then given no released domain. */
export const MarkThreeSchema = z
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
export function releasedHold(state: {
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

/** The fields of mark 4: mark 3's, and the released domains whose certificate is still to delete. */
export const markFour = {
  ...markThree,
  released: z
    .array(z.string().refine(isRoutableDomain))
    .max(LIMITS.domainsPerServer),
}

/**
 * The state of runner 0.1.1, marked 4: read by its strict rules, then given
 * no builds and no build in progress (specs/016-build-from-source,
 * contracts/core.md CO13).
 */
export const MarkFourSchema = z
  .strictObject({ v: z.literal(4), ...markFour })
  .refine((state) => sameKeys(state.formats, state.lastSequence))
  .refine(routesHold)
  .refine(releasedHold)

/** `value` read by an older mark's strict schema, or `CoreError`. */
export function readOlderMark<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data
}
