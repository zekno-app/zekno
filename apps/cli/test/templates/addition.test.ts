/**
 * Planning an addition (specs/012-templates, data-model.md, "An addition";
 * contracts/commands.md, "The order of checks", steps 9 to 12; plan.md, D1,
 * D14, D19, D21; tasks T015): a template's services added last to a
 * settings file, each volume named for its service in the app, the readers
 * of each connection secret, and every refusal with its sentence and status
 * 2. Pure: the settings given are never changed.
 */
import { describe, expect, test } from "bun:test"

import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import { planAddition } from "../../src/templates/addition"
import type { Template } from "../../src/templates/types"
import { DESIGN_SETTINGS } from "../support/settings-files"
import { FIRST_TEMPLATES, GOOD } from "../support/template-files"

const FILE = "zekno.app.json"
const postgres = FIRST_TEMPLATES.postgres!
const redis = FIRST_TEMPLATES.redis!
const [, POSTGRES] = postgres.services[0]!
const WEB: ServiceSettings = { image: "ghcr.io/acme/web:1" }

/** A settings file of the services given. */
const settingsOf = (
  ...services: (readonly [string, ServiceSettings])[]
): Settings => ({ version: 1, services })
const ONE = settingsOf(["web", WEB])

/** The same value, frozen at every depth: a plan that changed its input would throw. */
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) frozen(inner)
    Object.freeze(value)
  }
  return value
}

/** A plan that must be an addition. */
function added(input: Parameters<typeof planAddition>[0]) {
  const plan = planAddition({
    ...input,
    template: frozen(input.template),
    settings: frozen(input.settings),
  })
  if (!("settings" in plan))
    throw new Error(`not an addition: ${JSON.stringify(plan)}`)
  // What zekno would write reads back as these very settings.
  expect(checkSettings(settingsText(plan.settings), FILE)).toEqual(
    plan.settings
  )
  return plan
}

/** A plan that must be refused: its id and sentence (status 2 always). */
function refused(input: Parameters<typeof planAddition>[0]) {
  const plan = planAddition({
    ...input,
    template: frozen(input.template),
    settings: frozen(input.settings),
  })
  if (!("id" in plan)) throw new Error(`not refused: ${JSON.stringify(plan)}`)
  expect(plan.status).toBe(2)
  return [plan.id, plan.sentence]
}

