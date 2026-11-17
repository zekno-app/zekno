/**
 * The catalogue (specs/012-templates, contracts/template-file.md, "Where a
 * template comes from" and "The first set"; plan.md, D8; tasks T011): the
 * templates the index names and nothing else, read once per run, in the
 * boards' order; a name typed found, or found in another's `also`; a text
 * that does not read, or two that clash, said as AD27.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { CliError } from "../../src/cli/errors"
import {
  catalogue,
  findTemplate,
  TEMPLATE_TEXTS,
} from "../../src/templates/catalogue"
import { TEMPLATE_FILES } from "../../src/templates/files/index"
import { templateRows, templateView } from "../../src/templates/shown"
import type { Template } from "../../src/templates/types"
import { FIRST_SET, FIRST_TEMPLATES, GOOD } from "../support/template-files"

/** acme-db's good file, named `name`. */
const acmeNamed = (name: string): readonly [string, string] => [
  `${name}.json`,
  GOOD.find((good) => good.file === "acme-db.json")!.text.replace(
    '"name": "acme-db"',
    `"name": "${name}"`
  ),
]

/** The `CliError` a call throws: its sentence. */
function refused(work: () => unknown): string {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(CliError)
    return (error as Error).message
  }
  throw new Error("nothing was thrown")
}

describe("the templates this zekno carries", () => {
  test("the four of the first set, in the boards' order: postgres, mysql, mongodb, redis (D8)", () => {
    // Any template a contributor adds comes after them, by name: one file and one line in the index, and no test to change (FR-022, SC-009).
    const names = catalogue().map((template) => template.name)
    expect(names.slice(0, 4)).toEqual(["postgres", "mysql", "mongodb", "redis"])
    expect(names.slice(4)).toEqual([...names.slice(4)].sort())
    expect(catalogue().slice(0, 4)).toEqual(
      ["postgres", "mysql", "mongodb", "redis"].map(
        (name) => FIRST_TEMPLATES[name]!
      )
    )
  })

  test("exactly the files the index names", () => {
    const names: string[] = TEMPLATE_FILES.map(([name]) => name)
    expect(
      catalogue()
        .map((template) => template.name)
        .sort()
    ).toEqual(names.sort())
  })

  test("any other template after the four, by name", () => {
    const texts = [
      ...TEMPLATE_TEXTS,
      acmeNamed("zeta-db"),
      acmeNamed("acme-db"),
      acmeNamed("beta-db"),
    ]
    // The carried templates past the first set, if a contributor added any, are sorted in among them by name (FR-022).
    const carried = catalogue()
      .slice(4)
      .map((template) => template.name)
    expect(catalogue(texts).map((template) => template.name)).toEqual([
      "postgres",
      "mysql",
      "mongodb",
      "redis",
      ...[...carried, "acme-db", "beta-db", "zeta-db"].sort(),
    ])
  })

  test("read once per run: the same catalogue again, and each text read once", () => {
    expect(catalogue()).toBe(catalogue())
    let reads = 0
    const counted = TEMPLATE_TEXTS.map(([file, text]) => {
      const pair: [string, string] = [file, ""]
      Object.defineProperty(pair, 1, {
        get: () => {
          reads++
          return text
        },
      })
      return pair
    })
    const first = catalogue(counted)
    expect(reads).toBe(TEMPLATE_TEXTS.length)
    expect(catalogue(counted)).toBe(first)
    expect(reads).toBe(TEMPLATE_TEXTS.length)
  })
})

describe("finding a template", () => {
  test("by its name; a name in another's also points at it; any other is not found", () => {
    expect(findTemplate("mongodb")).toEqual(FIRST_TEMPLATES.mongodb!)
    expect(findTemplate("postgres")).toBe(catalogue()[0]!)
    expect(findTemplate("mongo")).toEqual({ also: "mongodb" })
    expect(findTemplate("nope")).toBeUndefined()
    expect(findTemplate("Postgres")).toBeUndefined()
  })

  test("in a catalogue given", () => {
    const list = catalogue([...TEMPLATE_TEXTS, acmeNamed("acme-db")])
    expect(findTemplate("acme-db", list)).toBe(list[4]!)
    expect(list[4]!.name).toBe("acme-db")
    expect(findTemplate("acme-db")).toBeUndefined()
  })
})

