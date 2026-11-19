/**
 * The two settings of specs/015-domains-https (contracts/cli.md, CL1; tasks
 * T037, T040): `networking.domains` and `deploy.healthcheck` in the settings
 * file, read by the strict reader with every rule of CL1, written back in
 * zekno's form and read back the same (write.ts, `FIELDS`), and printed piped.
 * The words of the rules not on a board follow feature 010's (SV15, SV20,
 * SV21, SV32) and reuse A10's, A11's and A13's.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError } from "../../src/cli/errors"
import { faultSentence, readSettingsFile } from "../../src/settings/file"
import { pipedLines } from "../../src/settings/piped"
import { checkSettings, isSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type {
  ServiceSettings,
  Settings,
  SettingsFault,
} from "../../src/settings/types"
import { writeSettings } from "../../src/settings/write"
import { lineOf, SENTINEL } from "../support/settings-files"

const FILE = "zekno.app.json"
const IMAGE = "ghcr.io/acme/web:1.4.2"
const S = SENTINEL

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
/** A file of `web` with `sections`, and `more` services after it. */
const web = (
  sections: Record<string, unknown>,
  more: Record<string, unknown> = {}
): string =>
  json({
    zekno: 1,
    services: { web: { source: { image: IMAGE }, ...sections }, ...more },
  })
const settingsOf = (
  service: Partial<ServiceSettings>,
  more: [string, ServiceSettings][] = []
): Settings => ({
  version: 1,
  services: [["web", { image: IMAGE, ...service }], ...more],
})
const said = (text: string): string => {
  const read = checkSettings(text, FILE)
  if (isSettings(read)) throw new Error("the file was read")
  return faultSentence(read as SettingsFault, FILE)
}
const form = (rule: string): string =>
  `${FILE} could not be read as settings. ${rule}`
const domains = (count: number, prefix = "d"): string[] =>
  Array.from({ length: count }, (_, at) => `${prefix}${at}.example.com`)

describe("the file gives the two settings (CL1)", () => {
  test("domains under a service with a port, in the file's order", () => {
    expect(
      checkSettings(
        web({
          networking: {
            port: 3000,
            domains: ["www.example.com", "shop.example.com"],
          },
        }),
        FILE
      )
    ).toEqual(
      settingsOf({
        port: 3000,
        domains: ["www.example.com", "shop.example.com"],
      })
    )
  })

  test("an empty list is no domain", () => {
    expect(
      checkSettings(web({ networking: { port: 3000, domains: [] } }), FILE)
    ).toEqual(settingsOf({ port: 3000 }))
  })

  test("64 domains, the most", () => {
    const list = domains(64)
    expect(
      checkSettings(web({ networking: { port: 1, domains: list } }), FILE)
    ).toEqual(settingsOf({ port: 1, domains: list }))
  })

  test("a health check: a path and a limit, either, or neither", () => {
    expect(
      checkSettings(
        web({
          deploy: { healthcheck: { path: "/health?full=1", timeout: 1800 } },
          networking: { port: 3000 },
        }),
        FILE
      )
    ).toEqual(
      settingsOf({
        health: { path: "/health?full=1", timeout: 1800 },
        port: 3000,
      })
    )
    expect(
      checkSettings(web({ deploy: { healthcheck: { timeout: 1 } } }), FILE)
    ).toEqual(settingsOf({ health: { timeout: 1 } }))
    // `{}`: it stays up, within 60s. No port is needed without a path.
    expect(checkSettings(web({ deploy: { healthcheck: {} } }), FILE)).toEqual(
      settingsOf({ health: {} })
    )
  })
})

