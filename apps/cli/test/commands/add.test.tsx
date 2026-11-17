/**
 * `zekno add` through `run`, at a stand-in terminal (specs/012-templates,
 * contracts/commands.md, "a settings file, at a terminal", "Who reads the
 * connection secret", "After a yes", "A no, Esc or Ctrl-C" and "The order of
 * checks"; board `AddTemplate`; board `AddOther`, the refusals; tasks T028):
 * every line of the board at 100 and at 80 columns, the readers question, a
 * no and `--yes`, with no server, network or Docker touched. The refusals
 * and the usage sentences are add-refusals.test.tsx.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { checkSettings } from "../../src/settings/schema"
import type { Settings } from "../../src/settings/types"
import { BEFORE_FILE, BEFORE_SETTINGS } from "../support/add-files"
import { atTerminal, folder } from "../support/add-terminal"
import { machine, ready } from "../support/helpers"
import { drawnInColour, plainOf, wordRuns } from "../support/colour"
import { KEYS, shows, terminal } from "../support/terminal"

const LINES = join(import.meta.dir, "../../src/ui/ink/lines.tsx")

type Machine = ReturnType<typeof machine>

let m: Machine
let serverId: string
beforeAll(async () => {
  m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
    .servers[0].serverId
}, 60_000)

/** The app's secret store on dev, as bytes, or undefined when there is none. */
const storeBytes = (app: string): string | undefined => {
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

/** The board's summary (contracts/commands.md), postgres added to design.md's app on dev, read by `readBy`. */
function summary(readBy = "web", app = "demo", columns = 100): string[] {
  const box = Math.min(columns, 80)
  const row = (text: string) => `│ ${text.padEnd(box - 4)} │`
  return [
    `${"PostgreSQL 18.7  A relational database.".padEnd(box - 8)}by zekno`,
    `╭${"─".repeat(box - 2)}╮`,
    row(`app     ${app}`),
    row("server  dev this machine"),
    row("file    zekno.app.json  2 services: web, worker"),
    `╰${"─".repeat(box - 2)}╯`,
    "Adds a service",
    "  postgres                postgres:18.7  pinned by digest",
    "                          restart always · port 5432, not published",
    "                          data kept in volume postgres-data",
    "Makes a secret on this machine  never shown",
    "  POSTGRES_PASSWORD       32 random characters",
    "                          read by postgres",
    "Builds a secret from it",
    "  DATABASE_URL            postgres://app:••••@postgres:5432/app",
    `                          read by ${readBy}`,
    "! Zekno does not back up this data.",
  ]
}

const question = (app = "demo") =>
  `? Add postgres to ${app}? Nothing is deployed until you deploy. (y/N)`

const added = [
  "✔ Added postgres to zekno.app.json",
  "✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for dev",
  "  Run zekno deploy to start it.",
]

/** The settings file of a folder, read back. */
const settingsIn = (cwd: string) =>
  checkSettings(
    readFileSync(join(cwd, "zekno.app.json"), "utf8"),
    "zekno.app.json"
  ) as Settings

describe("adding to a settings file (board `AddTemplate`)", () => {
  test("at 100 columns: the board's left column line by line, AD3 answered y, the three result lines, status 0; the file and the store written; nothing contacted, nothing deployed", async () => {
    const cwd = folder()
    const run = await onTerminal(
      cwd,
      ["add", "postgres", "--app", "demo", "--server", "dev", "--for", "web"],
      async (t) => {
        await shows(t, question())
        t.keys("y")
      }
    )
    expect(run.lines).toEqual([...summary(), `${question()} yes`, ...added])
    expect(run.code).toBe(0)
    expect(run.contacted).toBe(0)
    expect(run.docker).toBe(0)
    const settings = settingsIn(cwd)
    expect(settings).toEqual({
      version: 1,
      services: [
        [
          "web",
          {
            ...BEFORE_SETTINGS.services[0]![1],
            secrets: ["SESSION_KEY", "DATABASE_URL"],
          },
        ],
        BEFORE_SETTINGS.services[1]!,
        [
          "postgres",
          expect.objectContaining({
            volumes: [["postgres-data", "/var/lib/postgresql"]],
          }),
        ],
      ],
    })
    const store = JSON.parse(storeBytes("demo")!)
    expect(store.records.length).toBe(2)
  })

  test("at 80 columns: the same lines, each fitting", async () => {
    const run = await onTerminal(
      folder(),
      ["add", "postgres", "--app", "demo80", "--server", "dev", "--for", "web"],
      async (t) => {
        await shows(t, question("demo80"))
        t.keys("y")
      },
      { columns: 80 }
    )
    expect(run.lines).toEqual([
      ...summary("web", "demo80", 80),
      `${question("demo80")} yes`,
      ...added,
    ])
    for (const line of run.lines)
      expect([...line].length).toBeLessThanOrEqual(80)
    expect(run.code).toBe(0)
  })

  test("two other services: AD10 before the summary, its answer the summary's read by", async () => {
    const cwd = folder()
    const run = await onTerminal(
      cwd,
      ["add", "postgres", "--app", "readers", "--server", "dev"],
      async (t) => {
        await shows(t, "? Which services read DATABASE_URL?")
        await shows(t, "  ❯ ◉ web")
        t.keys(KEYS.down)
        t.keys(" ")
        await shows(t, "  ❯ ◉ worker")
        t.keys(KEYS.enter)
        await shows(t, question("readers"))
        t.keys("y")
      }
    )
    expect(run.lines).toEqual([
      "✔ Read by  web, worker",
      ...summary("web, worker", "readers"),
      `${question("readers")} yes`,
      ...added,
    ])
    expect(run.code).toBe(0)
    expect(
      settingsIn(cwd)
        .services.slice(0, 2)
        .map(([, service]) => service.secrets)
    ).toEqual([["SESSION_KEY", "DATABASE_URL"], ["DATABASE_URL"]])
  })

  test("--for worker asks nothing and reads read by worker", async () => {
    const run = await onTerminal(
      folder(),
      [
        "add",
        "postgres",
        "--app",
        "forw",
        "--server",
        "dev",
        "--for",
        "worker",
      ],
      async (t) => {
        await shows(t, question("forw"))
        t.keys("y")
      }
    )
    expect(run.lines.slice(0, 17)).toEqual(summary("worker", "forw"))
    expect(run.code).toBe(0)
  })

  test("n, Enter, Esc and Ctrl-C at AD3: Nothing was added., dim from column 0, status 1, nothing written", async () => {
    for (const [index, key] of [
      "n",
      KEYS.enter,
      KEYS.esc,
      KEYS.ctrlC,
    ].entries()) {
      const cwd = folder()
      const app = `no${index}`
      const run = await onTerminal(
        cwd,
        ["add", "postgres", "--app", app, "--server", "dev", "--for", "web"],
        async (t) => {
          await shows(t, question(app))
          t.keys(key)
        }
      )
      expect(run.lines.slice(-2)).toEqual([
        `${question(app)} no`,
        "Nothing was added.",
      ])
      expect(run.code).toBe(1)
      expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(
        BEFORE_FILE
      )
      expect(storeBytes(app)).toBeUndefined()
    }
  })

  test("Esc at AD10: the question's line, Nothing was added., status 1, nothing written", async () => {
    const cwd = folder()
    const run = await onTerminal(
      cwd,
      ["add", "postgres", "--app", "noread", "--server", "dev"],
      async (t) => {
        await shows(t, "  ❯ ◉ web")
        t.keys(KEYS.esc)
      }
    )
    expect(run.lines).toEqual([
      "? Which services read DATABASE_URL?",
      "Nothing was added.",
    ])
    expect(run.code).toBe(1)
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(BEFORE_FILE)
    expect(storeBytes("noread")).toBeUndefined()
  })

  test("--yes: the summary and no question", async () => {
    const run = await onTerminal(folder(), [
      "add",
      "postgres",
      "--app",
      "yes",
      "--server",
      "dev",
      "--for",
      "web",
      "--yes",
    ])
    expect(run.lines).toEqual([...summary("web", "yes"), ...added])
    expect(run.code).toBe(0)
  })

  test("Nothing was added. is one quiet cell, which a terminal draws dim from column 0", async () => {
    const cwd = folder()
    const t = terminal(100, 40)
    const cells: unknown[] = []
    const line = t.ui.line
    t.ui.line = (plain, drawn) => {
      cells.push(drawn)
      line(plain, drawn)
    }
    const ui = m.deps.ui
    m.deps.ui = t.ui
    m.deps.cwd = cwd
    try {
      const running = m.zekno(
        "add",
        "postgres",
        "--app",
        "dim",
        "--server",
        "dev",
        "--for",
        "web"
      )
      await shows(t, question("dim"))
      t.keys("n")
      expect(await running).toBe(1)
      await t.ui.close()
    } finally {
      m.deps.ui = ui
      m.deps.cwd = m.project
    }
    expect(cells).toEqual([[{ text: "Nothing was added.", style: "quiet" }]])
    const drawn = drawnInColour(LINES, "Line", {
      item: { id: 0, kind: "line", cells: cells[0] },
      columns: 100,
    })
    expect(plainOf(drawn).trimEnd()).toBe("Nothing was added.")
    expect(wordRuns(drawn)).toEqual([
      { text: "Nothing was added.", bold: false, dim: true },
    ])
  })
})
