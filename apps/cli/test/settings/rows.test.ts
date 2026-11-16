/**
 * What `zekno settings` and the settings screen show (specs/010-app-settings,
 * contracts/commands.md, "At a terminal"; contracts/app-screen.md, "Rows";
 * research R4 and R9 items 11 and 12; tasks T022): the rows in order, the
 * words of a setting left out, and the marks "changed, not deployed".
 */
import { describe, expect, test } from "bun:test"

import { applyChange } from "../../src/settings/change"
import { reportOf, screenRows } from "../../src/settings/rows"
import type {
  ServiceSettings,
  SettingPath,
  SettingRow,
  Settings,
} from "../../src/settings/types"
import { DESIGN_SETTINGS } from "../support/settings-files"

/** design.md's settings with one setting changed. */
function changedTo(path: SettingPath, value: string | undefined): Settings {
  const got = applyChange(DESIGN_SETTINGS, path, value)
  if ("refused" in got) throw new Error(got.refused)
  return got.settings
}

/** Rows as `section label shown`, with ` !` and the old value when marked. */
const lines = (rows: readonly SettingRow[]): string[] =>
  rows.map(
    (row) =>
      `${row.section} ${row.label} ${row.shown}${row.set ? "" : " (not set)"}${
        row.changed === undefined
          ? ""
          : row.changed.was === undefined
            ? " !"
            : ` ! was ${row.changed.was}`
      }`
  )

const WEB = DESIGN_SETTINGS.services[0]!
const WORKER = DESIGN_SETTINGS.services[1]!

describe("reportOf: the rows zekno settings prints", () => {
  test("design.md's file: the rows of the board, in order, only those set", () => {
    const report = reportOf(DESIGN_SETTINGS)
    expect(report.app).toBeUndefined()
    expect(report.file).toBe("zekno.app.json")
    expect(report.services.map((service) => service.name)).toEqual([
      "web",
      "worker",
    ])
    expect(lines(report.services[0]!.rows)).toEqual([
      "Source image ghcr.io/acme/demo-web:1.4.2",
      "Deploy start bun run start",
      "Deploy restart on failure",
      "Deploy memory 1g",
      "Deploy cpus 1",
      "Networking port 3000, not published",
      "Variables secrets DATABASE_URL, SESSION_KEY",
      "Variables plain NODE_ENV=production",
      "Volumes uploads /data/uploads",
    ])
    expect(lines(report.services[1]!.rows)).toEqual([
      "Source image ghcr.io/acme/demo-worker:1.4.2",
      "Deploy start bun run worker",
      "Deploy restart always",
      "Variables secrets DATABASE_URL",
    ])
  })

  test("the port with where it is published; a second plain row has no label", () => {
    const settings: Settings = {
      version: 1,
      services: [
        [
          "web",
          {
            image: "nginx:1.27",
            port: 3000,
            publish: 8080,
            plain: [
              ["A", "1"],
              ["B", ""],
            ],
          },
        ],
      ],
    }
    expect(lines(reportOf(settings).services[0]!.rows)).toEqual([
      "Source image nginx:1.27",
      "Networking port 3000, published on 8080",
      "Variables plain A=1",
      "Variables  B=",
    ])
  })

  test("with the app and the deployed settings: only what differs is marked, with the old value", () => {
    const deployed = changedTo({ service: "web", key: "memory" }, "512m")
    const report = reportOf(DESIGN_SETTINGS, deployed, "demo")
    expect(report.app).toBe("demo")
    const marked = report.services.flatMap((service) =>
      service.rows
        .filter((row) => row.changed)
        .map((row) => `${service.name} ${row.label}`)
    )
    expect(marked).toEqual(["web memory"])
    expect(report.services[0]!.rows[3]!.changed).toEqual({ was: "512m" })
  })

  test("the port row compares the port and the published port together", () => {
    const deployed = changedTo({ service: "web", key: "publish" }, "80")
    const port = reportOf(DESIGN_SETTINGS, deployed).services[0]!.rows.find(
      (row) => row.label === "port"
    )!
    expect(port.changed).toEqual({ was: "3000, published on 80" })
  })

  test("a setting the last deploy had and the file no longer has is not shown", () => {
    const now = changedTo({ service: "web", key: "memory" }, undefined)
    const rows = reportOf(now, DESIGN_SETTINGS).services[0]!.rows
    expect(rows.some((row) => row.label === "memory")).toBe(false)
  })
})

