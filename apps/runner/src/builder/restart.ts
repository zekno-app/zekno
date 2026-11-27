/**
 * A restart during a build (specs/016-build-from-source, contracts/runner.md
 * RB15; FR-031b, FR-039, FR-045, FR-050; plan item 28 (b)). The runner runs
 * only while a request is handled, so a runner that died during a build
 * leaves the state's `building` set, with the run token its build clients
 * carry, and nothing watches that build any more. A request that takes the
 * deploy lock D runs `restart`; `sync`, `pack`, `builds` and `status` run
 * `boundedRestart` when they get D at once (RB1). The steps:
 *
 *   1. `stopRun` for the token (run-processes.ts); under S, phase
 *      `stopping` and its time, kept when already set.
 *   2. Up to 120 seconds, until no record of a ref in `<home>/buildx/refs`
 *      runs, each removed (RB12); while one runs, `building` stays and the
 *      request is `busy`. Item 28 (b): once no process of the run is alive
 *      and a record has run 10 minutes past the stop, the steps go on and
 *      its ref file stays (`builder` counts it `stale`).
 *   3. Each key's tag removed, never with `-f`, when its `.Id` is none of
 *      the digests the state records for the key (RB11's `removeLeftover`).
 *   4. `building/<app>/` and everything in `unpackedDir()` deleted.
 *   5. Under S: `last` is `build_failed`, `runner_restarted`, unless it
 *      already names this deploy (RB10 wrote it); `building` cleared.
 *
 * Phase `starting` (the runner died during `up`, routes or health): steps 1
 * to 4 have nothing to do, and `last` stays as B3 wrote it. The bounded
 * part looks at each record once and never waits, and so that its request
 * is delayed by seconds (RB15), the first Docker call of steps 2 and 3
 * that does not end well ends it: a record not seen to end, a removal that
 * failed or was cut. `building` then stays with phase `stopping`, and the
 * next request that gets the deploy lock carries on. S is taken only for
 * the state writes, with no Docker call under it (RB1); the deploy's number
 * stays used, and the running app is never touched.
 *
 *   const done = await restart(dir, state)
 *   if (!done.cleared) return busy()          // a record still runs
 */
import { existsSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  readRunnerState,
  withAppBuilds,
  withBuilding,
  type AppBuilds,
  type Building,
  type RunnerReport,
  type StoredRunnerState,
} from "@workspace/core"

import {
  defaultUnpacked,
  paths,
  readState,
  unpackedDir,
  writeState,
} from "../home/home"
import { STATE_WAIT_MS, withStateLock } from "../home/locks"
import { removeLeftover } from "../kept/leftovers"
import { recordState, refsNow, removeRecord, type BuildRef } from "./history"
import { runProcesses, stopRun, type StopOptions } from "./run-processes"

export { runProcesses, stopRun, type StopOptions } from "./run-processes"

/** How long `restart` waits for the records (step 2). */
const WAIT_MS = 120_000
/** How often the records are looked at again during that wait. */
const EVERY_MS = 1000
/** How long a record may run past the stop with no process of the run alive before it is taken as stale (item 28 (b)). */
const STALE_MS = 10 * 60_000
/** How long one look at a record, and in the bounded part each other Docker call, may take. */
const LOOK_MS = 10_000
/** How long the bounded part waits for the state lock: its request is delayed by seconds, never by RB1's 120. */
const BOUNDED_STATE_WAIT_MS = 10_000

/** The bounds of RB15, each as the contract sets it when not said; tests pass milliseconds. */
export type RestartBounds = StopOptions & {
  /** How long `restart` waits for the records to stop running (step 2). */
  readonly waitMs?: number
  /** How often it looks at them again. */
  readonly everyMs?: number
  /** How long a record may run past the stop, with no process of the run alive, before the steps run anyway (item 28 (b)). */
  readonly staleMs?: number
  /** How long one look at a record may take. */
  readonly lookMs?: number
  /** How long a state write waits for the state lock. */
  readonly stateWaitMs?: number
}

/**
 * What RB15 left. `cleared`: `building` is cleared (or was), and the request
 * goes on; false while a record still runs, or the state lock stayed held,
 * and the request answers `busy`. `stale`: the refs whose records were taken
 * as stale by item 28 (b), their files kept.
 */
export type Restarted = { readonly cleared: boolean; readonly stale: number }

const CLEARED: Restarted = { cleared: true, stale: 0 }
const NOT_CLEARED: Restarted = { cleared: false, stale: 0 }

