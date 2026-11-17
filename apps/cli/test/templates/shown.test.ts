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
import { additionReport } from "../../src/templates/shown"
import type { Addition, Template } from "../../src/templates/types"
import { BEFORE_SETTINGS } from "../support/add-files"
import { FIRST_TEMPLATES } from "../support/template-files"

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
