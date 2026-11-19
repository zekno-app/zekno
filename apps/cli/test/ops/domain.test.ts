/**
 * What `zekno domain add` and `rm` do, before anything is drawn
 * (specs/015-domains-https, contracts/cli.md, CL2 and CL5; tasks T045): the
 * domain, lowered and held to the rule; the file a deploy here would sign;
 * which service; the change, checked whole; and the record to create, of the
 * server this folder is linked to, its address through the optional
 * dependency `sshHost`, given here by a stand-in and never run for real.
 */
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CliError, UsageError, WrongInput } from "../../src/cli/errors"
import { recordOf, serverAddresses } from "../../src/domains/address"
import { A10, A11, A12, A13, A14, A15 } from "../../src/domains/words"
import {
  domainChange,
  domainsFile,
  prepareAdd,
  prepareRemove,
  recordFor,
  serviceFor,
  typedDomain,
} from "../../src/ops/domain"
import type { Settings } from "../../src/settings/types"
import { CS4, SH1 } from "../../src/settings/words"
import { COMPOSE_V1, machine, ready } from "../support/helpers"

const IMAGE = "ghcr.io/acme/web:1.4.2"
const two = (web: object, api: object = {}) =>
  JSON.stringify({
    zekno: 1,
    services: {
      web: { source: { image: IMAGE }, ...web },
      api: { source: { image: IMAGE }, ...api },
    },
  })

/** What a call threw: its kind and its sentence. */
function thrown(work: () => unknown): [string, string] | undefined {
  try {
    work()
  } catch (error) {
    return [(error as Error).constructor.name, (error as Error).message]
  }
  return undefined
}

/** A folder with `files` only, no profile. */
function folder(files: Record<string, string>) {
  const m = machine()
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(m.project, name), text)
  return m
}

describe("the domain typed (CL2)", () => {
  test("lowered; none typed is the usage line; A10 and A11 by the core library's rule", () => {
    expect(typedDomain("Shop.Example.COM", "add")).toBe("shop.example.com")
    expect(thrown(() => typedDomain(undefined, "add"))).toEqual([
      UsageError.name,
      "Say which domain: `zekno domain add <domain>`.",
    ])
    expect(thrown(() => typedDomain("", "rm"))).toEqual([
      UsageError.name,
      "Say which domain: `zekno domain rm <domain>`.",
    ])
    expect(thrown(() => typedDomain("*.example.com", "add"))).toEqual([
      WrongInput.name,
      A10("*.example.com"),
    ])
    expect(thrown(() => typedDomain("bücher.example", "rm"))).toEqual([
      WrongInput.name,
      A11("bücher.example"),
    ])
  })
})

describe("the file (CL2): as zekno settings set reads it", () => {
  test("no file: SH1, status 1; a Compose file written by hand: A14, status 2", () => {
    expect(thrown(() => domainsFile(folder({}).deps))).toEqual([
      CliError.name,
      SH1,
    ])
    expect(
      thrown(() => domainsFile(folder({ "compose.yaml": COMPOSE_V1 }).deps))
    ).toEqual([WrongInput.name, A14])
  })

  test("the domain before the file: A10 is said in a folder with no file at all", () => {
    expect(thrown(() => prepareAdd(folder({}).deps, "*.example.com"))).toEqual([
      WrongInput.name,
      A10("*.example.com"),
    ])
  })

  test("A13: the domain is in the file already, naming its service, whichever service is asked for", () => {
    const m = folder({
      "zekno.app.json": two(
        { networking: { port: 3000 } },
        { networking: { port: 8080, domains: ["shop.example.com"] } }
      ),
    })
    expect(thrown(() => prepareAdd(m.deps, "SHOP.example.com"))).toEqual([
      WrongInput.name,
      A13("shop.example.com", "api"),
    ])
  })

  test("A15: rm of a domain the file does not have", () => {
    const m = folder({ "zekno.app.json": two({ networking: { port: 3000 } }) })
    expect(thrown(() => prepareRemove(m.deps, "shop.example.com"))).toEqual([
      WrongInput.name,
      A15("shop.example.com"),
    ])
  })
})

describe("which service (CL2)", () => {
  const settings = (web: object, api: object = {}): Settings => {
    const m = folder({ "zekno.app.json": two(web, api) })
    return domainsFile(m.deps).read.settings
  }

  test("the only service with a port", () => {
    expect(
      serviceFor(
        settings({ networking: { port: 3000 } }),
        "zekno.app.json",
        undefined
      )
    ).toEqual({ service: "web" })
  })

  test("several with a port: asked among them, in the file's order", () => {
    expect(
      serviceFor(
        settings(
          { networking: { port: 3000 } },
          { networking: { port: 8080 } }
        ),
        "zekno.app.json",
        undefined
      )
    ).toEqual({ ask: ["web", "api"] })
  })

  test("--service: one of the file's (CS4), with a port (A12)", () => {
    const both = settings({ networking: { port: 3000 } })
    expect(serviceFor(both, "zekno.app.json", "web")).toEqual({
      service: "web",
    })
    expect(thrown(() => serviceFor(both, "zekno.app.json", "api"))).toEqual([
      WrongInput.name,
      A12("api"),
    ])
    expect(thrown(() => serviceFor(both, "zekno.app.json", "db"))).toEqual([
      WrongInput.name,
      CS4("zekno.app.json", "db", ["web", "api"]),
    ])
    expect(thrown(() => serviceFor(both, "zekno.app.json", "Db;x"))).toEqual([
      WrongInput.name,
      CS4("zekno.app.json", undefined, ["web", "api"]),
    ])
  })

  test("no service with a port: A12 for the first", () => {
    expect(
      thrown(() => serviceFor(settings({}), "zekno.app.json", undefined))
    ).toEqual([WrongInput.name, A12("web")])
  })
})

