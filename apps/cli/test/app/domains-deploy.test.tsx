/**
 * The app's deploy screen with a domain or a health check
 * (specs/015-domains-https, contracts/cli.md, CL3; lines B1 to B6, C1, C2,
 * E8; board `DomainsApp`, "The deploy screen"; tasks T072, T075, T077),
 * drawn from the reducer's events: B1 above the panel; the panel's `domains`
 * row after the secrets; the fifth stage, and C2 in the live line's place,
 * without the seconds the header counts; each new domain's wait for HTTPS,
 * and its end under the result; `✖ Healthy` and the sentence after `✖` when
 * it was not healthy in time. In colour as on the boards. At 80 columns and
 * in a short window nothing new overflows.
 */
import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"
import { join } from "node:path"

import { AppView } from "../../src/app/app"
import type { AppEvent } from "../../src/app/state/events"
import { initialState, update } from "../../src/app/state/state"
import type { State, TeamView } from "../../src/app/state/types"
import { B6, C3 } from "../../src/domains/words"
import { withoutBackticks } from "../../src/ui/ink/marks"
import {
  asDate,
  drawnInColour,
  plainOf,
  wordRuns,
  type Run,
} from "../support/colour"

const SIZE = { columns: 100, rows: 30 }
const BRAND = "#2383e2"
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

const TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod-1",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [{ name: "shop", deploy: 42, state: "unknown" }],
    },
  ],
}

const play = (state: State, ...events: AppEvent[]): State =>
  events.reduce((current, event) => update(current, event).state, state)

const HEALTH = { timeout: 60, services: [{ service: "web", path: "/health" }] }

/** Deploy 43 of shop from the app, as on the board: its panel and its stages up to `starting`. */
const started = (
  size = SIZE,
  signs: { domains?: string[]; health?: typeof HEALTH } = {
    domains: ["shop.example.com"],
    health: HEALTH,
  }
): State =>
  play(
    initialState({ kind: "team", team: TEAM }, size),
    {
      type: "deploy-started",
      server: "prod-1",
      app: "shop",
      at: Date.now() - 9400,
      from: "~/code/shop/zekno.app.json",
      replaces: 42,
      secretNames: ["DATABASE_URL", "SESSION_KEY"],
    },
    {
      type: "deploy-stage",
      stage: "checked",
      sequence: 43,
      secrets: 2,
      format: 2,
      secretNames: ["DATABASE_URL", "SESSION_KEY"],
      ...signs,
    },
    { type: "deploy-stage", stage: "signed", sequence: 43, secrets: 2 },
    { type: "deploy-stage", stage: "sent", sequence: 43, secrets: 2 },
    { type: "deploy-stage", stage: "starting", sequence: 43, secrets: 2 }
  )

const waiting = (state: State) =>
  play(state, { type: "deploy-health", service: "web", at: Date.now() })

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

function runsAt(lines: string[], part: string): Run[] {
  const line = lines.find((each) => plainOf(each).includes(part))
  if (line === undefined) throw new Error(`no line with ${part}`)
  return wordRuns(line)
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
const green = (text: string) => look(text, { color: "green" })

function fits(lines: string[], columns: number, rows: number) {
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines)
    expect([...line].length).toBeLessThanOrEqual(columns)
}

/**
 * Nothing pressed together: the panel whole (its top line once, its last
 * line followed by an empty one), the stage row between empty lines, and,
 * while the deploy runs, the line that says leaving does not cancel it.
 */
function whole(lines: string[], running: boolean) {
  expect(lines.filter((line) => line.includes("╭─ Deploy 43"))).toHaveLength(1)
  const bottom = lines.findIndex((line) => line.startsWith("   ╰"))
  expect(lines[bottom + 1]).toBe("")
  const stages = lines.findIndex((line) => line.includes("✔ Checked"))
  expect(stages).toBe(bottom + 2)
  expect(lines[stages + 1]).toBe("")
  if (running)
    expect(lines.some((line) => line.includes("Leaving this screen"))).toBe(
      true
    )
}

/** The four stages done, in colour. */
const FOUR_DONE = ["Checked", "Signed", "Sent", "Started"].flatMap((label) => [
  green("✔"),
  look(label),
])

