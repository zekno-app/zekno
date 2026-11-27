/**
 * The Build section shown (specs/016-build-from-source, contracts/cli.md CL1,
 * "Rows" and "Changed, not deployed"; FR-011; tasks T115): `root` under
 * Source (J15), the Build section between Source and Deploy (G9, J16), values
 * as G10 reads them, only what is set for `zekno settings` and every row for
 * the settings screen, and the changed mark set by a build setting, compared
 * with the builds this machine's history keeps, never by `root` or
 * `include`. No words: labels and settings not set are their rows' ids
 * (FR-092).
 */
import { describe, expect, test } from "bun:test"
import { builtImageName, type Build } from "@workspace/core"

import { composeText, deployedSettings } from "../../src/settings/compose"
import { reportOf, screenRows } from "../../src/settings/rows"
import type {
  ServiceSettings,
  SettingRow,
  Settings,
} from "../../src/settings/types"
import { DESIGN_SETTINGS } from "../support/settings-files"

const APP = "shop"
const KEY = "a".repeat(64)
const hex = (digit: string) => digit.repeat(64)

const BUILT: ServiceSettings = {
  root: "apps/web",
  include: [".env"],
  build: {
    builder: "dockerfile",
    dockerfile: "web.Dockerfile",
    stage: "runner",
    timeout: 3600,
    network: "none",
  },
  port: 3000,
}

const app = (web: ServiceSettings): Settings => ({
  version: 1,
  services: [
    ["web", web],
    ["db", { image: "postgres:16" }],
  ],
})

/** Rows as `section label shown`, with the G10 value, ` (not set)`, and ` !` with the old value when marked. */
const lines = (rows: readonly SettingRow[]): string[] =>
  rows.map((row) => {
    const value = row.value === undefined ? "" : ` ${JSON.stringify(row.value)}`
    const mark =
      row.changed === undefined
        ? ""
        : ` !${row.changed.was === undefined ? "" : ` was ${row.changed.was}`}${
            row.changed.wasValue === undefined
              ? ""
              : ` ${JSON.stringify(row.changed.wasValue)}`
          }`
    return `${row.section} ${row.label} ${row.shown}${value}${row.set ? "" : " (not set)"}${mark}`
  })

const webRows = (settings: Settings, deployed?: Settings) =>
  lines(reportOf(settings, deployed).services[0]!.rows)

/** The build the history keeps for `web` as `settings` would sign it, under KEY. */
function signed(web: ServiceSettings): Build {
  const build = web.build!
  return {
    key: KEY,
    pack: { hash: hex("1"), size: 10, chunks: [hex("2")] },
    builder: {
      name: "dockerfile",
      dockerfile: build.dockerfile ?? "Dockerfile",
      target: build.stage ?? null,
    },
    args: [],
    secrets: [],
    network: build.network === "none" ? "none" : "default",
    timeout: build.timeout ?? 1800,
    fresh: null,
  }
}

/** What the last deploy of `web` had, read back from the Compose text it signed and the history's builds. */
function deployedOf(web: ServiceSettings): Settings {
  const settings = app(web)
  const text = composeText(
    settings,
    new Map([["web", builtImageName(APP, KEY)]])
  )
  const read = deployedSettings(text, [signed(web)])
  if (read === undefined) throw new Error("the deploy was not read back")
  return read
}

describe("reportOf: what `zekno settings` prints for a built service", () => {
  test("root and include under Source, the Build section between Source and Deploy, only what is set", () => {
    expect(webRows(app(BUILT))).toEqual([
      "Source G1 apps/web",
      "Source G8 .env",
      'Build G2 G10 {"builder":"dockerfile"}',
      "Build G3 web.Dockerfile",
      "Build G4 runner",
      'Build G5 G10 {"minutes":60}',
      "Build G6 none",
      "Networking port 3000, not published",
    ])
    expect(webRows(app({ build: { builder: "dockerfile" } }))).toEqual([
      'Build G2 G10 {"builder":"dockerfile"}',
    ])
  })

  test("G10: a time limit in minutes when whole, else in seconds", () => {
    for (const [timeout, value] of [
      [60, { minutes: 1 }],
      [1800, { minutes: 30 }],
      [7200, { minutes: 120 }],
      [90, { seconds: 90 }],
      [1, { seconds: 1 }],
    ] as const) {
      const rows = reportOf(app({ build: { builder: "dockerfile", timeout } }))
        .services[0]!.rows
      expect(rows.find((row) => row.label === "G5")!.value).toEqual(value)
    }
  })

  test("a service that runs an image has no Build section and no root, as today", () => {
    const rows = reportOf(DESIGN_SETTINGS).services.flatMap((s) => s.rows)
    expect(rows.some((row) => row.section === "Build")).toBe(false)
    expect(rows.some((row) => row.label === "G1")).toBe(false)
    expect(webRows(app({ image: "nginx:1.27" }))).toEqual([
      "Source image nginx:1.27",
    ])
  })
})

