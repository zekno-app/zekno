/**
 * The lines of feature 015 (specs/015-domains-https, design/lines.md, parts
 * A to E; tasks T036): each exactly as the maintainer approved it, filled in
 * with lines.md's example values: the app `shop`, its service `web` on port
 * 3000, the server `prod-1` at 203.0.113.7, the domain `shop.example.com`,
 * another app `blog`. A refusal's first sentence fits one line beside its
 * mark; no em dash; the runner is never called an agent.
 */
import { describe, expect, test } from "bun:test"

import * as w from "../../src/domains/words"
import { CS11, CS9 } from "../../src/settings/words"
import { fitsOneLine, keepsTheHabits } from "../support/line-rules"

const D = "shop.example.com"
const WWW = "www.example.com"
const UNTIL = new Date("2027-02-17T23:59:59Z")

describe("A. zekno domain add and zekno domain rm", () => {
  test("A1, A2, A8: the change line", () => {
    expect(w.changeLine("web", [], [D])).toBe(
      "web · domains  none → shop.example.com"
    )
    expect(w.changeLine("web", [D], [D, WWW])).toBe(
      "web · domains  shop.example.com → shop.example.com, www.example.com"
    )
    expect(w.changeLine("web", [D], [])).toBe(
      "web · domains  shop.example.com → none"
    )
  })

  test("A3 and A4 are today's question and result (CS9, CS11)", () => {
    expect(w.A3("zekno.app.json")).toBe(
      "Write this to zekno.app.json? Nothing is deployed until you deploy."
    )
    expect(w.A3("zekno.app.json")).toBe(CS9("zekno.app.json"))
    expect(w.A4).toEqual({
      text: "Written",
      detail: "Run zekno deploy to use it.",
    })
    expect(w.A4).toEqual(CS11)
  })

  test("A5: the record to create, its two lines, and the plain line", () => {
    expect(w.A5.first).toBe(
      "Before you deploy, create this DNS record at your DNS provider:"
    )
    expect(w.A5.record("A", D, "203.0.113.7")).toBe(
      "A  shop.example.com  203.0.113.7"
    )
    expect(w.A5.record("AAAA", D, "2001:db8::7")).toBe(
      "AAAA  shop.example.com  2001:db8::7"
    )
    expect(w.recordPlain("A", D, "203.0.113.7")).toBe(
      "record\tA\tshop.example.com\t203.0.113.7"
    )
  })

  test("A6: the server's public address not known, named or not linked", () => {
    expect(w.A6(D, "prod-1")).toBe(
      "Before you deploy, point shop.example.com at the public address of prod-1 at your DNS provider."
    )
    expect(w.A6(D)).toBe(
      "Before you deploy, point shop.example.com at the public address of your server at your DNS provider."
    )
  })

  test("A7 and A9", () => {
    expect(w.A7(D)).toBe("Which service answers for shop.example.com?")
    expect(w.A9).toEqual({
      text: "Written",
      detail: "Run zekno deploy to release it.",
    })
  })

  test("A10 to A16: the refusals, two sentences each", () => {
    expect(w.A10("*.example.com")).toBe(
      "*.example.com is not a domain zekno can route. Use a full name such as shop.example.com: no wildcard, no address, no port."
    )
    expect(w.A11("bücher.example")).toBe(
      "bücher.example is not a domain zekno can route yet. Names with letters other than a to z, digits and the hyphen are not in this version of zekno."
    )
    expect(w.A12("web")).toBe(
      "web has no port, so a domain cannot reach it. Set the port it listens on first: zekno settings set web.port <port>."
    )
    expect(w.A13(D, "api")).toBe(
      "shop.example.com is already a domain of api. A domain reaches one service. Remove it there first: zekno domain rm shop.example.com."
    )
    expect(w.A14).toBe(
      "This folder deploys a Compose file written by hand. Domains need a settings file. Run zekno settings init to start one."
    )
    expect(w.A15(D)).toBe(
      "shop.example.com is not a domain of this app. Run zekno domain to see its domains."
    )
    expect(w.A16).toBe(
      "There is no terminal to ask on. Say which service with --service <name>."
    )
    expect(w.A10_RULE).toBe(
      "Use a full name such as shop.example.com: no wildcard, no address, no port."
    )
    expect(w.A11_RULE).toBe(
      "Names with letters other than a to z, digits and the hyphen are not in this version of zekno."
    )
    expect(w.A13_FIRST(D, "api")).toBe(
      "shop.example.com is already a domain of api."
    )
  })
})

