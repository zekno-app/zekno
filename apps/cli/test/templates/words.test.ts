/**
 * Every sentence of templates and of `zekno add` (specs/012-templates,
 * contracts/template-file.md, "Sentences"; contracts/commands.md,
 * "Sentences" and "The summary's words"; tasks T004), checked word for word
 * for sample arguments. The expected texts are copied from the contracts,
 * not from the code. No sentence holds an em dash or the word "agent".
 */
import { describe, expect, test } from "bun:test"

import * as add from "../../src/templates/add-words"
import * as file from "../../src/templates/file-words"

/** A rule said after its place, as a template's fault is said. */
const said = ({ place, rule }: file.PlaceRule): string => `${place}: ${rule}`

describe("file-words.ts: contracts/template-file.md", () => {
  test("inTemplate: `<name> <place>: <rule>`, and `<place>: <rule>` before the name passed TR1", () => {
    expect(
      file.inTemplate(
        "acme-db",
        "services.db.source.image",
        "pin the image by digest."
      )
    ).toBe("acme-db services.db.source.image: pin the image by digest.")
    expect(file.inTemplate(undefined, "Bad.json", "x.")).toBe("Bad.json: x.")
  })

  test("TR1 to TR4", () => {
    expect(said(file.TR1("Bad Name.json"))).toBe(
      "Bad Name.json: name a template file <name>.json, its name lowercase letters, digits and hyphens, starting with a letter, at most 32 characters."
    )
    expect(said(file.TR2)).toBe("file: a template file is at most 16 KiB.")
    expect(said(file.TR3)).toBe("file: a template file is UTF-8 text.")
    expect(said(file.TR4_SYNTAX(3))).toBe("line 3: this is not JSON.")
    expect(said(file.TR4_TWICE(7, 6))).toBe("line 7: the same name as line 6.")
    expect(said(file.TR4_DEEP(1))).toBe(
      "line 1: nested deeper than templates go."
    )
    expect(said(file.TR4_LONG(4))).toBe(
      "line 4: a text longer than 4096 characters."
    )
    expect(said(file.TR4_TOP)).toBe("line 1: a template is one JSON object.")
  })

  test("TF1 to TF20", () => {
    expect(said(file.TF1)).toBe(
      "template: use 1, the version of templates this zekno reads."
    )
    expect(file.TF2("acme-db")).toEqual({
      first: "acme-db is written for a later version of zekno.",
      second: "Update zekno to use it.",
    })
    expect(said(file.TF3(5))).toBe("line 5: a field this zekno does not know.")
    expect(file.TF4("acme-db")).toEqual({
      first: "acme-db asks a question when it is added.",
      second:
        "Questions are not in this version of zekno yet. They come with domains.",
    })
    expect(said(file.TF5("title"))).toBe("title: a template needs this field.")
    expect(said(file.TF6)).toBe(
      "name: use lowercase letters, digits and hyphens, starting with a letter, at most 32 characters."
    )
    expect(said(file.TF7("acme-db"))).toBe(
      "name: use the file's own name, acme-db."
    )
    expect(said(file.TF8)).toBe(
      'title: use 1 to 40 letters, digits, spaces, dots, plus signs and hyphens, such as "PostgreSQL".'
    )
    expect(said(file.TF9)).toBe(
      'about: use one sentence of at most 80 characters that ends with a full stop, such as "A relational database."'
    )
    expect(said(file.TF10)).toBe(
      'software: use the software\'s version as people name it, such as "18.7" or "9.7".'
    )
    expect(said(file.TF11)).toBe(
      "author: use a name of letters, digits and inner hyphens, at most 39 characters, such as a GitHub user name."
    )
    expect(said(file.TF12)).toBe(
      "also: use a list of at most 8 other names people may type, each written as a template's name, none twice and not this one's, such as [\"mongo\"]."
    )
    expect(said(file.TF13)).toBe(
      'services: name 1 to 8 services, such as { "postgres": { "source": { "image": "postgres:18.7@sha256:..." } } }.'
    )
    expect(said(file.TF14)).toBe(
      'makes: name 1 to 16 secrets the template makes, such as { "POSTGRES_PASSWORD": { "kind": "password", "length": 32 } }.'
    )
    expect(said(file.TF15(12))).toBe(
      "makes: a made secret's name uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself (line 12)."
    )
    expect(said(file.TF16("DB_PASSWORD"))).toBe(
      'makes.DB_PASSWORD: use { "kind": "password", "length": <a number from 24 to 64> }.'
    )
    expect(said(file.TF17)).toBe(
      'offers: name at most 4 connection secrets, such as { "DATABASE_URL": "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app" }.'
    )
    expect(said(file.TF18(20))).toBe(
      "offers: a connection secret's name uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself (line 20)."
    )
    expect(said(file.TF19("DATABASE_URL"))).toBe(
      "offers.DATABASE_URL: use at most 512 characters of letters, digits and :/@?&=._%+~- with {service} and the made secrets in braces."
    )
    expect(said(file.TF20)).toBe(
      "notes: use a list of 1 to 8 sentences, each at most 200 characters and ending with a full stop."
    )
  })

  test("TF21 to TF32", () => {
    expect(said(file.TF21("db"))).toBe(
      "services.db.source.image: pin the image by digest."
    )
    expect(said(file.TF22("db"))).toBe(
      "services.db.source.image: name the image's version with a tag, such as postgres:18.7@sha256:<digest>."
    )
    expect(said(file.TF23("db"))).toBe(
      "services.db.source.image: use a Docker Official Image, or another source apps/cli/src/templates/publishers.ts lists."
    )
    expect(said(file.TF24("db"))).toBe(
      "services.db.networking.publish: a template publishes no port."
    )
    expect(said(file.TF25("db", "OTHER_SECRET"))).toBe(
      "services.db.variables.secrets: OTHER_SECRET is not made by this template. A template's services read only the secrets it makes."
    )
    expect(said(file.TF26("EXTRA_PASSWORD"))).toBe(
      "makes.EXTRA_PASSWORD: no service of this template reads it."
    )
    expect(said(file.TF27("DB_PASSWORD"))).toBe(
      "offers.DB_PASSWORD: it is the name of a made secret, or of one a service of this template reads."
    )
    expect(said(file.TF28("DATABASE_URL"))).toBe(
      "offers.DATABASE_URL: each {...} names {service} or a secret this template makes."
    )
    expect(said(file.TF29("DATABASE_URL"))).toBe(
      "offers.DATABASE_URL: build it from at least one secret this template makes."
    )
    expect(said(file.TF30("9.7.4"))).toBe(
      "software: use the version the first service's image tag names, 9.7.4, or its start before a dot, such as 9.7 for 9.7.4."
    )
    expect(said(file.TF31)).toBe(
      'notes: say "Zekno does not back up this data." when a service keeps data in a volume.'
    )
    expect(said(file.TF32("db", "data"))).toBe(
      "services.db.volumes.data: it is added as db-data, which must be a volume name of at most 63 characters."
    )
  })

  test("TC1 and TC2", () => {
    expect(said(file.TC1)).toBe(
      "name: another template has this name, or names it in its also."
    )
    expect(said(file.TC2("mongo"))).toBe(
      "also: mongo is another template's name, or in its also."
    )
  })

  test("TS: a settings place said as a path of the template file, and a later setting with its second sentence", () => {
    expect(file.templatePlace("db, source.image")).toBe(
      "services.db.source.image"
    )
    expect(file.templatePlace("db, deploy")).toBe("services.db.deploy")
    expect(file.templatePlace("db")).toBe("services.db")
    expect(file.templatePlace("db, variables.plain.A_B")).toBe(
      "services.db.variables.plain.A_B"
    )
    expect(file.templatePlace("services")).toBe("services")
    expect(said(file.laterInTemplate("domains", "db"))).toBe(
      "services.db.networking.domains: Domains are not in this version of zekno yet."
    )
    expect(said(file.laterInTemplate("build", "db"))).toBe(
      "services.db.source.build: Building from source is not in this version of zekno yet."
    )
  })
})

