import { z } from "zod"

import { CoreError } from "../protocol/result"
import { secretVersion } from "../secrets/secret-record"
import { APP_NAME, SERVER_ID } from "../secrets/secrets"
import { TeamTrustSchema, type TeamTrust } from "../team/roster"

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
 * state.md). It is today's state with a mark, `v: 2`, and each app's message
 * format. Any field runner 0.1.0 does not know makes its strict read fail, so
 * an older runner put back after this one has written refuses everything.
 */

/** Today's state, with the mark and each app's format. */
export type StoredRunnerState = RunnerState & {
  readonly v: 2
  /** Each app's message format: 1 while it may still take version 1, 2 after its first version-2 deploy. */
  readonly formats: Readonly<Record<string, 1 | 2>>
}

/** The same set of keys, so no app has a number without a format or the reverse. */
const sameKeys = (a: object, b: object) => {
  const left = Object.keys(a)
  const right = new Set(Object.keys(b))
  return left.length === right.size && left.every((key) => right.has(key))
}

const StoredRunnerStateSchema = z
  .strictObject({
    v: z.literal(2),
    ...RunnerStateSchema.shape,
    formats: z.record(
      z.string().regex(APP_NAME),
      z.union([z.literal(1), z.literal(2)])
    ),
  })
  .refine((state) => sameKeys(state.formats, state.lastSequence))

/** Reads a marked state strictly, or throws `CoreError`. A state without the mark is not read here. */
export function readMarked(value: unknown): StoredRunnerState {
  const parsed = StoredRunnerStateSchema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The runner state is not valid.")
  return parsed.data as StoredRunnerState
}

/**
 * Reads the state a runner read back from disk (ST1). With its own field `v`,
 * it is read strictly as a marked state. Without one, it is a state from
 * before version 2: read by today's strict schema, then marked in memory
 * (ST2), each app with a number of 1 or more at format 1 and each at 0 at
 * format 2. Nothing is written by reading, and the value given is not
 * changed. Throws `CoreError` for anything else, which a runner answers
 * `invalid_state`, never "nothing accepted yet".
 */
export function readRunnerState(value: unknown): StoredRunnerState {
  if (typeof value === "object" && value !== null && Object.hasOwn(value, "v"))
    return readMarked(value)
  const older = parseRunnerState(value)
  const formats: Record<string, 1 | 2> = {}
  for (const [app, last] of Object.entries(older.lastSequence))
    formats[app] = last >= 1 ? 1 : 2
  return readMarked({ v: 2, ...older, formats })
}

/**
 * The state a runner of this feature writes at setup (ST3). It has no format
 * for any app, so it takes no version-1 deploy at all.
 */
export function newRunnerState(input: {
  serverId: string
  team: TeamTrust
}): StoredRunnerState {
  return readMarked({ v: 2, ...initialRunnerState(input), formats: {} })
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
 * part as it was. Saving `next` itself would drop the mark and the formats
 * (V21). Throws `CoreError` when `next` drops an app or adds one without a
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
