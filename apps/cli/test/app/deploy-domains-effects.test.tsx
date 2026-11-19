/**
 * The app's deploys with a domain or a health check (specs/015-domains-https,
 * contracts/cli.md, CL3 and CL6, the app's part; tasks T057 to T059), through
 * the app's effects as app.tsx makes them, against the runner of this
 * repository with the stand-in Docker and the stand-in effects: the stages
 * carry the domains and the health check signed, the runner's `health` event
 * and each new domain's wait for HTTPS reach the deploy's state, and
 * `routes_failed` ends with its sentence as the error notice. Drawing them is
 * the screens' phase.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { waitFor } from "../../../runner/test/support/helpers"
import { createStore } from "../../src/app/app"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent } from "../../src/app/state/events"
import { initialState } from "../../src/app/state/state"
import { B19 } from "../../src/domains/words"
import { shopFile } from "../support/domain-folders"
import { LAST_DAY, standIns } from "../support/domain-stand-ins"
import { ready, type machine } from "../support/helpers"
import { wire } from "../support/wire"

type Machine = ReturnType<typeof machine>
const SIZE = { columns: 100, rows: 30 }

const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** A ready machine whose folder is shop's settings file, `web` added to its web, linked to shop on dev. */
async function shopFolder(web: Record<string, unknown>): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "zekno.app.json"), shopFile(web))
  expect(await m.zekno("link", "--app", "shop", "--server", "dev")).toBe(0)
  m.docker.app("shop", { web: 1, worker: 1 })
  return m
}

/** The app on `m`, as app.tsx makes it, every event kept; `d` deploys shop on dev. */
async function appOn(m: Machine) {
  const events: AppEvent[] = []
  const failures: unknown[] = []
  const start = await loadStart(m.deps)
  let effects: Effects | undefined
  const store = createStore(initialState(start, SIZE), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(
    m.deps,
    (event) => {
      events.push(event)
      store.dispatch(event)
    },
    (error) => failures.push(error),
    undefined,
    {},
    start
  )
  opened.push(effects)
  return {
    events,
    failures,
    get state() {
      return store.get()
    },
    d: () => effects!.run({ kind: "deploy", server: "dev", app: "shop" }),
    ended: () =>
      waitFor(() => store.get().deploy?.running === false, "the deploy to end"),
  }
}

describe("the app's deploys with a domain or a health check", () => {
  test("the stages carry what is signed; the health event and the wait for HTTPS reach the deploy's state, before it ends", async () => {
    const m = await shopFolder({
      networking: { domains: ["shop.example.com"] },
      deploy: { healthcheck: { path: "/health" } },
    })
    standIns(m.deps)
    const app = await appOn(m)
    app.d()
    await app.ended()
    expect(app.failures).toEqual([])
    const kinds = app.events
      .map((event) => event.type)
      .filter(
        (type) => type.startsWith("deploy-") && type !== "deploy-progress"
      )
    expect(kinds).toEqual([
      "deploy-started",
      "deploy-stage",
      "deploy-stage",
      "deploy-stage",
      "deploy-stage",
      "deploy-health",
      "deploy-stage",
      "deploy-https",
      "deploy-https",
      "deploy-ended",
    ])
    const checked = app.events.find((event) => event.type === "deploy-stage")
    expect(checked).toMatchObject({
      domains: ["shop.example.com"],
      health: { timeout: 60, services: [{ service: "web", path: "/health" }] },
    })
    const deploy = app.state.deploy!
    expect(deploy.domains).toEqual(["shop.example.com"])
    expect(deploy.waitingFor).toMatchObject({
      service: "web",
      path: "/health",
    })
    expect(deploy.https).toEqual([
      { domain: "shop.example.com", state: "live", until: new Date(LAST_DAY) },
    ])
    expect(deploy.outcome).toBe("started")
    expect(deploy.result?.tone).toBe("success")
  }, 60_000)

  test("routes_failed: the deploy ends with its sentence as the error notice, accepted, and no wait for HTTPS", async () => {
    const m = await shopFolder({
      networking: { domains: ["shop.example.com"] },
    })
    const asked = standIns(m.deps)
    const w = wire(m.deps)
    w.rewrite("deploy", (result) => ({
      ...result,
      outcome: "routes_failed",
      routes: { failure: "not_loaded" },
    }))
    const app = await appOn(m)
    app.d()
    await app.ended()
    expect(app.failures).toEqual([])
    const deploy = app.state.deploy!
    expect(deploy.outcome).toBe("routes_failed")
    expect(deploy.result).toEqual({ tone: "error", text: B19("shop", "dev") })
    expect(app.events.some((event) => event.type === "deploy-https")).toBe(
      false
    )
    expect(asked.https).toEqual([])
  }, 60_000)

  test("a deploy with neither: no new event, nothing looked up", async () => {
    const m = await shopFolder({})
    const asked = standIns(m.deps)
    const app = await appOn(m)
    app.d()
    await app.ended()
    expect(
      app.events.some(
        (event) =>
          event.type === "deploy-health" || event.type === "deploy-https"
      )
    ).toBe(false)
    const stage = app.events.find((event) => event.type === "deploy-stage")
    expect(stage).not.toHaveProperty("domains")
    expect(stage).not.toHaveProperty("health")
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
  }, 60_000)
})
