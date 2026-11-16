/**
 * `zekno settings`' report as a terminal draws it and as plain output prints
 * it (specs/010-app-settings, contracts/commands.md, "At a terminal" and
 * "Piped"; board `CmdSettings`; tasks T035).
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { pipedLines } from "../../../src/settings/piped"
import { reportOf } from "../../../src/settings/rows"
import type { Settings, SettingsReport } from "../../../src/settings/types"
import { IN6 } from "../../../src/settings/words"
import { plainUi } from "../../../src/ui/plain/plain"
import { BRAND } from "../../../src/ui/terminal/theme"
import { drawnInColour, plainOf, wordRuns } from "../../support/colour"
import { DESIGN_SETTINGS } from "../../support/settings-files"
import { terminal } from "../../support/terminal"

const BLOCK = join(import.meta.dir, "../../../src/ui/ink/settings-report.tsx")

/** design.md's settings with web's memory as `memory`. */
const withMemory = (memory: string): Settings => ({
  ...DESIGN_SETTINGS,
  services: DESIGN_SETTINGS.services.map(([name, service]) =>
    name === "web" ? [name, { ...service, memory }] : [name, service]
  ),
})

/** The report of design.md's file for demo, last deployed with web's memory 512m. */
const REPORT: SettingsReport = {
  ...reportOf(DESIGN_SETTINGS, withMemory("512m"), "demo", "zekno.app.json"),
  piped: pipedLines(DESIGN_SETTINGS),
}

/** The board's left column, from the first line to the last row, with the label column at 16 and the values at 26. */
const BOARD = [
  "  demo  from zekno.app.json",
  "",
  "  web",
  "  Source        image     ghcr.io/acme/demo-web:1.4.2",
  "  Deploy        start     bun run start",
  "                restart   on failure",
  "                memory    1g  ! changed, not deployed (was 512m)",
  "                cpus      1",
  "  Networking    port      3000, not published",
  "  Variables     secrets   DATABASE_URL, SESSION_KEY",
  "                plain     NODE_ENV=production",
  "  Volumes       uploads   /data/uploads",
  "",
  "  worker",
  "  Source        image     ghcr.io/acme/demo-worker:1.4.2",
  "  Deploy        start     bun run worker",
  "                restart   always",
  "  Variables     secrets   DATABASE_URL",
]

/** Gives Ink a moment to write what it was told. */
const drawn = () => Bun.sleep(60)

/** What a stand-in terminal `columns` wide shows for `report`, empty lines kept and the last empty ones left out. */
async function shown(report: SettingsReport, columns = 100): Promise<string[]> {
  const t = terminal(columns, 40)
  t.ui.settingsReport(report)
  await drawn()
  await t.ui.close()
  const screen = t.screen()
  while (screen.at(-1) === "") screen.pop()
  return screen
}

describe("at a terminal (board `CmdSettings`, left column)", () => {
  test("every line of the board, in its columns: sections at 2, labels at 16, values at 26, the mark after the value", async () => {
    expect(await shown(REPORT)).toEqual(BOARD)
  })

  test("the looks: the app bold, `from <file>` dim; services bold in the brand colour; sections bold; labels dim; values in the text colour; the mark in the warning colour", () => {
    const lines = drawnInColour(BLOCK, "SettingsBlock", {
      report: REPORT,
      columns: 100,
    }).split("\n")
    const line = (start: string) =>
      lines.find((each) => plainOf(each).startsWith(start))!
    expect(wordRuns(line("  demo"))).toEqual([
      { text: "demo", bold: true, dim: false },
      { text: "from zekno.app.json", bold: false, dim: true },
    ])
    expect(wordRuns(line("  web"))).toEqual([
      { text: "web", bold: true, dim: false, color: BRAND },
    ])
    expect(wordRuns(line("  worker"))).toEqual([
      { text: "worker", bold: true, dim: false, color: BRAND },
    ])
    expect(
      wordRuns(line("  Source        image     ghcr.io/acme/demo-web"))
    ).toEqual([
      { text: "Source", bold: true, dim: false },
      { text: "image", bold: false, dim: true },
      { text: "ghcr.io/acme/demo-web:1.4.2", bold: false, dim: false },
    ])
    expect(wordRuns(line("                memory"))).toEqual([
      { text: "memory", bold: false, dim: true },
      { text: "1g", bold: false, dim: false },
      {
        text: "! changed, not deployed (was 512m)",
        bold: false,
        dim: false,
        color: "yellow",
      },
    ])
  })

  test("without the app: the file alone, bold, on the first line; no marks without what was deployed", async () => {
    const report = reportOf(DESIGN_SETTINGS)
    const screen = await shown(report)
    expect(screen[0]).toBe("  zekno.app.json")
    expect(screen.join("\n")).not.toContain("changed")
    const first = drawnInColour(BLOCK, "SettingsBlock", {
      report,
      columns: 100,
    }).split("\n")[0]!
    expect(wordRuns(first)).toEqual([
      { text: "zekno.app.json", bold: true, dim: false },
    ])
  })

  test("a value wider than the window goes on under itself, from the value column, never under the labels; nothing past the window", async () => {
    const long = "word ".repeat(30).trim()
    const settings: Settings = {
      version: 1,
      services: [["web", { image: "nginx:1.27", plain: [["GREETING", long]] }]],
    }
    const screen = await shown(reportOf(settings), 80)
    const at = screen.findIndex((line) => line.includes("GREETING="))
    expect(screen[at]).toStartWith("  Variables     plain     GREETING=word")
    const rest = screen.slice(at + 1)
    expect(rest.length).toBeGreaterThan(0)
    for (const line of rest) {
      expect(line.slice(0, 26)).toBe(" ".repeat(26))
      expect(line.slice(26, 27)).not.toBe(" ")
    }
    for (const line of screen) expect([...line].length).toBeLessThanOrEqual(80)
    expect(
      [screen[at]!.slice(26), ...rest.map((line) => line.slice(26))].join(" ")
    ).toBe(`GREETING=${long}`)
  })

  test("the note (IN6) after the services, an empty line apart, as a warning", async () => {
    const screen = await shown({
      ...reportOf(DESIGN_SETTINGS),
      note: IN6,
    })
    expect(screen.slice(-2)).toEqual([
      "",
      "! This folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f <file>.",
    ])
  })
})

