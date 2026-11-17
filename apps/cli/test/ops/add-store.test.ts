/**
 * `zekno add` and the app's secret store (specs/012-templates,
 * contracts/commands.md, "The order of checks", step 8; plan.md, D22, D28;
 * tasks T024): AD5 for a secret the app has now, before the service's name;
 * a secret removed before is not the app's; AD24 and AD25 at the limits.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { prepareAdd } from "../../src/ops/add"
import { settingsText } from "../../src/settings/text"
import { AD24, AD25, AD5 } from "../../src/templates/add-words"
import { BEFORE_FILE, BEFORE_SETTINGS } from "../support/add-files"
import { bench, plan, thrown, where } from "../support/add-ops"
import { ready } from "../support/helpers"
import { FIRST_TEMPLATES } from "../support/template-files"

const postgres = FIRST_TEMPLATES.postgres!

let m: Awaited<ReturnType<typeof ready>>
let folder: ReturnType<typeof bench>["folder"]
let zekno: ReturnType<typeof bench>["zekno"]
let storePath: ReturnType<typeof bench>["storePath"]
beforeAll(async () => {
  m = await ready()
  ;({ folder, zekno, storePath } = bench(m))
}, 60_000)

describe("the app's secret store (step 8)", () => {
  test("AD5: a current secret of the app named as a made secret, or as the connection secret set by hand; checked before the service's name", async () => {
    m.typing("an-old-password")
    await zekno(
      "secret",
      "set",
      "POSTGRES_PASSWORD",
      "--app",
      "a5",
      "--server",
      "dev"
    )
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
          for: ["web"],
          where: where("a5"),
        })
      )
    ).toEqual({ kind: "WrongInput", message: AD5("a5", "POSTGRES_PASSWORD") })
    m.typing("postgres://by-hand")
    await zekno(
      "secret",
      "set",
      "DATABASE_URL",
      "--app",
      "a5b",
      "--server",
      "dev"
    )
    const by = folder(BEFORE_FILE)
    expect(
      await thrown(() =>
        prepareAdd(by.deps, {
          template: postgres,
          for: ["web"],
          where: where("a5b"),
        })
      )
    ).toEqual({ kind: "WrongInput", message: AD5("a5b", "DATABASE_URL") })
  })

  test("a secret removed before is not the app's: not AD5, and it gets the version after its removal's", async () => {
    m.typing("an-old-password")
    await zekno(
      "secret",
      "set",
      "POSTGRES_PASSWORD",
      "--app",
      "arm",
      "--server",
      "dev"
    )
    await zekno(
      "secret",
      "rm",
      "POSTGRES_PASSWORD",
      "--app",
      "arm",
      "--server",
      "dev"
    )
    const { deps } = folder(BEFORE_FILE)
    const prepared = plan(
      await prepareAdd(deps, {
        template: postgres,
        for: ["web"],
        where: where("arm"),
      })
    )
    // Set as version 1, removed as version 2: the next is 3.
    expect(prepared.versions.get("POSTGRES_PASSWORD")).toBe(3)
    expect(prepared.versions.get("DATABASE_URL")).toBe(1)
    expect(prepared.store.records.length).toBe(1)
    expect(prepared.store.removals.length).toBe(1)
  })

  test("AD24: the app would have more than 256 secrets; AD25: more than 4096 records on this machine; status 1", async () => {
    const file = join(m.project, "many.env")
    writeFileSync(
      file,
      Array.from({ length: 255 }, (_, at) => `S${at}=value-${at}`).join("\n")
    )
    await zekno(
      "secret",
      "import",
      "many.env",
      "--app",
      "a24",
      "--server",
      "dev",
      "--yes"
    )
    const { deps } = folder(BEFORE_FILE)
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["web"],
          where: where("a24"),
        })
      )
    ).toEqual({ kind: "CliError", message: AD24("a24", "dev") })

    m.typing("a-value")
    await zekno("secret", "set", "OTHER", "--app", "a25", "--server", "dev")
    const path = storePath("a25")
    const store = JSON.parse(readFileSync(path, "utf8"))
    store.records = Array.from({ length: 4095 }, () => store.records[0])
    writeFileSync(path, JSON.stringify(store))
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["web"],
          where: where("a25"),
        })
      )
    ).toEqual({ kind: "CliError", message: AD25("a25", "dev") })
    // Past the limit already, nothing of it is read: AD25 too.
    store.records = Array.from({ length: 4097 }, () => store.records[0])
    writeFileSync(path, JSON.stringify(store))
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["web"],
          where: where("a25"),
        })
      )
    ).toEqual({ kind: "CliError", message: AD25("a25", "dev") })
  }, 60_000)
})
