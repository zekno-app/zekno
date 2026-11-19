/**
 * `status` with routes and the `proxy` request (specs/015-domains-https,
 * contracts/runner.md, RN13; core.md, "`status` with routes" and "`proxy`";
 * US3), against the real runner program and the stand-in for Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  parseMessage,
  RunnerProxySchema,
  RunnerStatusSchema,
  RunnerStatusWithRoutesSchema,
} from "@workspace/core"

import { leftAsItWas } from "../support/deploy-v2"
import { world } from "../support/helpers"
import {
  ask,
  configRoutes,
  configText,
  deployRoutes,
  proxyRun,
  route,
  stateOf,
  steps,
  type World,
} from "../support/routes"

const APP = route("app.example.com")

async function routed(): Promise<World> {
  const w = await world()
  w.docker.app("web", { web: 1 })
  expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
    "started"
  )
  return w
}

describe("status with routes (RN13)", () => {
  test("no route anywhere: today's fields, routes {}, proxy none; the answer reads by its schema", async () => {
    const w = await world()
    const today = await ask(w, "status")
    const answer = await ask(w, "status", { routes: true })
    expect(answer).toEqual({ ...today, routes: {}, proxy: "none" })
    expect(parseMessage(RunnerStatusWithRoutesSchema, answer).ok).toBe(true)
  })

  test("with a route: the routes in force and proxy running; it changes nothing and asks Docker only about the proxy", async () => {
    const w = await routed()
    const before = leftAsItWas(w)
    const answer = await ask(w, "status", { routes: true })
    expect(answer).toMatchObject({
      serverId: w.serverId,
      lastSequence: { web: 1 },
      routes: { web: [APP] },
      proxy: "running",
    })
    expect(parseMessage(RunnerStatusWithRoutesSchema, answer).ok).toBe(true)
    const after = leftAsItWas(w)
    expect(after.state).toBe(before.state)
    expect(steps(w).slice(before.calls.length)).toEqual([
      "inspect --type container zekno-proxy",
    ])
  })

  test("an app with a health check and no domain is not in routes", async () => {
    const w = await world()
    w.docker.app("web", { web: [{ health: "healthy" }] })
    expect(
      (
        await deployRoutes(w, 0, {
          health: { timeout: 5, services: [{ service: "web", http: null }] },
        })
      ).result.outcome
    ).toBe("started")
    expect(await ask(w, "status", { routes: true })).toMatchObject({
      routes: {},
      proxy: "none",
    })
  })

  test("the proxy stopped, gone, or from another image: stopped, missing, other_image", async () => {
    const w = await routed()
    w.docker.change("zekno-proxy", { running: false })
    expect((await ask(w, "status", { routes: true })).proxy).toBe("stopped")
    w.docker.change("zekno-proxy", {
      running: true,
      image: "caddy:2.11.9-alpine",
    })
    expect((await ask(w, "status", { routes: true })).proxy).toBe("other_image")
    w.docker.change("zekno-proxy", {
      labels: { "app.zekno.server": "another" },
    })
    expect((await ask(w, "status", { routes: true })).proxy).toBe("missing")
    w.docker.change("zekno-proxy", { name: "renamed" })
    expect((await ask(w, "status", { routes: true })).proxy).toBe("missing")
  })

  test("without the input, today's answer exactly; any other input is invalid_request", async () => {
    const w = await routed()
    const today = await ask(w, "status")
    expect(Object.keys(today).sort()).toEqual([
      "lastSequence",
      "secrets",
      "serverId",
      "serverPublicKey",
      "team",
    ])
    expect(parseMessage(RunnerStatusSchema, today).ok).toBe(true)
    for (const input of [
      { routes: false },
      { routes: true, extra: 1 },
      {},
      null,
      "routes",
      [true],
    ])
      expect(await ask(w, "status", input)).toEqual({
        outcome: "refused",
        reason: "invalid_request",
      })
  })
})

describe("proxy (RN13)", () => {
  test("puts back a proxy that is gone, from the state alone, and answers running", async () => {
    const w = await routed()
    const file = configRoutes(w.home)
    w.docker.change("zekno-proxy", { name: "gone" })
    const before = w.docker.calls().length
    const answer = await ask(w, "proxy")
    expect(answer).toEqual({ proxy: "running" })
    expect(parseMessage(RunnerProxySchema, answer).ok).toBe(true)
    const after = steps(w).slice(before)
    expect(after).toContain(proxyRun())
    // It names no container: no compose call, no alias given.
    expect(after.some((step) => step.startsWith("compose"))).toBe(false)
    expect(after.some((step) => step.includes("--alias"))).toBe(false)
    // Only the routes a signed deploy put in force.
    expect(configRoutes(w.home)).toEqual(file)
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
  })

  test("makes a proxy from another image again from the pinned one", async () => {
    const w = await routed()
    w.docker.change("zekno-proxy", { image: "caddy:2.11.9-alpine" })
    expect(await ask(w, "proxy")).toEqual({ proxy: "running" })
    const after = steps(w)
    const rm = after.lastIndexOf("rm -f zekno-proxy")
    expect(rm).toBeGreaterThan(0)
    expect(after.slice(rm)).toContain(proxyRun())
    expect((await ask(w, "status", { routes: true })).proxy).toBe("running")
  })

  test("starts a proxy that stopped, on the state's file", async () => {
    const w = await routed()
    w.docker.change("zekno-proxy", { running: false })
    const before = w.docker.calls().length
    expect(await ask(w, "proxy")).toEqual({ proxy: "running" })
    expect(steps(w).slice(before)).toContain("start zekno-proxy")
  })

  test("a proxy that runs as the state says is left as it is: nothing loaded", async () => {
    const w = await routed()
    const before = w.docker.calls().length
    expect(await ask(w, "proxy")).toEqual({ proxy: "running" })
    expect(steps(w).slice(before)).toEqual([
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
    ])
  })

  test("no app has a route: this runner's proxy is removed, another's is not; answers none", async () => {
    const w = await routed()
    expect((await deployRoutes(w, 1, { routes: [] })).result.outcome).toBe(
      "started"
    )
    expect(await ask(w, "proxy")).toEqual({ proxy: "none" })

    // A proxy of this runner's left behind is removed.
    w.docker.container({
      name: "zekno-proxy",
      labels: { "app.zekno.server": w.serverId, "app.zekno.role": "proxy" },
    })
    expect(await ask(w, "proxy")).toEqual({ proxy: "none" })
    expect(
      w.docker.model().containers.some((c) => c.name === "zekno-proxy")
    ).toBe(false)

    // Another server's is never touched.
    w.docker.container({
      name: "zekno-proxy",
      labels: { "app.zekno.server": "another", "app.zekno.role": "proxy" },
    })
    const before = w.docker.calls().length
    expect(await ask(w, "proxy")).toEqual({ proxy: "none" })
    expect(steps(w).slice(before)).toEqual([
      "inspect --type container zekno-proxy",
    ])
  })

  test("port_taken and not_loaded are routes_failed reports; the state is never written", async () => {
    const w = await routed()
    const state = stateOf(w.home)
    w.docker.change("zekno-proxy", { name: "gone" })
    w.docker.script({
      runFails: {
        code: 125,
        stderr: "Bind for 0.0.0.0:80 failed: port is already allocated",
        leave: true,
      },
    })
    const taken = await ask(w, "proxy")
    expect(taken).toEqual({
      outcome: "routes_failed",
      routes: { failure: "port_taken", port: 80 },
    })
    expect(parseMessage(RunnerProxySchema, taken).ok).toBe(true)

    w.docker.container({
      name: "zekno-proxy",
      labels: { "app.zekno.server": "another", "app.zekno.role": "proxy" },
    })
    const foreign = await ask(w, "proxy")
    expect(foreign).toEqual({
      outcome: "routes_failed",
      routes: { failure: "not_loaded" },
    })
    expect(parseMessage(RunnerProxySchema, foreign).ok).toBe(true)
    expect(stateOf(w.home)).toEqual(state)
  })

  test("takes no input, and is refused when the server is not set up", async () => {
    const w = await routed()
    expect(await ask(w, "proxy", {})).toEqual({
      outcome: "refused",
      reason: "invalid_request",
    })
    const bare = { ...w, home: `${w.home}-none` }
    expect(await ask(bare, "proxy")).toEqual({
      outcome: "refused",
      reason: "not_set_up",
    })
  })
})
