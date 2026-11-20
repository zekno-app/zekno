/**
 * The session in protocol 4 (specs/015-domains-https, contracts/core.md, "The
 * protocol"): the event `health`, `status` with routes, the command `proxy`,
 * and the bound of each new frame.
 */
import { describe, expect, test } from "bun:test"

import * as core from "../../src/index"
import type {
  AppRoutes,
  DomainFault,
  HealthEvent,
  RunnerProxy,
  RunnerStatusRequest,
  RunnerStatusWithRoutes,
} from "../../src/index"
import { setup } from "../support/helpers"
import { check, route } from "../support/routes"

const {
  LIMITS,
  parseMessage,
  PROXY_STATES,
  RunnerProxySchema,
  RunnerStatusRequestSchema,
  RunnerStatusSchema,
  RunnerStatusWithRoutesSchema,
  SESSION_COMMANDS,
  SESSION_FRAME_BYTES,
  SessionEventSchema,
  SessionFrameSchema,
  SessionRequestSchema,
} = core

const reads = (schema: Parameters<typeof parseMessage>[0], value: unknown) =>
  parseMessage(schema, value).ok

/** Bytes of a value written out as one JSON line. */
const written = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length

/** Today's answer to `status`, for this server. */
async function status() {
  const { server, trust } = await setup()
  return {
    serverId: server.serverId,
    serverPublicKey: server.publicKey,
    team: { teamId: trust.teamId, version: trust.version, hash: trust.hash },
    lastSequence: { shop: 4, blog: 1 },
    secrets: { "shop/DATABASE_URL": { version: 1, removed: false } },
  }
}

describe("the number and the commands", () => {
  test("protocol 4 or later (5 since the start limit, start-limit.test.ts), and proxy is a command of a session", () => {
    expect(core.RUNNER_PROTOCOL).toBeGreaterThanOrEqual(4)
    expect(SESSION_COMMANDS.at(-1)).toBe("proxy")
    expect(reads(SessionRequestSchema, { command: "proxy" })).toBe(true)
    expect(
      reads(SessionRequestSchema, {
        command: "status",
        input: { routes: true },
      })
    ).toBe(true)
  })
})

describe("the event health", () => {
  test("names the service waited for, and nothing else", () => {
    const event = { event: "health", service: "web" }
    expect(reads(SessionEventSchema, event)).toBe(true)
    expect(reads(SessionFrameSchema, event)).toBe(true)
    expect(reads(core.HealthEventSchema, event)).toBe(true)
    for (const wrong of [
      { event: "health" },
      { event: "health", service: "we b" },
      { event: "health", service: "web", line: "GET /health 500" },
      { event: "health", service: "web", result: {} },
      { event: "healthy", service: "web" },
    ])
      expect([wrong, reads(SessionFrameSchema, wrong)]).toEqual([wrong, false])
  })
})

