/**
 * What a deploy checks of its domains before anything is signed
 * (specs/015-domains-https, contracts/cli.md, CL3, steps 2 to 6; tasks T055,
 * T056, T060), one rule at a time, on a plan made from a settings file and
 * the routes a `status` with routes would give, with the stand-in effects
 * (test/support/domain-stand-ins.ts). Nothing here connects: the end-to-end
 * runs are in test/scenarios/domains-*.test.ts.
 */
import { describe, expect, test } from "bun:test"
import type { Route } from "@workspace/core"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  B11,
  B12,
  B13,
  B14,
  B15,
  B7,
  B8,
  B9,
  LOOKUP_FAILED,
} from "../../src/domains/words"
import { prepareDeploy, type DeployPlan } from "../../src/ops/deploy"
import { checkDomains } from "../../src/ops/deploy-domains"
import type { HeldRoutes } from "../../src/ops/status"
import {
  ELSEWHERE,
  pointsTo,
  SERVER_ADDRESS,
  standIns,
  type DnsAnswer,
} from "../support/domain-stand-ins"
import { ready } from "../support/helpers"

const ROUTE = (domain: string, service = "web", port = 3000): Route => ({
  domain,
  service,
  port,
})

/** A plan of shop on prod-1, reached over SSH, from a settings file whose web has `domains`. */
async function planOf(domains: string[]) {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(
    join(m.project, "zekno.app.json"),
    JSON.stringify({
      zekno: 1,
      services: {
        web: {
          source: { image: "ghcr.io/acme/shop-web:1.0.0" },
          networking: { port: 3000, domains },
        },
      },
    })
  )
  const planned = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
  const plan: DeployPlan = {
    ...planned,
    server: {
      ...planned.server,
      name: "prod-1",
      target: {
        kind: "ssh",
        destination: "deploy@prod-1",
        runnerPath: "/usr/local/bin/zekno-runner",
      },
    },
  }
  return { m, plan }
}

/** Runs the checks with these routes in force and these answers, and notes what they say. */
async function check(
  plan: DeployPlan,
  m: Awaited<ReturnType<typeof ready>>,
  given: {
    held?: HeldRoutes
    dns?: Record<string, DnsAnswer>
    server?: { v4: string[]; v6: string[] } | undefined
    accepted?: number
  } = {}
) {
  const asked = standIns(m.deps, {
    ...("server" in given ? { server: given.server } : {}),
    dns: given.dns,
  })
  const said: string[] = []
  const result = await checkDomains({
    deps: m.deps,
    plan,
    held: given.held ?? { routes: {}, proxy: "none" },
    accepted: given.accepted ?? 0,
    answersRoutes: true,
    callbacks: {
      warning: (text) => said.push(`warning: ${text}`),
      pointed: (domain, address) => said.push(`pointed: ${domain} ${address}`),
    },
  })
  return { result, said, asked }
}

