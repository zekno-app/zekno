/**
 * The health check in force (specs/015-domains-https, contracts/runner.md,
 * RN9 and RN13; core.md, "The state" and "`status` with routes"; FR-019):
 * an app's entry in the state keeps the health check of the deploy whose
 * routes it holds, written at the same moment, and `status` with routes
 * answers it, so a rollback from any machine signs the check in force.
 * Against the real runner program and the stand-in for Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  healthBytes,
  LIMITS,
  parseMessage,
  RunnerStatusWithRoutesSchema,
  type Health,
} from "@workspace/core"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { leftAsItWas } from "../support/deploy-v2"
import { world } from "../support/helpers"
import {
  ask,
  configRoutes,
  deployRoutes,
  route,
  stateOf,
  type World,
} from "../support/routes"

const APP = route("app.example.com")
const NEW = route("new.example.com")

/** A check of `web` without a path: the stand-in's containers say `healthy` at once. */
const UP: Health = { timeout: 30, services: [{ service: "web", http: null }] }
/** Another check of `web`, to tell two deploys apart. */
const UP_LONGER: Health = { ...UP, timeout: 90 }

/** A world whose app `web` has one container that Docker calls healthy. */
async function healthy(): Promise<World> {
  const w = await world()
  w.docker.app("web", { web: [{ health: "healthy" }] })
  return w
}

/** What `status` with routes answers, checked by its schema. */
async function answered(w: World) {
  const answer = await ask(w, "status", { routes: true })
  expect(parseMessage(RunnerStatusWithRoutesSchema, answer).ok).toBe(true)
  return answer as { routes: unknown; health: unknown }
}

