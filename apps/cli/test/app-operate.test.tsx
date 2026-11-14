import { afterEach, describe, expect, test } from "bun:test"
import { Box, renderToString, Text, type Key } from "ink"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { waitFor } from "../../runner/test/helpers"
import { AppView, createStore } from "../src/app/app"
import { COMPOSE_FILE, createEffects, loadStart, type Effects } from "../src/app/effects"
import { emptyHiddenValue, hiddenPromptKey } from "../src/app/hidden-prompt"
import type { AppKey } from "../src/app/keys"
import { changedNote } from "../src/app/screens/app"
import { lastLines, numberUsed, stagesOf } from "../src/app/screens/deploy"
import { inkRows, rowsOf } from "../src/app/screens/home"
import { HINTS } from "../src/app/screens/placeholder"
import {
  hiddenPromptOpen,
  initialState,
  secretNameProblem,
  top,
  update,
  type AppEvent,
  type DeployProgress,
  type State,
  type TeamView,
} from "../src/app/state"
import { clockTime, relativeTime } from "../src/app/time"
import { appDetails, appsOf, composeServices } from "../src/app/views"
import { openTeam, type OpDeps } from "../src/context"
import { connect, type ConnectOptions, type Target } from "../src/transport"
import { COMPOSE_V1, COMPOSE_V2, filesUnder, machine, ready } from "./helpers"

type Machine = ReturnType<typeof machine>

// ---------------------------------------------------------------------------
// Drawing

const play = (state: State, ...events: AppEvent[]) => events.reduce((current, event) => update(current, event).state, state)
const key = (k: AppKey): AppEvent => ({ type: "key", key: k })
const text = (value: string): AppEvent => key({ kind: "text", text: value })

/** The window as the app draws it. */
const draw = (state: State, columns = 100, rows = 30) => renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns })
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) => screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")
const lastLine = (screen: string) => screen.split("\n").filter((line) => line.trim() !== "").at(-1)!.trim()

/** The words of one pane, the one whose first line starts with `title`: its columns of every line, so text wrapped inside it reads whole. */
function pane(screen: string, title: string): string {
  const lines = screen.split("\n").map((line) => [...line])
  const row = lines.findIndex((line) => line.join("").includes(`│ ${title}`))
  if (row === -1) throw new Error(`no pane "${title}"`)
  const left = lines[row]!.join("").indexOf(`│ ${title}`)
  const right = lines[row]!.indexOf("│", left + 1)
  return words(lines.map((line) => line.slice(left, right + 1).join("")).join("\n"))
}

/**
 * The window as a terminal that shows colours receives it. It is drawn in a
 * process of its own: how much colour Ink writes is fixed when it is loaded.
 */
function drawnInColour(state: State, columns = 100, rows = 30): string {
  const script = [
    'import { createElement } from "react"',
    'import { renderToString } from "ink"',
    `import { AppView } from ${JSON.stringify(join(import.meta.dir, "../src/app/app.tsx"))}`,
    "const state = JSON.parse(process.argv.at(-1))",
    `process.stdout.write(renderToString(createElement(AppView, { state, columns: ${columns}, rows: ${rows} }), { columns: ${columns} }))`,
  ].join("\n")
  const run = Bun.spawnSync([process.execPath, "-e", script, JSON.stringify(state)], { env: { ...process.env, FORCE_COLOR: "1" } })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString()
}

/** A line's characters, and for each whether it is drawn dim (SGR 2, until SGR 22 or a reset). */
function faintness(line: string): { text: string; dim: boolean[] } {
  let text = ""
  const dim: boolean[] = []
  let faint = false
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const codes = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1]
    if (codes === undefined) {
      for (const char of part) {
        text += char
        dim.push(faint)
      }
      continue
    }
    for (const code of codes.split(";")) {
      if (code === "2") faint = true
      if (code === "22" || code === "0" || code === "") faint = false
    }
  }
  return { text, dim }
}

/** Nothing is drawn past the window. */
function fits(screen: string, columns: number, rows: number) {
  const lines = screen.split("\n")
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns)
}

const NOW = new Date()
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
/** A local day `days` before today, at a time of that day. */
const dayAt = (days: number, hours: number, minutes: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hours, minutes).toISOString()

/** The team of board "Home". */
const BOARD_TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [
        { name: "demo", deploy: 4, at: ago(125_000), state: "unknown", outcome: "started", signer: "ada", secrets: 2, previous: 3 },
        { name: "api", deploy: 12, at: dayAt(1, 12, 0), state: "unknown", outcome: "started", signer: "ada", secrets: 1, previous: 11 },
        { name: "worker", deploy: 3, at: dayAt(3, 12, 0), state: "unknown", outcome: "started", signer: "ada", secrets: 0, previous: 2 },
      ],
    },
    { name: "staging", destination: "staging-box", reachable: true, apps: [] },
  ],
}

const boardHome = (size = { columns: 100, rows: 30 }) => play(initialState({ kind: "team", team: BOARD_TEAM }, size), key({ kind: "right" }))

/** Board "One app: deploys and secrets". */
const boardApp = (size = { columns: 100, rows: 30 }) =>
  play(boardHome(size), key({ kind: "enter" }), {
    type: "app-view",
    server: "prod",
    app: "demo",
    deploys: [
      { sequence: 4, outcome: "started", at: dayAt(0, 21, 52), signer: "ada", teamVersion: 2, services: ["web (caddy:2)"], secrets: [{ name: "DATABASE_URL", version: 3 }] },
      { sequence: 3, outcome: "started", at: dayAt(0, 21, 50), rollbackTo: 1, signer: "ada", teamVersion: 2, services: ["web (caddy:2)"], secrets: [] },
      { sequence: 2, outcome: "started", at: dayAt(0, 21, 47), signer: "ada", teamVersion: 2, services: ["web (caddy:2)"], secrets: [] },
      { sequence: 1, outcome: "started", at: dayAt(0, 21, 41), signer: "ada", teamVersion: 2, services: ["web (caddy:2)"], secrets: [] },
    ],
    secrets: [
      { name: "DATABASE_URL", version: 3, removed: false, afterDeploy: false },
      { name: "SESSION_KEY", version: 1, removed: false, afterDeploy: true },
      { name: "GREETING", version: 2, removed: true, afterDeploy: false },
    ],
  })

/** Board "A deploy in progress". */
const boardDeploy = (size = { columns: 100, rows: 30 }) =>
  play(
    boardApp(size),
    {
      type: "deploy-started",
      server: "prod",
      app: "demo",
      at: Date.now() - 4200,
      from: "~/code/demo/compose.yaml",
      replaces: 4,
      secretNames: ["DATABASE_URL", "SESSION_KEY"],
    },
    { type: "deploy-stage", stage: "checked", sequence: 5, secrets: 2 },
    { type: "deploy-stage", stage: "signed", sequence: 5, secrets: 2 },
    { type: "deploy-stage", stage: "sent", sequence: 5, secrets: 2 },
    { type: "deploy-stage", stage: "starting", sequence: 5, secrets: 2 },
    { type: "deploy-progress", lines: ["pulled caddy:2"] },
    { type: "deploy-progress", lines: ["pulling caddy:2, 7.3 MB of 14 MB"] }
  )

// ---------------------------------------------------------------------------

