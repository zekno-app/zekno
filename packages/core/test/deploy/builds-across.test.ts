/**
 * The builds' rules across fields (specs/016-build-from-source,
 * contracts/core.md CO2; FR-012, FR-022, FR-023, FR-036e, FR-077, item 15),
 * which F6 applies: each rule broken by one change from a deploy that keeps
 * them all, and read `malformed`.
 */
import { describe, expect, test } from "bun:test"

import { builtImageName, type Build } from "../../src/deploy/builds"
import { readDeployV2Payload } from "../../src/deploy/message"
import { LIMITS } from "../../src/protocol/limits"
import {
  build,
  composeFor,
  hex,
  pack,
  payload,
  railpackBuild,
} from "../support/payload-v2"

/** What a deploy whose builds are all Dockerfile builds with no secret reads as: carried out at step 1 (CO7). */
const GOOD = "read"
/** What a deploy with a build this step does not carry out reads as, when it keeps every rule (CO7). */
const LATER = "unsupported_version"

const code = (json: unknown) => {
  const read = readDeployV2Payload(json)
  return read.ok ? "read" : read.error.code
}

const DATABASE_URL = { name: "DATABASE_URL", hash: hex(3), version: 3 }
const NPM_TOKEN = { name: "NPM_TOKEN", hash: hex(4), version: 1 }

/** Builds with distinct keys, sorted by key, as a deploy lists them. */
const sortedByKey = (builds: Build[]) =>
  [...builds].sort((a, b) => (a.key < b.key ? -1 : 1))

const web = build({ pack: { hash: hex(100), size: 1, chunks: [hex(101)] } })
const worker = build({
  pack: { hash: hex(200), size: 1, chunks: [hex(201)] },
  builder: {
    name: "dockerfile",
    dockerfile: "worker/Dockerfile",
    target: null,
  },
})
const TWO = sortedByKey([web, worker])

/** The deploy of `shop` at 42 with two builds, the Compose text naming both, changed by `change`. */
const shop = (change: Record<string, unknown> = {}) =>
  code(
    payload({ app: "shop", secrets: [DATABASE_URL], builds: TWO, ...change })
  )

/** The last character of a key changed to another hex digit. */
const offByOne = (key: string) =>
  key.slice(0, -1) + (key.endsWith("0") ? "1" : "0")

describe("CO2: the deploy that keeps every rule", () => {
  test("reads", () => {
    expect(shop()).toBe(GOOD)
    expect(composeFor("shop", TWO)).toContain(builtImageName("shop", web.key))
  })
})

describe("CO2: builds sorted by key, each key once", () => {
  test("two builds in reverse order", () => {
    expect(shop({ builds: [TWO[1], TWO[0]] })).toBe("malformed")
  })

  test("one key twice", () => {
    expect(shop({ builds: [TWO[0], TWO[0]] })).toBe("malformed")
    // Two services built with the same key share one entry (FR-012), even with other pieces.
    const again = { ...TWO[0]!, pack: { ...TWO[0]!.pack, chunks: [hex(9)] } }
    expect(shop({ builds: [TWO[0], again] })).toBe("malformed")
  })
})

describe("CO2: each key equal to buildKey (FR-023)", () => {
  test("a key off by one digit", () => {
    const [first, second] = TWO
    expect(
      shop({ builds: [{ ...first!, key: offByOne(first!.key) }, second] })
    ).toBe("malformed")
  })
})

describe("CO2: the deploy's secrets and the builds'", () => {
  const reading = build({ secrets: ["NPM_TOKEN"] }, [NPM_TOKEN])

  test("a build secret not listed", () => {
    expect(
      shop({ secrets: [DATABASE_URL, NPM_TOKEN], builds: [reading] })
    ).toBe(LATER)
    expect(shop({ secrets: [DATABASE_URL], builds: [reading] })).toBe(
      "malformed"
    )
  })

  test("an argument named like a secret the deploy lists (FR-036e)", () => {
    const named = build({ args: [{ name: "DATABASE_URL", value: "x" }] })
    expect(shop({ secrets: [NPM_TOKEN], builds: [named] })).toBe(GOOD)
    expect(shop({ secrets: [DATABASE_URL, NPM_TOKEN], builds: [named] })).toBe(
      "malformed"
    )
  })
})