describe("the deploy screen (board DomainsApp), 100 by 30", () => {
  test("line by line, while web's health is waited for: the domains row, the fifth stage in progress, C2 without seconds", () => {
    const lines = draw(waiting(started()))
    fits(lines, 100, 30)
    expect(lines[2]).toMatch(/› prod-1 › shop › deploy +\d+\.\ds$/)
    const rule = "─".repeat(50)
    expect(lines.slice(3, 15)).toEqual([
      "",
      `   ╭─ Deploy 43 ${rule}╮`,
      "   │ app       shop                                               │",
      "   │ server    prod-1                                             │",
      "   │ from      ~/code/shop/zekno.app.json                         │",
      "   │ secrets   2 (DATABASE_URL, SESSION_KEY)                      │",
      "   │ domains   shop.example.com                                   │",
      "   │ replaces  deploy 42                                          │",
      `   ╰${"─".repeat(62)}╯`,
      "",
      expect.stringMatching(
        /^ {3}✔ Checked {3}✔ Signed {3}✔ Sent {3}✔ Started {3}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Healthy$/
      ),
      "",
    ])
    expect(lines[15]).toBe("   waiting for web to answer GET /health")
    expect(lines.slice(-4)).toEqual([
      "   Leaving this screen does not cancel the deploy. Quitting zekno waits for it to finish.",
      "",
      "",
      " o show Docker's output  esc back, deploy keeps going",
    ])
  })

  test("in colour: the row's label dim, the stage in progress after the brand spinner, C2 dim", () => {
    const lines = inColour(waiting(started()))
    expect(runsAt(lines, "domains")).toEqual([
      look("│", { color: BRAND }),
      look("domains", { dim: true }),
      look("shop.example.com"),
      look("│", { color: BRAND }),
    ])
    const stages = runsAt(lines, "Healthy")
    expect(stages.slice(0, 8)).toEqual(FOUR_DONE)
    expect(stages[8]).toMatchObject({ color: BRAND })
    expect(SPINNER.test(stages[8]!.text)).toBe(true)
    expect(stages[9]).toEqual(look("Healthy", { bold: true }))
    expect(runsAt(lines, "waiting for")).toEqual([
      look("waiting for web to answer GET /health", { dim: true }),
    ])
  })

  test("B1 above the panel, an empty line apart: ✔ green, the words, the address dim", () => {
    const state = play(started(), {
      type: "deploy-pointed",
      domain: "shop.example.com",
      address: "203.0.113.7",
    })
    const lines = draw(state)
    fits(lines, 100, 30)
    expect(lines.slice(3, 7)).toEqual([
      "",
      "   ✔ shop.example.com points to prod-1  203.0.113.7",
      "",
      `   ╭─ Deploy 43 ${"─".repeat(50)}╮`,
    ])
    expect(runsAt(inColour(state), "points to")).toEqual([
      green("✔"),
      look("shop.example.com points to prod-1"),
      look("203.0.113.7", { dim: true }),
    ])
  })

  test("the wait for HTTPS: B4 in the live line's place; once it ends, B5 and B6 under the result", () => {
    const healthy = play(
      waiting(started()),
      { type: "deploy-stage", stage: "started", sequence: 43, secrets: 2 },
      {
        type: "deploy-https",
        shown: {
          domain: "shop.example.com",
          state: "waiting",
          since: Date.now(),
        },
      }
    )
    const during = draw(healthy)
    expect(during[13]).toMatch(
      /^ {3}✔ Checked {3}✔ Signed {3}✔ Sent {3}✔ Started {3}✔ Healthy$/
    )
    expect(during[15]).toMatch(
      /^ {3}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Waiting for the certificate of shop\.example\.com {2}\d+s$/
    )
    const [spinner, words, count] = runsAt(inColour(healthy), "Waiting")
    expect(spinner).toMatchObject({ bold: false, dim: false, color: BRAND })
    expect(words).toEqual(
      look("Waiting for the certificate of shop.example.com")
    )
    expect(count).toMatchObject({ dim: true })

    const ended = play(
      healthy,
      {
        type: "deploy-https",
        shown: {
          domain: "shop.example.com",
          state: "live",
          until: asDate("2027-02-17T12:00:00Z"),
        },
      },
      {
        type: "deploy-https",
        shown: { domain: "www.example.com", state: "not_ready" },
      },
      {
        type: "deploy-ended",
        outcome: "started",
        notice: { tone: "success", text: "shop is live on prod-1 in 9.4s" },
        at: Date.now(),
      }
    )
    const lines = inColour(ended)
    expect(
      lines
        .map((line) => plainOf(line).trimEnd())
        .filter(
          (line) => line.startsWith("   ✔ shop") || /^ {3}[✔!] /.test(line)
        )
        .slice(-3)
    ).toEqual([
      "   ✔ shop is live on prod-1 in 9.4s",
      "   ✔ https://shop.example.com is live  certificate until 17 Feb 2027",
      `   ! ${withoutBackticks(B6("www.example.com"))}`,
    ])
    expect(runsAt(lines, "https://")).toEqual([
      green("✔"),
      look("https://shop.example.com is live"),
      look("certificate until 17 Feb 2027", { dim: true }),
    ])
    expect(runsAt(lines, "not ready yet")).toEqual([
      look("!", { color: "yellow" }),
      look(withoutBackticks(B6("www.example.com"))),
    ])
  })

  test("not healthy in time: ✔ Started, ✖ Healthy in red, C3 after ✖, the first sentence bold; no number said", () => {
    const text = C3("web", "/health", 60, "shop")
    const state = play(
      waiting(started()),
      { type: "deploy-stage", stage: "started", sequence: 43, secrets: 2 },
      {
        type: "deploy-ended",
        outcome: "unhealthy",
        notice: { tone: "error", text },
        at: Date.now(),
      }
    )
    const lines = inColour(state)
    expect(runsAt(lines, "Healthy")).toEqual([
      ...FOUR_DONE,
      look("✖ Healthy", { color: "red" }),
    ])
    expect(runsAt(lines, "did not answer")).toEqual([
      look("✖", { color: "red" }),
      look("web did not answer GET /health with success within 60 seconds.", {
        bold: true,
      }),
    ])
    expect(draw(state).join("\n")).not.toContain("Number 43 is used")
  })

  test("a deploy with neither: the panel and the four stages as before", () => {
    const plain = started(SIZE, {})
    const lines = draw(plain)
    expect(lines.join("\n")).not.toContain("domains")
    expect(lines[12]).toMatch(
      /^ {3}✔ Checked {3}✔ Signed {3}✔ Sent {3}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Starting$/
    )
  })
})