describe("when something happened", () => {
  const now = new Date(2026, 10, 14, 21, 54, 0)
  const at = (...parts: [number, number, number, number?, number?, number?]) => new Date(...parts).toISOString()

  test("on Home: a short time ago, as the board says it", () => {
    expect(relativeTime(at(2026, 10, 14, 21, 53, 30), now)).toBe("just now")
    expect(relativeTime(at(2026, 10, 14, 21, 52), now)).toBe("2 min ago")
    expect(relativeTime(at(2026, 10, 14, 20, 50), now)).toBe("1 hour ago")
    expect(relativeTime(at(2026, 10, 14, 18, 10), now)).toBe("3 hours ago")
    // Less than a day, but on the day before: yesterday.
    expect(relativeTime(at(2026, 10, 13, 23, 0), now)).toBe("yesterday")
    expect(relativeTime(at(2026, 10, 13, 8, 0), now)).toBe("yesterday")
    expect(relativeTime(at(2026, 10, 11, 12, 0), now)).toBe("3 days ago")
    expect(relativeTime(at(2026, 10, 7, 12, 0), now)).toBe("1 week ago")
    expect(relativeTime(at(2026, 9, 25, 12, 0), now)).toBe("2 weeks ago")
    expect(relativeTime(at(2026, 8, 1, 12, 0), now)).toBe("1 Sep")
    expect(relativeTime(at(2025, 11, 1, 12, 0), now)).toBe("1 Dec 2025")
  })

  test("on Home: a time ahead of this clock is its date, a moment ahead is just now, and no time is nothing", () => {
    expect(relativeTime(at(2026, 10, 15, 10, 0), now)).toBe("15 Nov")
    expect(relativeTime(at(2026, 10, 14, 21, 54, 30), now)).toBe("just now")
    expect(relativeTime("not a time", now)).toBe("")
  })

  test("in an app's history: the day and the time", () => {
    expect(clockTime(at(2026, 10, 14, 21, 52), now)).toBe("today 21:52")
    expect(clockTime(at(2026, 10, 14, 9, 5), now)).toBe("today 09:05")
    expect(clockTime(at(2026, 10, 13, 21, 47), now)).toBe("yesterday 21:47")
    expect(clockTime(at(2026, 10, 12, 21, 41), now)).toBe("12 Nov 21:41")
    expect(clockTime(at(2025, 10, 12, 21, 41), now)).toBe("12 Nov 2025")
    expect(clockTime(at(2026, 10, 15, 10, 0), now)).toBe("15 Nov 10:00")
    expect(clockTime("", now)).toBe("")
  })
})

describe("Home (board 'Home')", () => {
  test("servers, the selected server's apps with deploy number, state and when, and the selected app's details and actions", () => {
    const screen = draw(boardHome())
    const lines = screen.split("\n")
    expect(lines[2]).toContain("ada's team")
    expect(lines[2]!.trimEnd()).toMatch(/team list v2 {2}pre-alpha, unaudited$/)
    expect(screen).toContain("│ Servers")
    expect(screen).toMatch(/❯ prod +●/)
    expect(screen).toContain("deploy@203.0.11")
    expect(screen).toMatch(/ {3}staging +●/)
    expect(screen).toContain("staging-box")
    expect(screen).toContain("+ add a server")
    expect(screen).toMatch(/Apps on prod +3 │/)
    expect(screen).toMatch(/app +deploy +state +when/)
    expect(screen).toMatch(/❯ demo +4 +● unknown +2 min ago/)
    expect(screen).toMatch(/ {3}api +12 +● unknown +yesterday/)
    expect(screen).toMatch(/ {3}worker +3 +● unknown +3 days ago/)
    expect(screen).toMatch(/│ demo +│/)
    expect(screen).toMatch(/deploy +4, started/)
    expect(screen).toMatch(/signed by +ada/)
    expect(screen).toMatch(/secrets +2/)
    expect(screen).toContain("d  Deploy this folder")
    expect(screen).toContain("r  Roll back to deploy 3")
    expect(screen).toContain("l  Logs")
    expect(screen).toContain("s  Secrets")
    expect(lastLine(screen)).toBe("↑↓ move  ←→ pane  enter open  a add  ? help  q quit")
    fits(screen, 100, 30)
  })

  test("the servers pane: at 100 columns and more as on board 'Home', the address whole; below, as on 'Home at 80 columns'", () => {
    /** The width of the servers pane: its top border, from corner to corner. */
    const serversWidth = (screen: string) => {
      const top = [...screen.split("\n").find((line) => line.includes("╭"))!]
      return top.indexOf("╮") - top.indexOf("╭") + 1
    }
    for (const columns of [100, 120]) {
      const screen = draw(boardHome({ columns, rows: 30 }), columns, 30)
      expect(screen).toMatch(/│ {3}deploy@203\.0\.113\.7 +│/)
      expect(serversWidth(screen)).toBe(24)
      fits(screen, columns, 30)
    }
    expect(serversWidth(draw(boardHome({ columns: 80, rows: 24 }), 80, 24))).toBe(22)
    expect(serversWidth(draw(boardHome({ columns: 99, rows: 24 }), 99, 24))).toBe(22)
  })

  test("says 'This folder is linked' only when it is", () => {
    expect(draw(boardHome())).not.toContain("This folder is linked")
    const linked = initialState({ kind: "team", team: BOARD_TEAM, linked: { server: "prod", app: "demo" } }, { columns: 100, rows: 30 })
    expect(words(draw(linked))).toContain("This folder is linked to demo on prod by zekno.json.")
  })

  test("in that sentence the app and the server are in the text colour and the rest is dim, as on the board", () => {
    const linked = initialState({ kind: "team", team: BOARD_TEAM, linked: { server: "prod", app: "demo" } }, { columns: 100, rows: 30 })
    const line = drawnInColour(linked)
      .split("\n")
      .find((row) => row.includes("This folder is linked"))!
    const shown = faintness(line)
    const at = shown.text.indexOf("This folder is linked to demo on prod by")
    expect(at).toBeGreaterThan(0)
    const dimOf = (words: string, from = at) => {
      const start = shown.text.indexOf(words, from)
      return [...words].map((_, index) => shown.dim[start + index])
    }
    expect(dimOf("This folder is linked to ").every(Boolean)).toBe(true)
    expect(dimOf("demo", at + 20).some(Boolean)).toBe(false)
    expect(dimOf(" on ", at + 20).every(Boolean)).toBe(true)
    expect(dimOf("prod", at + 30).some(Boolean)).toBe(false)
    expect(dimOf(" by", at + 30).every(Boolean)).toBe(true)
  })

  test("a server that could not be reached is marked, keeps its apps' numbers, and says why; the others are as they were", () => {
    const team: TeamView = {
      ...BOARD_TEAM,
      servers: [
        BOARD_TEAM.servers[0]!,
        { name: "staging", destination: "staging-box", apps: [{ name: "web", deploy: 7, at: dayAt(2, 9, 0), state: "unknown", outcome: "started" }] },
      ],
    }
    const problem = "The runner did not answer as expected. Check that it is installed and reachable."
    const state = play(initialState({ kind: "team", team }, { columns: 100, rows: 30 }), { type: "server-reached", server: "staging", reachable: false, problem })
    expect(draw(state)).toMatch(/ {3}staging +✖/)
    expect(draw(state)).toMatch(/❯ prod +●/)
    const onStaging = play(state, key({ kind: "down" }))
    const screen = draw(onStaging)
    expect(screen).toMatch(/❯ staging +✖/)
    expect(screen).toMatch(/web +7 +● unknown +2 days ago/)
    expect(pane(screen, "Apps on staging")).toContain("✖ staging could not be reached. Numbers are from this machine's history.")
    expect(pane(screen, "Apps on staging")).toContain(problem)
    // Once it answers again, the mark and the line go.
    const back = draw(play(onStaging, { type: "server-reached", server: "staging", reachable: true }))
    expect(back).toMatch(/❯ staging +●/)
    expect(back).not.toContain("could not be reached")
  })

  test("a server with no apps says so; no app selected says so", () => {
    const state = play(boardHome(), key({ kind: "left" }), key({ kind: "down" }))
    const screen = draw(state)
    expect(pane(screen, "Apps on staging")).toContain("Nothing deployed to staging from this machine yet.")
    expect(screen).toContain("No app selected.")
  })

  test("fits 80 by 24", () => {
    fits(draw(boardHome({ columns: 80, rows: 24 }), 80, 24), 80, 24)
  })
})

