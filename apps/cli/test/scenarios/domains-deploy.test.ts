/**
 * `zekno deploy` with a domain or a health check, end to end
 * (specs/015-domains-https, contracts/cli.md, CL3; User Stories 1, 2 and 5;
 * tasks T056 to T059, T066): shop on prod-1, reached over the stand-in SSH,
 * whose runner is this repository's with the stand-in Docker, so routes are
 * put in force as the runner does it; the server's address, the lookups and
 * HTTPS from the stand-in effects. What is said, on which stream, what was
 * signed and sent, and the exit status, with no terminal; and the lines a
 * terminal draws.
 */
import { describe, expect, test } from "bun:test"

import {
  B13,
  B14,
  B15,
  B16,
  B7,
  B8,
  C3,
  dnsPlain,
  httpsLivePlain,
} from "../../src/domains/words"
import type { DeployInfo } from "../../src/shared/deploy"
import { startedSentence } from "../../src/shared/deploy"
import type { Ui } from "../../src/ui/types"
import { entriesOf, historyOf } from "../support/deploys"
import { shopFile, shopOnProd } from "../support/domain-folders"
import {
  ELSEWHERE,
  LAST_DAY,
  pointsTo,
  SERVER_ADDRESS,
  standIns,
  validUntil,
} from "../support/domain-stand-ins"
import { terminal, until } from "../support/terminal"
import { wire } from "../support/wire"

const SHOP = "shop.example.com"
const ROUTE = { domain: SHOP, service: "web", port: 3000 }
const started = (n: number) =>
  startedSentence({ sequence: n, app: "shop", server: "prod-1", secrets: 0 })
const withDomain = (more: Record<string, unknown> = {}) =>
  shopFile({ networking: { domains: [SHOP] }, ...more })

/** The deploy view's calls, the three of feature 015 among them, around the plain view. */
function viewCalls(m: { deps: { ui: Ui } }) {
  const calls: string[] = []
  const infos: DeployInfo[] = []
  const plain = m.deps.ui
  m.deps.ui = {
    ...plain,
    deploy(start) {
      const view = plain.deploy(start)
      return {
        stage: (stage, info) => {
          calls.push(`stage ${stage}`)
          infos.push(info)
          view.stage(stage, info)
        },
        progress: (line) => view.progress(line),
        end: (ending) => (
          calls.push(`end ${ending.outcome}`),
          view.end(ending)
        ),
        pointed: (domain, address) => {
          calls.push(`pointed ${domain} ${address}`)
          view.pointed?.(domain, address)
        },
        health: (service) => void calls.push(`health ${service}`),
        https: (shown) =>
          void calls.push(`https ${shown.domain} ${shown.state}`),
      }
    },
  }
  return { calls, infos }
}

