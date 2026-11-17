/**
 * What `zekno add --list` and `zekno add <template> --show` draw at a terminal
 * and print with no terminal (specs/012-templates, contracts/commands.md,
 * "`zekno add --list`" and "`zekno add <template> --show`"; board `AddLook`;
 * plan.md, D18, D24, D25, D30; tasks T032): every line, its columns, its
 * colours and weights, and the plain interface's lines.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { catalogue } from "../../../src/templates/catalogue"
import { templateRows, templateView } from "../../../src/templates/shown"
import type { TemplateView } from "../../../src/templates/types"
import { plainUi } from "../../../src/ui/plain/plain"
import { BRAND } from "../../../src/ui/terminal/theme"
import { drawnInColour, plainOf, wordRuns } from "../../support/colour"
import { FIRST_TEMPLATES } from "../../support/template-files"
import {
  LIST,
  LIST_PIPED,
  POSTGRES_IMAGE,
  SHOW,
  SHOW_PIPED,
} from "../../support/template-lines"
import { terminal, until } from "../../support/terminal"

const TEMPLATES = join(import.meta.dir, "../../../src/ui/ink/templates.tsx")

const view = (name: string): TemplateView =>
  templateView(FIRST_TEMPLATES[name]!)

/** What a stand-in terminal `columns` wide shows once `draw` drew on it. */
async function shown(
  draw: (ui: ReturnType<typeof terminal>["ui"]) => void,
  columns = 100
): Promise<string[]> {
  const t = terminal(columns, 40)
  draw(t.ui)
  await until(() => t.lines().length > 0, "the lines")
  await Bun.sleep(30)
  await t.ui.close()
  return t.lines()
}

/** The plain interface's standard output and error once `draw` printed on it. */
function printed(draw: (ui: ReturnType<typeof plainUi>) => void) {
  const out: string[] = []
  const err: string[] = []
  draw(
    plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    )
  )
  return { out, err }
}

describe("--list (board `AddLook`, left column)", () => {
  test("at a terminal: the four lines from column 2, each column padded to its longest plus two, the about without its full stop", async () => {
    const lines = await shown((ui) =>
      ui.templateList(templateRows(catalogue()))
    )
    expect(lines).toEqual(LIST)
    expect(
      await shown((ui) => ui.templateList(templateRows(catalogue())), 80)
    ).toEqual(LIST)
  })

  test("its looks: the name bold, the title and version in the text colour, the about and by zekno dim", () => {
    const lines = drawnInColour(TEMPLATES, "TemplateListBlock", {
      rows: templateRows(catalogue()),
      columns: 100,
    }).split("\n")
    expect(lines.map(plainOf).map((line) => line.trimEnd())).toEqual(LIST)
    expect(wordRuns(lines[0]!)).toEqual([
      { text: "postgres", bold: true, dim: false },
      { text: "PostgreSQL 18.7", bold: false, dim: false },
      { text: "A relational database", bold: false, dim: true },
      { text: "by zekno", bold: false, dim: true },
    ])
    expect(wordRuns(lines[3]!)).toEqual([
      { text: "redis", bold: true, dim: false },
      { text: "Redis 8.10", bold: false, dim: false },
      { text: "A cache and key-value store", bold: false, dim: true },
      { text: "by zekno", bold: false, dim: true },
    ])
  })

  test("the plain interface: one line each, with tabs, on standard output", () => {
    expect(printed((ui) => ui.templateList(templateRows(catalogue())))).toEqual(
      { out: LIST_PIPED, err: [] }
    )
  })
})

