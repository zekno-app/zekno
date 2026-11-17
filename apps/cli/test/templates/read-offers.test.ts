/**
 * A connection secret points at `{service}` and nowhere else
 * (specs/012-templates, contracts/template-file.md, TF34; security review
 * T5): it carries a made password to the user's own services, so a template
 * may not send them to another host. `{service}` once, as the whole host of
 * the address: right after `//` or `@`, followed by `:`, `/`, `?` or the
 * end, inside the authority and with no `@` after it. Refused when the file
 * is read, in its place in "The order of checks": after TF29, before TF30.
 * The faulty files of test/support/template-files.ts give its sentence too.
 */
import { describe, expect, test } from "bun:test"

import { inTemplate } from "../../src/templates/file-words"
import { isTemplate, readTemplate } from "../../src/templates/read"
import { FIRST_SET } from "../support/template-files"

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

describe("TF34: a connection secret points at {service} and nowhere else (security review T5)", () => {
  test("the first set passes as it is", () => {
    for (const [name, text] of Object.entries(FIRST_SET))
      expect([name, isTemplate(readTemplate(`${name}.json`, text))]).toEqual([
        name,
        true,
      ])
  })

  test("8: TF29 before TF34, TF34 before TF30, and TF34 for the first offer that breaks it, in the order of the text", () => {
    const offers = (DATABASE_URL: string) => ({
      ...GOOD_FIELDS,
      offers: { DATABASE_URL, CACHE_URL: "acme://{DB_PASSWORD}@db.example" },
      software: "9.9",
    })
    expect(sentence(file(offers("acme://app@db.example")))).toBe(
      "acme-db offers.DATABASE_URL: build it from at least one secret this template makes."
    )
    expect(sentence(file(offers("acme://{DB_PASSWORD}@{service}")))).toBe(
      "acme-db offers.CACHE_URL: a connection secret points at {service} and nowhere else."
    )
    expect(
      sentence(
        file({
          ...offers("acme://{DB_PASSWORD}@{service}"),
          offers: { DATABASE_URL: "acme://{DB_PASSWORD}@{service}" },
        })
      )
    ).toBe(
      "acme-db software: use the version the first service's image tag names, 1.2.3, or its start before a dot, such as 9.7 for 9.7.4."
    )
  })

  test("{service} as the whole host, right after // or @, followed by :, /, ? or the end", () => {
    const reads = (offer: string) =>
      isTemplate(
        readTemplate(
          "acme-db.json",
          file({ ...GOOD_FIELDS, offers: { DATABASE_URL: offer } })
        )
      )
    for (const offer of [
      "acme://{service}?k={DB_PASSWORD}",
      "acme://{service}/{DB_PASSWORD}",
      "acme://{service}:1/x?y={DB_PASSWORD}",
      "acme://a:{DB_PASSWORD}@{service}",
      "acme://a:{DB_PASSWORD}@{service}:1",
      "acme://a:{DB_PASSWORD}@{service}/db",
      "acme://a@b:{DB_PASSWORD}@{service}?x=y",
      "a:{DB_PASSWORD}@{service}:1",
    ])
      expect([offer, reads(offer)]).toEqual([offer, true])
    for (const offer of [
      "acme://{DB_PASSWORD}",
      "{service}:{DB_PASSWORD}",
      "acme://x{service}:{DB_PASSWORD}",
      "acme://{service}x:{DB_PASSWORD}",
      "acme://{service}-x:{DB_PASSWORD}",
      "acme://{service}.x:{DB_PASSWORD}",
      "acme://{service}&{DB_PASSWORD}",
      "acme://{service}@x/{DB_PASSWORD}",
      "acme://{service}:1@x/{DB_PASSWORD}",
      "acme://x/y@{service}:1/{DB_PASSWORD}",
      "acme://x?y@{service}:1/{DB_PASSWORD}",
      "acme://{DB_PASSWORD}@{service}/a?b=c@d",
      "acme://{DB_PASSWORD}@{service}{service}",
      "acme://{DB_PASSWORD}@{service}/{service}",
    ])
      expect([offer, reads(offer)]).toEqual([offer, false])
  })
})