describe("User Story 1: a domain and HTTPS", () => {
  test("the first deploy with a domain: B1, the route signed and put in force, then B5, with no terminal", async () => {
    const s = await shopOnProd(withDomain())
    const asked = standIns(s.m.deps, {
      https: { [SHOP]: [validUntil(LAST_DAY)] },
    })
    const w = wire(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    expect(s.m.out).toEqual([
      dnsPlain(SHOP, SERVER_ADDRESS),
      started(1),
      httpsLivePlain(SHOP, new Date(LAST_DAY)),
    ])
    expect(s.m.err).toEqual([])
    expect(asked).toEqual({
      ssh: ["deploy@prod-1"],
      dns: [SHOP],
      https: [SHOP],
    })
    const [entry] = await entriesOf(s.m, "shop")
    expect(entry?.deploy.routes).toEqual([ROUTE])
    expect(entry?.outcome).toBe("started")
    // `status` was asked with the routes in force (CL3 step 2), and the runner holds the route now.
    expect(w.requests("status").map((request) => request.input)).toEqual([
      { routes: true },
    ])
    s.clear()
    expect(await s.zekno("status", "--json")).toBe(0)
    expect(JSON.parse(s.m.out[0]!).routes).toEqual({ shop: [ROUTE] })
  }, 60_000)

  test("a later deploy of a domain the app holds: no B1, no wait, nothing extra said; the domain is looked up all the same", async () => {
    const s = await shopOnProd(withDomain())
    standIns(s.m.deps, { https: { [SHOP]: [validUntil(LAST_DAY)] } })
    expect(await s.zekno("deploy")).toBe(0)
    s.clear()
    const asked = standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: [started(2)],
      err: [],
    })
    expect(asked).toEqual({ ssh: ["deploy@prod-1"], dns: [SHOP], https: [] })
  }, 60_000)

  test("the view is told B1, the domains and the health check it signs, the health event and the wait, and in that order", async () => {
    const s = await shopOnProd(
      withDomain({ deploy: { healthcheck: { path: "/health" } } })
    )
    standIns(s.m.deps, { https: { [SHOP]: [validUntil(LAST_DAY)] } })
    const { calls, infos } = viewCalls(s.m)
    expect(await s.zekno("deploy")).toBe(0)
    expect(calls).toEqual([
      `pointed ${SHOP} ${SERVER_ADDRESS}`,
      "stage checked",
      "stage signed",
      "stage sent",
      "stage starting",
      "health web",
      "stage started",
      `https ${SHOP} waiting`,
      `https ${SHOP} live`,
      "end started",
    ])
    expect(infos[0]).toMatchObject({
      domains: [SHOP],
      health: { timeout: 60, services: [{ service: "web", path: "/health" }] },
    })
  }, 60_000)
})

describe("User Story 2: DNS is checked before anything is signed", () => {
  for (const [about, dns, said] of [
    ["no record: B7", "none", B7(SHOP, "A", SERVER_ADDRESS)],
    [
      "elsewhere: B8",
      pointsTo(ELSEWHERE),
      B8(SHOP, ELSEWHERE, "prod-1", "A", SERVER_ADDRESS),
    ],
  ] as const)
    test(`${about}, on standard error alone; nothing signed, nothing sent; exit status 1`, async () => {
      const s = await shopOnProd(withDomain())
      standIns(s.m.deps, { dns: { [SHOP]: dns } })
      const w = wire(s.m.deps)
      expect(await s.zekno("deploy")).toBe(1)
      expect({ out: s.m.out, err: s.m.err }).toEqual({ out: [], err: [said] })
      expect(historyOf(s.m, "shop")).toEqual([])
      expect(w.requests("deploy")).toEqual([])
      expect(w.requests("records")).toEqual([])
    }, 60_000)

  test("--skip-dns-check: B14, nothing looked up, the deploy goes on; another command does not take it", async () => {
    const s = await shopOnProd(withDomain())
    const asked = standIns(s.m.deps, { dns: { [SHOP]: "none" } })
    expect(await s.zekno("deploy", "--skip-dns-check")).toBe(0)
    expect(s.m.err).toEqual([B14(SHOP)])
    expect(s.m.out).toEqual([
      started(1),
      httpsLivePlain(SHOP, new Date(LAST_DAY)),
    ])
    expect(asked.dns).toEqual([])
    expect((await entriesOf(s.m, "shop"))[0]?.deploy.routes).toEqual([ROUTE])
    s.clear()
    expect(await s.zekno("rollback", "--skip-dns-check")).toBe(2)
    expect(s.m.err[0]).toStartWith("Unknown option '--skip-dns-check'")
  }, 60_000)

  test("the server's address not known: B13 with what the domain points to, a warning, and the deploy goes on", async () => {
    const s = await shopOnProd(withDomain())
    standIns(s.m.deps, { server: undefined })
    expect(await s.zekno("deploy")).toBe(0)
    expect(s.m.err).toEqual([B13(SHOP, "prod-1", SERVER_ADDRESS)])
    expect(s.m.out).toEqual([
      started(1),
      httpsLivePlain(SHOP, new Date(LAST_DAY)),
    ])
  }, 60_000)

  test("a domain the app holds that moved away: B15, a warning; the deploy goes on", async () => {
    const s = await shopOnProd(withDomain())
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    s.clear()
    standIns(s.m.deps, { dns: { [SHOP]: pointsTo(ELSEWHERE) } })
    expect(await s.zekno("deploy")).toBe(0)
    expect(s.m.err).toEqual([B15(SHOP, ELSEWHERE, "prod-1", "shop")])
    expect(s.m.out).toEqual([started(2)])
  }, 60_000)
})