describe("every rule of CL1, each with its sentence", () => {
  test("SV34: domains that are not a list of names", () => {
    const rule =
      'web, networking.domains: use a list of names, such as ["shop.example.com"].'
    expect(said(web({ networking: { port: 1, domains: S } }))).toBe(form(rule))
    expect(said(web({ networking: { port: 1, domains: [1] } }))).toBe(
      form(rule)
    )
  })

  test("SV35: a name the domain rule refuses, A10's rule, with its line; one with letters outside ASCII, A11's", () => {
    for (const bad of [
      `*.${S}.com`,
      "203.0.113.7",
      "localhost",
      "Shop.example.com",
      "shop.example.com.",
      "shop.test",
    ]) {
      const text = web({
        networking: { port: 1, domains: ["a.example.com", bad] },
      })
      expect(said(text)).toBe(
        form(
          `web, networking.domains: use a full name such as shop.example.com: no wildcard, no address, no port (line ${lineOf(text, bad)}).`
        )
      )
    }
    for (const bad of ["bücher.example", "xn--bcher-kva.example"]) {
      const text = web({ networking: { port: 1, domains: [bad] } })
      expect(said(text)).toBe(
        form(
          `web, networking.domains: names with letters other than a to z, digits and the hyphen are not in this version of zekno (line ${lineOf(text, bad)}).`
        )
      )
    }
  })

  test("SV36: a domain twice under one service", () => {
    const text = web({
      networking: {
        port: 1,
        domains: ["a.example.com", "b.example.com", "a.example.com"],
      },
    })
    const second = text.indexOf(
      '"a.example.com"',
      text.indexOf("b.example.com")
    )
    expect(said(text)).toBe(
      form(
        `web, networking.domains: a name is there twice (line ${lineOf(text, '"a.example.com"', second)}).`
      )
    )
  })

  test("SV37: 65 domains under one service", () => {
    expect(said(web({ networking: { port: 1, domains: domains(65) } }))).toBe(
      form("web, networking.domains: at most 64 names.")
    )
  })

  test("SV38: a domain under a service with no port (A12's rule, as SV15 says it)", () => {
    expect(said(web({ networking: { domains: ["shop.example.com"] } }))).toBe(
      form(
        "web, networking.domains: set networking.port too, the port it reaches."
      )
    )
  })

  test("SV39: one domain under two services (A13's first sentence)", () => {
    const text = web(
      { networking: { port: 3000, domains: ["shop.example.com"] } },
      {
        api: {
          source: { image: IMAGE },
          networking: { port: 8080, domains: ["shop.example.com"] },
        },
      }
    )
    expect(said(text)).toBe(
      form(
        "api, networking.domains: shop.example.com is already a domain of web."
      )
    )
  })

  test("SV40: more than 64 domains across the services", () => {
    const text = web(
      { networking: { port: 3000, domains: domains(33, "a") } },
      {
        api: {
          source: { image: IMAGE },
          networking: { port: 8080, domains: domains(32, "b") },
        },
      }
    )
    expect(said(text)).toBe(
      form(
        "services: they name more than 64 domains, more than one deploy carries."
      )
    )
  })

  test("SV41: a health check that is not an object, or holds a key it does not know", () => {
    const rule =
      'web, deploy.healthcheck: use an object such as { "path": "/health", "timeout": 60 }; either may be left out.'
    expect(said(web({ deploy: { healthcheck: "/health" } }))).toBe(form(rule))
    expect(said(web({ deploy: { healthcheck: { [S]: 1 } } }))).toBe(form(rule))
    expect(said(web({ deploy: { healthcheck: [] } }))).toBe(form(rule))
  })

  test("SV42: a path the path rule refuses", () => {
    for (const path of ["health", "/a b", "/a#b", `/${"a".repeat(1024)}`, 1])
      expect(
        said(
          web({
            deploy: { healthcheck: { path } },
            networking: { port: 1 },
          })
        )
      ).toBe(
        form(
          "web, deploy.healthcheck.path: use a path such as /health: no space and no #, at most 1024 characters."
        )
      )
  })

  test("SV43: a limit that is not 1 to 1800 whole seconds", () => {
    for (const timeout of [0, 1801, 1.5, -1, "60"])
      expect(said(web({ deploy: { healthcheck: { timeout } } }))).toBe(
        form(
          "web, deploy.healthcheck.timeout: use a whole number of seconds from 1 to 1800."
        )
      )
    expect(
      said(
        `{"zekno":1,"services":{"web":{"source":{"image":"${IMAGE}"},"deploy":{"healthcheck":{"timeout":6e1}}}}}`
      )
    ).toBe(
      form(
        "web, deploy.healthcheck.timeout: use a whole number of seconds from 1 to 1800."
      )
    )
  })

  test("SV44: a health path under a service with no port", () => {
    expect(said(web({ deploy: { healthcheck: { path: "/health" } } }))).toBe(
      form(
        "web, deploy.healthcheck.path: set networking.port too, the port it reaches."
      )
    )
  })

  test("SV45: more than 16 health checks, more than one deploy carries", () => {
    const more = Object.fromEntries(
      Array.from({ length: 16 }, (_, at) => [
        `s${at}`,
        { source: { image: IMAGE }, deploy: { healthcheck: {} } },
      ])
    )
    expect(said(web({ deploy: { healthcheck: {} } }, more))).toBe(
      form(
        "services: they have more than 16 health checks, more than one deploy carries."
      )
    )
    // Sixteen are fine.
    expect(isSettings(checkSettings(web({}, more), FILE))).toBe(true)
  })
})