/** An app's entry with nothing kept, for the first deploy of an app that builds. */
const NOTHING_KEPT: AppBuilds = {
  running: null,
  images: [],
  deploys: [],
  drop: [],
  fresh: [],
  last: null,
}

/** Whether a state-lock answer is the `busy` report it gives once its wait has passed. */
const isReport = (answer: unknown): answer is RunnerReport =>
  typeof answer === "object" && answer !== null && "outcome" in answer

/** The state as it is on disk, with its mark. */
const stateNow = (dir: string): StoredRunnerState =>
  readRunnerState(readState(dir))

/** The state after step 1, and the build as it now stands. */
type Stopped = {
  readonly state: StoredRunnerState
  readonly building: Building
}

/**
 * Step 1's state write: under S, the state read again; while `building` is
 * still this run's, phase `stopping`, with `stopped` set to now if it was
 * not. `gone` when `building` is no longer this run's; `busy` when S stayed
 * held past its wait.
 */
async function markStopped(
  dir: string,
  run: string,
  waitMs: number
): Promise<Stopped | "gone" | "busy"> {
  const answer = await withStateLock<Stopped | "gone">(
    dir,
    () => {
      const state = stateNow(dir)
      const now = state.building
      if (now === null || now.run !== run) return "gone"
      if (now.stopped !== null) return { state, building: now }
      const building: Building = {
        ...now,
        phase: "stopping",
        stopped: new Date().toISOString(),
      }
      const next = withBuilding(state, building)
      writeState(dir, next)
      return { state: next, building }
    },
    { waitMs }
  )
  return isReport(answer) ? "busy" : answer
}

/**
 * Step 2: the record of each ref left in `<home>/buildx/refs`, looked at
 * until none runs, each removed once it has ended (RB12; a removal that
 * fails keeps its file for the next deploy). A record Docker could not be
 * asked about is not known to have ended, so it counts as running. Gives
 * how many records were taken as stale (item 28 (b)), or undefined while
 * one still runs once the wait is over. `bounded` looks once, never waits,
 * and stops at the first record not seen to end, whose look already
 * decides that `building` stays, and at the first removal that fails.
 */
async function settleRecords(
  dir: string,
  building: Building,
  bounds: RestartBounds,
  bounded: boolean
): Promise<{ stale: number } | undefined> {
  const lookMs = bounds.lookMs ?? LOOK_MS
  const until = Date.now() + (bounded ? 0 : (bounds.waitMs ?? WAIT_MS))
  const stoppedAt = Date.parse(building.stopped ?? new Date().toISOString())
  let left: readonly BuildRef[] = refsNow(dir)
  for (;;) {
    const running: BuildRef[] = []
    for (const ref of left) {
      if ((await recordState(ref, lookMs)) !== "ended") {
        running.push(ref)
        if (bounded) break
        continue
      }
      const removed = await removeRecord(ref, bounded ? lookMs : undefined)
      if (!removed && bounded) return undefined
    }
    if (running.length === 0) return { stale: 0 }
    // Item 28 (b): no process of the run alive, and the record has run this long past the stop.
    if (
      Date.now() - stoppedAt >= (bounds.staleMs ?? STALE_MS) &&
      runProcesses(building.run, bounds).length === 0
    )
      return { stale: running.length }
    const wait = until - Date.now()
    if (wait <= 0) return undefined
    await Bun.sleep(Math.min(bounds.everyMs ?? EVERY_MS, wait))
    left = running
  }
}

/**
 * Step 3: each key's tag removed, without `-f`, when its `.Id` is none of
 * the digests the state records for that key (in `images` or `drop`), as
 * RB11 removes a leftover; the image the state records stays. A removal
 * that fails is left for later, but `bounded` stops at the first one, and
 * gives false so that `building` stays. Never throws.
 */
async function removeImages(
  dir: string,
  state: StoredRunnerState,
  building: Building,
  limit: { timeoutMs?: number },
  bounded: boolean
): Promise<boolean> {
  const entry = state.builds[building.app]
  const recorded = [...(entry?.images ?? []), ...(entry?.drop ?? [])]
  for (const key of building.keys) {
    const left = await removeLeftover(
      dir,
      building.app,
      key,
      recorded.find((image) => image.key === key),
      limit
    )
    if (left === "failed" && bounded) return false
  }
  return true
}

