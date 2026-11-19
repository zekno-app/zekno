/**
 * `zekno domain add` and `zekno domain rm` through `run`, piped and at a
 * terminal (specs/015-domains-https, contracts/cli.md, CL2; design/lines.md,
 * part A; board `DomainsAdd`; tasks T046). They follow `zekno settings set`:
 * no team, no keychain, no connection, nothing deployed. The server's address
 * comes from a stand-in for `sshHost`; nothing runs `ssh`.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { A10, A11, A12, A13, A14, A15, A16 } from "../../src/domains/words"
import { checkSettings } from "../../src/settings/schema"
import type { Settings } from "../../src/settings/types"
import { CS10, SH1 } from "../../src/settings/words"
import { COMPOSE_V1, machine, ready } from "../support/helpers"
import { shows, terminal } from "../support/terminal"

type Machine = ReturnType<typeof machine>

const IMAGE = "ghcr.io/acme/web:1.4.2"
const QUESTION =
  "? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)"
const HELP_LINE = "Run `zekno --help` for the list of commands."

const fileText = (services: Record<string, object>): string =>
  JSON.stringify({
    zekno: 1,
    services: Object.fromEntries(
      Object.entries(services).map(([name, sections]) => [
        name,
        { source: { image: IMAGE }, ...sections },
      ])
    ),
  })

/** A folder with a settings file, where the keychain and a connection fail the test. */
function here(services: Record<string, object>): Machine {
  const m = machine()
  writeFileSync(join(m.project, "zekno.app.json"), fileText(services))
  const no = (what: string) => () => {
    throw new Error(what)
  }
  m.deps.keyStore = {
    get: no("the keychain was read"),
    set: no("the keychain was written"),
    delete: no("the keychain was written"),
  }
  m.deps.connect = no("a connection was made")
  return m
}

const settingsOf = (m: Machine): Settings =>
  checkSettings(
    readFileSync(join(m.project, "zekno.app.json"), "utf8"),
    "zekno.app.json"
  ) as Settings
const domainsOf = (m: Machine, service = "web") =>
  settingsOf(m).services.find(([name]) => name === service)?.[1].domains

/** The plain run: its status and what it wrote on each stream. */
async function piped(m: Machine, ...args: string[]) {
  m.out.length = 0
  m.err.length = 0
  const code = await m.zekno(...args)
  return { code, out: [...m.out], err: [...m.err] }
}

/** A machine whose folder is linked to `shop` on dev, reached over SSH as `deploy@prod-1`, with a stand-in for `ssh -G`. */
async function linked(addresses: { v4: string[]; v6: string[] } | undefined) {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(
    join(m.project, "zekno.app.json"),
    fileText({ web: { networking: { port: 3000 } } })
  )
  expect(await m.zekno("link", "--app", "shop", "--server", "dev")).toBe(0)
  m.tamper("profile.json", (profile) => ({
    ...profile,
    servers: profile.servers.map((server: object) => ({
      ...server,
      target: {
        kind: "ssh",
        destination: "deploy@prod-1",
        runnerPath: "~/.zekno/bin/zekno-runner",
      },
    })),
  }))
  m.deps.sshHost = async () => addresses
  return m
}

