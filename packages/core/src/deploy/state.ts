import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import { SERVICE_NAME } from "../protocol/service-name"
import { secretVersion } from "../secrets/secret-record"
import { APP_NAME, SERVER_ID } from "../secrets/secrets"
import { TeamTrustSchema, type TeamTrust } from "../team/roster"
import { RouteSchema, type Route } from "./routes-and-checks"

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
 * 015, the routes in force: mark 3. Any field runner 0.1.0 does not know
 * makes its strict read fail, so an older runner put back after this one has
 * written refuses everything; a runner of feature 014 refuses mark 3 too.
 */

/** At most this many containers of one service are routed or checked (core.md, "The state"; runner.md, RN4). */
export const CONTAINERS_PER_SERVICE = 16

/** One app's routes in force, and the names the runner gave its containers. */
export type AppRoutes = {
  /** The routes in force, sorted by domain. */
  readonly routes: readonly Route[]
  /** For each routed or checked service: the containers found and the name given to each, sorted by container. */
  readonly names: Readonly<
    Record<
      string,
      readonly { readonly container: string; readonly name: string }[]
    >
  >
}

/** Today's state, with the mark, each app's format and the routes in force. */
export type StoredRunnerState = RunnerState & {
  readonly v: 3
  /** Each app's message format: 1 while it may still take version 1, 2 after its first version-2 deploy. */
  readonly formats: Readonly<Record<string, 1 | 2>>
  /** The routes in force of each app that has a route or a health check. */
  readonly routes: Readonly<Record<string, AppRoutes>>
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

/** The state of feature 014, marked 2: read as it was, then given no routes. */
const MarkTwoSchema = z
  .strictObject({ v: z.literal(2), ...RunnerStateSchema.shape, formats })
  .refine((state) => sameKeys(state.formats, state.lastSequence))

const AppRoutesSchema = z
  .strictObject({
    routes: z.array(RouteSchema).max(LIMITS.routesPerDeploy),
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
  // An app with neither a route nor a name is not in `routes`.
  .refine(
    (entry) =>
      entry.routes.length > 0 ||
      Object.values(entry.names).some((found) => found.length > 0)
  )

/**
 * The rules of the routes across apps (core.md, "The state"): every app in
 * `routes` at format 2, so a version-1 deploy can never be taken for an app
 * that holds a domain (FR-036); no domain held by two apps, and at most
 * `LIMITS.domainsPerServer` in all; each name once in the whole state.
 */
function routesHold(state: {
  readonly formats: Readonly<Record<string, 1 | 2>>
  readonly routes: Readonly<Record<string, AppRoutes>>
}): boolean {
  const domains = new Set<string>()
  const names = new Set<string>()
  let held = 0
  for (const [app, entry] of Object.entries(state.routes)) {
    if (!Object.hasOwn(state.formats, app) || state.formats[app] !== 2)
      return false
    for (const route of entry.routes) domains.add(route.domain)
    held += entry.routes.length
    for (const found of Object.values(entry.names))
      for (const each of found) {
        if (names.has(each.name)) return false
        names.add(each.name)
      }
  }
  return domains.size === held && held <= LIMITS.domainsPerServer
}

const StoredRunnerStateSchema = z
  .strictObject({
    v: z.literal(3),
    ...RunnerStateSchema.shape,
    formats,
    routes: z.record(z.string().regex(APP_NAME), AppRoutesSchema),
  })
  .refine((state) => sameKeys(state.formats, state.lastSequence))
  .refine(routesHold)

/** Reads a state marked 3 strictly, or throws `CoreError`. A state with another mark, or none, is not read here. */
export function readMarked(value: unknown): StoredRunnerState {
  const parsed = StoredRunnerStateSchema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data as StoredRunnerState
}

/**
 * Reads the state a runner read back from disk (ST1, as core.md changes it).
 * Marked 3, it is read strictly. Marked 2, as a runner of feature 014 wrote
 * it, it is read by that feature's strict rules and given no routes. Without
 * a mark, it is a state from before version 2: read by today's strict schema,
 * then marked in memory (ST2), each app with a number of 1 or more at format
 * 1 and each at 0 at format 2, and given no routes. Nothing is written by
 * reading, and the value given is not changed. Throws `CoreError` for
 * anything else, which a runner answers `invalid_state`, never "nothing
 * accepted yet".
 */
export function readRunnerState(value: unknown): StoredRunnerState {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "v")
  ) {
    if ((value as { v: unknown }).v !== 2) return readMarked(value)
    const two = MarkTwoSchema.safeParse(value)
    if (!two.success)
      throw new CoreError("invalid_argument", "The runner state is not valid.")
    return readMarked({ ...two.data, v: 3, routes: {} })
  }
  const older = parseRunnerState(value)
  const formats: Record<string, 1 | 2> = {}
  for (const [app, last] of Object.entries(older.lastSequence))
    formats[app] = last >= 1 ? 1 : 2
  return readMarked({ v: 3, ...older, formats, routes: {} })
}

/**
 * The state a runner of this feature writes at setup (ST3): marked 3, with
 * no route. It has no format for any app, so it takes no version-1 deploy at
 * all.
 */
export function newRunnerState(input: {
  serverId: string
  team: TeamTrust
}): StoredRunnerState {
  return readMarked({
    v: 3,
    ...initialRunnerState(input),
    formats: {},
    routes: {},
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
 * part as it was, the routes in force among them. Saving `next` itself would
 * drop the mark, the formats and the routes (V21). Throws `CoreError` when `next` drops an app or adds one without a
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