describe("AD27: a template that does not pass its own checks", () => {
  const AD27 = (name: string) =>
    `This zekno's template ${name} does not pass its own checks. Nothing was added.`

  test("a text that does not read", () => {
    expect(
      refused(() => catalogue([...TEMPLATE_TEXTS, ["broken.json", "{"]]))
    ).toBe(AD27("broken"))
    expect(
      refused(() =>
        catalogue([
          ...TEMPLATE_TEXTS,
          ["postgres-copy.json", FIRST_SET.postgres!],
        ])
      )
    ).toBe(AD27("postgres-copy"))
  })

  test("TC1: a name that another template has in its also, or a name twice", () => {
    expect(
      refused(() => catalogue([...TEMPLATE_TEXTS, acmeNamed("mongo")]))
    ).toBe(AD27("mongo"))
    expect(
      refused(() =>
        catalogue([...TEMPLATE_TEXTS, ["redis.json", FIRST_SET.redis!]])
      )
    ).toBe(AD27("redis"))
  })

  test("TC2: an also that is another template's name, or in its also", () => {
    const also = (name: string, other: string): readonly [string, string] => {
      const [file, text] = acmeNamed(name)
      return [file, text.replace('"also": []', `"also": ["${other}"]`)]
    }
    expect(
      refused(() => catalogue([...TEMPLATE_TEXTS, also("acme-db", "redis")]))
    ).toBe(AD27("acme-db"))
    expect(
      refused(() => catalogue([...TEMPLATE_TEXTS, also("acme-db", "mongo")]))
    ).toBe(AD27("acme-db"))
  })
})

describe("FR-001: nothing is read from the folder or the profile", () => {
  const cwd = process.cwd()
  const home = process.env.ZEKNO_HOME
  afterEach(() => {
    process.chdir(cwd)
    if (home === undefined) delete process.env.ZEKNO_HOME
    else process.env.ZEKNO_HOME = home
  })

  test("a postgres.json with another image in the folder the command runs in and in ZEKNO_HOME changes nothing", () => {
    const other = FIRST_SET.postgres!.replace(
      /postgres:18\.7@sha256:[0-9a-f]{64}/,
      `postgres:1.0@sha256:${"0".repeat(64)}`
    )
    const folder = tempDir("template-folder")
    const profile = tempDir("template-home")
    for (const where of [folder, profile]) {
      writeFileSync(join(where, "postgres.json"), other)
      mkdirSync(join(where, "templates"))
      writeFileSync(join(where, "templates", "postgres.json"), other)
    }
    process.chdir(folder)
    process.env.ZEKNO_HOME = profile
    const fresh = catalogue([...TEMPLATE_TEXTS])
    expect(fresh.find((template) => template.name === "postgres")).toEqual(
      FIRST_TEMPLATES.postgres!
    )
    expect(findTemplate("postgres")).toEqual(FIRST_TEMPLATES.postgres!)
  })
})

describe("one file and one line more (SC-009, FR-022; tasks T042)", () => {
  /** A contributor's copy of postgres.json under a name of its own, as the index would give its text. */
  const EXAMPLE: readonly [string, string] = [
    "another-db.json",
    FIRST_SET.postgres!.replace('"name": "postgres"', '"name": "another-db"'),
  ]

  test("a catalogue given one more good text lists it, shows it and finds it, with nothing else changed", () => {
    const texts = [...TEMPLATE_TEXTS, EXAMPLE]
    const list = catalogue(texts)
    const carried = catalogue().map((template) => template.name)
    // After the first set, by name, among any other a contributor added (D8).
    expect(list.map((template) => template.name)).toEqual([
      ...carried.slice(0, 4),
      ...[...carried.slice(4), "another-db"].sort(),
    ])
    expect(list.filter((template) => template.name !== "another-db")).toEqual([
      ...catalogue(),
    ])
    expect(templateRows(list).find((row) => row.name === "another-db")).toEqual(
      {
        name: "another-db",
        title: "PostgreSQL",
        software: "18.7",
        about: "A relational database",
        author: "zekno",
      }
    )
    const found = findTemplate("another-db", list) as Template
    expect(found.name).toBe("another-db")
    expect(templateView(found)).toEqual(templateView(FIRST_TEMPLATES.postgres!))
    expect(findTemplate("another-db")).toBeUndefined()
  })
})
