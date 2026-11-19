/**
 * Seeing an app's domains and whether they work, end to end
 * (specs/015-domains-https, contracts/cli.md, CL4 and CL6; User Story 3;
 * tasks T061 to T064, T066): `zekno domain` with every state the runner and
 * the stand-in effects can give, with no terminal, with `--json` and at a
 * terminal; a server not asked; `zekno status` with the routes in force; and
 * `zekno doctor`'s Proxy line. shop on prod-1 over the stand-in SSH, with
 * this repository's runner and the stand-in Docker.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { A14, D10, E3, E4, OTHER_IMAGE } from "../../src/domains/words"
import { NOT_LINKED_HERE } from "../../src/domains/words-extra"
import { sshUnreachable } from "../../src/server/session"
import {
  shopFile,
  shopOnProd,
  type ShopOnProd,
} from "../support/domain-folders"
import {
  ELSEWHERE,
  LAST_DAY,
  pointsTo,
  standIns,
} from "../support/domain-stand-ins"
import { terminal } from "../support/terminal"

const fileWith = (...domains: string[]) => shopFile({ networking: { domains } })

/**
 * blog, another app of prod-1, deployed from a folder of its own with
 * `blog.example.com`; this machine's folder is shop's again after it.
 */
async function blogHolds(s: ShopOnProd, domain: string): Promise<void> {
  const shop = s.m.deps.cwd
  const folder = mkdtempSync(join(tmpdir(), "zekno-blog-"))
  writeFileSync(
    join(folder, "zekno.app.json"),
    JSON.stringify({
      zekno: 1,
      services: {
        web: {
          source: { image: "ghcr.io/acme/blog:1.0.0" },
          networking: { port: 3000, domains: [domain] },
        },
      },
    })
  )
  s.m.docker.app("blog", { web: 1 })
  s.m.deps.cwd = folder
  try {
    expect(await s.zekno("deploy", "--app", "blog", "--server", "prod-1")).toBe(
      0
    )
  } finally {
    s.m.deps.cwd = shop
  }
}

describe("zekno domain (CL4)", () => {
  test("every state the server and this machine give, one line a domain in domain order, plain and --json; exit 0", async () => {
    const s = await shopOnProd(
      fileWith("shop.example.com", "www.example.com", "old.example.com")
    )
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    await blogHolds(s, "blog.example.com")
    // After the deploy: one domain taken out of the file, one put in, another app's named.
    s.file(
      fileWith(
        "shop.example.com",
        "www.example.com",
        "new.example.com",
        "blog.example.com"
      )
    )
    s.clear()
    const asked = standIns(s.m.deps, {
      dns: { "www.example.com": pointsTo(ELSEWHERE) },
    })
    expect(await s.zekno("domain")).toBe(0)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: [
        "blog.example.com\tweb\t3000\ttaken\t",
        "new.example.com\tweb\t3000\tnot-deployed\t",
        "old.example.com\tweb\t3000\treleasing\t",
        "shop.example.com\tweb\t3000\tlive\t2027-02-17",
        "www.example.com\tweb\t3000\tdns-elsewhere\t",
      ],
      err: [],
    })
    // Only the domains the server holds for shop and the file still has are looked up.
    expect(asked.dns.sort()).toEqual(["shop.example.com", "www.example.com"])
    expect(asked.https.sort()).toEqual(["shop.example.com", "www.example.com"])
    s.clear()
    expect(await s.zekno("domain", "--json")).toBe(0)
    expect(JSON.parse(s.m.out[0]!)).toEqual([
      {
        domain: "blog.example.com",
        service: "web",
        port: 3000,
        state: "taken",
        until: null,
      },
      {
        domain: "new.example.com",
        service: "web",
        port: 3000,
        state: "not-deployed",
        until: null,
      },
      {
        domain: "old.example.com",
        service: "web",
        port: 3000,
        state: "releasing",
        until: null,
      },
      {
        domain: "shop.example.com",
        service: "web",
        port: 3000,
        state: "live",
        until: "2027-02-17",
      },
      {
        domain: "www.example.com",
        service: "web",
        port: 3000,
        state: "dns-elsewhere",
        until: null,
      },
    ])
    expect(s.m.out).toHaveLength(1)

    // At a terminal: the app and the server, then the rows, lined up, with the words of lines.md.
    const t = terminal(100)
    s.m.deps.ui = t.ui
    expect(await s.zekno("domain")).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "  shop on prod-1",
      "blog.example.com  web:3000  ✖ belongs to blog       release it there first",
      "new.example.com   web:3000  ○ not deployed          run zekno deploy",
      "old.example.com   web:3000  ○ to be released        removed from the file, run zekno deploy",
      "shop.example.com  web:3000  ● live                  certificate until 17 Feb 2027",
      "www.example.com   web:3000  ● DNS points elsewhere  198.51.100.9, not prod-1",
    ])
    expect(LAST_DAY).toStartWith("2027-02-17")
  }, 60_000)

  test("no domain: D10 at a terminal, nothing with no terminal, [] with --json", async () => {
    const s = await shopOnProd(shopFile())
    standIns(s.m.deps)
    expect(await s.zekno("domain")).toBe(0)
    expect({ out: s.m.out, err: s.m.err }).toEqual({ out: [], err: [] })
    expect(await s.zekno("domain", "--json")).toBe(0)
    expect(s.m.out).toEqual(["[]"])
    const t = terminal(100)
    s.m.deps.ui = t.ui
    expect(await s.zekno("domain")).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([`  ${D10("shop")}`])
  }, 60_000)

  test("a server that cannot be reached: the file's rows as not deployed, `prod-1 was not asked`, its warning above them; exit 0", async () => {
    const s = await shopOnProd(fileWith("shop.example.com"))
    const asked = standIns(s.m.deps)
    s.ssh.down()
    expect(await s.zekno("domain")).toBe(0)
    expect({ out: s.m.out, err: s.m.err }).toEqual({
      out: ["shop.example.com\tweb\t3000\tnot-deployed\t"],
      err: [sshUnreachable("prod-1", "deploy@prod-1")],
    })
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    const t = terminal(100)
    s.m.deps.ui = t.ui
    expect(await s.zekno("domain")).toBe(0)
    await t.ui.close()
    expect(t.lines().at(-1)).toBe(
      "shop.example.com  web:3000  ○ not deployed  prod-1 was not asked"
    )
  }, 60_000)

  test("a folder with a Compose file written by hand is A14; one not linked is said so; no option of a deploy's", async () => {
    const s = await shopOnProd(fileWith("shop.example.com"))
    const hand = mkdtempSync(join(tmpdir(), "zekno-hand-"))
    writeFileSync(
      join(hand, "compose.yaml"),
      "services:\n  web:\n    image: example/web:1\n"
    )
    s.m.deps.cwd = hand
    expect(await s.zekno("domain")).toBe(2)
    expect(s.m.err).toEqual([A14])
    s.clear()
    const loose = mkdtempSync(join(tmpdir(), "zekno-loose-"))
    writeFileSync(join(loose, "zekno.app.json"), fileWith("shop.example.com"))
    s.m.deps.cwd = loose
    expect(await s.zekno("domain")).toBe(1)
    expect(s.m.err).toEqual([NOT_LINKED_HERE])
    s.clear()
    expect(await s.zekno("domain", "--app", "shop")).toBe(2)
    expect(s.m.err).toEqual([
      "`zekno domain` does not take `--app`.\nRun `zekno --help` for the list of commands.",
    ])
  }, 60_000)
})

