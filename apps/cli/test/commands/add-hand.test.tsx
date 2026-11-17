/**
 * `zekno add` through `run` in a folder that deploys a Compose file written
 * by hand, at a stand-in terminal (specs/012-templates, contracts/commands.md,
 * "A hand-written Compose file"; board `AddOther`, left column; plan.md, D17,
 * D25, D31; tasks T049): the board's lines at 100 and at 80 columns, AH6, a
 * yes storing both secrets (AD17), a no drawing AH9 dim, mysql's three
 * secrets, `--yes`, and AU10 for `--for`. The Compose file is byte for byte
 * as before in every case, and nothing is contacted or deployed. Kept apart
 * from add.test.tsx, which would pass the 500 lines a file may have; the
 * same with no terminal is test/scenarios/add-hand.test.ts.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { handLines } from "../../src/templates/hand"
import { BEFORE_FILE } from "../support/add-files"
import { atTerminal, two } from "../support/add-terminal"
import { drawnInColour, plainOf, wordRuns } from "../support/colour"
import { machine, ready } from "../support/helpers"
import { FIRST_TEMPLATES } from "../support/template-files"
import { KEYS, shows, terminal } from "../support/terminal"

const LINES_FILE = join(import.meta.dir, "../../src/ui/ink/lines.tsx")

/** A Compose file a person wrote: zekno never reads or writes it. */
const COMPOSE =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      GREETING: hello\n"

type Machine = ReturnType<typeof machine>

let m: Machine
let serverId: string
beforeAll(async () => {
  m = await ready()
  serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
    .servers[0].serverId
}, 60_000)

/** A folder holding only the person's compose.yaml. */
function handFolder(): string {
  const cwd = tempDir("add-hand")
  writeFileSync(join(cwd, "compose.yaml"), COMPOSE)
  return cwd
}

/** The app's secret store on dev, as text, or undefined when there is none. */
const storeText = (app: string): string | undefined => {
  const path = join(m.home, "secrets", serverId, `${app}.json`)
  return existsSync(path) ? readFileSync(path, "utf8") : undefined
}

/** `zekno <args>` at the stand-in terminal, on the team's machine. */
const onTerminal = (
  cwd: string,
  args: string[],
  keys?: Parameters<typeof atTerminal>[3],
  options?: Parameters<typeof atTerminal>[4]
) => atTerminal(m, cwd, args, keys, options)

/** A box as the lines are drawn in: a faint border, `width` columns. */
const box = (lines: readonly string[], width: number) => [
  `╭${"─".repeat(width - 2)}╮`,
  ...lines.map((line) => `│ ${line.padEnd(width - 4)} │`),
  `╰${"─".repeat(width - 2)}╯`,
]

const POSTGRES = handLines(FIRST_TEMPLATES.postgres!, undefined, "compose.yaml")

/** The board `AddOther`'s left column, up to the question, at 100 columns: with D1 and D2's words and the whole digest (D25). */
const BOARD = [
  "This folder deploys from compose.yaml, a file written by hand.",
  "Zekno does not edit it. Add these lines yourself.",
  "Under services:",
  ...box(POSTGRES.service, 100),
  "Under volumes:  postgres-data:",
  "In the environment: of each service that uses it",
  ...box(POSTGRES.offers, 40),
]

const question = (app: string, count = "two") =>
  `? Make and store its ${count} secrets for ${app} on dev? (y/N)`

const stored = "✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for dev"