describe("an addition", () => {
  test("postgres to a file of one service: added last, its volume postgres-data, read by the one other service with no question", () => {
    const plan = added({ template: postgres, settings: ONE, file: FILE })
    const service = {
      ...POSTGRES,
      volumes: [["postgres-data", "/var/lib/postgresql"]] as const,
    }
    expect(plan).toEqual({
      template: postgres,
      service: "postgres",
      services: [["postgres", service]],
      readers: [{ offer: "DATABASE_URL", services: ["web"] }],
      settings: settingsOf(
        ["web", { ...WEB, secrets: ["DATABASE_URL"] }],
        ["postgres", service]
      ),
    })
  })

  test("--name db: the service db, its volume db-data, and the offer's {service} db", () => {
    const plan = added({
      template: postgres,
      settings: ONE,
      file: FILE,
      name: "db",
    })
    expect(plan.service).toBe("db")
    expect(plan.services).toEqual([
      ["db", { ...POSTGRES, volumes: [["db-data", "/var/lib/postgresql"]] }],
    ])
    expect(plan.settings.services.map(([name]) => name)).toEqual(["web", "db"])
  })

  test("two other services and no readers: the question, for each connection secret", () => {
    expect(
      planAddition({
        template: postgres,
        settings: DESIGN_SETTINGS,
        file: FILE,
      })
    ).toEqual({
      ask: [{ offer: "DATABASE_URL", services: ["web", "worker"] }],
    })
  })

  test("readers given: each gains the connection secret in its secrets, last, in the file's order", () => {
    const plan = added({
      template: redis,
      settings: DESIGN_SETTINGS,
      file: FILE,
      readers: ["worker", "web", "worker"],
    })
    expect(plan.readers).toEqual([
      { offer: "REDIS_URL", services: ["web", "worker"] },
    ])
    const secrets = Object.fromEntries(
      plan.settings.services.map(([name, service]) => [name, service.secrets])
    )
    expect(secrets).toEqual({
      web: ["DATABASE_URL", "SESSION_KEY", "REDIS_URL"],
      worker: ["DATABASE_URL", "REDIS_URL"],
      redis: ["REDIS_PASSWORD"],
    })
    // Everything else of the file as it was.
    expect(plan.settings.services.slice(0, 2)).toEqual(
      DESIGN_SETTINGS.services.map(([name, service]) => [
        name,
        { ...service, secrets: [...(service.secrets ?? []), "REDIS_URL"] },
      ])
    )
  })

  test("readers answered for each connection secret: each its own services, in the file's order (contracts/commands.md, 'Who reads the connection secret')", () => {
    const two: Template = {
      ...redis,
      offers: [
        ...redis.offers,
        { name: "CACHE_URL", text: "redis://{REDIS_PASSWORD}@{service}" },
      ],
    }
    const plan = added({
      template: two,
      settings: DESIGN_SETTINGS,
      file: FILE,
      readers: new Map([
        ["REDIS_URL", ["worker"]],
        ["CACHE_URL", ["worker", "web"]],
      ]),
    })
    expect(plan.readers).toEqual([
      { offer: "REDIS_URL", services: ["worker"] },
      { offer: "CACHE_URL", services: ["web", "worker"] },
    ])
    expect(
      plan.settings.services.map(([name, service]) => [name, service.secrets])
    ).toEqual([
      ["web", ["DATABASE_URL", "SESSION_KEY", "CACHE_URL"]],
      ["worker", ["DATABASE_URL", "REDIS_URL", "CACHE_URL"]],
      ["redis", ["REDIS_PASSWORD"]],
    ])
    expect(
      refused({
        template: two,
        settings: DESIGN_SETTINGS,
        file: FILE,
        readers: new Map([
          ["REDIS_URL", ["worker"]],
          ["CACHE_URL", ["nope"]],
        ]),
      })
    ).toEqual([
      "AD14",
      "zekno.app.json has no service named nope. Its services are web, worker.",
    ])
  })

  test("a template with no connection secret asks nothing and reads nothing into the file's services", () => {
    const quiet: Template = { ...postgres, offers: [] }
    const plan = added({
      template: quiet,
      settings: DESIGN_SETTINGS,
      file: FILE,
    })
    expect(plan.readers).toEqual([])
    expect(plan.settings.services.slice(0, 2)).toEqual([
      ...DESIGN_SETTINGS.services,
    ])
  })

  test("a template of several services: each added with its own name and volumes", () => {
    const pair = GOOD.find((good) => good.template.services.length === 2)!
    const plan = added({ template: pair.template, settings: ONE, file: FILE })
    expect(plan.service).toBe("db")
    expect(
      plan.services.map(([name, service]) => [name, service.volumes])
    ).toEqual([
      ["db", [["db-data", "/var/lib/db"]]],
      ["cache", undefined],
    ])
  })
})

