/**
 * `zekno domain add`, then `zekno deploy`, end to end against the runner of
 * this repository with the stand-in Docker (specs/015-domains-https,
 * contracts/cli.md, CL1 to CL3 and CL7; tasks T050). What is checked is what
 * the CLI signed and sent: the routes and the health check under the
 * signature, in the history and in the `deploy` request, and nothing of them
 * in the Compose text. The runner of this copy takes such a deploy and starts
 * the app; putting the routes in force is the runner's part of the feature,
 * which its own tests hold.
 *
 * Also: a runner that does not carry them out stops the deploy before
 * anything is signed (B10); a deploy with neither is signed as before; the
 * outcomes `routes_failed` and `unhealthy` are recorded as themselves; and
 * `zekno settings` marks a domain added since the last deploy.
 */
import { describe, expect, test } from "bun:test"
import type { Envelope } from "@workspace/core"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { B10 } from "../../src/domains/words"
import { showSettings } from "../../src/ops/settings"
import { composeText } from "../../src/settings/compose"
import { checkSettings } from "../../src/settings/schema"
import type { Settings } from "../../src/settings/types"
import { entriesOf, historyOf, payloadOf, stateOf } from "../support/deploys"
import { machine, ready } from "../support/helpers"
import { reportingAs } from "../support/older-runner"
import { olderRunner } from "../support/stand-in-server"
import { wire } from "../support/wire"

type Machine = ReturnType<typeof machine>

const WHERE = ["--app", "shop", "--server", "dev"]
const FILE = JSON.stringify({
  zekno: 1,
  services: {
    web: {
      source: { image: "ghcr.io/acme/shop-web:1.0.0" },
      deploy: { healthcheck: { path: "/health" } },
      networking: { port: 3000 },
    },
    worker: { source: { image: "ghcr.io/acme/shop-worker:1.0.0" } },
  },
})

/**
 * A ready machine whose folder holds only the settings file above, linked to
 * shop on dev. The stand-in Docker holds a running container of each of
 * shop's services, as `up` leaves them, so the runner finds the routed and
 * checked service and puts its route in force.
 */
async function shopFolder(): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "zekno.app.json"), FILE)
  expect(await m.zekno("link", ...WHERE)).toBe(0)
  m.docker.app("shop", { web: 1, worker: 1 })
  return m
}

/** The settings the folder's file holds now. */
const settingsOf = (m: Machine): Settings =>
  checkSettings(
    readFileSync(join(m.project, "zekno.app.json"), "utf8"),
    "zekno.app.json"
  ) as Settings

const ROUTE = { domain: "shop.example.com", service: "web", port: 3000 }
const HEALTH = {
  timeout: 60,
  services: [{ service: "web", http: { port: 3000, path: "/health" } }],
}

