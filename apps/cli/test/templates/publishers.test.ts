/**
 * The allowed sources of a template's image (specs/012-templates, FR-002;
 * contracts/template-file.md, "The allowed sources"; tasks T005): the four
 * images of the first set are pinned, tagged and Docker Official Images, and
 * every other way of writing an image is refused by the rule named.
 */
import { describe, expect, test } from "bun:test"

import {
  isPinned,
  PUBLISHERS,
  publisherOf,
  tagOf,
} from "../../src/templates/publishers"

const HEX = "0123456789abcdef".repeat(4)

/** The rule of contracts/template-file.md an image breaks first, as the reader checks them: TF21, TF22, TF23, or none. */
const firstRule = (image: string): string | undefined => {
  if (!isPinned(image)) return "TF21"
  if (tagOf(image) === undefined) return "TF22"
  if (publisherOf(image) === undefined) return "TF23"
  return undefined
}

describe("the images of the first set", () => {
  const FIRST = [
    [
      "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc",
      "18.7",
    ],
    [
      "mysql:9.7.4@sha256:df90258da46f6e7ff8574ff84f17618aba0765cac749928299c69fd4e7cb8ad8",
      "9.7.4",
    ],
    [
      "mongo:9.0.8@sha256:b0c835c26e5997413e985000f1013c275377cd9607761c1784d486f6dd620b7f",
      "9.0.8",
    ],
    [
      "redis:8.10.3@sha256:1f88291b4c57bdf249f02eb085a8669889b2d2954e91d4de5118a5da6b78dd53",
      "8.10.3",
    ],
  ] as const

  for (const [image, tag] of FIRST)
    test(`${image.split("@")[0]}: pinned, tagged ${tag}, a Docker Official Image`, () => {
      expect(isPinned(image)).toBe(true)
      expect(tagOf(image)).toBe(tag)
      expect(publisherOf(image)?.name).toBe("Docker Official Images")
      expect(firstRule(image)).toBeUndefined()
    })
})

describe("every other way of writing an image is refused", () => {
  const CASES: [image: string, rule: string][] = [
    // No digest: the image can change under its tag.
    ["postgres:18.7", "TF21"],
    ["acme/db:1.0", "TF21"],
    // A digest of the wrong form.
    [`postgres:18.7@sha256:${HEX.toUpperCase()}`, "TF21"],
    [`postgres:18.7@sha256:${HEX.slice(1)}`, "TF21"],
    // No tag: the version is not named.
    [`postgres@sha256:${HEX}`, "TF22"],
    // Another source, or Docker's own one written out.
    [`library/postgres:18.7@sha256:${HEX}`, "TF23"],
    [`docker.io/library/postgres:18.7@sha256:${HEX}`, "TF23"],
    [`ghcr.io/acme/db:1@sha256:${HEX}`, "TF23"],
    [`localhost:5000/postgres:18.7@sha256:${HEX}`, "TF23"],
    [`Postgres:18.7@sha256:${HEX}`, "TF23"],
  ]

  for (const [image, rule] of CASES)
    test(`${image}: ${rule}`, () => {
      expect(firstRule(image)).toBe(rule)
    })
})

describe("the list itself", () => {
  test("one source, Docker Official Images, docker.io/library", () => {
    expect(
      PUBLISHERS.map(({ name, registry, namespace }) => ({
        name,
        registry,
        namespace,
      }))
    ).toEqual([
      {
        name: "Docker Official Images",
        registry: "docker.io",
        namespace: "library",
      },
    ])
  })

  test("tagOf: the tag without its digest, never a registry's port", () => {
    expect(tagOf(`postgres:18.7@sha256:${HEX}`)).toBe("18.7")
    expect(tagOf("postgres")).toBeUndefined()
    expect(tagOf("localhost:5000/postgres")).toBeUndefined()
    expect(tagOf("localhost:5000/postgres:1")).toBe("1")
  })
})
