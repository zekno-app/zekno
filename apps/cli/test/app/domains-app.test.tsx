/**
 * The `Domains` box of an app's screen (specs/015-domains-https, line E7;
 * board `DomainsApp`, "An app's screen"; tasks T074, T075, T077), drawn from
 * the reducer's events: under `Secrets`, which is then as tall as what it
 * holds; each domain, and its state under it after its mark in its tone; the
 * foot, dim. It only shows, so its border and title are faint. An app with no
 * domain, or not read yet, has no box and its screen is as before. At 80
 * columns and in a short window nothing new overflows.
 */
import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"
import { join } from "node:path"

import { AppView } from "../../src/app/app"
import type { AppEvent } from "../../src/app/state/events"
import { initialState, update } from "../../src/app/state/state"
import type { AppDomainRow, State, TeamView } from "../../src/app/state/types"
import { E7_NOTE } from "../../src/domains/words"
import { drawnInColour, plainOf, wordRuns, type Run } from "../support/colour"

const TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod-1",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [
        {
          name: "shop",
          deploy: 2,
          state: "running",
          outcome: "started",
          accepted: 2,
        },
      ],
    },
  ],
}

/** The board's two domains: one live, one whose DNS points elsewhere. */
const BOARD_ROWS: AppDomainRow[] = [
  { domain: "shop.example.com", state: "live", words: "live" },
  {
    domain: "www.example.com",
    state: "dns-elsewhere",
    words: "DNS points elsewhere",
  },
]

const play = (state: State, ...events: AppEvent[]): State =>
  events.reduce((current, event) => update(current, event).state, state)

/** shop's screen on prod-1, its two secrets read, and its Domains box when `rows` are given. */
function onShop(
  rows: AppDomainRow[] | undefined,
  size = { columns: 100, rows: 30 },
  secrets = ["DATABASE_URL", "SESSION_KEY"]
): State {
  const home = initialState({ kind: "team", team: TEAM }, size)
  const state: State = {
    ...home,
    stack: [
      ...home.stack,
      {
        name: "app",
        server: "prod-1",
        app: "shop",
        pane: "deploys",
        deploy: 0,
        secret: 0,
      },
    ],
  }
  const read = play(state, {
    type: "app-view",
    server: "prod-1",
    app: "shop",
    deploys: [],
    secrets: secrets.map((name) => ({ name, version: 1, removed: false })),
  })
  return rows === undefined
    ? read
    : play(read, { type: "app-domains", server: "prod-1", app: "shop", rows })
}

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

/** The window's lines in colour, as a terminal that shows every colour receives them. */
const inColour = (state: State) =>
  drawnInColour(
    join(import.meta.dir, "../../src/app/app.tsx"),
    "AppView",
    { state, columns: state.size.columns, rows: state.size.rows },
    state.size.columns
  ).split("\n")

/** The right-hand column of the panes at 100 columns, where Secrets and Domains are. */
const right = (lines: string[]) =>
  lines.slice(4, 26).map((line) => [...line].slice(63).join(""))

/** Every line within `columns`, and no more lines than `rows`. */
function fits(lines: string[], columns: number, rows: number) {
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines)
    expect([...line].length).toBeLessThanOrEqual(columns)
}

/** The runs of a coloured line from the right column's border on: after the Deploys pane's two borders. */
function rightRuns(line: string): Run[] {
  const runs = wordRuns(line)
  let borders = 0
  const at = runs.findIndex((run) => run.text === "│" && ++borders === 3)
  return runs.slice(at)
}

/** The runs of the right column on the line whose text holds `part`. */
function runsAt(lines: string[], part: string): Run[] {
  const line = lines.find((each) => plainOf(each).includes(part))
  if (line === undefined) throw new Error(`no line with ${part}`)
  return rightRuns(line)
}

const look = (
  text: string,
  options: { bold?: boolean; dim?: boolean; color?: string } = {}
): Run => ({
  text,
  bold: options.bold ?? false,
  dim: options.dim ?? false,
  ...(options.color === undefined ? {} : { color: options.color }),
})

