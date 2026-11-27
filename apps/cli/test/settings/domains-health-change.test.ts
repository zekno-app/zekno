/**
 * `zekno settings set` and `unset` of the two settings of
 * specs/015-domains-https (contracts/cli.md, CL1; research R14, R31; tasks
 * T039, T041): the keys `<service>.domains`, `<service>.health` and
 * `<service>.health-timeout`, what each change shows and makes, what is
 * refused and with which status; and the rows `zekno settings` prints, `health` under
 * Deploy after `cpus` (C5, C6) and `domains` under Networking, one a row
 * (E1), marked against what the last deploy signed (R30).
 */
import { describe, expect, test } from "bun:test"

import { withRoutes } from "../../src/domains/routes"
import { A10, A11 } from "../../src/domains/words"
import { applyChange, parseSettingPath } from "../../src/settings/change"
import { domainRows, healthRow, reportOf } from "../../src/settings/rows"
import type {
  ServiceSettings,
  SettingPath,
  SettingRow,
  Settings,
} from "../../src/settings/types"
import { CS16, CS17, CS5, CS8 } from "../../src/settings/words"

const IMAGE = "ghcr.io/acme/web:1.4.2"
const settingsOf = (
  web: Partial<ServiceSettings>,
  more: [string, ServiceSettings][] = []
): Settings => ({
  version: 1,
  services: [["web", { image: IMAGE, ...web }], ...more],
})
const WEB = settingsOf({ port: 3000 })
const path = (key: SettingPath["key"]): SettingPath =>
  ({ service: "web", key }) as SettingPath
const changed = (
  settings: Settings,
  key: SettingPath["key"],
  value: string | undefined
) => {
  const got = applyChange(settings, path(key), value)
  if ("refused" in got) throw new Error(got.refused)
  return got
}
const refused = (
  settings: Settings,
  key: SettingPath["key"],
  value: string | undefined
) => {
  const got = applyChange(settings, path(key), value)
  return "refused" in got ? got : { changed: got }
}

describe("the keys (CL1)", () => {
  test("domains, health and health-timeout, with their places in the file", () => {
    for (const [typed, key] of [
      ["web.domains", "domains"],
      ["web.networking.domains", "domains"],
      ["web.health", "health"],
      ["web.healthcheck", "health"],
      ["web.deploy.healthcheck", "health"],
      ["web.health-timeout", "health-timeout"],
      ["web.deploy.healthcheck.timeout", "health-timeout"],
    ] as const)
      expect(parseSettingPath(typed)).toEqual({ service: "web", key })
    // specs/016-build-from-source, CL1: no such setting is G18, thrown with its line (plan item 21 (a)).
    expect(() => parseSettingPath("web.health.path")).toThrow("G18")
    expect(CS5).toContain("health, health-timeout")
    expect(CS5).toContain("domains")
  })
})

describe("domains: the whole list, comma-separated, lowered (CL1, R31)", () => {
  test("set: the change line's words and the settings made", () => {
    const first = changed(WEB, "domains", "Shop.Example.com")
    expect([first.label, first.now, first.next]).toEqual([
      "domains",
      "none",
      "shop.example.com",
    ])
    expect(first.settings.services[0]![1].domains).toEqual(["shop.example.com"])
    const second = changed(
      first.settings,
      "domains",
      "shop.example.com,  www.example.com "
    )
    expect([second.now, second.next]).toEqual([
      "shop.example.com",
      "shop.example.com, www.example.com",
    ])
  })

  test("the same list is CS8, status 0; unset removes it, and unset of none is CS16", () => {
    const set = settingsOf({ port: 3000, domains: ["shop.example.com"] })
    expect(refused(set, "domains", "shop.example.com")).toEqual({
      refused: CS8("web", "domains", "shop.example.com"),
      status: 0,
    })
    const unset = changed(set, "domains", undefined)
    expect([unset.now, unset.next]).toEqual(["shop.example.com", "none"])
    expect(unset.settings.services[0]![1]).not.toHaveProperty("domains")
    expect(refused(WEB, "domains", undefined)).toEqual({
      refused: CS16("web", "domains"),
      status: 0,
    })
  })

  test("a name refused is A10 or A11, naming it lowered, status 2; an empty name is the key's words", () => {
    expect(refused(WEB, "domains", "shop.example.com, *.EXAMPLE.com")).toEqual({
      refused: A10("*.example.com"),
      status: 2,
    })
    expect(refused(WEB, "domains", "bücher.example")).toEqual({
      refused: A11("bücher.example"),
      status: 2,
    })
    expect(refused(WEB, "domains", "shop.example.com,")).toEqual({
      refused:
        "That is not a list of domains zekno can route. Use a full name such as shop.example.com: no wildcard, no address, no port.",
      status: 2,
    })
  })

  test("the rules across services: no port, another service's, CS17, status 2", () => {
    expect(refused(settingsOf({}), "domains", "shop.example.com")).toEqual({
      refused: CS17(
        "web, networking.domains",
        "set networking.port too, the port it reaches."
      ),
      status: 2,
    })
    const two = settingsOf({ port: 3000 }, [
      ["api", { image: IMAGE, port: 8080, domains: ["shop.example.com"] }],
    ])
    expect(refused(two, "domains", "shop.example.com")).toEqual({
      refused: CS17(
        "api, networking.domains",
        "shop.example.com is already a domain of web."
      ),
      status: 2,
    })
  })
})

