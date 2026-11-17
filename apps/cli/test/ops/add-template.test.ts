/**
 * What `zekno add` checks before it reads anything (specs/012-templates,
 * contracts/commands.md, "The order of checks", steps 3 and 4; tasks T024):
 * the template and `--name`, with no profile at all, and a server to seal
 * for, reading the profile only, never the keychain.
 */
import { beforeAll, describe, expect, test } from "bun:test"

import type { OpDeps } from "../../src/cli/context"
import { checkTemplate, hasServer } from "../../src/ops/add"
import {
  AD1,
  AD27,
  AD28,
  AL3,
  AL4,
  AU8,
  AU9,
} from "../../src/templates/add-words"
import { TEMPLATE_TEXTS } from "../../src/templates/catalogue"
import { thrown } from "../support/add-ops"
import { machine, ready } from "../support/helpers"
import { FIRST_TEMPLATES, GOOD } from "../support/template-files"

const postgres = FIRST_TEMPLATES.postgres!

let m: Awaited<ReturnType<typeof ready>>
beforeAll(async () => {
  m = await ready()
}, 60_000)

describe("the template and --name, with no profile at all (step 3)", () => {
  test("a template's name gives it", () => {
    expect(checkTemplate("postgres", undefined)).toEqual(postgres)
    expect(checkTemplate("redis", "cache")).toEqual(FIRST_TEMPLATES.redis!)
  })

  test("AL3: a name in a template's also points at it; any other says to list them", async () => {
    expect(await thrown(() => checkTemplate("mongo", undefined))).toEqual({
      kind: "WrongInput",
      message: AL3("mongo", "mongodb"),
    })
    expect(AL3("mongo", "mongodb")).toBe(
      "There is no template named mongo. Run zekno add mongodb."
    )
    expect(await thrown(() => checkTemplate("nope", undefined))).toEqual({
      kind: "WrongInput",
      message:
        "There is no template named nope. Run zekno add --list to see them.",
    })
  })

  test("AL4: a name that breaks the name rule is not repeated", async () => {
    for (const name of ["Bad Name", "zk_SENTINEL_9b41", "", "a".repeat(33)])
      expect(await thrown(() => checkTemplate(name, undefined))).toEqual({
        kind: "WrongInput",
        message: AL4,
      })
  })

  test("AD27: a text of the catalogue that does not pass its own checks, status 1", async () => {
    expect(
      await thrown(() =>
        checkTemplate("postgres", undefined, [
          ...TEMPLATE_TEXTS,
          ["broken.json", "{"],
        ])
      )
    ).toEqual({ kind: "CliError", message: AD27("broken") })
  })

  test("AD28: a template that asks a question when it is added", async () => {
    const acme = GOOD.find((good) => good.file === "acme-db.json")!
    const asks = acme.text.replace(
      '"template": 1,',
      '"template": 1,\n  "asks": [],'
    )
    const texts = [...TEMPLATE_TEXTS, ["acme-db.json", asks] as const]
    expect(
      await thrown(() => checkTemplate("acme-db", undefined, texts))
    ).toEqual({ kind: "WrongInput", message: AD28("acme-db") })
    // The others are found as before.
    expect(checkTemplate("postgres", undefined, texts)).toEqual(postgres)
  })

  test("AU8: --name that is not a service name; AU9: --name with a template of several services", async () => {
    for (const name of ["Bad_Name", "", "1db", "zk_SENTINEL_9b41"])
      expect(await thrown(() => checkTemplate("postgres", name))).toEqual({
        kind: "WrongInput",
        message: AU8,
      })
    const pair = GOOD.find((good) => good.template.services.length === 2)!
    const texts = [...TEMPLATE_TEXTS, [pair.file, pair.text] as const]
    expect(
      await thrown(() => checkTemplate(pair.template.name, "db", texts))
    ).toEqual({ kind: "WrongInput", message: AU9(pair.template.name) })
    expect(checkTemplate(pair.template.name, undefined, texts)).toEqual(
      pair.template
    )
  })
})

describe("a server to seal for (step 4)", () => {
  const noKeychain = (home: string): OpDeps => ({
    ...m.deps,
    home,
    keyStore: {
      get: () => {
        throw new Error("the keychain was read")
      },
      set: () => {
        throw new Error("the keychain was written")
      },
      delete: () => {
        throw new Error("the keychain was written")
      },
    },
  })

  test("AD1 with no profile, and with a profile of no server, reading no keychain", async () => {
    const fresh = machine()
    expect(await thrown(() => hasServer(noKeychain(fresh.home)))).toEqual({
      kind: "WrongInput",
      message: AD1,
    })
    expect(await fresh.zekno("init", "--name", "Ada")).toBe(0)
    expect(await thrown(() => hasServer(noKeychain(fresh.home)))).toEqual({
      kind: "WrongInput",
      message: AD1,
    })
    expect(() => hasServer(noKeychain(m.home))).not.toThrow()
  })
})
