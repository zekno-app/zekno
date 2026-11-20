/**
 * A released domain's certificate is deleted until it is gone
 * (specs/015-domains-https, contracts/runner.md, RN3, RN10, RN13), against
 * the real runner program and the stand-in for Docker, which keeps a
 * certificate on the proxy's volume for each domain Caddy loaded. A deletion
 * that fails keeps the domain in the state's list of released domains, in
 * the same write that released it; the next deploy of any app and the next
 * `proxy` request try every domain on the list again, until the deletion
 * works. What the list may hold, K15's count and the mark are in
 * routes-released-state.test.ts.
 */
import { describe, expect, test } from "bun:test"

import {
  API,
  certificatesOf,
  deletions,
  releasedAlone,
  releasedButKept,
  twoApps,
} from "../support/released"
import {
  ask,
  certificates as CERTIFICATES,
  certificatesAlone,
  deployRoutes,
  route,
  stateOf,
  steps,
  up,
} from "../support/routes"

describe("a deletion that fails (RN10, step 1)", () => {
  test("keeps the domain on the list, written with the release itself; the outcome is still started", async () => {
    const w = await releasedButKept()
    const state = stateOf(w.home)
    expect(state.v).toBe(4)
    expect(Object.keys(state.routes)).toEqual(["api"])
    expect(state.released).toEqual(["app.example.com"])
    expect(deletions(steps(w))).toEqual([CERTIFICATES("app.example.com")])
  })

  test("the next deploy of an app with routes tries it again, until it works; then the list is empty and the state says so", async () => {
    const w = await releasedButKept()
    w.docker.script({ deletionFails: 1 })
    let before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 1, { app: "api", routes: [API] })).result.outcome
    ).toBe("started")
    expect(deletions(steps(w).slice(before))).toEqual([
      CERTIFICATES("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    expect(certificatesOf(w)).toContain("app.example.com")

    before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 2, { app: "api", routes: [API] })).result.outcome
    ).toBe("started")
    expect(deletions(steps(w).slice(before))).toEqual([
      CERTIFICATES("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual([])
    expect(certificatesOf(w)).toEqual(["api.example.com"])

    // Nothing is left to try.
    before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 3, { app: "api", routes: [API] })).result.outcome
    ).toBe("started")
    expect(deletions(steps(w).slice(before))).toEqual([])
  })

  test("a deploy that releases a domain tries the older ones on the list too, in order", async () => {
    const w = await releasedButKept()
    w.docker.script({ deletionFails: 1 })
    expect(
      (
        await deployRoutes(w, 1, {
          app: "api",
          routes: [API, route("www.example.com", "api", 8080)],
        })
      ).result.outcome
    ).toBe("started")
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    w.docker.script({ deletionFails: 1 })
    const before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 2, { app: "api", routes: [API] })).result.outcome
    ).toBe("started")
    expect(deletions(steps(w).slice(before))).toEqual([
      CERTIFICATES("app.example.com"),
      CERTIFICATES("www.example.com"),
    ])
    // The first failed, the second worked.
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    expect(certificatesOf(w)).toEqual(["api.example.com", "app.example.com"])
  })
})