describe("the entry keeps the deploy's health check beside its routes (RN9)", () => {
  test("a health check and no route: the entry holds the check and no route; status answers it under health, routes {}", async () => {
    const w = await healthy()
    expect((await deployRoutes(w, 0, { health: UP })).result.outcome).toBe(
      "started"
    )
    const entry = stateOf(w.home).routes.web!
    expect(entry.routes).toEqual([])
    expect(entry.health).toEqual(UP)
    expect(entry.names.web).toHaveLength(1)
    const answer = await answered(w)
    expect(answer.routes).toEqual({})
    expect(answer.health).toEqual({ web: UP })
  })

  test("a route and a health check: both in the entry, as signed; status answers both", async () => {
    const w = await healthy()
    expect(
      (await deployRoutes(w, 0, { routes: [APP], health: UP })).result.outcome
    ).toBe("started")
    const entry = stateOf(w.home).routes.web!
    expect({ routes: entry.routes, health: entry.health }).toEqual({
      routes: [APP],
      health: UP,
    })
    const answer = await answered(w)
    expect(answer.routes).toEqual({ web: [APP] })
    expect(answer.health).toEqual({ web: UP })
  })

  test("a route and no health check: the entry's check is null, and the app is not under health", async () => {
    const w = await healthy()
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    expect(stateOf(w.home).routes.web!.health).toBeNull()
    const answer = await answered(w)
    expect(answer.routes).toEqual({ web: [APP] })
    expect(answer.health).toEqual({})
  })

  test("a later deploy without one: a route kept and the check dropped is null; neither left removes the entry", async () => {
    const w = await healthy()
    expect(
      (await deployRoutes(w, 0, { routes: [APP], health: UP })).result.outcome
    ).toBe("started")
    expect((await deployRoutes(w, 1, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    expect(stateOf(w.home).routes.web!.health).toBeNull()
    expect((await answered(w)).health).toEqual({})

    // A health check only, then neither: the entry goes.
    expect((await deployRoutes(w, 2, { health: UP })).result.outcome).toBe(
      "started"
    )
    expect((await answered(w)).health).toEqual({ web: UP })
    expect((await deployRoutes(w, 3)).result.outcome).toBe("started")
    expect(stateOf(w.home).routes).toEqual({})
    const answer = await answered(w)
    expect({ routes: answer.routes, health: answer.health }).toEqual({
      routes: {},
      health: {},
    })
  })
})

describe("when the routes are not put in force (RN9, RN12)", () => {
  test("routes_failed: the entry keeps the earlier deploy's routes and health check, together, and status answers those", async () => {
    const w = await healthy()
    expect(
      (await deployRoutes(w, 0, { routes: [APP], health: UP })).result.outcome
    ).toBe("started")
    const before = stateOf(w.home).routes
    w.docker.script({ reloads: ["failed"] })
    expect(
      (await deployRoutes(w, 1, { routes: [APP, NEW], health: UP_LONGER }))
        .result
    ).toEqual({
      outcome: "routes_failed",
      app: "web",
      sequence: 2,
      routes: { failure: "not_loaded" },
    })
    expect(stateOf(w.home).routes).toEqual(before)
    expect(stateOf(w.home).routes.web!.health).toEqual(UP)
    const answer = await answered(w)
    expect(answer.routes).toEqual({ web: [APP] })
    expect(answer.health).toEqual({ web: UP })
  })

  test("routes_failed on an app that held nothing: no entry, so no health check in force", async () => {
    const w = await world()
    w.docker.app("web", { worker: 1 })
    expect((await deployRoutes(w, 0, { health: UP })).result).toEqual({
      outcome: "routes_failed",
      app: "web",
      sequence: 1,
      routes: { failure: "no_container", service: "web" },
    })
    expect(stateOf(w.home).routes).toEqual({})
    expect((await answered(w)).health).toEqual({})
  })

  test("unhealthy: the routes were put in force first, so the entry holds this deploy's routes and health check", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.script({ curl: { web: "500|0" } })
    const check: Health = {
      timeout: 2,
      services: [{ service: "web", http: { port: 3000, path: "/health" } }],
    }
    expect(
      (await deployRoutes(w, 0, { routes: [APP], health: check })).result
    ).toEqual({
      outcome: "unhealthy",
      app: "web",
      sequence: 1,
      health: { service: "web", http: true },
    })
    const entry = stateOf(w.home).routes.web!
    expect({ routes: entry.routes, health: entry.health }).toEqual({
      routes: [APP],
      health: check,
    })
    expect(Object.keys(configRoutes(w.home))).toEqual(["app.example.com"])
    expect((await answered(w)).health).toEqual({ web: check })
  }, 30_000)
})

describe("status without the input (RN13)", () => {
  test("after a deploy with a health check, today's answer exactly: no routes, no health", async () => {
    const w = await healthy()
    expect(
      (await deployRoutes(w, 0, { routes: [APP], health: UP })).result.outcome
    ).toBe("started")
    expect(Object.keys(await ask(w, "status")).sort()).toEqual([
      "lastSequence",
      "secrets",
      "serverId",
      "serverPublicKey",
      "team",
    ])
  })
})

describe("the state's limits (RN2, K15)", () => {
  /** The largest check a signed deploy can carry: 16 services, each checked on a path of 1,024 characters. */
  const largest = (): Health => ({
    timeout: LIMITS.healthSeconds,
    services: Array.from({ length: LIMITS.healthServices }, (_, n) => ({
      service: `s${String(n).padStart(2, "0")}`,
      http: {
        port: 3000,
        path: `/${"p".repeat(LIMITS.healthPathLength - 1)}`,
      },
    })),
  })

  test(`a deploy that would leave more than ${LIMITS.healthBytesPerServer} bytes of health checks is refused too_large: no number used, nothing touched`, async () => {
    const w = await world()
    const file = join(w.home, "state.json")
    const state = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      Record<string, unknown>
    >
    // As many other apps as fit, each holding the largest check, as deploys would have left them.
    const held: Record<string, Health> = {}
    let n = 0
    while (
      healthBytes({ ...held, [`h-${n}`]: largest() }) <=
      LIMITS.healthBytesPerServer
    ) {
      held[`h-${n}`] = largest()
      n++
    }
    const apps = Object.keys(held)
    const hex = (i: number, length: number) =>
      i.toString(16).padStart(length, "0")
    writeFileSync(
      file,
      JSON.stringify({
        ...state,
        lastSequence: Object.fromEntries(apps.map((app) => [app, 1])),
        formats: Object.fromEntries(apps.map((app) => [app, 2])),
        routes: Object.fromEntries(
          apps.map((app, i) => [
            app,
            {
              routes: [],
              health: held[app],
              names: {
                s00: [
                  { container: hex(i + 1, 64), name: `z${hex(i + 1, 32)}` },
                ],
              },
            },
          ])
        ),
      })
    )
    expect(Object.keys((await answered(w)).health as object)).toEqual(
      [...apps].sort()
    )

    const before = leftAsItWas(w)
    const { result } = await deployRoutes(w, 0, { health: largest() })
    expect(result).toEqual({ outcome: "refused", reason: "too_large" })
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("an entry the state kept before it held its health check is not read: every request answers invalid_state", async () => {
    const w = await healthy()
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const file = join(w.home, "state.json")
    const state = JSON.parse(readFileSync(file, "utf8")) as {
      routes: Record<string, Record<string, unknown>>
    }
    const { health: _health, ...entry } = state.routes.web!
    writeFileSync(file, JSON.stringify({ ...state, routes: { web: entry } }), {
      mode: 0o600,
    })
    expect(await ask(w, "status", { routes: true })).toEqual({
      outcome: "refused",
      reason: "invalid_state",
    })
  })
})
