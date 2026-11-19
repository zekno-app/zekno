/**
 * A deploy's health check (specs/015-domains-https, contracts/runner.md,
 * RN11, RN12; US5), against the real runner program and the stand-in for
 * Docker: the event as each service's wait begins, the check made by curl in
 * a container of the pinned image on the app's route network, Docker's own
 * status without a path, and `unhealthy` when time runs out, with nothing
 * stopped, rolled back or released.
 */
import { describe, expect, test } from "bun:test"
import type { Health } from "@workspace/core"

import { world } from "../support/helpers"
import {
  configText,
  deployRoutes,
  route,
  stateOf,
  steps,
} from "../support/routes"

const PATH_CHECK: Health = {
  timeout: 30,
  services: [{ service: "web", http: { port: 3000, path: "/health" } }],
}

/** The calls that make the health check's request, each exactly as passed. */
const checks = (w: Awaited<ReturnType<typeof world>>) =>
  w.docker
    .argv()
    .filter(
      (argv) => argv[0] === "run" && argv[1] === "--rm" && argv.includes("curl")
    )

describe("with a path (RN11)", () => {
  test("healthy: the event, then curl from the pinned image on the route network, one argument for the URL; started", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    const health: Health = {
      timeout: 30,
      services: [
        { service: "web", http: { port: 3000, path: "/health?ready=1" } },
      ],
    }
    const { result, events } = await deployRoutes(w, 0, {
      routes: [route("app.example.com")],
      health,
    })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 1 })
    expect(events.filter((e) => e.event !== "progress")).toEqual([
      { event: "health", service: "web" },
    ])
    const name = stateOf(w.home).routes.web!.names.web![0]!.name
    const [check] = checks(w)
    expect(check!.slice(0, -4)).toEqual([
      "run",
      "--rm",
      "--network",
      "zekno-route-web",
      // No search domain of the host's completes a name that is not there.
      "--dns-search",
      ".",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "65534:65534",
      "--memory",
      "32m",
      "--pids-limit",
      "16",
      check![17]!,
      "curl",
      "-sS",
      "-o",
      "/dev/null",
      "--max-time",
      "5",
      "--max-filesize",
      "1024",
      "--proto",
    ])
    expect(check![17]).toMatch(/^caddy@sha256:[0-9a-f]{64}$/)
    expect(check!.slice(-4)).toEqual([
      "=http",
      "-w",
      "%{http_code}|%{exitcode}",
      `http://${name}:3000/health?ready=1`,
    ])
    expect(checks(w)).toHaveLength(1)
  })

  test("a path with quotes, brackets and a query stays one argument", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    const path = "/h/(a)!$&*+,;=:@~'?q=%20"
    const { result } = await deployRoutes(w, 0, {
      health: {
        timeout: 30,
        services: [{ service: "web", http: { port: 8080, path } }],
      },
    })
    expect(result.outcome).toBe("started")
    const name = stateOf(w.home).routes.web!.names.web![0]!.name
    expect(checks(w)[0]!.at(-1)).toBe(`http://${name}:8080${path}`)
  })

  test("every copy of the service is asked; 302 is healthy and not followed (curl gets no -L)", async () => {
    const w = await world()
    w.docker.app("web", { web: 3 })
    w.docker.script({ curl: { web: "302|0" } })
    expect(
      (
        await deployRoutes(w, 0, {
          routes: [route("app.example.com")],
          health: PATH_CHECK,
        })
      ).result.outcome
    ).toBe("started")
    expect(checks(w)).toHaveLength(3)
    expect(checks(w).some((argv) => argv.includes("-L"))).toBe(false)
    const names = stateOf(w.home).routes.web!.names.web!.map((n) => n.name)
    expect(
      checks(w)
        .map((argv) => argv.at(-1)!.split(":")[1]!.slice(2))
        .sort()
    ).toEqual(names.sort())
  })

  test("a body cut at 1 KiB (exit 63) is healthy; a status line then silence (200 with exit 28) is not", async () => {
    for (const [said, outcome] of [
      ["200|63", "started"],
      ["200|28", "unhealthy"],
      ["500|0", "unhealthy"],
      ["000|7", "unhealthy"],
      ["199|0", "unhealthy"],
      ["400|0", "unhealthy"],
    ] as const) {
      const w = await world()
      w.docker.app("web", { web: 1 })
      w.docker.script({ curl: { web: said } })
      // The limit leaves time for a check once the route steps are done: the rule decides, not the clock.
      const { result } = await deployRoutes(w, 0, {
        health: {
          timeout: outcome === "started" ? 30 : 3,
          services: [{ service: "web", http: { port: 3000, path: "/" } }],
        },
      })
      expect([said, result.outcome]).toEqual([said, outcome])
      expect(checks(w).length).toBeGreaterThan(0)
    }
  }, 60_000)

  test("not healthy in time: unhealthy with the service and http true; the app, its routes and names left as they are", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({ curl: { web: "500|0" } })
    const started = Date.now()
    const { result, events } = await deployRoutes(w, 0, {
      routes: [route("app.example.com")],
      health: { ...PATH_CHECK, timeout: 3 },
    })
    expect(result).toEqual({
      outcome: "unhealthy",
      app: "web",
      sequence: 1,
      health: { service: "web", http: true },
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000)
    expect(events.filter((e) => e.event === "health")).toEqual([
      { event: "health", service: "web" },
    ])
    // One round every 2 seconds, within the limit: at most three.
    expect(checks(w).length).toBeGreaterThanOrEqual(2)
    expect(checks(w).length).toBeLessThanOrEqual(3)
    // Nothing stopped, rolled back or released.
    expect(
      w.docker
        .argv()
        .some(
          (argv) =>
            ["rm", "stop", "kill"].includes(argv[0]!) || argv.includes("down")
        )
    ).toBe(false)
    expect(stateOf(w.home).routes.web!.routes).toEqual([
      route("app.example.com"),
    ])
    expect(configText(w.home)).toContain("app.example.com")
    expect(w.docker.model().containers.every((c) => c.running)).toBe(true)
  })
})

