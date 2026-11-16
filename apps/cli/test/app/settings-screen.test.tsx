/**
 * The settings screen as drawn (specs/010-app-settings,
 * contracts/app-screen.md, "What it shows", "Changing a value", "The
 * Compose text" and "States no board shows"; boards `AppSettings` and
 * `AppSettingsEdit`; tasks T045, T059 and T063): through `AppView`, as the
 * other screens are drawn, at 100 by 30 and 80 by 24, on a dark and a light
 * terminal. It is one file, longer than most, on purpose: the tasks name it,
 * and both boards are read against it line by line in one pass.
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
import { DESIGN_COMPOSE, DESIGN_SETTINGS } from "../support/settings-files"
import {
  K,
  onBoard,
  opened,
  play,
  settingsRead,
  text,
  typing,
  withMemory,
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

/** The review's case of S3, as the CLI report's tests have it: the last deploy had a memory limit, REQUIRE_AUTH, the volume audit and the service auth. */
const S3_DEPLOYED: Settings = {
  version: 1,
  services: [
    [
      "web",
      {
        image: "ghcr.io/acme/web:1",
        memory: "512m",
        plain: [
          ["NODE_ENV", "production"],
          ["REQUIRE_AUTH", "1"],
        ],
        volumes: [
          ["data", "/data"],
          ["audit", "/var/audit"],
        ],
      },
    ],
    ["auth", { image: "ghcr.io/acme/auth:1" }],
  ],
}
const S3_NOW: Settings = {
  version: 1,
  services: [
    [
      "web",
      {
        image: "ghcr.io/acme/web:1",
        plain: [["NODE_ENV", "production"]],
        volumes: [["data", "/data"]],
      },
    ],
  ],
}

describe("what the next deploy removes (security review S3)", () => {
  const s3 = (size = { columns: 100, rows: 30 }) =>
    play(opened(size), settingsRead(S3_NOW, { deployed: S3_DEPLOYED })).state

  test("100 by 30: the service the file no longer has under the others with its mark; the variable and the volume as rows of their own, marked with what they were", () => {
    const lines = draw(s3())
    fits(lines, 100, 30)
    for (const line of [
      twoPanes(
        "Services",
        "web                                                      zekno.app.json"
      ),
      twoPanes("❯ web", "Source"),
      twoPanes("  auth", row("image", "ghcr.io/acme/web:1", true)),
      twoPanes("  ! removed, not", "Deploy"),
      twoPanes("  deployed", row("start", "the image's own")),
      twoPanes(
        "",
        row("memory", "no limit  ! changed, not deployed (was 512m)")
      ),
      twoPanes("", row("plain", "NODE_ENV=production")),
      twoPanes(
        "",
        row("", "none  ! removed, not deployed (was REQUIRE_AUTH=1)")
      ),
      twoPanes("", row("data", "/data")),
      twoPanes(
        "",
        row("audit", "none  ! removed, not deployed (was /var/audit; its data")
      ),
      twoPanes("", row("", "stays)")),
    ])
      expect(lines).toContain(line)
  })

  test("80 by 24: it fits, the service's mark in the Services pane; moving down reaches the removed rows", () => {
    let state = s3({ columns: 80, rows: 24 })
    const first = draw(state, 80, 24)
    fits(first, 80, 24)
    expect(first.join("\n")).toContain("│   ! removed, not   │")
    for (let at = 0; at < 12; at++) state = play(state, K.down).state
    const last = draw(state, 80, 24)
    fits(last, 80, 24)
    expect(words(last.join("\n"))).toContain(
      "audit none ! removed, not deployed (was /var/audit; its data stays)"
    )
  })

  test("enter on a removed row adds one, as a none row does (AS7)", () => {
    let state = s3()
    // image, start, restart, memory, cpus, port, published, secrets, plain, the removed variable.
    for (let at = 0; at < 9; at++) state = play(state, K.down).state
    const after = play(state, K.enter).state
    expect(after.notice).toEqual({
      tone: "info",
      text: "Add one with `zekno settings set web.plain.<NAME> <value>`.",
    })
  })

  test("the marks are in the warning colour, the removed service's name faint", () => {
    const lines = drawnInColour(s3(), "dark").split("\n")
    const variable = lines.find((line) => line.includes("REQUIRE_AUTH"))!
    expect(variable).toContain(
      "\x1b[33m  ! removed, not deployed (was REQUIRE_AUTH=1)"
    )
    const service = lines.find(
      (line) => line.includes("! removed, not") && !line.includes("(was")
    )!
    expect(service).toContain("\x1b[33m! removed, not")
    expect(lines.some((line) => line.includes("\x1b[2m  auth\x1b[22m"))).toBe(
      true
    )
  })
})

describe("the screen keeps its state", () => {
  test("the app screen is underneath, and esc goes back to it", () => {
    const state = play(board(), K.esc).state
    expect(top(state).name).toBe("app")
    expect(draw(state).join("\n")).toContain("Deploys")
  })
})

