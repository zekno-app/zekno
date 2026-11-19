/**
 * A deploy's routes put in force (specs/015-domains-https, contracts/
 * runner.md, RN3 to RN10; US1), against the real runner program and the
 * stand-in for Docker: the calls and their order, the proxy's file, the state
 * before and after, the outcome.
 */
import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"

import { GREETING } from "../support/deploy-v2"
import { world } from "../support/helpers"
import {
  configRoutes,
  configText,
  deployRoutes,
  LOAD,
  NONCE_SAVED,
  proxyRun,
  route,
  stateOf,
  steps,
  up,
  VALIDATE_ALONE,
} from "../support/routes"

const APP = route("app.example.com")
const API = route("api.example.com", "api", 8080)

describe("a first route (RN4 to RN9)", () => {
  test("names the container on the app's route network, starts the proxy on the file, joins, confirms, then saves the routes", async () => {
    const w = await world()
    const [web] = w.docker.app("web", { web: 1 }).web!
    expect(stateOf(w.home).routes).toEqual({})

    const { result, events } = await deployRoutes(w, 0, { routes: [APP] })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 1 })
    expect(events.filter((e) => e.event !== "progress")).toEqual([])

    expect(steps(w, { web: web! })).toEqual([
      up(),
      // RN4: the service's containers, and each one's labels.
      "compose -p zekno-web ps -q web",
      "inspect --type container <web>",
      // RN5: the route network, made with the runner's labels, and a name the runner made.
      "network inspect zekno-route-web",
      "network create --label app.zekno.server=<server> --label app.zekno.app=web zekno-route-web",
      "network connect --alias <name> zekno-route-web <web>",
      "inspect --type container <web>",
      // RN6: no proxy yet; its own network; the file validated with no proxy, put in place, then the run on it.
      "inspect --type container zekno-proxy",
      "network inspect zekno-proxy",
      "network create --label app.zekno.server=<server> --label app.zekno.role=proxy zekno-proxy",
      VALIDATE_ALONE,
      proxyRun(),
      "logs --since <time> zekno-proxy",
      // RN8 for a proxy just started on this file: joining, then the nonce only.
      "inspect --type container zekno-proxy",
      "network connect zekno-route-web zekno-proxy",
      NONCE_SAVED,
      // RN10: nothing released.
      "inspect --type container zekno-proxy",
    ])

    // The name the runner gave is the one Docker shows, the one in the file and the one saved.
    const state = stateOf(w.home)
    const [named] = state.routes.web!.names.web!
    expect(named!.container).toBe(web!)
    expect(named!.name).toMatch(/^z[0-9a-f]{32}$/)
    const container = w.docker.model().containers.find((c) => c.id === web)!
    expect(container.networks["zekno-route-web"]).toEqual({
      aliases: [named!.name],
    })
    expect(state.routes).toEqual({
      web: { routes: [APP], names: { web: [named!] } },
    })
    expect(state.lastSequence).toEqual({ web: 1 })
    expect(configRoutes(w.home)).toEqual({
      "app.example.com": [`${named!.name}:3000`],
    })
    // The proxy confirmed the nonce of the file in place.
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
    // Every call ran in the runner's folder, with no secret in its environment.
    for (const call of w.docker.calls()) {
      expect(call.cwd).toBe(realpathSync(w.home))
      if (!call.args.startsWith("compose -p zekno-web -f"))
        expect(Object.values(call.env)).not.toContain(GREETING)
    }
  })
})

