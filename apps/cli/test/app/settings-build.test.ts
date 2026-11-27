/**
 * Changing a Build row on the settings screen (specs/016-build-from-source,
 * lines.md J15 to J18; contracts/cli.md CL1; tasks T137): `enter` on a row
 * of a built service opens its value as the file holds it, the value is
 * checked by the rules `zekno settings set` uses (settings/build-values.ts),
 * and `y` asks to write it. Until the words tasks a refusal, and the row's
 * label and question in the panel, are said by the line's id (FR-092): ids
 * are checked here, never words. The reducer only; nothing reads a file.
 */
import { describe, expect, test } from "bun:test"

import { boxLines } from "../../src/app/screens/settings-change"
import type { AppEvent } from "../../src/app/state/events"
import { top } from "../../src/app/state/reading"
import type { State } from "../../src/app/state/types"
import type { Settings } from "../../src/settings/types"
import { themeFor } from "../../src/ui/terminal/theme"
import {
  effectsOf,
  K,
  opened,
  play,
  settingsRead,
  text,
  typing,
} from "../support/settings-view"

const SHA = "c".repeat(64)

/** One built service: its include list, Dockerfile and time limit set, its stage and network not. */
const BUILT: Settings = {
  version: 1,
  services: [
    [
      "web",
      {
        include: [".env.build", "keys/deploy.pem"],
        build: {
          builder: "dockerfile",
          dockerfile: "docker/Dockerfile",
          timeout: 600,
        },
        port: 3000,
      },
    ],
  ],
}

/** The rows of the built service, in order (J15, J16): Source's root and include, then Build's. */
const ROW = {
  root: 0,
  include: 1,
  builder: 2,
  dockerfile: 3,
  stage: 4,
  "build-timeout": 5,
  "build-network": 6,
} as const

const downs = (n: number): AppEvent[] => Array.from({ length: n }, () => K.down)
const erase = (n: number): AppEvent[] =>
  Array.from({ length: n }, () => K.backspace)

/** The settings screen of the built service, on `row`. */
const onRow = (row: number): State =>
  play(opened(), settingsRead(BUILT, { sha256: SHA }), ...downs(row)).state

const changeOf = (state: State) => {
  const screen = top(state)
  if (screen.name !== "settings") throw new Error(`on ${screen.name}`)
  return screen.change
}

describe("a Build row changed on the settings screen (J18)", () => {
  test("enter opens the value as the file holds it; a setting not set opens empty", () => {
    const open = (key: keyof typeof ROW) =>
      changeOf(play(onRow(ROW[key]), K.enter).state)
    expect(open("dockerfile")).toMatchObject({
      path: { service: "web", key: "dockerfile" },
      stage: "typing",
      typed: "docker/Dockerfile",
      now: "docker/Dockerfile",
      sha256: SHA,
    })
    expect(open("build-timeout")).toMatchObject({ typed: "600", now: "600" })
    expect(open("include")?.typed).toBe(".env.build, keys/deploy.pem")
    expect(open("builder")).toMatchObject({
      stage: "typing",
      typed: "dockerfile",
    })
    // Not set: empty, and its value now is the id of its row (G4) until the words tasks.
    expect(open("stage")).toMatchObject({ typed: "", now: "G4" })
    expect(open("root")).toMatchObject({ typed: "", now: "G1" })
  })

  test("a value its rule refuses keeps the question open, with the line's id; nothing is asked", () => {
    const state = play(
      onRow(ROW.stage),
      K.enter,
      ...typing("not a stage"),
      K.enter
    )
    expect(changeOf(state.state)).toMatchObject({
      stage: "typing",
      typed: "not a stage",
      reason: "G20",
    })
    expect(state.effects).toEqual([])
  })

  test("the builder of a built service cannot be emptied: G17", () => {
    const state = play(onRow(ROW.builder), K.enter, ...erase(10), K.enter)
    expect(changeOf(state.state)).toMatchObject({
      stage: "typing",
      reason: "G17",
    })
  })

  test("a value it takes goes on to the question, and y asks to write it with the SHA-256 it was opened on", () => {
    const asking = play(
      onRow(ROW["build-network"]),
      K.enter,
      ...typing("none"),
      K.enter
    ).state
    expect(changeOf(asking)).toMatchObject({
      stage: "asking",
      next: { value: "none", shown: "none" },
    })
    expect(effectsOf(asking, text("y"))).toEqual([
      {
        kind: "write-setting",
        server: "prod",
        app: "demo",
        path: { service: "web", key: "build-network" },
        value: "none",
        sha256: SHA,
      },
    ])
    // Emptied, a setting that is set is removed.
    const removed = play(
      onRow(ROW["build-timeout"]),
      K.enter,
      ...erase(3),
      K.enter
    ).state
    expect(changeOf(removed)).toMatchObject({
      stage: "asking",
      next: { value: undefined },
    })
  })

  test("the panel names the row by its id, as its label and its question, until the words tasks", () => {
    const change = changeOf(play(onRow(ROW.dockerfile), K.enter).state)!
    const drawn = boxLines("web", change, themeFor("dark"), 60).map((line) =>
      line.map((piece) => piece.text).join("")
    )
    expect(drawn.some((line) => line.endsWith("web · G3"))).toBe(true)
    expect(drawn.some((line) => line.includes("G3 › docker/Dockerfile"))).toBe(
      true
    )
  })
})
