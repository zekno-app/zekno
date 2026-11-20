/**
 * The released domains whose certificate is still to delete, in the state
 * marked 4 (specs/015-domains-https, contracts/core.md, "The state"; runner.md,
 * RN10): the schema's rules, each with a state that breaks only it; the
 * list kept right by `withAppRoutes` in the same write that releases or
 * routes a domain; `withoutReleased` once a deletion worked; and K15's count,
 * which holds the list as it would be after the deploy.
 */
import { describe, expect, test } from "bun:test"

import {
  domainsAfter,
  withAppRoutes,
  withoutReleased,
} from "../../src/deploy/routes"
import {
  initialRunnerState,
  readRunnerState,
  type StoredRunnerState,
} from "../../src/deploy/state"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"
import { deepFreeze } from "../support/deploy-v2"
import { setup } from "../support/helpers"
import { appRoutes, holding, route } from "../support/routes"

/** `b` holds b.example.com and www.b.example.com, `c` holds c.example.com; old.example.com and x.example.com are still to delete. */
async function listed(): Promise<StoredRunnerState> {
  const { server } = await setup()
  const base: StoredRunnerState = {
    v: 4,
    ...initialRunnerState({
      serverId: server.serverId,
      team: server.state.team,
    }),
    lastSequence: {},
    formats: {},
    routes: {},
    released: ["old.example.com", "x.example.com"],
  }
  return deepFreeze(
    holding(base, {
      b: appRoutes(["b.example.com", "www.b.example.com"], 1),
      c: appRoutes(["c.example.com"], 2),
    })
  )
}

const refused = (value: unknown) =>
  expect(() => readRunnerState(value)).toThrow(CoreError)

