/**
 * Reading a template file (specs/012-templates, contracts/template-file.md,
 * "The order of checks" and "Sentences"; tasks T007): every good file reads
 * to its template, every faulty file gives exactly its sentence, faults come
 * in the order of the contract, no fault holds anything of the file, and the
 * reader never throws.
 */
import { describe, expect, test } from "bun:test"

import { CliError } from "../../src/cli/errors"
import { inTemplate } from "../../src/templates/file-words"
import {
  acrossTemplates,
  faultSentence,
  isTemplate,
  readTemplate,
} from "../../src/templates/read"
import type { Template, TemplateFault } from "../../src/templates/types"
import { lineOf } from "../support/settings-files"
import {
  ACME_DB_BOARD,
  BAD,
  GOOD,
  TEMPLATE_SENTINEL,
} from "../support/template-files"

/** The sentence of a fault, built as the contract says: `<name> <place>: <rule>`, or the two sentences of a later one. */
function sentenceOf(file: string, fault: TemplateFault): string {
  if (fault.kind === "later") return `${fault.first} ${fault.second}`
  const name = /^([a-z][a-z0-9-]{0,31})\.json$/.exec(file)?.[1]
  return inTemplate(name, fault.place, fault.rule)
}

/** The template a file reads to, or a failure that names its sentence. */
function template(file: string, text: string): Template {
  const read = readTemplate(file, text)
  if (!isTemplate(read))
    throw new Error(`${file} did not read: ${sentenceOf(file, read)}`)
  return read
}

/** The fault a faulty file gives: its own, or across the catalogue for TC1 and TC2. */
function faultOf(bad: (typeof BAD)[number]): TemplateFault {
  if (bad.before !== undefined) {
    const found = acrossTemplates([
      template(bad.before.file, bad.before.text),
      template(bad.file, bad.text as string),
    ])
    if (found === undefined) throw new Error("the two files do not clash")
    return found.fault
  }
  const read = readTemplate(bad.file, bad.text)
  if (isTemplate(read)) throw new Error(`${bad.file} read as a template`)
  return read
}

/** The sentence a text gives, as acme-db.json unless said. */
function sentence(text: string | Uint8Array, file = "acme-db.json"): string {
  const read = readTemplate(file, text)
  if (isTemplate(read)) throw new Error("a template was read")
  return sentenceOf(file, read)
}

const S = TEMPLATE_SENTINEL
const HEX = "0123456789abcdef".repeat(4)
const IMAGE = `acme:1.2.3@sha256:${HEX}`
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
/** acme-db's file as `fields`, in that order of keys: what a test needs and nothing else. */
const file = (fields: Record<string, unknown>): string =>
  json({ template: 1, ...fields })
const GOOD_FIELDS = {
  name: "acme-db",
  title: "Acme DB",
  about: "A test database.",
  software: "1.2",
  author: "zekno",
  services: {
    db: {
      source: { image: IMAGE },
      variables: { secrets: ["DB_PASSWORD"] },
      volumes: { data: "/var/lib/db" },
    },
  },
  makes: { DB_PASSWORD: { kind: "password", length: 32 } },
  notes: ["Zekno does not back up this data."],
}

describe("the test set", () => {
  test("a faulty file for every sentence of the contract", () => {
    const sentences = BAD.map((bad) => bad.sentence)
    for (const marker of [
      ": name a template file",
      "at most 16 KiB.",
      "is UTF-8 text.",
      "this is not JSON.",
      "the same name as line",
      "nested deeper than templates go.",
      "a text longer than 4096 characters.",
      "a template is one JSON object.",
      ...Array.from({ length: 33 }, (_, at) => `TF${at + 1}`),
      "SV2",
      "SV6",
      "SV8",
      "SV9",
      "SV28",
      "SV29",
      "SL5",
      "TC1",
      "TC2",
    ]) {
      const id = MARKERS[marker] ?? marker
      expect([marker, sentences.some((said) => said.includes(id))]).toEqual([
        marker,
        true,
      ])
    }
  })
})

