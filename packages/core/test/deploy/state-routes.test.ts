/**
 * The routes and health checks in force in the state, marked 5 since
 * specs/016-build-from-source (contracts/core.md CO13), with the rules of
 * specs/015-domains-https, contracts/core.md, "The state": each strict
 * rule, with a state that breaks only it. A state that breaks one is refused,
 * never read as having no routes.
 */
import { describe, expect, test } from "bun:test"

import type { Health } from "../../src/deploy/routes-and-checks"
import {
  initialRunnerState,
  readRunnerState,
  takesVersionOne,
  type AppRoutes,
  type StoredRunnerState,
} from "../../src/deploy/state"
import { CONTAINERS_PER_SERVICE, healthBytes, LIMITS } from "../../src/index"
import { CoreError } from "../../src/protocol/result"
import { setup } from "../support/helpers"
import {
  appRoutes,
  check,
  containerOf,
  holding,
  named,
  nameOf,
  route,
} from "../support/routes"

/**
 * A good state: `a` at format 1 with no routes; `b` with two domains, a
 * health check of `web` with a path, and two containers of `web`; `c` with a
 * health check and no domain.
 */
async function routedState(): Promise<StoredRunnerState> {
  const { server } = await setup()
  const base: StoredRunnerState = {
    v: 5,
    ...initialRunnerState({
      serverId: server.serverId,
      team: server.state.team,
    }),
    lastSequence: { a: 3, b: 2, c: 1 },
    formats: { a: 1, b: 2, c: 2 },
    routes: {},
    released: [],
    builds: {},
    building: null,
  }
  return holding(base, {
    b: {
      routes: [route("b.example.com"), route("www.b.example.com")],
      health: check("web", "/health"),
      names: { web: [named(1), named(2)] },
    },
    c: { routes: [], health: check("api"), names: { api: [named(3)] } },
  })
}

/**
 * The largest health check a signed deploy can carry: 16 services, each
 * named in 63 characters and checked on a path of 1,024.
 */
const largestCheck = (): Health => ({
  timeout: LIMITS.healthSeconds,
  services: Array.from({ length: LIMITS.healthServices }, (_, n) => ({
    service: `s${String(n).padStart(2, "0")}`.padEnd(63, "x"),
    http: { port: 65535, path: `/${"p".repeat(LIMITS.healthPathLength - 1)}` },
  })),
})

/** The state with `b`'s entry changed by `change`. */
const withB = (
  state: StoredRunnerState,
  change: Record<string, unknown>
): unknown => ({
  ...state,
  routes: { ...state.routes, b: { ...state.routes.b, ...change } },
})

const refused = (value: unknown) =>
  expect(() => readRunnerState(value)).toThrow(CoreError)

