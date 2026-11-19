/**
 * Feature 015's lines of `zekno domain`, `zekno doctor` and `zekno domain
 * add` at a terminal, in colour, against the approved boards
 * (specs/015-domains-https, design/lines.md, parts A, D and E; boards
 * `DomainsList`, `DomainsAdd`; task T075): the cells and lines as the
 * commands build them, drawn as a terminal that shows every colour receives
 * them, and read back as runs in one look.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { domainLines } from "../../../src/commands/domain"
import { D1, D5, D7, D9, E3, E4 } from "../../../src/domains/words"
import { proxyLine } from "../../../src/ops/doctor-proxy"
import { drawnInColour, wordRuns } from "../../support/colour"
import {
  bold,
  dim,
  line,
  look,
  plain,
  runsAt,
  SRC,
  textOf,
} from "./domains-colour"

describe("zekno domain (board DomainsList)", () => {
  const ROWS = [
    {
      domain: "shop.example.com",
      service: "web",
      port: 3000,
      state: "live" as const,
      words: D1(new Date("2027-02-17T12:00:00Z")),
    },
    {
      domain: "www.example.com",
      service: "web",
      port: 3000,
      state: "dns-elsewhere" as const,
      words: D5("198.51.100.9", "prod-1"),
    },
    {
      domain: "new.example.com",
      service: "web",
      port: 3000,
      state: "not-deployed" as const,
      words: D7,
    },
    {
      domain: "blog.example.com",
      service: "web",
      port: 3000,
      state: "taken" as const,
      words: D9("blog"),
    },
  ]

  test("the name, service:port dim, the state after its mark in its tone, the detail dim; not deployed dim from service:port on", () => {
    const drawn = domainLines(ROWS).map(({ cells }) =>
      line({ kind: "line", cells })
    )
    expect(drawn.map((each) => textOf(each)[0])).toEqual([
      "shop.example.com  web:3000  ● live                  certificate until 17 Feb 2027",
      "www.example.com   web:3000  ● DNS points elsewhere  198.51.100.9, not prod-1",
      "new.example.com   web:3000  ○ not deployed          run zekno deploy",
      "blog.example.com  web:3000  ✖ belongs to blog       release it there first",
    ])
    expect(drawn.map((each) => wordRuns(each.split("\n")[0]!))).toEqual([
      [
        plain("shop.example.com"),
        dim("web:3000"),
        look("● live", { color: "green" }),
        dim("certificate until 17 Feb 2027"),
      ],
      [
        plain("www.example.com"),
        dim("web:3000"),
        look("● DNS points elsewhere", { color: "red" }),
        dim("198.51.100.9, not prod-1"),
      ],
      [
        plain("new.example.com"),
        dim("web:3000"),
        dim("○ not deployed"),
        dim("run zekno deploy"),
      ],
      [
        plain("blog.example.com"),
        dim("web:3000"),
        look("✖ belongs to blog", { color: "red" }),
        dim("release it there first"),
      ],
    ])
  })

  test("zekno doctor's Proxy line: E3 after a green ✔; E4 after a red ✖, what to do dim under it", () => {
    const report = (held: Parameters<typeof proxyLine>[0]) =>
      drawnInColour(
        join(SRC, "ui/ink/doctor-report.tsx"),
        "DoctorBlock",
        {
          report: {
            zekno: "0.1.1",
            runner: "0.1.1",
            latest: { state: "not_checked" },
            machine: [],
            servers: [
              {
                name: "prod-1",
                where: "deploy@203.0.113.7",
                checks: [proxyLine(held)],
              },
            ],
            serversSkipped: false,
            problems: 0,
            warnings: 0,
          },
          columns: 100,
        },
        100
      )
    const routes = {
      shop: [
        { domain: "shop.example.com", service: "web", port: 3000 },
        { domain: "www.example.com", service: "web", port: 3000 },
      ],
    }
    const running = report({ routes, proxy: "running" })
    expect(textOf(running)).toContain(`✔ Proxy          ${E3(2)}`)
    expect(runsAt(running, "Proxy")).toEqual([
      look("✔", { color: "green" }),
      plain(`Proxy          ${E3(2)}`),
    ])
    const stopped = report({ routes, proxy: "stopped" })
    expect(textOf(stopped)).toContain(`✖ Proxy          ${E4.detail}`)
    expect(runsAt(stopped, "Proxy")[0]).toEqual(look("✖", { color: "red" }))
    expect(runsAt(stopped, E4.next)).toEqual([dim(E4.next)])
  })
})

describe("zekno domain add (board DomainsAdd)", () => {
  test("the change line: the service and the label dim, the old list, → dim, the new one bold", () => {
    const drawn = drawnInColour(
      join(SRC, "ui/ink/settings-report.tsx"),
      "ChangeLine",
      {
        change: {
          service: "web",
          label: "domains",
          now: "none",
          next: "shop.example.com",
        },
        columns: 100,
      },
      100
    )
    expect(textOf(drawn)).toEqual(["  web · domains  none → shop.example.com"])
    expect(wordRuns(drawn.split("\n")[0]!)).toEqual([
      dim("web · domains"),
      plain("none"),
      dim("→"),
      bold("shop.example.com"),
    ])
  })
})
