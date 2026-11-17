/**
 * Two services of one template whose volumes would be added under one name
 * (specs/012-templates, contracts/template-file.md, TF33): service `a` with
 * volume `b-c` and service `a-b` with volume `c` both give `a-b-c` in the
 * app, one volume shared by two databases. Refused when the file is read, in
 * its place in "The order of checks": after TF32, before TF26.
 */
import { describe, expect, test } from "bun:test"

import { inTemplate } from "../../src/templates/file-words"
import { isTemplate, readTemplate } from "../../src/templates/read"

const HEX = "0123456789abcdef".repeat(4)
const IMAGE = `acme:1.2.3@sha256:${HEX}`
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
/** acme-db's file as `fields`, in that order of keys. */
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

/** The sentence a text gives, as acme-db.json. */
function sentence(text: string): string {
  const read = readTemplate("acme-db.json", text)
  if (isTemplate(read)) throw new Error("a template was read")
  if (read.kind === "later") return `${read.first} ${read.second}`
  return inTemplate("acme-db", read.place, read.rule)
}

describe("TF33: no two volumes added under one name (contracts/template-file.md)", () => {
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
})
