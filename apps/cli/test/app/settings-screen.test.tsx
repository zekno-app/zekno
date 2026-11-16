/**
 * The settings screen as drawn (specs/010-app-settings,
 * contracts/app-screen.md, "What it shows" and "States no board shows";
 * board `AppSettings`; tasks T045): through `AppView`, as the other screens
 * are drawn, at 100 by 30 and 80 by 24, on a dark and a light terminal.
 */
import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"
import { join } from "node:path"

import { AppView } from "../../src/app/app"
import { top } from "../../src/app/state/reading"
import type { AppEvent } from "../../src/app/state/events"
import type { State } from "../../src/app/state/types"
import { AS1, AS2, AS6, SH1, SH2 } from "../../src/settings/words"
import type { Settings } from "../../src/settings/types"
import { BRAND, BRAND_DARKER } from "../../src/ui/terminal/theme"
import { logoLines } from "../../src/ui/terminal/logo"
import { DESIGN_SETTINGS } from "../support/settings-files"
import {
  K,
  onBoard,
  opened,
  play,
  settingsRead,
} from "../support/settings-view"

/** The window as the app draws it. */
const draw = (state: State, columns = 100, rows = 30) =>
  renderToString(<AppView state={state} columns={columns} rows={rows} />, {
    columns,
  }).split("\n")

/** Nothing is drawn past the window. */
function fits(lines: string[], columns: number, rows: number) {
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines)
    expect([...line].length).toBeLessThanOrEqual(columns)
}

/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) =>
  screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

/** A line of the two panes at 100 columns: the Services pane's 18 columns inside, the service pane's 71. */
const twoPanes = (left: string, right: string) =>
  ` │ ${left.padEnd(18)} │ │ ${right.padEnd(71)} │`

/** A row of the service pane: the marker's two columns, the label padded to 11, the value. */
const row = (label: string, value: string, selected = false) =>
  `${selected ? "❯" : " "} ${label.padEnd(11)}${value}`

const board = () => onBoard()

describe("the board AppSettings, 100 by 30", () => {
  test("line by line: the header, the Services pane, the service's rows in sections, the foot and the hints", () => {
    const lines = draw(board())
    const logo = logoLines()
    expect(lines[0]).toBe(` ${logo[0]}`.trimEnd())
    expect(lines[1]).toBe(` ${logo[1]}`.trimEnd())
    expect(lines[2]!.startsWith(` ${logo[2]} › prod › demo › settings`)).toBe(
      true
    )
    expect(lines[2]!.trimEnd().endsWith("● running deploy 4")).toBe(true)
    expect([...lines[2]!.trimEnd()].length).toBe(99)
    expect(lines[3]).toBe("")
    expect(lines.slice(4, 27)).toEqual([
      ` ╭${"─".repeat(20)}╮ ╭${"─".repeat(73)}╮`,
      twoPanes("Services", `web${" ".repeat(54)}zekno.app.json`),
      twoPanes("❯ web", "Source"),
      twoPanes("  worker", row("image", "ghcr.io/acme/demo-web:1.4.2")),
      twoPanes("", "Deploy"),
      twoPanes("", row("start", "bun run start")),
      twoPanes("", row("restart", "on failure")),
      twoPanes(
        "",
        row("memory", "1g  ! changed, not deployed (was 512m)", true)
      ),
      twoPanes("", row("cpus", "1")),
      twoPanes("", "Networking"),
      twoPanes("", row("port", "3000")),
      twoPanes("", row("published", "not published")),
      twoPanes("", "Variables"),
      twoPanes("", row("secrets", "DATABASE_URL, SESSION_KEY")),
      twoPanes("", row("plain", "NODE_ENV=production")),
      twoPanes("", "Volumes"),
      twoPanes("", row("uploads", "/data/uploads")),
      twoPanes("", ""),
      twoPanes("", ""),
      twoPanes("", ""),
      twoPanes("One app, one file:", "─".repeat(71)),
      twoPanes("zekno.app.json", AS1),
      ` ╰${"─".repeat(20)}╯ ╰${"─".repeat(73)}╯`,
    ])
    expect(lines.slice(27)).toEqual([
      "",
      "",
      " ↑↓ move  enter change  tab services  c Compose text  d deploy  esc back",
    ])
    expect(AS2).toBe("One app, one file: zekno.app.json")
    fits(lines, 100, 30)
  })

  test("tab shows worker: its rows, the settings it leaves out in their words, and none for plain and volumes", () => {
    const lines = draw(play(board(), K.tab).state).join("\n")
    expect(lines).toContain(twoPanes("  web", "Source"))
    expect(lines).toContain(
      twoPanes("❯ worker", row("image", "ghcr.io/acme/demo-worker:1.4.2", true))
    )
    for (const [label, value] of [
      ["start", "bun run worker"],
      ["restart", "always"],
      ["memory", "no limit"],
      ["cpus", "no limit"],
      ["port", "none"],
      ["published", "not published"],
      ["secrets", "DATABASE_URL"],
      ["plain", "none"],
      ["", "none"],
    ] as const)
      expect(lines).toContain(`│ ${row(label, value)}`)
  })

  test("a start command not set is the image's own; a plain variable per row, labelled once; a value too wide goes on under itself, never under the labels", () => {
    const long = `${"x".repeat(50)} ${"y".repeat(30)}`
    const settings: Settings = {
      version: 1,
      services: [
        [
          "web",
          {
            image: "nginx:1.27",
            plain: [
              ["A", "1"],
              ["LONG", long],
            ],
          },
        ],
      ],
    }
    const state = play(opened(), settingsRead(settings)).state
    const lines = draw(state).join("\n")
    expect(lines).toContain(row("start", "the image's own"))
    expect(lines).toContain(row("plain", "A=1"))
    // The value starts at the value column, and goes on under itself at that column.
    expect(lines).toContain(row("", `LONG=${"x".repeat(50)}`))
    expect(lines).toContain(row("", "y".repeat(30)))
  })
})