describe("the change (CL2): checked whole, as <service>.domains", () => {
  test("added last; removed; the lists before and after", () => {
    const m = folder({
      "zekno.app.json": two({
        networking: { port: 3000, domains: ["www.example.com"] },
      }),
    })
    const file = domainsFile(m.deps)
    const added = domainChange(file, "web", "shop.example.com", "add")
    expect([added.now, added.next]).toEqual([
      ["www.example.com"],
      ["www.example.com", "shop.example.com"],
    ])
    expect([added.change.now, added.change.next]).toEqual([
      "www.example.com",
      "www.example.com, shop.example.com",
    ])
    const removed = prepareRemove(m.deps, "WWW.example.com")
    expect([removed.service, removed.change.next]).toEqual(["web", "none"])
    expect(removed.change.settings.services[0]![1]).not.toHaveProperty(
      "domains"
    )
  })

  test("a 65th domain breaks the file's rule: CS17, status 2", () => {
    const list = Array.from({ length: 64 }, (_, at) => `d${at}.example.com`)
    const m = folder({
      "zekno.app.json": two({ networking: { port: 3000, domains: list } }),
    })
    expect(
      thrown(() =>
        domainChange(domainsFile(m.deps), "web", "e.example.com", "add")
      )
    ).toEqual([
      WrongInput.name,
      "That change cannot be written. web, networking.domains: at most 64 names.",
    ])
  })
})

describe("the record to create (CL2, CL5)", () => {
  test("the server's address: A for its first IPv4 address, else AAAA; not known without an address", () => {
    expect(
      recordOf({ v4: ["203.0.113.7", "203.0.113.8"], v6: ["2001:db8::7"] })
    ).toEqual({
      type: "A",
      address: "203.0.113.7",
    })
    expect(recordOf({ v4: [], v6: ["2001:db8::7"] })).toEqual({
      type: "AAAA",
      address: "2001:db8::7",
    })
    expect(recordOf({ v4: [], v6: [] })).toBeUndefined()
    expect(recordOf(undefined)).toBeUndefined()
  })

  test("sshHost undefined, or a local runner, or one that fails: not known, and nothing is run", async () => {
    const ssh = {
      kind: "ssh",
      destination: "deploy@203.0.113.7",
      runnerPath: "/x",
    } as const
    expect(await serverAddresses(undefined, ssh)).toBeUndefined()
    let asked = 0
    const counting = async () => {
      asked++
      return { v4: ["203.0.113.7"], v6: [] }
    }
    expect(
      await serverAddresses(counting, { kind: "local", home: "/x" })
    ).toBeUndefined()
    expect(asked).toBe(0)
    expect(await serverAddresses(counting, ssh)).toEqual({
      v4: ["203.0.113.7"],
      v6: [],
    })
    expect(asked).toBe(1)
    const failing = async () => {
      throw new Error("ssh failed")
    }
    expect(await serverAddresses(failing, ssh)).toBeUndefined()
  })

  test("a folder not linked: A6 with `your server`; linked to a server this machine knows, reached at a public address: A5", async () => {
    expect(await recordFor(folder({}).deps)).toEqual({})
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(
      join(m.project, "zekno.app.json"),
      two({ networking: { port: 3000 } })
    )
    expect(await m.zekno("link", "--app", "shop", "--server", "dev")).toBe(0)
    // dev is a local runner: no public address, so A6 names it.
    expect(await recordFor(m.deps)).toEqual({ server: "dev" })
    // Reached over SSH, with a stand-in for `ssh -G`.
    m.tamper("profile.json", (profile) => ({
      ...profile,
      servers: profile.servers.map((server: { target: unknown }) => ({
        ...server,
        target: {
          kind: "ssh",
          destination: "deploy@prod-1",
          runnerPath: "~/.zekno/bin/zekno-runner",
        },
      })),
    }))
    const asked: string[] = []
    m.deps.sshHost = async (destination) => {
      asked.push(destination)
      return { v4: ["203.0.113.7"], v6: [] }
    }
    expect(await recordFor(m.deps)).toEqual({
      record: { type: "A", address: "203.0.113.7" },
    })
    expect(asked).toEqual(["deploy@prod-1"])
    // Not public, or not known: A6 with the server's name.
    m.deps.sshHost = async () => undefined
    expect(await recordFor(m.deps)).toEqual({ server: "dev" })
  }, 60_000)
})