describe("status with routes", () => {
  test("the request's input is exactly { routes: true }", () => {
    expect(reads(RunnerStatusRequestSchema, { routes: true })).toBe(true)
    for (const input of [
      { routes: false },
      { routes: "true" },
      {},
      { routes: true, domains: true },
      null,
      [],
    ])
      expect([input, reads(RunnerStatusRequestSchema, input)]).toEqual([
        input,
        false,
      ])
  })

  test("the answer is today's fields with routes, the health checks in force and the proxy's state", async () => {
    const today = await status()
    const answer = {
      ...today,
      routes: {
        shop: [route("shop.example.com"), route("www.shop.example.com")],
      },
      health: { shop: check("web", "/health"), worker: check("worker") },
      proxy: "running",
    }
    expect(reads(RunnerStatusWithRoutesSchema, answer)).toBe(true)
    expect(
      reads(RunnerStatusWithRoutesSchema, {
        ...answer,
        routes: {},
        health: {},
        proxy: "none",
      })
    ).toBe(true)
    for (const proxy of PROXY_STATES)
      expect(reads(RunnerStatusWithRoutesSchema, { ...answer, proxy })).toBe(
        true
      )
    expect(PROXY_STATES).toEqual([
      "none",
      "running",
      "stopped",
      "missing",
      "other_image",
    ])
    // Without the input, today's answer, which an older zekno reads strictly.
    expect(reads(RunnerStatusSchema, today)).toBe(true)
    expect(reads(RunnerStatusSchema, answer)).toBe(false)
    const { proxy: _proxy, ...noProxy } = answer
    const { routes: _routes, ...noRoutes } = answer
    const { health: _health, ...noHealth } = answer
    for (const wrong of [
      noProxy,
      noRoutes,
      noHealth,
      { ...answer, proxy: "starting" },
      { ...answer, routes: { shop: [] } },
      { ...answer, routes: { Shop: [route("shop.example.com")] } },
      { ...answer, routes: { shop: [route("xn--bcher-kva.example")] } },
      { ...answer, routes: { shop: [{ ...route("a.example.com"), tls: 1 }] } },
      { ...answer, routes: { shop: ["shop.example.com"] } },
      { ...answer, serverId: `srv_${"0".repeat(32)}` },
      { ...answer, extra: 1 },
    ])
      expect(reads(RunnerStatusWithRoutesSchema, wrong)).toBe(false)
  })

  test("within the limits: 64 routes an app, 1,024 domains in all", async () => {
    const today = await status()
    const domains = (app: number, count: number) =>
      Array.from({ length: count }, (_, n) =>
        route(`d${String(n).padStart(2, "0")}.a${app}.example.com`)
      )
    const answer = (routes: Record<string, unknown>) => ({
      ...today,
      routes,
      health: {},
      proxy: "running",
    })
    expect(
      reads(
        RunnerStatusWithRoutesSchema,
        answer({ shop: domains(0, LIMITS.routesPerDeploy) })
      )
    ).toBe(true)
    expect(
      reads(
        RunnerStatusWithRoutesSchema,
        answer({ shop: domains(0, LIMITS.routesPerDeploy + 1) })
      )
    ).toBe(false)
    const apps = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, n) => [`app-${n}`, domains(n, 1)])
      )
    expect(
      reads(RunnerStatusWithRoutesSchema, answer(apps(LIMITS.domainsPerServer)))
    ).toBe(true)
    expect(
      reads(
        RunnerStatusWithRoutesSchema,
        answer(apps(LIMITS.domainsPerServer + 1))
      )
    ).toBe(false)
  })
})

/**
 * The largest health check a signed deploy can carry, its services named
 * from `first`: 16 services, each named in 63 characters and checked on a
 * path of 1,024.
 */
const largestCheck = (first = "s") => ({
  timeout: LIMITS.healthSeconds,
  services: Array.from({ length: LIMITS.healthServices }, (_, n) => ({
    service: `${first}${String(n).padStart(2, "0")}`.padEnd(63, "x"),
    http: { port: 65535, path: `/${"p".repeat(LIMITS.healthPathLength - 1)}` },
  })),
})

/** As many apps with the largest health check as fit `LIMITS.healthBytesPerServer`, named by `app`. */
function mostHealth(
  app: (n: number) => string
): Record<string, ReturnType<typeof largestCheck>> {
  const health: Record<string, ReturnType<typeof largestCheck>> = {}
  for (let n = 0; ; n++) {
    const more = { ...health, [app(n)]: largestCheck() }
    if (core.healthBytes(more) > LIMITS.healthBytesPerServer) return health
    health[app(n)] = largestCheck()
  }
}

