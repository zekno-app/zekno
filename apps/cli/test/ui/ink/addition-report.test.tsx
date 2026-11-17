/**
 * What `zekno add` draws before it asks and after it added (specs/012-templates,
 * contracts/commands.md, "a settings file, at a terminal" and "After a yes";
 * board `AddTemplate`, left column; plan.md, D24, D26, D30, D31, D32; tasks
 * T022): every line, its columns, colours and weights, at 100 and at 80
 * columns and in a narrower window; and the plain interface's lines. Then
 * the lines for a Compose file written by hand (contracts/commands.md, "A
 * hand-written Compose file"; board `AddOther`, left column; tasks T045).
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { planAddition } from "../../../src/templates/addition"
import { handLines } from "../../../src/templates/hand"
import { additionReport } from "../../../src/templates/shown"
import type {
  AdditionReport,
  HandLines,
  Template,
} from "../../../src/templates/types"
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

describe("hand-written lines (board `AddOther`, left column)", () => {
  const LINES = handLines(FIRST_TEMPLATES.postgres!, undefined, "compose.yaml")

  /** A box as the lines are drawn in: a faint border, `width` columns, each line from its second column. */
  const box = (lines: readonly string[], width: number) => [
    `╭${"─".repeat(width - 2)}╮`,
    ...lines.map((line) => `│ ${line.padEnd(width - 4)} │`),
    `╰${"─".repeat(width - 2)}╯`,
  ]

  /** What a stand-in terminal `columns` wide shows for the lines, every line. */
  async function drawn(lines: HandLines, columns = 100) {
    const t = terminal(columns, 40)
    t.ui.handLines(lines)
    await until(() => t.lines().length > 0, "the lines")
    await Bun.sleep(30)
    await t.ui.close()
    return t.lines()
  }

  test("at 100 columns: AH1 to AH5, the service's lines in a box, the connection secret's in a second; each box two columns wider than its longest line, or as wide as the window", async () => {
    // The image line, 96 columns, fills the box the window allows; the connection secret's box is 40 wide, as the contract draws it.
    expect(await drawn(LINES)).toEqual([
      "This folder deploys from compose.yaml, a file written by hand.",
      "Zekno does not edit it. Add these lines yourself.",
      "Under services:",
      ...box(LINES.service, 100),
      "Under volumes:  postgres-data:",
      "In the environment: of each service that uses it",
      ...box(LINES.offers, 40),
    ])
    expect(LINES.offers[0]!.length + 5).toBe(40)
  })

  test("at 80 columns: every line fits; the image line goes on under itself, inside the box, its digest whole", async () => {
    const lines = await drawn(LINES, 80)
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80)
    const top = lines.indexOf(`╭${"─".repeat(78)}╮`)
    expect(top).toBe(3)
    // The box is 80 wide and 76 inside: the image line fills its first row and goes on under it.
    const image = LINES.service[1]!.slice("    image: ".length)
    expect(lines.slice(top + 2, top + 4)).toEqual([
      `│     image: ${image.slice(0, 65)} │`,
      `│ ${image.slice(65).padEnd(76)} │`,
    ])
    expect(image.slice(65)).toHaveLength(20)
    expect(lines.slice(-3)).toEqual(box(LINES.offers, 40))
  })

  test("several volumes on one line, two spaces apart; no volume and no connection secret: neither line, no second box", async () => {
    const several = await drawn({
      ...LINES,
      volumes: ["postgres-data", "postgres-logs"],
    })
    expect(several).toContain("Under volumes:  postgres-data:  postgres-logs:")
    const bare = await drawn({ ...LINES, volumes: [], offers: [] })
    expect(bare.slice(-1)).toEqual([`╰${"─".repeat(98)}╯`])
    expect(bare.join("\n")).not.toContain("Under volumes")
    expect(bare.join("\n")).not.toContain("In the environment")
  })

  describe("its looks", () => {
    const lines = drawnInColour(REPORT_FILE, "HandBlock", {
      lines: LINES,
      columns: 100,
    }).split("\n")
    const line = (start: string) =>
      lines.find((each) => plainOf(each).startsWith(start))!

    test("AH1 with the file bold; AH2 dim; AH3 dim with services: in the text colour", () => {
      expect(wordRuns(line("This folder"))).toEqual([
        { text: "This folder deploys from", bold: false, dim: false },
        { text: "compose.yaml", bold: true, dim: false },
        { text: ", a file written by hand.", bold: false, dim: false },
      ])
      expect(wordRuns(line("Zekno does not edit it."))).toEqual([
        {
          text: "Zekno does not edit it. Add these lines yourself.",
          bold: false,
          dim: true,
        },
      ])
      expect(wordRuns(line("Under services:"))).toEqual([
        { text: "Under", bold: false, dim: true },
        { text: "services:", bold: false, dim: false },
      ])
    })

    test("the boxes: a faint border, the lines in the text colour", () => {
      for (const top of lines.filter((each) => plainOf(each).startsWith("╭")))
        expect(wordRuns(top).every((run) => run.dim)).toBe(true)
      expect(wordRuns(line("│   postgres:"))).toEqual([
        { text: "│", bold: false, dim: true },
        { text: "postgres:", bold: false, dim: false },
        { text: "│", bold: false, dim: true },
      ])
      expect(wordRuns(line("│       DATABASE_URL"))).toEqual([
        { text: "│", bold: false, dim: true },
        { text: "DATABASE_URL: ${DATABASE_URL}", bold: false, dim: false },
        { text: "│", bold: false, dim: true },
      ])
    })

    test("AH4 dim with volumes: and each volume in the text colour; AH5 dim with environment: in the text colour", () => {
      expect(wordRuns(line("Under volumes:"))).toEqual([
        { text: "Under", bold: false, dim: true },
        { text: "volumes:  postgres-data:", bold: false, dim: false },
      ])
      expect(wordRuns(line("In the environment:"))).toEqual([
        { text: "In the", bold: false, dim: true },
        { text: "environment:", bold: false, dim: false },
        { text: "of each service that uses it", bold: false, dim: true },
      ])
    })
  })

  test("the plain interface: the lines bare, the service's then the connection secret's, on standard output, and nothing else", () => {
    const out: string[] = []
    const err: string[] = []
    plainUi(
      (text) => out.push(text),
      (text) => err.push(text)
    ).handLines(LINES)
    expect(out).toEqual([...LINES.service, ...LINES.offers])
    expect(out).toEqual([
      "  postgres:",
      "    image: postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc",
      "    restart: always",
      "    environment:",
      "      POSTGRES_USER: app",
      "      POSTGRES_DB: app",
      "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}",
      "    volumes:",
      "      - postgres-data:/var/lib/postgresql",
      "      DATABASE_URL: ${DATABASE_URL}",
    ])
    expect(err).toEqual([])
  })
})