describe("the answer: routes_failed and unhealthy (CL3)", () => {
  test("a port taken: B16 on standard error, exit 1, recorded as routes_failed, and the number is the app's current one", async () => {
    const s = await shopOnProd(withDomain())
    standIns(s.m.deps)
    s.m.docker.script({
      runFails: {
        code: 125,
        stderr:
          "docker: Error response from daemon: Bind for 0.0.0.0:80 failed: port is already allocated.",
        leave: true,
      },
    })
    expect(await s.zekno("deploy")).toBe(1)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: [dnsPlain(SHOP, SERVER_ADDRESS)],
      err: [B16("shop", "prod-1", 80)],
    })
    const [entry] = await entriesOf(s.m, "shop")
    expect(entry?.outcome).toBe("routes_failed")
    s.clear()
    expect(await s.zekno("deploy")).toBe(0)
    expect((await entriesOf(s.m, "shop")).at(-1)?.deploy.previous).toBe(1)
  }, 60_000)

  test("not healthy in time: C3 with the path and the limit, exit 1, recorded as unhealthy; nothing rolled back", async () => {
    const s = await shopOnProd(
      shopFile({ deploy: { healthcheck: { path: "/health", timeout: 1 } } })
    )
    s.m.docker.script({ curl: { web: "500|0" } })
    expect(await s.zekno("deploy")).toBe(1)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: [],
      err: [C3("web", "/health", 1, "shop")],
    })
    const [entry] = await entriesOf(s.m, "shop")
    expect(entry?.outcome).toBe("unhealthy")
    expect(entry?.deploy.health).toEqual({
      timeout: 1,
      services: [{ service: "web", http: { port: 3000, path: "/health" } }],
    })
  }, 60_000)

  test("a health check without a domain: no lookup at all, healthy, started", async () => {
    const s = await shopOnProd(
      shopFile({ deploy: { healthcheck: { path: "/health" } } })
    )
    const asked = standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    expect(s.m.out).toEqual([started(1)])
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
  }, 60_000)
})

describe("at a terminal (CL3)", () => {
  test("B1 before the panel, the stage row, the result and B5; a port taken ends with B16 under ✔ Started", async () => {
    const s = await shopOnProd(withDomain())
    standIns(s.m.deps, { https: { [SHOP]: [validUntil(LAST_DAY)] } })
    let t = terminal(100)
    s.m.deps.ui = t.ui
    expect(await s.zekno("deploy")).toBe(0)
    await until(
      () => t.lines().some((line) => line.includes("zekno logs")),
      "the result"
    )
    const first = t.lines()
    await t.ui.close()
    expect(first[0]).toBe(`✔ ${SHOP} points to prod-1  ${SERVER_ADDRESS}`)
    expect(first).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
    const live = first.findIndex((line) => line.startsWith("✔ shop is live"))
    expect(first.slice(live + 1, live + 3)).toEqual([
      `✔ https://${SHOP} is live  certificate until 17 Feb 2027`,
      "  zekno logs to watch it, zekno rollback to undo",
    ])

    t = terminal(100)
    s.m.deps.ui = t.ui
    s.m.docker.script({
      runFails: { code: 125, stderr: "port is already allocated", leave: true },
    })
    // The proxy runs from another image, so the runner makes it again (RN6), and the port is taken by then.
    s.m.docker.change("zekno-proxy", { image: "caddy:2.10.0" })
    expect(await s.zekno("deploy")).toBe(1)
    const second = t.lines()
    await t.ui.close()
    expect(second).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
    expect(second.some((line) => line.includes("Number"))).toBe(false)
    // B16, its first sentence after ✖, below the stage row.
    expect(second.at(-2)).toBe(
      "✖ shop is running, but prod-1 cannot answer for its domains: port 80 is in use by another program."
    )
  }, 60_000)
})