describe("the app screen (board 'One app: deploys and secrets')", () => {
  test("the deploy history, the selected deploy's details, the secrets by name and version, and the note", () => {
    const screen = draw(boardApp())
    const lines = screen.split("\n")
    expect(lines[2]).toContain("› prod › demo")
    expect(lines[2]!.trimEnd()).toMatch(/● unknown deploy 4$/)
    expect(screen).toMatch(/Deploys +last 50 are kept/)
    expect(screen).toMatch(/no\. +result +when/)
    expect(screen).toMatch(/❯ 4 +✔ started +today 21:52/)
    expect(screen).toMatch(/ {3}3 +✔ started, a rollback to 1 +today 21:50/)
    expect(screen).toMatch(/ {3}2 +✔ started +today 21:47/)
    expect(screen).toMatch(/ {3}1 +✔ started +today 21:41/)
    expect(screen).toMatch(/deploy 4 +signed by ada, from team list v2/)
    expect(screen).toMatch(/services +web \(caddy:2\)/)
    expect(screen).toMatch(/secrets +DATABASE_URL v3/)
    expect(screen).toMatch(/│ Secrets/)
    expect(screen).toMatch(/DATABASE_URL +version 3/)
    expect(screen).toMatch(/SESSION_KEY +version 1/)
    expect(screen).toMatch(/GREETING +removed/)
    expect(screen).toContain("+ set a secret")
    expect(pane(screen, "Secrets")).toContain("Values are never shown. To change one, set it again.")
    expect(pane(screen, "Secrets")).toContain("! SESSION_KEY was set after deploy 4. It takes effect on the next deploy.")
    expect(lastLine(screen)).toBe("d deploy  r roll back to selected  l logs  s set secret  x remove secret  tab pane  esc back")
    fits(screen, 100, 30)
  })

  test("the selection follows the keys; a deploy that did not start, or had no answer, says so", () => {
    const state = play(boardApp(), key({ kind: "down" }), key({ kind: "down" }))
    const screen = draw(state)
    expect(screen).toMatch(/❯ 2 +✔ started/)
    expect(screen).toMatch(/deploy 2 +signed by ada/)
    const odd = play(state, {
      type: "app-view",
      server: "prod",
      app: "demo",
      deploys: [
        { sequence: 6, outcome: "sent", at: dayAt(0, 22, 1) },
        { sequence: 5, outcome: "start_failed", at: dayAt(0, 22, 0) },
      ],
      secrets: [],
    })
    expect(draw(odd)).toMatch(/6 +! no answer recorded/)
    expect(draw(odd)).toMatch(/5 +✖ did not start/)
  })

  test("x asks before removing, worded with the secret, with enter and esc", () => {
    const asking = play(boardApp(), key({ kind: "tab" }), key({ kind: "down" }), text("x"))
    const screen = draw(asking)
    expect(screen).toContain("╭─ Remove SESSION_KEY? ─")
    expect(words(screen)).toContain("demo on prod keeps it until the next deploy. The removal is signed now.")
    expect(screen).toContain("enter remove it  esc cancel")
    expect(lastLine(screen)).toBe("enter remove it  esc cancel")
  })

  test("the note names each secret when several changed, and is not shown when none did or nothing was deployed", () => {
    const secrets = [
      { name: "A", version: 2, removed: false, afterDeploy: true },
      { name: "B", version: 1, removed: true, afterDeploy: true },
      { name: "C", version: 1, removed: false, afterDeploy: true },
    ]
    expect(changedNote(secrets, 4)).toBe("A, B and C changed after deploy 4. They take effect on the next deploy.")
    expect(changedNote([secrets[1]!], 4)).toBe("B was removed after deploy 4. It takes effect on the next deploy.")
    expect(changedNote(secrets, undefined)).toBeUndefined()
    expect(changedNote([{ name: "A", version: 1, removed: false, afterDeploy: false }], 4)).toBeUndefined()
  })

  test("fits 80 by 24", () => {
    fits(draw(boardApp({ columns: 80, rows: 24 }), 80, 24), 80, 24)
  })
})

