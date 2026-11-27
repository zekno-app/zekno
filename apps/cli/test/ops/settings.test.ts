/**
 * What the `zekno settings` commands do, as data (specs/010-app-settings,
 * contracts/commands.md; tasks T037). Nothing here is drawn. The machines
 * have a local runner and the stand-in Docker; where a test says so, the
 * keychain and every connection throw, so that reading them fails the test.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { OpDeps } from "../../src/cli/context"
import {
  createFromAnswers,
  prepareInit,
  prepareSettingChange,
  settingsData,
  showSettings,
  writeSettingChange,
} from "../../src/ops/settings"
import { pipedLines } from "../../src/settings/piped"
import { reportOf } from "../../src/settings/rows"
import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type { Settings } from "../../src/settings/types"
import {
  CS1,
  CS13,
  CS2,
  CS4,
  CS6,
  IN1_RULE,
  IN4,
  SH1,
  SH2,
  SH3,
} from "../../src/settings/words"
import {
  answer,
  building,
  built,
  folderWith as builtFolder,
  server,
} from "../support/build-events"
import { COMPOSE_V1, machine, ready, twin } from "../support/helpers"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  SENTINEL,
} from "../support/settings-files"

type Machine = ReturnType<typeof machine>

/** A keychain and a connection that fail whatever touches them, and a fetch that counts its calls. */
function untouched(deps: OpDeps): OpDeps & { fetched: () => number } {
  const no = (what: string) => () => {
    throw new Error(what)
  }
  let fetched = 0
  return {
    ...deps,
    keyStore: {
      get: no("the keychain was read"),
      set: no("the keychain was written"),
      delete: no("the keychain was written"),
    },
    connect: no("a connection was made"),
    fetch: async () => {
      fetched++
      throw new Error("the network was used")
    },
    fetched: () => fetched,
  }
}

/** A ready machine whose folder holds only `files`. */
async function folderWith(files: Record<string, string>): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(m.project, name), text)
  return m
}

/** design.md's settings with web's memory as `memory`. */
const withMemory = (memory: string): Settings => ({
  ...DESIGN_SETTINGS,
  services: DESIGN_SETTINGS.services.map(([name, service]) =>
    name === "web" ? [name, { ...service, memory }] : [name, service]
  ),
})

/** What `links.json` holds, or nothing. */
const links = (m: Machine): string => {
  try {
    return readFileSync(join(m.home, "links.json"), "utf8")
  } catch {
    return ""
  }
}