describe("the DNS check of new domains (CL3, step 5)", () => {
  test("B1 for each, in domain order, once the server's address is known; no warning", async () => {
    const { m, plan } = await planOf(["www.example.com", "shop.example.com"])
    const { result, said, asked } = await check(plan, m)
    expect(said).toEqual([
      `pointed: shop.example.com ${SERVER_ADDRESS}`,
      `pointed: www.example.com ${SERVER_ADDRESS}`,
    ])
    expect(result.newDomains).toEqual(["shop.example.com", "www.example.com"])
    expect(result.routes).toEqual([
      ROUTE("shop.example.com"),
      ROUTE("www.example.com"),
    ])
    expect(asked.ssh).toEqual(["deploy@prod-1"])
    expect(asked.dns.sort()).toEqual(["shop.example.com", "www.example.com"])
  })

  test("B7 with no record, B8 elsewhere: a stop, the first in domain order, said alone", async () => {
    const { m, plan } = await planOf([
      "b.example.com",
      "a.example.com",
      "c.example.com",
    ])
    await expect(
      check(plan, m, {
        dns: { "b.example.com": "none", "c.example.com": pointsTo(ELSEWHERE) },
      })
    ).rejects.toThrow(B7("b.example.com", "A", SERVER_ADDRESS))
    const elsewhere = await planOf(["shop.example.com"])
    await expect(
      check(elsewhere.plan, elsewhere.m, {
        dns: { "shop.example.com": pointsTo(ELSEWHERE) },
      })
    ).rejects.toThrow(
      B8("shop.example.com", ELSEWHERE, "prod-1", "A", SERVER_ADDRESS)
    )
    // An IPv6 server: the record to create is AAAA.
    const six = await planOf(["shop.example.com"])
    await expect(
      check(six.plan, six.m, {
        server: { v4: [], v6: ["2001:db8::7"] },
        dns: { "shop.example.com": "none" },
      })
    ).rejects.toThrow(B7("shop.example.com", "AAAA", "2001:db8::7"))
  })

  test("a stop before signing says nothing of the other domains", async () => {
    const { m, plan } = await planOf(["a.example.com", "b.example.com"])
    const said: string[] = []
    standIns(m.deps, { dns: { "b.example.com": "none" } })
    await expect(
      checkDomains({
        deps: m.deps,
        plan,
        held: { routes: {}, proxy: "none" },
        accepted: 0,
        answersRoutes: true,
        callbacks: {
          warning: (text) => said.push(text),
          pointed: (domain) => said.push(domain),
        },
      })
    ).rejects.toThrow(B7("b.example.com", "A", SERVER_ADDRESS))
    expect(said).toEqual([])
  })

  test("B13 when the server's address is not known: with what the domain points to, or no record; the deploy goes on", async () => {
    const { m, plan } = await planOf(["a.example.com", "b.example.com"])
    const { said, result } = await check(plan, m, {
      server: undefined,
      dns: { "a.example.com": pointsTo(ELSEWHERE), "b.example.com": "none" },
    })
    expect(said).toEqual([
      `warning: ${B13("a.example.com", "prod-1", ELSEWHERE)}`,
      `warning: ${B13("b.example.com", "prod-1")}`,
    ])
    expect(result.newDomains).toEqual(["a.example.com", "b.example.com"])
  })

  test("a lookup that cannot tell: the new warning, and the deploy goes on", async () => {
    const { m, plan } = await planOf(["shop.example.com"])
    const { said } = await check(plan, m, {
      dns: { "shop.example.com": "fails" },
    })
    expect(said).toEqual([`warning: ${LOOKUP_FAILED("shop.example.com")}`])
  })

  test("--skip-dns-check: B14 for each new domain, nothing looked up", async () => {
    const { m, plan } = await planOf(["www.example.com", "shop.example.com"])
    const { said, asked } = await check({ ...plan, skipDnsCheck: true }, m, {
      dns: { "shop.example.com": "none" },
    })
    expect(said).toEqual([
      `warning: ${B14("shop.example.com")}`,
      `warning: ${B14("www.example.com")}`,
    ])
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
  })
})

describe("domains the server holds for the app (CL3, step 6)", () => {
  test("B15 when one moved away, a warning; nothing when it matches, has no record, or the server is not known; not new", async () => {
    const { m, plan } = await planOf([
      "a.example.com",
      "b.example.com",
      "c.example.com",
    ])
    const held: HeldRoutes = {
      routes: {
        shop: [
          ROUTE("a.example.com"),
          ROUTE("b.example.com"),
          ROUTE("c.example.com"),
        ],
      },
      proxy: "running",
    }
    const { said, result } = await check(plan, m, {
      held,
      dns: { "a.example.com": pointsTo(ELSEWHERE), "c.example.com": "none" },
    })
    expect(said).toEqual([
      `warning: ${B15("a.example.com", ELSEWHERE, "prod-1", "shop")}`,
    ])
    expect(result.newDomains).toEqual([])
    const unknown = await check(plan, m, {
      held,
      server: undefined,
      dns: { "a.example.com": pointsTo(ELSEWHERE) },
    })
    expect(unknown.said).toEqual([])
  })

  test("new domains are said first, then those held", async () => {
    const { m, plan } = await planOf(["a.example.com", "z.example.com"])
    const { said } = await check(plan, m, {
      held: { routes: { shop: [ROUTE("a.example.com")] }, proxy: "running" },
      dns: { "a.example.com": pointsTo(ELSEWHERE) },
    })
    expect(said).toEqual([
      `pointed: z.example.com ${SERVER_ADDRESS}`,
      `warning: ${B15("a.example.com", ELSEWHERE, "prod-1", "shop")}`,
    ])
  })
})

