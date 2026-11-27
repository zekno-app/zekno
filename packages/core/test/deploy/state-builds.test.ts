/**
 * The builds kept and the build in progress in the state marked 5
 * (specs/016-build-from-source, contracts/core.md CO13; FR-045, FR-066,
 * FR-067): a full state reads, and each rule, of a field or across the
 * state, broken by one change, makes the state refused, never read as having
 * no builds.
 */
import { describe, expect, test } from "bun:test"

import { BUILDING_LIMIT_SECONDS } from "../../src/deploy/build-record"
import {
  readRunnerState,
  type AppBuilds,
  type StoredRunnerState,
} from "../../src/deploy/state"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"
import {
  AT,
  baseOf,
  building,
  builtState,
  entry,
  imageOf,
  keyOf,
} from "../support/builds"

const refused = (value: unknown) =>
  expect(() => readRunnerState(value)).toThrow(CoreError)

/** The state with `web`'s entry changed by `change`. */
const withWeb = (
  state: StoredRunnerState,
  change: Record<string, unknown>
): unknown => ({
  ...state,
  builds: { ...state.builds, web: { ...state.builds.web, ...change } },
})

/** The state with its build in progress changed by `change`. */
const withBuilding = (
  state: StoredRunnerState,
  change: Record<string, unknown>
): unknown => ({ ...state, building: { ...state.building, ...change } })

/** `count` images, from build `first` on, and three deploys that name every one of them. */
function kept(count: number, first = 10): Partial<AppBuilds> {
  const images = Array.from({ length: count }, (_, n) => imageOf(first + n))
  const deploys = []
  for (let n = 0; n < count; n += LIMITS.buildsPerDeploy)
    deploys.push({
      sequence: 6 - deploys.length,
      keys: images.slice(n, n + LIMITS.buildsPerDeploy).map(({ key }) => key),
    })
  return { images, deploys }
}

