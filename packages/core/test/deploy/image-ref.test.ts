/**
 * The image reference grammar (specs/016-build-from-source, contracts/core.md
 * CO3; FR-077, item 15): a Railpack build's frontend and images, each named
 * by a registry host and a digest, and never `zekno.invalid`, which names the
 * images a runner builds (`builtImageName`).
 */
import { describe, expect, test } from "bun:test"

import {
  builtImageName,
  ImageRefSchema,
  isImageRef,
  namesReservedRegistry,
} from "../../src/deploy/builds"
import * as grammar from "../../src/deploy/image-ref"

const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`
const KEY = "c".repeat(64)

describe("CO3: a reference that reads", () => {
  test.each([
    [`ghcr.io/railwayapp/railpack-frontend@${DIGEST}`],
    [`ghcr.io/railwayapp/railpack-runtime:0.9.2@${DIGEST}`],
    [`registry.example.com:5000/team/app@${DIGEST}`],
    [`localhost/x@${DIGEST}`],
    [`localhost:1/x@${DIGEST}`],
    [`localhost:65535/x@${DIGEST}`],
    [`myhost:5000/x@${DIGEST}`],
    [`Registry.Example.com/a.b_c-d/e@${DIGEST}`],
    [`ghcr.io/x:${"t".repeat(128)}@${DIGEST}`],
    [`ghcr.io/x:_Tag.1-a@${DIGEST}`],
    [`a-b.c/x@${DIGEST}`],
    [`${"a".repeat(63)}.io/x@${DIGEST}`],
  ])("%s", (text) => {
    expect(isImageRef(text)).toBe(true)
    expect(ImageRefSchema.safeParse(text).success).toBe(true)
  })

  test("at most 255 characters", () => {
    const at = (length: number) =>
      `ghcr.io/${"a".repeat(length - 80)}@${DIGEST}`
    expect(at(255)).toHaveLength(255)
    expect(isImageRef(at(255))).toBe(true)
    expect(at(256)).toHaveLength(256)
    expect(isImageRef(at(256))).toBe(false)
  })
})

describe("CO3: a reference that is refused", () => {
  test.each([
    ["no digest", "ghcr.io/railwayapp/railpack-frontend"],
    ["a tag and no digest", "ghcr.io/railwayapp/railpack-frontend:0.9.2"],
    ["an uppercase path part", `ghcr.io/Railwayapp/x@${DIGEST}`],
    ["an empty path part", `ghcr.io/railwayapp//x@${DIGEST}`],
    ["a path ending with /", `ghcr.io/x/@${DIGEST}`],
    ["no path", `ghcr.io/@${DIGEST}`],
    ["a path part ending with a separator", `ghcr.io/x-@${DIGEST}`],
    ["two separators in a row", `ghcr.io/a..b@${DIGEST}`],
    ["a first part with no ., port or localhost", `library/node@${DIGEST}`],
    ["no host at all", `node@${DIGEST}`],
    ["LOCALHOST is not localhost", `LOCALHOST/x@${DIGEST}`],
    ["port 0", `localhost:0/x@${DIGEST}`],
    ["port 65536", `localhost:65536/x@${DIGEST}`],
    ["port 08080", `localhost:08080/x@${DIGEST}`],
    ["a port that is not a number", `localhost:http/x@${DIGEST}`],
    ["an empty port", `localhost:/x@${DIGEST}`],
    ["a host label starting with -", `-a.io/x@${DIGEST}`],
    ["a host label ending with -", `a-.io/x@${DIGEST}`],
    ["an empty host label", `a..io/x@${DIGEST}`],
    ["a host label of 64 characters", `${"a".repeat(64)}.io/x@${DIGEST}`],
    ["a host with _", `a_b.io/x@${DIGEST}`],
    ["a tag of 129 characters", `ghcr.io/x:${"t".repeat(129)}@${DIGEST}`],
    ["a tag starting with .", `ghcr.io/x:.t@${DIGEST}`],
    ["an empty tag", `ghcr.io/x:@${DIGEST}`],
    ["a digest of 63 hex", `ghcr.io/x@sha256:${"a".repeat(63)}`],
    ["a digest of 65 hex", `ghcr.io/x@sha256:${"a".repeat(65)}`],
    ["a digest in upper case", `ghcr.io/x@sha256:${"A".repeat(64)}`],
    ["another algorithm", `ghcr.io/x@sha512:${"a".repeat(64)}`],
    ["two digests", `ghcr.io/x@${DIGEST}@${DIGEST}`],
    ["a space", ` ghcr.io/x@${DIGEST}`],
    ["a line feed at the end", `ghcr.io/x@${DIGEST}\n`],
    ["the reserved registry in another case", `ZEKNO.invalid/x@${DIGEST}`],
    ["the reserved registry", `zekno.invalid/x@${DIGEST}`],
    ["the reserved registry with a port", `zekno.invalid:5000/x@${DIGEST}`],
    ["the empty text", ""],
  ])("%s", (_, text) => {
    expect(isImageRef(text)).toBe(false)
    expect(ImageRefSchema.safeParse(text).success).toBe(false)
  })

  test("text only", () => {
    for (const value of [null, 1, [], {}])
      expect(ImageRefSchema.safeParse(value).success).toBe(false)
  })
})

describe("namesReservedRegistry", () => {
  test("zekno.invalid in any case, with or without a port", () => {
    for (const host of [
      "zekno.invalid",
      "ZEKNO.INVALID",
      "Zekno.Invalid",
      "zekno.invalid:5000",
      "ZEKNO.invalid:1",
    ])
      expect([host, namesReservedRegistry(host)]).toEqual([host, true])
  })

  test("any other host", () => {
    for (const host of [
      "ghcr.io",
      "localhost",
      "invalid",
      "zekno.invalid.example.com",
      "a.zekno.invalid",
      "zekno-invalid",
      "zekno.invalid:",
    ])
      expect([host, namesReservedRegistry(host)]).toEqual([host, false])
  })
})

describe("builtImageName", () => {
  test("names the image of an app's build by its key", () => {
    expect(builtImageName("shop", KEY)).toBe(`zekno.invalid/shop:${KEY}`)
    expect(builtImageName("a", KEY)).toBe(`zekno.invalid/a:${KEY}`)
    expect(builtImageName("my-shop2", KEY)).toBe(
      `zekno.invalid/my-shop2:${KEY}`
    )
  })

  test.each([
    ["an app outside APP_NAME", "Shop", KEY],
    ["an empty app", "", KEY],
    ["an app ending with -", "shop-", KEY],
    ["a key of 63 hex", "shop", KEY.slice(1)],
    ["a key in upper case", "shop", KEY.toUpperCase()],
    ["a key that is not hex", "shop", "g".repeat(64)],
  ])("%s throws", (_, app, key) => {
    expect(() => builtImageName(app, key)).toThrow(
      expect.objectContaining({ code: "invalid_argument" })
    )
  })
})

describe("where the grammar lives", () => {
  test("builds.ts gives the very values image-ref.ts holds", () => {
    // image-ref.ts imports nothing of the library, so build-record.ts reads
    // the grammar with no import cycle (index.test.ts loads each module first).
    expect(ImageRefSchema).toBe(grammar.ImageRefSchema)
    expect(isImageRef).toBe(grammar.isImageRef)
    expect(namesReservedRegistry).toBe(grammar.namesReservedRegistry)
  })
})