describe("written in zekno's form and read back the same (T040)", () => {
  const BOTH = settingsOf(
    {
      cpus: "1",
      health: { path: "/health", timeout: 120 },
      port: 3000,
      publish: 8080,
      domains: ["shop.example.com", "www.example.com"],
      secrets: ["DATABASE_URL"],
    },
    [["worker", { image: IMAGE, health: {} }]]
  )

  test("healthcheck after cpus, domains after publish, `{}` for a health check with neither", () => {
    expect(settingsText(BOTH)).toBe(`{
  "zekno": 1,
  "services": {
    "web": {
      "source": { "image": "ghcr.io/acme/web:1.4.2" },
      "deploy": {
        "cpus": 1,
        "healthcheck": { "path": "/health", "timeout": 120 }
      },
      "networking": {
        "port": 3000,
        "publish": 8080,
        "domains": ["shop.example.com", "www.example.com"]
      },
      "variables": { "secrets": ["DATABASE_URL"] }
    },
    "worker": {
      "source": { "image": "ghcr.io/acme/web:1.4.2" },
      "deploy": { "healthcheck": {} }
    }
  }
}
`)
    expect(checkSettings(settingsText(BOTH), FILE)).toEqual(BOTH)
  })

  test("the example of CL1 is read and written back byte for byte", () => {
    const text = `{
  "zekno": 1,
  "services": {
    "web": {
      "source": { "image": "ghcr.io/acme/web:1.4.2" },
      "deploy": { "healthcheck": { "path": "/health", "timeout": 60 } },
      "networking": { "port": 3000, "domains": ["shop.example.com"] }
    }
  }
}
`
    const read = checkSettings(text, FILE) as Settings
    expect(read).toEqual(
      settingsOf({
        health: { path: "/health", timeout: 60 },
        port: 3000,
        domains: ["shop.example.com"],
      })
    )
    expect(settingsText(read)).toBe(text)
  })

  test("FIELDS: a write that dropped the health check or the domains is refused (CS14), and the file is as it was", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-routes-write-"))
    const text = settingsText(BOTH)
    writeFileSync(join(folder, FILE), text)
    const read = readSettingsFile({ kind: "default", folder }, folder)
    for (const drop of [
      (settings: Settings): Settings => ({
        version: 1,
        services: settings.services.map(([name, { health: _, ...rest }]) => [
          name,
          rest,
        ]),
      }),
      (settings: Settings): Settings => ({
        version: 1,
        services: settings.services.map(([name, { domains: _, ...rest }]) => [
          name,
          rest,
        ]),
      }),
    ]) {
      let error: unknown
      try {
        writeSettings(read, BOTH, {
          text: (settings) => settingsText(drop(settings)),
        })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(CliError)
      expect((error as Error).message).toBe(`Could not write ${FILE}.`)
      expect(readFileSync(join(folder, FILE), "utf8")).toBe(text)
    }
  })
})

describe("piped (CL1): the two settings for services that set them, and nothing for those that do not", () => {
  test("a path and a limit each a line, domains joined with `,`; `{}` for a health check with neither", () => {
    expect(
      pipedLines(
        settingsOf(
          {
            health: { path: "/health", timeout: 120 },
            port: 3000,
            domains: ["shop.example.com", "www.example.com"],
          },
          [
            ["worker", { image: IMAGE, health: {} }],
            ["db", { image: IMAGE }],
          ]
        )
      )
    ).toEqual([
      ["web", "source.image", IMAGE],
      ["web", "deploy.healthcheck.path", "/health"],
      ["web", "deploy.healthcheck.timeout", "120"],
      ["web", "networking.port", "3000"],
      ["web", "networking.domains", "shop.example.com,www.example.com"],
      ["worker", "source.image", IMAGE],
      ["worker", "deploy.healthcheck", "{}"],
      ["db", "source.image", IMAGE],
    ])
  })
})