describe("the health checks in force, in status with routes", () => {
  test("each by the rules of a signed deploy's: strict, within its limits, its services sorted and each once", async () => {
    const today = await status()
    const answer = (health: unknown) => ({
      ...today,
      routes: {},
      health,
      proxy: "none",
    })
    const web = { service: "web", http: null }
    expect(
      reads(RunnerStatusWithRoutesSchema, answer({ shop: largestCheck() }))
    ).toBe(true)
    for (const health of [
      { Shop: check() },
      { shop: null },
      { shop: { timeout: 0, services: [web] } },
      { shop: { timeout: LIMITS.healthSeconds + 1, services: [web] } },
      { shop: { timeout: 60, services: [] } },
      {
        shop: {
          ...largestCheck(),
          services: [...largestCheck().services, { ...web, service: "z" }],
        },
      },
      { shop: { timeout: 60, services: [{ service: "web" }] } },
      {
        shop: {
          timeout: 60,
          services: [{ ...web, http: { port: 3000, path: "health" } }],
        },
      },
      { shop: { ...check(), extra: 1 } },
      { shop: { timeout: 60, services: [{ ...web, service: "worker" }, web] } },
      { shop: { timeout: 60, services: [web, web] } },
      [check()],
      null,
    ])
      expect([
        health,
        reads(RunnerStatusWithRoutesSchema, answer(health)),
      ]).toEqual([health, false])
  })

  test(`at most ${LIMITS.healthBytesPerServer} bytes as written, and at most ${LIMITS.appsPerServer} apps`, async () => {
    const today = await status()
    const answer = (health: Record<string, unknown>) => ({
      ...today,
      routes: {},
      health,
      proxy: "none",
    })
    const most = mostHealth((n) => `a-${n}`)
    expect(Object.keys(most).length).toBeGreaterThan(10)
    expect(reads(RunnerStatusWithRoutesSchema, answer(most))).toBe(true)
    expect(
      reads(
        RunnerStatusWithRoutesSchema,
        answer({ ...most, more: largestCheck() })
      )
    ).toBe(false)
    const small = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, n) => [`a-${n}`, check()])
      )
    expect(
      reads(RunnerStatusWithRoutesSchema, answer(small(LIMITS.appsPerServer)))
    ).toBe(true)
    expect(
      reads(
        RunnerStatusWithRoutesSchema,
        answer(small(LIMITS.appsPerServer + 1))
      )
    ).toBe(false)
  })
})

describe("proxy", () => {
  test("answers the proxy's state, or a report that the routes could not be put in force", () => {
    for (const answer of [
      { proxy: "none" },
      { proxy: "running" },
      { outcome: "routes_failed", routes: { failure: "port_taken", port: 80 } },
      { outcome: "routes_failed", routes: { failure: "not_loaded" } },
    ])
      expect([answer, reads(RunnerProxySchema, answer)]).toEqual([answer, true])
    for (const answer of [
      { proxy: "stopped" },
      { proxy: "missing" },
      { proxy: "running", routes: {} },
      {},
      {
        outcome: "routes_failed",
        routes: { failure: "no_container", service: "web" },
      },
      {
        outcome: "routes_failed",
        routes: { failure: "host_network", service: "web" },
      },
      { outcome: "routes_failed" },
      { outcome: "started" },
      { outcome: "ok" },
    ])
      expect([answer, reads(RunnerProxySchema, answer)]).toEqual([
        answer,
        false,
      ])
  })
})