describe("showing", () => {
  test("design.md's file and no zekno.json: the report with no app and no marks, the keychain never read, nothing connected or fetched", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const deps = untouched(m.deps)
    expect(await showSettings(deps)).toEqual({
      ...reportOf(DESIGN_SETTINGS, undefined, undefined, "zekno.app.json"),
      piped: pipedLines(DESIGN_SETTINGS),
    })
    expect(deps.fetched()).toBe(0)
    // The same with a profile and still no zekno.json: the team is not opened.
    const r = await folderWith({ "zekno.app.json": DESIGN_FILE })
    const report = await showSettings(untouched(r.deps))
    expect(report.app).toBeUndefined()
  }, 60_000)

  test("a zekno.json signed by the team, in use here, naming zekno.app.json, and a last deploy from settings with memory 512m: the app, and only the memory marked", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE.replace('"1g"', '"512m"'),
    })
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const before = links(m)
    const report = await showSettings(m.deps)
    expect(report).toEqual({
      ...reportOf(
        DESIGN_SETTINGS,
        withMemory("512m"),
        "demo",
        "zekno.app.json"
      ),
      piped: pipedLines(DESIGN_SETTINGS),
    })
    const marked = report.services.flatMap((service) =>
      service.rows
        .filter((row) => row.changed !== undefined)
        .map((row) => [service.name, row.label, row.changed])
    )
    expect(marked).toEqual([["web", "memory", { was: "512m" }]])
    expect(links(m)).toBe(before)
  }, 60_000)

  test("a last deploy that built: read back with the history's builds, so a Build value changed since is marked (specs/016-build-from-source, CL1)", async () => {
    const m = await builtFolder({ web: built() })
    server(m, (signed) => [
      ...building(signed.keys[0]!, ["#1 done"]),
      answer(signed, { outcome: "started" }),
    ])
    expect(await m.zekno("link", "--app", "shop", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    writeFileSync(
      join(m.project, "zekno.app.json"),
      `${JSON.stringify({ zekno: 1, services: { web: built({ network: "none" }) } }, null, 2)}\n`
    )
    const report = await showSettings(m.deps)
    expect(report.app).toBe("shop")
    const marked = report.services.flatMap((service) =>
      service.rows
        .filter((row) => row.changed !== undefined)
        .map((row) => [service.name, row.changed])
    )
    expect(marked).toEqual([["web", { was: "internet" }]])
  }, 60_000)

  test("the last deploy a Compose file written by hand: the app, and no marks", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    expect(
      await m.zekno(
        "link",
        "--app",
        "demo",
        "--server",
        "dev",
        "-f",
        "zekno.app.json"
      )
    ).toBe(0)
    expect(await m.zekno("deploy", "-f", "compose.yaml")).toBe(0)
    const report = await showSettings(m.deps)
    expect(report.app).toBe("demo")
    expect(
      report.services.flatMap((service) =>
        service.rows.filter((row) => row.changed !== undefined)
      )
    ).toEqual([])
  }, 60_000)

  test("a zekno.json not signed by the team, or signed and not in use here: no app, no marks, nothing asked, links.json unchanged", async () => {
    const unsigned = await folderWith({ "zekno.app.json": DESIGN_FILE })
    writeFileSync(
      join(unsigned.project, "zekno.json"),
      JSON.stringify({ app: "demo", server: "dev", compose: "zekno.app.json" })
    )
    expect((await showSettings(unsigned.deps)).app).toBeUndefined()
    expect(links(unsigned)).toBe("")

    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    const other = await twin(m)
    other.deps.cwd = m.project
    const report = await showSettings(other.deps)
    expect(report.app).toBeUndefined()
    expect(
      report.services.flatMap((service) =>
        service.rows.filter((row) => row.changed !== undefined)
      )
    ).toEqual([])
    expect(links(other)).toBe("")
  }, 60_000)

  test("a zekno.json in use here naming compose.yaml while zekno.app.json is here: SH3, and nothing of zekno.app.json shown (security review S1)", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    expect(
      await m.zekno(
        "link",
        "--app",
        "demo",
        "--server",
        "dev",
        "-f",
        "compose.yaml"
      )
    ).toBe(0)
    await expect(showSettings(m.deps)).rejects.toThrow(SH3("compose.yaml"))
    expect(() => settingsData(m.deps)).toThrow(SH3("compose.yaml"))
  }, 60_000)

  test("no zekno.app.json: SH1; SH2 with compose.yaml here, or with this folder's zekno.json naming a Compose file", async () => {
    const bare = machine()
    await expect(showSettings(bare.deps)).rejects.toThrow(SH1)
    expect(() => settingsData(bare.deps)).toThrow(SH1)

    const compose = machine()
    writeFileSync(join(compose.project, "compose.yaml"), COMPOSE_V1)
    await expect(showSettings(compose.deps)).rejects.toThrow(
      SH2("compose.yaml")
    )

    const linked = await folderWith({ "other.yaml": COMPOSE_V1 })
    expect(
      await linked.zekno(
        "link",
        "--app",
        "demo",
        "--server",
        "dev",
        "-f",
        "other.yaml"
      )
    ).toBe(0)
    await expect(showSettings(linked.deps)).rejects.toThrow(SH2("other.yaml"))
  }, 60_000)

  test("a fault: its sentence, nothing of the file said, the keychain never read", async () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`)
    )
    const deps = untouched(m.deps)
    let message = ""
    try {
      await showSettings(deps)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe(
      "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."
    )
    expect(message).not.toContain(SENTINEL)
  })

  test("--json: the file's own data in zekno's order, nothing added", async () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      // Keys in another order than zekno writes, and cpus written 1.50.
      `{"services":{"web":{"variables":{"secrets":["A"]},"source":{"image":"nginx:1.27"},"deploy":{"cpus":1.50}}},"zekno":1}`
    )
    expect(JSON.stringify(settingsData(untouched(m.deps)).data)).toBe(
      '{"zekno":1,"services":{"web":{"source":{"image":"nginx:1.27"},"deploy":{"cpus":1.5},"variables":{"secrets":["A"]}}}}'
    )
  })
})

describe("changing (contracts/commands.md, 'Order of checks'; T049)", () => {
  /** A folder holding `files`, with no profile, a keychain and connections that throw. */
  function bareWith(files: Record<string, string>) {
    const m = machine()
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(m.project, name), text)
    return { m, deps: untouched(m.deps) }
  }

  /** What a call throws: its kind and its sentence. */
  function thrown(work: () => unknown): [string, string] {
    try {
      work()
    } catch (error) {
      return [(error as Error).constructor.name, (error as Error).message]
    }
    throw new Error("nothing was thrown")
  }

  test("the words first, then the setting's name, then the file: a later setting with no file here is CS6, not SH1", () => {
    const { deps } = bareWith({})
    expect(
      thrown(() => prepareSettingChange(deps, undefined, undefined, false))
    ).toEqual(["UsageError", CS1("set")])
    expect(
      thrown(() => prepareSettingChange(deps, undefined, undefined, true))
    ).toEqual(["UsageError", CS1("unset")])
    expect(
      thrown(() => prepareSettingChange(deps, "web.memory", undefined, false))
    ).toEqual(["UsageError", CS2])
    // Domains are a setting since specs/015-domains-https (CL1); replicas are still a later one.
    expect(
      thrown(() => prepareSettingChange(deps, "web.replicas", "2", false))
    ).toEqual(["WrongInput", CS6("replicas")])
    // specs/016-build-from-source, CL1: no such setting is G18, by its id until the words tasks (CS5 changed, plan item 21 (a)).
    expect(
      thrown(() => prepareSettingChange(deps, "web.memroy", "1g", false))
    ).toEqual(["BuildValueRefused", "G18"])
    expect(
      thrown(() => prepareSettingChange(deps, "web.memory", "1g", false))
    ).toEqual(["CliError", SH1])
  })

  test("then the file, the service, the value and the file with the change, each with its status", () => {
    const { deps } = bareWith({ "zekno.app.json": DESIGN_FILE })
    expect(
      thrown(() => prepareSettingChange(deps, "api.memory", "1g", false))
    ).toEqual(["WrongInput", CS4("zekno.app.json", "api", ["web", "worker"])])
    expect(
      thrown(() => prepareSettingChange(deps, "web.memory", "lots", false))
    ).toEqual([
      "WrongInput",
      "That is not a memory limit. Use a size such as 512m or 1g.",
    ])
    expect(prepareSettingChange(deps, "web.memory", "1g", false)).toEqual({
      nothing: "web · memory limit is 1g already. Nothing was written.",
    })
    expect(
      thrown(() => prepareSettingChange(deps, "worker.publish", "80", false))
    ).toEqual([
      "WrongInput",
      "That change cannot be written. worker, networking.publish: set networking.port too, the port it reaches.",
    ])
    // specs/016-build-from-source, CL1: CS15 became G16, by its id until the words tasks.
    expect(
      thrown(() => prepareSettingChange(deps, "web.image", undefined, true))
    ).toEqual(["WrongInput", "G16"])
    expect(
      prepareSettingChange(deps, "worker.memory", undefined, true)
    ).toEqual({
      nothing: "worker · memory limit is not set. Nothing was written.",
    })
    const faulty = bareWith({
      "zekno.app.json": DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`),
    })
    const [kind, sentence] = thrown(() =>
      prepareSettingChange(faulty.deps, "web.memory", "2g", false)
    )
    expect([kind, sentence]).toEqual([
      "CliError",
      "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g.",
    ])
    expect(sentence).not.toContain(SENTINEL)
  })

  test("a change, then its write: the file holds that one change; the keychain, a connection and the network never used", () => {
    const { m, deps } = bareWith({ "zekno.app.json": DESIGN_FILE })
    const plan = prepareSettingChange(deps, "web.memory", "2g", false)
    if ("nothing" in plan) throw new Error("nothing to write")
    expect([plan.change.label, plan.change.now, plan.change.next]).toEqual([
      "memory limit",
      "1g",
      "2g",
    ])
    // Nothing is written until the write.
    expect(readFileSync(join(m.project, "zekno.app.json"), "utf8")).toBe(
      DESIGN_FILE
    )
    writeSettingChange(plan)
    expect(readFileSync(join(m.project, "zekno.app.json"), "utf8")).toBe(
      DESIGN_FILE.replace('"memory": "1g"', '"memory": "2g"')
    )
    expect(deps.fetched()).toBe(0)
  })

  test("a settings file that is a symbolic link, even to a file in the folder: CS13 before anything is asked, and at the write", () => {
    const { m, deps } = bareWith({ "real.json": DESIGN_FILE })
    symlinkSync(join(m.project, "real.json"), join(m.project, "zekno.app.json"))
    expect(
      thrown(() => prepareSettingChange(deps, "web.memory", "2g", false))
    ).toEqual(["CliError", CS13("zekno.app.json")])
    expect(readFileSync(join(m.project, "real.json"), "utf8")).toBe(DESIGN_FILE)
  })

  test("init: IN4 when anything named zekno.app.json is here, a link to nowhere too; whether compose.yaml is here; the file it creates", () => {
    const here = bareWith({ "zekno.app.json": DESIGN_FILE })
    expect(thrown(() => prepareInit(here.deps))).toEqual(["CliError", IN4])
    const dangling = bareWith({})
    symlinkSync(
      join(dangling.m.project, "gone.json"),
      join(dangling.m.project, "zekno.app.json")
    )
    expect(thrown(() => prepareInit(dangling.deps))).toEqual(["CliError", IN4])

    const empty = bareWith({})
    expect(prepareInit(empty.deps)).toEqual({ compose: false })
    const compose = bareWith({ "compose.yaml": COMPOSE_V1 })
    expect(prepareInit(compose.deps)).toEqual({ compose: true })

    const path = createFromAnswers(
      empty.deps,
      "ghcr.io/acme/demo-web:1.4.2",
      "web"
    )
    const expected: Settings = {
      version: 1,
      services: [["web", { image: "ghcr.io/acme/demo-web:1.4.2" }]],
    }
    expect(readFileSync(path, "utf8")).toBe(settingsText(expected))
    expect(checkSettings(readFileSync(path, "utf8"), "zekno.app.json")).toEqual(
      expected
    )
    // Never over a file that is there.
    expect(
      thrown(() => createFromAnswers(empty.deps, "nginx:1.27", "web"))
    ).toEqual(["CliError", IN4])
    expect(
      thrown(() => createFromAnswers(compose.deps, "Not An Image", "web"))
    ).toEqual(["WrongInput", IN1_RULE])
    expect(empty.deps.fetched()).toBe(0)
  })
})
