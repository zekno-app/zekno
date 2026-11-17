/**
 * What `zekno add` draws before it asks and after it added (specs/012-templates,
 * contracts/commands.md, "a settings file, at a terminal" and "After a yes";
 * board `AddTemplate`, left column; plan.md, D24, D26, D30, D31, D32; tasks
 * T022): every line, its columns, colours and weights, at 100 and at 80
 * columns and in a narrower window; and the plain interface's lines.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { planAddition } from "../../../src/templates/addition"
import { additionReport } from "../../../src/templates/shown"
import type { AdditionReport, Template } from "../../../src/templates/types"
import { BRAND } from "../../../src/ui/terminal/theme"
import { plainUi } from "../../../src/ui/plain/plain"
import { BEFORE_SETTINGS } from "../../support/add-files"
import { drawnInColour, plainOf, wordRuns } from "../../support/colour"
import { FIRST_TEMPLATES } from "../../support/template-files"
import { terminal, until } from "../../support/terminal"

const REPORT_FILE = join(
  import.meta.dir,
  "../../../src/ui/ink/addition-report.tsx"
)

/** The summary of `template` added to design.md's app on prod, read by web. */
function reportOf(template: Template): AdditionReport {
  const addition = planAddition({
    template,
    settings: BEFORE_SETTINGS,
    file: "zekno.app.json",
    readers: ["web"],
  })
  if (!("settings" in addition)) throw new Error(JSON.stringify(addition))
  return additionReport({
    addition,
    app: "demo",
    server: { name: "prod", where: "deploy@203.0.113.7" },
    file: "zekno.app.json",
    services: ["web", "worker"],
  })
}

const POSTGRES = reportOf(FIRST_TEMPLATES.postgres!)

/** The box's width: 80 columns, or the window's when it is narrower. */
const BOX = 80
const row = (text: string, width = BOX) => `│ ${text.padEnd(width - 4)} │`

/** The lines of contracts/commands.md, "a settings file, at a terminal", up to the question, with D1 and D2's words. */
const BOARD = [
  `${"PostgreSQL 18.7  A relational database.".padEnd(BOX - "by zekno".length)}by zekno`,
  `╭${"─".repeat(BOX - 2)}╮`,
  row("app     demo"),
  row("server  prod deploy@203.0.113.7"),
  row("file    zekno.app.json  2 services: web, worker"),
  `╰${"─".repeat(BOX - 2)}╯`,
  "Adds a service",
  "  postgres                postgres:18.7  pinned by digest",
  "                          restart always · port 5432, not published",
  "                          data kept in volume postgres-data",
  "Makes a secret on this machine  never shown",
  "  POSTGRES_PASSWORD       32 random characters",
  "                          read by postgres",
  "Builds a secret from it",
  "  DATABASE_URL            postgres://app:••••@postgres:5432/app",
  "                          read by web",
  "! Zekno does not back up this data.",
]

/** What a stand-in terminal `columns` wide shows for the summary, every line. */
async function shown(report: AdditionReport, columns = 100) {
  const t = terminal(columns, 40)
  t.ui.addition(report)
  await until(() => t.lines().length > 0, "the summary")
  await Bun.sleep(30)
  await t.ui.close()
  return t.lines()
}