describe("refusals, each with status 2", () => {
  test("AD6: a service of that name already", () => {
    expect(
      refused({
        template: postgres,
        settings: settingsOf(["web", WEB], ["postgres", WEB]),
        file: FILE,
      })
    ).toEqual([
      "AD6",
      "zekno.app.json already has a service named postgres. Give this one another name with --name <service>.",
    ])
  })

  test("AD9: a volume of that name already, in any service", () => {
    expect(
      refused({
        template: postgres,
        settings: settingsOf(
          ["web", WEB],
          ["files", { ...WEB, volumes: [["postgres-data", "/data"]] }]
        ),
        file: FILE,
        readers: ["web"],
      })
    ).toEqual([
      "AD9",
      "zekno.app.json already has a volume named postgres-data. Give this one another name with --name <service>.",
    ])
  })

  test("AD14: --for a service the file does not have; a name that breaks the rule is not repeated; the one-service form", () => {
    expect(
      refused({
        template: postgres,
        settings: DESIGN_SETTINGS,
        file: FILE,
        readers: ["web", "nope"],
      })
    ).toEqual([
      "AD14",
      "zekno.app.json has no service named nope. Its services are web, worker.",
    ])
    expect(
      refused({
        template: postgres,
        settings: DESIGN_SETTINGS,
        file: FILE,
        readers: ["Bad_Name"],
      })
    ).toEqual([
      "AD14",
      "zekno.app.json has no such service. Its services are web, worker.",
    ])
    expect(
      refused({
        template: postgres,
        settings: ONE,
        file: FILE,
        readers: ["nope"],
      })
    ).toEqual([
      "AD14",
      "zekno.app.json has no service named nope. Its service is web.",
    ])
  })

  test("AD7: a reader with a plain variable of the connection secret's name; one that is no reader keeps it", () => {
    const sentence =
      "web already has a variable named DATABASE_URL. Remove it, or leave web out with --for <service>."
    expect(
      refused({
        template: postgres,
        settings: settingsOf([
          "web",
          { ...WEB, plain: [["DATABASE_URL", "x"]] },
        ]),
        file: FILE,
      })
    ).toEqual(["AD7", sentence])
    const plain = settingsOf(
      ["web", { ...WEB, plain: [["DATABASE_URL", "x"]] }],
      ["worker", WEB]
    )
    expect(
      refused({
        template: postgres,
        settings: plain,
        file: FILE,
        readers: ["web"],
      })
    ).toEqual(["AD7", sentence])
    // Left out with --for, as AD7 says: a plain variable reads no secret, so it stays.
    const plan = added({
      template: postgres,
      settings: plain,
      file: FILE,
      readers: ["worker"],
    })
    expect(plan.settings.services[0]).toEqual(plain.services[0])
  })

  test("AD29: a service of the file that lists in its secrets a secret the template makes or builds, reader or not (security review T1)", () => {
    const worker = (secrets: string[]) =>
      settingsOf(["web", WEB], ["worker", { ...WEB, secrets }])
    expect(
      refused({
        template: postgres,
        settings: worker(["POSTGRES_PASSWORD"]),
        file: FILE,
        readers: ["web"],
      })
    ).toEqual([
      "AD29",
      "worker already reads a secret named POSTGRES_PASSWORD. Remove it from worker.",
    ])
    expect(
      refused({
        template: postgres,
        settings: worker(["DATABASE_URL"]),
        file: FILE,
        readers: ["web"],
      })
    ).toEqual([
      "AD29",
      "worker already reads a secret named DATABASE_URL. Remove it from worker.",
    ])
    // A reader that lists it: AD29, not AD7, also with a plain variable of that name.
    expect(
      refused({
        template: postgres,
        settings: settingsOf([
          "web",
          { ...WEB, secrets: ["DATABASE_URL"], plain: [["DATABASE_URL", "x"]] },
        ]),
        file: FILE,
      })
    ).toEqual([
      "AD29",
      "web already reads a secret named DATABASE_URL. Remove it from web.",
    ])
    // AD7's advice followed: web left out with --for, and still refused, since web would read it.
    expect(
      refused({
        template: postgres,
        settings: settingsOf(
          ["web", { ...WEB, secrets: ["DATABASE_URL"] }],
          ["worker", WEB]
        ),
        file: FILE,
        readers: ["worker"],
      })
    ).toEqual([
      "AD29",
      "web already reads a secret named DATABASE_URL. Remove it from web.",
    ])
    // design.md's file: both services list DATABASE_URL; the first in the file's order is said, whoever reads it.
    for (const readers of [["web"], ["worker"], ["web", "worker"]])
      expect(
        refused({
          template: postgres,
          settings: DESIGN_SETTINGS,
          file: FILE,
          readers,
        })
      ).toEqual([
        "AD29",
        "web already reads a secret named DATABASE_URL. Remove it from web.",
      ])
    // A template with no connection secret: its made secrets all the same.
    expect(
      refused({
        template: { ...postgres, offers: [] },
        settings: worker(["OTHER", "POSTGRES_PASSWORD"]),
        file: FILE,
      })
    ).toEqual([
      "AD29",
      "worker already reads a secret named POSTGRES_PASSWORD. Remove it from worker.",
    ])
  })

  test("AU9: --name with a template of several services", () => {
    const pair = GOOD.find((good) => good.template.services.length === 2)!
    expect(
      refused({ template: pair.template, settings: ONE, file: FILE, name: "x" })
    ).toEqual([
      "AU9",
      "acme-db adds several services, so it takes no --name in this version.",
    ])
  })

  test("AD15: 33 services", () => {
    const many = Array.from({ length: 32 }, (_, at) => [`s${at}`, WEB] as const)
    expect(
      refused({
        template: postgres,
        settings: settingsOf(...many),
        file: FILE,
        readers: ["s0"],
      })
    ).toEqual([
      "AD15",
      "postgres cannot be added to zekno.app.json. services: at most 32 services.",
    ])
  })

  test("AD15: a file that would pass 64 KiB, with its own words", () => {
    // A file of 65,436 bytes: within its limit, and over it once postgres is added.
    const plain = Array.from(
      { length: 16 },
      (_, at) => [`V${at}`, "x".repeat(4000)] as [string, string]
    )
    const big = (last: number) =>
      settingsOf([
        "web",
        { ...WEB, plain: [...plain.slice(0, -1), ["V15", "x".repeat(last)]] },
      ])
    const size = (last: number) => Buffer.byteLength(settingsText(big(last)))
    const last = 4000 + (65_436 - size(4000))
    expect(size(last)).toBe(65_436)
    expect(
      refused({ template: postgres, settings: big(last), file: FILE })
    ).toEqual([
      "AD15",
      "postgres cannot be added to zekno.app.json. zekno.app.json would be larger than the 64 KiB a settings file may be.",
    ])
  })

  test("the order: AU9 before AD6, AD6 before AD9, AD9 before AD14, AD14 before AD7", () => {
    const pair = GOOD.find((good) => good.template.services.length === 2)!
    expect(
      refused({
        template: pair.template,
        settings: settingsOf(["db", WEB]),
        file: FILE,
        name: "x",
      })[0]
    ).toBe("AU9")
    const clashing = settingsOf(
      ["postgres", { ...WEB, volumes: [["postgres-data", "/d"]] }],
      ["web", { ...WEB, secrets: ["DATABASE_URL"] }]
    )
    expect(
      refused({
        template: postgres,
        settings: clashing,
        file: FILE,
        readers: ["nope"],
      })[0]
    ).toBe("AD6")
    expect(
      refused({
        template: postgres,
        settings: clashing,
        file: FILE,
        name: "other",
        readers: ["nope"],
      })[0]
    ).toBe("AD14")
    expect(
      refused({
        template: postgres,
        settings: settingsOf(
          ["web", { ...WEB, volumes: [["postgres-data", "/d"]] }],
          ["api", { ...WEB, secrets: ["DATABASE_URL"] }]
        ),
        file: FILE,
        readers: ["nope"],
      })[0]
    ).toBe("AD9")
  })

  test("the order: AD14 before AD29, AD29 before AD7; the first service of the file, and in it the template's names, made secrets first", () => {
    const listing = settingsOf(
      ["web", { ...WEB, plain: [["DATABASE_URL", "x"]] }],
      ["worker", { ...WEB, secrets: ["DATABASE_URL", "POSTGRES_PASSWORD"] }],
      ["cron", { ...WEB, secrets: ["POSTGRES_PASSWORD"] }]
    )
    expect(
      refused({
        template: postgres,
        settings: listing,
        file: FILE,
        readers: ["nope"],
      })[0]
    ).toBe("AD14")
    expect(
      refused({
        template: postgres,
        settings: listing,
        file: FILE,
        readers: ["web"],
      })
    ).toEqual([
      "AD29",
      "worker already reads a secret named POSTGRES_PASSWORD. Remove it from worker.",
    ])
  })
})
