/**
 * The lines for a Compose file written by hand (specs/012-templates,
 * contracts/commands.md, "A hand-written Compose file"; research R10; board
 * `AddOther`, left column; plan.md, D1, D2, D17, D25; tasks T043): the
 * service's lines, the volumes, the connection secrets' lines; a value bare
 * only by research R10's rule; Redis's start command as `composeText` writes
 * it, every `$` written `$$`; `--name` renaming the service and its volume
 * (the connection secret's host is in its stored value, which
 * test/ops/add-hand.test.ts opens). Last, when Docker Compose is here, the
 * lines inside a file are read by `docker compose config`, which contacts
 * nothing and starts nothing.
 */
import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { composeText } from "../../src/settings/compose"
import { servicesInApp } from "../../src/templates/addition"
import { handLines } from "../../src/templates/hand"
import type { Template } from "../../src/templates/types"
import { FIRST_TEMPLATES } from "../support/template-files"

const postgres = FIRST_TEMPLATES.postgres!
const redis = FIRST_TEMPLATES.redis!

const POSTGRES_IMAGE =
  "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc"

describe("the lines (board `AddOther`, left column)", () => {
  test("postgres: the board's lines with D1 and D2's words and the whole digest (D25)", () => {
    expect(handLines(postgres, "postgres", "compose.yaml")).toEqual({
      file: "compose.yaml",
      service: [
        "  postgres:",
        `    image: ${POSTGRES_IMAGE}`,
        "    restart: always",
        "    environment:",
        "      POSTGRES_USER: app",
        "      POSTGRES_DB: app",
        "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}",
        "    volumes:",
        "      - postgres-data:/var/lib/postgresql",
      ],
      volumes: ["postgres-data"],
      offers: ["      DATABASE_URL: ${DATABASE_URL}"],
    })
  })

  test("redis: the start command as a flow list of quoted words, every $ written $$, the very line composeText writes", () => {
    const lines = handLines(redis, "redis", "compose.yaml")
    const command =
      '    command: ["sh", "-c", "umask 077 && printf \\"requirepass %s\\\\n\\" \\"$$REDIS_PASSWORD\\" > /tmp/auth.conf && chown redis /tmp/auth.conf && exec docker-entrypoint.sh redis-server /tmp/auth.conf"]'
    expect(lines.service).toEqual([
      "  redis:",
      "    image: redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53",
      command,
      "    restart: always",
      "    environment:",
      "      REDIS_PASSWORD: ${REDIS_PASSWORD}",
      "    volumes:",
      "      - redis-data:/data",
    ])
    expect(lines.offers).toEqual(["      REDIS_URL: ${REDIS_URL}"])
    // What `zekno settings compose` gives for the same service added to a settings file.
    const settings = {
      version: 1 as const,
      services: servicesInApp(redis, undefined),
    }
    expect(composeText(settings).split("\n")).toContain(command)
    // No `$` Compose would read as a variable: each is doubled, or starts a secret's `${NAME}`.
    expect(
      lines.service.join("\n").replace(/\$\$|\$\{[A-Z_]+\}/g, "")
    ).not.toContain("$")
  })

  test("mysql and mongodb: plain values first, then the secrets; one volume each; their connection secret", () => {
    const mysql = handLines(FIRST_TEMPLATES.mysql!, "mysql", "compose.yaml")
    expect(mysql.service.slice(3)).toEqual([
      "    environment:",
      "      MYSQL_USER: app",
      "      MYSQL_DATABASE: app",
      "      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}",
      "      MYSQL_PASSWORD: ${MYSQL_PASSWORD}",
      "    volumes:",
      "      - mysql-data:/var/lib/mysql",
    ])
    expect(mysql.offers).toEqual(["      DATABASE_URL: ${DATABASE_URL}"])
    const mongodb = handLines(
      FIRST_TEMPLATES.mongodb!,
      "mongodb",
      "deploy.yaml"
    )
    expect(mongodb.file).toBe("deploy.yaml")
    expect(mongodb.volumes).toEqual(["mongodb-data"])
    expect(mongodb.offers).toEqual(["      MONGODB_URI: ${MONGODB_URI}"])
  })

  test("--name db: the service and its volume renamed", () => {
    const lines = handLines(postgres, "db", "compose.yaml")
    expect(lines.service[0]).toBe("  db:")
    expect(lines.service.at(-1)).toBe("      - db-data:/var/lib/postgresql")
    expect(lines.volumes).toEqual(["db-data"])
    expect(lines.offers).toEqual(["      DATABASE_URL: ${DATABASE_URL}"])
  })

  test("a value is bare only by research R10's rule, else quoted as composeText writes a string", () => {
    const values: [string, string][] = [
      ["BARE", "app"],
      ["PATH_LIKE", "a.b_c/d:e@f-g"],
      ["YES", "yes"],
      ["ON", "on"],
      ["NULL", "null"],
      ["TRUE", "True"],
      ["N", "n"],
      ["NUMBER", "18"],
      ["SPACE", "a b"],
      ["DOLLAR", "$x"],
      ["HASH", "#x"],
      ["QUOTE", 'say "hi"'],
      ["EMPTY", ""],
      ["COLON_END", "a:"],
    ]
    const template: Template = {
      ...postgres,
      services: [
        [
          "on",
          {
            image: "9fans/plan9:1@sha256:" + "0".repeat(64),
            restart: "no",
            plain: [...values, ["_UNDER", "x"]],
            volumes: [["data", "/var/lib/a+b"]],
          },
        ],
      ],
    }
    const lines = handLines(template, undefined, "compose.yaml")
    expect(lines.service).toEqual([
      '  "on":',
      `    image: "9fans/plan9:1@sha256:${"0".repeat(64)}"`,
      '    restart: "no"',
      "    environment:",
      "      BARE: app",
      "      PATH_LIKE: a.b_c/d:e@f-g",
      '      "YES": "yes"',
      '      "ON": "on"',
      '      "NULL": "null"',
      '      "TRUE": "True"',
      '      "N": "n"',
      '      NUMBER: "18"',
      '      SPACE: "a b"',
      '      DOLLAR: "$$x"',
      '      HASH: "#x"',
      '      QUOTE: "say \\"hi\\""',
      '      EMPTY: ""',
      '      COLON_END: "a:"',
      '      "_UNDER": x',
      "    volumes:",
      '      - "on-data:/var/lib/a+b"',
    ])
    expect(lines.volumes).toEqual(["on-data"])
  })

  test("no volume, no connection secret: none of their lines", () => {
    const template: Template = {
      ...postgres,
      services: [
        ["cache", { image: POSTGRES_IMAGE, secrets: ["POSTGRES_PASSWORD"] }],
      ],
      offers: [],
    }
    expect(handLines(template, undefined, "compose.yaml")).toEqual({
      file: "compose.yaml",
      service: [
        "  cache:",
        `    image: ${POSTGRES_IMAGE}`,
        "    environment:",
        "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}",
      ],
      volumes: [],
      offers: [],
    })
  })
})