describe("the deploy screen at 80 columns and in a short window", () => {
  /** Each moment of a deploy with `count` domains, all new, and the health check, in a window of `size`, with or without a warning above the hints. */
  function moments(size: typeof SIZE, count: number, warned: boolean) {
    const domains = Array.from(
      { length: count },
      (_, at) => `a-rather-long-name-${at}.example.com`
    )
    const notice: AppEvent[] = warned
      ? [
          {
            type: "notice",
            notice: { tone: "warning", text: "DNS was not checked for x." },
          },
        ]
      : []
    const pointed = play(
      started(
        size,
        count === 0 ? { health: HEALTH } : { domains, health: HEALTH }
      ),
      ...domains.map((domain): AppEvent => ({
        type: "deploy-pointed",
        domain,
        address: "203.0.113.7",
      })),
      ...notice
    )
    const health = waiting(pointed)
    const https = play(
      health,
      { type: "deploy-stage", stage: "started", sequence: 43, secrets: 2 },
      ...domains.map((domain): AppEvent => ({
        type: "deploy-https",
        shown: { domain, state: "waiting", since: Date.now() },
      }))
    )
    const ended = play(
      https,
      ...domains.map((domain): AppEvent => ({
        type: "deploy-https",
        shown: { domain, state: "not_ready" },
      })),
      {
        type: "deploy-ended",
        outcome: "started",
        notice: { tone: "success", text: "shop is live on prod-1 in 9.4s" },
        at: Date.now(),
      }
    )
    const unhealthy = play(
      health,
      { type: "deploy-stage", stage: "started", sequence: 43, secrets: 2 },
      {
        type: "deploy-ended",
        outcome: "unhealthy",
        notice: { tone: "error", text: C3("web", "/health", 60, "shop") },
        at: Date.now(),
      }
    )
    return [
      [pointed, true],
      [health, true],
      [https, true],
      [ended, false],
      [unhealthy, false],
    ] as const
  }

  test("80 by 24 and 100 by 30, up to eight domains, B1 for each, a warning or none: nothing past the window, nothing pressed together", () => {
    for (const size of [{ columns: 80, rows: 24 }, SIZE])
      for (const count of [0, 1, 3, 5, 8])
        for (const warned of [false, true])
          for (const [state, running] of moments(size, count, warned)) {
            const lines = draw(state)
            fits(lines, size.columns, size.rows)
            whole(lines, running)
            // The domains are always said: named, or counted in `and N more`.
            if (count > 0)
              expect(
                lines.some(
                  (line) =>
                    line.includes("a-rather-long-name-0") ||
                    line.includes(`and ${count} more`)
                )
              ).toBe(true)
          }
  })

  test("80 by 24 with five domains: the end of the wait first, as far as it fits; the panel counts the domains it has no room to name", () => {
    const [, , , [ended]] = moments({ columns: 80, rows: 24 }, 5, false)
    const lines = draw(ended)
    expect(lines).toContain(
      "   │ domains   and 5 more                                         │"
    )
    expect(lines.filter((line) => line.startsWith("   ! "))).toHaveLength(2)
    expect(lines.at(-1)).toBe(" o show Docker's output  esc back")
    // At 100 by 30, while web's health is waited for, the panel names the first three, as at a terminal.
    const [, [wide]] = moments(SIZE, 5, false)
    expect(draw(wide)).toContain(
      "   │           and 2 more                                         │"
    )
  })
})