/** A piece of each sentence, by its id, to find its file in the test set. */
const MARKERS: Record<string, string> = {
  TF1: "template: use 1",
  TF2: "is written for a later version of zekno.",
  TF3: "a field this zekno does not know.",
  TF4: "asks a question when it is added.",
  TF5: "a template needs this field.",
  TF6: "name: use lowercase letters",
  TF7: "use the file's own name",
  TF8: "title: use 1 to 40",
  TF9: "about: use one sentence",
  TF10: "software: use the software's version",
  TF11: "author: use a name",
  TF12: "also: use a list of at most 8",
  TF13: "services: name 1 to 8 services",
  TF14: "makes: name 1 to 16 secrets",
  TF15: "a made secret's name uses",
  TF16: 'use { "kind": "password"',
  TF17: "offers: name at most 4",
  TF18: "a connection secret's name uses",
  TF19: "use at most 512 characters",
  TF20: "notes: use a list of 1 to 8",
  TF21: "pin the image by digest.",
  TF22: "name the image's version with a tag",
  TF23: "use a Docker Official Image",
  TF24: "a template publishes no port.",
  TF25: "is not made by this template.",
  TF26: "no service of this template reads it.",
  TF27: "it is the name of a made secret",
  TF28: "each {...} names {service}",
  TF29: "build it from at least one secret",
  TF30: "use the version the first service's image tag names",
  TF31: 'say "Zekno does not back up this data."',
  TF32: "which must be a volume name of at most 63 characters.",
  TF33: ", as a volume of ",
  SV2: 'services: name at least one service, such as "web".',
  SV6: "services.db.deploy: a setting this zekno does not know",
  SV8: "use an image reference",
  SV9: "it runs without a shell",
  SV28: "a volume name is lowercase",
  SV29: "use an absolute path in the container",
  SL5: "Domains are not in this version of zekno yet.",
  TC1: "another template has this name",
  TC2: "is another template's name, or in its also.",
}

describe("every good file reads to its template", () => {
  for (const good of GOOD)
    test(`${good.file}: ${good.template.services.length} service(s), ${good.text.length} characters`, () => {
      expect(readTemplate(good.file, good.text)).toEqual(good.template)
      // The same from its bytes, and with one byte order mark before them.
      expect(readTemplate(good.file, Buffer.from(good.text))).toEqual(
        good.template
      )
      if (Buffer.byteLength(good.text) <= 16_381) {
        const bom = String.fromCharCode(0xfeff)
        expect(readTemplate(good.file, `${bom}${good.text}`)).toEqual(
          good.template
        )
      }
    })
})

describe("every faulty file gives exactly its sentence, and nothing of the file", () => {
  for (const bad of BAD)
    test(bad.sentence, () => {
      const fault = faultOf(bad)
      const said = sentenceOf(bad.file, fault)
      expect(said).toBe(bad.sentence)
      if (bad.before === undefined)
        expect(faultSentence(bad.file, fault)).toBe(said)
      expect(JSON.stringify(fault)).not.toContain(S)
      expect(said).not.toContain(S)
      const error = new CliError(said)
      expect(error.message).not.toContain(S)
      expect(error.stack ?? "").not.toContain(S)
    })

  test("the board's acme-db.json: exactly its sentence", () => {
    expect(sentence(ACME_DB_BOARD)).toBe(
      "acme-db services.db.source.image: pin the image by digest."
    )
  })
})