describe("screenRows: every row of the screen", () => {
  test("design.md's web: every setting, set", () => {
    expect(lines(screenRows(WEB))).toEqual([
      "Source image ghcr.io/acme/demo-web:1.4.2",
      "Deploy start bun run start",
      "Deploy restart on failure",
      "Deploy memory 1g",
      "Deploy cpus 1",
      "Networking port 3000",
      "Networking published not published (not set)",
      "Variables secrets DATABASE_URL, SESSION_KEY",
      "Variables plain NODE_ENV=production",
      "Volumes uploads /data/uploads",
    ])
  })

  test("design.md's worker: the ones left out with their words, and the rows that add one", () => {
    const rows = screenRows(WORKER)
    expect(lines(rows)).toEqual([
      "Source image ghcr.io/acme/demo-worker:1.4.2",
      "Deploy start bun run worker",
      "Deploy restart always",
      "Deploy memory no limit (not set)",
      "Deploy cpus no limit (not set)",
      "Networking port none (not set)",
      "Networking published not published (not set)",
      "Variables secrets DATABASE_URL",
      "Variables plain none (not set)",
      "Volumes  none (not set)",
    ])
    expect(rows[8]!.path).toEqual({
      service: "worker",
      key: "plain",
      adding: true,
    })
    expect(rows[9]!.path).toEqual({
      service: "worker",
      key: "volume",
      adding: true,
    })
    expect(rows[6]!.path).toEqual({ service: "worker", key: "publish" })
  })

  test("a service with nothing but its image", () => {
    const rows = screenRows(["web", { image: "nginx:1.27" }])
    expect(lines(rows)).toEqual([
      "Source image nginx:1.27",
      "Deploy start the image's own (not set)",
      "Deploy restart no (not set)",
      "Deploy memory no limit (not set)",
      "Deploy cpus no limit (not set)",
      "Networking port none (not set)",
      "Networking published not published (not set)",
      "Variables secrets none (not set)",
      "Variables plain none (not set)",
      "Volumes  none (not set)",
    ])
  })
})