describe("without a path (RN11)", () => {
  test("Docker's own health check: healthy at once, or unhealthy with http false", async () => {
    const healthy = await world()
    healthy.docker.app("web", { web: [{ health: "healthy" }] })
    const up = (timeout: number): Health => ({
      timeout,
      services: [{ service: "web", http: null }],
    })
    expect(
      (await deployRoutes(healthy, 0, { health: up(30) })).result.outcome
    ).toBe("started")

    const starting = await world()
    starting.docker.app("web", { web: [{ health: "starting" }] })
    expect((await deployRoutes(starting, 0, { health: up(3) })).result).toEqual(
      {
        outcome: "unhealthy",
        app: "web",
        sequence: 1,
        health: { service: "web", http: false },
      }
    )
    // No request is made without a path.
    expect(checks(starting)).toEqual([])
  })

  test("no health check of its own: running with the same restart count 10 seconds later", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    const started = Date.now()
    const { result } = await deployRoutes(w, 0, {
      health: { timeout: 30, services: [{ service: "web", http: null }] },
    })
    expect(result.outcome).toBe("started")
    expect(Date.now() - started).toBeGreaterThanOrEqual(10_000)
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 40_000)

  test("a container in a restart loop is running at each look, but never with the same count: unhealthy", async () => {
    const w = await world()
    const [web] = w.docker.app("web", { web: 1 }).web!
    w.docker.script({ restarting: [web!] })
    const { result } = await deployRoutes(w, 0, {
      health: { timeout: 12, services: [{ service: "web", http: null }] },
    })
    expect(result).toEqual({
      outcome: "unhealthy",
      app: "web",
      sequence: 1,
      health: { service: "web", http: false },
    })
  }, 40_000)
})

describe("services in order, and a check with no route", () => {
  test("each service's event as its wait begins, in order; the first not healthy in time is the one reported", async () => {
    const w = await world()
    w.docker.app("app", { api: 1, web: 1, worker: [{ health: "healthy" }] })
    w.docker.script({ curl: { web: "503|0" } })
    const { result, events } = await deployRoutes(w, 0, {
      app: "app",
      health: {
        timeout: 5,
        services: [
          { service: "api", http: { port: 8080, path: "/" } },
          { service: "web", http: { port: 3000, path: "/" } },
          { service: "worker", http: null },
        ],
      },
    })
    expect(events.filter((e) => e.event === "health")).toEqual([
      { event: "health", service: "api" },
      { event: "health", service: "web" },
    ])
    expect(result).toEqual({
      outcome: "unhealthy",
      app: "app",
      sequence: 1,
      health: { service: "web", http: true },
    })
  }, 30_000)

  test("a health check with no route gets a route network and names, and no proxy", async () => {
    const w = await world()
    const [web] = w.docker.app("web", { web: 1 }).web!
    const { result } = await deployRoutes(w, 0, { health: PATH_CHECK })
    expect(result.outcome).toBe("started")
    expect(steps(w, { web: web! }).slice(0, 7)).toEqual([
      `compose -p zekno-web -f <home>/apps/web/compose.yaml up -d --remove-orphans`,
      "compose -p zekno-web ps -q web",
      "inspect --type container <web>",
      "network inspect zekno-route-web",
      "network create --label app.zekno.server=<server> --label app.zekno.app=web zekno-route-web",
      "network connect --alias <name> zekno-route-web <web>",
      "inspect --type container <web>",
    ])
    expect(
      w.docker.argv().some((argv) => argv[0] === "run" && argv[1] === "-d")
    ).toBe(false)
    expect(configText(w.home)).toBeUndefined()
    const state = stateOf(w.home)
    expect(state.routes.web!.routes).toEqual([])
    expect(state.routes.web!.names.web![0]!.container).toBe(web!)

    // Dropping the check removes the network, and with it the names.
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 1)).result.outcome).toBe("started")
    expect(steps(w, { web: web! }).slice(before)).toEqual([
      `compose -p zekno-web -f <home>/apps/web/compose.yaml up -d --remove-orphans`,
      "inspect --type container zekno-proxy",
      "inspect --type container zekno-proxy",
      "network inspect zekno-route-web",
      "network disconnect zekno-route-web <web>",
      "network rm zekno-route-web",
      "inspect --type container zekno-proxy",
    ])
    expect(stateOf(w.home).routes).toEqual({})
  })
})