describe("a hand-written Compose file (board `AddOther`, left column)", () => {
  test("at 100 columns: the board's lines, AH6 answered y, both secrets stored (AD17), status 0; the Compose file as it was; nothing contacted, nothing deployed", async () => {
    const cwd = handFolder()
    const run = await onTerminal(
      cwd,
      ["add", "postgres", "--app", "hand", "--server", "dev"],
      async (t) => {
        await shows(t, question("hand"))
        t.keys("y")
      }
    )
    expect(run.lines).toEqual([...BOARD, `${question("hand")} yes`, stored])
    expect(run.code).toBe(0)
    expect(run.contacted).toBe(0)
    expect(run.docker).toBe(0)
    expect(readFileSync(join(cwd, "compose.yaml"), "utf8")).toBe(COMPOSE)
    expect(JSON.parse(storeText("hand")!).records.length).toBe(2)
  })

  test("at 80 columns: every line fits, the boxes as wide as the window allows", async () => {
    const run = await onTerminal(
      handFolder(),
      ["add", "postgres", "--app", "hand80", "--server", "dev"],
      async (t) => {
        await shows(t, question("hand80"))
        t.keys("y")
      },
      { columns: 80 }
    )
    for (const line of run.lines)
      expect([...line].length).toBeLessThanOrEqual(80)
    expect(run.lines.slice(0, 4)).toEqual([
      ...BOARD.slice(0, 3),
      `╭${"─".repeat(78)}╮`,
    ])
    expect(run.lines.slice(-5)).toEqual([
      ...box(POSTGRES.offers, 40),
      `${question("hand80")} yes`,
      stored,
    ])
    expect(run.code).toBe(0)
  })

  test("n, Enter, Esc and Ctrl-C at AH6: No secret was made., status 1, nothing stored", async () => {
    for (const [index, key] of [
      "n",
      KEYS.enter,
      KEYS.esc,
      KEYS.ctrlC,
    ].entries()) {
      const cwd = handFolder()
      const app = `handno${index}`
      const run = await onTerminal(
        cwd,
        ["add", "postgres", "--app", app, "--server", "dev"],
        async (t) => {
          await shows(t, question(app))
          t.keys(key)
        }
      )
      expect(run.lines.slice(-2)).toEqual([
        `${question(app)} no`,
        "No secret was made.",
      ])
      expect(run.code).toBe(1)
      expect(storeText(app)).toBeUndefined()
      expect(readFileSync(join(cwd, "compose.yaml"), "utf8")).toBe(COMPOSE)
    }
  })

  test("No secret was made. is one quiet cell, which a terminal draws dim from column 0 (D17)", async () => {
    const t = terminal(100, 40)
    const cells: unknown[] = []
    const line = t.ui.line
    t.ui.line = (plain, drawn) => {
      cells.push(drawn)
      line(plain, drawn)
    }
    const ui = m.deps.ui
    m.deps.ui = t.ui
    m.deps.cwd = handFolder()
    try {
      const running = m.zekno(
        "add",
        "postgres",
        "--app",
        "handdim",
        "--server",
        "dev"
      )
      await shows(t, question("handdim"))
      t.keys("n")
      expect(await running).toBe(1)
      await t.ui.close()
    } finally {
      m.deps.ui = ui
      m.deps.cwd = m.project
    }
    expect(cells).toEqual([[{ text: "No secret was made.", style: "quiet" }]])
    const drawn = drawnInColour(LINES_FILE, "Line", {
      item: { id: 0, kind: "line", cells: cells[0] },
      columns: 100,
    })
    expect(plainOf(drawn).trimEnd()).toBe("No secret was made.")
    expect(wordRuns(drawn)).toEqual([
      { text: "No secret was made.", bold: false, dim: true },
    ])
  })

  test("mysql: its three secrets (D31), all three stored", async () => {
    const cwd = handFolder()
    const run = await onTerminal(
      cwd,
      ["add", "mysql", "--app", "handmy", "--server", "dev"],
      async (t) => {
        await shows(t, question("handmy", "three"))
        t.keys("y")
      }
    )
    expect(run.lines.slice(-2)).toEqual([
      `${question("handmy", "three")} yes`,
      "✔ Stored MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD and DATABASE_URL, sealed for dev",
    ])
    expect(run.code).toBe(0)
    expect(readFileSync(join(cwd, "compose.yaml"), "utf8")).toBe(COMPOSE)
  })

  test("--yes: the lines and the result, no question", async () => {
    const run = await onTerminal(handFolder(), [
      "add",
      "postgres",
      "--app",
      "handyes",
      "--server",
      "dev",
      "--yes",
    ])
    expect(run.lines).toEqual([...BOARD, stored])
    expect(run.code).toBe(0)
  })

  test("AU10: --for is refused here, status 2, nothing drawn or stored before it", async () => {
    const cwd = handFolder()
    const run = await onTerminal(cwd, [
      "add",
      "postgres",
      "--app",
      "handfor",
      "--server",
      "dev",
      "--for",
      "web",
    ])
    expect(run.lines).toEqual(
      two(
        "--for works with a settings file.",
        "With compose.yaml, add the line to each service that uses it."
      )
    )
    expect(run.code).toBe(2)
    expect(storeText("handfor")).toBeUndefined()
    expect(readFileSync(join(cwd, "compose.yaml"), "utf8")).toBe(COMPOSE)
  })

  test("a zekno.json signed and in use that names compose.yaml, a zekno.app.json lying here too: the lines for compose.yaml, the app and the server from the link; neither file changed", async () => {
    const cwd = handFolder()
    writeFileSync(join(cwd, "zekno.app.json"), BEFORE_FILE)
    m.deps.cwd = cwd
    try {
      expect(
        await m.zekno(
          "link",
          "--app",
          "handlink",
          "--server",
          "dev",
          "-f",
          "compose.yaml"
        )
      ).toBe(0)
    } finally {
      m.deps.cwd = m.project
    }
    const run = await onTerminal(cwd, ["add", "postgres"], async (t) => {
      await shows(t, question("handlink"))
      t.keys("y")
    })
    expect(run.lines).toEqual([...BOARD, `${question("handlink")} yes`, stored])
    expect(run.code).toBe(0)
    expect(readFileSync(join(cwd, "compose.yaml"), "utf8")).toBe(COMPOSE)
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(BEFORE_FILE)
  })
})