describe("at 80 columns (boards 'Home at 80 columns' and 'One app at 80 columns')", () => {
  const NARROW = { columns: 80, rows: 24 }
  /** What the board shows running: demo and api running, worker stopped, and this folder linked to demo on prod. */
  const RUNNING = { type: "app-states", server: "prod", states: { demo: "running", api: "running", worker: "stopped" }, accepted: { demo: 4, api: 12, worker: 3 } } as const
  const narrowHome = () =>
    play(initialState({ kind: "team", team: BOARD_TEAM, linked: { server: "prod", app: "demo", compose: "compose.yaml" } }, NARROW), key({ kind: "right" }), RUNNING)

  test("Home: the servers without their addresses, the apps, the selected app's details at the foot and its actions as keys", () => {
    const screen = draw(narrowHome(), 80, 24)
    const lines = screen.split("\n")
    expect(lines[2]).toMatch(/ada's team +pre-alpha$/)
    expect(screen).not.toContain("unaudited")
    expect(screen).not.toContain("team list v2")
    expect(screen).toMatch(/│ ❯ prod +● │/)
    expect(screen).toMatch(/│ {3}staging +● │/)
    expect(screen).toContain("+ add a server")
    expect(screen).not.toContain("deploy@203.0.113.7")
    expect(screen).not.toContain("staging-box")
    expect(screen).toMatch(/Apps on prod +3 │/)
    expect(screen).toMatch(/app +deploy +state +when/)
    expect(screen).toMatch(/❯ demo +4 +● running +2 min ago/)
    expect(screen).toMatch(/ {3}api +12 +● running +yesterday/)
    expect(screen).toMatch(/ {3}worker +3 +● stopped +3 days ago/)
    // No details pane: its words are at the foot of the apps pane, under a rule, and its actions are keys.
    expect(screen).not.toContain("Deploy this folder")
    expect(screen).not.toContain("This folder is linked to")
    expect(pane(screen, "Apps on prod")).toContain("demo deploy 4, started, signed by ada")
    expect(pane(screen, "Apps on prod")).toContain("2 secrets, compose.yaml, this folder is linked")
    expect(screen).toMatch(/│ ─+ │/)
    expect(words(lines.slice(-2).join(" "))).toBe(" ↑↓ move ←→ pane enter open d deploy r roll back l logs s secrets a add ? help q quit")
    fits(screen, 80, 24)
  })

  test("Home: a folder linked to another app is said as at 100 columns; an app with no history says so", () => {
    const onApi = play(narrowHome(), key({ kind: "down" }))
    const screen = draw(onApi, 80, 24)
    expect(pane(screen, "Apps on prod")).toContain("api deploy 12, started, signed by ada")
    expect(pane(screen, "Apps on prod")).toContain("1 secret")
    expect(pane(screen, "Apps on prod")).not.toContain("this folder is linked")
    expect(pane(screen, "Apps on prod")).toContain("This folder is linked to demo on prod by zekno.json.")
    fits(screen, 80, 24)
    // A server that could not be reached, with the folder linked elsewhere, still fits.
    const gone = play(onApi, { type: "server-reached", server: "prod", reachable: false, problem: "The connection to the runner ended before it answered." })
    fits(draw(gone, 80, 24), 80, 24)
  })

  test("Home: a long reason a server could not be reached is cut to the rows that are free, at a word, and the apps table keeps its rows whole", () => {
    // Four lines and more of reason at 80 columns, as SSH can give.
    const reason =
      "ssh: connect to host 203.0.113.7 port 22: Operation timed out. The connection was closed by the remote host before any answer came back, " +
      "and SSH gave up after three tries. Check the address, the port and the firewall in front of the server."
    for (const [columns, rows] of [
      [80, 24],
      [100, 30],
    ] as const) {
      const gone = play(update(narrowHome(), { type: "resize", columns, rows }).state, { type: "server-reached", server: "prod", reachable: false, problem: reason })
      for (const state of [gone, play(gone, key({ kind: "down" })), play(gone, key({ kind: "down" }), key({ kind: "down" }))]) {
        const screen = draw(state, columns, rows)
        const at = (top(state) as Extract<State["stack"][number], { name: "home" }>).app
        const what = { columns, rows, selected: at }
        fits(screen, columns, rows)
        const marked = (name: string) => `${at === ["demo", "api", "worker"].indexOf(name) ? "❯" : " "} ${name}`
        // Each row of the table whole, on a line of its own: its name, its number, its state and when.
        for (const [name, deploy, when] of [
          ["demo", 4, "2 min ago"],
          ["api", 12, "yesterday"],
          ["worker", 3, "3 days ago"],
        ] as const) {
          const row = new RegExp(`│ ${marked(name).replace(/[❯]/, "\\$&")} +${deploy} +● unknown +${when} +│`)
          expect({ what, name, whole: screen.split("\n").some((line) => row.test(line)) }).toEqual({ what, name, whole: true })
        }
        expect({ what, header: /app +deploy +state +when/.test(screen) }).toEqual({ what, header: true })
        const apps = pane(screen, "Apps on prod")
        expect(apps).toContain("✖ prod could not be reached. Numbers are from this machine's history.")
        // The reason as it was given, whole, or cut after a word with "…".
        const from = apps.indexOf("ssh: connect to host 203.0.113.7 port 22:")
        expect({ what, from: from >= 0 }).toEqual({ what, from: true })
        const end = apps.indexOf("…", from)
        if (end === -1) expect(apps).toContain(reason)
        else {
          const shown = apps.slice(from, end)
          expect({ what, prefix: reason.startsWith(shown), atWord: reason.charAt(shown.length) === " " }).toEqual({ what, prefix: true, atWord: true })
        }
      }
      // At 80 by 24 there is room for its first line only.
      if (columns === 80) expect(pane(draw(gone, columns, rows), "Apps on prod")).toContain("ssh: connect to host 203.0.113.7 port 22:… ")
    }
  })

  test("a text cut to the rows there are: wrapped at spaces, a long word broken, the last row ending at a word with …", () => {
    expect(rowsOf("one two three", 1, 20)).toEqual(["one two three"])
    expect(rowsOf("one two three four", 1, 12)).toEqual(["one two…"])
    expect(rowsOf("one two three four", 2, 9)).toEqual(["one two", "three…"])
    expect(rowsOf("/a/very/long/path/that/cannot/wrap and more", 2, 10)).toEqual(["/a/very/lo", "ng/path/t…"])
    expect(rowsOf("anything", 0, 10)).toEqual([])
    // The rows Ink draws, as measured with Ink: a space just past a full row starts the next one, even a row of its own.
    expect(inkRows("ab cd ef", 5)).toBe(2)
    expect(inkRows("abcdef", 3)).toBe(2)
    expect(inkRows("abc def", 3)).toBe(3)
    expect(inkRows("abcd efgh ijkl", 4)).toBe(5)
    for (const [words, width] of [
      ["✖ prod could not be reached. Numbers are from this machine's history.", 40],
      ["This folder is linked to demo on prod by zekno.json.", 40],
      ["ssh: connect to host 203.0.113.7 port 22: Operation timed out. The connection was closed", 51],
      ["abc def", 3],
    ] as const) {
      const drawn = renderToString(<Box width={width}><Text>{words}</Text></Box>, { columns: 100 }).split("\n").length
      expect({ words, rows: inkRows(words, width) }).toEqual({ words, rows: drawn })
    }
  })

  test("`● partly running` is cut at a word where the boards' state column is, never in a word; in full where there is room", () => {
    const partly = play(narrowHome(), { ...RUNNING, states: { ...RUNNING.states, api: "partly running" } })
    for (const [columns, rows] of [
      [80, 24],
      [100, 30],
    ] as const) {
      const screen = draw(update(partly, { type: "resize", columns, rows }).state, columns, rows)
      expect(screen).toMatch(/ {3}api +12 +● partly +yesterday/)
      expect(screen).not.toContain("● partly r")
    }
    const wide = draw(update(partly, { type: "resize", columns: 130, rows: 30 }).state, 130, 30)
    expect(wide).toMatch(/ {3}api +12 +● partly running +yesterday/)
  })

  test("the app screen: the state alone in the header, deploys without column names, short results and versions, the details at the foot", () => {
    const state = play(boardApp(NARROW), RUNNING)
    const screen = draw(state, 80, 24)
    const lines = screen.split("\n")
    expect(lines[2]).toContain("› prod › demo")
    expect(lines[2]!.trimEnd()).toMatch(/● running$/)
    expect(lines[2]).not.toContain("deploy 4")
    expect(screen).toMatch(/│ Deploys +│/)
    expect(screen).not.toContain("last 50 are kept")
    expect(screen).not.toMatch(/no\. +result/)
    expect(screen).toMatch(/❯ 4 +● running now +today 21:52/)
    expect(screen).toMatch(/ {3}3 +✔ rollback to 1 +today 21:50/)
    expect(screen).toMatch(/ {3}2 +✔ started +today 21:47/)
    expect(screen).toMatch(/ {3}1 +✔ started +today 21:41/)
    expect(pane(screen, "Deploys")).toContain("deploy 4, signed by ada, team list v2")
    expect(pane(screen, "Deploys")).toContain("web (caddy:2), 1 secret")
    expect(screen).toMatch(/DATABASE_URL +v3 │/)
    expect(screen).toMatch(/SESSION_KEY +v1 ! │/)
    expect(screen).toMatch(/GREETING +removed │/)
    expect(screen).toContain("+ set a secret")
    // The secrets pane is as wide as the board's, and its last lines fit on one line each.
    expect(screen).toMatch(/│ ! not deployed yet +│/)
    expect(screen).toMatch(/│ Values are never shown\. │/)
    expect(screen).not.toContain("To change one")
    expect(words(lines.slice(-2).join(" "))).toBe(" d deploy r roll back to selected l logs s set secret x remove secret tab pane esc back")
    fits(screen, 80, 24)
  })

  test("the app screen: a time or number longer than the board's column widens it, never cut", () => {
    const state = play(boardApp(NARROW), {
      type: "app-view",
      server: "prod",
      app: "demo",
      deploys: [
        { sequence: 10432, outcome: "start_failed", at: dayAt(1, 21, 47), rollbackTo: 3 },
        { sequence: 10431, outcome: "sent", at: dayAt(40, 9, 5) },
      ],
      secrets: [{ name: "TOKEN", version: 2, removed: true, afterDeploy: true }],
    })
    const screen = draw(state, 80, 24)
    expect(screen).toMatch(/❯ 10432 +✖ did not start +yesterday 21:47/)
    // Forty days ago: a date with its time, or in another year the date alone (time.ts `clockTime`).
    expect(screen).toMatch(/ {3}10431 +! no answer recorded +\d{1,2} [A-Z][a-z]{2} (09:05|\d{4}) +│/)
    expect(screen).toMatch(/TOKEN +removed ! │/)
    fits(screen, 80, 24)
  })
})

describe("the deploy screen (board 'A deploy in progress')", () => {
  test("the summary panel, the stage row, the live line, and that leaving does not cancel", () => {
    const screen = draw(boardDeploy())
    const lines = screen.split("\n")
    expect(lines[2]).toContain("› prod › demo › deploy")
    expect(lines[2]!.trimEnd()).toMatch(/\d+\.\ds$/)
    expect(screen).toContain("╭─ Deploy 5 ─")
    expect(screen).toMatch(/app +demo/)
    expect(screen).toMatch(/server +prod/)
    expect(screen).toMatch(/from +~\/code\/demo\/compose\.yaml/)
    expect(screen).toMatch(/secrets +2 \(DATABASE_URL, SESSION_KEY\)/)
    expect(screen).toMatch(/replaces +deploy 4/)
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Starting/)
    // One live line: the latest of Docker's lines.
    expect(screen).toContain("pulling caddy:2, 7.3 MB of 14 MB")
    expect(screen).not.toContain("pulled caddy:2")
    expect(screen).toContain("Leaving this screen does not cancel the deploy. Quitting zekno waits for it to finish.")
    expect(lastLine(screen)).toBe("o show Docker's output  esc back, deploy keeps going")
    expect(HINTS.deploy.map(([k, does]) => `${k} ${does}`).join("  ")).toBe(lastLine(screen))
    fits(screen, 100, 30)
  })

  test("o shows Docker's lines kept so far, and hides them again", () => {
    const shown = draw(play(boardDeploy(), text("o")))
    expect(shown).toContain("╭─ Docker's output ─")
    expect(shown).toContain("pulled caddy:2")
    expect(shown).toContain("pulling caddy:2, 7.3 MB of 14 MB")
    expect(lastLine(shown)).toBe("o hide Docker's output  esc back, deploy keeps going")
    expect(draw(play(boardDeploy(), text("o"), text("o")))).not.toContain("Docker's output ─")
  })

  test("a deploy that did not start: the failed stage, what Docker reported, and that the number is used", () => {
    const failed = play(
      boardDeploy(),
      { type: "deploy-progress", lines: ["pull access denied for example/web, repository does not exist or may require 'docker login'"] },
      { type: "deploy-stage", stage: "failed", sequence: 5, secrets: 2 },
      { type: "deploy-ended", outcome: "start_failed", notice: { tone: "error", text: "prod accepted deploy 5, but the app did not start." }, at: Date.now() }
    )
    const screen = draw(failed)
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✖ Starting/)
    expect(screen).toContain("✖ prod accepted deploy 5, but the app did not start.")
    expect(screen).toContain("Number 5 is used, so the next deploy will be 6.")
    expect(screen).toContain("╭─ Docker said ─")
    expect(words(screen)).toContain("pull access denied for example/web, repository does not exist or may require 'docker login'")
    // The result is drawn once, in the body, not again as a line below it.
    expect(screen.split("prod accepted deploy 5").length).toBe(2)
    expect(lastLine(screen)).toBe("o show Docker's output  esc back")
    fits(screen, 100, 30)
    fits(draw(play(boardApp({ columns: 80, rows: 24 }), ...[...failedEvents()]), 80, 24), 80, 24)
  })

  test("a deploy that started: ✔ Started and the result line", () => {
    const done = play(
      boardDeploy(),
      { type: "deploy-stage", stage: "started", sequence: 5, secrets: 2 },
      { type: "deploy-ended", outcome: "started", notice: { tone: "success", text: "demo is live on prod in 6.1s" }, at: Date.now() }
    )
    const screen = draw(done)
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✔ Started/)
    expect(screen).toContain("✔ demo is live on prod in 6.1s")
    expect(screen).not.toContain("Number 5 is used")
    expect(screen).not.toContain("Leaving this screen")
  })

  test("the stages, from before Checked to a refusal at any point", () => {
    const base: DeployProgress = { server: "prod", app: "demo", lines: [], running: true, since: 0 }
    const marks = (deploy: DeployProgress) => stagesOf(deploy).map((stage) => `${stage.state} ${stage.label}`)
    expect(marks(base)).toEqual(["active Checked", "pending Signed", "pending Sent", "pending Starting"])
    expect(marks({ ...base, stage: "signed", sequence: 5 })).toEqual(["done Checked", "done Signed", "active Sent", "pending Starting"])
    expect(marks({ ...base, running: false, outcome: "error" })).toEqual(["failed Checked", "pending Signed", "pending Sent", "pending Starting"])
    const refusedAtApply = { ...base, stage: "sent" as const, sequence: 5, running: false, outcome: "error" as const }
    expect(marks(refusedAtApply)).toEqual(["done Checked", "done Signed", "done Sent", "failed Starting"])
    // Signed means recorded as used: a refusal after that still used the number; before it, not.
    expect(numberUsed(refusedAtApply)).toBe(true)
    expect(numberUsed({ ...refusedAtApply, stage: "checked" })).toBe(false)
    expect(numberUsed({ ...refusedAtApply, outcome: "started", stage: "started" })).toBe(false)
  })

  test("Docker's lines: the last that fit, whole, and the end of one too long by itself", () => {
    expect(lastLines(["a", "b", "c"], 2, 10)).toEqual(["b", "c"])
    expect(lastLines(["a", "b".repeat(15), "c"], 3, 10)).toEqual(["b".repeat(15), "c"])
    expect(lastLines(["a", "b".repeat(15), "c"], 2, 10)).toEqual(["c"])
    expect(lastLines(["x".repeat(50)], 2, 10)).toEqual([`…${"x".repeat(19)}`])
    // Wide characters count double, so they are never thought to fit when they do not.
    expect(lastLines(["一二三四五六", "c"], 2, 10)).toEqual(["c"])
  })
})

