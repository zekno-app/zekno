/**
 * The state a runner keeps, marked 4, and how a state of an earlier mark is
 * read forward to it. The state of version 1 and the older marks' strict
 * rules are in `state-marks.ts`; every name this file exported before they
 * moved there is still exported from here.
 */
import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import type { TeamTrust } from "../team/roster"
import { isRoutableDomain } from "./routes-and-checks"
import {
  initialRunnerState,
  markThree,
  MarkThreeSchema,
  MarkTwoSchema,
  parseRunnerState,
  readOlderMark,
  readVersionOneState,
  releasedHold,
  routesHold,
  sameKeys,
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