describe("health and health-timeout (CL1, R14)", () => {
  test("set a path, then `up`: the limit is kept; the change line reads as the row", () => {
    const path = changed(WEB, "health", "/health")
    expect([path.label, path.now, path.next]).toEqual([
      "health",
      "not set",
      "GET /health, within 60s",
    ])
    const limit = changed(path.settings, "health-timeout", "120")
    expect([limit.label, limit.now, limit.next]).toEqual([
      "health",
      "GET /health, within 60s",
      "GET /health, within 120s",
    ])
    const up = changed(limit.settings, "health", "up")
    expect(up.next).toBe("stays up, within 120s")
    expect(up.settings.services[0]![1].health).toEqual({ timeout: 120 })
  })

  test("`up` on a service with no port; a path needs a port (CS17)", () => {
    expect(
      changed(settingsOf({}), "health", "up").settings.services[0]![1].health
    ).toEqual({})
    expect(refused(settingsOf({}), "health", "/health")).toEqual({
      refused: CS17(
        "web, deploy.healthcheck.path",
        "set networking.port too, the port it reaches."
      ),
      status: 2,
    })
  })

  test("a value its rule refuses: CS7, status 2", () => {
    expect(refused(WEB, "health", "health")).toEqual({
      refused:
        "That is not a health check. Use a path such as /health, or up to wait until the service stays up.",
      status: 2,
    })
    const set = settingsOf({ port: 3000, health: {} })
    for (const value of ["0", "1801", "1.5", "a"])
      expect(refused(set, "health-timeout", value)).toEqual({
        refused:
          "That is not a time limit. Use a whole number of seconds from 1 to 1800.",
        status: 2,
      })
  })

  test("the same value is CS8, status 0: the same path, `up` for none, 60 for a limit left out", () => {
    const set = settingsOf({ port: 3000, health: { path: "/health" } })
    expect(refused(set, "health", "/health")).toEqual({
      refused: CS8("web", "health", "GET /health, within 60s"),
      status: 0,
    })
    expect(refused(set, "health-timeout", "60")).toEqual({
      refused: CS8("web", "health", "GET /health, within 60s"),
      status: 0,
    })
    expect(refused(settingsOf({ health: {} }), "health", "up")).toEqual({
      refused: CS8("web", "health", "stays up, within 60s"),
      status: 0,
    })
  })

  test("unset health removes it with its limit; unset health-timeout keeps the path, and of a limit left out is CS8", () => {
    const set = settingsOf({ port: 3000, health: { path: "/h", timeout: 90 } })
    expect(
      changed(set, "health", undefined).settings.services[0]![1]
    ).not.toHaveProperty("health")
    expect(
      changed(set, "health-timeout", undefined).settings.services[0]![1].health
    ).toEqual({ path: "/h" })
    expect(
      refused(
        settingsOf({ port: 3000, health: { path: "/h" } }),
        "health-timeout",
        undefined
      )
    ).toEqual({
      refused: CS8("web", "health", "GET /h, within 60s"),
      status: 0,
    })
  })

  test("health-timeout on a service with no health check: CS16 naming health, refused (status 2); its unset, status 0", () => {
    expect(refused(WEB, "health-timeout", "120")).toEqual({
      refused: CS16("web", "health"),
      status: 2,
    })
    expect(CS16("web", "health")).toBe(
      "web · health is not set. Nothing was written."
    )
    expect(refused(WEB, "health-timeout", undefined)).toEqual({
      refused: CS16("web", "health"),
      status: 0,
    })
  })
})