describe("CO2: the pieces", () => {
  test("at most 64 distinct code pieces across all builds", () => {
    expect(LIMITS.chunksPerDeploy).toBe(64)
    const first = build({ pack: pack(33, 1000) })
    const builds = (second: Build) => sortedByKey([first, second])
    expect(shop({ builds: builds(build({ pack: pack(31, 2000) })) })).toBe(GOOD)
    expect(shop({ builds: builds(build({ pack: pack(32, 2000) })) })).toBe(
      "malformed"
    )
    // The same pieces in two builds count once.
    const shared = build({ pack: { ...pack(33, 1000), hash: hex(3000) } })
    expect(shop({ builds: builds(shared) })).toBe(GOOD)
  })

  test("a plan piece is never a code piece", () => {
    const rail = (piece: string) =>
      railpackBuild({
        builder: {
          ...railpackBuild().builder,
          plan: { hash: hex(113), size: 1, piece },
        } as Build["builder"],
      })
    expect(shop({ builds: sortedByKey([web, rail(hex(114))]) })).toBe(LATER)
    // Another build's code piece, and its own.
    expect(shop({ builds: sortedByKey([web, rail(hex(101))]) })).toBe(
      "malformed"
    )
    const own = rail(railpackBuild().pack.chunks[0]!)
    expect(shop({ builds: [own] })).toBe("malformed")
  })
})

describe("CO2: argument values take at most 64 KiB in all", () => {
  test("64 KiB of values, then one byte more", () => {
    expect(LIMITS.argBytesPerDeploy).toBe(64 * 1024)
    const full = (count: number, from: number) =>
      Array.from({ length: count }, (_, n) => ({
        name: `A${String(from + n).padStart(3, "0")}`,
        value: "a".repeat(LIMITS.argValueBytes),
      }))
    const builds = (extra: { name: string; value: string }[]) =>
      sortedByKey([
        build({ pack: pack(1, 100), args: full(8, 0) }),
        build({ pack: pack(1, 200), args: [...full(8, 0), ...extra] }),
      ])
    expect(shop({ builds: builds([]) })).toBe(GOOD)
    expect(shop({ builds: builds([{ name: "B", value: "a" }]) })).toBe(
      "malformed"
    )
  })
})

describe("CO2: fresh at most the deploy's sequence (FR-021a)", () => {
  test("sequence reads, sequence + 1 does not", () => {
    const at = (fresh: number) => [build({ fresh })]
    expect(shop({ sequence: 42, builds: at(42) })).toBe(GOOD)
    expect(shop({ sequence: 42, builds: at(43) })).toBe("malformed")
    expect(shop({ previous: 42, sequence: 43, builds: at(43) })).toBe(GOOD)
  })
})

