/**
 * Removing a domain, moving it to another app, and a rollback that keeps the
 * domains, end to end (specs/015-domains-https, contracts/cli.md, CL3; User
 * Stories 4 and 6; tasks T060, T066): shop on prod-1 over the stand-in SSH,
 * with this repository's runner and the stand-in Docker, and the stand-in
 * effects.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import runnerPackage from "../../../runner/package.json"
import { B10, B12, B9, R9 } from "../../src/domains/words"
import { entriesOf, historyOf } from "../support/deploys"
import {
  shopFile,
  shopOnProd,
  type ShopOnProd,
} from "../support/domain-folders"
import { standIns } from "../support/domain-stand-ins"
import { wire } from "../support/wire"

const SHOP = "shop.example.com"
const ROUTE = { domain: SHOP, service: "web", port: 3000 }
const fileWith = (...domains: string[]) => shopFile({ networking: { domains } })

/** The routes in force on prod-1, as `zekno status --json` gives them. */
async function inForce(s: ShopOnProd): Promise<unknown> {
  s.clear()
  expect(await s.zekno("status", "--json")).toBe(0)
  return JSON.parse(s.m.out[0]!).routes
}

/** blog, deployed to prod-1 from a folder of its own, with `domains`. */
async function deployBlog(s: ShopOnProd, ...domains: string[]) {
  const shop = s.m.deps.cwd
  const folder = mkdtempSync(join(tmpdir(), "zekno-blog-"))
  writeFileSync(
    join(folder, "zekno.app.json"),
    JSON.stringify({
      zekno: 1,
      services: {
        web: {
          source: { image: "ghcr.io/acme/blog:1.0.0" },
          networking: { port: 3000, ...(domains.length ? { domains } : {}) },
        },
      },
    })
  )
  s.m.docker.app("blog", { web: 1 })
  s.m.deps.cwd = folder
  try {
    return await s.zekno("deploy", "--app", "blog", "--server", "prod-1")
  } finally {
    s.m.deps.cwd = shop
  }
}

describe("User Story 4: removing a domain, and moving it", () => {
  test("zekno domain rm, then deploy: the route is signed away and released; nothing is looked up or waited for", async () => {
    const s = await shopOnProd(fileWith(SHOP))
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    expect(await inForce(s)).toEqual({ shop: [ROUTE] })
    expect(await s.zekno("domain", "rm", SHOP, "--yes")).toBe(0)
    s.clear()
    const asked = standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    expect(s.m.err).toEqual([])
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    expect((await entriesOf(s.m, "shop")).at(-1)?.deploy.routes).toEqual([])
    expect(await inForce(s)).toBeUndefined()
  }, 60_000)

  test("a domain another app holds: B9 before anything is signed; once released there, the second app takes it", async () => {
    const s = await shopOnProd(fileWith(SHOP))
    standIns(s.m.deps)
    expect(await deployBlog(s, SHOP)).toBe(0)
    s.clear()
    const w = wire(s.m.deps)
    expect(await s.zekno("deploy")).toBe(1)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: [],
      err: [B9(SHOP, "blog", "prod-1")],
    })
    expect(historyOf(s.m, "shop")).toEqual([])
    expect(w.requests("deploy")).toEqual([])
    // Moving it is two deploys: release it from blog, then claim it with shop.
    expect(await deployBlog(s)).toBe(0)
    expect(await s.zekno("deploy")).toBe(0)
    expect(await inForce(s)).toEqual({ shop: [ROUTE] })
  }, 60_000)

  test("taken between the check and the deploy: the runner's domain_taken is R9, the number unused", async () => {
    const s = await shopOnProd(fileWith(SHOP))
    standIns(s.m.deps)
    expect(await deployBlog(s, SHOP)).toBe(0)
    s.clear()
    const w = wire(s.m.deps)
    // `status` says no app holds it, as it would have a moment before blog's deploy.
    w.rewrite("status", (answer) => ({ ...answer, routes: {} }))
    expect(await s.zekno("deploy")).toBe(1)
    expect(s.m.err).toEqual([R9])
    expect(historyOf(s.m, "shop")).toEqual([])
  }, 60_000)
})