/** Rows as `section label shown`, with ` !` and the old value when marked, ` removed` and what it was. */
const lines = (rows: readonly SettingRow[]): string[] =>
  rows.map(
    (row) =>
      `${row.section} ${row.label} ${row.shown}${row.set ? "" : " (not set)"}${
        row.changed === undefined
          ? ""
          : row.changed.was === undefined
            ? " !"
            : ` ! was ${row.changed.was}`
      }${row.removed === undefined ? "" : ` removed ${row.removed.was}`}`
  )

describe("the rows of zekno settings (C5, C6, E1; T041)", () => {
  const FILE = settingsOf(
    {
      cpus: "1",
      health: { path: "/health" },
      port: 3000,
      domains: ["shop.example.com", "www.example.com"],
    },
    [["worker", { image: IMAGE, health: { timeout: 90 } }]]
  )

  test("health after cpus, the domains after the port, one a row; nothing for a service that sets neither", () => {
    const report = reportOf(FILE)
    expect(lines(report.services[0]!.rows)).toEqual([
      `Source image ${IMAGE}`,
      "Deploy cpus 1",
      "Deploy health GET /health, within 60s",
      "Networking port 3000, not published",
      "Networking domains shop.example.com",
      "Networking  www.example.com",
    ])
    expect(lines(report.services[1]!.rows)).toEqual([
      `Source image ${IMAGE}`,
      "Deploy health stays up, within 90s",
    ])
    expect(lines(reportOf(settingsOf({})).services[0]!.rows)).toEqual([
      `Source image ${IMAGE}`,
    ])
  })

  test("against the deploy that signed the same: nothing marked, whatever the order of the domains", () => {
    const deployed = withRoutes(
      settingsOf({ cpus: "1", port: 3000 }, [["worker", { image: IMAGE }]]),
      [
        { domain: "shop.example.com", service: "web", port: 3000 },
        { domain: "www.example.com", service: "web", port: 3000 },
      ],
      {
        timeout: 90,
        services: [
          { service: "web", http: { port: 3000, path: "/health" } },
          { service: "worker", http: null },
        ],
      }
    )
    const report = reportOf(FILE, deployed)
    for (const service of report.services)
      for (const row of service.rows) expect(row.changed).toBeUndefined()
  })

  test("a domain added, a domain removed, a path changed: marked, with what the deploy had", () => {
    const deployed = withRoutes(
      settingsOf({ cpus: "1", port: 3000 }),
      [
        { domain: "old.example.com", service: "web", port: 3000 },
        { domain: "shop.example.com", service: "web", port: 3000 },
      ],
      {
        timeout: 60,
        services: [{ service: "web", http: { port: 3000, path: "/up" } }],
      }
    )
    const report = reportOf(FILE, deployed)
    expect(lines(report.services[0]!.rows)).toEqual([
      `Source image ${IMAGE}`,
      "Deploy cpus 1",
      "Deploy health GET /health, within 60s ! was GET /up, within 60s",
      "Networking port 3000, not published",
      "Networking domains shop.example.com",
      "Networking  www.example.com !",
      "Networking  none (not set) removed old.example.com",
    ])
  })

  test("the deploy's one limit: a service's own marks it only when the limit the next deploy signs changes", () => {
    const deployed = withRoutes(settingsOf({ port: 3000 }), [], {
      timeout: 60,
      services: [{ service: "web", http: { port: 3000, path: "/health" } }],
    })
    const at = (timeout: number) =>
      healthRow(
        [
          "web",
          { image: IMAGE, port: 3000, health: { path: "/health", timeout } },
        ],
        deployed,
        timeout
      )
    expect(at(60).changed).toBeUndefined()
    expect(at(120).changed).toEqual({ was: "GET /health, within 60s" })
  })

  test("no domain: a `none` row for the screen when asked, else none; removed rows labelled on the first", () => {
    expect(
      lines(domainRows(["web", { image: IMAGE }], undefined, true))
    ).toEqual(["Networking domains none (not set)"])
    expect(domainRows(["web", { image: IMAGE }], undefined, false)).toEqual([])
    const deployed = withRoutes(
      settingsOf({ port: 3000 }),
      [
        { domain: "a.example.com", service: "web", port: 3000 },
        { domain: "b.example.com", service: "web", port: 3000 },
      ],
      null
    )
    expect(
      lines(domainRows(["web", { image: IMAGE, port: 3000 }], deployed, false))
    ).toEqual([
      "Networking domains none (not set) removed a.example.com",
      "Networking  none (not set) removed b.example.com",
    ])
  })
})
