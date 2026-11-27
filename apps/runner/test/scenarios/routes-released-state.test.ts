/**
 * The released domains in the state (specs/015-domains-https, contracts/
 * core.md, "The state"; runner.md, RN2, RN9, RN10), against the real runner
 * program and the stand-in for Docker: a domain in force is never deleted,
 * whatever the list held; K15 counts the list; and a state marked 3 by runner
 * 0.1.1-dev.1 is read and saved as mark 5. The tries themselves are in
 * routes-certificates.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import { readFileSync, writeFileSync } from "node:fs"

import { leftAsItWas } from "../support/deploy-v2"
import { world } from "../support/helpers"
import { olderRunner, olderTree } from "../support/older-programs"
import {
  API,
  APP,
  certificatesOf,
  deletions,
  releasedButKept,
  stateFile,
  twoApps,
} from "../support/released"
import {
  ask,
  deployRoutes,
  route,
  stateOf,
  steps,
  type World,
} from "../support/routes"

describe("a domain in force is never deleted", () => {
  test("released and routed again by the same app before its deletion worked: off the list, its certificate kept", async () => {
    const w = await releasedButKept()
    const before = w.docker.calls().length
    expect((await deployRoutes(w, 2, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    expect(deletions(steps(w).slice(before))).toEqual([])
    expect(stateOf(w.home).released).toEqual([])
    expect(stateOf(w.home).routes.web!.routes).toEqual([APP])
    expect(certificatesOf(w)).toEqual(["api.example.com", "app.example.com"])
  })

  test("released by one app and routed by another before its deletion worked: the same", async () => {
    const w = await releasedButKept()
    const before = w.docker.calls().length
    const taken = route("app.example.com", "api", 8080)
    expect(
      (await deployRoutes(w, 1, { app: "api", routes: [API, taken] })).result
        .outcome
    ).toBe("started")
    expect(deletions(steps(w).slice(before))).toEqual([])
    expect(stateOf(w.home).released).toEqual([])
    expect(stateOf(w.home).routes.api!.routes).toEqual([API, taken])
    expect(certificatesOf(w)).toEqual(["api.example.com", "app.example.com"])
  })

  test("a state whose list names a domain in force is not read: every request answers invalid_state, and nothing is deleted", async () => {
    const w = await twoApps()
    const state = stateOf(w.home)
    writeFileSync(
      stateFile(w),
      JSON.stringify({ ...state, released: ["app.example.com"] }),
      { mode: 0o600 }
    )
    const invalid = { outcome: "refused", reason: "invalid_state" }
    const before = w.docker.calls().length
    expect(await ask(w, "status", { routes: true })).toEqual(invalid)
    expect(await ask(w, "proxy")).toEqual(invalid)
    expect((await deployRoutes(w, 0, { app: "other" })).result).toEqual(invalid)
    expect(w.docker.calls().length).toBe(before)
    expect(certificatesOf(w)).toEqual(["api.example.com", "app.example.com"])
  })
})

describe(`K15: the domains in force and the list at most ${LIMITS.domainsPerServer} (RN2)`, () => {
  /** twoApps, with as many domains on the list as fit beside the two in force, and the proxy another server's, so no deletion runs. */
  async function full(): Promise<{ w: World; listed: string[] }> {
    const w = await twoApps()
    const listed = Array.from(
      { length: LIMITS.domainsPerServer - 2 },
      (_, n) => `d${String(n).padStart(4, "0")}.example.com`
    )
    writeFileSync(
      stateFile(w),
      JSON.stringify({ ...stateOf(w.home), released: listed }),
      { mode: 0o600 }
    )
    w.docker.change("zekno-proxy", {
      labels: { "app.zekno.server": "another", "app.zekno.role": "proxy" },
    })
    return { w, listed }
  }

  test("a deploy with one domain more is too_large before its number is used: nothing written, Docker not called", async () => {
    const { w } = await full()
    const before = leftAsItWas(w)
    for (const [app, previous, routes] of [
      ["web", 1, [APP, route("new.example.com")]],
      ["other", 0, [route("new.example.com")]],
    ] as const) {
      const { result, events } = await deployRoutes(w, previous, {
        app,
        routes: [...routes],
      })
      expect({ result, events }).toEqual({
        result: { outcome: "refused", reason: "too_large" },
        events: [],
      })
    }
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("a domain given up still counts, and one on the list routed again adds nothing: those deploys use their number", async () => {
    const { w, listed } = await full()
    // web gives up app.example.com: the count stays at the limit.
    expect((await deployRoutes(w, 1, { routes: [] })).result).toEqual({
      outcome: "routes_failed",
      app: "web",
      sequence: 2,
      routes: { failure: "not_loaded" },
    })
    // A new app takes a domain on the list.
    expect(
      (await deployRoutes(w, 0, { app: "other", routes: [route(listed[0]!)] }))
        .result
    ).toMatchObject({ outcome: "routes_failed", app: "other", sequence: 1 })
    // A deploy with no route at all.
    expect((await deployRoutes(w, 1, { app: "other" })).result).toEqual({
      outcome: "started",
      app: "other",
      sequence: 2,
    })
    expect(stateOf(w.home).released).toEqual(listed)
  })
})

/** Runner 0.1.1-dev.1, the release that writes the state marked 3. */
const RUNNER_DEV_1 = "runner-v0.1.1-dev.1"
const dev1 = olderTree(RUNNER_DEV_1)

describe('the mark (core.md, "The state")', () => {
  test.skipIf(dev1 === undefined)(
    "a state marked 3 by runner 0.1.1-dev.1 is read, left as it is by reads, and saved as mark 5 at the first write; 0.1.1-dev.1 put back refuses mark 5",
    async () => {
      const w = await world()
      const older = (command: string) => {
        const child = Bun.spawn(
          [...olderRunner(dev1!, w.docker.path), command],
          {
            env: { ...process.env, ZEKNO_RUNNER_HOME: w.home },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          }
        )
        return new Response(child.stdout)
          .text()
          .then((text) => JSON.parse(text) as Record<string, unknown>)
      }
      expect(await older("version")).toEqual({
        version: "0.1.1-dev.1",
        protocol: 4,
      })
      w.docker.app("web", { web: 1 })
      expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
        "started"
      )
      // The state as runner 0.1.1-dev.1 writes it: marked 3, without the list.
      const {
        released: _released,
        builds: _builds,
        building: _building,
        ...rest
      } = JSON.parse(readFileSync(stateFile(w), "utf8")) as Record<
        string,
        unknown
      >
      writeFileSync(stateFile(w), JSON.stringify({ ...rest, v: 3 }), {
        mode: 0o600,
      })
      const bytes = readFileSync(stateFile(w), "utf8")
      expect(await older("status")).toMatchObject({
        serverId: w.serverId,
        lastSequence: { web: 1 },
      })

      // This runner reads it, routes and all, and reading writes nothing.
      expect(await ask(w, "status", { routes: true })).toMatchObject({
        routes: { web: [APP] },
        proxy: "running",
      })
      expect(readFileSync(stateFile(w), "utf8")).toBe(bytes)

      // The first write: the release, saved as mark 5 with its deletion still to do.
      w.docker.script({ deletionFails: 1 })
      expect((await deployRoutes(w, 1, { routes: [] })).result.outcome).toBe(
        "started"
      )
      expect(stateOf(w.home)).toMatchObject({
        v: 5,
        lastSequence: { web: 2 },
        routes: {},
        released: ["app.example.com"],
      })
      expect(await older("status")).toEqual({
        outcome: "refused",
        reason: "invalid_state",
      })
    },
    60_000
  )
})