describe("User Story 6: a rollback keeps the domains (FR-019)", () => {
  test("a domain added in deploy 2 stays in force when shop rolls back to what deploy 1 ran; so does deploy 2's health check", async () => {
    const s = await shopOnProd(shopFile())
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    s.file(
      shopFile({
        networking: { domains: [SHOP] },
        deploy: { healthcheck: { path: "/health" } },
      })
    )
    expect(await s.zekno("deploy")).toBe(0)
    const second = (await entriesOf(s.m, "shop")).at(-1)!.deploy
    s.clear()
    const asked = standIns(s.m.deps)
    const w = wire(s.m.deps)
    expect(await s.zekno("rollback", "--to", "1")).toBe(0)
    const rolled = (await entriesOf(s.m, "shop")).at(-1)!.deploy
    expect(rolled.sequence).toBe(3)
    expect(rolled.compose).toBe(
      (await entriesOf(s.m, "shop"))[0]!.deploy.compose
    )
    expect(rolled.routes).toEqual([ROUTE])
    expect(rolled.health).toEqual(second.health)
    // No DNS check and no wait: the domain was the app's already. `status` was asked as before, then with the routes.
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    expect(w.requests("status").map((request) => request.input)).toEqual([
      undefined,
      { routes: true },
    ])
    expect(await inForce(s)).toEqual({ shop: [ROUTE] })
  }, 60_000)

  test("a runner that says it is too old for routes, for an app this machine deployed with a domain: B10, nothing signed (review S4)", async () => {
    const s = await shopOnProd(shopFile())
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    s.file(fileWith(SHOP))
    expect(await s.zekno("deploy")).toBe(0)
    s.clear()
    // The server answers as an older runner would: a rollback must not sign the app's domains away on its word.
    const w = wire(s.m.deps)
    w.rewrite("version", (answer) => ({ ...answer, protocol: 3 }))
    expect(await s.zekno("rollback", "--to", "1")).toBe(1)
    expect(s.m.err).toEqual([B10("prod-1", runnerPackage.version)])
    expect(w.requests("deploy")).toEqual([])
    expect((await entriesOf(s.m, "shop")).length).toBe(2)
    w.restore()
    expect(await inForce(s)).toEqual({ shop: [ROUTE] })
  }, 60_000)

  test("what the old deploy ran has no service a domain reaches: B12, nothing signed", async () => {
    const s = await shopOnProd(
      JSON.stringify({
        zekno: 1,
        services: {
          worker: { source: { image: "ghcr.io/acme/shop-worker:1.0.0" } },
        },
      })
    )
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    s.file(fileWith(SHOP))
    expect(await s.zekno("deploy")).toBe(0)
    s.clear()
    expect(await s.zekno("rollback", "--to", "1")).toBe(1)
    expect(s.m.err).toEqual([B12(1, "web", SHOP)])
    expect((await entriesOf(s.m, "shop")).length).toBe(2)
  }, 60_000)
})

describe("an app with neither a route nor a health check (CL7; tasks T067)", () => {
  test("a deploy and a rollback make no lookup, no ssh -G, no TLS connection, ask status as before, and say what they said before", async () => {
    const s = await shopOnProd(shopFile())
    const asked = standIns(s.m.deps)
    const w = wire(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    expect(await s.zekno("deploy")).toBe(0)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: [
        "Deploy 1 of shop is running on prod-1 with no secrets.",
        "Deploy 2 of shop is running on prod-1 with no secrets.",
      ],
      err: [],
    })
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    expect(w.requests("status").map((request) => request.input)).toEqual([
      undefined,
      undefined,
    ])
    // A rollback of it too: this machine signed the deploy in force, with no route, so it asks as before.
    expect(await s.zekno("rollback")).toBe(0)
    expect(s.m.err).toEqual([])
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    expect(w.requests("status").map((request) => request.input)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    // Nothing of feature 015 is signed: no route, no health check.
    for (const entry of await entriesOf(s.m, "shop")) {
      expect(entry?.deploy.routes).toEqual([])
      expect(entry?.deploy.health).toBeNull()
    }
  }, 60_000)
})