describe("routes beside routes (RN5 to RN8)", () => {
  test("a second app's route: its own network and name, the running proxy joined first, then the file loaded by a signal sent with exec", async () => {
    const w = await world()
    const [web] = w.docker.app("web", { web: 1 }).web!
    const [api] = w.docker.app("api", { api: 1 }).api!
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const before = w.docker.calls().length

    const { result } = await deployRoutes(w, 0, { app: "api", routes: [API] })
    expect(result).toEqual({ outcome: "started", app: "api", sequence: 1 })
    expect(steps(w, { web: web!, api: api! }).slice(before)).toEqual([
      up("api"),
      "compose -p zekno-api ps -q api",
      "inspect --type container <api>",
      "network inspect zekno-route-api",
      "network create --label app.zekno.server=<server> --label app.zekno.app=api zekno-route-api",
      "network connect --alias <name> zekno-route-api <api>",
      "inspect --type container <api>",
      // RN6: the proxy runs from the pinned image.
      "inspect --type container zekno-proxy",
      // RN8: joining comes before loading.
      "inspect --type container zekno-proxy",
      "network connect zekno-route-api zekno-proxy",
      ...LOAD,
      "inspect --type container zekno-proxy",
    ])
    // Never `docker kill`: it would switch the proxy's restart policy off.
    expect(w.docker.argv().some((argv) => argv[0] === "kill")).toBe(false)

    const state = stateOf(w.home)
    const webName = state.routes.web!.names.web![0]!.name
    const apiName = state.routes.api!.names.api![0]!.name
    expect(apiName).not.toBe(webName)
    // Every app's routes, in the order of their domains.
    expect(configRoutes(w.home)).toEqual({
      "api.example.com": [`${apiName}:8080`],
      "app.example.com": [`${webName}:3000`],
    })
    expect(Object.keys(configRoutes(w.home))).toEqual([
      "api.example.com",
      "app.example.com",
    ])
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
    const proxy = w.docker
      .model()
      .containers.find((c) => c.name === "zekno-proxy")!
    expect(Object.keys(proxy.networks).sort()).toEqual([
      "zekno-proxy",
      "zekno-route-api",
      "zekno-route-web",
    ])
  })

  test("an unchanged redeploy keeps the name and loads nothing: no file written, no signal", async () => {
    const w = await world()
    const [web] = w.docker.app("web", { web: 1 }).web!
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const file = configText(w.home)
    const named = stateOf(w.home).routes.web!.names.web!
    const before = w.docker.calls().length

    expect((await deployRoutes(w, 1, { routes: [APP] })).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(steps(w, { web: web! }).slice(before)).toEqual([
      up(),
      "compose -p zekno-web ps -q web",
      "inspect --type container <web>",
      "network inspect zekno-route-web",
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
    ])
    expect(configText(w.home)).toBe(file)
    expect(stateOf(w.home).routes.web!.names.web).toEqual(named)
  })

  test("a container made again gets a new name and the file is loaded; one kept keeps its own", async () => {
    const w = await world()
    const [first, second] = w.docker.app("web", { web: 2 }).web!
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const before = stateOf(w.home).routes.web!.names.web!
    const kept = before.find((n) => n.container === first)!
    const remade = w.docker.remake(second!)

    expect((await deployRoutes(w, 1, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const after = stateOf(w.home).routes.web!.names.web!
    expect(after).toHaveLength(2)
    expect(after.find((n) => n.container === first)).toEqual(kept)
    const fresh = after.find((n) => n.container === remade)!
    expect(fresh.name).toMatch(/^z[0-9a-f]{32}$/)
    expect(before.map((n) => n.name)).not.toContain(fresh.name)
    expect(after.some((n) => n.container === second)).toBe(false)
    // Sorted by container, as the state keeps them; the file has both, and was loaded.
    expect(after.map((n) => n.container)).toEqual([first!, remade].sort())
    expect(configRoutes(w.home)["app.example.com"]!.sort()).toEqual(
      [`${kept.name}:3000`, `${fresh.name}:3000`].sort()
    )
    expect(steps(w)).toContain("exec zekno-proxy kill -USR1 1")
    expect(w.docker.model().autosave).toBe(configText(w.home)!)
  })
})

describe("SC-005: an app with no route and no health check (RN3)", () => {
  test("makes exactly today's calls, also beside an app with a route; no proxy file is written for it", async () => {
    const w = await world()
    expect((await deployRoutes(w, 0)).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 1,
    })
    expect(steps(w)).toEqual([up()])
    expect(w.docker.argv()).toEqual([])
    expect(w.docker.inspections()).toEqual([])
    expect(configText(w.home)).toBeUndefined()
    expect(stateOf(w.home).routes).toEqual({})

    w.docker.app("api", { api: 1 })
    expect(
      (await deployRoutes(w, 0, { app: "api", routes: [API] })).result.outcome
    ).toBe("started")
    const before = w.docker.calls().length
    const file = configText(w.home)
    expect((await deployRoutes(w, 1)).result.outcome).toBe("started")
    expect(steps(w).slice(before)).toEqual([up()])
    expect(configText(w.home)).toBe(file)
  })

  test("a failed start of such an app is start_failed as today, with no other call", async () => {
    const w = await world()
    w.docker.failWith(1)
    expect((await deployRoutes(w, 0)).result).toEqual({
      outcome: "start_failed",
      app: "web",
      sequence: 1,
    })
    expect(steps(w)).toEqual([up()])
  })
})
