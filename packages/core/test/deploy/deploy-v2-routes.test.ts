/**
 * Routes and the health check in a version-2 deploy (specs/015-domains-https,
 * contracts/core.md): `createDeployV2` takes them as inputs of their own, and
 * `verifyDeployV2` refuses a domain another app holds (K10b) and carries the
 * routes in force over unchanged.
 */
import { describe, expect, test } from "bun:test"

import { createDeployV2 } from "../../src/deploy/deploy-v2"
import { readRunnerState } from "../../src/deploy/state"
import { DEPLOY_V2_REFUSALS, LIMITS } from "../../src/index"
import { CoreError } from "../../src/protocol/result"
import { COMPOSE } from "../support/helpers"
import {
  deepFreeze,
  deployV2,
  NOW,
  payloadOf,
  reason,
  verify,
  world,
  type World,
} from "../support/deploy-v2"
import { appRoutes, holding, route } from "../support/routes"

const DAY = 24 * 60 * 60 * 1000

/** A good `createDeployV2` call in this world, changed by `change`. */
const signing = (w: World, change: Record<string, unknown> = {}) => ({
  trust: w.trust,
  serverId: w.server.serverId,
  app: "web",
  previous: 0,
  compose: COMPOSE,
  statements: [],
  removals: [],
  expiresAt: null,
  signer: w.founder.signer,
  now: NOW,
  ...change,
})

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => "signed",
    (error: { code?: string }) => error.code
  )

const check = (service: string, path: string | null = null) => ({
  service,
  http: path === null ? null : { port: 3000, path },
})

describe("createDeployV2 with routes and a health check", () => {
  test("sorts routes by domain and the health check's services by service", async () => {
    const w = await world()
    const envelope = await createDeployV2(
      signing(w, {
        routes: [route("www.example.com"), route("api.example.com")],
        health: {
          timeout: 90,
          services: [check("worker"), check("api", "/up"), check("web")],
        },
      })
    )
    const payload = payloadOf(envelope)
    expect(payload.routes).toEqual([
      route("api.example.com"),
      route("www.example.com"),
    ])
    expect(payload.health).toEqual({
      timeout: 90,
      services: [check("api", "/up"), check("web"), check("worker")],
    })
  })

  test("without them, no route and no health check", async () => {
    const w = await world()
    const payload = payloadOf(await createDeployV2(signing(w)))
    expect(payload.routes).toEqual([])
    expect(payload.health).toBeNull()
    const none = payloadOf(
      await createDeployV2(signing(w, { routes: [], health: null }))
    )
    expect(none).toEqual(payload)
  })

  test("refuses a domain or a service given twice, and lists that are not lists", async () => {
    const w = await world()
    for (const change of [
      { routes: [route("a.example.com"), route("a.example.com", { port: 1 })] },
      {
        routes: [
          route("b.example.com"),
          route("a.example.com"),
          route("b.example.com", { service: "api" }),
        ],
      },
      { health: { timeout: 60, services: [check("web"), check("web", "/")] } },
      { routes: "a.example.com" },
      { routes: [null] },
      { routes: [{ ...route("a.example.com"), domain: 42 }] },
      { health: { timeout: 60, services: "web" } },
      { health: "web" },
      { health: { timeout: 60, services: [check("web")], extra: 1 } },
      {
        routes: Array.from({ length: LIMITS.routesPerDeploy + 1 }, (_, n) =>
          route(`d${String(n).padStart(2, "0")}.example.com`)
        ),
      },
    ])
      expect([
        change,
        await refusal(createDeployV2(signing(w, change) as never)),
      ]).toEqual([change, "invalid_argument"])
    // The error is the library's own.
    await expect(
      createDeployV2(
        signing(w, { routes: [route("a.example.com"), route("a.example.com")] })
      )
    ).rejects.toThrow(CoreError)
  })
})

