/**
 * The settings screen's two rows of feature 015 (specs/015-domains-https,
 * line E6; board `DomainsApp`, "The settings screen"; contracts/cli.md, CL1;
 * tasks T073, T075, T077): `health` under Deploy after `cpus`, `domains`
 * under Networking after `published`, one domain a row, labelled once; the
 * label dim, the value in the text colour, a mark in the warning colour. They
 * are changed as every other setting is: `enter` opens the value to type,
 * filled in (the list, comma-separated; the path, or `up`), then the one
 * question, and only `y` asks for the write.
 */
import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"
import { join } from "node:path"

import { AppView } from "../../src/app/app"
import type { State } from "../../src/app/state/types"
import type { Settings } from "../../src/settings/types"
import { drawnInColour, plainOf, wordRuns, type Run } from "../support/colour"
import { DESIGN_SETTINGS } from "../support/settings-files"
import {
  effectsOf,
  K,
  opened,
  play,
  settingsRead,
  text,
  typing,
  withMemory,
} from "../support/settings-view"

/** design.md's file with web's health check and domains, as on the board. */
const withRoutes = (
  settings: Settings,
  domains: string[],
  path: string | null = "/health"
): Settings => ({
  version: 1,
  services: settings.services.map(([name, service]) =>
    name === "web"
      ? [
          name,
          {
            ...service,
            health: path === null ? {} : { path },
            domains,
          },
        ]
      : [name, service]
  ),
})

const BOARD = withRoutes(DESIGN_SETTINGS, ["shop.example.com"])
/** What the last deploy had: the board's file with the memory at 512m. */
const DEPLOYED = withMemory(BOARD, "512m")

const onBoard = (
  settings: Settings = BOARD,
  deployed: Settings = DEPLOYED,
  size = { columns: 100, rows: 30 }
): State =>
  play(
    opened(size),
    settingsRead(settings, { deployed }),
    K.down,
    K.down,
    K.down
  ).state

const draw = (state: State) =>
  renderToString(
    <AppView
      state={state}
      columns={state.size.columns}
      rows={state.size.rows}
    />,
    { columns: state.size.columns }
  )
    .split("\n")
    .map((line) => line.trimEnd())

const inColour = (state: State) =>
  drawnInColour(
    join(import.meta.dir, "../../src/app/app.tsx"),
    "AppView",
    { state, columns: state.size.columns, rows: state.size.rows },
    state.size.columns
  ).split("\n")

/** The service pane's rows, as text, from the line under its first. */
const pane = (lines: string[]) =>
  lines.slice(6, 26).map((line) => [...line].slice(26, 97).join("").trimEnd())

/** The runs of the service pane on the line whose text holds `part`: after the Services pane's two borders and its own. */
function runsAt(lines: string[], part: string): Run[] {
  const line = lines.find((each) => plainOf(each).includes(part))
  if (line === undefined) throw new Error(`no line with ${part}`)
  const runs = wordRuns(line)
  let borders = 0
  return runs.slice(
    runs.findIndex((run) => run.text === "│" && ++borders === 3) + 1,
    -1
  )
}

const look = (
  words: string,
  options: { bold?: boolean; dim?: boolean; color?: string } = {}
): Run => ({
  text: words,
  bold: options.bold ?? false,
  dim: options.dim ?? false,
  ...(options.color === undefined ? {} : { color: options.color }),
})