describe("the order of checks (contracts/template-file.md)", () => {
  const big = (text: string) => `${text}${" ".repeat(16_385)}`

  test("1 before 2: the file's name before its size", () => {
    expect(sentence(big(file(GOOD_FIELDS)), "Acme.json")).toBe(
      "Acme.json: name a template file <name>.json, its name lowercase letters, digits and hyphens, starting with a letter, at most 32 characters."
    )
  })

  test("2: the size before UTF-8, and UTF-8 before JSON", () => {
    const notUtf8 = (text: string) =>
      Uint8Array.from([...Buffer.from(text), 0xff])
    expect(sentence(notUtf8(big("{")))).toBe(
      "acme-db file: a template file is at most 16 KiB."
    )
    expect(sentence(notUtf8("{"))).toBe(
      "acme-db file: a template file is UTF-8 text."
    )
  })

  test("3 before 4: not JSON before a later version", () => {
    expect(sentence('{\n"template": 2,\n"x": }')).toBe(
      "acme-db line 3: this is not JSON."
    )
  })

  test("4 before 5: the version before a key not known that comes first", () => {
    expect(sentence(json({ [S]: 1, template: "1", asks: [] }))).toBe(
      "acme-db template: use 1, the version of templates this zekno reads."
    )
    expect(sentence(json({ services: {} }))).toBe(
      "acme-db template: use 1, the version of templates this zekno reads."
    )
    for (const version of ["1.0", "0", "-1", "1e0", "true", "null", '"1"'])
      expect(sentence(`{"template": ${version}}`)).toBe(
        "acme-db template: use 1, the version of templates this zekno reads."
      )
    expect(sentence(json({ [S]: 1, template: 3, asks: [] }))).toBe(
      "acme-db is written for a later version of zekno. Update zekno to use it."
    )
  })

  test("5 before 6, in the order of the text: a key not known or asks, whichever comes first", () => {
    const late = file({ ...GOOD_FIELDS, name: S, [S]: 1 })
    expect(sentence(late)).toBe(
      `acme-db line ${lineOf(late, `"${S}": 1`)}: a field this zekno does not know.`
    )
    expect(sentence(file({ ...GOOD_FIELDS, title: S, asks: [S] }))).toBe(
      "acme-db asks a question when it is added. Questions are not in this version of zekno yet. They come with domains."
    )
    const first = file({ [S]: 1, asks: [] })
    expect(sentence(first)).toBe(
      `acme-db line ${lineOf(first, S)}: a field this zekno does not know.`
    )
  })

  test("6 in the order of the text; a field left out after every field there", () => {
    const { about, ...noAbout } = GOOD_FIELDS
    expect(about).toBe("A test database.")
    expect(sentence(file({ about: S, ...noAbout, name: S }))).toBe(
      'acme-db about: use one sentence of at most 80 characters that ends with a full stop, such as "A relational database."'
    )
    const { title, ...noTitle } = GOOD_FIELDS
    expect(title).toBe("Acme DB")
    expect(sentence(file({ ...noTitle, notes: [S] }))).toBe(
      "acme-db notes: use a list of 1 to 8 sentences, each at most 200 characters and ending with a full stop."
    )
    const { name, notes, ...neither } = GOOD_FIELDS
    expect([name, notes.length]).toEqual(["acme-db", 1])
    // Of the fields left out, the first by the format.
    expect(sentence(file(neither))).toBe(
      "acme-db name: a template needs this field."
    )
    // A count before an entry of its object.
    const makes = Object.fromEntries(
      Array.from({ length: 17 }, (_, at) => [
        at === 0 ? S : `P${at}`,
        { kind: "password", length: 32 },
      ])
    )
    expect(sentence(file({ ...GOOD_FIELDS, makes }))).toBe(
      'acme-db makes: name 1 to 16 secrets the template makes, such as { "POSTGRES_PASSWORD": { "kind": "password", "length": 32 } }.'
    )
  })

  test("6 before 7: a field before the services", () => {
    expect(
      sentence(
        file({
          ...GOOD_FIELDS,
          services: { db: { source: { image: S } } },
          author: S,
        })
      )
    ).toBe(
      "acme-db author: use a name of letters, digits and inner hyphens, at most 39 characters, such as a GitHub user name."
    )
  })

  test("7 before 8: every settings rule of every service, then the count, before a template's own rule", () => {
    const services = {
      a: { source: { image: "acme/db:1.0" } },
      b: { source: { image: S } },
    }
    expect(sentence(file({ ...GOOD_FIELDS, services }))).toBe(
      "acme-db services.b.source.image: use an image reference, such as ghcr.io/acme/web:1.4.2."
    )
    const nine = Object.fromEntries(
      Array.from({ length: 9 }, (_, at) => [
        `s${at}`,
        { source: { image: "acme/db:1.0" } },
      ])
    )
    expect(sentence(file({ ...GOOD_FIELDS, services: nine }))).toBe(
      'acme-db services: name 1 to 8 services, such as { "postgres": { "source": { "image": "postgres:18.7@sha256:..." } } }.'
    )
  })

  test("8 in the contract's order: each image first, then the port, the secrets, the volumes, the made secrets, the offers, the version, the note", () => {
    const db = GOOD_FIELDS.services.db
    const services = {
      a: { ...db, networking: { port: 1, publish: 1 } },
      b: { source: { image: "acme/db:1.0" } },
    }
    expect(sentence(file({ ...GOOD_FIELDS, services }))).toBe(
      "acme-db services.b.source.image: pin the image by digest."
    )
    expect(
      sentence(
        file({
          ...GOOD_FIELDS,
          services: { db: { ...db, variables: { secrets: ["OTHER"] } } },
          notes: ["No note."],
        })
      )
    ).toBe(
      "acme-db services.db.variables.secrets: OTHER is not made by this template. A template's services read only the secrets it makes."
    )
    expect(
      sentence(file({ ...GOOD_FIELDS, software: "9.9", notes: ["No note."] }))
    ).toBe(
      "acme-db software: use the version the first service's image tag names, 1.2.3, or its start before a dot, such as 9.7 for 9.7.4."
    )
    expect(
      sentence(
        file({
          ...GOOD_FIELDS,
          offers: {
            DB_PASSWORD: "x{DB_PASSWORD}",
            DATABASE_URL: "{NOPE}",
          },
        })
      )
    ).toBe(
      "acme-db offers.DB_PASSWORD: it is the name of a made secret, or of one a service of this template reads."
    )
  })

  test("8: TF32 before TF33, and TF33 before TF26; the second service whose volume takes a name is said, naming the first", () => {
    const db = GOOD_FIELDS.services.db
    const LONG = `a${"b".repeat(58)}`
    const twice = (first: string, second: string) => ({
      [first]: { ...db, volumes: { "b-c": "/var/lib/db" } },
      [second]: { source: { image: IMAGE }, volumes: { c: "/data" } },
    })
    // Each added name is fine alone (a-b-c), and the two services' are one name.
    expect(
      sentence(file({ ...GOOD_FIELDS, services: twice("a", "a-b") }))
    ).toBe(
      "acme-db services.a-b.volumes.c: it is added as a-b-c, as a volume of a is."
    )
    // In the order of the text: the service written second is said.
    expect(
      sentence(
        file({
          ...GOOD_FIELDS,
          services: {
            "a-b": { ...db, volumes: { c: "/var/lib/db" } },
            a: { source: { image: IMAGE }, volumes: { "b-c": "/data" } },
          },
        })
      )
    ).toBe(
      "acme-db services.a.volumes.b-c: it is added as a-b-c, as a volume of a-b is."
    )
    // TF32 first: a name too long, though another clash follows.
    expect(
      sentence(
        file({
          ...GOOD_FIELDS,
          services: {
            ...twice("a", "a-b"),
            [LONG]: { source: { image: IMAGE }, volumes: { data: "/d" } },
          },
        })
      )
    ).toBe(
      `acme-db services.${LONG}.volumes.data: it is added as ${LONG}-data, which must be a volume name of at most 63 characters.`
    )
    // TF33 before TF26: a made secret no service reads comes after.
    expect(
      sentence(
        file({
          ...GOOD_FIELDS,
          services: twice("a", "a-b"),
          makes: {
            DB_PASSWORD: { kind: "password", length: 32 },
            EXTRA_PASSWORD: { kind: "password", length: 32 },
          },
        })
      )
    ).toBe(
      "acme-db services.a-b.volumes.c: it is added as a-b-c, as a volume of a is."
    )
    // Two services whose volumes take other names read.
    expect(
      isTemplate(
        readTemplate(
          "acme-db.json",
          file({
            ...GOOD_FIELDS,
            services: {
              a: { ...db, volumes: { "b-c": "/var/lib/db" } },
              b: { source: { image: IMAGE }, volumes: { c: "/data" } },
            },
          })
        )
      )
    ).toBe(true)
  })

  test("a settings fault names the template file's own line", () => {
    const text = file({
      ...GOOD_FIELDS,
      services: {
        db: {
          ...GOOD_FIELDS.services.db,
          deploy: { memory: "1g", [S]: 1 },
        },
      },
    })
    const fault = readTemplate("acme-db.json", text)
    const line = lineOf(text, S)
    expect(line).toBeGreaterThan(10)
    expect(fault).toEqual({
      kind: "form",
      place: "services.db.deploy",
      rule: `a setting this zekno does not know (line ${line}).`,
      line,
    })
    const secret = file({
      ...GOOD_FIELDS,
      services: {
        db: {
          ...GOOD_FIELDS.services.db,
          variables: { secrets: ["DB_PASSWORD", `${S}-x`] },
        },
      },
    })
    expect(sentence(secret)).toBe(
      `acme-db services.db.variables.secrets: a secret name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line ${lineOf(secret, S)}).`
    )
  })
})

