/**
 * The settings screen's effects (specs/010-app-settings,
 * contracts/app-screen.md, "Tests"; tasks T043): reading this folder's
 * settings for an app, in a folder of each kind, and the marks against this
 * machine's last deploy. The app is started as `zekno` starts it (the
 * keychain read once, by `loadStart`); after that a key store and a
 * connection that fail are given, so a read that touched either would show.
 */
import { describe, expect, test } from "bun:test"
import {
  mkdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { createEffects } from "../../src/app/effects/effects"
import { faultOf } from "../../src/app/effects/settings"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent, Effect } from "../../src/app/state/events"
import type { SettingsView } from "../../src/app/state/types"
import { openTeam } from "../../src/cli/context"
import { writeLink } from "../../src/ops/link"
import { composeText } from "../../src/settings/compose"
import { screenRows } from "../../src/settings/rows"
import { AS6, SH1, SH2 } from "../../src/settings/words"
import { ready, type machine } from "../support/helpers"
import {
  DESIGN_COMPOSE,
  DESIGN_FILE,
  DESIGN_SETTINGS,
  SENTINEL,
} from "../support/settings-files"
import { withMemory } from "../support/settings-view"

type Machine = ReturnType<typeof machine>
type Outcome = SettingsView["outcome"]

/**
 * The app's effects as `zekno` opens them in this machine's project folder,
 * after the start; from then on the keychain and every connection fail.
 */
async function appIn(m: Machine) {
  const start = await loadStart(m.deps)
  /** What was asked of the keychain and of a server after the start: nothing, ever. */
  const touched = { keychain: 0, servers: 0 }
  const events: AppEvent[] = []
  const effects = createEffects(
    {
      ...m.deps,
      keyStore: {
        ...m.keyStore,
        get: async () => {
          touched.keychain++
          return Promise.reject(new Error("the keychain was read"))
        },
      },
      connect: () => {
        touched.servers++
        throw new Error("a server was contacted")
      },
    },
    (event) => events.push(event),
    (error) => {
      throw error
    },
    undefined,
    {},
    start
  )
  /** Runs one effect and gives the outcome it read. */
  const read = async (
    effect: Partial<Extract<Effect, { kind: "read-settings" }>> = {}
  ): Promise<Outcome> => {
    const before = events.length
    effects.run({
      kind: "read-settings",
      server: "dev",
      app: "demo",
      deployed: true,
      ...effect,
    })
    for (let tries = 0; events.length === before && tries < 100; tries++)
      await Bun.sleep(5)
    const got = events.slice(before)
    expect(got).toHaveLength(1)
    const event = got[0]!
    if (event.type !== "settings-read") throw new Error(event.type)
    return event.outcome
  }
  return { effects, events, read, touched }
}

/** A machine with a team and the local runner `dev`, and an empty project folder. */
async function empty() {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  return m
}

/** The read outcome, or a failure naming what came instead. */
function settingsOf(outcome: Outcome) {
  if (outcome.kind !== "read")
    throw new Error(`not settings: ${JSON.stringify(outcome)}`)
  return outcome
}

