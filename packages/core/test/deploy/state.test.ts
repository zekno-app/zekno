/**
 * The runner's stored state (contracts/state.md, ST1 to ST6 and ST8, as
 * specs/015-domains-https/contracts/core.md and
 * specs/016-build-from-source/contracts/core.md CO13 change them): the mark,
 * now 5, reading a state marked 4 as runner 0.1.1 writes it, one marked 3 as
 * runner 0.1.1-dev.1 writes it, one marked 2 and one from before version 2,
 * each with no builds and no build in progress, and the version-1 view the
 * version-1 path reads and writes through. The rules of the routes in force
 * are in state-routes.test.ts, those of the released domains in
 * state-released.test.ts, those of the builds in state-builds.test.ts.
 */
import { describe, expect, test } from "bun:test"

import {
  afterVersionOneDeploy,
  initialRunnerState,
  newRunnerState,
  parseRunnerState,
  readRunnerState,
  takesVersionOne,
  versionOneView,
  type RunnerState,
  type StoredRunnerState,
} from "../../src/deploy/state"
import { CoreError } from "../../src/protocol/result"
import { setup } from "../support/helpers"
import { builtState } from "../support/builds"
import { appRoutes, holding } from "../support/routes"

const HASH = "a".repeat(64)

/** A state as runner 0.1.0 writes it: no mark, no formats. */
async function olderState(): Promise<RunnerState> {
  const { server } = await setup()
  return {
    ...initialRunnerState({
      serverId: server.serverId,
      team: server.state.team,
    }),
    lastSequence: { a: 3, b: 0 },
    secrets: {
      "a/DATABASE_URL": { version: 2, hash: HASH },
      "a/OLD": { version: 3, hash: null },
    },
  }
}

/** The same state, marked 2, as a runner of feature 014 writes it. */
async function markTwoState() {
  return {
    ...(await olderState()),
    v: 2,
    formats: { a: 1 as const, b: 2 as const },
  }
}

/** The same state, marked 3, as runner 0.1.1-dev.1 writes it. */
async function markThreeState() {
  return { ...(await markTwoState()), v: 3, routes: {} }
}

/** The same state, marked 4, as runner 0.1.1 writes it. */
async function markFourState() {
  return { ...(await markThreeState()), v: 4, released: [] }
}

/** The same state, marked 5, as a runner of this feature writes it. */
async function markedState(): Promise<StoredRunnerState> {
  return {
    ...(await markFourState()),
    v: 5,
    builds: {},
    building: null,
  }
}

/** The keys of a state read forward, in the order a runner writes them. */
const MARK_FIVE_KEYS = [
  "v",
  "serverId",
  "team",
  "lastSequence",
  "secrets",
  "formats",
  "routes",
  "released",
  "builds",
  "building",
]

const throwsCoreError = (value: unknown) =>
  expect(() => readRunnerState(value)).toThrow(CoreError)