describe("--show (board `AddLook`, middle column)", () => {
  test("postgres at a terminal: every line of the contract, the digest whole (D25), the plain variables on one row, no empty line (D30)", async () => {
    expect(await shown((ui) => ui.templateView(view("postgres")), 140)).toEqual(
      SHOW
    )
  })

  test("at 100 and at 80 columns: the image goes on under its value column, every line fits", async () => {
    for (const columns of [100, 80]) {
      const lines = await shown(
        (ui) => ui.templateView(view("postgres")),
        columns
      )
      for (const line of lines)
        expect([...line].length).toBeLessThanOrEqual(columns)
      const at = lines.findIndex((line) => line.startsWith("  Source"))
      const room = columns - 31
      expect(lines[at]).toBe(
        `  Source        image          ${POSTGRES_IMAGE.slice(0, room)}`
      )
      expect(lines[at + 1]).toBe(
        `${" ".repeat(31)}${POSTGRES_IMAGE.slice(room, room * 2)}`
      )
      expect(lines.slice(-1)).toEqual(["  Nothing was changed."])
      expect(lines).toContain("  Deploy        restart        always")
    }
  })

  test("mysql: two made rows, built from it; redis: a start row in Deploy, before restart; mongodb: its second note in Good to know (D24)", async () => {
    const mysql = await shown((ui) => ui.templateView(view("mysql")), 140)
    const secrets = mysql.indexOf("  Secrets")
    expect(mysql.slice(secrets, secrets + 4)).toEqual([
      "  Secrets",
      "  MYSQL_ROOT_PASSWORD     made on your machine, 32 random characters",
      "  MYSQL_PASSWORD          made on your machine, 32 random characters",
      "  DATABASE_URL            built from it, for your own services",
    ])
    // The label column is max(10, longest + 2): mysql-data's 10 and two.
    expect(mysql).toContain(
      "  Variables     secrets     MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD"
    )
    expect(mysql).toContain(
      "                plain       MYSQL_USER=app, MYSQL_DATABASE=app"
    )

    const redis = await shown((ui) => ui.templateView(view("redis")), 140)
    const start = redis.findIndex((line) => line.startsWith("  Deploy"))
    expect(redis[start]).toStartWith(
      '  Deploy        start       sh -c \'umask 077 && printf "requirepass %s\\n"'
    )
    expect(redis.slice(start + 1).find((line) => /restart/.test(line))).toBe(
      "                restart     always"
    )
    expect(redis).toContain("  Volumes       redis-data  /data")
    expect(redis.join("\n")).not.toContain("plain")

    const mongodb = await shown((ui) => ui.templateView(view("mongodb")), 140)
    const good = mongodb.indexOf("  Good to know")
    expect(mongodb.slice(good)).toEqual([
      "  Good to know",
      "  Zekno does not back up this data. It is kept in a Docker volume on your server.",
      "  The image is the official one, pinned by digest. A newer one comes with a newer zekno.",
      "  Your app connects as the database's administrator.",
      "  Nothing was changed.",
    ])
    expect(mongodb[0]).toBe("  MongoDB 9.0  A document database. By zekno.")
  })

  test("its looks: title bold and the rest dim; the service bold in the brand colour; sections bold, labels dim, values in the text colour; headings bold; names in the text colour and their words dim; Good to know's lines and Nothing was changed. dim", () => {
    const lines = drawnInColour(
      TEMPLATES,
      "TemplateViewBlock",
      { view: view("postgres"), columns: 140 },
      140
    ).split("\n")
    expect(lines.map(plainOf).map((line) => line.trimEnd())).toEqual(SHOW)
    const line = (start: string) =>
      lines.find((each) => plainOf(each).startsWith(start))!
    expect(wordRuns(line("  PostgreSQL"))).toEqual([
      { text: "PostgreSQL 18.7", bold: true, dim: false },
      { text: "A relational database. By zekno.", bold: false, dim: true },
    ])
    expect(wordRuns(line("  postgres"))).toEqual([
      { text: "postgres", bold: true, dim: false, color: BRAND },
    ])
    expect(wordRuns(line("  Source"))).toEqual([
      { text: "Source", bold: true, dim: false },
      { text: "image", bold: false, dim: true },
      { text: POSTGRES_IMAGE, bold: false, dim: false },
    ])
    expect(wordRuns(line("                plain"))).toEqual([
      { text: "plain", bold: false, dim: true },
      { text: "POSTGRES_USER=app, POSTGRES_DB=app", bold: false, dim: false },
    ])
    for (const heading of ["  Secrets", "  Good to know"])
      expect(wordRuns(line(heading))).toEqual([
        { text: heading.trim(), bold: true, dim: false },
      ])
    expect(wordRuns(line("  POSTGRES_PASSWORD"))).toEqual([
      { text: "POSTGRES_PASSWORD", bold: false, dim: false },
      {
        text: "made on your machine, 32 random characters",
        bold: false,
        dim: true,
      },
    ])
    expect(wordRuns(line("  DATABASE_URL"))).toEqual([
      { text: "DATABASE_URL", bold: false, dim: false },
      { text: "built from it, for your own services", bold: false, dim: true },
    ])
    for (const start of ["  Zekno does not", "  The image", "  Nothing was"])
      expect(wordRuns(line(start)).every((run) => run.dim && !run.bold)).toBe(
        true
      )
  })

  test("the plain interface: the piped lines of the contract exactly, on standard output", () => {
    expect(printed((ui) => ui.templateView(view("postgres")))).toEqual({
      out: SHOW_PIPED,
      err: [],
    })
    const redis = printed((ui) => ui.templateView(view("redis"))).out
    expect(redis).toContain(
      `redis\tdeploy.start\t${FIRST_TEMPLATES.redis!.services[0]![1].start}`
    )
    expect(redis.slice(-2)).toEqual([
      "made\tREDIS_PASSWORD\t32",
      "built\tREDIS_URL\tredis://default:{REDIS_PASSWORD}@{service}:6379",
    ])
  })
})
