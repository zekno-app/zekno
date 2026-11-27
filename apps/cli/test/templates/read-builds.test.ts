/**
 * A template's service runs an image, never a build (specs/012-templates;
 * specs/016-build-from-source, CL1). Since feature 016 a settings file's
 * service may build instead of naming an image, and a template's services
 * are held to the settings file's rules: a template whose service builds is
 * refused as one whose image is not pinned (TF21), and a fault of the build
 * settings is said at the service's place by its line's id until the words
 * tasks (FR-092). Checked by which line is said, never by words.
 */
import { describe, expect, test } from "bun:test"

import { TF21 } from "../../src/templates/file-words"
import { isTemplate, readTemplate } from "../../src/templates/read"
import type { TemplateFault } from "../../src/templates/types"

const HEX = "0123456789abcdef".repeat(4)
const IMAGE = `acme:1.2.3@sha256:${HEX}`
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
/** acme-db's file with `db` as given, its other fields good. */
const withDb = (db: Record<string, unknown>): string =>
  json({
    template: 1,
    name: "acme-db",
    title: "Acme DB",
    about: "A test database.",
    software: "1.2",
    author: "zekno",
    services: { db },
    makes: { DB_PASSWORD: { kind: "password", length: 32 } },
    notes: ["Zekno does not back up this data."],
  })

/** The fault a text gives, or the test fails. */
function faultOf(text: string): TemplateFault {
  const read = readTemplate("acme-db.json", text)
  if (isTemplate(read)) throw new Error("a template was read")
  return read
}

describe("a template's service that builds (specs/016-build-from-source)", () => {
  test("a good service with its image still reads", () => {
    const read = readTemplate(
      "acme-db.json",
      withDb({
        source: { image: IMAGE },
        variables: { secrets: ["DB_PASSWORD"] },
      })
    )
    expect(isTemplate(read)).toBe(true)
  })

  test("a build in place of the image is TF21, at the service's image", () => {
    const fault = faultOf(
      withDb({
        build: { builder: "dockerfile" },
        variables: { secrets: ["DB_PASSWORD"] },
      })
    )
    expect(fault).toMatchObject({ kind: "form", ...TF21("db") })
  })

  test("a fault of the build settings is said by its line's id, at the service's place", () => {
    // An image and a build: C25.
    expect(
      faultOf(
        withDb({
          source: { image: IMAGE },
          build: { builder: "dockerfile" },
        })
      )
    ).toMatchObject({ kind: "form", place: "services.db", rule: "C25" })
    // Neither an image nor a build: C26.
    expect(faultOf(withDb({ deploy: { restart: "always" } }))).toMatchObject({
      kind: "form",
      place: "services.db",
      rule: "C26",
    })
    // A root with no build: an id of its own until its row is written.
    expect(
      faultOf(withDb({ source: { image: IMAGE, root: "app" } }))
    ).toMatchObject({ kind: "form", place: "services.db", rule: "needs_build" })
  })
})