describe("the bound of each frame", () => {
  test("the longest answer each new frame can bring fits its bound, with room to spare", async () => {
    const today = await status()
    const app = (n: number) => `a${String(n).padStart(4, "0")}`.padEnd(63, "x")
    const domain = (n: number) =>
      [
        `d${String(n).padStart(4, "0")}`.padEnd(63, "x"),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(61),
      ].join(".")
    expect(domain(0)).toHaveLength(LIMITS.domainLength)
    const secrets = Object.fromEntries(
      Array.from({ length: LIMITS.secretsPerServer }, (_, n) => [
        `${app(n % LIMITS.appsPerServer)}/${`S${n}`.padEnd(128, "_")}`,
        { version: Number.MAX_SAFE_INTEGER, removed: false },
      ])
    )
    const lastSequence = Object.fromEntries(
      Array.from({ length: LIMITS.appsPerServer }, (_, n) => [
        app(n),
        Number.MAX_SAFE_INTEGER,
      ])
    )
    const routes = Object.fromEntries(
      Array.from({ length: LIMITS.domainsPerServer }, (_, n) => [
        app(n),
        [{ domain: domain(n), service: "s".repeat(63), port: 65535 }],
      ])
    )
    // The health checks in force: as many of the largest as the server may hold, under the longest app names.
    const health = mostHealth(app)
    const largest = {
      ...today,
      team: { ...today.team, version: Number.MAX_SAFE_INTEGER },
      lastSequence,
      secrets,
      routes,
      health,
      proxy: "other_image",
    }
    expect(core.healthBytes(health)).toBeGreaterThan(
      LIMITS.healthBytesPerServer - written(largestCheck()) - 70
    )
    expect(reads(RunnerStatusWithRoutesSchema, largest)).toBe(true)
    expect(written({ result: largest }) * 1.5).toBeLessThan(
      SESSION_FRAME_BYTES.status
    )
    const proxy = Math.max(
      written({ result: { proxy: "running" } }),
      written({
        result: {
          outcome: "routes_failed",
          app: "a".repeat(63),
          sequence: Number.MAX_SAFE_INTEGER,
          routes: { failure: "port_taken", port: 443 },
        },
      }),
      written({
        result: {
          outcome: "refused",
          reason: "invalid_request",
          app: "a".repeat(63),
          sequence: Number.MAX_SAFE_INTEGER,
        },
      })
    )
    expect(SESSION_FRAME_BYTES.proxy).toBe(4 * 1024)
    expect(proxy * 1.5).toBeLessThan(SESSION_FRAME_BYTES.proxy)
    const deploy = Math.max(
      written({ event: "health", service: "s".repeat(63) }),
      written({
        result: {
          outcome: "routes_failed",
          app: "a".repeat(63),
          sequence: Number.MAX_SAFE_INTEGER,
          routes: { failure: "no_container", service: "s".repeat(63) },
        },
      }),
      written({
        result: {
          outcome: "unhealthy",
          app: "a".repeat(63),
          sequence: Number.MAX_SAFE_INTEGER,
          health: { service: "s".repeat(63), http: false },
        },
      })
    )
    expect(deploy * 1.5).toBeLessThan(SESSION_FRAME_BYTES.deploy)
    for (const limit of Object.values(SESSION_FRAME_BYTES))
      expect(limit).toBeLessThanOrEqual(LIMITS.messageBytes / 8)
  })
})

describe("the public names of feature 015", () => {
  test("every value is exported from the library's one entry point", () => {
    for (const name of [
      "isRoutableDomain",
      "domainFault",
      "isHealthPath",
      "RouteSchema",
      "HealthSchema",
      "domainHolders",
      "domainsAfter",
      "healthInForce",
      "healthBytesAfter",
      "healthBytes",
      "HealthInForceSchema",
      "withAppRoutes",
      "CONTAINERS_PER_SERVICE",
      "ROUTE_FAILURES",
      "HealthEventSchema",
      "RunnerStatusRequestSchema",
      "RunnerStatusWithRoutesSchema",
      "PROXY_STATES",
      "RunnerProxySchema",
    ])
      expect([
        name,
        typeof (core as Record<string, unknown>)[name],
      ]).not.toEqual([name, "undefined"])
  })

  test("every type is exported too", () => {
    // Checked by the type checker: each name must resolve.
    type Exported = [
      AppRoutes,
      DomainFault,
      HealthEvent,
      RunnerProxy,
      RunnerStatusRequest,
      RunnerStatusWithRoutes,
    ]
    const count: Exported["length"] = 6
    expect(count).toBe(6)
  })
})