describe("the states no board shows", () => {
  const sentence = (
    outcome: Extract<AppEvent, { type: "settings-read" }>["outcome"]
  ) =>
    draw(
      play(opened(), {
        type: "settings-read",
        server: "prod",
        app: "demo",
        outcome,
      }).state
    )

  for (const [name, said, first, rest] of [
    [
      "no settings file",
      SH1,
      "This folder has no settings file.",
      "Run zekno settings init to start one.",
    ],
    ["a Compose file", SH2("compose.yaml"), SH2("compose.yaml"), undefined],
    [
      "linked to another app",
      AS6("api", "prod"),
      "This folder is linked to api on prod.",
      "Its settings are on that app's screen.",
    ],
  ] as const) {
    test(`${name}: one pane with the sentence, and esc back`, () => {
      const lines = sentence({ kind: "sentence", sentence: said })
      const text = lines.join("\n")
      expect(text).not.toContain("Services")
      // The pane's words, whatever line they wrap onto.
      expect(words(text)).toContain(` ${first} ${rest ?? ""}`.trimEnd())
      expect(lines.at(-1)).toBe(" esc back")
      expect(lines[2]).toContain("› prod › demo › settings")
      fits(lines, 100, 30)
    })
  }

  test("a fault: its first sentence, then its place and rule on the next line", () => {
    const lines = sentence({
      kind: "fault",
      first: "zekno.app.json could not be read as settings.",
      rest: "web, deploy.memory: use a size such as 512m or 1g.",
    })
    const at = lines.findIndex((line) =>
      line.includes("zekno.app.json could not be read as settings.")
    )
    const inside = (said: string) => ` │ ${said.padEnd(94)} │`
    expect(lines[at]).toBe(
      inside("zekno.app.json could not be read as settings.")
    )
    expect(lines[at + 1]).toBe(
      inside("web, deploy.memory: use a size such as 512m or 1g.")
    )
    expect(lines.at(-1)).toBe(" esc back")
  })

  test("before the read comes back: the Services pane and an empty service pane", () => {
    const lines = draw(opened())
    const text = lines.join("\n")
    expect(text).toContain("│ Services")
    expect(text).toContain("One app, one file:")
    expect(text).not.toContain("Source")
    expect(text).not.toContain(AS1)
    expect(lines.at(-1)).toBe(
      " ↑↓ move  enter change  tab services  c Compose text  d deploy  esc back"
    )
  })

  test("a line about something done elsewhere stands above the hints, and the panes keep their room for it", () => {
    for (const [columns, rows] of [
      [100, 30],
      [80, 24],
    ] as const) {
      const state = play(onBoard({ columns, rows }), {
        type: "notice",
        notice: {
          tone: "error",
          text: "zekno.app.json changed since zekno read it, so nothing was written. Try again.",
        },
      }).state
      const lines = draw(state, columns, rows)
      fits(lines, columns, rows)
      expect(lines.join("\n")).toContain("✖ zekno.app.json changed since zekno")
      expect(lines.join("\n")).toContain("❯ memory")
      expect(lines.join("\n")).toContain("╰")
    }
  })

  test("too small: the app's message, and the screen as it was when there is room again", () => {
    const small = play(board(), { type: "resize", columns: 79, rows: 30 }).state
    const lines = draw(small, 79, 30).join("\n")
    expect(lines).toContain("zekno needs a larger window.")
    expect(lines).not.toContain("Services")
    const back = play(small, { type: "resize", columns: 100, rows: 30 }).state
    expect(draw(back)).toEqual(draw(board()))
  })
})