describe("the summary (board `AddTemplate`, left column)", () => {
  test("at 100 columns: every line of the contract up to the question, no empty line between blocks (D30)", async () => {
    expect(await shown(POSTGRES)).toEqual(BOARD)
  })

  test("at 80 columns: the same lines, each fitting", async () => {
    const lines = await shown(POSTGRES, 80)
    expect(lines).toEqual(BOARD)
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80)
  })

  test("in a window of 50: the box as wide as the window, by zekno at its edge, values going on under their column; at 45, by zekno two spaces after the about", async () => {
    const lines = await shown(POSTGRES, 50)
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(50)
    expect(lines[0]).toBe(
      `${"PostgreSQL 18.7  A relational database.".padEnd(42)}by zekno`
    )
    expect((await shown(POSTGRES, 45)).slice(0, 2)).toEqual([
      "PostgreSQL 18.7  A relational database.",
      "by zekno",
    ])
    expect(lines[1]).toBe(`╭${"─".repeat(48)}╮`)
    const start = lines.indexOf("Builds a secret from it")
    expect(lines.slice(start + 1, start + 4)).toEqual([
      "  DATABASE_URL            postgres://app:••••@post",
      "                          gres:5432/app",
      "                          read by web",
    ])
  })

  test("mysql: two made secrets, and the connection secret built from one; mongodb: both notes; redis: no start command (D26)", async () => {
    const mysql = await shown(reportOf(FIRST_TEMPLATES.mysql!))
    expect(mysql).toContain("Makes 2 secrets on this machine  never shown")
    expect(mysql).toContain("  MYSQL_ROOT_PASSWORD     32 random characters")
    expect(mysql).toContain("  MYSQL_PASSWORD          32 random characters")
    expect(mysql).toContain("Builds a secret from it")
    const mongodb = await shown(reportOf(FIRST_TEMPLATES.mongodb!))
    expect(mongodb.slice(-2)).toEqual([
      "! Zekno does not back up this data.",
      "! Your app connects as the database's administrator.",
    ])
    expect(mongodb[0]).toStartWith("MongoDB 9.0  A document database.")
    const redis = await shown(reportOf(FIRST_TEMPLATES.redis!))
    expect(redis.join("\n")).not.toContain("requirepass")
    expect(redis.join("\n")).not.toContain("umask")
    expect(redis.join("\n")).not.toContain("docker-entrypoint")
    expect(redis).toContain(
      "  REDIS_URL               redis://default:••••@redis:6379"
    )
  })

  test("several services, volumes and made secrets: the counts as digits (D31), volumes listed, from them", async () => {
    const report: AdditionReport = {
      ...POSTGRES,
      services: [
        {
          ...POSTGRES.services[0]!,
          volumes: ["postgres-data", "postgres-logs"],
        },
        { name: "pooler", image: "pgbouncer:1", volumes: [] },
      ],
      offers: [{ ...POSTGRES.offers[0]!, usesSeveral: true }],
    }
    const lines = await shown(report)
    expect(lines).toContain("Adds 2 services")
    expect(lines).toContain(
      "                          volumes postgres-data, postgres-logs"
    )
    expect(lines).toContain(
      "  pooler                  pgbouncer:1  pinned by digest"
    )
    expect(lines).toContain("Builds a secret from them")
  })

  test("no connection secret: the block is left out", async () => {
    const lines = await shown({ ...POSTGRES, offers: [] })
    expect(lines.join("\n")).not.toContain("Builds")
  })
})