/** The events of board "A deploy in progress" up to a failed start, for drawing at another size. */
function* failedEvents(): Generator<AppEvent> {
  yield { type: "deploy-started", server: "prod", app: "demo", at: Date.now(), from: "~/code/demo/compose.yaml", replaces: 4, secretNames: ["A"] }
  yield { type: "deploy-stage", stage: "failed", sequence: 5, secrets: 1 }
  for (let n = 0; n < 40; n++) yield { type: "deploy-progress", lines: [`Docker line ${n} ${"x".repeat(n * 3)}`] }
  yield { type: "deploy-ended", outcome: "start_failed", notice: { tone: "error", text: "prod accepted deploy 5, but the app did not start." } }
}

describe("setting a secret (board 'Set a secret')", () => {
  test("the name, then the hidden value, with the board's sentences", () => {
    const naming = play(boardApp(), text("s"), ...[..."API_KEY"].map(text))
    const asked = draw(naming)
    expect(asked.split("\n")[2]).toContain("› prod › demo › set a secret")
    expect(asked).toContain("╭─ New secret ─")
    expect(asked).toContain("? Name › API_KEY")
    expect(lastLine(asked)).toBe("enter continue  esc cancel")

    const value = play(naming, key({ kind: "enter" }))
    expect(hiddenPromptOpen(value)).toBe(true)
    const screen = draw(value)
    expect(screen).toContain("╭─ API_KEY ─")
    expect(screen).toMatch(/\? Value › +hidden as you type/)
    expect(screen).toContain("Pasting is fine. Nothing shows, not even the length.")
    expect(screen).toContain("For a value of several lines, use: zekno secret set API_KEY --stdin < file")
    expect(screen).toContain("Encrypted on this machine for prod's key and signed by you.")
    expect(screen).toContain("It cannot be shown again after it is set, only replaced.")
    expect(lastLine(screen)).toBe("enter save  esc cancel")
    fits(screen, 100, 30)
    fits(draw(update(value, { type: "resize", columns: 80, rows: 24 }).state, 80, 24), 80, 24)
  })

  test("before a deploy: the names that are missing, one of them asked for, and how many", () => {
    const missing = play(boardApp(), { type: "missing-values", server: "prod", app: "demo", names: ["DATABASE_URL", "SESSION_KEY"] })
    const screen = draw(missing)
    expect(screen.split("\n")[2]!.trimEnd()).toMatch(/1 of 2$/)
    expect(screen).toMatch(/❯ DATABASE_URL +not set/)
    expect(screen).toMatch(/ {3}SESSION_KEY +not set/)
    expect(screen).toContain("╭─ DATABASE_URL ─")
  })

  test("a name that cannot be a secret's is refused before any value is asked for", () => {
    expect(secretNameProblem("API_KEY")).toBeUndefined()
    expect(secretNameProblem("9LIVES")).toBe("A secret name uses letters, digits and underscore, and does not start with a digit.")
    expect(secretNameProblem("my-key")).toBe("A secret name uses letters, digits and underscore, and does not start with a digit.")
    expect(secretNameProblem("A".repeat(129))).toBe("A secret name uses letters, digits and underscore, and does not start with a digit.")
    expect(secretNameProblem("DOCKER_HOST")).toBe('"DOCKER_HOST" is reserved: the runner uses it to start Docker. Choose another name.')
    const refused = play(boardApp(), text("s"), ...[..."PATH"].map(text), key({ kind: "enter" }))
    expect(hiddenPromptOpen(refused)).toBe(false)
    expect(top(refused)).toMatchObject({ name: "set-secret", question: "name", secretName: "PATH" })
    expect(refused.notice).toEqual({ tone: "error", text: '"PATH" is reserved: the runner uses it to start Docker. Choose another name.' })
  })
})