describe("B. zekno deploy with a domain", () => {
  test("B1 to B6: the lines of a deploy", () => {
    expect(w.B1(D, "prod-1", "203.0.113.7")).toEqual({
      text: "shop.example.com points to prod-1",
      detail: "203.0.113.7",
    })
    expect(w.dnsPlain(D, "203.0.113.7")).toBe(
      "dns\tshop.example.com\t203.0.113.7"
    )
    expect(w.B2_LABEL).toBe("domains")
    expect(w.PANEL_DOMAINS).toBe(3)
    expect(w.B3(5)).toBe("and 5 more")
    expect(w.B4(D)).toBe("Waiting for the certificate of shop.example.com")
    expect(w.B5(D, UNTIL)).toEqual({
      text: "https://shop.example.com is live",
      detail: "certificate until 17 Feb 2027",
    })
    expect(w.httpsLivePlain(D, UNTIL)).toBe(
      "https\tshop.example.com\tlive\t2027-02-17"
    )
    expect(w.B6(D)).toBe(
      "The certificate for shop.example.com is not ready yet. Run `zekno domain` to see when it is."
    )
    expect(w.httpsWaitingPlain(D)).toBe("https\tshop.example.com\twaiting")
  })

  test("B7 to B12: the stops before signing", () => {
    expect(w.B7(D, "A", "203.0.113.7")).toBe(
      "shop.example.com has no DNS record yet. Create an A record for shop.example.com with the value 203.0.113.7, then run `zekno deploy` again. Nothing was signed."
    )
    expect(w.B8(D, "198.51.100.9", "prod-1", "A", "203.0.113.7")).toBe(
      "shop.example.com points to 198.51.100.9, not to prod-1. Change its A record to 203.0.113.7, then run `zekno deploy` again. If something of yours stands in front of prod-1, deploy with `--skip-dns-check`. Nothing was signed."
    )
    expect(w.B9(D, "blog", "prod-1")).toBe(
      "shop.example.com belongs to blog on prod-1. Release it there first: run `zekno domain rm shop.example.com` in blog's folder and deploy blog. Nothing was signed."
    )
    expect(w.B10("prod-1", "0.1.0")).toBe(
      "The runner on prod-1 is version 0.1.0, too old for domains and health checks. Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed."
    )
    // A runner run one request at a time reports no version: the same sentence without it.
    expect(w.B10("prod-1")).toBe(
      "The runner on prod-1 is too old for domains and health checks. Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed."
    )
    expect(w.B11("web")).toBe(
      "web has a domain and no port. Set the port it listens on with `zekno settings set web.port <port>`. Nothing was signed."
    )
    expect(w.B12(41, "web", D)).toBe(
      "What deploy 41 ran has no service named web, which shop.example.com reaches. Remove the domain first, or roll back to a deploy that has web. Nothing was signed."
    )
  })

  test("B13 to B15 and the failed lookup: warnings, the deploy goes on", () => {
    expect(w.B13(D, "prod-1", "203.0.113.7")).toBe(
      "zekno cannot tell whether shop.example.com points to prod-1, because this machine reaches prod-1 at an address that is not public. It points to 203.0.113.7."
    )
    expect(w.B13(D, "prod-1")).toBe(
      "zekno cannot tell whether shop.example.com points to prod-1, because this machine reaches prod-1 at an address that is not public. It has no DNS record yet."
    )
    expect(w.B14(D)).toBe("DNS was not checked for shop.example.com.")
    expect(w.B15(D, "198.51.100.9", "prod-1", "shop")).toBe(
      "shop.example.com points to 198.51.100.9, no longer to prod-1. Visitors are not reaching shop there, and its certificate cannot be renewed."
    )
    expect(w.LOOKUP_FAILED(D)).toBe(
      "zekno could not look up shop.example.com from this machine. The deploy goes on."
    )
  })

  test("B16 to B19: after the deploy was accepted", () => {
    expect(w.B16("shop", "prod-1", 80)).toBe(
      "shop is running, but prod-1 cannot answer for its domains: port 80 is in use by another program. Free ports 80 and 443 on prod-1, then run `zekno deploy` again."
    )
    expect(w.B17(D, "web")).toBe(
      "shop.example.com cannot reach web: no container of web is running. Run `zekno logs` to see why."
    )
    expect(w.B18(D, "web")).toBe(
      "shop.example.com cannot reach web: web uses the host's network, which zekno cannot route to. Give web a network of its own, then run `zekno deploy` again."
    )
    expect(w.B19("shop", "prod-1")).toBe(
      "shop is running, but prod-1 did not take its new domains, so it answers for the ones it had. Run `zekno doctor` to see why."
    )
  })

  test("R9 and R10: the runner's own refusals, no backticks", () => {
    expect(w.R9).toBe(
      "A domain of this deploy belongs to another app on that server. Nothing of it ran. Run zekno domain to see which."
    )
    expect(w.R10).toBe(
      "That server would hold more domains than a runner keeps. Nothing of this deploy ran. Remove a domain from an app there first."
    )
  })
})