describe("the marks (research R4)", () => {
  test("memory 512m deployed: only the memory row, was 512m", () => {
    const deployed = changedTo({ service: "web", key: "memory" }, "512m")
    const rows = screenRows(WEB, deployed)
    expect(rows.filter((row) => row.changed).map((row) => row.label)).toEqual([
      "memory",
    ])
    expect(rows[3]!.changed).toEqual({ was: "512m" })
  })

  test("a service the deployed settings lack: every row marked, with no old value", () => {
    const deployed: Settings = { version: 1, services: [WEB] }
    const rows = screenRows(WORKER, deployed)
    expect(
      rows.every(
        (row) => row.changed !== undefined && row.changed.was === undefined
      )
    ).toBe(true)
    const report = reportOf(DESIGN_SETTINGS, deployed).services[1]!.rows
    expect(
      report.every((row) => row.changed && row.changed.was === undefined)
    ).toBe(true)
  })

  test("a setting removed since: its row on the screen, marked with the old value", () => {
    const now = changedTo({ service: "web", key: "memory" }, undefined)
    const rows = screenRows(now.services[0]!, DESIGN_SETTINGS)
    const memory = rows.find((row) => row.label === "memory")!
    expect(memory).toMatchObject({
      shown: "no limit",
      set: false,
      changed: { was: "1g" },
    })
    expect(rows.filter((row) => row.changed)).toHaveLength(1)
  })

  test("a setting set since the deploy: marked, no old value", () => {
    const now = changedTo({ service: "worker", key: "memory" }, "1g")
    const rows = screenRows(now.services[1]!, DESIGN_SETTINGS)
    expect(rows.find((row) => row.label === "memory")!.changed).toEqual({})
  })

  test("a start command differing only in spaces is not marked; a processor limit is a number", () => {
    const service = (change: Partial<ServiceSettings>) =>
      ["web", { ...WEB[1], ...change }] as const
    expect(
      screenRows(
        service({ start: "  bun   run start " }),
        DESIGN_SETTINGS
      ).some((row) => row.changed)
    ).toBe(false)
    expect(
      screenRows(service({ cpus: "1.00" }), DESIGN_SETTINGS).some(
        (row) => row.changed
      )
    ).toBe(false)
    expect(
      screenRows(service({ start: "bun run serve" }), DESIGN_SETTINGS)
        .filter((row) => row.changed)
        .map((row) => row.changed)
    ).toEqual([{ was: "bun run start" }])
  })

  test("restart reads its old value as a person reads it", () => {
    const deployed = changedTo({ service: "web", key: "restart" }, "always")
    expect(screenRows(WEB, deployed)[2]!.changed).toEqual({ was: "always" })
    const back = changedTo({ service: "worker", key: "restart" }, "on-failure")
    expect(screenRows(WORKER, back)[2]!.changed).toEqual({ was: "on failure" })
  })

  test("plain variables and volumes, each by its name", () => {
    const deployed = changedTo(
      { service: "web", key: "plain", name: "NODE_ENV" },
      "staging"
    )
    const rows = screenRows(WEB, deployed)
    expect(rows.find((row) => row.label === "plain")!.changed).toEqual({
      was: "NODE_ENV=staging",
    })
    const added = changedTo(
      { service: "web", key: "volume", name: "cache" },
      "/cache"
    )
    expect(
      screenRows(added.services[0]!, DESIGN_SETTINGS).find(
        (row) => row.label === "cache"
      )!.changed
    ).toEqual({})
    const gone = changedTo(
      { service: "web", key: "plain", name: "NODE_ENV" },
      undefined
    )
    expect(
      screenRows(gone.services[0]!, DESIGN_SETTINGS).find(
        (row) => row.label === "plain"
      )
    ).toMatchObject({ shown: "none", changed: {} })
    expect(
      screenRows(WORKER, DESIGN_SETTINGS).find((row) => row.label === "plain")!
        .changed
    ).toBeUndefined()
  })

  test("secrets compare as a list, in order", () => {
    const deployed = changedTo(
      { service: "web", key: "secrets" },
      "SESSION_KEY, DATABASE_URL"
    )
    expect(
      screenRows(WEB, deployed).find((row) => row.label === "secrets")!.changed
    ).toEqual({ was: "SESSION_KEY, DATABASE_URL" })
  })

  test("without the deployed settings nothing is marked", () => {
    expect(screenRows(WEB).some((row) => row.changed)).toBe(false)
    expect(
      reportOf(DESIGN_SETTINGS)
        .services.flatMap((service) => service.rows)
        .some((row) => row.changed)
    ).toBe(false)
  })
})

test("every value shown, an old one too, is cleaned", () => {
  const hidden = "\u202e\u200b\u2066"
  const settings: Settings = {
    version: 1,
    services: [["web", { image: "nginx:1.27", plain: [["A", `x${hidden}y`]] }]],
  }
  const deployed: Settings = {
    version: 1,
    services: [
      ["web", { image: "nginx:1.27", plain: [["A", `old${hidden}`]] }],
    ],
  }
  const row = screenRows(settings.services[0]!, deployed).find(
    (each) => each.label === "plain"
  )!
  expect(row.shown).toBe("A=xy")
  expect(row.changed).toEqual({ was: "A=old" })
  expect(reportOf(settings).services[0]!.rows.at(-1)!.shown).toBe("A=xy")
})