/**
 * The folder `unpackedDir()` names, without making it: a restart never
 * makes it, since nothing was unpacked where it is not.
 */
const unpackedPath = (): string =>
  process.env.ZEKNO_RUNNER_UNPACKED ||
  defaultUnpacked({ isRoot: process.getuid?.() === 0, userHome: homedir() })

/**
 * Step 4: `building/<app>/` and everything in `unpackedDir()` deleted. Only
 * the deploy that holds D builds, so every work folder there is this
 * deploy's. An unpacked folder that is not private is left as it is.
 */
function deleteFolders(app: string, dir: string): void {
  rmSync(paths(dir).building(app), { recursive: true, force: true })
  if (!existsSync(unpackedPath())) return
  let root: string
  try {
    root = unpackedDir()
  } catch {
    return
  }
  for (const name of readdirSync(root))
    rmSync(join(root, name), { recursive: true, force: true })
}

/**
 * Step 5, under S with the state read again, while `building` is still this
 * run's: `last` is `build_failed` with `runner_restarted` unless it already
 * names this deploy, or, with phase `starting`, stays as B3 wrote it; then
 * `building` is cleared. Nothing built is recorded, and the number stays
 * used. False when S stayed held past its wait.
 */
async function finish(
  dir: string,
  run: string,
  waitMs: number
): Promise<boolean> {
  const answer = await withStateLock(
    dir,
    () => {
      const state = stateNow(dir)
      const now = state.building
      if (now === null || now.run !== run) return true
      let next = state
      const entry = state.builds[now.app]
      if (now.phase !== "starting" && entry?.last?.sequence !== now.sequence)
        next = withAppBuilds(state, now.app, {
          ...(entry ?? NOTHING_KEPT),
          last: {
            sequence: now.sequence,
            outcome: "build_failed",
            reason: "runner_restarted",
            at: new Date().toISOString(),
          },
        })
      writeState(dir, withBuilding(next, null))
      return true
    },
    { waitMs }
  )
  return answer === true
}

/** RB15 in full, or its bounded part. */
async function carryOut(
  dir: string,
  state: StoredRunnerState,
  bounds: RestartBounds,
  bounded: boolean
): Promise<Restarted> {
  const building = state.building
  if (building === null) return CLEARED
  const waitMs =
    bounds.stateWaitMs ?? (bounded ? BOUNDED_STATE_WAIT_MS : STATE_WAIT_MS)
  // The runner died during `up`, routes or health: steps 1 to 4 have nothing to do.
  if (building.phase === "starting")
    return (await finish(dir, building.run, waitMs)) ? CLEARED : NOT_CLEARED

  await stopRun(building.run, bounds)
  const stopped = await markStopped(dir, building.run, waitMs)
  if (stopped === "gone") return CLEARED
  if (stopped === "busy") return NOT_CLEARED
  const records = await settleRecords(dir, stopped.building, bounds, bounded)
  if (records === undefined) return NOT_CLEARED
  const removed = await removeImages(
    dir,
    stopped.state,
    stopped.building,
    bounded ? { timeoutMs: bounds.lookMs ?? LOOK_MS } : {},
    bounded
  )
  if (!removed) return NOT_CLEARED
  deleteFolders(building.app, dir)
  if (!(await finish(dir, building.run, waitMs))) return NOT_CLEARED
  return { cleared: true, stale: records.stale }
}

/**
 * RB15 for a request that takes the deploy lock (`setup`, `apply`,
 * `deploy`, `proxy`), with `state` read under it and its `building` set:
 * the five steps, waiting up to 120 seconds for the records. The caller
 * answers `busy` unless `cleared`.
 */
export const restart = (
  dir: string,
  state: StoredRunnerState,
  bounds: RestartBounds = {}
): Promise<Restarted> => carryOut(dir, state, bounds, false)

/**
 * RB15's bounded part, for `sync`, `pack`, `builds` and `status` once they
 * got the deploy lock at once: the stop, then one look at each record (10
 * seconds at most each) and no wait. When none runs, steps 3 to 5; else
 * `building` stays with phase `stopping` for a later request, as it does
 * at the first Docker call of steps 2 and 3 that does not end well, so the
 * request is delayed by seconds. The request then goes on with its own
 * work, whatever this left.
 */
export const boundedRestart = (
  dir: string,
  state: StoredRunnerState,
  bounds: RestartBounds = {}
): Promise<Restarted> => carryOut(dir, state, bounds, true)