/** Whether `docker compose version` answers here: the check below reads a file with it and starts nothing. */
function composeAnswers(): boolean {
  try {
    return Bun.spawnSync(["docker", "compose", "version"]).exitCode === 0
  } catch {
    return false
  }
}

/** A value nobody would type, given to Compose as each secret's value. */
const SENTINEL = "zkSENTINELhand7c3e"

describe("read by Docker Compose (contacts nothing, starts nothing)", () => {
  test.skipIf(!composeAnswers())(
    "each template's lines in a file with a service that reads the connection secret: Redis's command keeps $$REDIS_PASSWORD and no value, no port, the volume named",
    () => {
      for (const template of Object.values(FIRST_TEMPLATES)) {
        const lines = handLines(template, undefined, "compose.yaml")
        const offer = template.offers[0]!.name
        const text = [
          "services:",
          "  app:",
          "    image: example/app:1",
          "    environment:",
          ...lines.offers,
          ...lines.service,
          "volumes:",
          ...lines.volumes.map((volume) => `  ${volume}:`),
          "",
        ].join("\n")
        const folder = tempDir("hand-config")
        const file = join(folder, "compose.yaml")
        writeFileSync(file, text)
        const names = [
          ...template.makes.map((made) => made.name),
          ...template.offers.map((each) => each.name),
        ]
        const env: Record<string, string | undefined> = { ...process.env }
        for (const name of names) env[name] = `${SENTINEL}${name}`
        const read = Bun.spawnSync(
          [
            "docker",
            "compose",
            "-p",
            "zekno-test-template-hand",
            "-f",
            file,
            "config",
            "--format",
            "json",
          ],
          { cwd: folder, env }
        )
        if (read.exitCode !== 0) throw new Error(read.stderr.toString())
        const config = JSON.parse(read.stdout.toString())
        const [name, service] = servicesInApp(template, undefined)[0]!
        const added = config.services[name]
        // The app's service reads the connection secret from the environment; the database its made secrets.
        expect(config.services.app.environment[offer]).toBe(
          `${SENTINEL}${offer}`
        )
        for (const secret of service.secrets ?? [])
          expect(added.environment[secret]).toBe(`${SENTINEL}${secret}`)
        for (const [variable, value] of service.plain ?? [])
          expect(added.environment[variable]).toBe(value)
        expect(added.image).toBe(service.image)
        // No value on a command line: a start command keeps every `$` for the container's shell.
        expect(JSON.stringify(added.command ?? null)).not.toContain(SENTINEL)
        if (template.name === "redis")
          expect(added.command[2]).toContain('"$$REDIS_PASSWORD"')
        for (const each of Object.values(config.services) as object[])
          expect(each).not.toHaveProperty("ports")
        expect(added.volumes).toEqual(
          (service.volumes ?? []).map(([volume, target]) => ({
            type: "volume",
            source: volume,
            target,
            volume: {},
          }))
        )
        for (const volume of lines.volumes)
          expect(config.volumes[volume].name).toBe(
            `zekno-test-template-hand_${volume}`
          )
      }
    },
    60_000
  )
})