describe("ST1, ST2: reading", () => {
  test("a state without a mark reads as v 5 with no routes, an empty list, no builds and no building, each app with a number at 1 and each at 0 at 2", async () => {
    const older = await olderState()
    const before = JSON.stringify(older)
    const read = readRunnerState(older)
    expect(read).toEqual({
      ...older,
      v: 5,
      formats: { a: 1, b: 2 },
      routes: {},
      released: [],
      builds: {},
      building: null,
    })
    expect(Object.keys(read)).toEqual(MARK_FIVE_KEYS)
    // Nothing is written by reading: the input object is as it was.
    expect(JSON.stringify(older)).toBe(before)
    expect(older).not.toHaveProperty("v")
  })

  test("a state without a mark is read by today's strict schema", async () => {
    const older = await olderState()
    throwsCoreError({ ...older, routes: {} })
    throwsCoreError({ ...older, lastSequence: { a: -1 } })
    const { secrets: _secrets, ...incomplete } = older
    throwsCoreError(incomplete)
    for (const value of [null, undefined, 42, "state", []])
      throwsCoreError(value)
  })

  test("a state marked 2 reads as it was, given no routes, an empty list, no builds and no building, and is not changed", async () => {
    const two = await markTwoState()
    const before = JSON.stringify(two)
    const read = readRunnerState(JSON.parse(before))
    expect(read).toEqual({
      ...two,
      v: 5,
      routes: {},
      released: [],
      builds: {},
      building: null,
    })
    expect(Object.keys(read)).toEqual(MARK_FIVE_KEYS)
    expect(readRunnerState(two)).toEqual(read)
    expect(JSON.stringify(two)).toBe(before)
  })

  test("a state marked 2 is read by feature 014's strict rules", async () => {
    const two = await markTwoState()
    const { formats: _formats, ...noFormats } = two
    for (const broken of [
      { ...two, routes: {} },
      { ...two, builds: {} },
      { ...two, building: null },
      { ...two, formats: { a: 1 } },
      { ...two, formats: { a: 3, b: 2 } },
      { ...two, extra: 1 },
      noFormats,
    ])
      throwsCoreError(broken)
  })

  test("a state marked 3, as runner 0.1.1-dev.1 writes it, reads as it was, given an empty list, no builds and no building, and is not changed", async () => {
    const three = await markThreeState()
    const before = JSON.stringify(three)
    const read = readRunnerState(JSON.parse(before))
    expect(read).toEqual({
      ...three,
      v: 5,
      released: [],
      builds: {},
      building: null,
    })
    expect(Object.keys(read)).toEqual(MARK_FIVE_KEYS)
    expect(readRunnerState(three)).toEqual(read)
    expect(JSON.stringify(three)).toBe(before)
  })

  test("a state marked 3 is read by mark 3's strict rules: no list, and nothing it refused", async () => {
    const three = await markThreeState()
    const { routes: _routes, ...noRoutes } = three
    const { formats: _formats, ...noFormats } = three
    for (const broken of [
      // Mark 3 never had the list: a state that has one is marked 4.
      { ...three, released: [] },
      { ...three, released: ["old.example.com"] },
      { ...three, builds: {} },
      { ...three, building: null },
      { ...three, extra: 1 },
      noRoutes,
      noFormats,
      { ...three, routes: [] },
      { ...three, formats: { a: 1 } },
      {
        ...three,
        routes: { b: { routes: [], health: null, names: {} } },
      },
    ])
      throwsCoreError(broken)
  })

  test("a state marked 4, as runner 0.1.1 writes it, reads as it was, given no builds and no building, and is not changed", async () => {
    // `b` is at format 2, so it may hold a route.
    const four = {
      ...(await markFourState()),
      routes: { b: appRoutes(["b.example.com"]) },
      released: ["old.example.com"],
    }
    const before = JSON.stringify(four)
    const read = readRunnerState(JSON.parse(before))
    expect(read).toEqual({ ...four, v: 5, builds: {}, building: null })
    expect(Object.keys(read)).toEqual(MARK_FIVE_KEYS)
    expect(readRunnerState(four)).toEqual(read)
    expect(JSON.stringify(four)).toBe(before)
  })

  test("a state marked 4 is read by mark 4's strict rules: no builds, no building, and nothing it refused", async () => {
    const four = await markFourState()
    const { released: _released, ...noList } = four
    const { routes: _routes, ...noRoutes } = four
    for (const broken of [
      // Mark 4 never had builds or a build in progress: a state that has them is marked 5.
      { ...four, builds: {} },
      { ...four, building: null },
      { ...four, builds: {}, building: null },
      { ...four, extra: 1 },
      noList,
      noRoutes,
      { ...four, released: null },
      { ...four, released: ["b.example.com", "a.example.com"] },
      { ...four, formats: { a: 1 } },
      {
        ...four,
        routes: { b: { routes: [], health: null, names: {} } },
      },
    ])
      throwsCoreError(broken)
  })

  test("a marked state reads back equal", async () => {
    const marked = await markedState()
    expect(readRunnerState(JSON.parse(JSON.stringify(marked)))).toEqual(marked)
    expect(readRunnerState(marked)).toEqual(marked)
  })

  test("a full state marked 5, with builds and a build in progress, reads back equal", async () => {
    const full = await builtState()
    expect(readRunnerState(JSON.parse(JSON.stringify(full)))).toEqual(full)
    expect(readRunnerState(full)).toEqual(full)
    expect(Object.keys(readRunnerState(full))).toEqual(MARK_FIVE_KEYS)
  })

  test("a marked state with anything wrong throws, never reads as empty", async () => {
    const marked = await markedState()
    const { formats: _formats, ...noFormats } = marked
    const { lastSequence: _lastSequence, ...noNumbers } = marked
    const { routes: _routes, ...noRoutes } = marked
    const { released: _released, ...noList } = marked
    const { builds: _builds, ...noBuilds } = marked
    const { building: _building, ...noBuilding } = marked
    for (const broken of [
      // A mark above 5 is refused, as mark 5 was before this feature.
      { ...marked, v: 6 },
      { ...marked, v: 7 },
      { ...marked, v: "5" },
      // Read as mark 4, 3 or 2, its builds and its building are fields those marks never had.
      { ...marked, v: 4 },
      { ...marked, v: "4" },
      { ...marked, v: 3 },
      { ...marked, v: 2 },
      { ...marked, v: "3" },
      { ...marked, v: "2" },
      { ...marked, v: 1 },
      { ...marked, v: 0 },
      { ...marked, v: null },
      noFormats,
      noNumbers,
      // Mark 4 has routes, an object, and the list.
      noRoutes,
      { ...marked, routes: [] },
      { ...marked, routes: null },
      noList,
      { ...marked, released: null },
      // Mark 5 has builds, an object, and building, null or a build.
      noBuilds,
      noBuilding,
      { ...marked, builds: [] },
      { ...marked, builds: null },
      { ...marked, building: {} },
      { ...marked, building: undefined },
      { ...marked, extra: 1 },
      // A format for an app the numbers do not have, and the reverse.
      { ...marked, formats: { a: 1, b: 2, c: 2 } },
      { ...marked, formats: { a: 1 } },
      { ...marked, formats: { a: 3, b: 2 } },
      { ...marked, formats: { a: 0, b: 2 } },
      { ...marked, formats: { a: "1", b: 2 } },
      { ...marked, formats: [] },
      { ...marked, team: { ...marked.team, hash: "not a hash" } },
      { ...marked, team: { ...marked.team, members: [] } },
      { ...marked, serverId: "srv_x" },
    ])
      throwsCoreError(broken)
  })
})