/** The settings of the board AppSettingsEdit: design.md's file with web's memory at 512m, as deployed. */
const EDIT = withMemory(DESIGN_SETTINGS, "512m")
/** The memory row of the board, opened and emptied, `value` typed, and enter. */
const memory = (size = { columns: 100, rows: 30 }, value?: string) =>
  play(
    opened(size),
    settingsRead(EDIT, { deployed: EDIT }),
    K.down,
    K.down,
    K.down,
    K.enter,
    ...(value === undefined
      ? []
      : [
          ...Array.from({ length: 4 }, () => K.backspace),
          ...typing(value),
          K.enter,
        ])
  ).state

/** A line of the one pane at 100 columns: 94 columns inside. */
const onePane = (inside: string) => ` │ ${inside.padEnd(94)} │`
/** A line of the change box inside it: 90 columns inside. */
const inBox = (inside: string) => onePane(`│ ${inside.padEnd(90)} │`)

describe("changing a value (board AppSettingsEdit)", () => {
  test("asking, 512m to 1g, line by line: one pane, the Deploy section, the box at its foot, the hints", () => {
    const lines = draw(memory(undefined, "1g"))
    expect(lines[2]).toContain("› prod › demo › settings")
    expect(lines.join("\n")).not.toContain("Services")
    expect(lines.slice(4, 27)).toEqual([
      ` ╭${"─".repeat(96)}╮`,
      onePane(`web${" ".repeat(77)}zekno.app.json`),
      onePane("Deploy"),
      onePane(row("start", "bun run start")),
      onePane(row("restart", "on failure")),
      onePane(row("memory", "512m", true)),
      onePane(row("cpus", "1")),
      ...Array.from({ length: 9 }, () => onePane("")),
      onePane(`╭${"─".repeat(92)}╮`),
      inBox("Change a setting  web · memory limit"),
      inBox("now  512m"),
      inBox("new  1g"),
      inBox(
        "? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)"
      ),
      onePane(`╰${"─".repeat(92)}╯`),
      ` ╰${"─".repeat(96)}╯`,
    ])
    expect(lines.slice(27)).toEqual([
      "",
      "",
      " y write it  n keep 512m  esc back",
    ])
    fits(lines, 100, 30)
  })

  test("typing: the question with the value filled in and the cursor; a refused value's rule under it, set in by two columns", () => {
    const open = draw(memory()).join("\n")
    expect(open).toContain(inBox("? Memory limit › 512m"))
    expect(draw(memory()).at(-1)).toBe(" enter next  esc back")
    const refused = draw(memory(undefined, "lots")).join("\n")
    expect(refused).toContain(inBox("? Memory limit › lots"))
    expect(refused).toContain(inBox("  Use a size such as 512m or 1g."))
  })

  test("picking restart: the question and the three rules, the marker on the one chosen", () => {
    const state = play(
      opened(),
      settingsRead(EDIT),
      K.down,
      K.down,
      K.enter
    ).state
    const lines = draw(state)
    const text = lines.join("\n")
    expect(text).toContain(inBox("Change a setting  web · restart rule"))
    expect(text).toContain(inBox("? Restart rule"))
    expect(text).toContain(inBox("    no"))
    expect(text).toContain(inBox("  ❯ on failure"))
    expect(text).toContain(inBox("    always"))
    expect(lines.at(-1)).toBe(" ↑↓ move  enter choose  esc back")
  })

  test("a value filled in from the file is drawn cleaned: a character drawn as nothing is not drawn", () => {
    const settings: Settings = {
      version: 1,
      services: [
        ["web", { image: "nginx:1.27", plain: [["NOTE", "a\u202eb"]] }],
      ],
    }
    const state = play(
      opened(),
      settingsRead(settings),
      ...Array.from({ length: 8 }, () => K.down),
      K.enter
    ).state
    const text = draw(state).join("\n")
    expect(text).toContain(inBox("Change a setting  web · NOTE"))
    expect(text).toContain(inBox("? NOTE › ab"))
    expect(text).not.toContain("\u202e")
  })

  test("a value that is not set reads in its words; a long value's end is shown, with the cursor", () => {
    const worker = play(
      opened(),
      settingsRead(EDIT),
      K.tab,
      K.down,
      K.down,
      K.down,
      K.enter,
      ...typing("2g"),
      K.enter
    ).state
    const text = draw(worker).join("\n")
    expect(text).toContain(inBox("Change a setting  worker · memory limit"))
    expect(text).toContain(inBox("now  no limit"))
    expect(text).toContain(inBox("new  2g"))
    expect(draw(worker).at(-1)).toBe(" y write it  n keep no limit  esc back")
    const long = play(
      opened(),
      settingsRead(EDIT),
      K.down,
      K.enter,
      ...typing(` ${"word ".repeat(80)}end`)
    ).state
    const drawn = draw(long)
    fits(drawn, 100, 30)
    expect(drawn.join("\n")).toContain("end")
  })

  for (const [name, state] of [
    ["typing", () => memory({ columns: 80, rows: 24 })],
    ["refused", () => memory({ columns: 80, rows: 24 }, "lots")],
    ["asking", () => memory({ columns: 80, rows: 24 }, "1g")],
    [
      "picking",
      () =>
        play(
          opened({ columns: 80, rows: 24 }),
          settingsRead(EDIT),
          K.down,
          K.down,
          K.enter
        ).state,
    ],
  ] as const) {
    test(`80 by 24, ${name}: it fits, the row being changed is drawn, and the box is whole`, () => {
      const lines = draw(state(), 80, 24)
      fits(lines, 80, 24)
      const text = lines.join("\n")
      expect(text).toMatch(/❯ (memory|restart)/)
      expect(text).toContain("Change a setting  web ·")
      expect(lines.filter((line) => line.includes("╰")).length).toBe(2)
    })
  }

  test("colours: the box's border and ? in the brand colour, the pane's border faint, the new value bold, the rule refused in the warning colour", () => {
    for (const [background, brand] of [
      ["dark", BRAND],
      ["light", BRAND_DARKER],
    ] as const) {
      const asking = drawnInColour(memory(undefined, "1g"), background).split(
        "\n"
      )
      expect(asking[4]).toMatch(/\x1b\[2m╭/)
      expect(
        asking.find((line) => line.includes("Change a setting"))
      ).toContain("\x1b[1mChange a setting")
      // The box's top border: the second line that opens a box.
      const boxTop = asking.find((line, at) => at > 4 && line.includes("╭"))!
      expect(boxTop).toContain(`\x1b[${rgb(brand)}m╭`)
      expect(asking.find((line) => line.includes("new"))).toContain("\x1b[1m1g")
      expect(asking.find((line) => line.includes("(y/N)"))).toContain(
        `\x1b[${rgb(brand)}m?`
      )
      const refused = drawnInColour(memory(undefined, "lots"), background)
      expect(refused).toContain("\x1b[33mUse a size such as 512m or 1g.")
    }
  })
})

/** The Compose text of design.md's file, as the screen shows it after `c`. */
const composing = (
  size = { columns: 100, rows: 30 },
  settings = DESIGN_SETTINGS
) => play(opened(size), settingsRead(settings), text("c")).state

describe("the Compose text (c)", () => {
  test("in the service pane's place: titled Compose text, the file on the right, the text line by line; the Services pane stays", () => {
    const lines = draw(composing())
    expect(lines[5]).toBe(
      twoPanes("Services", `Compose text${" ".repeat(45)}zekno.app.json`)
    )
    const text = lines.join("\n")
    for (const line of DESIGN_COMPOSE.split("\n").slice(0, 19))
      expect(text).toContain(twoPanes("", line).slice(24))
    expect(text).toContain(twoPanes("❯ web", "services:"))
    expect(text).toMatch(/│ {3}↓ 5 more +│/)
    expect(lines.at(-1)).toBe(" ↑↓ scroll  c settings  esc back")
    fits(lines, 100, 30)
  })

  test("scrolled to its end: its last line shows, with ↑ <n> more above", () => {
    const end = play(
      composing(),
      ...Array.from({ length: 40 }, () => K.down)
    ).state
    const text = draw(end).join("\n")
    expect(text).toMatch(/│ {3}↑ 5 more +│/)
    expect(text).toContain(twoPanes("", '  "uploads": {}').slice(24))
    expect(text).not.toMatch(/↓ \d+ more/)
  })

  test("80 by 24: it fits, scrolled from top to end", () => {
    let state = composing({ columns: 80, rows: 24 })
    for (let step = 0; step < 14; step++) {
      fits(draw(state, 80, 24), 80, 24)
      state = play(state, K.down).state
    }
    const text = draw(state, 80, 24).join("\n")
    expect(text).toMatch(/↑ 11 more/)
    expect(text).toContain('"uploads": {}')
  })

  test("a line wider than the pane goes on under itself; a character drawn as nothing is not drawn", () => {
    const long = "x".repeat(60)
    const settings: Settings = {
      version: 1,
      services: [
        [
          "web",
          {
            image: "nginx:1.27",
            plain: [
              ["LONG", `${long} ${long}`],
              ["HIDDEN", "a\u202eb"],
            ],
          },
        ],
      ],
    }
    const text = draw(composing(undefined, settings)).join("\n")
    expect(text).toContain(twoPanes("", `      "LONG":`).slice(24))
    expect(text).toContain(twoPanes("", `      "${long}`).slice(24))
    expect(text).toContain(twoPanes("", `      ${long}"`).slice(24))
    expect(text).toContain('"HIDDEN": "ab"')
    expect(text).not.toContain("\u202e")
  })

  test("every line of the text is faint", () => {
    const drawn = drawnInColour(composing(), "dark").split("\n")
    for (const words of ["services:", 'image: "ghcr.io/acme/demo-web:1.4.2"'])
      expect(drawn.find((line) => line.includes(words))).toContain(
        `\x1b[2m${words.startsWith("image") ? `    ${words}` : words}`
      )
  })
})
