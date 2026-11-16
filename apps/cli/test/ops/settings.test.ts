/**
 * What the `zekno settings` commands do, as data (specs/010-app-settings,
 * contracts/commands.md; tasks T037). Nothing here is drawn. The machines
 * have a local runner and the stand-in Docker; where a test says so, the
 * keychain and every connection throw, so that reading them fails the test.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { OpDeps } from "../../src/cli/context"
import { settingsData, showSettings } from "../../src/ops/settings"
import { pipedLines } from "../../src/settings/piped"
import { reportOf } from "../../src/settings/rows"
import type { Settings } from "../../src/settings/types"
import { SH1, SH2, SH3 } from "../../src/settings/words"
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

  test("a zekno.json in use here naming compose.yaml while zekno.app.json is here: SH3 as the note, no app", async () => {
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
    const report = await showSettings(m.deps)
    expect(report.note).toBe(SH3("compose.yaml"))
    expect(report.app).toBeUndefined()
  }, 60_000)

  test("no zekno.app.json: SH1; SH2 with compose.yaml here, or with this folder's zekno.json naming a Compose file", async () => {
    const bare = machine()
    await expect(showSettings(bare.deps)).rejects.toThrow(SH1)
    await expect(settingsData(bare.deps)).rejects.toThrow(SH1)

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
    expect(JSON.stringify(await settingsData(untouched(m.deps)))).toBe(
      '{"zekno":1,"services":{"web":{"source":{"image":"nginx:1.27"},"deploy":{"cpus":1.5},"variables":{"secrets":["A"]}}}}'
    )
  })
})