describe("the two rows (board DomainsApp), 100 by 30", () => {
  test("health after cpus, domains after published, in the board's order", () => {
    const lines = draw(onBoard())
    expect(pane(lines).slice(0, 18)).toEqual([
      "Source",
      "  image      ghcr.io/acme/demo-web:1.4.2",
      "Deploy",
      "  start      bun run start",
      "  restart    on failure",
      "❯ memory     1g  ! changed, not deployed (was 512m)",
      "  cpus       1",
      "  health     GET /health, within 60s",
      "Networking",
      "  port       3000",
      "  published  not published",
      "  domains    shop.example.com",
      "Variables",
      "  secrets    DATABASE_URL, SESSION_KEY",
      "  plain      NODE_ENV=production",
      "Volumes",
      "  uploads    /data/uploads",
      "",
    ])
  })

  test("in colour: the labels dim, the values in the text colour; a domain the last deploy did not route marked in the warning colour", () => {
    const two = withRoutes(DESIGN_SETTINGS, [
      "shop.example.com",
      "www.example.com",
    ])
    const lines = inColour(onBoard(two))
    expect(runsAt(lines, "GET /health")).toEqual([
      look("health", { dim: true }),
      look("GET /health, within 60s"),
    ])
    expect(runsAt(lines, "shop.example.com")).toEqual([
      look("domains", { dim: true }),
      look("shop.example.com"),
    ])
    // The second domain: no label of its own, and new since the last deploy.
    expect(runsAt(lines, "www.example.com")).toEqual([
      look("www.example.com"),
      look("! changed, not deployed", { color: "yellow" }),
    ])
    expect(draw(onBoard(two))).toContain(
      " │                    │ │   domains    shop.example.com                                           │"
    )
    expect(draw(onBoard(two))).toContain(
      " │                    │ │              www.example.com  ! changed, not deployed                   │"
    )
  })

  test("not set: `health  not set` and `domains  none`, dim; a health check with no path reads `stays up`", () => {
    const lines = inColour(onBoard(DESIGN_SETTINGS, DESIGN_SETTINGS))
    expect(runsAt(lines, "health")).toEqual([
      look("health", { dim: true }),
      look("not set", { dim: true }),
    ])
    expect(runsAt(lines, "domains")).toEqual([
      look("domains", { dim: true }),
      look("none", { dim: true }),
    ])
    const up = withRoutes(DESIGN_SETTINGS, [], null)
    expect(pane(draw(onBoard(up, up)))).toContain(
      "  health     stays up, within 60s"
    )
  })
})

describe("changed as every other setting is", () => {
  /** The board's state with the row of `label` selected: from memory, down to it. */
  const on = (label: "health" | "domains", settings = BOARD) =>
    play(
      onBoard(settings),
      ...Array.from({ length: label === "health" ? 2 : 5 }, () => K.down)
    ).state

  test("enter on domains: the list to type, filled in; then the question; only y asks for the write", () => {
    const typing0 = play(on("domains"), K.enter).state
    const screen = typing0.stack.at(-1)!
    expect(screen).toMatchObject({
      name: "settings",
      change: {
        path: { service: "web", key: "domains" },
        stage: "typing",
        typed: "shop.example.com",
      },
    })
    const asked = play(typing0, ...typing(", www.example.com"), K.enter).state
    expect(asked.stack.at(-1)).toMatchObject({
      change: {
        stage: "asking",
        now: "shop.example.com",
        next: {
          value: "shop.example.com, www.example.com",
          shown: "shop.example.com, www.example.com",
        },
      },
    })
    expect(effectsOf(asked, text("n"))).toEqual([])
    expect(effectsOf(asked, text("y"))).toEqual([
      {
        kind: "write-setting",
        server: "prod",
        app: "demo",
        path: { service: "web", key: "domains" },
        value: "shop.example.com, www.example.com",
        sha256: "a".repeat(64),
      },
    ])
  })

  test("enter on health: the path to type, filled in, or `up` for a check without one", () => {
    expect(play(on("health"), K.enter).state.stack.at(-1)).toMatchObject({
      change: { path: { service: "web", key: "health" }, typed: "/health" },
    })
    const up = withRoutes(DESIGN_SETTINGS, ["shop.example.com"], null)
    expect(play(on("health", up), K.enter).state.stack.at(-1)).toMatchObject({
      change: { path: { service: "web", key: "health" }, typed: "up" },
    })
  })

  test("80 by 24: the window of rows reaches both, and nothing passes the window", () => {
    let state = play(
      opened({ columns: 80, rows: 24 }),
      settingsRead(BOARD, { deployed: DEPLOYED })
    ).state
    const seen = new Set<string>()
    for (let row = 0; row < 14; row++) {
      const lines = draw(state)
      expect(lines.length).toBeLessThanOrEqual(24)
      for (const line of lines) {
        expect([...line].length).toBeLessThanOrEqual(80)
        if (line.includes("❯ health")) seen.add("health")
        if (line.includes("❯ domains")) seen.add("domains")
      }
      state = play(state, K.down).state
    }
    expect([...seen].sort()).toEqual(["domains", "health"])
  })
})