describe("B9 and FR-017 (CL3, steps 2 and 3)", () => {
  test("B9: another app holds a domain of the deploy, before any lookup", async () => {
    const { m, plan } = await planOf(["shop.example.com"])
    const asked = standIns(m.deps)
    await expect(
      checkDomains({
        deps: m.deps,
        plan,
        held: {
          routes: { blog: [ROUTE("shop.example.com")] },
          proxy: "running",
        },
        accepted: 0,
        answersRoutes: true,
        callbacks: {},
      })
    ).rejects.toThrow(B9("shop.example.com", "blog", "prod-1"))
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
  })

  test("B11: a route whose service the text to sign lacks, or has without that port", async () => {
    const { m, plan } = await planOf(["shop.example.com"])
    await expect(
      check({ ...plan, routes: [ROUTE("shop.example.com", "web", 8080)] }, m)
    ).rejects.toThrow(B11("web"))
    await expect(
      check({ ...plan, routes: [ROUTE("shop.example.com", "api")] }, m)
    ).rejects.toThrow(B11("api"))
  })

  test("too many domains on the server: R10 is said for too_large", async () => {
    const { m, plan } = await planOf(["shop.example.com"])
    const others = Array.from({ length: 16 }, (_, app) => [
      `app${app}`,
      Array.from({ length: 64 }, (_, n) =>
        ROUTE(`d${n}.app${app}.example.com`)
      ),
    ])
    const { result } = await check(plan, m, {
      held: { routes: Object.fromEntries(others), proxy: "running" },
    })
    expect(result.overDomains).toBe(true)
    expect((await check(plan, m)).result.overDomains).toBe(false)
  })
})

describe("a deploy with neither a route nor a health check (CL7)", () => {
  test("checks nothing, looks nothing up, says nothing", async () => {
    const { m, plan } = await planOf([])
    const { said, asked, result } = await check(plan, m)
    expect({ said, asked, result }).toEqual({
      said: [],
      asked: { ssh: [], dns: [], https: [] },
      result: { routes: [], health: null, newDomains: [], overDomains: false },
    })
  })
})

describe("a rollback (CL3, step 4; FR-019; User Story 6)", () => {
  test("signs the routes in force, not the old deploy's; no DNS check; B12 when what it ran lacks the routed service", async () => {
    const { m, plan } = await planOf([])
    const rollback: DeployPlan = {
      ...plan,
      rollback: true,
      rollbackOf: 41,
      compose:
        'services:\n  web:\n    image: "ghcr.io/acme/shop-web:0.9.0"\n    expose: ["3000"]\n',
    }
    const held: HeldRoutes = {
      routes: { shop: [ROUTE("shop.example.com")] },
      proxy: "running",
    }
    const { result, said, asked } = await check(rollback, m, {
      held,
      dns: { "shop.example.com": "none" },
    })
    expect(result.routes).toEqual([ROUTE("shop.example.com")])
    expect(result.newDomains).toEqual([])
    expect({ said, asked }).toEqual({
      said: [],
      asked: { ssh: [], dns: [], https: [] },
    })
    await expect(
      check(
        {
          ...rollback,
          compose: 'services:\n  worker:\n    image: "ghcr.io/acme/w:1"\n',
        },
        m,
        { held }
      )
    ).rejects.toThrow(B12(41, "web", "shop.example.com"))
  })
})
