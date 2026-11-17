/**
 * What `zekno add` reads and checks before it asks (specs/012-templates,
 * contracts/commands.md, "The order of checks", steps 6 to 12; data-model.md,
 * "What `zekno add` prepares"; tasks T024): the file, the app and the
 * server, and the addition, one folder per step where that step and no
 * earlier one applies. Nothing is written, no value is made, the keychain is
 * read only by opening the team, and nothing is contacted. Steps 3 and 4 are
 * add-template.test.ts; the store, step 8, add-store.test.ts. Last, a
 * template that is one more text in the catalogue, prepared and added as any
 * other (SC-009, tasks T042).
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { MISSING_APP } from "../../src/cli/errors"
import { checkTemplate, prepareAdd, withReaders } from "../../src/ops/add"
import { commitAdd } from "../../src/ops/add-commit"
import { TEMPLATE_TEXTS } from "../../src/templates/catalogue"
import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import { SH4 } from "../../src/settings/words"
import { AD13, AD14, AD29, AD6, AD7, AD9 } from "../../src/templates/add-words"
import {
  BEFORE_FILE,
  BEFORE_SETTINGS,
  DESIGN_FILE,
  ONE_FILE,
} from "../support/add-files"
import { bench, plan, thrown, where } from "../support/add-ops"
import { ready, twin } from "../support/helpers"
import { FIRST_SET, FIRST_TEMPLATES } from "../support/template-files"

const postgres = FIRST_TEMPLATES.postgres!

let m: Awaited<ReturnType<typeof ready>>
let folder: ReturnType<typeof bench>["folder"]
let snapshot: ReturnType<typeof bench>["snapshot"]
let zekno: ReturnType<typeof bench>["zekno"]
beforeAll(async () => {
  m = await ready()
  ;({ folder, snapshot, zekno } = bench(m))
}, 60_000)

describe("prepared: the file, the app and the server, the store, the addition (steps 6 to 12)", () => {
  test("design.md's app on dev: the plan, the store as read, each secret's next version; nothing written, the keychain read once, nothing contacted", async () => {
    const { cwd, deps, reads } = folder(BEFORE_FILE)
    const before = snapshot(cwd)
    const prepared = plan(
      await prepareAdd(deps, {
        template: postgres,
        for: ["web"],
        where: where("demo"),
      })
    )
    expect(prepared.target.kind).toBe("settings")
    if (prepared.target.kind !== "settings") throw new Error("not settings")
    expect(prepared.target.read.shown).toBe("zekno.app.json")
    expect(prepared.target.read.settings).toEqual(BEFORE_SETTINGS)
    expect(prepared.app).toBe("demo")
    expect(prepared.server.name).toBe("dev")
    expect(prepared.store).toEqual({ records: [], removals: [] })
    expect([...prepared.versions]).toEqual([
      ["POSTGRES_PASSWORD", 1],
      ["DATABASE_URL", 1],
    ])
    expect(prepared.addition.service).toBe("postgres")
    expect(prepared.addition.readers).toEqual([
      { offer: "DATABASE_URL", services: ["web"] },
    ])
    expect(
      checkSettings(settingsText(prepared.addition.settings), "zekno.app.json")
    ).toEqual(prepared.addition.settings)
    expect(reads()).toBe(1)
    expect(snapshot(cwd)).toEqual(before)
  })

  test("the app and the server are taken only once the file was read: a function called after it", async () => {
    let asked = 0
    const empty = folder()
    expect(
      await thrown(() =>
        prepareAdd(empty.deps, {
          template: postgres,
          where: async () => {
            asked++
            return where("demo")
          },
        })
      )
    ).toEqual({ kind: "CliError", message: AD13 })
    expect(asked).toBe(0)
    const { deps } = folder(BEFORE_FILE)
    const prepared = plan(
      await prepareAdd(deps, {
        template: postgres,
        for: ["worker"],
        where: async () => {
          asked++
          return where("demo")
        },
      })
    )
    expect(asked).toBe(1)
    expect(prepared.addition.readers[0]!.services).toEqual(["worker"])
  })

  test("SH4: a zekno.json signed and not in use here yet that names another file", async () => {
    const own = folder(DESIGN_FILE)
    // The team's own machine links the folder to deploy/zekno.app.json; a second machine of the member has not used it.
    mkdirSync(join(own.cwd, "deploy"))
    writeFileSync(join(own.cwd, "deploy", "zekno.app.json"), BEFORE_FILE)
    m.deps.cwd = own.cwd
    try {
      await zekno(
        "link",
        "--app",
        "demo",
        "--server",
        "dev",
        "-f",
        "deploy/zekno.app.json"
      )
    } finally {
      m.deps.cwd = m.project
    }
    const other = await twin(m)
    other.deps.cwd = own.cwd
    expect(
      await thrown(() =>
        prepareAdd(other.deps, { template: postgres, where: where("demo") })
      )
    ).toEqual({ kind: "CliError", message: SH4("deploy/zekno.app.json") })
  }, 60_000)

  test("AD13: no settings file, status 1, before the app is asked for", async () => {
    const { deps, reads } = folder()
    expect(
      await thrown(() =>
        prepareAdd(deps, { template: postgres, where: { server: "dev" } })
      )
    ).toEqual({ kind: "CliError", message: AD13 })
    expect(reads()).toBe(0)
  })

  test("a reader's fault of the settings file: its sentence, status 1, before the app", async () => {
    const { deps, reads } = folder(
      DESIGN_FILE.replace('"memory": "1g"', '"memory": "lots"')
    )
    expect(
      await thrown(() =>
        prepareAdd(deps, { template: postgres, where: { server: "dev" } })
      )
    ).toEqual({
      kind: "CliError",
      message:
        "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g.",
    })
    expect(reads()).toBe(0)
  })

  test("MISSING_APP: no app, as zekno secret set says it", async () => {
    const { deps } = folder(BEFORE_FILE)
    expect(
      await thrown(() =>
        prepareAdd(deps, { template: postgres, where: { server: "dev" } })
      )
    ).toEqual({ kind: "UsageError", message: MISSING_APP })
  })

  test("AD6: a service named postgres already; checked before --for", async () => {
    const { deps } = folder(
      settingsText({
        version: 1,
        services: [
          ...BEFORE_SETTINGS.services,
          ["postgres", { image: "postgres:1" }],
        ],
      })
    )
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["nope"],
          where: where("demo"),
        })
      )
    ).toEqual({
      kind: "WrongInput",
      message: AD6("zekno.app.json", "postgres"),
    })
  })

  test("AD9: a volume postgres-data already", async () => {
    const { deps } = folder(
      settingsText({
        version: 1,
        services: [
          [
            "web",
            { image: "ghcr.io/acme/web:1", volumes: [["postgres-data", "/d"]] },
          ],
          ["worker", { image: "ghcr.io/acme/worker:1" }],
        ],
      })
    )
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["web"],
          where: where("demo"),
        })
      )
    ).toEqual({
      kind: "WrongInput",
      message: AD9("zekno.app.json", "postgres-data"),
    })
  })

  test("AD14: --for a service the file does not have", async () => {
    const { deps } = folder(BEFORE_FILE)
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["nope"],
          where: where("demo"),
        })
      )
    ).toEqual({
      kind: "WrongInput",
      message: AD14("zekno.app.json", "nope", ["web", "worker"]),
    })
  })

  test("two other services and no --for: the question, then the plan once it is answered", async () => {
    const { deps } = folder(BEFORE_FILE)
    const prepared = await prepareAdd(deps, {
      template: postgres,
      where: where("demo"),
    })
    if (!("ask" in prepared)) throw new Error("no question")
    expect(prepared.ask).toEqual([
      { offer: "DATABASE_URL", services: ["web", "worker"] },
    ])
    const answered = withReaders(
      prepared,
      new Map([["DATABASE_URL", ["worker", "web"]]])
    )
    expect(answered.addition.readers).toEqual([
      { offer: "DATABASE_URL", services: ["web", "worker"] },
    ])
    expect(answered.versions).toBe(prepared.versions)
    expect(answered.store).toBe(prepared.store)
  })

  test("one other service: no question, it reads it", async () => {
    const { deps } = folder(
      settingsText({ version: 1, services: [BEFORE_SETTINGS.services[0]!] })
    )
    const prepared = plan(
      await prepareAdd(deps, { template: postgres, where: where("demo") })
    )
    expect(prepared.addition.readers).toEqual([
      { offer: "DATABASE_URL", services: ["web"] },
    ])
  })

  test("AD29: a service that already reads a secret of the connection secret's name (design.md's own file), whoever is picked to read it (security review T1)", async () => {
    const { deps } = folder(DESIGN_FILE)
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["worker"],
          where: where("demo"),
        })
      )
    ).toEqual({ kind: "WrongInput", message: AD29("web", "DATABASE_URL") })
    // Answered at the question, the same.
    const prepared = await prepareAdd(deps, {
      template: postgres,
      where: where("demo"),
    })
    if (!("ask" in prepared)) throw new Error("no question")
    expect(
      await thrown(() =>
        withReaders(prepared, new Map([["DATABASE_URL", ["worker"]]]))
      )
    ).toEqual({ kind: "WrongInput", message: AD29("web", "DATABASE_URL") })
  })

  test("AD7: a reader with a plain variable of the connection secret's name, by --for and at the question", async () => {
    const { deps } = folder(
      settingsText({
        version: 1,
        services: [
          [
            "web",
            { image: "ghcr.io/acme/web:1", plain: [["DATABASE_URL", "x"]] },
          ],
          ["worker", { image: "ghcr.io/acme/worker:1" }],
        ],
      })
    )
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["web"],
          where: where("demo"),
        })
      )
    ).toEqual({ kind: "WrongInput", message: AD7("web", "DATABASE_URL") })
    const prepared = await prepareAdd(deps, {
      template: postgres,
      where: where("demo"),
    })
    if (!("ask" in prepared)) throw new Error("no question")
    expect(
      await thrown(() =>
        withReaders(prepared, new Map([["DATABASE_URL", ["worker", "web"]]]))
      )
    ).toEqual({ kind: "WrongInput", message: AD7("web", "DATABASE_URL") })
  })

  test("AD15: a file of 32 services cannot take one more", async () => {
    const { deps } = folder(
      settingsText({
        version: 1,
        services: Array.from(
          { length: 32 },
          (_, at) => [`s${at}`, { image: "ghcr.io/acme/web:1" }] as const
        ),
      })
    )
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["s0"],
          where: where("demo"),
        })
      )
    ).toEqual({
      kind: "WrongInput",
      message:
        "postgres cannot be added to zekno.app.json. services: at most 32 services.",
    })
  })

  test("--name db: the service, its volume and the offer's host", async () => {
    const { deps } = folder(BEFORE_FILE)
    const prepared = plan(
      await prepareAdd(deps, {
        template: postgres,
        name: "db",
        for: ["web"],
        where: where("demo"),
      })
    )
    expect(prepared.addition.service).toBe("db")
    expect(prepared.addition.services[0]![1].volumes).toEqual([
      ["db-data", "/var/lib/postgresql"],
    ])
  })
})

describe("one file and one line more (SC-009, FR-022)", () => {
  test("a template that is one more text of the catalogue is found, prepared and added as any other, with no other change", async () => {
    const texts = [
      ...TEMPLATE_TEXTS,
      [
        "another-db.json",
        FIRST_SET.postgres!.replace(
          '"name": "postgres"',
          '"name": "another-db"'
        ),
      ] as const,
    ]
    const template = checkTemplate("another-db", undefined, texts)
    expect(template.name).toBe("another-db")
    const { cwd, deps } = folder(ONE_FILE)
    const prepared = plan(
      await prepareAdd(deps, { template, where: where("example") })
    )
    expect(prepared.addition.readers).toEqual([
      { offer: "DATABASE_URL", services: ["web"] },
    ])
    expect(await commitAdd(prepared)).toEqual({
      service: "postgres",
      file: "zekno.app.json",
      stored: [
        { name: "POSTGRES_PASSWORD", version: 1 },
        { name: "DATABASE_URL", version: 1 },
      ],
      server: "dev",
    })
    const written = checkSettings(
      readFileSync(join(cwd, "zekno.app.json"), "utf8"),
      "zekno.app.json"
    )
    expect(written).toEqual(prepared.addition.settings)
  })
})