describe("C. A health check", () => {
  test("C1 and C2", () => {
    expect(w.C1_STAGE).toBe("Healthy")
    expect(w.C2("web", "/health")).toBe("waiting for web to answer GET /health")
  })

  test("C3 and C4: not healthy in time", () => {
    expect(w.C3("web", "/health", 60, "shop")).toBe(
      "web did not answer GET /health with success within 60 seconds. shop is running as deployed, and nothing was rolled back. Run `zekno logs` to see why, or `zekno rollback` to go back."
    )
    expect(w.C4("web", 60, "shop")).toBe(
      "web did not stay up within 60 seconds. shop is running as deployed, and nothing was rolled back. Run `zekno logs` to see why, or `zekno rollback` to go back."
    )
  })

  test("C5 and C6: the row in zekno settings", () => {
    expect(w.HEALTH_LABEL).toBe("health")
    expect(w.healthShown("/health", 60)).toBe("GET /health, within 60s")
    expect(w.healthShown(undefined, 60)).toBe("stays up, within 60s")
    expect(w.HEALTH_NOT_SET).toBe("not set")
    expect(w.HEALTH_SECONDS).toBe(60)
  })
})

describe("D. zekno domain", () => {
  test("D1 to D9: each state, its mark and its detail", () => {
    expect(w.D1(UNTIL)).toEqual({
      state: "live",
      detail: "certificate until 17 Feb 2027",
    })
    expect(w.D2(new Date("2026-11-21T12:00:00Z"))).toEqual({
      state: "live",
      detail: "certificate ends 21 Nov, renewal is failing",
    })
    expect(w.D3("prod-1")).toEqual({
      state: "no certificate yet",
      detail: "prod-1 is asking for one",
    })
    expect(w.D4("A", "203.0.113.7")).toEqual({
      state: "no DNS record",
      detail: "create an A record with the value 203.0.113.7",
    })
    expect(w.D5("198.51.100.9", "prod-1")).toEqual({
      state: "DNS points elsewhere",
      detail: "198.51.100.9, not prod-1",
    })
    expect(w.D6("prod-1")).toEqual({
      state: "not answering",
      detail: "nothing answers on port 443 of prod-1",
    })
    expect(w.D7).toEqual({ state: "not deployed", detail: "run zekno deploy" })
    expect(w.D8).toEqual({
      state: "to be released",
      detail: "removed from the file, run zekno deploy",
    })
    expect(w.D9("blog")).toEqual({
      state: "belongs to blog",
      detail: "release it there first",
    })
    expect(w.STATE_MARKS).toEqual({
      live: { mark: "●", tone: "success" },
      renewing: { mark: "●", tone: "warning" },
      waiting: { mark: "●", tone: "warning" },
      "no-dns": { mark: "●", tone: "danger" },
      "dns-elsewhere": { mark: "●", tone: "danger" },
      down: { mark: "●", tone: "danger" },
      "not-deployed": { mark: "○", tone: "quiet" },
      releasing: { mark: "○", tone: "quiet" },
      taken: { mark: "✖", tone: "danger" },
    })
  })

  test("D10: no domain at all", () => {
    expect(w.D10("shop")).toBe(
      "shop has no domain. Add one with zekno domain add <domain>."
    )
  })
})