describe("a state with routes", () => {
  test("reads back equal, through JSON too", async () => {
    const state = await routedState()
    expect(readRunnerState(state)).toEqual(state)
    expect(readRunnerState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  test("an app may hold a health check and no domain; an app with neither is not in routes", async () => {
    const state = await routedState()
    expect(readRunnerState(state).routes.c!.routes).toEqual([])
    expect(readRunnerState(state).routes.c!.health).toEqual(check("api"))
    for (const c of [
      // Names alone no longer stand for a health check: the check itself is kept.
      { routes: [], health: null, names: { api: [named(3)] } },
      { routes: [], health: null, names: {} },
      // A health check with no route has the names of its containers.
      { routes: [], health: check("api"), names: {} },
      { routes: [], health: check("api"), names: { api: [] } },
    ])
      refused({ ...state, routes: { ...state.routes, c } })
  })
})

describe("the health check in force", () => {
  test("null, or a check by the rules of a signed deploy's: strict, within its limits, its services sorted and each once", async () => {
    const state = await routedState()
    expect(
      readRunnerState(withB(state, { health: null })).routes.b!.health
    ).toBeNull()
    expect(
      readRunnerState(withB(state, { health: largestCheck() })).routes.b!.health
    ).toEqual(largestCheck())
    const web = { service: "web", http: null }
    for (const health of [
      { timeout: 0, services: [web] },
      { timeout: LIMITS.healthSeconds + 1, services: [web] },
      { timeout: 60, services: [] },
      { ...largestCheck(), services: [...largestCheck().services, web] },
      { timeout: 60, services: [{ ...web, service: "we b" }] },
      { timeout: 60, services: [{ service: "web" }] },
      { timeout: 60, services: [{ ...web, http: { port: 3000 } }] },
      { timeout: 60, services: [{ ...web, http: { port: 0, path: "/" } }] },
      { timeout: 60, services: [{ ...web, http: { port: 3000, path: "x" } }] },
      {
        timeout: 60,
        services: [{ ...web, http: { port: 3000, path: "/a b" } }],
      },
      { timeout: 60, services: [web], extra: 1 },
      { timeout: 60, services: [{ ...web, extra: 1 }] },
      // Sorted by service, each once, as a signed deploy's are once read.
      { timeout: 60, services: [{ ...web, service: "worker" }, web] },
      { timeout: 60, services: [web, web] },
      "GET /health",
    ])
      refused(withB(state, { health }))
  })

  test("every entry has the field: an entry without it, as a runner of this feature wrote before the check was kept, is refused", async () => {
    const state = await routedState()
    const { health: _health, ...withoutHealth } = state.routes.b!
    refused({ ...state, routes: { ...state.routes, b: withoutHealth } })
    // A state marked 5 with no entry at all reads as it did.
    const bare = { ...state, routes: {} }
    expect(readRunnerState(JSON.parse(JSON.stringify(bare)))).toEqual(bare)
  })

  test("a state marked 2 is read forward with no routes, and so with no health check in force", async () => {
    const state = await routedState()
    const {
      routes: _routes,
      released: _released,
      builds: _builds,
      building: _building,
      ...rest
    } = state
    const read = readRunnerState({ ...rest, v: 2 })
    expect(read.routes).toEqual({})
    expect(read).toEqual({
      ...rest,
      v: 5,
      routes: {},
      released: [],
      builds: {},
      building: null,
    })
  })

  test("a state marked 3 is read forward with its routes and health checks in force, and an empty list", async () => {
    const state = await routedState()
    const {
      released: _released,
      builds: _builds,
      building: _building,
      ...rest
    } = state
    const read = readRunnerState(JSON.parse(JSON.stringify({ ...rest, v: 3 })))
    expect(read).toEqual(state)
    // An entry without its health check is refused in mark 3 too.
    const { health: _health, ...withoutHealth } = state.routes.b!
    refused({ ...rest, v: 3, routes: { ...state.routes, b: withoutHealth } })
  })

  test(`at most ${LIMITS.healthBytesPerServer} bytes across the server, as the answer to status with routes writes them`, async () => {
    expect(LIMITS.healthBytesPerServer).toBe(256 * 1024)
    const state = { ...(await routedState()), routes: {} }
    /** Apps `h-0`, `h-1`, … each with the largest check and no route, `count` of them. */
    const checked = (count: number): Record<string, AppRoutes> =>
      Object.fromEntries(
        Array.from({ length: count }, (_, n) => [
          `h-${n}`,
          {
            routes: [],
            health: largestCheck(),
            names: { [largestCheck().services[0]!.service]: [named(100 + n)] },
          },
        ])
      )
    const bytes = (count: number) =>
      healthBytes(
        Object.fromEntries(
          Object.entries(checked(count)).map(([app, entry]) => [
            app,
            entry.health!,
          ])
        )
      )
    let fits = 0
    while (bytes(fits + 1) <= LIMITS.healthBytesPerServer) fits++
    expect(fits).toBeGreaterThan(10)
    expect(readRunnerState(holding(state, checked(fits))).routes).toEqual(
      checked(fits)
    )
    refused(holding(state, checked(fits + 1)))
  })
})

describe("FR-036: only an app at format 2 holds routes", () => {
  test("an app in routes at format 1 is refused, and so is one with no format", async () => {
    const state = await routedState()
    refused({ ...state, formats: { ...state.formats, b: 1 } })
    refused({
      ...state,
      routes: { ...state.routes, d: appRoutes(["d.example.com"], 9) },
    })
  })

  test("so no app in routes may take a version-1 deploy", async () => {
    const state = readRunnerState(await routedState())
    for (const app of Object.keys(state.routes))
      expect([app, takesVersionOne(state, app)]).toEqual([app, false])
    expect(takesVersionOne(state, "a")).toBe(true)
  })
})

describe("domains", () => {
  test("within an app, sorted by domain and each once", async () => {
    const state = await routedState()
    refused(
      withB(state, {
        routes: [route("www.b.example.com"), route("b.example.com")],
      })
    )
    refused(
      withB(state, {
        routes: [route("b.example.com"), route("b.example.com", { port: 4 })],
      })
    )
  })

  test("across apps, no domain held twice", async () => {
    const state = await routedState()
    refused({
      ...state,
      routes: {
        ...state.routes,
        c: { ...state.routes.c, routes: [route("b.example.com")] },
      },
    })
  })

  test("each route by the route's own rules, the domain rule among them", async () => {
    const state = await routedState()
    for (const routes of [
      [route("xn--bcher-kva.example.com")],
      [route("B.example.com")],
      [route("b.example.com", { port: 0 })],
      [route("b.example.com", { service: "we b" })],
      [{ ...route("b.example.com"), tls: false }],
    ])
      refused(withB(state, { routes }))
  })

  test(`at most ${LIMITS.routesPerDeploy} an app`, async () => {
    const state = await routedState()
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) =>
        route(`d${String(n).padStart(2, "0")}.example.com`)
      )
    expect(
      readRunnerState(withB(state, { routes: many(LIMITS.routesPerDeploy) }))
        .routes.b!.routes
    ).toHaveLength(LIMITS.routesPerDeploy)
    refused(withB(state, { routes: many(LIMITS.routesPerDeploy + 1) }))
  })

  test(`at most ${LIMITS.domainsPerServer} across the server`, async () => {
    expect(LIMITS.domainsPerServer).toBe(1024)
    const state = await routedState()
    const apps = (count: number) => {
      const held: Record<string, ReturnType<typeof appRoutes>> = {}
      let domains = 0
      for (let app = 0; domains < count; app++) {
        const take = Math.min(LIMITS.routesPerDeploy, count - domains)
        held[`app-${app}`] = appRoutes(
          Array.from(
            { length: take },
            (_, n) => `d${String(n).padStart(2, "0")}.app-${app}.example.com`
          ),
          100 + app
        )
        domains += take
      }
      return held
    }
    const bare = { ...state, routes: {} }
    const full = holding(bare, apps(LIMITS.domainsPerServer))
    expect(Object.keys(readRunnerState(full).routes)).toHaveLength(16)
    refused(holding(bare, apps(LIMITS.domainsPerServer + 1)))
  })
})

describe("names and containers", () => {
  test("every name is z and 32 hex characters, every container 64 hex characters", async () => {
    const state = await routedState()
    for (const entry of [
      { container: containerOf(1), name: "z".padEnd(32, "0") },
      { container: containerOf(1), name: `z${"A".repeat(32)}` },
      { container: containerOf(1), name: `y${"0".repeat(32)}` },
      { container: containerOf(1), name: `${nameOf(1)}0` },
      { container: "a".repeat(63), name: nameOf(1) },
      { container: "A".repeat(64), name: nameOf(1) },
      { container: `${containerOf(1)}0`, name: nameOf(1) },
      { container: containerOf(1), name: nameOf(1), alias: "web" },
      { container: containerOf(1) },
    ])
      refused(withB(state, { names: { web: [entry] } }))
  })

  test("each name once in the whole state", async () => {
    const state = await routedState()
    // Twice in one service, in two services of one app, and in two apps.
    refused(
      withB(state, {
        names: {
          web: [named(1), { container: containerOf(2), name: nameOf(1) }],
        },
      })
    )
    refused(
      withB(state, {
        names: {
          api: [{ container: containerOf(5), name: nameOf(1) }],
          web: [named(1), named(2)],
        },
      })
    )
    refused(withB(state, { names: { web: [named(1), named(3)] } }))
  })

  test("within a service, sorted by container and each container once", async () => {
    const state = await routedState()
    refused(withB(state, { names: { web: [named(2), named(1)] } }))
    refused(
      withB(state, {
        names: {
          web: [named(1), { container: containerOf(1), name: nameOf(2) }],
        },
      })
    )
  })

  test(`at most ${CONTAINERS_PER_SERVICE} containers a service`, async () => {
    expect(CONTAINERS_PER_SERVICE).toBe(16)
    const state = await routedState()
    const containers = (count: number) =>
      Array.from({ length: count }, (_, n) => named(100 + n))
    expect(
      readRunnerState(
        withB(state, { names: { web: containers(CONTAINERS_PER_SERVICE) } })
      ).routes.b!.names.web
    ).toHaveLength(CONTAINERS_PER_SERVICE)
    refused(
      withB(state, { names: { web: containers(CONTAINERS_PER_SERVICE + 1) } })
    )
  })

  test("service and app names by their patterns, and no other field", async () => {
    const state = await routedState()
    refused(withB(state, { names: { "we b": [named(1)] } }))
    refused(withB(state, { extra: 1 }))
    refused({ ...state, routes: { ...state.routes, B: state.routes.b } })
    refused({ ...state, routes: { ...state.routes, b: null } })
  })
})