describe("zekno domain add, piped (CL2)", () => {
  test("the change line and the result as zekno settings set prints them; the domain lowered; nothing for A6", async () => {
    const m = here({ web: { networking: { port: 3000 } } })
    expect(
      await piped(m, "domain", "add", "Shop.Example.com", "--yes")
    ).toEqual({
      code: 0,
      out: [
        "web · domains  none → shop.example.com",
        "Written  Run zekno deploy to use it.",
      ],
      err: [],
    })
    expect(domainsOf(m)).toEqual(["shop.example.com"])
    expect(
      (await piped(m, "domain", "add", "www.example.com", "--yes")).out[0]
    ).toBe(
      "web · domains  shop.example.com → shop.example.com, www.example.com"
    )
    expect(domainsOf(m)).toEqual(["shop.example.com", "www.example.com"])
  })

  test("A5 as record<TAB>A<TAB>domain<TAB>address, when the server's public address is known", async () => {
    const m = await linked({ v4: ["203.0.113.7"], v6: [] })
    expect(
      await piped(m, "domain", "add", "shop.example.com", "--yes")
    ).toEqual({
      code: 0,
      out: [
        "web · domains  none → shop.example.com",
        "Written  Run zekno deploy to use it.",
        "record\tA\tshop.example.com\t203.0.113.7",
      ],
      err: [],
    })
    const v6 = await linked({ v4: [], v6: ["2001:db8::7"] })
    expect(
      (await piped(v6, "domain", "add", "shop.example.com", "--yes")).out.at(-1)
    ).toBe("record\tAAAA\tshop.example.com\t2001:db8::7")
  }, 60_000)

  test("--json: one object, the change and the record when known", async () => {
    const m = await linked({ v4: ["203.0.113.7"], v6: [] })
    const run = await piped(
      m,
      "domain",
      "add",
      "shop.example.com",
      "--yes",
      "--json"
    )
    expect(run.code).toBe(0)
    expect(run.out.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        service: "web",
        domains: { now: [], next: ["shop.example.com"] },
        record: { type: "A", name: "shop.example.com", value: "203.0.113.7" },
      },
    ])
    const unknown = here({ web: { networking: { port: 3000 } } })
    expect(
      await piped(unknown, "domain", "add", "a.example.com", "--yes", "--json")
    ).toEqual({
      code: 0,
      out: [
        JSON.stringify({
          service: "web",
          domains: { now: [], next: ["a.example.com"] },
        }),
      ],
      err: [],
    })
  }, 60_000)

  test("no --yes with no terminal: CS10, status 1, nothing written", async () => {
    const m = here({ web: { networking: { port: 3000 } } })
    const before = readFileSync(join(m.project, "zekno.app.json"), "utf8")
    expect(await piped(m, "domain", "add", "shop.example.com")).toEqual({
      code: 1,
      out: ["web · domains  none → shop.example.com"],
      err: [CS10("zekno.app.json")],
    })
    expect(readFileSync(join(m.project, "zekno.app.json"), "utf8")).toBe(before)
  })

  test("--service among several with a port; with neither --service nor a terminal, A16, status 2", async () => {
    const m = here({
      web: { networking: { port: 3000 } },
      api: { networking: { port: 8080 } },
    })
    expect(await piped(m, "domain", "add", "api.example.com", "--yes")).toEqual(
      { code: 2, out: [], err: [A16] }
    )
    expect(
      (
        await piped(
          m,
          "domain",
          "add",
          "api.example.com",
          "--service",
          "api",
          "--yes"
        )
      ).code
    ).toBe(0)
    expect(domainsOf(m, "api")).toEqual(["api.example.com"])
  })

  test("the refusals, before anything is shown: status 2, no help line, the file untouched", async () => {
    const m = here({
      web: { networking: { port: 3000 } },
      api: { networking: { port: 8080, domains: ["shop.example.com"] } },
      worker: {},
    })
    const before = readFileSync(join(m.project, "zekno.app.json"), "utf8")
    for (const [argv, said] of [
      [["domain", "add", "*.example.com", "--yes"], A10("*.example.com")],
      [["domain", "add", "bücher.example", "--yes"], A11("bücher.example")],
      [
        ["domain", "add", "w.example.com", "--service", "worker", "--yes"],
        A12("worker"),
      ],
      [
        ["domain", "add", "shop.example.com", "--service", "web", "--yes"],
        A13("shop.example.com", "api"),
      ],
      [["domain", "rm", "www.example.com", "--yes"], A15("www.example.com")],
    ] as const)
      expect(await piped(m, ...argv)).toEqual({
        code: 2,
        out: [],
        err: [said],
      })
    expect(readFileSync(join(m.project, "zekno.app.json"), "utf8")).toBe(before)
  })

  test("A14 for a folder that deploys a Compose file written by hand; SH1 with no file", async () => {
    const compose = machine()
    compose.compose(COMPOSE_V1)
    expect(
      await piped(compose, "domain", "add", "shop.example.com", "--yes")
    ).toEqual({ code: 2, out: [], err: [A14] })
    expect(await piped(machine(), "domain", "rm", "a.example.com")).toEqual({
      code: 1,
      out: [],
      err: [SH1],
    })
  })

  test("no domain: the usage line, status 2; an option the command does not take, as for zekno settings set", async () => {
    const m = here({ web: { networking: { port: 3000 } } })
    expect(await piped(m, "domain", "add")).toEqual({
      code: 2,
      out: [],
      err: [`Say which domain: \`zekno domain add <domain>\`.\n${HELP_LINE}`],
    })
    expect(
      await piped(m, "domain", "rm", "a.example.com", "--service", "web")
    ).toEqual({
      code: 2,
      out: [],
      err: [`\`zekno domain rm\` does not take \`--service\`.\n${HELP_LINE}`],
    })
    expect(
      await piped(m, "domain", "add", "a.example.com", "--app", "x")
    ).toEqual({
      code: 2,
      out: [],
      err: [`\`zekno domain add\` does not take \`--app\`.\n${HELP_LINE}`],
    })
    expect(
      await piped(m, "domain", "add", "a.example.com", "b.example.com")
    ).toEqual({
      code: 2,
      out: [],
      err: [
        `Unexpected "b.example.com" after \`zekno domain add\`.\n${HELP_LINE}`,
      ],
    })
  })

  test("--service is another command's option: zekno deploy and zekno settings set fail on it as on any unknown option", async () => {
    const unknown = `Unknown option '--service'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--service"\n${HELP_LINE}`
    for (const argv of [
      ["deploy", "--service", "web"],
      ["settings", "set", "web.port", "1", "--service", "web"],
      ["add", "postgres", "--service", "web"],
    ]) {
      const m = machine()
      expect(await piped(m, ...argv)).toEqual({
        code: 2,
        out: [],
        err: [unknown],
      })
    }
  })
})

