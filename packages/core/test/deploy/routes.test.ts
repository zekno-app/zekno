/**
 * Who holds a domain, and the state with one app's routes replaced
 * (specs/015-domains-https, contracts/core.md, "The state": `deploy/routes.ts`).
 */
import { describe, expect, test } from "bun:test"

import {
  domainHolders,
  domainsAfter,
  withAppRoutes,
} from "../../src/deploy/routes"
import { readRunnerState } from "../../src/deploy/state"
import { CoreError } from "../../src/protocol/result"
import { deepFreeze, world } from "../support/deploy-v2"
import { appRoutes, holding, named, route } from "../support/routes"

/** `shop` with two domains, `blog` with one, `api` with a health check only, `old` at format 1. */
async function held() {
  const w = await world()
  const state = holding(
    {
      ...w.state,
      lastSequence: { old: 4 },
      formats: { old: 1 },
    },
    {
      shop: appRoutes(["shop.example.com", "www.shop.example.com"], 1),
      blog: appRoutes(["blog.example.com"], 2),
      api: { routes: [], names: { api: [named(3)] } },
    }
  )
  return deepFreeze(state)
}

describe("domainHolders", () => {
  test("each domain in force, to the app that holds it", async () => {
    const state = await held()
    expect(domainHolders(state)).toEqual(
      new Map([
        ["shop.example.com", "shop"],
        ["www.shop.example.com", "shop"],
        ["blog.example.com", "blog"],
      ])
    )
  })

  test("none on a server with no routes", async () => {
    const w = await world()
    expect(domainHolders(w.state).size).toBe(0)
  })
})

describe("domainsAfter", () => {
  test("the domains the server would hold with this app's routes replaced", async () => {
    const state = await held()
    // As it is.
    expect(domainsAfter(state, "shop", state.routes.shop!.routes)).toBe(3)
    // The app gives up one, takes two, or gives up all.
    expect(domainsAfter(state, "shop", [route("shop.example.com")])).toBe(2)
    expect(
      domainsAfter(state, "blog", [
        route("blog.example.com"),
        route("news.example.com"),
      ])
    ).toBe(4)
    expect(domainsAfter(state, "shop", [])).toBe(1)
    // An app that holds none yet, and an app with a health check only.
    expect(domainsAfter(state, "new", [route("new.example.com")])).toBe(4)
    expect(domainsAfter(state, "api", [route("api.example.com")])).toBe(4)
    // A domain another app holds counts once: K10b refuses that deploy first.
    expect(domainsAfter(state, "new", [route("blog.example.com")])).toBe(3)
  })
})

describe("withAppRoutes", () => {
  test("replaces, adds or removes one app's entry, read back strictly, the state given unchanged", async () => {
    const state = await held()
    const before = JSON.stringify(state)
    const replaced = withAppRoutes(
      state,
      "shop",
      appRoutes(["shop.example.com"], 7)
    )
    expect(replaced.routes.shop).toEqual(appRoutes(["shop.example.com"], 7))
    expect(replaced.routes.blog).toEqual(state.routes.blog)
    const added = withAppRoutes(
      { ...state, formats: { ...state.formats, old: 2 } },
      "old",
      appRoutes(["old.example.com"], 8)
    )
    expect(added.routes.old).toEqual(appRoutes(["old.example.com"], 8))
    const removed = withAppRoutes(state, "shop", null)
    expect(Object.keys(removed.routes).sort()).toEqual(["api", "blog"])
    // The numbers, formats and everything else are as they were.
    const { routes: _routes, ...rest } = state
    for (const next of [replaced, removed]) {
      const { routes: _next, ...others } = next
      expect(others).toEqual(rest)
      expect(readRunnerState(next)).toEqual(next)
    }
    // Removing what an app does not hold changes nothing.
    expect(withAppRoutes(state, "new", null)).toEqual(state)
    expect(JSON.stringify(state)).toBe(before)
  })

  test("gives the apps in order of their names", async () => {
    const state = await held()
    const next = withAppRoutes(state, "blog", appRoutes(["b.example.com"], 2))
    expect(Object.keys(next.routes)).toEqual(["api", "blog", "shop"])
  })

  test("throws for a state the strict rules refuse", async () => {
    const state = await held()
    for (const [app, entry] of [
      // A domain another app holds.
      ["blog", appRoutes(["shop.example.com"], 2)],
      // An app at format 1, and one the state does not hold.
      ["old", appRoutes(["old.example.com"], 8)],
      ["new", appRoutes(["new.example.com"], 8)],
      // A name another app has.
      ["blog", appRoutes(["blog.example.com"], 1)],
      // Neither a route nor a name.
      ["blog", { routes: [], names: {} }],
      ["Blog", appRoutes(["blog2.example.com"], 9)],
    ] as const)
      expect(() => withAppRoutes(state, app, entry)).toThrow(CoreError)
  })
})