describe("readTemplate never throws", () => {
  test("1 MiB of [ is TR2, said first", () => {
    expect(sentence("[".repeat(1 << 20))).toBe(
      "acme-db file: a template file is at most 16 KiB."
    )
    expect(sentence(Buffer.alloc(1 << 20, "["))).toBe(
      "acme-db file: a template file is at most 16 KiB."
    )
  })

  test("16 KiB of [ is nested too deep, said at once", () => {
    expect(sentence("[".repeat(16_384))).toBe(
      "acme-db line 1: nested deeper than templates go."
    )
  })

  test("a text that is not well formed is not UTF-8", () => {
    expect(sentence(`{"title": "${String.fromCharCode(0xd800)}"}`)).toBe(
      "acme-db file: a template file is UTF-8 text."
    )
  })

  /** A small linear congruential generator, seeded, so the cases are the same on every run. */
  function generator(seed: number) {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state
    }
  }

  test("random bytes, and good files with random bytes changed: 200 cases, each a template or a fault, never an exception", () => {
    const next = generator(0x5d2a)
    const goods = GOOD.map((good) => Buffer.from(good.text))
    for (let index = 0; index < 200; index++) {
      let bytes: Uint8Array
      if (index % 2 === 0) {
        bytes = Uint8Array.from({ length: next() % 2048 }, () => next() & 0xff)
      } else {
        const copy = Uint8Array.from(goods[next() % goods.length]!)
        for (let change = 0; change < 1 + (next() % 4); change++)
          copy[next() % copy.length] = next() & 0xff
        bytes = copy
      }
      let read: Template | TemplateFault | undefined
      expect(() => (read = readTemplate("acme-db.json", bytes))).not.toThrow()
      expect(read).toBeDefined()
      if (!isTemplate(read!))
        expect(typeof sentenceOf("acme-db.json", read!)).toBe("string")
    }
  })
})
