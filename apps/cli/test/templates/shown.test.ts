/**
 * What `zekno add` shows before it asks (specs/012-templates, data-model.md,
 * "What is shown"; contracts/commands.md, "a settings file, at a terminal";
 * board `AddTemplate`; plan.md, D24, D26, D30, D31, D32; tasks T022): the
 * summary of an addition, made of names that passed their rule and fixed
 * words, never a made value.
 */
import { describe, expect, test } from "bun:test"

import { DESIGN_SETTINGS } from "../support/settings-files"
import { planAddition } from "../../src/templates/addition"
import { catalogue } from "../../src/templates/catalogue"
import {
  additionReport,
  listObject,
  templateObject,
  templateRows,
  templateView,
} from "../../src/templates/shown"
import type { Addition, Template } from "../../src/templates/types"
import { BEFORE_SETTINGS } from "../support/add-files"
import { FIRST_SET, FIRST_TEMPLATES } from "../support/template-files"

const FILE = "zekno.app.json"
const PROD = { name: "prod", where: "deploy@203.0.113.7" }

/** The addition of `template` to `BEFORE_SETTINGS`, read by `readers`. */
function addition(
  template: Template,
  readers: readonly string[] = ["web"],
  name?: string
): Addition {
  const plan = planAddition({
    template,
    settings: BEFORE_SETTINGS,
    file: FILE,
    readers,
    ...(name === undefined ? {} : { name }),
  })
  if (!("settings" in plan)) throw new Error(JSON.stringify(plan))
  return plan
}

const report = (template: Template, readers?: readonly string[]) =>
  additionReport({
    addition: addition(template, readers),
    app: "demo",
    server: PROD,
    file: FILE,
    services: BEFORE_SETTINGS.services.map(([name]) => name),
  })

describe("the summary of an addition (data-model.md, AdditionReport)", () => {
  test("postgres added to design.md's app, read by web: the board's every value", () => {
    expect(report(FIRST_TEMPLATES.postgres!)).toEqual({
      title: "PostgreSQL",
      software: "18.7",
      about: "A relational database.",
      author: "zekno",
      app: "demo",
      server: { name: "prod", where: "deploy@203.0.113.7" },
      file: { shown: "zekno.app.json", detail: "2 services: web, worker" },
      services: [
        {
          name: "postgres",
          image: "postgres:18.7",
          rule: "restart always",
          port: "port 5432, not published",
          volumes: ["postgres-data"],
        },
      ],
      made: [{ name: "POSTGRES_PASSWORD", length: 32, readBy: ["postgres"] }],
      offers: [
        {
          name: "DATABASE_URL",
          pieces: [
            { text: "postgres://app:", hidden: false },
            { text: "••••", hidden: true },
            { text: "@postgres:5432/app", hidden: false },
          ],
          usesSeveral: false,
          readBy: ["web"],
        },
      ],
      notes: ["Zekno does not back up this data."],
    })
  })

  test("with --name db: the service, its volume and the offer's host are db; read by worker and web, in the file's order", () => {
    const shown = additionReport({
      addition: addition(FIRST_TEMPLATES.postgres!, ["worker", "web"], "db"),
      app: "demo",
      server: { name: "dev", where: "this machine" },
      file: FILE,
      services: ["web", "worker"],
    })
    expect(shown.services[0]!.name).toBe("db")
    expect(shown.services[0]!.volumes).toEqual(["db-data"])
    expect(shown.made[0]!.readBy).toEqual(["db"])
    expect(shown.offers[0]!.pieces.map((piece) => piece.text).join("")).toBe(
      "postgres://app:••••@db:5432/app"
    )
    expect(shown.offers[0]!.readBy).toEqual(["web", "worker"])
    expect(shown.server).toEqual({ name: "dev", where: "this machine" })
  })

  test("mysql: two made secrets, the connection secret built from one; mongodb: two notes; redis: no start command anywhere (D26)", () => {
    const mysql = report(FIRST_TEMPLATES.mysql!)
    expect(mysql.made.map((made) => made.name)).toEqual([
      "MYSQL_ROOT_PASSWORD",
      "MYSQL_PASSWORD",
    ])
    expect(mysql.offers[0]!.usesSeveral).toBe(false)
    expect(report(FIRST_TEMPLATES.mongodb!).notes).toEqual([
      "Zekno does not back up this data.",
      "Your app connects as the database's administrator.",
    ])
    const redis = report(FIRST_TEMPLATES.redis!)
    expect(JSON.stringify(redis)).not.toContain("requirepass")
    expect(JSON.stringify(redis)).not.toContain("sh -c")
    expect(redis.services[0]).toEqual({
      name: "redis",
      image: "redis:8.10.3",
      rule: "restart always",
      port: "port 6379, not published",
      volumes: ["redis-data"],
    })
  })

  test("a service with no restart rule, no port and no volume has none of those rows; a connection secret of two made secrets is built from them", () => {
    const base = FIRST_TEMPLATES.postgres!
    const [own, service] = base.services[0]!
    const bare: Template = {
      ...base,
      services: [
        [
          own,
          { image: service.image, secrets: ["POSTGRES_PASSWORD", "OTHER"] },
        ],
      ],
      makes: [...base.makes, { name: "OTHER", kind: "password", length: 24 }],
      offers: [
        {
          name: "DATABASE_URL",
          text: "postgres://{OTHER}:{POSTGRES_PASSWORD}@{service}",
        },
      ],
      notes: ["Something to know."],
    }
    const shown = report(bare)
    expect(shown.services).toEqual([
      { name: "postgres", image: "postgres:18.7", volumes: [] },
    ])
    expect(shown.offers[0]!.usesSeveral).toBe(true)
    expect(shown.made[1]).toEqual({
      name: "OTHER",
      length: 24,
      readBy: ["postgres"],
    })
  })

  test("the file's services as they are now, one or several (DP3's words)", () => {
    const one = additionReport({
      addition: addition(FIRST_TEMPLATES.redis!),
      app: "demo",
      server: PROD,
      file: "deploy/zekno.app.json",
      services: ["web"],
    })
    expect(one.file).toEqual({
      shown: "deploy/zekno.app.json",
      detail: "1 service: web",
    })
  })

  test("design.md's own settings are never changed by a report", () => {
    const before = JSON.stringify(BEFORE_SETTINGS)
    report(FIRST_TEMPLATES.postgres!)
    expect(JSON.stringify(BEFORE_SETTINGS)).toBe(before)
    expect(DESIGN_SETTINGS.services.length).toBe(2)
  })
})