describe("a deploy with no route and no health check, that held none (RN3)", () => {
  test("with an empty list, it makes exactly the Docker calls it made before", async () => {
    const w = await twoApps()
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 0, { app: "other" })).result).toEqual({
      outcome: "started",
      app: "other",
      sequence: 1,
    })
    expect(steps(w).slice(before)).toEqual([up("other")])
  })

  test("with a domain on the list, it tries it after up: the proxy found, the deletion, the state saved", async () => {
    const w = await releasedButKept()
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 0, { app: "other" })).result).toEqual({
      outcome: "started",
      app: "other",
      sequence: 1,
    })
    expect(steps(w).slice(before)).toEqual([
      up("other"),
      "inspect --type container zekno-proxy",
      CERTIFICATES("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual([])
    expect(certificatesOf(w)).toEqual(["api.example.com"])

    // Once the list is empty, today's calls only.
    const quiet = w.docker.calls().length
    expect((await deployRoutes(w, 1, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(steps(w).slice(quiet)).toEqual([up("other")])
  })

  test("its outcome is its own: a deletion that fails is not reported, and one tried after up failed still counts", async () => {
    const w = await releasedButKept()
    w.docker.script({ deletionFails: 1 })
    expect((await deployRoutes(w, 0, { app: "other" })).result).toEqual({
      outcome: "started",
      app: "other",
      sequence: 1,
    })
    expect(stateOf(w.home).released).toEqual(["app.example.com"])

    w.docker.failWith(1)
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { app: "other" })).result).toEqual({
      outcome: "start_failed",
      app: "other",
      sequence: 2,
    })
    expect(deletions(steps(w).slice(before))).toEqual([
      CERTIFICATES("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual([])
  })
})

describe("the proxy request (RN13)", () => {
  test("once the proxy serves the routes in force, it tries the list and saves", async () => {
    const w = await releasedButKept()
    w.docker.script({ deletionFails: 1 })
    expect(await ask(w, "proxy")).toEqual({ proxy: "running" })
    expect(stateOf(w.home).released).toEqual(["app.example.com"])

    const before = w.docker.calls().length
    expect(await ask(w, "proxy")).toEqual({ proxy: "running" })
    expect(steps(w).slice(before)).toEqual([
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      CERTIFICATES("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual([])
    expect(certificatesOf(w)).toEqual(["api.example.com"])
  })

  test("no app has a route: once the proxy is removed, the list is tried through a short-lived container of the pinned image", async () => {
    const w = await releasedAlone()
    const before = w.docker.calls().length
    expect(await ask(w, "proxy")).toEqual({ proxy: "none" })
    expect(steps(w).slice(before)).toEqual([
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      "volume inspect zekno-proxy-data",
      certificatesAlone("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual([])
    expect(certificatesOf(w)).toEqual([])
  })

  test("a proxy request that fails tries nothing, and the list stays", async () => {
    const w = await releasedButKept()
    w.docker.change("zekno-proxy", {
      labels: { "app.zekno.server": "another", "app.zekno.role": "proxy" },
    })
    const before = w.docker.calls().length
    expect(await ask(w, "proxy")).toEqual({
      outcome: "routes_failed",
      routes: { failure: "not_loaded" },
    })
    expect(deletions(steps(w).slice(before))).toEqual([])
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
  })
})

describe("what is known to be gone", () => {
  test("the proxy gone and its volume there: deleted through the short-lived container; one that fails stays", async () => {
    const w = await releasedAlone()
    w.docker.script({ deletionFails: 1 })
    expect((await deployRoutes(w, 0, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(steps(w).slice(before)).toEqual([
      up("other"),
      "inspect --type container zekno-proxy",
      "volume inspect zekno-proxy-data",
      certificatesAlone("app.example.com"),
    ])
    expect(stateOf(w.home).released).toEqual([])
    expect(certificatesOf(w)).toEqual([])
  })

  test("the proxy gone and its volume known not to be there: nothing to delete, so gone, and nothing is run", async () => {
    const w = await releasedAlone()
    w.docker.removeVolume("zekno-proxy-data")
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 0, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(steps(w).slice(before)).toEqual([
      up("other"),
      "inspect --type container zekno-proxy",
      "volume inspect zekno-proxy-data",
    ])
    expect(stateOf(w.home).released).toEqual([])
    expect(w.docker.model().volumes).not.toContain("zekno-proxy-data")
  })

  test("Docker did not answer about the volume, or about the proxy, or the proxy is another server's: not gone, it stays", async () => {
    const w = await releasedAlone()
    w.docker.script({ failing: ["volume inspect"] })
    expect((await deployRoutes(w, 0, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(stateOf(w.home).released).toEqual(["app.example.com"])

    w.docker.script({ failing: ["inspect --type container zekno-proxy"] })
    let before = w.docker.calls().length
    expect((await deployRoutes(w, 1, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(steps(w).slice(before)).toEqual([
      up("other"),
      "inspect --type container zekno-proxy",
    ])
    expect(stateOf(w.home).released).toEqual(["app.example.com"])

    w.docker.script({ failing: [] })
    w.docker.container({
      name: "zekno-proxy",
      labels: { "app.zekno.server": "another", "app.zekno.role": "proxy" },
    })
    before = w.docker.calls().length
    expect((await deployRoutes(w, 2, { app: "other" })).result.outcome).toBe(
      "started"
    )
    expect(steps(w).slice(before)).toEqual([
      up("other"),
      "inspect --type container zekno-proxy",
    ])
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    expect(certificatesOf(w)).toEqual(["app.example.com"])
  })
})
