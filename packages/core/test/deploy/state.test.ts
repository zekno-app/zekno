/**
 * The runner's stored state (contracts/state.md, ST1 to ST6 and ST8): the
 * mark, the migration of a state from before version 2, and the version-1
 * view the version-1 path reads and writes through.
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

/** The same state, marked, as a runner of this feature writes it. */
async function markedState(): Promise<StoredRunnerState> {
  return { ...(await olderState()), v: 2, formats: { a: 1, b: 2 } }
}

const throwsCoreError = (value: unknown) =>
  expect(() => readRunnerState(value)).toThrow(CoreError)

describe("ST1, ST2: reading", () => {
  test("a state without a mark reads as v 2, each app with a number at 1 and each at 0 at 2", async () => {
    const older = await olderState()
    const before = JSON.stringify(older)
    const read = readRunnerState(older)
    expect(read).toEqual({ ...older, v: 2, formats: { a: 1, b: 2 } })
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

  test("a marked state reads back equal", async () => {
    const marked = await markedState()
    expect(readRunnerState(JSON.parse(JSON.stringify(marked)))).toEqual(marked)
    expect(readRunnerState(marked)).toEqual(marked)
  })

  test("a marked state with anything wrong throws, never reads as empty", async () => {
    const marked = await markedState()
    const { formats: _formats, ...noFormats } = marked
    const { lastSequence: _lastSequence, ...noNumbers } = marked
    for (const broken of [
      { ...marked, v: 3 },
      { ...marked, v: "2" },
      { ...marked, v: 1 },
      { ...marked, v: null },
      noFormats,
      noNumbers,
      // A format for an app the numbers do not have, and the reverse.
      { ...marked, formats: { a: 1, b: 2, c: 2 } },
      { ...marked, formats: { a: 1 } },
      { ...marked, routes: {} },
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
  test("newRunnerState is initialRunnerState's fields with v 2 and no formats", async () => {
    const { server } = await setup()
    const input = { serverId: server.serverId, team: server.state.team }
    const state = newRunnerState(input)
    expect(state).toEqual({ ...initialRunnerState(input), v: 2, formats: {} })
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
    const { v: _v, formats: _formats, ...older } = marked
    const view = versionOneView(marked)
    expect(view).toEqual(older)
    expect(parseRunnerState(view)).toEqual(view)
  })

  test("afterVersionOneDeploy keeps v, serverId, team and formats and takes lastSequence and secrets", async () => {
    const marked = await markedState()
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
      v: 2,
      serverId: marked.serverId,
      team: marked.team,
      lastSequence: { a: 4, b: 0 },
      secrets: next.secrets,
      formats: { a: 1, b: 2 },
    })
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