describe('the list in the state (core.md, "The state")', () => {
  test("reads back equal, through JSON too; an empty list is a list", async () => {
    const state = await listed()
    expect(readRunnerState(state)).toEqual(state)
    expect(readRunnerState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    const empty = { ...state, released: [] }
    expect(readRunnerState(empty)).toEqual(empty)
  })

  test("mark 4 has the list: without it, or with anything but a list, the state is refused", async () => {
    const state = await listed()
    const { released: _released, ...without } = state
    refused(without)
    for (const released of [null, {}, "old.example.com", [1], [null]])
      refused({ ...state, released })
  })

  test("each domain by the domain rule", async () => {
    const state = await listed()
    for (const domain of [
      "Old.example.com",
      "xn--bcher-kva.example.com",
      "localhost",
      "example",
      "old.example.com.",
      "10.0.0.1",
      "a b.example.com",
      "",
    ])
      refused({ ...state, released: [domain] })
  })

  test("sorted, each once", async () => {
    const state = await listed()
    refused({ ...state, released: ["x.example.com", "old.example.com"] })
    refused({ ...state, released: ["old.example.com", "old.example.com"] })
  })

  test("none in force for any app: a domain that is routed is never deleted", async () => {
    const state = await listed()
    for (const domain of [
      "b.example.com",
      "www.b.example.com",
      "c.example.com",
    ])
      refused({
        ...state,
        released: [...state.released, domain].sort(),
      })
  })

  test(`the domains in force and the list at most ${LIMITS.domainsPerServer} together`, async () => {
    expect(LIMITS.domainsPerServer).toBe(1024)
    const state = await listed()
    // Three in force, so 1,021 on the list fit and 1,022 do not.
    const many = (count: number) =>
      Array.from(
        { length: count },
        (_, n) => `d${String(n).padStart(4, "0")}.example.com`
      )
    const full = { ...state, released: many(LIMITS.domainsPerServer - 3) }
    expect(readRunnerState(full).released).toHaveLength(1021)
    refused({ ...state, released: many(LIMITS.domainsPerServer - 2) })
    refused({ ...state, released: many(LIMITS.domainsPerServer + 1) })
  })
})

describe("withAppRoutes keeps the list right in the same write", () => {
  test("a domain the app held and no longer has is added, in order; the rest of the list stays", async () => {
    const state = await listed()
    const before = JSON.stringify(state)
    const next = withAppRoutes(state, "b", appRoutes(["b.example.com"], 1))
    expect(next.routes.b!.routes).toEqual([route("b.example.com")])
    expect(next.released).toEqual([
      "old.example.com",
      "www.b.example.com",
      "x.example.com",
    ])
    expect(readRunnerState(next)).toEqual(next)
    expect(JSON.stringify(state)).toBe(before)
  })

  test("an app that gives up every domain: each goes on the list, and its entry goes", async () => {
    const state = await listed()
    const next = withAppRoutes(state, "b", null)
    expect(Object.keys(next.routes)).toEqual(["c"])
    expect(next.released).toEqual([
      "b.example.com",
      "old.example.com",
      "www.b.example.com",
      "x.example.com",
    ])
  })

  test("a domain on the list routed again, by the same app or another, is taken off it and keeps its certificate", async () => {
    const state = await listed()
    const released = withAppRoutes(state, "b", appRoutes(["b.example.com"], 1))
    // The same app takes it back before its deletion worked.
    const back = withAppRoutes(
      released,
      "b",
      appRoutes(["b.example.com", "www.b.example.com"], 1)
    )
    expect(back.released).toEqual(state.released)
    // Another app takes it, and an older one on the list.
    const taken = withAppRoutes(
      released,
      "c",
      appRoutes(["c.example.com", "old.example.com", "www.b.example.com"], 2)
    )
    expect(taken.released).toEqual(["x.example.com"])
    expect(readRunnerState(taken)).toEqual(taken)
  })

  test("an app that keeps its domains, or holds none, leaves the list as it is", async () => {
    const state = await listed()
    expect(withAppRoutes(state, "c", state.routes.c!).released).toEqual(
      state.released
    )
    expect(withAppRoutes(state, "new", null)).toEqual(state)
  })
})

describe("withoutReleased", () => {
  test("takes off the domains whose deletion worked, and nothing else", async () => {
    const state = await listed()
    const before = JSON.stringify(state)
    const next = withoutReleased(state, ["x.example.com"])
    expect(next.released).toEqual(["old.example.com"])
    const { released: _next, ...rest } = next
    const { released: _state, ...was } = state
    expect(rest).toEqual(was)
    expect(readRunnerState(next)).toEqual(next)
    expect(JSON.stringify(state)).toBe(before)
  })

  test("a domain not on the list is ignored, a domain in force among them", async () => {
    const state = await listed()
    expect(
      withoutReleased(state, ["b.example.com", "nowhere.example.com"])
    ).toEqual(state)
    expect(withoutReleased(state, []).released).toEqual(state.released)
    expect(
      withoutReleased(state, ["old.example.com", "x.example.com"]).released
    ).toEqual([])
  })
})

describe("domainsAfter: K15's count holds the list as it would be after the deploy", () => {
  test("a domain given up still counts until its deletion worked; one on the list routed again counts once; a new one counts", async () => {
    const state = await listed()
    // Three in force and two on the list.
    expect(domainsAfter(state, "b", state.routes.b!.routes)).toBe(5)
    expect(domainsAfter(state, "b", [route("b.example.com")])).toBe(5)
    expect(domainsAfter(state, "b", [])).toBe(5)
    expect(domainsAfter(state, "new", [route("old.example.com")])).toBe(5)
    expect(domainsAfter(state, "new", [route("new.example.com")])).toBe(6)
    // Once a deletion worked, it no longer counts.
    expect(
      domainsAfter(withoutReleased(state, ["old.example.com"]), "new", [])
    ).toBe(4)
  })

  test("so a state the deploy would write fits whenever the count does", async () => {
    const state = await listed()
    const many = Array.from(
      { length: LIMITS.domainsPerServer - 3 - 2 },
      (_, n) => `d${String(n).padStart(4, "0")}.example.com`
    )
    const full = readRunnerState({
      ...state,
      released: [...state.released, ...many].sort(),
    })
    expect(domainsAfter(full, "b", [])).toBe(LIMITS.domainsPerServer)
    expect(withAppRoutes(full, "b", null).released).toHaveLength(
      LIMITS.domainsPerServer - 1
    )
    expect(
      domainsAfter(full, "b", [
        ...full.routes.b!.routes,
        route("new.example.com"),
      ])
    ).toBe(LIMITS.domainsPerServer + 1)
  })
})