describe("reading", () => {
  test("a folder with zekno.app.json: its settings, every row of every service, its SHA-256 and its Compose text; no mark without a deploy", async () => {
    const m = await empty()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const app = await appIn(m)
    const read = settingsOf(await app.read())
    expect(read.settings).toEqual(DESIGN_SETTINGS)
    expect(read.compose).toBe(DESIGN_COMPOSE)
    expect(read.sha256).toBe(
      new Bun.CryptoHasher("sha256").update(DESIGN_FILE).digest("hex")
    )
    expect(read.report).toEqual({
      app: "demo",
      file: "zekno.app.json",
      services: DESIGN_SETTINGS.services.map((service) => ({
        name: service[0],
        rows: screenRows(service),
      })),
    })
    expect(
      read.report.services.flatMap((service) =>
        service.rows.filter((row) => row.changed)
      )
    ).toEqual([])
    expect(app.touched).toEqual({ keychain: 0, servers: 0 })
  })

  test("no settings file and no Compose file: SH1; only compose.yaml: SH2", async () => {
    const m = await empty()
    const app = await appIn(m)
    expect(await app.read()).toEqual({ kind: "sentence", sentence: SH1 })
    m.compose("services: {}\n")
    expect(await app.read()).toEqual({
      kind: "sentence",
      sentence: SH2("compose.yaml"),
    })
  })

  test("both files and no link: the settings, as d would ask before deploying them", async () => {
    const m = await ready()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const app = await appIn(m)
    expect(settingsOf(await app.read()).settings).toEqual(DESIGN_SETTINGS)
  })

  test("linked to this app: the file its zekno.json names, settings or Compose; linked to another app or server: AS6", async () => {
    const m = await ready()
    mkdirSync(join(m.project, "deploy"))
    writeFileSync(join(m.project, "deploy", "zekno.app.json"), DESIGN_FILE)
    const team = await openTeam(m.deps)
    await writeLink(m.home, team, m.project, {
      app: "demo",
      server: "dev",
      compose: "deploy/zekno.app.json",
    })
    const app = await appIn(m)
    const read = settingsOf(await app.read())
    expect(read.settings).toEqual(DESIGN_SETTINGS)
    expect(read.report.file).toBe("deploy/zekno.app.json")
    // Another app of the same server, and the same app on another server.
    expect(await app.read({ app: "api" })).toEqual({
      kind: "sentence",
      sentence: AS6("demo", "dev"),
    })
    expect(await app.read({ server: "staging" })).toEqual({
      kind: "sentence",
      sentence: AS6("demo", "dev"),
    })
    // Linked to compose.yaml, with zekno.app.json beside it: d deploys the Compose file.
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    await writeLink(
      m.home,
      team,
      m.project,
      { app: "demo", server: "dev", compose: "compose.yaml" },
      true
    )
    expect(await (await appIn(m)).read()).toEqual({
      kind: "sentence",
      sentence: SH2("compose.yaml"),
    })
    expect(app.touched).toEqual({ keychain: 0, servers: 0 })
  })

  test("a zekno.json not signed by the team is left aside, as d leaves it: the folder's own files decide", async () => {
    const m = await empty()
    writeFileSync(
      join(m.project, "zekno.json"),
      JSON.stringify({ app: "other", server: "dev", compose: "x.yaml" })
    )
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const app = await appIn(m)
    expect(settingsOf(await app.read()).settings).toEqual(DESIGN_SETTINGS)
  })

  test("a fault in the file: its first sentence and its place and rule, never its content", async () => {
    const m = await empty()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`)
    )
    const app = await appIn(m)
    const outcome = await app.read()
    expect(outcome).toEqual({
      kind: "fault",
      first: "zekno.app.json could not be read as settings.",
      rest: "web, deploy.memory: use a size such as 512m or 1g.",
    })
    expect(JSON.stringify(app.events)).not.toContain(SENTINEL)
  })

  test("a later setting: its two sentences; a file too large, or a pipe, says so at once and never hangs", async () => {
    const m = await empty()
    const file = join(m.project, "zekno.app.json")
    writeFileSync(
      file,
      DESIGN_FILE.replace(
        '"networking": { "port": 3000 }',
        '"networking": { "port": 3000, "domains": ["x.example"] }'
      )
    )
    const app = await appIn(m)
    expect(await app.read()).toEqual({
      kind: "fault",
      first: "zekno.app.json sets a domain for web.",
      rest: "Domains are not in this version of zekno yet.",
    })
    writeFileSync(file, "")
    truncateSync(file, 65_537)
    expect(await app.read()).toEqual({
      kind: "fault",
      first: "zekno.app.json is larger than the 64 KiB a settings file may be.",
      rest: "",
    })
    rmSync(file)
    Bun.spawnSync(["mkfifo", file])
    const started = Date.now()
    expect(await app.read()).toEqual({
      kind: "fault",
      first: "zekno.app.json is not a file.",
      rest: "",
    })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test("a link that leads outside the folder is not followed", async () => {
    const m = await empty()
    const elsewhere = join(m.home, "elsewhere.json")
    writeFileSync(elsewhere, DESIGN_FILE)
    symlinkSync(elsewhere, join(m.project, "zekno.app.json"))
    const app = await appIn(m)
    expect(await app.read()).toEqual({
      kind: "fault",
      first:
        "zekno.app.json leads outside the folder that holds it. zekno does not follow it there.",
      rest: "",
    })
  })

  test("the marks: what changed since this machine's last deploy made from settings, read with the team list the app verified", async () => {
    const m = await ready()
    // The last deploy from this machine: the settings with memory 512m, deployed from their Compose text.
    m.compose(composeText(withMemory(DESIGN_SETTINGS, "512m")))
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const app = await appIn(m)
    const read = settingsOf(await app.read())
    const marked = read.report.services.flatMap((service) =>
      service.rows
        .filter((row) => row.changed)
        .map((row) => [service.name, row.label, row.changed])
    )
    expect(marked).toEqual([["web", "memory", { was: "512m" }]])
    expect(app.touched).toEqual({ keychain: 0, servers: 0 })
  })

  test("with deployed false the last deploy is not read again: the marks use the one kept", async () => {
    const m = await ready()
    m.compose(composeText(withMemory(DESIGN_SETTINGS, "512m")))
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const app = await appIn(m)
    const memoryRow = (outcome: Outcome) =>
      settingsOf(outcome).report.services[0]!.rows.find(
        (row) => row.label === "memory"
      )!.changed
    expect(memoryRow(await app.read())).toEqual({ was: "512m" })
    // The history is gone from the disk: a read that does not read it again still marks, one that does marks nothing.
    rmSync(join(m.home, "history"), { recursive: true })
    expect(memoryRow(await app.read({ deployed: false }))).toEqual({
      was: "512m",
    })
    expect(memoryRow(await app.read({ deployed: true }))).toBeUndefined()
  })

  test("a last deploy of a Compose file written by hand marks nothing", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const app = await appIn(m)
    const read = settingsOf(await app.read())
    expect(
      read.report.services.flatMap((service) =>
        service.rows.filter((row) => row.changed)
      )
    ).toEqual([])
  })

  test("no secret value reaches what the screen is given", async () => {
    const m = await empty()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    m.typing("zk-value-of-a-secret-41c9")
    expect(
      await m.zekno(
        "secret",
        "set",
        "DATABASE_URL",
        "--app",
        "demo",
        "--server",
        "dev"
      )
    ).toBe(0)
    const app = await appIn(m)
    await app.read()
    expect(JSON.stringify(app.events)).not.toContain(
      "zk-value-of-a-secret-41c9"
    )
    expect(JSON.stringify(app.events)).toContain("DATABASE_URL")
  })
})

describe("a fault's sentences", () => {
  test("the first sentence and the rest, for a fault of form, a later setting and a reading fault", () => {
    expect(
      faultOf(
        "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."
      )
    ).toEqual({
      first: "zekno.app.json could not be read as settings.",
      rest: "web, deploy.memory: use a size such as 512m or 1g.",
    })
    expect(
      faultOf(
        "zekno.app.json is written for a later version of zekno. Update zekno to use it."
      )
    ).toEqual({
      first: "zekno.app.json is written for a later version of zekno.",
      rest: "Update zekno to use it.",
    })
    expect(faultOf("No settings file at zekno.app.json.")).toEqual({
      first: "No settings file at zekno.app.json.",
      rest: "",
    })
  })
})