describe("what --list and --show show (data-model.md, TemplateRow and TemplateView; contracts/commands.md, D18, D24)", () => {
  test("the rows of the list: the catalogue's order, the about without its full stop", () => {
    expect(templateRows(catalogue())).toEqual([
      {
        name: "postgres",
        title: "PostgreSQL",
        software: "18.7",
        about: "A relational database",
        author: "zekno",
      },
      {
        name: "mysql",
        title: "MySQL",
        software: "9.7",
        about: "A relational database",
        author: "zekno",
      },
      {
        name: "mongodb",
        title: "MongoDB",
        software: "9.0",
        about: "A document database",
        author: "zekno",
      },
      {
        name: "redis",
        title: "Redis",
        software: "8.10",
        about: "A cache and key-value store",
        author: "zekno",
      },
    ])
  })

  test("--list --json: one object, each template's fields in the contract's order, the about whole", () => {
    expect(JSON.stringify(listObject(catalogue()))).toBe(
      JSON.stringify({
        templates: [
          ["postgres", "PostgreSQL", "A relational database.", "18.7", []],
          ["mysql", "MySQL", "A relational database.", "9.7", []],
          ["mongodb", "MongoDB", "A document database.", "9.0", ["mongo"]],
          ["redis", "Redis", "A cache and key-value store.", "8.10", []],
        ].map(([name, title, about, software, also]) => ({
          name,
          title,
          about,
          software,
          author: "zekno",
          also,
        })),
      })
    )
  })

  test("the view of postgres: the service as added by default, the plain variables on one row, Secrets, Good to know (AV3, AV4, no backup note twice), the piped lines", () => {
    const view = templateView(FIRST_TEMPLATES.postgres!)
    expect(view.title).toBe("PostgreSQL")
    expect(view.about).toBe("A relational database.")
    expect(view.services.map((service) => service.name)).toEqual(["postgres"])
    expect(
      view.services[0]!.rows.map((row) => [row.section, row.label, row.shown])
    ).toEqual([
      ["Source", "image", FIRST_TEMPLATES.postgres!.services[0]![1].image],
      ["Deploy", "restart", "always"],
      ["Networking", "port", "5432, not published"],
      ["Variables", "secrets", "POSTGRES_PASSWORD"],
      ["Variables", "plain", "POSTGRES_USER=app, POSTGRES_DB=app"],
      ["Volumes", "postgres-data", "/var/lib/postgresql"],
    ])
    expect(view.made).toEqual([{ name: "POSTGRES_PASSWORD", length: 32 }])
    expect(view.offers).toEqual([{ name: "DATABASE_URL", usesSeveral: false }])
    expect(view.good).toEqual([
      "Zekno does not back up this data. It is kept in a Docker volume on your server.",
      "The image is the official one, pinned by digest. A newer one comes with a newer zekno.",
    ])
    expect(view.piped.slice(-2)).toEqual([
      ["made", "POSTGRES_PASSWORD", "32"],
      [
        "built",
        "DATABASE_URL",
        "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app",
      ],
    ])
  })

  test("a template with no volume: no AV3, and its backup note, if it has one, kept among the notes", () => {
    const base = FIRST_TEMPLATES.redis!
    const [own, service] = base.services[0]!
    const { volumes: _volumes, ...noVolume } = service
    const view = templateView({
      ...base,
      services: [[own, noVolume]],
      notes: ["Zekno does not back up this data.", "Something to know."],
    })
    expect(view.good).toEqual([
      "The image is the official one, pinned by digest. A newer one comes with a newer zekno.",
      "Zekno does not back up this data.",
      "Something to know.",
    ])
    expect(
      view.services[0]!.rows.some((row) => row.section === "Volumes")
    ).toBe(false)
  })

  test("--show --json: the template's data as read, its keys in the format's order, each service's keys as zekno settings --json writes them", () => {
    const object = templateObject(FIRST_TEMPLATES.postgres!)
    expect(Object.keys(object)).toEqual([
      "template",
      "name",
      "title",
      "about",
      "software",
      "author",
      "also",
      "services",
      "makes",
      "offers",
      "notes",
    ])
    expect(JSON.stringify(object)).toBe(
      JSON.stringify(JSON.parse(FIRST_SET.postgres!))
    )
    const redis = templateObject(FIRST_TEMPLATES.redis!)
    expect(JSON.stringify(redis)).toBe(
      JSON.stringify(JSON.parse(FIRST_SET.redis!))
    )
  })
})
