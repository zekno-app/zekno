/**
 * Releasing and claiming domains (specs/015-domains-https, contracts/
 * runner.md, RN2, RN9, RN10; core.md, K10b; US4), against the real runner
 * program and the stand-in for Docker. A domain another app holds is refused
 * with no number used; a release loads the configuration without the domain
 * before anything else, then deletes its certificate, leaves and removes the
 * app's route network, and the last release removes the proxy.
 */
import { describe, expect, test } from "bun:test"

import { leftAsItWas } from "../support/deploy-v2"
import { world } from "../support/helpers"
import {
  certificates as CERTIFICATES,
  configRoutes,
  deployRoutes,
  LOAD,
  route,
  stateOf,
  steps,
  up,
} from "../support/routes"

const APP = route("app.example.com")
const API = route("api.example.com", "api", 8080)

/** A world where web holds app.example.com and api holds api.example.com. */
async function twoApps() {
  const w = await world()
  const ids = {
    web: w.docker.app("web", { web: 1 }).web![0]!,
    api: w.docker.app("api", { api: 1 }).api![0]!,
  }
  expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
    "started"
  )
  expect(
    (await deployRoutes(w, 0, { app: "api", routes: [API] })).result.outcome
  ).toBe("started")
  return { w, ids }
}

describe("who holds a domain (K10b, RN2)", () => {
  test("a deploy naming a domain another app holds is domain_taken: no number used, nothing written, Docker not called", async () => {
    const { w } = await twoApps()
    const before = leftAsItWas(w)
    const config = configRoutes(w.home)
    const { result, events } = await deployRoutes(w, 1, {
      app: "api",
      routes: [API, route("app.example.com", "api", 8080)],
    })
    expect({ result, events }).toEqual({
      result: { outcome: "refused", reason: "domain_taken" },
      events: [],
    })
    expect(leftAsItWas(w)).toEqual(before)
    expect(configRoutes(w.home)).toEqual(config)
    expect(stateOf(w.home).lastSequence).toEqual({ web: 1, api: 1 })
  })

  test("the app that holds a domain deploys it again; once released, another app can claim it", async () => {
    const { w } = await twoApps()
    expect((await deployRoutes(w, 1, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    expect((await deployRoutes(w, 2, { routes: [] })).result.outcome).toBe(
      "started"
    )
    const claimed = await deployRoutes(w, 1, {
      app: "api",
      routes: [API, route("app.example.com", "api", 8080)],
    })
    expect(claimed.result).toEqual({
      outcome: "started",
      app: "api",
      sequence: 2,
    })
    expect(Object.keys(stateOf(w.home).routes)).toEqual(["api"])
    expect(Object.keys(configRoutes(w.home))).toEqual([
      "api.example.com",
      "app.example.com",
    ])
  })
})

describe("a release (RN10)", () => {
  test("load without the domain first; then its certificate deleted, the proxy off the network, the network removed", async () => {
    const { w, ids } = await twoApps()
    const before = w.docker.calls().length

    const { result } = await deployRoutes(w, 1, { routes: [] })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 2 })
    expect(steps(w, ids).slice(before)).toEqual([
      up(),
      // RN6 to RN8: api still has a route, so the running proxy loads the file without web's.
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      ...LOAD,
      // RN10, in order.
      "inspect --type container zekno-proxy",
      CERTIFICATES("app.example.com"),
      "network disconnect zekno-route-web zekno-proxy",
      "network inspect zekno-route-web",
      "network disconnect zekno-route-web <web>",
      "network rm zekno-route-web",
    ])
    expect(Object.keys(stateOf(w.home).routes)).toEqual(["api"])
    expect(Object.keys(configRoutes(w.home))).toEqual(["api.example.com"])
    const model = w.docker.model()
    expect(model.networks.map((n) => n.name).sort()).toEqual([
      "zekno-proxy",
      "zekno-route-api",
    ])
    expect(model.containers.find((c) => c.name === "zekno-proxy")).toBeDefined()
  })

  test("a domain left out while others stay: only its certificate goes, the network stays", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    const both = [route("a.example.com"), route("b.example.com")]
    expect((await deployRoutes(w, 0, { routes: both })).result.outcome).toBe(
      "started"
    )
    const before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 1, { routes: [route("b.example.com")] })).result
        .outcome
    ).toBe("started")
    const after = steps(w).slice(before)
    expect(after.filter((step) => step.includes("rm -rf"))).toEqual([
      CERTIFICATES("a.example.com"),
    ])
    // Let's Encrypt has no OCSP any more, and a glob there could reach another domain's (security review S5).
    expect(after.join("\n")).not.toContain("/data/caddy/ocsp")
    expect(after.some((step) => step.startsWith("network rm"))).toBe(false)
    expect(after.some((step) => step.startsWith("network disconnect"))).toBe(
      false
    )
    expect(stateOf(w.home).routes.web!.routes).toEqual([route("b.example.com")])
  })

  test("the last release removes the proxy; its volumes and its own network stay", async () => {
    const w = await world()
    const [web] = w.docker.app("web", { web: 1 }).web!
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const before = w.docker.calls().length

    expect((await deployRoutes(w, 1, { routes: [] })).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(steps(w, { web: web! }).slice(before)).toEqual([
      up(),
      // No app needs a proxy, but the running one loads a file without the route first.
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      ...LOAD,
      "inspect --type container zekno-proxy",
      CERTIFICATES("app.example.com"),
      "network disconnect zekno-route-web zekno-proxy",
      "network inspect zekno-route-web",
      "network disconnect zekno-route-web <web>",
      "network rm zekno-route-web",
      "inspect --type container zekno-proxy",
      "rm -f zekno-proxy",
      "inspect --type container zekno-proxy",
    ])
    expect(stateOf(w.home).routes).toEqual({})
    expect(configRoutes(w.home)).toEqual({})
    const model = w.docker.model()
    expect(model.containers.map((c) => c.name)).toEqual(["zekno-web-web-1"])
    expect(model.networks.map((n) => n.name)).toEqual(["zekno-proxy"])
    expect(steps(w).some((step) => step.startsWith("volume"))).toBe(false)

    // Nothing held, nothing wanted: the next deploy makes today's calls only.
    const quiet = w.docker.calls().length
    expect((await deployRoutes(w, 2, { routes: [] })).result.outcome).toBe(
      "started"
    )
    expect(steps(w).slice(quiet)).toEqual([up()])
  })
})
