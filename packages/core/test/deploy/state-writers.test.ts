/**
 * The writers of an app's builds and of the build in progress
 * (specs/016-build-from-source, contracts/core.md CO13, CO19; FR-045,
 * FR-031b, item 28): `withAppBuilds` and `withBuilding` each give the whole
 * state read back through its strict rules, so a rule broken throws
 * `CoreError`. The state's `building` is followed through its phases, each
 * one state write under the state lock (RB3, RB10, RB15).
 */
import { describe, expect, test } from "bun:test"

import { withAppBuilds, withBuilding } from "../../src/deploy/kept-builds"
import { readRunnerState, type StoredRunnerState } from "../../src/deploy/state"
import { CoreError } from "../../src/protocol/result"
import {
  AT,
  building,
  builtState,
  entry,
  imageOf,
  keyOf,
} from "../support/builds"
import { deepFreeze } from "../support/deploy-v2"

const LATER = "2026-11-27T10:30:00.000Z"

/** `builtState()` with no build in progress, frozen, so a test sees any change. */
async function idle(): Promise<StoredRunnerState> {
  return deepFreeze({ ...(await builtState()), building: null })
}

/** The state read back equal, and every part but `building` as `before` had it. */
function onlyBuildingChanged(
  after: StoredRunnerState,
  before: StoredRunnerState
) {
  expect(readRunnerState(JSON.parse(JSON.stringify(after)))).toEqual(after)
  expect({ ...after, building: before.building }).toEqual(before)
}

describe("withBuilding: the state's building through its phases", () => {
  test("written with the number, then stopping, starting, and cleared", async () => {
    const before = await idle()
    const run = "fedcba9876543210fedcba9876543210"
    // Written with the number, before any build client starts (RB15).
    const written = withBuilding(before, building("web", 7, { run }))
    expect(written.building).toEqual({
      app: "web",
      sequence: 7,
      keys: [keyOf(20), keyOf(21)],
      since: AT,
      limit: 3600,
      phase: "building",
      run,
      stopped: null,
    })
    onlyBuildingChanged(written, before)
    // The runner stopped it (RB10, RB15): the stop time is set.
    const stopping = withBuilding(written, {
      ...written.building!,
      phase: "stopping",
      stopped: LATER,
    })
    expect(stopping.building!.phase).toBe("stopping")
    expect(stopping.building!.stopped).toBe(LATER)
    expect(stopping.building!.run).toBe(run)
    onlyBuildingChanged(stopping, before)
    // Starting, at B3: no stop time.
    const starting = withBuilding(stopping, {
      ...stopping.building!,
      phase: "starting",
      stopped: null,
    })
    expect(starting.building!.phase).toBe("starting")
    expect(starting.building!.stopped).toBeNull()
    onlyBuildingChanged(starting, before)
    // Cleared once U has run, or the failed build's records are gone (RB3).
    const cleared = withBuilding(starting, null)
    expect(cleared.building).toBeNull()
    expect(cleared).toEqual(before)
  })

  test("a building whose sequence is not the app's last number throws", async () => {
    const before = await idle()
    for (const sequence of [6, 8, 1])
      expect(() => withBuilding(before, building("web", sequence))).toThrow(
        CoreError
      )
    expect(() => withBuilding(before, building("zzz", 1))).toThrow(CoreError)
  })

  test("stopping without stopped throws", async () => {
    const before = await idle()
    expect(() =>
      withBuilding(before, building("web", 7, { phase: "stopping" }))
    ).toThrow(CoreError)
  })

  test("starting with stopped throws, and so does building with it", async () => {
    const before = await idle()
    for (const phase of ["starting", "building"] as const)
      expect(() =>
        withBuilding(before, building("web", 7, { phase, stopped: LATER }))
      ).toThrow(CoreError)
  })
})

describe("withAppBuilds", () => {
  test("sets an app's entry, in order of the apps, and every other part stays", async () => {
    const before = await idle()
    const next = entry({
      running: 2,
      images: [imageOf(5)],
      deploys: [{ sequence: 2, keys: [keyOf(5)] }],
      last: { sequence: 2, outcome: "built", reason: null, at: LATER },
    })
    const after = withAppBuilds(before, "shop", next)
    expect(after.builds.shop).toEqual(next)
    expect(Object.keys(after.builds)).toEqual(["shop", "web"])
    expect(readRunnerState(after)).toEqual(after)
    expect({ ...after, builds: before.builds }).toEqual(before)
  })

  test("an app's first entry joins in order; null removes the app's entry", async () => {
    const before = await idle()
    const added = withAppBuilds(
      {
        ...before,
        lastSequence: { ...before.lastSequence, api: 0 },
        formats: { ...before.formats, api: 2 },
      },
      "api",
      entry()
    )
    expect(Object.keys(added.builds)).toEqual(["api", "shop", "web"])
    const removed = withAppBuilds(before, "shop", null)
    expect(Object.keys(removed.builds)).toEqual(["web"])
    expect(withAppBuilds(before, "zzz", null)).toEqual(before)
  })

  test("withAppBuilds for an app at format 1 throws", async () => {
    const before = await idle()
    expect(() => withAppBuilds(before, "a", entry())).toThrow(CoreError)
    // And an app the state does not know.
    expect(() => withAppBuilds(before, "zzz", entry())).toThrow(CoreError)
  })

  test("withAppBuilds with last set to build_failed and runner_restarted reads (RB15 step 5)", async () => {
    const before = await idle()
    const web = before.builds.web!
    const after = withAppBuilds(before, "web", {
      ...web,
      last: {
        sequence: 7,
        outcome: "build_failed",
        reason: "runner_restarted",
        at: LATER,
      },
    })
    expect(after.builds.web!.last).toEqual({
      sequence: 7,
      outcome: "build_failed",
      reason: "runner_restarted",
      at: LATER,
    })
    expect(readRunnerState(after)).toEqual(after)
  })

  test("an entry that breaks a rule of the state throws", async () => {
    const before = await idle()
    const web = before.builds.web!
    for (const broken of [
      { ...web, running: 8 },
      { ...web, images: [...web.images, imageOf(9)] },
      { ...web, drop: [imageOf(1)] },
    ])
      expect(() => withAppBuilds(before, "web", broken)).toThrow(CoreError)
  })
})