describe("zekno domain add, then zekno deploy (T050)", () => {
  test("the route and the health check are signed, recorded and sent; the Compose text is the settings' own, with neither in it", async () => {
    const m = await shopFolder()
    expect(await m.zekno("domain", "add", "Shop.Example.com", "--yes")).toBe(0)
    const w = wire(m.deps)
    m.out.length = 0
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.out).toEqual([
      "Deploy 1 of shop is running on dev with no secrets.",
    ])

    // Signed: read from under the signature, in this machine's history.
    const [entry] = await entriesOf(m, "shop")
    expect(entry?.format).toBe(2)
    expect(entry?.outcome).toBe("started")
    expect(entry?.deploy.routes).toEqual([ROUTE])
    expect(entry?.deploy.health).toEqual(HEALTH)
    expect(entry?.deploy.compose).toBe(composeText(settingsOf(m)))
    expect(entry?.deploy.compose).not.toContain("example.com")
    expect(entry?.deploy.compose).not.toContain("/health")

    // Sent: the `deploy` request carries that very envelope, with the route in its payload.
    const [sent] = w.requests("deploy") as {
      input: { envelope: Envelope }
    }[]
    expect(sent!.input.envelope).toEqual(entry!.envelope)
    expect(payloadOf(sent!.input.envelope).routes).toEqual([ROUTE])
    expect(payloadOf(sent!.input.envelope).health).toEqual(HEALTH)
    // The runner took it: its state is protocol 4's, and the app's number is 1.
    expect(stateOf(m).v).toBe(4)
    expect(stateOf(m).lastSequence.shop).toBe(1)
  }, 60_000)

  test("a second domain is marked changed, not deployed, until the next deploy signs both, sorted", async () => {
    const m = await shopFolder()
    expect(await m.zekno("domain", "add", "shop.example.com", "--yes")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    expect(await m.zekno("domain", "add", "api.example.com", "--yes")).toBe(0)
    const rows = (await showSettings(m.deps)).services[0]!.rows.filter(
      (row) => row.section === "Networking" && row.path.key === "domains"
    )
    expect(rows.map((row) => [row.shown, row.changed])).toEqual([
      ["shop.example.com", undefined],
      ["api.example.com", {}],
    ])
    expect(await m.zekno("deploy")).toBe(0)
    const entries = await entriesOf(m, "shop")
    expect(entries.at(-1)?.deploy.routes).toEqual([
      { domain: "api.example.com", service: "web", port: 3000 },
      ROUTE,
    ])
    const after = (await showSettings(m.deps)).services[0]!.rows
    expect(after.every((row) => row.changed === undefined)).toBe(true)
  }, 60_000)

  test("rm, then deploy: the route is signed away, and a deploy with neither signs neither (CL7)", async () => {
    const m = await shopFolder()
    expect(await m.zekno("domain", "add", "shop.example.com", "--yes")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    expect(await m.zekno("domain", "rm", "shop.example.com", "--yes")).toBe(0)
    expect(await m.zekno("settings", "unset", "web.health", "--yes")).toBe(0)
    const w = wire(m.deps)
    expect(await m.zekno("deploy")).toBe(0)
    const latest = (await entriesOf(m, "shop")).at(-1)
    expect(latest?.deploy.routes).toEqual([])
    expect(latest?.deploy.health).toBeNull()
    // The same requests as any deploy before feature 015: `status` asked as it always is.
    const status = w.requests("status")
    expect(status.every((request) => request.input === undefined)).toBe(true)
  }, 60_000)
})

describe("B10: a runner that does not carry out routes (CL3, step 1)", () => {
  test("protocol 3: B10 with its version, exit 1, nothing signed, nothing run; without a route or a health check the same runner deploys", async () => {
    const m = await shopFolder()
    expect(await m.zekno("domain", "add", "shop.example.com", "--yes")).toBe(0)
    const back = reportingAs(m, "0.1.0", 3)
    const ups = m.docker.calls().length
    m.err.length = 0
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.err).toEqual([B10("dev", "0.1.0")])
    expect(historyOf(m, "shop")).toEqual([])
    expect(m.docker.calls().length).toBe(ups)
    // The health check alone is enough to need protocol 4.
    expect(await m.zekno("domain", "rm", "shop.example.com", "--yes")).toBe(0)
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.lastErr()).toBe(B10("dev", "0.1.0"))
    expect(await m.zekno("settings", "unset", "web.health", "--yes")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    back()
  }, 60_000)

  test("a runner run one request at a time: B10 without a version", async () => {
    const m = await shopFolder()
    expect(await m.zekno("domain", "add", "shop.example.com", "--yes")).toBe(0)
    const path = join(m.home, "older-runner")
    writeFileSync(path, olderRunner(m.docker.path), { mode: 0o755 })
    m.deps.localRunner = ["sh", path]
    m.err.length = 0
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.err).toEqual([B10("dev")])
    expect(historyOf(m, "shop")).toEqual([])
  }, 60_000)
})

describe("the outcomes of protocol 4, recorded as themselves (T048)", () => {
  for (const [outcome, extra] of [
    ["routes_failed", { routes: { failure: "not_loaded" } }],
    ["unhealthy", { health: { service: "web", http: true } }],
  ] as const)
    test(`${outcome}: accepted, the number used, the history keeps ${outcome}, exit 1`, async () => {
      const m = await shopFolder()
      expect(await m.zekno("domain", "add", "shop.example.com", "--yes")).toBe(
        0
      )
      const w = wire(m.deps)
      w.rewrite("deploy", (result) => ({ ...result, outcome, ...extra }))
      expect(await m.zekno("deploy")).toBe(1)
      w.rewrite("deploy", undefined)
      const [entry] = await entriesOf(m, "shop")
      expect(entry?.outcome).toBe(outcome)
      expect(entry?.deploy.sequence).toBe(1)
      // The next deploy is made after it: it was accepted, and is the app's current one.
      expect(await m.zekno("deploy")).toBe(0)
      expect((await entriesOf(m, "shop")).at(-1)?.deploy.previous).toBe(1)
    }, 60_000)
})