describe("screenRows: every row of the settings screen, those not set by their row's id (J15, J16)", () => {
  test("a built service with only its builder: Source and Build in place of the image row, the rest as today", () => {
    const service = ["web", { build: { builder: "dockerfile" } }] as const
    const rows = lines(screenRows(service))
    expect(rows.slice(0, 7)).toEqual([
      "Source G1 G1 (not set)",
      "Source G8 G8 (not set)",
      'Build G2 G10 {"builder":"dockerfile"}',
      "Build G3 G3 (not set)",
      "Build G4 G4 (not set)",
      "Build G5 G5 (not set)",
      "Build G6 G6 (not set)",
    ])
    const today = lines(screenRows(["web", { image: "nginx:1.27" }]))
    expect(today[0]).toBe("Source image nginx:1.27")
    expect(rows.slice(7)).toEqual(today.slice(1))
  })

  test("a service that runs an image: today's rows, no Build section", () => {
    const rows = screenRows(["web", { image: "nginx:1.27", port: 80 }])
    expect(rows.some((row) => row.section === "Build")).toBe(false)
    expect(rows.some((row) => row.value !== undefined)).toBe(false)
  })

  test("each row changes its own setting", () => {
    const paths = screenRows(["web", BUILT])
      .filter((row) => row.section === "Source" || row.section === "Build")
      .map((row) => row.path)
    expect(paths).toEqual([
      { service: "web", key: "root" },
      { service: "web", key: "include" },
      { service: "web", key: "builder" },
      { service: "web", key: "dockerfile" },
      { service: "web", key: "stage" },
      { service: "web", key: "build-timeout" },
      { service: "web", key: "build-network" },
    ])
  })
})

describe("changed, not deployed: against the builds of the latest accepted deploy, by the key in their image names", () => {
  test("nothing marked when the file is what was deployed", () => {
    const deployed = deployedOf(BUILT)
    expect(
      webRows(app(BUILT), deployed).some((line) => line.includes("!"))
    ).toBe(false)
    // A setting left out reads as its default, as the deploy signed it.
    const bare = { build: { builder: "dockerfile" }, port: 3000 } as const
    expect(webRows(app(bare), deployedOf(bare))).toEqual([
      'Build G2 G10 {"builder":"dockerfile"}',
      "Networking port 3000, not published",
    ])
  })

  test("a build setting changed is marked, with what was deployed; one set back to its default too", () => {
    const deployed = deployedOf(BUILT)
    const changed = app({
      ...BUILT,
      build: { builder: "dockerfile", dockerfile: "Dockerfile", timeout: 90 },
    })
    expect(webRows(changed, deployed)).toEqual([
      "Source G1 apps/web",
      "Source G8 .env",
      'Build G2 G10 {"builder":"dockerfile"}',
      "Build G3 Dockerfile ! was web.Dockerfile",
      "Build G4 G4 (not set) ! was runner",
      'Build G5 G10 {"seconds":90} ! was G10 {"minutes":60}',
      "Build G6 G6 (not set) ! was none",
      "Networking port 3000, not published",
    ])
  })

  test("root and include are not signed: never marked", () => {
    const deployed = deployedOf(BUILT)
    const moved = app({ ...BUILT, root: "..", include: [".env", "a.key"] })
    expect(
      webRows(moved, deployed).filter((line) => line.includes("!"))
    ).toEqual([])
    const none = app({ build: BUILT.build, port: 3000 })
    expect(
      webRows(none, deployed).filter((line) => line.includes("!"))
    ).toEqual([])
  })

  test("an image now where a build was deployed, and a build where an image was: marked, with no old value of the other kind", () => {
    const deployed = deployedOf(BUILT)
    expect(webRows(app({ image: "nginx:1.27", port: 3000 }), deployed)).toEqual(
      ["Source image nginx:1.27 !", "Networking port 3000, not published"]
    )
    const imaged = app({ image: "nginx:1.27", port: 3000 })
    const fromImage = deployedSettings(composeText(imaged))
    expect(fromImage).toEqual(imaged)
    expect(webRows(app(BUILT), fromImage)[2]).toBe(
      'Build G2 G10 {"builder":"dockerfile"} !'
    )
  })
})