describe("what the reducer keeps for these screens", () => {
  test("a server's apps read again keep the selected app selected, wherever its row moved", () => {
    const onApi = play(boardHome(), key({ kind: "down" }))
    expect(top(onApi)).toMatchObject({ name: "home", server: 0, app: 1 })
    const apps = BOARD_TEAM.servers[0]!.apps
    // A deploy of api moves it to the top.
    const moved = play(onApi, { type: "server-apps", server: "prod", apps: [{ ...apps[1]!, deploy: 13 }, apps[0]!, apps[2]!] })
    expect(top(moved)).toMatchObject({ server: 0, app: 0 })
    expect(moved.team?.servers[0]?.apps[0]).toMatchObject({ name: "api", deploy: 13 })
    // Another server's apps leave the selection alone; an unknown server changes nothing.
    expect(top(play(onApi, { type: "server-apps", server: "staging", apps: [] }))).toMatchObject({ app: 1 })
    expect(play(onApi, { type: "server-apps", server: "nowhere", apps: [] })).toEqual(onApi)
  })

  test("whether a server answered, and why not, is kept until it answers again", () => {
    const gone = play(boardHome(), { type: "server-reached", server: "staging", reachable: false, problem: "why" })
    expect(gone.team?.servers[1]).toMatchObject({ reachable: false, problem: "why" })
    expect(gone.team?.servers[0]).toMatchObject({ reachable: true })
    const back = play(gone, { type: "server-reached", server: "staging", reachable: true, problem: "ignored" })
    expect(back.team?.servers[1]).toMatchObject({ reachable: true, problem: undefined })
  })

  test("a deploy keeps what its summary shows, and how and when it ended", () => {
    const state = play(
      boardDeploy(),
      { type: "deploy-ended", outcome: "start_failed", notice: { tone: "error", text: "it did not start" }, at: 123 }
    )
    expect(state.deploy).toMatchObject({
      from: "~/code/demo/compose.yaml",
      replaces: 4,
      secretNames: ["DATABASE_URL", "SESSION_KEY"],
      running: false,
      outcome: "start_failed",
      endedAt: 123,
      result: { tone: "error", text: "it did not start" },
    })
  })
})