describe("80 by 24", () => {
  const NARROW = { columns: 80, rows: 24 }

  test("it fits; the header shows the state alone; the rows are a window with the more lines", () => {
    const state = play(opened(NARROW), settingsRead(DESIGN_SETTINGS)).state
    const lines = draw(state, 80, 24)
    fits(lines, 80, 24)
    expect(lines[2]!.trimEnd()).toMatch(/› prod › demo › settings +● running$/)
    expect(lines[2]).not.toContain("deploy 4")
    const text = lines.join("\n")
    // The Services pane keeps its 22 columns.
    expect(lines[4]).toBe(` ╭${"─".repeat(20)}╮ ╭${"─".repeat(53)}╮`)
    expect(text).toContain(
      `│ ${row("image", "ghcr.io/acme/demo-web:1.4.2", true)}`
    )
    expect(text).toMatch(/│ {3}↓ 5 more +│/)
    expect(text).not.toMatch(/↑ \d+ more/)
    expect(text).toContain("A change is written to the file. It runs after the")
    expect(lines.at(-1)).toBe(
      " ↑↓ move  enter change  tab services  c Compose text  d deploy  esc back"
    )
  })

  test("moving down keeps the selected row in view, with ↑ <n> more above once rows are hidden there", () => {
    let state = play(opened(NARROW), settingsRead(DESIGN_SETTINGS)).state
    const labels = [
      "image",
      "start",
      "restart",
      "memory",
      "cpus",
      "port",
      "published",
      "secrets",
      "plain",
      "uploads",
    ]
    let sawAbove = false
    for (const label of labels) {
      const lines = draw(state, 80, 24)
      fits(lines, 80, 24)
      const text = lines.join("\n")
      expect({ label, drawn: text.includes(`│ ❯ ${label}`) }).toEqual({
        label,
        drawn: true,
      })
      if (/↑ \d+ more/.test(text)) sawAbove = true
      state = play(state, K.down).state
    }
    expect(sawAbove).toBe(true)
    const last = draw(state, 80, 24).join("\n")
    expect(last).toMatch(/│ {3}↑ 5 more +│/)
    expect(last).not.toMatch(/↓ \d+ more/)
  })

  test("many services: the Services pane is a window too, the shown one always in it", () => {
    const services = Array.from(
      { length: 32 },
      (_, at) => [`svc-${at}`, { image: "nginx:1.27" }] as const
    )
    let state = play(
      opened(NARROW),
      settingsRead({ version: 1, services })
    ).state
    for (let at = 0; at < 32; at++) {
      const lines = draw(state, 80, 24)
      fits(lines, 80, 24)
      expect(lines.join("\n")).toContain(`│ ❯ svc-${at} `)
      state = play(state, K.tab).state
    }
  })
})

/** The window as a terminal that shows every colour receives it, on a dark or a light terminal, drawn in a process of its own. */
function drawnInColour(
  state: State,
  background: "dark" | "light",
  columns = 100,
  rows = 30
): string {
  const script = [
    'import { createElement } from "react"',
    'import { renderToString } from "ink"',
    `import { AppView } from ${JSON.stringify(join(import.meta.dir, "../../src/app/app.tsx"))}`,
    `import { ThemeProvider, themeFor } from ${JSON.stringify(join(import.meta.dir, "../../src/ui/terminal/theme.ts"))}`,
    "const state = JSON.parse(process.argv.at(-1))",
    `const view = createElement(AppView, { state, columns: ${columns}, rows: ${rows} })`,
    `process.stdout.write(renderToString(createElement(ThemeProvider, { value: themeFor(${JSON.stringify(background)}) }, view), { columns: ${columns} }))`,
  ].join("\n")
  const run = Bun.spawnSync(
    [process.execPath, "-e", script, JSON.stringify(state)],
    { env: { ...process.env, FORCE_COLOR: "3" } }
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString()
}

/** A colour in the form a terminal of every colour receives it. */
const rgb = (hex: string) =>
  `38;2;${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(";")}`

describe("colours, on a dark and a light terminal", () => {
  for (const [background, brand] of [
    ["dark", BRAND],
    ["light", BRAND_DARKER],
  ] as const) {
    test(`${background}: the brand marks focus and the selected row, the mark is in the warning colour, and no colour is fixed`, () => {
      const drawn = drawnInColour(board(), background)
      const lines = drawn.split("\n")
      const memory = lines.find((line) => line.includes("memory"))!
      // The marker in the theme's brand colour, the label bold, the mark yellow.
      expect(memory).toContain(`\x1b[${rgb(brand)}m❯`)
      expect(memory).toContain("\x1b[1mmemory")
      expect(memory).toContain("\x1b[33m  ! changed, not deployed (was 512m)")
      // The other labels faint, and a setting left out faint.
      const port = lines.find((line) => line.includes("port"))!
      expect(port).toContain("\x1b[2mport")
      expect(lines.find((line) => line.includes("not published"))).toContain(
        "\x1b[2mnot published"
      )
      // The service pane's border is the brand's, the Services pane's faint.
      expect(lines[4]).toContain(`\x1b[${rgb(brand)}m╭`)
      expect(lines[4]).toMatch(/\x1b\[2m╭/)
      // The only colours are the theme's: its brand, green for running, yellow for the mark.
      const colours = new Set(
        [...drawn.matchAll(/\x1b\[([0-9;]*)m/g)]
          .map((match) => match[1]!)
          .filter((code) => /^(3[0-7]|9[0-7]|38;)/.test(code))
      )
      expect([...colours].sort()).toEqual([rgb(brand), "32", "33"].sort())
    })
  }
})

describe("the screen keeps its state", () => {
  test("the app screen is underneath, and esc goes back to it", () => {
    const state = play(board(), K.esc).state
    expect(top(state).name).toBe("app")
    expect(draw(state).join("\n")).toContain("Deploys")
  })
})
