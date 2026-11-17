/**
 * Made secrets and connection secrets (specs/012-templates, research R6;
 * data-model.md, "A made value"; tasks T013): letters and digits from the
 * system's random source, every character equally likely; an offer filled
 * with the made values for storing, and shown with `••••` in their place,
 * never with a value.
 */
import { describe, expect, test } from "bun:test"

import {
  ALPHABET,
  fillOffer,
  makePassword,
  shownOffer,
} from "../../src/templates/made"
import { FIRST_TEMPLATES } from "../support/template-files"

const postgres = FIRST_TEMPLATES.postgres!
const offer = postgres.offers[0]!

describe("makePassword", () => {
  test("32 characters of A-Z, a-z and 0-9", () => {
    expect(ALPHABET).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    )
    for (let index = 0; index < 50; index++)
      expect(makePassword(32)).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(makePassword(24)).toHaveLength(24)
    expect(makePassword(64)).toHaveLength(64)
  })

  test("with a stand-in random source: the bytes 248 to 255 are skipped, every other maps to ALPHABET[byte % 62]", () => {
    const bytes = [255, 0, 248, 61, 62, 249, 247, 123, 250, 251, 252, 253, 254]
    let at = 0
    const random = (into: Uint8Array) => {
      for (let index = 0; index < into.length; index++)
        into[index] = bytes[at++ % bytes.length]!
    }
    expect(makePassword(6, random)).toBe(
      [0, 61, 62, 247, 123, 0].map((byte) => ALPHABET[byte % 62]).join("")
    )
  })

  test("a source that only gives bytes thrown away stops with a sentence, never loops for ever", () => {
    expect(() => makePassword(32, (into) => into.fill(255))).toThrow(
      "The random source gave no usable byte."
    )
  })

  test("over 200,000 characters from the real source, each of the 62 appears between 0.9 and 1.1 times its expected count", () => {
    const counts = new Map<string, number>()
    for (let index = 0; index < 200_000 / 50; index++)
      for (const char of makePassword(50))
        counts.set(char, (counts.get(char) ?? 0) + 1)
    expect(counts.size).toBe(62)
    const expected = 200_000 / 62
    for (const [char, count] of counts) {
      expect([char, count >= expected * 0.9]).toEqual([char, true])
      expect([char, count <= expected * 1.1]).toEqual([char, true])
    }
  })
})

describe("fillOffer and shownOffer", () => {
  const made = new Map([["POSTGRES_PASSWORD", "Abc123"]])

  test("fillOffer: {service} is the service's name in the app, each {NAME} its made value", () => {
    expect(fillOffer(offer, "db", made)).toBe(
      "postgres://app:Abc123@db:5432/app"
    )
    expect(fillOffer(offer, "postgres", made)).toBe(
      "postgres://app:Abc123@postgres:5432/app"
    )
    const mysql = FIRST_TEMPLATES.mysql!.offers[0]!
    expect(
      fillOffer(
        mysql,
        "mysql",
        new Map([
          ["MYSQL_ROOT_PASSWORD", "Root1"],
          ["MYSQL_PASSWORD", "App1"],
        ])
      )
    ).toBe("mysql://app:App1@mysql:3306/app")
  })

  test("shownOffer: the pieces, •••• hidden in place of each made value", () => {
    expect(shownOffer(offer, "postgres")).toEqual([
      { text: "postgres://app:", hidden: false },
      { text: "••••", hidden: true },
      { text: "@postgres:5432/app", hidden: false },
    ])
    expect(shownOffer({ name: "X", text: "{A}{B}:{service}" }, "db")).toEqual([
      { text: "••••", hidden: true },
      { text: "••••", hidden: true },
      { text: ":db", hidden: false },
    ])
  })

  test("a made value never appears in what is shown", () => {
    const value = makePassword(32)
    const filled = fillOffer(
      offer,
      "postgres",
      new Map([["POSTGRES_PASSWORD", value]])
    )
    expect(filled).toContain(value)
    const shown = JSON.stringify(shownOffer(offer, "postgres"))
    expect(shown).not.toContain(value)
    expect(shown).not.toContain("POSTGRES_PASSWORD")
  })
})