describe("security review S3: the wait keeps to its limit", () => {
  const slow: Health = {
    timeout: 1,
    services: [{ service: "web", http: { port: 3000, path: "/" } }],
  }

  test("three checks of 5 seconds each and a limit of 1 second: the wait ends near the limit, not once every check has run", async () => {
    const w = await world()
    w.docker.app("web", { web: 3 })
    w.docker.script({ checkMs: 5000 })
    const started = Date.now()
    const { result } = await deployRoutes(w, 0, { health: slow })
    expect(result).toEqual({
      outcome: "unhealthy",
      app: "web",
      sequence: 1,
      health: { service: "web", http: true },
    })
    expect(Date.now() - started).toBeLessThan(6000)
  }, 40_000)

  test("the limit counts from when the wait begins: route steps that take longer than the limit, as a first fetch of the proxy's image does, leave it whole", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({ validateMs: 3000 })
    const { result } = await deployRoutes(w, 0, {
      routes: [route("app.example.com")],
      health: {
        timeout: 2,
        services: [{ service: "web", http: { port: 3000, path: "/" } }],
      },
    })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 1 })
    expect(checks(w).length).toBe(1)
  }, 40_000)

  test("the pinned image is looked for once, before the first event, and pulled only when it is missing", async () => {
    const w = await world()
    w.docker.app("web", { web: 2 })
    w.docker.script({ imageMissing: true })
    const { result, events } = await deployRoutes(w, 0, { health: PATH_CHECK })
    expect(result.outcome).toBe("started")
    expect(events.filter((e) => e.event === "health")).toEqual([
      { event: "health", service: "web" },
    ])
    const all = steps(w)
    expect(
      all.filter((step) => step.startsWith("image") || step.startsWith("pull"))
    ).toEqual([
      "image inspect --format {{.Id}} caddy@sha256:<digest>",
      "pull caddy@sha256:<digest>",
    ])
    expect(all.indexOf("pull caddy@sha256:<digest>")).toBeLessThan(
      all.findIndex((step) => step.includes(" curl "))
    )
    expect(checks(w)).toHaveLength(2)

    // Here now: looked for again by the next deploy, and not pulled.
    const before = w.docker.calls().length
    expect(
      (await deployRoutes(w, 1, { health: PATH_CHECK })).result.outcome
    ).toBe("started")
    expect(
      steps(w)
        .slice(before)
        .filter((step) => step.startsWith("image") || step.startsWith("pull"))
    ).toEqual(["image inspect --format {{.Id}} caddy@sha256:<digest>"])
  })

  test("a check without a path needs no image: none is looked for", async () => {
    const w = await world()
    w.docker.app("web", { web: [{ health: "healthy" }] })
    expect(
      (
        await deployRoutes(w, 0, {
          health: { timeout: 5, services: [{ service: "web", http: null }] },
        })
      ).result.outcome
    ).toBe("started")
    expect(
      steps(w).some(
        (step) => step.startsWith("image") || step.startsWith("pull")
      )
    ).toBe(false)
  })

  test("a pull that fails: unhealthy for the first service with a path, with its event, at once; no check is run", async () => {
    const w = await world()
    w.docker.app("app", { api: [{ health: "healthy" }], web: 1 })
    w.docker.script({ imageMissing: true, pullFails: true })
    const started = Date.now()
    const { result, events } = await deployRoutes(w, 0, {
      app: "app",
      health: {
        timeout: 30,
        services: [
          { service: "api", http: null },
          { service: "web", http: { port: 3000, path: "/" } },
        ],
      },
    })
    expect(result).toEqual({
      outcome: "unhealthy",
      app: "app",
      sequence: 1,
      health: { service: "web", http: true },
    })
    expect(events.filter((e) => e.event === "health")).toEqual([
      { event: "health", service: "api" },
      { event: "health", service: "web" },
    ])
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(checks(w)).toEqual([])
  })
})