describe("add-words.ts: contracts/commands.md", () => {
  test("joinNames and countWord", () => {
    expect(add.joinNames(["A"])).toBe("A")
    expect(add.joinNames(["A", "B"])).toBe("A and B")
    expect(add.joinNames(["A", "B", "C"])).toBe("A, B and C")
    expect(add.joinNames(["A", "B", "C", "D"])).toBe("A, B, C and D")
    expect(
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => add.countWord(n))
    ).toEqual([
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "10",
      "12",
    ])
  })

  test("AD1 to AD28", () => {
    expect(add.AD1).toBe(
      "There is no server to keep secrets for yet. Run zekno deploy first. It sets up your team and a server."
    )
    expect(add.AD3("postgres", "demo")).toBe(
      "Add postgres to demo? Nothing is deployed until you deploy."
    )
    expect(add.AD4("zekno.app.json")).toBe(
      "Adding a template changes zekno.app.json and stores secrets. Say --yes to go ahead."
    )
    expect(add.AD5("demo", "POSTGRES_PASSWORD")).toBe(
      "demo already has a secret named POSTGRES_PASSWORD. A template can be added once to an app in this version."
    )
    expect(add.AD6("zekno.app.json", "postgres")).toBe(
      "zekno.app.json already has a service named postgres. Give this one another name with --name <service>."
    )
    expect(add.AD7("web", "DATABASE_URL")).toBe(
      "web already has a variable named DATABASE_URL. Remove it, or leave web out with --for <service>."
    )
    expect(add.AD8("zekno.app.json", "postgres")).toBe(
      "zekno.app.json changed while this was open. Nothing was added. Run zekno add postgres again."
    )
    expect(add.AD9("zekno.app.json", "postgres-data")).toBe(
      "zekno.app.json already has a volume named postgres-data. Give this one another name with --name <service>."
    )
    expect(add.AD10("DATABASE_URL")).toBe("Which services read DATABASE_URL?")
    expect(add.AD11).toBe("Pick at least one service.")
    expect(add.AD12("zekno.app.json", "DATABASE_URL")).toBe(
      "zekno.app.json has several services. Say which read DATABASE_URL with --for <service>."
    )
    expect(add.AD13).toBe(
      "This folder has no settings file. Run zekno settings init to start one, then add the template."
    )
    expect(add.AD14("zekno.app.json", "nope", ["web", "worker"])).toBe(
      "zekno.app.json has no service named nope. Its services are web, worker."
    )
    expect(add.AD14("zekno.app.json", undefined, ["web", "worker"])).toBe(
      "zekno.app.json has no such service. Its services are web, worker."
    )
    expect(add.AD14("zekno.app.json", "nope", ["web"])).toBe(
      "zekno.app.json has no service named nope. Its service is web."
    )
    expect(
      add.AD15("postgres", "zekno.app.json", {
        place: "services",
        rule: "at most 32 services.",
      })
    ).toBe(
      "postgres cannot be added to zekno.app.json. services: at most 32 services."
    )
    expect(add.AD15("postgres", "zekno.app.json", "size")).toBe(
      "postgres cannot be added to zekno.app.json. zekno.app.json would be larger than the 64 KiB a settings file may be."
    )
    expect(add.AD16("postgres", "zekno.app.json")).toBe(
      "Added postgres to zekno.app.json"
    )
    expect(add.AD17(["POSTGRES_PASSWORD", "DATABASE_URL"], "prod")).toBe(
      "Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for prod"
    )
    expect(add.AD18).toBe("Run zekno deploy to start it.")
    expect(add.AD19("postgres", "zekno.app.json")).toBe(
      "postgres was added to zekno.app.json, but its secrets could not be stored, and the file could not be put back. Remove postgres from zekno.app.json before you deploy."
    )
    expect(add.AD20).toBe(
      "The secrets could not be stored on this machine, so nothing was added."
    )
    expect(add.AD21("demo", "prod", "postgres")).toBe(
      "The secrets of demo on prod changed while this was open. Nothing was added. Run zekno add postgres again."
    )
    expect(add.AD22).toBe("Nothing was added.")
    expect(add.AD23.added("postgres", "zekno.app.json")).toBe(
      "added\tpostgres\tzekno.app.json"
    )
    expect(add.AD23.stored("POSTGRES_PASSWORD", 1)).toBe(
      "stored\tPOSTGRES_PASSWORD\t1"
    )
    expect(add.AD24("demo", "prod")).toBe(
      "demo on prod would have more than 256 secrets, more than one deploy carries. Nothing was added."
    )
    expect(add.AD25("demo", "prod")).toBe(
      "demo on prod would have more than 4096 secret records on this machine. Nothing was added."
    )
    expect(add.AD27("postgres")).toBe(
      "This zekno's template postgres does not pass its own checks. Nothing was added."
    )
    expect(add.AD28("acme-db")).toBe(
      "acme-db asks a question when it is added. Questions are not in this version of zekno yet. They come with domains."
    )
  })

  test("AU1 to AU10", () => {
    expect(add.AU1).toBe(
      "Say which template: `zekno add <template>`, or see them with `zekno add --list`."
    )
    expect(add.AU2).toBe("`zekno add --list` takes no template.")
    expect(add.AU3).toBe(
      "Say which template to show: `zekno add <template> --show`."
    )
    expect(add.AU4).toBe("Use `--list` or `--show`, not both.")
    expect(add.AU5).toBe(
      "`zekno add` takes `--json` with `--list` or `--show` only."
    )
    expect(add.AU6("list", "name")).toBe(
      "`zekno add --list` does not take `--name`."
    )
    expect(add.AU6("show", "yes")).toBe(
      "`zekno add --show` does not take `--yes`."
    )
    expect(add.AU7("force")).toBe("`zekno add` does not take `--force`.")
    expect(add.AU8).toBe(
      "That is not a service name. Use lowercase letters, digits and hyphens, starting with a letter."
    )
    expect(add.AU9("acme-db")).toBe(
      "acme-db adds several services, so it takes no --name in this version."
    )
    expect(add.AU10("compose.yaml")).toBe(
      "--for works with a settings file. With compose.yaml, add the line to each service that uses it."
    )
  })

  test("AL1 to AL4 and AV1 to AV6", () => {
    expect(add.AL1).toBe("Add which template?")
    expect(add.AL2).toBe("Template")
    expect(add.AL3("mongo", "mongodb")).toBe(
      "There is no template named mongo. Run zekno add mongodb."
    )
    expect(add.AL3("nope")).toBe(
      "There is no template named nope. Run zekno add --list to see them."
    )
    expect(add.AL4).toBe(
      "There is no template of that name. Run zekno add --list to see them."
    )
    expect(add.AV1("zekno")).toBe("By zekno.")
    expect(add.AV2.heading).toBe("Secrets")
    expect(add.AV2.made(32)).toBe("made on your machine, 32 random characters")
    expect(add.AV2.built(false)).toBe("built from it, for your own services")
    expect(add.AV2.built(true)).toBe("built from them, for your own services")
    expect(add.AV3).toBe(
      "Zekno does not back up this data. It is kept in a Docker volume on your server."
    )
    expect(add.AV4).toBe(
      "The image is the official one, pinned by digest. A newer one comes with a newer zekno."
    )
    expect(add.AV5).toBe("Nothing was changed.")
    expect(add.AV6).toBe("Good to know")
  })

  test("the summary's words (board AddTemplate)", () => {
    const words = add.SUMMARY
    expect(words.by("zekno")).toBe("by zekno")
    expect([words.app, words.server, words.file]).toEqual([
      "app",
      "server",
      "file",
    ])
    expect(words.adds(1)).toBe("Adds a service")
    expect(words.adds(2)).toBe("Adds 2 services")
    expect(words.pinned).toBe("pinned by digest")
    expect(words.restart("always")).toBe("restart always")
    expect(words.restart("on-failure")).toBe("restart on failure")
    expect(words.port(5432)).toBe("port 5432, not published")
    expect(`${words.restart("always")}${words.dot}${words.port(5432)}`).toBe(
      "restart always · port 5432, not published"
    )
    expect(words.volumes(["postgres-data"])).toBe(
      "data kept in volume postgres-data"
    )
    expect(words.volumes(["a", "b"])).toBe("volumes a, b")
    expect(words.makes(1)).toBe("Makes a secret on this machine")
    expect(words.makes(2)).toBe("Makes 2 secrets on this machine")
    expect(words.neverShown).toBe("never shown")
    expect(words.random(32)).toBe("32 random characters")
    expect(words.readBy(["postgres"])).toBe("read by postgres")
    expect(words.readBy(["web", "worker"])).toBe("read by web, worker")
    expect(words.builds(false)).toBe("Builds a secret from it")
    expect(words.builds(true)).toBe("Builds a secret from them")
    expect(words.hidden).toBe("••••")
    expect(words.note("Zekno does not back up this data.")).toBe(
      "! Zekno does not back up this data."
    )
  })

  test("AH1 to AH9", () => {
    expect(add.AH1("compose.yaml")).toBe(
      "This folder deploys from compose.yaml, a file written by hand."
    )
    expect(add.AH2).toBe("Zekno does not edit it. Add these lines yourself.")
    expect(add.AH3).toBe("Under services:")
    expect(add.AH4(["postgres-data"])).toBe("Under volumes:  postgres-data:")
    expect(add.AH4(["a", "b"])).toBe("Under volumes:  a:  b:")
    expect(add.AH5).toBe("In the environment: of each service that uses it")
    expect(add.AH6(2, "demo", "prod")).toBe(
      "Make and store its two secrets for demo on prod?"
    )
    expect(add.AH6(3, "demo", "prod")).toBe(
      "Make and store its three secrets for demo on prod?"
    )
    expect(add.AH6(1, "demo", "prod")).toBe(
      "Make and store its secret for demo on prod?"
    )
    expect(add.AH6(12, "demo", "prod")).toBe(
      "Make and store its 12 secrets for demo on prod?"
    )
    expect(add.AH8).toBe(
      "Making its secrets stores them on this machine. Say --yes to go ahead."
    )
    expect(add.AH9).toBe("No secret was made.")
  })
})

describe("no sentence holds an em dash or the word agent", () => {
  /** Every string a module exports, and what each function gives for sample arguments. */
  function sentences(module: Record<string, unknown>): string[] {
    const found: string[] = []
    const take = (value: unknown): void => {
      if (typeof value === "string") found.push(value)
      else if (typeof value === "function") {
        for (const args of [
          ["web", "db", ["a", "b"]],
          ["web", undefined, ["a"]],
          [3, "x", "y"],
          ["domains", "db"],
          ["list", "name"],
          [false],
          [true],
        ])
          try {
            take((value as (...args: unknown[]) => unknown)(...args))
          } catch {
            // A sample that does not fit the function's arguments.
          }
      } else if (typeof value === "object" && value !== null)
        for (const inner of Object.values(value)) take(inner)
    }
    for (const value of Object.values(module)) take(value)
    return found
  }

  test("file-words.ts and add-words.ts", () => {
    const all = [...sentences(file), ...sentences(add)]
    expect(all.length).toBeGreaterThan(120)
    expect(all.filter((sentence) => sentence.includes("\u2014"))).toEqual([])
    expect(all.filter((sentence) => /\bagents?\b/i.test(sentence))).toEqual([])
  })
})