describe("CO2: the Compose text runs each build's image, and no other under zekno.invalid (FR-022, FR-077)", () => {
  const [first, second] = TWO
  const name = (key: string) => builtImageName("shop", key)
  const withCompose = (compose: string) => shop({ compose })
  const both = composeFor("shop", TWO)

  test("as zekno writes it", () => {
    expect(withCompose(both)).toBe(GOOD)
    // Each name may be written more than once.
    expect(withCompose(`${both}${composeFor("shop", [first!])}`)).toBe(GOOD)
  })

  test("missing one build's name", () => {
    expect(withCompose(composeFor("shop", [first!]))).toBe("malformed")
    expect(withCompose(composeFor("shop", [second!]))).toBe("malformed")
  })

  test("naming another app's image", () => {
    expect(
      withCompose(
        `${both}  blog:\n    image: zekno.invalid/blog:${first!.key}\n`
      )
    ).toBe("malformed")
  })

  test("naming a key no build has", () => {
    expect(withCompose(`${both}  other:\n    image: ${name(hex(999))}\n`)).toBe(
      "malformed"
    )
  })

  test("holding the name in upper case, whole or in part", () => {
    for (const written of [
      name(first!.key).toUpperCase(),
      `ZEKNO.INVALID/shop:${first!.key}`,
      `Zekno.Invalid/shop:${first!.key}`,
      `zekno.invalid/SHOP:${first!.key}`,
      `zekno.invalid/shop:${first!.key.toUpperCase()}`,
    ])
      expect([
        written,
        withCompose(`${both}  other:\n    image: ${written}\n`),
      ]).toEqual([written, "malformed"])
  })

  test("holding it followed by a character that goes on a reference", () => {
    for (const next of ["0", "a", "Z", "_", ".", "-", ":", "@", "/", "é"])
      expect([
        next,
        withCompose(
          `services:\n  a:\n    image: ${name(first!.key)}${next}\n  b:\n    image: ${name(second!.key)}\n`
        ),
      ]).toEqual([next, "malformed"])
    expect(
      withCompose(
        `${both}  c:\n    image: ${name(first!.key)}@sha256:${hex(5)}\n`
      )
    ).toBe("malformed")
  })

  test("holding it after a character that goes on a reference", () => {
    // `ghcr.io/zekno.invalid/shop:<key>` is an image of ghcr.io, not the build's.
    for (const before of [
      "ghcr.io/",
      "evil.",
      "x",
      "0",
      "_",
      "-",
      ":",
      "@",
      "/",
      "é",
      // A letter outside the BMP, two code units.
      "𝐀",
    ])
      expect([
        before,
        withCompose(
          `services:\n  a:\n    image: ${before}${name(first!.key)}\n  b:\n    image: ${name(second!.key)}\n`
        ),
      ]).toEqual([before, "malformed"])
  })

  test("after the start of the text or a character that cannot go on a reference", () => {
    for (const before of ['"', "'", "\n", " ", "#", ",", "{", "[", "=", "😀"])
      expect([
        before,
        withCompose(
          `services:\n  a:\n    image: ${before}${name(first!.key)}\n  b:\n    image: ${name(second!.key)}\n`
        ),
      ]).toEqual([before, GOOD])
    expect(
      withCompose(`${name(first!.key)}\n${name(second!.key)}\nservices: {}\n`)
    ).toBe(GOOD)
  })

  test("followed by the end of the text or a character that cannot go on a reference", () => {
    for (const next of ['"', "'", "\n", " ", "#", ",", "}", "]"])
      expect([
        next,
        withCompose(
          `services:\n  a:\n    image: ${name(first!.key)}${next}\n  b:\n    image: ${name(second!.key)}`
        ),
      ]).toEqual([next, GOOD])
  })

  test("a deploy with no build names no image under zekno.invalid", () => {
    expect(shop({ builds: [], compose: "services: {}\n" })).toBe("read")
    for (const compose of [
      `services:\n  web:\n    image: ${name(first!.key)}\n`,
      "services:\n  web:\n    image: zekno.invalid/shop\n",
      "# zekno.invalid/\n",
    ])
      expect([compose, shop({ builds: [], compose })]).toEqual([
        compose,
        "malformed",
      ])
  })
})

describe("CO2, item 15: an app whose name ends with a hyphen", () => {
  test("with a build is malformed; without one, it reads as today", () => {
    const compose = `services:\n  web:\n    image: zekno.invalid/shop-:${web.key}\n`
    expect(code(payload({ app: "shop-", builds: [web], compose }))).toBe(
      "malformed"
    )
    expect(code(payload({ app: "shop-", builds: [web] }))).toBe("malformed")
    expect(code(payload({ app: "shop-" }))).toBe("read")
  })
})