describe("E. Where else domains show", () => {
  test("E1, E6: the domains row's label and `none`", () => {
    expect(w.DOMAINS_LABEL).toBe("domains")
    expect(w.domainsShown([])).toBe("none")
    expect(w.domainsShown([D])).toBe("shop.example.com")
  })

  test("E2, plain too", () => {
    expect(w.E2("shop", D)).toBe("shop  https://shop.example.com")
    expect(w.domainPlain("shop", D)).toBe("domain\tshop\tshop.example.com")
  })

  test("E3 to E5, and the other image in E4's pattern", () => {
    expect(w.PROXY_LABEL).toBe("Proxy")
    expect(w.E3(2)).toBe("answers for 2 domains")
    expect(w.E3(1)).toBe("answers for 1 domain")
    expect(w.E4).toEqual({
      detail: "not running",
      next: "Deploy an app with a domain to start it again",
    })
    expect(w.E5("prod-1")).toEqual({
      detail: "port 80 is in use by another program",
      next: "Free ports 80 and 443 on prod-1",
    })
    expect(w.OTHER_IMAGE).toEqual({
      detail: "an older version",
      next: "Deploy an app with a domain to replace it",
    })
    expect(w.E7_TITLE).toBe("Domains")
    // The box's foot, as the board `DomainsApp` draws it, a line each.
    expect(w.E7_NOTE).toEqual([
      "Checked from this machine.",
      "e settings to change them.",
    ])
  })
})

describe("the habits of every line", () => {
  const refusals = [
    w.A10("*.example.com"),
    w.A11("bücher.example"),
    w.A12("web"),
    w.A13(D, "api"),
    w.A14,
    w.A15(D),
    w.A16,
    w.B7(D, "A", "203.0.113.7"),
    w.B8(D, "198.51.100.9", "prod-1", "A", "203.0.113.7"),
    w.B9(D, "blog", "prod-1"),
    w.B10("prod-1", "0.1.0"),
    w.B11("web"),
    w.B12(41, "web", D),
    w.B16("shop", "prod-1", 80),
    w.B19("shop", "prod-1"),
    w.C3("web", "/health", 60, "shop"),
    w.C4("web", 60, "shop"),
    w.R9,
    w.R10,
  ]

  test("each refusal's first sentence fits one line beside its mark", () => {
    for (const refusal of refusals) fitsOneLine(refusal)
  })

  test("no em dash, and the runner is never called an agent", () => {
    for (const line of [
      ...refusals,
      w.A5.first,
      w.A6(D, "prod-1"),
      w.B6(D),
      w.B13(D, "prod-1"),
      w.B15(D, "198.51.100.9", "prod-1", "shop"),
      w.LOOKUP_FAILED(D),
    ])
      keepsTheHabits(line)
  })
})