describe("zekno status with the routes in force (CL6, E2)", () => {
  test("a line a domain after the app's line, plain and at a terminal; --json carries the runner's routes", async () => {
    const s = await shopOnProd(fileWith("www.example.com", "shop.example.com"))
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    s.clear()
    expect(await s.zekno("status")).toBe(0)
    expect(s.m.out.slice(1)).toEqual([
      "shop\tdeploy 1\tstopped",
      "domain\tshop\tshop.example.com",
      "domain\tshop\twww.example.com",
    ])
    s.clear()
    expect(await s.zekno("status", "--json")).toBe(0)
    expect(JSON.parse(s.m.out[0]!).routes).toEqual({
      shop: [
        { domain: "shop.example.com", service: "web", port: 3000 },
        { domain: "www.example.com", service: "web", port: 3000 },
      ],
    })
    const t = terminal(100)
    s.m.deps.ui = t.ui
    expect(await s.zekno("status")).toBe(0)
    await t.ui.close()
    expect(t.lines().slice(-3)).toEqual([
      "shop  deploy 1  ● stopped",
      "shop  https://shop.example.com",
      "shop  https://www.example.com",
    ])
  }, 60_000)
})

describe("zekno doctor's Proxy line (CL6; E3, E4)", () => {
  test("none for a server with no route; E3 with the number of domains; another image a warning; not running E4", async () => {
    const s = await shopOnProd(fileWith("shop.example.com", "www.example.com"))
    standIns(s.m.deps)
    const proxyLines = async () => {
      s.clear()
      await s.zekno("doctor")
      return s.m.out.filter((line) => line.startsWith("prod-1\tproxy\t"))
    }
    expect(await proxyLines()).toEqual([])
    expect(await s.zekno("deploy")).toBe(0)
    expect(await proxyLines()).toEqual([`prod-1\tproxy\tgood\t${E3(2)}`])
    s.m.docker.change("zekno-proxy", { image: "caddy:2.10.0" })
    const older = OTHER_IMAGE("prod-1")
    expect(await proxyLines()).toEqual([
      `prod-1\tproxy\twarning\t${older.detail}\t${older.next}`,
    ])
  }, 60_000)

  test("a proxy that is not running is E4, a problem", async () => {
    const s = await shopOnProd(fileWith("shop.example.com"))
    standIns(s.m.deps)
    expect(await s.zekno("deploy")).toBe(0)
    s.m.docker.change("zekno-proxy", { running: false })
    s.clear()
    expect(await s.zekno("doctor")).toBe(1)
    expect(
      s.m.out.filter((line) => line.startsWith("prod-1\tproxy\t"))
    ).toEqual([`prod-1\tproxy\tproblem\t${E4.detail}\t${E4.next}`])
  }, 60_000)
})