describe("K10b: a domain another app holds", () => {
  /** This world's state with `shop` holding two domains and `web` one. */
  const shared = (w: World) =>
    deepFreeze(
      holding(
        { ...w.state, lastSequence: { web: 1 }, formats: { web: 2 } },
        {
          shop: appRoutes(["shop.example.com", "www.shop.example.com"], 1),
          web: appRoutes(["web.example.com"], 2),
        }
      )
    )

  test("is domain_taken, and the state given is left as it was", async () => {
    expect(DEPLOY_V2_REFUSALS).toContain("domain_taken")
    const w = await world()
    const state = shared(w)
    const before = JSON.stringify(state)
    const { envelope } = await deployV2(w, {
      previous: 1,
      routes: [route("web.example.com"), route("www.shop.example.com")],
    })
    expect(reason(verify(w, envelope, { state }))).toBe("domain_taken")
    expect(JSON.stringify(state)).toBe(before)
  })

  test("uses no number: once the other app lets the domain go, the same deploy is accepted", async () => {
    const w = await world()
    const state = shared(w)
    const { envelope } = await deployV2(w, {
      previous: 1,
      routes: [route("shop.example.com")],
    })
    expect(reason(verify(w, envelope, { state }))).toBe("domain_taken")
    const released = { ...state, routes: { web: state.routes.web! } }
    const result = verify(w, envelope, { state: released })
    if (!result.ok) throw new Error(result.error.code)
    expect(result.value.nextState.lastSequence.web).toBe(2)
  })

  test("the app's own domains, and domains nobody holds, pass", async () => {
    const w = await world()
    const state = shared(w)
    for (const routes of [
      [route("web.example.com")],
      [route("new.example.com"), route("web.example.com")],
      [route("other.example.com")],
      [],
    ]) {
      const { envelope } = await deployV2(w, { previous: 1, routes })
      expect([routes, reason(verify(w, envelope, { state }))]).toEqual([
        routes,
        "accepted",
      ])
    }
    // A first deploy of a new app, with a domain nobody holds.
    const { envelope } = await deployV2(w, {
      app: "blog",
      routes: [route("blog.example.com")],
    })
    expect(reason(verify(w, envelope, { state }))).toBe("accepted")
  })

  test("the next state carries the routes in force over unchanged, whatever the deploy asks", async () => {
    const w = await world()
    const state = shared(w)
    const { envelope } = await deployV2(w, {
      previous: 1,
      routes: [route("new.example.com")],
      health: { timeout: 30, services: [check("web")] },
    })
    const result = verify(w, envelope, { state })
    if (!result.ok) throw new Error(result.error.code)
    const next = result.value.nextState
    expect(next.v).toBe(3)
    expect(next.routes).toEqual(state.routes)
    expect(next.formats).toEqual({ web: 2, shop: 2 })
    expect(readRunnerState(next)).toEqual(next)
    expect(Object.isFrozen(next.routes)).toBe(true)
    expect(Object.isFrozen(next.routes.web!.routes[0])).toBe(true)
  })

  test("comes after K9 and K10, and before K11", async () => {
    const w = await world()
    const state = shared(w)
    const withSecret = {
      ...state,
      secrets: { "web/A": { version: 1, hash: "a".repeat(64) } },
    }
    const taken = [route("shop.example.com")]
    const made = async (change: Parameters<typeof deployV2>[1]) =>
      (await deployV2(w, { routes: taken, ...change })).envelope
    // K9: made against another number.
    expect(reason(verify(w, await made({ previous: 0 }), { state }))).toBe(
      "replayed"
    )
    // K10: past its expiry.
    expect(
      reason(
        verify(
          w,
          await made({
            previous: 1,
            expiresAt: new Date(NOW.getTime() - DAY),
          }),
          { state }
        )
      )
    ).toBe("expired")
    // K11: a live secret not listed, on a deploy that also names a taken domain.
    expect(
      reason(verify(w, await made({ previous: 1 }), { state: withSecret }))
    ).toBe("domain_taken")
    const { envelope } = await deployV2(w, { previous: 1 })
    expect(reason(verify(w, envelope, { state: withSecret }))).toBe(
      "secrets_mismatch"
    )
  })

  test("a state where an app holding routes is at format 1 is never checked against", async () => {
    const w = await world()
    const state = { ...shared(w), formats: { web: 2, shop: 1 } }
    const { envelope } = await deployV2(w, { previous: 1 })
    expect(() => verify(w, envelope, { state: state as never })).toThrow(
      CoreError
    )
  })
})