describe("what Home and the app screen read from this machine's history", () => {
  test("only deploys signed for this team, server and app count; a file that is not an app's is not an app", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy", "--app", "worker", "--server", "dev")).toBe(0)
    m.compose(COMPOSE_V1)
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)

    const serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).servers[0].serverId as string
    const folder = join(m.home, "history", serverId)
    const worker = JSON.parse(readFileSync(join(folder, "worker.json"), "utf8"))
    // A changed entry, and the worker's deploy 1 slipped into demo's history.
    m.tamper(`history/${serverId}/demo.json`, (entries) => [
      { ...entries[0], envelope: { ...entries[0].envelope, payload: Buffer.from("{}").toString("base64url") } },
      worker[0],
      ...entries,
    ])
    // Files that are not an app's history.
    writeFileSync(join(folder, "Not-An-App.json"), "[]")
    writeFileSync(join(folder, "demo.json.0011223344556677.tmp"), "[]")
    mkdirSync(join(folder, "nested.json"))
    writeFileSync(join(folder, "broken.json"), "{ not json")

    const team = await openTeam(m.deps)
    const server = team.profile.servers[0]!
    const apps = appsOf(team, server, m.home)
    expect(apps.map((app) => app.name).sort()).toEqual(["demo", "worker"])
    expect(apps.find((app) => app.name === "demo")).toMatchObject({ deploy: 3, outcome: "started", signer: "Ada", secrets: 0, previous: 2, state: "unknown" })

    const { deploys, secrets } = appDetails(team, server, "demo")
    expect(deploys.map((deploy) => deploy.sequence)).toEqual([3, 2, 1])
    // Deploy 3 runs deploy 1's definition again, not deploy 2's.
    expect(deploys.map((deploy) => deploy.rollbackTo)).toEqual([1, undefined, undefined])
    expect(deploys[0]).toMatchObject({ signer: "Ada", teamVersion: 2, services: ["web (example/web:1)"], secrets: [] })
    expect(secrets).toEqual([])
  })

  test("a Compose file's services, as far as it can be read", () => {
    expect(composeServices("services:\n  web:\n    image: caddy:2\n  worker:\n    build: .\n")).toEqual(["web (caddy:2)", "worker"])
    expect(composeServices("services: [")).toEqual([])
    expect(composeServices("services: 3")).toEqual([])
    expect(composeServices("")).toEqual([])
    expect(composeServices("services:\n  web:\n    image: \"x\\u001b[2Jy\"\n")).toEqual(["web (xy)"])
    // Aliases that would expand without end are refused by the parser, not expanded.
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x,x]", ..."bcdefghi".split("").map((n, i) => `${n}: &${n} [${Array(10).fill(`*${"abcdefghi"[i]}`).join(",")}]`)]
    expect(composeServices(`${bomb.join("\n")}\nservices:\n  web:\n    image: caddy:2\n    x: *i\n`)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Against a real runner process with the stand-in Docker

/** The effects of every app a test opened: closed after each test, so no runner a test reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** The app on a test machine, without a terminal: the reducer, the effects, and the window drawn on request. */
function openApp(m: Machine, start: Awaited<ReturnType<typeof loadStart>>, deps: OpDeps = m.deps) {
  const failures: unknown[] = []
  let effects: Effects | undefined
  const store = createStore(initialState(start, { columns: 100, rows: 30 }), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(deps, store.dispatch, (error) => failures.push(error))
  opened.push(effects)
  const held = emptyHiddenValue()
  return {
    store,
    effects,
    failures,
    get state() {
      return store.get()
    },
    press: (...keys: AppKey[]) => keys.forEach((k) => store.dispatch(key(k))),
    type: (value: string) => [...value].forEach((char) => store.dispatch(text(char))),
    /** One key press or paste at the hidden prompt, as app.tsx hands it over. */
    hidden: (input: string, k: Partial<Key> = {}) => hiddenPromptKey(held, input, k, store.get(), store.dispatch, effects!.saveSecret),
    draw: () => draw(store.get()),
    until: (ready: () => boolean, what: string) => waitFor(ready, what),
  }
}
type App = ReturnType<typeof openApp>

/**
 * A machine with demo deployed once, the folder linked to demo on dev (so `d`
 * deploys it without asking to remember it), and the app open on Home with
 * demo selected.
 */
async function onHome(prepare?: (m: Machine) => Promise<void>, options: { linked?: boolean } = {}) {
  const m = await ready()
  expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
  if (options.linked !== false) expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
  await prepare?.(m)
  const app = openApp(m, await loadStart(m.deps))
  app.press({ kind: "right" })
  return { m, app }
}

/**
 * Presses d, and goes ahead without the value compose.yaml expects and no
 * secret gives (GREETING): esc closes the prompt, esc on the list asks
 * whether to deploy without it, and y says yes (board "Set a secret").
 */
async function deployKey(app: App) {
  app.type("d")
  await app.until(() => top(app.state).name === "set-secret", "the values compose.yaml expects")
  expect(top(app.state)).toMatchObject({ name: "set-secret", missing: ["GREETING"], file: "compose.yaml" })
  app.press({ kind: "escape" }, { kind: "escape" })
  expect(app.state.question).toEqual({ kind: "skip-values", server: "dev", app: "demo", names: ["GREETING"] })
  app.type("y")
}

/** Opens demo's screen and waits for its history. */
async function openDemo(app: App) {
  app.press({ kind: "enter" })
  await app.until(() => app.state.appView?.app === "demo", "demo's history")
}

const ended = (app: App) => app.until(() => app.state.deploy?.running === false, "the deploy to end")

describe("operating against a real runner", () => {
  test("d deploys the folder from Home: each stage in order, the result, and Home and the history brought up to date", async () => {
    const { m, app } = await onHome()
    expect(app.state.team?.servers[0]?.apps).toMatchObject([{ name: "demo", deploy: 1, outcome: "started", state: "unknown" }])
    const stages: string[] = []
    app.store.subscribe(() => {
      const stage = app.state.deploy?.stage
      if (stage && stages.at(-1) !== stage) stages.push(stage)
    })
    await deployKey(app)
    await ended(app)
    expect(top(app.state)).toEqual({ name: "deploy", output: false })
    expect(stages).toEqual(["checked", "signed", "sent", "starting", "started"])
    expect(app.state.deploy).toMatchObject({ server: "dev", app: "demo", sequence: 2, outcome: "started", replaces: 1, secretNames: [] })
    expect(app.state.deploy?.from).toEndWith(`/${COMPOSE_FILE}`)
    expect(m.docker.calls()).toHaveLength(2)
    const screen = app.draw()
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✔ Started/)
    expect(screen).toMatch(/✔ demo is live on dev in \d+\.\ds/)
    await app.until(() => app.state.team?.servers[0]?.apps[0]?.deploy === 2, "Home to show deploy 2")
    expect(app.state.team?.servers[0]?.reachable).toBe(true)
    app.press({ kind: "escape" })
    expect(app.draw()).toMatch(/❯ demo +2 +● unknown +just now/)
    expect(app.failures).toEqual([])
  })

  test("an app that does not start: ✖ Starting, what Docker reported, and that the number is used; the next deploy takes the next number", async () => {
    const { m, app } = await onHome()
    m.docker.failWith(1)
    m.docker.upPrints({ stderr: "pull access denied for example/web, repository does not exist\n" })
    await deployKey(app)
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "start_failed" })
    const screen = app.draw()
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✖ Starting/)
    expect(screen).toContain("✖ dev accepted deploy 2, but the app did not start.")
    expect(screen).toContain("Number 2 is used, so the next deploy will be 3.")
    expect(screen).toContain("╭─ Docker said ─")
    expect(screen).toContain("pull access denied for example/web, repository does not exist")

    m.docker.failWith(0)
    app.press({ kind: "escape" })
    await app.until(() => app.state.team?.servers[0]?.apps[0]?.outcome === "start_failed", "Home to show the failed deploy")
    await deployKey(app)
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3")
    expect(app.state.deploy?.outcome).toBe("started")
  })

  test("esc leaves a deploy that carries on, and its result arrives as a line on the screen below", async () => {
    const { m, app } = await onHome()
    m.docker.holdUp()
    await deployKey(app)
    await app.until(m.docker.upStarted, "Docker to start")
    app.press({ kind: "escape" })
    expect(top(app.state).name).toBe("home")
    expect(app.state.deploy?.running).toBe(true)
    // Home works meanwhile, but d and r wait for the deploy.
    app.press({ kind: "left" }, { kind: "right" })
    app.type("d")
    expect(top(app.state).name).toBe("home")
    m.docker.releaseUp()
    await ended(app)
    expect(top(app.state).name).toBe("home")
    expect(app.draw()).toMatch(/✔ demo is live on dev in \d+\.\ds/)
    expect(m.docker.calls()).toHaveLength(2)
  })

  test("q during a deploy says what it waits for, and closes when the deploy ends", async () => {
    const { m, app } = await onHome()
    m.docker.holdUp()
    await deployKey(app)
    await app.until(m.docker.upStarted, "Docker to start")
    app.type("q")
    expect(app.state.quitting).toBe(true)
    expect(app.state.exiting).toBe(false)
    expect(app.draw()).toContain("waiting for deploy 2 to finish")
    m.docker.releaseUp()
    await app.until(() => app.state.exiting, "the app to close")
    expect(app.state.deploy?.outcome).toBe("started")
  })

  test("r on the app screen deploys the selected earlier deploy again under the next number; r on Home the one before the latest", async () => {
    const { m, app } = await onHome(async (m) => {
      m.compose(COMPOSE_V2)
      expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    })
    await openDemo(app)
    expect(app.state.appView?.deploys.map((deploy) => deploy.sequence)).toEqual([2, 1])
    app.press({ kind: "down" })
    app.type("r")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 3, outcome: "started", from: "what deploy 1 ran", replaces: 2 })
    expect(readFileSync(join(m.runnerHome, "apps/demo/compose.yaml"), "utf8")).toBe(COMPOSE_V1)
    app.press({ kind: "escape" })
    await app.until(() => app.state.appView?.deploys[0]?.sequence === 3, "the history to show deploy 3")
    expect(app.draw()).toMatch(/3 +✔ started, a rollback to 1/)

    app.press({ kind: "escape" })
    expect(top(app.state).name).toBe("home")
    app.type("r")
    await app.until(() => app.state.deploy?.sequence === 4 && !app.state.deploy.running, "deploy 4")
    expect(app.state.deploy).toMatchObject({ outcome: "started", from: "what deploy 2 ran" })
    expect(readFileSync(join(m.runnerHome, "apps/demo/compose.yaml"), "utf8")).toBe(COMPOSE_V2)
  })

  test("with no compose.yaml in a folder that is not linked, d says so and names zekno link; nothing is signed", async () => {
    const { m, app } = await onHome(undefined, { linked: false })
    writeFileSync(join(m.project, "other.yaml"), COMPOSE_V1)
    rmSync(join(m.project, "compose.yaml"))
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice?.tone).toBe("error")
    expect(app.state.notice?.text).toContain("There is no compose.yaml in ")
    expect(app.state.notice?.text).toContain("and no zekno.json names another. Run zekno link -f <file> here to name one.")
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(1)
  })

  test("a secret set in the app: typed into the hidden prompt, stored, marked as after the deploy, and its value is never in the state or on screen", async () => {
    const VALUE = "s3cr3t-value-only-the-runner-may-read"
    const { m, app } = await onHome()
    await openDemo(app)
    app.type("s")
    app.type("API_KEY")
    app.press({ kind: "enter" })
    expect(hiddenPromptOpen(app.state)).toBe(true)

    const seen: string[] = []
    const look = () => seen.push(JSON.stringify(app.state), app.draw())
    look()
    for (const char of VALUE) {
      app.hidden(char)
      look()
    }
    app.hidden("\r", { return: true })
    look()
    await app.until(() => top(app.state).name === "app", "the value to be stored")
    look()
    expect(app.state.notice).toEqual({
      tone: "success",
      text: "Set API_KEY, version 1, for demo on dev. It takes effect on the next deploy.",
    })
    await app.until(() => app.state.appView?.secrets.length === 1, "the secrets to be read again")
    expect(app.state.appView?.secrets).toEqual([{ name: "API_KEY", version: 1, removed: false, afterDeploy: true }])
    look()
    expect(app.draw()).toMatch(/API_KEY +version 1/)
    expect(pane(app.draw(), "Secrets")).toContain("! API_KEY was set after deploy 1. It takes effect on the next deploy.")

    for (const frame of seen) {
      expect(frame).not.toContain(VALUE)
      expect(frame).not.toContain("only-the-runner")
    }
    for (const file of filesUnder(m.home)) expect(file.content).not.toContain(VALUE)
    m.out.length = 0
    expect(await m.zekno("secret", "ls", "--app", "demo", "--server", "dev")).toBe(0)
    expect(m.out).toEqual(["API_KEY\tversion 1"])

    // The next deploy carries it to the runner, and only the runner opens it.
    await deployKey(app)
    await ended(app)
    expect(m.docker.calls().at(-1)!.env.API_KEY).toBe(VALUE)
    app.press({ kind: "escape" })
    await app.until(() => app.state.appView?.secrets[0]?.afterDeploy === false, "the note to go")
    expect(app.draw()).not.toContain("was set after deploy")
    expect(app.failures).toEqual([])
  })

  test("the hidden prompt's rules: several lines refused with the pointer to --stdin, empty not stored, Ctrl-C cancels the prompt only, esc goes back", async () => {
    const { m, app } = await onHome()
    await openDemo(app)
    app.type("s")
    app.type("TOKEN")
    app.press({ kind: "enter" })

    app.hidden("first line\rsecond line")
    expect(app.state.notice).toEqual({ tone: "error", text: "That value has more than one line. Pipe it in and add `--stdin`." })
    expect(hiddenPromptOpen(app.state)).toBe(true)

    app.hidden("\r", { return: true })
    await app.until(() => app.state.notice?.text === "No value was given, so nothing was set.", "the empty value to be refused")
    expect(hiddenPromptOpen(app.state)).toBe(true)

    // Control keys never become part of the value; Ctrl-C closes the prompt, not the app.
    app.hidden("half")
    app.hidden("c", { ctrl: true })
    expect(app.state.exiting).toBe(false)
    expect(app.state.quitting).toBe(false)
    expect(top(app.state)).toMatchObject({ name: "set-secret", question: "name", secretName: "TOKEN" })
    // What was typed before Ctrl-C is gone: the next value starts empty.
    app.press({ kind: "enter" })
    app.hidden("whole")
    app.hidden("\r", { return: true })
    await app.until(() => app.state.appView?.secrets.length === 1, "the value to be stored")
    expect(top(app.state).name).toBe("app")

    app.type("s")
    app.type("OTHER")
    app.press({ kind: "enter" })
    app.hidden("", { escape: true })
    expect(top(app.state).name).toBe("app")

    m.out.length = 0
    expect(await m.zekno("secret", "ls", "--app", "demo", "--server", "dev")).toBe(0)
    expect(m.out).toEqual(["TOKEN\tversion 1"])
    // What was stored is "whole": the runner gets it with the next deploy.
    await deployKey(app)
    await ended(app)
    expect(m.docker.calls().at(-1)!.env.TOKEN).toBe("whole")
  })

  test("x removes a secret after a confirm; esc keeps it", async () => {
    const { m, app } = await onHome(async (m) => {
      m.typing("kept-or-removed")
      expect(await m.zekno("secret", "set", "API_KEY", "--app", "demo", "--server", "dev")).toBe(0)
      expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    })
    await openDemo(app)
    app.press({ kind: "tab" })
    app.type("x")
    expect(app.state.question).toEqual({ kind: "remove-secret", server: "dev", app: "demo", name: "API_KEY" })
    expect(app.draw()).toContain("╭─ Remove API_KEY? ─")
    app.press({ kind: "escape" })
    expect(app.state.question).toBeUndefined()

    app.type("x")
    app.press({ kind: "enter" })
    await app.until(() => app.state.appView?.secrets[0]?.removed === true, "the secret to show as removed")
    expect(app.state.notice).toEqual({ tone: "success", text: "Removed API_KEY from demo on dev. It takes effect on the next deploy." })
    const screen = app.draw()
    expect(screen).toMatch(/API_KEY +removed/)
    expect(pane(screen, "Secrets")).toContain("! API_KEY was removed after deploy 2. It takes effect on the next deploy.")
    m.out.length = 0
    expect(await m.zekno("secret", "ls", "--app", "demo", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toBe("demo on dev has no secrets.")
  })

  test("a server that cannot be reached is marked while the others answer, and nothing waits for a slow one", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "gone", "--local")).toBe(0)
    expect(await m.zekno("server", "add", "slow", "--local")).toBe(0)
    expect(await m.zekno("deploy", "--app", "demo", "--server", "gone")).toBe(0)
    const homes = Object.fromEntries(
      JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).servers.map((server: { name: string; target: { home: string } }) => [server.name, server.target.home])
    )
    // `gone` is a connection that fails at once, `slow` one that says nothing for two seconds.
    const deps: OpDeps = {
      ...m.deps,
      connect: (target: Target, runner: string[], options?: ConnectOptions) => {
        const home = target.kind === "local" ? target.home : undefined
        if (home === homes.gone) return connect(target, ["sh", "-c", "exit 255", "sh"], options)
        if (home === homes.slow) return connect(target, ["sh", "-c", "sleep 2", "sh"], options)
        return connect(target, runner, options)
      },
    }
    const app = openApp(m, await loadStart(deps), deps)
    const checked = app.effects.checkServers()
    const reachable = () => Object.fromEntries(app.state.team!.servers.map((server) => [server.name, server.reachable]))
    await app.until(() => reachable().dev === true && reachable().gone === false, "dev and gone to be known")
    expect(reachable().slow).toBeUndefined()
    // Keys work while slow is still being asked.
    app.press({ kind: "down" })
    const screen = app.draw()
    expect(screen).toMatch(/❯ gone +✖/)
    expect(screen).toMatch(/ {3}dev +●/)
    expect(screen).toMatch(/❯ demo +1 +● unknown/)
    expect(pane(screen, "Apps on gone")).toContain("✖ gone could not be reached. Numbers are from this machine's history.")
    expect(pane(screen, "Apps on gone")).toContain("The runner did not answer as expected. Check that it is installed and reachable.")
    await checked
    expect(reachable()).toEqual({ dev: true, gone: false, slow: false })
    expect(app.failures).toEqual([])
  }, 15_000)
})