describe("a state with builds and a build in progress", () => {
  test("reads back equal, through JSON too", async () => {
    const state = await builtState()
    expect(readRunnerState(state)).toEqual(state)
    expect(readRunnerState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  test("reads at each bound: 24 images in 3 deploys of 8 keys, 24 to remove, 24 fresh bases, and the longest limit", async () => {
    const state = await builtState()
    const full = {
      ...(withWeb(state, {
        ...kept(LIMITS.keptImagesPerApp),
        drop: Array.from({ length: LIMITS.keptImagesPerApp }, (_, n) =>
          imageOf(100 + n)
        ),
        fresh: Array.from({ length: LIMITS.freshPerApp }, (_, n) => ({
          base: baseOf(n),
          sequence: 7,
        })),
      }) as StoredRunnerState),
      building: building("web", 7, {
        keys: Array.from({ length: LIMITS.buildsPerDeploy }, (_, n) =>
          keyOf(200 + n)
        ),
        limit: BUILDING_LIMIT_SECONDS,
      }),
    } as StoredRunnerState
    expect(LIMITS.keptImagesPerApp).toBe(24)
    expect(LIMITS.keptDeploysPerApp).toBe(3)
    expect(LIMITS.freshPerApp).toBe(24)
    expect(BUILDING_LIMIT_SECONDS).toBe(57_600)
    expect(readRunnerState(full)).toEqual(full)
    expect(readRunnerState(withBuilding(state, { limit: 1 }))).toBeDefined()
  })

  test("an app with nothing kept, no last build and no build in progress reads", async () => {
    const state = await builtState()
    const bare = {
      ...state,
      builds: { ...state.builds, web: entry() },
      building: null,
    }
    expect(readRunnerState(bare)).toEqual(bare)
  })

  test("a build being stopped has its stop time; one starting has none", async () => {
    const state = await builtState()
    for (const value of [
      withBuilding(state, { phase: "stopping", stopped: AT }),
      withBuilding(state, { phase: "starting", stopped: null }),
    ])
      expect(readRunnerState(value)).toEqual(value as StoredRunnerState)
  })

  test("a last build that failed carries its reason; any reason of the list reads", async () => {
    const state = await builtState()
    const value = withWeb(state, {
      last: {
        sequence: 7,
        outcome: "build_failed",
        reason: "runner_restarted",
        at: AT,
      },
    })
    expect(readRunnerState(value)).toEqual(value as StoredRunnerState)
  })
})

describe("the rules of each field", () => {
  test("images: at most 24, sorted by key, each once, digests by the digest rule", async () => {
    const state = await builtState()
    const web = state.builds.web!
    const [one, two, three] = web.images as [
      AppBuilds["images"][number],
      AppBuilds["images"][number],
      AppBuilds["images"][number],
    ]
    for (const images of [
      [two, one, three],
      [one, one, two, three],
      [one, two, { ...three, manifest: `sha256:${"a".repeat(63)}` }],
      [one, two, { ...three, config: `sha256:${"A".repeat(64)}` }],
      [one, two, { ...three, manifest: "a".repeat(64) }],
      [one, two, { ...three, extra: 1 }],
      [one, two, { key: three.key, manifest: three.manifest }],
      null,
      {},
    ])
      refused(withWeb(state, { images }))
    refused(withWeb(state, kept(LIMITS.keptImagesPerApp + 1)))
  })

  test("deploys: at most 3, newest first, each once; keys 1 to 8, sorted, each once", async () => {
    const state = await builtState()
    const [six, five, four] = state.builds.web!.deploys as [
      AppBuilds["deploys"][number],
      AppBuilds["deploys"][number],
      AppBuilds["deploys"][number],
    ]
    const nine = Array.from({ length: 9 }, (_, n) => keyOf(30 + n))
    for (const change of [
      { deploys: [four, five, six] },
      { deploys: [six, six, five, four] },
      { deploys: [six, { ...five, sequence: 6 }, four] },
      { deploys: [six, five, { ...four, keys: [] }] },
      { deploys: [six, five, { ...four, keys: [keyOf(2), keyOf(1)] }] },
      { deploys: [six, five, { ...four, keys: [keyOf(1), keyOf(1)] }] },
      { deploys: [six, five, { ...four, keys: ["x".repeat(64)] }] },
      { deploys: [six, five, { ...four, sequence: 0 }] },
      { deploys: [six, five, { ...four, sequence: 3.5 }] },
      { deploys: [six, five, { ...four, extra: 1 }] },
      // Four deploys, each naming its own image.
      {
        images: [imageOf(1), imageOf(2), imageOf(3), imageOf(4)],
        deploys: [
          { sequence: 7, keys: [keyOf(4)] },
          { sequence: 6, keys: [keyOf(3)] },
          { sequence: 5, keys: [keyOf(2)] },
          { sequence: 4, keys: [keyOf(1)] },
        ],
      },
      // Nine keys in one deploy.
      {
        images: nine.map((_, n) => imageOf(30 + n)),
        deploys: [{ sequence: 6, keys: nine }],
      },
    ])
      refused(withWeb(state, change))
  })

  test("drop: at most 24, sorted by key, each once, digests by the digest rule", async () => {
    const state = await builtState()
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => imageOf(100 + n))
    for (const drop of [
      many(LIMITS.keptImagesPerApp + 1),
      [imageOf(102), imageOf(101)],
      [imageOf(101), imageOf(101)],
      [{ ...imageOf(101), config: "sha256:" }],
      null,
    ])
      refused(withWeb(state, { drop }))
  })

  test("fresh: at most 24, sorted by base, each base once, its number a deploy's", async () => {
    const state = await builtState()
    const fresh = (n: number, sequence = 5) => ({ base: baseOf(n), sequence })
    for (const change of [
      Array.from({ length: LIMITS.freshPerApp + 1 }, (_, n) => fresh(n)),
      [fresh(2), fresh(1)],
      [fresh(1), fresh(1, 6)],
      [{ base: "B".repeat(64), sequence: 5 }],
      [fresh(1, 0)],
      [{ ...fresh(1), extra: 1 }],
    ])
      refused(withWeb(state, { fresh: change }))
  })

  test("last: null, or a number, an outcome of the list, a reason of the list or null, and a time", async () => {
    const state = await builtState()
    const last = state.builds.web!.last!
    for (const change of [
      { ...last, outcome: "failed" },
      { ...last, outcome: "refused" },
      { ...last, reason: "because" },
      { ...last, reason: "pack_mismatch" },
      { ...last, at: "yesterday" },
      { ...last, at: null },
      { ...last, sequence: 0 },
      { ...last, extra: 1 },
      { sequence: 6, outcome: "built", reason: null },
    ])
      refused(withWeb(state, { last: change }))
  })

  test("running: null, or a number from 1", async () => {
    const state = await builtState()
    expect(
      readRunnerState(withWeb(state, { running: null })).builds.web!.running
    ).toBeNull()
    for (const running of [0, -1, 1.5, "6"])
      refused(withWeb(state, { running }))
  })

  test("an entry has every field and no other", async () => {
    const state = await builtState()
    const { fresh: _fresh, ...noFresh } = state.builds.web!
    refused({ ...state, builds: { ...state.builds, web: noFresh } })
    refused(withWeb(state, { extra: 1 }))
    refused({ ...state, builds: { ...state.builds, web: null } })
  })

  test("building: a run token of 32 hex, a phase of the list, a limit from 1 to 57,600, a time, keys 1 to 8 sorted", async () => {
    const state = await builtState()
    const nine = Array.from({ length: 9 }, (_, n) => keyOf(200 + n))
    for (const change of [
      { run: "0123456789abcdef0123456789abcde" },
      { run: "0123456789ABCDEF0123456789ABCDEF" },
      { run: "0123456789abcdef0123456789abcdef0" },
      { phase: "built" },
      { phase: null },
      { limit: 0 },
      { limit: BUILDING_LIMIT_SECONDS + 1 },
      { limit: 1.5 },
      { since: "now" },
      { since: null },
      { keys: [] },
      { keys: nine },
      { keys: [keyOf(21), keyOf(20)] },
      { keys: [keyOf(20), keyOf(20)] },
      { app: "Web" },
      { sequence: "7" },
      { extra: 1 },
    ])
      refused(withBuilding(state, change))
    const { run: _run, ...noRun } = state.building!
    refused({ ...state, building: noRun })
  })

  test("building: a stop time exactly while it is being stopped, and a time", async () => {
    const state = await builtState()
    for (const change of [
      { phase: "building", stopped: AT },
      { phase: "starting", stopped: AT },
      { phase: "stopping", stopped: null },
      { phase: "stopping", stopped: "later" },
    ])
      refused(withBuilding(state, change))
  })
})

describe("the rules across the state", () => {
  test("every app in builds is at format 2", async () => {
    const state = await builtState()
    refused({ ...state, builds: { ...state.builds, a: entry() } })
    refused({ ...state, builds: { ...state.builds, zzz: entry() } })
    refused({ ...state, builds: { ...state.builds, "Not-An-App": entry() } })
  })

  test("the keys of deploys together are exactly the keys of images", async () => {
    const state = await builtState()
    const web = state.builds.web!
    // An image no deploy names.
    refused(withWeb(state, { images: [...web.images, imageOf(9)] }))
    // A key a deploy names with no image.
    refused(withWeb(state, { images: web.images.slice(1) }))
    refused(withWeb(state, { deploys: web.deploys.slice(0, 2) }))
  })

  test("no key is both kept and to remove", async () => {
    const state = await builtState()
    refused(withWeb(state, { drop: [imageOf(0), imageOf(1)] }))
    refused(
      withWeb(state, {
        drop: [{ ...imageOf(3), manifest: imageOf(9).manifest }],
      })
    )
  })

  test("every number is at most the app's last number", async () => {
    const state = await builtState()
    const web = state.builds.web!
    const [six, ...older] = web.deploys
    for (const change of [
      { running: 8 },
      { deploys: [{ ...six!, sequence: 8 }, ...older] },
      { fresh: [{ base: baseOf(1), sequence: 8 }] },
      { last: { ...web.last!, sequence: 8 } },
    ])
      refused(withWeb(state, change))
    // `shop` is at 2.
    refused({
      ...state,
      builds: { ...state.builds, shop: { ...state.builds.shop!, running: 3 } },
    })
  })

  test("the build in progress is of an app with a format, at its last number", async () => {
    const state = await builtState()
    for (const change of [
      { sequence: 6 },
      { sequence: 8 },
      { app: "zzz" },
      { app: "shop" },
    ])
      refused(withBuilding(state, change))
    // `shop` at its last number, 2.
    expect(
      readRunnerState(withBuilding(state, { app: "shop", sequence: 2 }))
        .building
    ).toEqual(building("shop", 2))
  })

  test("builds is an object of apps, and building null or a build", async () => {
    const state = await builtState()
    for (const value of [
      { ...state, builds: [] },
      { ...state, builds: null },
      { ...state, building: [] },
      { ...state, building: "web" },
    ])
      refused(value)
  })
})