describe("zekno domain rm, piped (CL2)", () => {
  test("A8 and A9: the change line, and `Run zekno deploy to release it.`; the last domain leaves no domains key", async () => {
    const m = here({
      web: { networking: { port: 3000, domains: ["shop.example.com"] } },
    })
    expect(await piped(m, "domain", "rm", "SHOP.example.com", "--yes")).toEqual(
      {
        code: 0,
        out: [
          "web · domains  shop.example.com → none",
          "Written  Run zekno deploy to release it.",
        ],
        err: [],
      }
    )
    expect(
      readFileSync(join(m.project, "zekno.app.json"), "utf8")
    ).not.toContain("domains")
  })
})

describe("zekno settings with the two settings (CL1; C5, C6, E1)", () => {
  const FILE = {
    web: {
      deploy: { cpus: 1, healthcheck: { path: "/health" } },
      networking: {
        port: 3000,
        domains: ["shop.example.com", "www.example.com"],
      },
    },
    worker: { deploy: { healthcheck: {} } },
    db: {},
  }

  test("piped and --json: the two settings for services that set them, nothing for those that do not", async () => {
    const m = here(FILE)
    expect(await piped(m, "settings")).toEqual({
      code: 0,
      out: [
        `web\tsource.image\t${IMAGE}`,
        "web\tdeploy.cpus\t1",
        "web\tdeploy.healthcheck.path\t/health",
        "web\tnetworking.port\t3000",
        "web\tnetworking.domains\tshop.example.com,www.example.com",
        `worker\tsource.image\t${IMAGE}`,
        "worker\tdeploy.healthcheck\t{}",
        `db\tsource.image\t${IMAGE}`,
      ],
      err: [],
    })
    const json = await piped(m, "settings", "--json")
    expect(JSON.parse(json.out[0]!)).toEqual({
      zekno: 1,
      services: {
        web: {
          source: { image: IMAGE },
          deploy: { cpus: 1, healthcheck: { path: "/health" } },
          networking: {
            port: 3000,
            domains: ["shop.example.com", "www.example.com"],
          },
        },
        worker: { source: { image: IMAGE }, deploy: { healthcheck: {} } },
        db: { source: { image: IMAGE } },
      },
    })
  })

  test("at a terminal: health under Deploy after cpus, the domains under Networking, one a row", async () => {
    const m = here(FILE)
    const t = terminal(100, 40)
    m.deps.ui = t.ui
    expect(await m.zekno("settings")).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "  zekno.app.json",
      "  web",
      `  Source        image     ${IMAGE}`,
      "  Deploy        cpus      1",
      "                health    GET /health, within 60s",
      "  Networking    port      3000, not published",
      "                domains   shop.example.com",
      "                          www.example.com",
      "  worker",
      `  Source        image     ${IMAGE}`,
      "  Deploy        health    stays up, within 60s",
      "  db",
      `  Source        image     ${IMAGE}`,
    ])
  })
})