describe("the Domains box (board DomainsApp), 100 by 30", () => {
  test("line by line: Secrets as tall as it holds, Domains under it to the foot of the panes", () => {
    const lines = draw(onShop(BOARD_ROWS))
    fits(lines, 100, 30)
    const rule = "─".repeat(34)
    expect(right(lines)).toEqual([
      `╭${rule}╮`,
      "│ Secrets                          │",
      "│                                  │",
      "│   DATABASE_URL       version 1   │",
      "│   SESSION_KEY        version 1   │",
      "│   + set a secret                 │",
      "│ Values are never shown. To       │",
      "│ change one, set it again.        │",
      `╰${rule}╯`,
      `╭${rule}╮`,
      "│ Domains                          │",
      "│                                  │",
      "│   shop.example.com               │",
      "│     ● live                       │",
      "│   www.example.com                │",
      "│     ● DNS points elsewhere       │",
      "│                                  │",
      "│                                  │",
      "│                                  │",
      `│ ${E7_NOTE[0].padEnd(33)}│`,
      `│ ${E7_NOTE[1].padEnd(33)}│`,
      `╰${rule}╯`,
    ])
  })

  test("in colour: the border and title faint, the names plain, each state after its mark in its tone, the foot dim", () => {
    const lines = inColour(onShop(BOARD_ROWS))
    expect(runsAt(lines, "Domains")).toEqual([
      look("│", { dim: true }),
      look("Domains", { bold: true, dim: true }),
      look("│", { dim: true }),
    ])
    expect(runsAt(lines, "shop.example.com")).toEqual([
      look("│", { dim: true }),
      look("shop.example.com"),
      look("│", { dim: true }),
    ])
    expect(runsAt(lines, "● live")[1]).toEqual(
      look("● live", { color: "green" })
    )
    expect(runsAt(lines, "DNS points")[1]).toEqual(
      look("● DNS points elsewhere", { color: "red" })
    )
    for (const note of E7_NOTE)
      expect(runsAt(lines, note)[1]).toEqual(look(note, { dim: true }))
    // Secrets keeps the keys' look: tab gives it the brand border, the Domains box stays faint.
    const secrets = inColour(
      play(onShop(BOARD_ROWS), { type: "key", key: { kind: "tab" } })
    )
    expect(runsAt(secrets, "Secrets")[0]).toEqual(
      look("│", { color: "#2383e2" })
    )
    expect(runsAt(secrets, "Domains")[0]).toEqual(look("│", { dim: true }))
  })

  test("every state: its mark and its words, never colour alone", () => {
    const rows: AppDomainRow[] = [
      { domain: "a.example.com", state: "live", words: "live" },
      { domain: "b.example.com", state: "renewing", words: "live" },
      {
        domain: "c.example.com",
        state: "waiting",
        words: "no certificate yet",
      },
      { domain: "d.example.com", state: "no-dns", words: "no DNS record" },
      { domain: "e.example.com", state: "down", words: "not answering" },
      { domain: "f.example.com", state: "not-deployed", words: "not deployed" },
      { domain: "g.example.com", state: "releasing", words: "to be released" },
      { domain: "h.example.com", state: "taken", words: "belongs to blog" },
    ]
    const state = onShop(rows, { columns: 100, rows: 44 })
    fits(draw(state), 100, 44)
    const lines = inColour(state)
    const stateOf = (domain: string) => {
      const at = lines.findIndex((line) => plainOf(line).includes(domain))
      return rightRuns(lines[at + 1]!)[1]
    }
    expect(rows.map((row) => stateOf(row.domain))).toEqual([
      look("● live", { color: "green" }),
      look("● live", { color: "yellow" }),
      look("● no certificate yet", { color: "yellow" }),
      look("● no DNS record", { color: "red" }),
      look("● not answering", { color: "red" }),
      look("○ not deployed", { dim: true }),
      look("○ to be released", { dim: true }),
      look("✖ belongs to blog", { color: "red" }),
    ])
  })

  test("no box: before it is read, for an app without a domain, and for another app's rows; the screen is as before", () => {
    const before = draw(onShop(undefined))
    expect(before.join("\n")).not.toContain("Domains")
    expect(draw(onShop([]))).toEqual(before)
    const other = play(onShop(undefined), {
      type: "app-domains",
      server: "prod-1",
      app: "blog",
      rows: BOARD_ROWS,
    })
    expect(draw(other)).toEqual(before)
  })
})

describe("the Domains box at 80 columns and in a short window", () => {
  const NARROW = { columns: 80, rows: 24 }

  test("80 by 24: it fits; the box has no foot; a state too long is cut at a word", () => {
    const lines = draw(onShop(BOARD_ROWS, NARROW))
    fits(lines, 80, 24)
    const text = lines.join("\n")
    expect(text).toContain("│   shop.example.com      │")
    expect(text).toContain("│     ● live              │")
    expect(text).toContain("│     ● DNS points        │")
    expect(text).not.toContain(E7_NOTE[0])
    expect(text).toContain("│ Values are never shown. │")
  })

  test("many domains and many secrets in the smallest window: nothing overflows, rows whole, the box keeps its title", () => {
    const rows = Array.from({ length: 30 }, (_, at): AppDomainRow => ({
      domain: `d${String(at).padStart(2, "0")}.example.com`,
      state: "live",
      words: "live",
    }))
    const secrets = Array.from({ length: 12 }, (_, at) => `SECRET_${at}`)
    for (const size of [NARROW, { columns: 100, rows: 30 }]) {
      const lines = draw(onShop(rows, size, secrets))
      fits(lines, size.columns, size.rows)
      const text = lines.join("\n")
      expect(text).toContain("Domains")
      expect(text).toContain("Secrets")
      // A domain is never drawn without its state under it, nor over another row.
      const names = lines.filter((line) => /d\d\d\.example\.com/.test(line))
      for (const name of names) {
        const at = lines.indexOf(name)
        expect(lines[at + 1]).toContain("● live")
      }
      // The panes end where they always did: the hints right after them.
      expect(lines.at(-1)).toContain("esc back")
    }
  })

  test("a window too small shows the too-small screen, the box with it", () => {
    const lines = draw(onShop(BOARD_ROWS, { columns: 79, rows: 23 }))
    expect(lines.join("\n")).not.toContain("Domains")
    fits(lines, 79, 23)
  })
})