describe("its looks", () => {
  const lines = drawnInColour(REPORT_FILE, "AdditionBlock", {
    report: POSTGRES,
    columns: 100,
  }).split("\n")
  const line = (start: string) =>
    lines.find((each) => plainOf(each).startsWith(start))!

  test("title and software bold, the about and by zekno dim", () => {
    expect(wordRuns(line("PostgreSQL"))).toEqual([
      { text: "PostgreSQL 18.7", bold: true, dim: false },
      { text: "A relational database.", bold: false, dim: true },
      { text: "by zekno", bold: false, dim: true },
    ])
  })

  test("the box: a faint border, labels dim, the app bold, where dim, the file's services dim", () => {
    const top = line("╭")
    expect(wordRuns(top).every((run) => run.dim)).toBe(true)
    expect(wordRuns(line("│ app")).slice(1, 3)).toEqual([
      { text: "app", bold: false, dim: true },
      { text: "demo", bold: true, dim: false },
    ])
    expect(wordRuns(line("│ server")).slice(1, 4)).toEqual([
      { text: "server", bold: false, dim: true },
      { text: "prod", bold: false, dim: false },
      { text: "deploy@203.0.113.7", bold: false, dim: true },
    ])
    expect(wordRuns(line("│ file")).slice(1, 4)).toEqual([
      { text: "file", bold: false, dim: true },
      { text: "zekno.app.json", bold: false, dim: false },
      { text: "2 services: web, worker", bold: false, dim: true },
    ])
  })

  test("headings bold; the service bold in the brand colour; pinned by digest dim; the dot dim; names in the text colour (D32)", () => {
    expect(wordRuns(line("Adds a service"))).toEqual([
      { text: "Adds a service", bold: true, dim: false },
    ])
    expect(wordRuns(line("  postgres"))).toEqual([
      { text: "postgres", bold: true, dim: false, color: BRAND },
      { text: "postgres:18.7", bold: false, dim: false },
      { text: "pinned by digest", bold: false, dim: true },
    ])
    expect(wordRuns(line("                          restart"))).toEqual([
      { text: "restart always", bold: false, dim: false },
      { text: "·", bold: false, dim: true },
      { text: "port 5432, not published", bold: false, dim: false },
    ])
    expect(wordRuns(line("                          data kept"))).toEqual([
      { text: "data kept in volume postgres-data", bold: false, dim: false },
    ])
  })

  test("made: the heading bold and never shown dim; the name and length in the text colour; read by dim", () => {
    expect(wordRuns(line("Makes a secret"))).toEqual([
      { text: "Makes a secret on this machine", bold: true, dim: false },
      { text: "never shown", bold: false, dim: true },
    ])
    // The name and its value are both in the text colour: one run.
    expect(wordRuns(line("  POSTGRES_PASSWORD"))).toEqual([
      {
        text: "POSTGRES_PASSWORD       32 random characters",
        bold: false,
        dim: false,
      },
    ])
    expect(
      wordRuns(line("                          read by postgres"))
    ).toEqual([{ text: "read by postgres", bold: false, dim: true }])
  })

  test("the connection secret: •••• dim, the rest in the text colour; read by dim; the note in the warning colour", () => {
    expect(wordRuns(line("Builds"))).toEqual([
      { text: "Builds a secret from it", bold: true, dim: false },
    ])
    expect(wordRuns(line("  DATABASE_URL"))).toEqual([
      {
        text: "DATABASE_URL            postgres://app:",
        bold: false,
        dim: false,
      },
      { text: "••••", bold: false, dim: true },
      { text: "@postgres:5432/app", bold: false, dim: false },
    ])
    expect(wordRuns(line("                          read by web"))).toEqual([
      { text: "read by web", bold: false, dim: true },
    ])
    expect(wordRuns(line("!"))).toEqual([
      { text: "!", bold: false, dim: false, color: "yellow" },
      {
        text: "Zekno does not back up this data.",
        bold: false,
        dim: false,
        color: "yellow",
      },
    ])
  })
})

describe("after a yes (board `AddTemplate`, right column)", () => {
  const DONE = {
    service: "postgres",
    file: "zekno.app.json",
    stored: [
      { name: "POSTGRES_PASSWORD", version: 1 },
      { name: "DATABASE_URL", version: 1 },
    ],
    server: "prod",
  }

  test("at a terminal: two results and what to run next, dim, from column 2", async () => {
    const t = terminal()
    t.ui.added(DONE)
    await until(() => t.lines().length === 3, "the three lines")
    await t.ui.close()
    expect(t.lines()).toEqual([
      "✔ Added postgres to zekno.app.json",
      "✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for prod",
      "  Run zekno deploy to start it.",
    ])
  })

  test("the plain interface: the summary prints nothing; the result is AD23's lines, with tabs, on standard output", () => {
    const out: string[] = []
    const err: string[] = []
    const ui = plainUi(
      (text) => out.push(text),
      (text) => err.push(text)
    )
    ui.addition(POSTGRES)
    expect(out).toEqual([])
    ui.added(DONE)
    expect(out).toEqual([
      "added\tpostgres\tzekno.app.json",
      "stored\tPOSTGRES_PASSWORD\t1",
      "stored\tDATABASE_URL\t1",
    ])
    expect(err).toEqual([])
  })

  test("no file written (a hand-written Compose file): only the secrets stored", async () => {
    const { file: _file, ...noFile } = DONE
    const t = terminal()
    t.ui.added(noFile)
    await until(() => t.lines().length === 1, "the line")
    await Bun.sleep(30)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for prod",
    ])
    const out: string[] = []
    plainUi(
      (text) => out.push(text),
      () => {}
    ).added(noFile)
    expect(out).toEqual([
      "stored\tPOSTGRES_PASSWORD\t1",
      "stored\tDATABASE_URL\t1",
    ])
  })
})