describe("ST3: setup", () => {
  test("newRunnerState is initialRunnerState's fields with v 5, no formats, no routes, an empty list, no builds and no building", async () => {
    const { server } = await setup()
    const input = { serverId: server.serverId, team: server.state.team }
    const state = newRunnerState(input)
    expect(state).toEqual({
      ...initialRunnerState(input),
      v: 5,
      formats: {},
      routes: {},
      released: [],
      builds: {},
      building: null,
    })
    expect(Object.keys(state)).toEqual(MARK_FIVE_KEYS)
    expect(readRunnerState(state)).toEqual(state)
  })

  test("refuses what initialRunnerState refuses", async () => {
    const { server } = await setup()
    expect(() =>
      newRunnerState({ serverId: "srv_x", team: server.state.team })
    ).toThrow(CoreError)
  })
})

describe("ST5: the version-1 path", () => {
  test("versionOneView is the part verifyDeploy reads, and it passes parseRunnerState", async () => {
    const marked = await markedState()
    const {
      v: _v,
      formats: _formats,
      routes: _routes,
      released: _released,
      builds: _builds,
      building: _building,
      ...older
    } = marked
    const view = versionOneView(marked)
    expect(view).toEqual(older)
    expect(parseRunnerState(view)).toEqual(view)
  })

  test("afterVersionOneDeploy keeps v, serverId, team, formats, routes and the list and takes lastSequence and secrets", async () => {
    const marked = {
      ...holding(await markedState(), { b: appRoutes(["b.example.com"]) }),
      released: ["old.example.com"],
    }
    const next: RunnerState = {
      ...versionOneView(marked),
      lastSequence: { a: 4, b: 0 },
      secrets: {
        ...marked.secrets,
        "a/DATABASE_URL": { version: 3, hash: "b".repeat(64) },
      },
    }
    const after = afterVersionOneDeploy(marked, next)
    expect(after).toEqual({
      v: 5,
      serverId: marked.serverId,
      team: marked.team,
      lastSequence: { a: 4, b: 0 },
      secrets: next.secrets,
      formats: { a: 1, b: 2 },
      routes: { b: appRoutes(["b.example.com"]) },
      released: ["old.example.com"],
      builds: {},
      building: null,
    })
    expect(readRunnerState(after)).toEqual(after)
  })

  test("afterVersionOneDeploy keeps the builds and the build in progress as they were", async () => {
    const full = await builtState()
    const next: RunnerState = {
      ...versionOneView(full),
      lastSequence: { ...full.lastSequence, a: 4 },
    }
    const after = afterVersionOneDeploy(full, next)
    expect(after.lastSequence).toEqual({ a: 4, shop: 2, web: 7 })
    expect(after.builds).toEqual(full.builds)
    expect(after.building).toEqual(full.building)
    expect(readRunnerState(after)).toEqual(after)
  })

  test("afterVersionOneDeploy keeps the state's own server and team over the ones next names", async () => {
    const marked = await markedState()
    const other = await setup("Bea")
    const after = afterVersionOneDeploy(marked, {
      ...versionOneView(marked),
      serverId: other.server.serverId,
      team: other.server.state.team,
    })
    expect(after.serverId).toBe(marked.serverId)
    expect(after.team).toEqual(marked.team)
  })
})

describe("ST6: who may take version 1", () => {
  test("only an app at format 1", async () => {
    const marked = await markedState()
    expect(takesVersionOne(marked, "a")).toBe(true)
    expect(takesVersionOne(marked, "b")).toBe(false)
    expect(takesVersionOne(marked, "c")).toBe(false)
    expect(takesVersionOne(marked, "constructor")).toBe(false)
  })
})

describe("ST8: numbers are never dropped", () => {
  test("afterVersionOneDeploy refuses a next state that drops an app, or adds one without a format", async () => {
    const marked = await markedState()
    const view = versionOneView(marked)
    expect(() =>
      afterVersionOneDeploy(marked, { ...view, lastSequence: { a: 4 } })
    ).toThrow(CoreError)
    expect(() =>
      afterVersionOneDeploy(marked, {
        ...view,
        lastSequence: { a: 3, b: 0, c: 1 },
      })
    ).toThrow(CoreError)
  })

  test("reading a state without a mark keeps every app, those at 0 too", async () => {
    const read = readRunnerState(await olderState())
    expect(Object.keys(read.lastSequence).sort()).toEqual(["a", "b"])
    expect(Object.keys(read.formats).sort()).toEqual(["a", "b"])
  })
})