describe("piped (contracts/commands.md, 'Piped, TERM=dumb')", () => {
  test("one line per setting that is set, with tabs, the values as the file holds them; no first line, no sections, no marks", () => {
    const out: string[] = []
    const err: string[] = []
    plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ).settingsReport(REPORT)
    expect(out).toEqual([
      "web\tsource.image\tghcr.io/acme/demo-web:1.4.2",
      "web\tdeploy.start\tbun run start",
      "web\tdeploy.restart\ton-failure",
      "web\tdeploy.memory\t1g",
      "web\tdeploy.cpus\t1",
      "web\tnetworking.port\t3000",
      "web\tvariables.secrets\tDATABASE_URL,SESSION_KEY",
      "web\tvariables.plain.NODE_ENV\tproduction",
      "web\tvolumes.uploads\t/data/uploads",
      "worker\tsource.image\tghcr.io/acme/demo-worker:1.4.2",
      "worker\tdeploy.start\tbun run worker",
      "worker\tdeploy.restart\talways",
      "worker\tvariables.secrets\tDATABASE_URL",
    ])
    expect(err).toEqual([])
  })

  test("a published port is a line of its own; the note (IN6) goes to standard error", () => {
    const settings: Settings = {
      version: 1,
      services: [
        [
          "web",
          { image: "nginx:1.27", port: 3000, publish: 8080, cpus: "1.50" },
        ],
      ],
    }
    const out: string[] = []
    const err: string[] = []
    plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ).settingsReport({
      ...reportOf(settings),
      piped: pipedLines(settings),
      note: IN6,
    })
    expect(out).toEqual([
      "web\tsource.image\tnginx:1.27",
      "web\tdeploy.cpus\t1.50",
      "web\tnetworking.port\t3000",
      "web\tnetworking.publish\t8080",
    ])
    expect(err).toEqual([
      "This folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f <file>.",
    ])
  })
})

describe("the change line of set and unset (board `CmdSettings`, middle column; T047)", () => {
  const CHANGE = {
    service: "web",
    label: "memory limit",
    now: "512m",
    next: "1g",
  }

  test("at a terminal: from column 2, the service and label dim, the old value, a dim arrow, the new value bold", async () => {
    const t = terminal(100, 30)
    t.ui.settingChange(CHANGE)
    await drawn()
    await t.ui.close()
    expect(t.lines()).toEqual(["  web · memory limit  512m → 1g"])
    const line = drawnInColour(BLOCK, "ChangeLine", {
      change: CHANGE,
      columns: 100,
    }).split("\n")[0]!
    expect(wordRuns(line)).toEqual([
      { text: "web · memory limit", bold: false, dim: true },
      { text: "512m", bold: false, dim: false },
      { text: "→", bold: false, dim: true },
      { text: "1g", bold: true, dim: false },
    ])
  })

  test("piped: the same words on standard output", () => {
    const out: string[] = []
    const err: string[] = []
    plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ).settingChange({ ...CHANGE, now: "1g", next: "no limit" })
    expect(out).toEqual(["web · memory limit  1g → no limit"])
    expect(err).toEqual([])
  })
})