describe("at a terminal (board DomainsAdd)", () => {
  test("the first domain, answered y: the change line, the question, Written, then the record (A1, A3, A4, A5)", async () => {
    const m = await linked({ v4: ["203.0.113.7"], v6: [] })
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const adding = m.zekno("domain", "add", "shop.example.com")
    await shows(t, QUESTION)
    t.keys("y")
    expect(await adding).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "  web · domains  none → shop.example.com",
      `${QUESTION} yes`,
      "✔ Written  Run zekno deploy to use it.",
      "  Before you deploy, create this DNS record at your DNS provider:",
      "  A  shop.example.com  203.0.113.7",
    ])
    // An empty line before the record, as the board draws it.
    const screen = t.screen()
    const written = screen.indexOf("✔ Written  Run zekno deploy to use it.")
    expect(screen[written + 1]).toBe("")
  }, 60_000)

  test("several services: A7 asks which, among those with a port; A6 when the address is not known", async () => {
    const m = here({
      web: { networking: { port: 3000 } },
      worker: {},
      api: { networking: { port: 8080 } },
    })
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const adding = m.zekno("domain", "add", "www.example.com")
    await shows(t, "? Which service answers for www.example.com?")
    expect(t.lines().some((line) => line.includes("worker"))).toBe(false)
    t.keys("\r")
    await shows(t, QUESTION)
    t.keys("y")
    expect(await adding).toBe(0)
    await t.ui.close()
    // A6 is wider than the 98 columns beside its indent: it wraps under itself.
    expect(t.lines()).toEqual([
      "✔ Service  web",
      "  web · domains  none → www.example.com",
      `${QUESTION} yes`,
      "✔ Written  Run zekno deploy to use it.",
      "  Before you deploy, point www.example.com at the public address of your server at your DNS",
      "  provider.",
    ])
    expect(domainsOf(m)).toEqual(["www.example.com"])
  })

  test("rm answered y: A8 and A9, no record", async () => {
    const m = here({
      web: { networking: { port: 3000, domains: ["shop.example.com"] } },
    })
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const removing = m.zekno("domain", "rm", "shop.example.com")
    await shows(t, QUESTION)
    t.keys("y")
    expect(await removing).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "  web · domains  shop.example.com → none",
      `${QUESTION} yes`,
      "✔ Written  Run zekno deploy to release it.",
    ])
  })

  test("a refusal: its first sentence after ✖, the second under it", async () => {
    const m = here({ web: {} })
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    expect(await m.zekno("domain", "add", "shop.example.com")).toBe(2)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "✖ web has no port, so a domain cannot reach it.",
      "  Set the port it listens on first: zekno settings set web.port <port>.",
    ])
  })
})
