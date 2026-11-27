/**
 * Kept builds and the build in progress in a runner's stored state, mark 5
 * (specs/016-build-from-source, contracts/core.md CO13), for the tests of
 * the state and of `deploy/kept-builds.ts`.
 */
import type {
  AppBuilds,
  Building,
  StoredRunnerState,
} from "../../src/deploy/state"
import { initialRunnerState } from "../../src/deploy/state"
import { setup } from "./helpers"

/** A distinct build key for each number: 64 hex characters, in the order of the numbers. */
export const keyOf = (n: number): string => n.toString(16).padStart(64, "0")

/** A distinct base for each number, by the key rule (CO13, `fresh`). */
export const baseOf = (n: number): string =>
  `b${n.toString(16).padStart(63, "0")}`

/** The kept image of build `n`: its key, and a manifest and config digest of its own. */
export const imageOf = (n: number) => ({
  key: keyOf(n),
  manifest: `sha256:a${n.toString(16).padStart(63, "0")}`,
  config: `sha256:c${n.toString(16).padStart(63, "0")}`,
})

/** An app's entry with nothing kept, changed by `change`. */
export const entry = (change: Partial<AppBuilds> = {}): AppBuilds => ({
  running: null,
  images: [],
  deploys: [],
  drop: [],
  fresh: [],
  last: null,
  ...change,
})

/** A time the state's `since`, `at` and `stopped` take. */
export const AT = "2026-11-27T10:00:00.000Z"

/** The build in progress of `app` at `sequence`, changed by `change`. */
export const building = (
  app: string,
  sequence: number,
  change: Partial<Building> = {}
): Building => ({
  app,
  sequence,
  keys: [keyOf(20), keyOf(21)],
  since: AT,
  limit: 3600,
  phase: "building",
  run: "0123456789abcdef0123456789abcdef",
  stopped: null,
  ...change,
})

/**
 * A full state marked 5: `a` at format 1 with no builds; `web` at format 2
 * and number 7, running 6, with three kept deploys, one image to remove,
 * two fresh bases and its last build, building number 7; `shop` at format
 * 2 and number 2, whose last build failed and which keeps nothing.
 */
export async function builtState(): Promise<StoredRunnerState> {
  const { server } = await setup()
  return {
    v: 5,
    ...initialRunnerState({
      serverId: server.serverId,
      team: server.state.team,
    }),
    lastSequence: { a: 3, shop: 2, web: 7 },
    formats: { a: 1, shop: 2, web: 2 },
    routes: {},
    released: [],
    builds: {
      shop: entry({
        running: 1,
        last: {
          sequence: 2,
          outcome: "build_failed",
          reason: "step_failed",
          at: AT,
        },
      }),
      web: entry({
        running: 6,
        images: [imageOf(1), imageOf(2), imageOf(3)],
        deploys: [
          { sequence: 6, keys: [keyOf(3)] },
          { sequence: 5, keys: [keyOf(2)] },
          { sequence: 4, keys: [keyOf(1), keyOf(2)] },
        ],
        drop: [imageOf(0)],
        fresh: [
          { base: baseOf(1), sequence: 5 },
          { base: baseOf(2), sequence: 6 },
        ],
        last: { sequence: 6, outcome: "built", reason: null, at: AT },
      }),
    },
    building: building("web", 7),
  }
}
