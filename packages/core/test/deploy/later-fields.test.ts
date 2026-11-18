/**
 * Builds and the build key (contracts/message.md, F20 to F30), read through
 * `readDeployV2Payload`: a later field that keeps every rule is refused
 * `unsupported_version` (F7), one that breaks a rule `malformed` first. So
 * "passes" below means `unsupported_version`. The pre-deploy command, the
 * health check and routes are in routes-and-checks.test.ts.
 */
import { describe, expect, test } from "bun:test"

import { toHex, utf8 } from "../../src/crypto/encoding"
import { hash } from "../../src/crypto/hash"
import { buildKey } from "../../src/deploy/later-fields"
import { readDeployV2Payload } from "../../src/deploy/message"
import { LIMITS } from "../../src/protocol/limits"
import {
  build,
  hex,
  KiB,
  listed,
  MiB,
  pack,
  payload,
} from "../support/payload-v2"

const PASSES = "unsupported_version"

const code = (json: unknown) => {
  const read = readDeployV2Payload(json)
  return read.ok ? "read" : read.error.code
}

/** A deploy with these builds beside these secrets. */
const withBuilds = (
  builds: unknown[],
  secrets: ReturnType<typeof listed> = []
) => code(payload({ secrets, builds }))

const arg = (n: number, value = "x") => ({
  name: `A${String(n).padStart(3, "0")}`,
  value,
})

describe("F20 to F30: builds", () => {
  test("at most 8 builds in a deploy", () => {
    const builds = (count: number) =>
      Array.from({ length: count }, (_, n) =>
        build({ pack: { hash: hex(1), size: 1, chunks: [hex(300 + n)] } })
      )
    expect(withBuilds(builds(LIMITS.buildsPerDeploy))).toBe(PASSES)
    expect(withBuilds(builds(LIMITS.buildsPerDeploy + 1))).toBe("malformed")
  })

  test("a build is a strict object", () => {
    const good = build()
    expect(withBuilds([{ ...good, cache: true }])).toBe("malformed")
    const { timeout: _timeout, ...missing } = good
    expect(withBuilds([missing])).toBe("malformed")
    expect(withBuilds([{ ...good, pack: { ...good.pack, url: "x" } }])).toBe(
      "malformed"
    )
  })

  test("F21: the key is 64 hex digits and equal to buildKey", () => {
    const good = build()
    expect(withBuilds([good])).toBe(PASSES)
    const last = good.key.at(-1) === "0" ? "1" : "0"
    expect(withBuilds([{ ...good, key: good.key.slice(0, -1) + last }])).toBe(
      "malformed"
    )
    expect(withBuilds([{ ...good, key: good.key.toUpperCase() }])).toBe(
      "malformed"
    )
  })

  test("F22, F23: the pack's hash, and a size from 1 byte to 512 MiB", () => {
    expect(withBuilds([build({ pack: { ...pack(1), size: 1 } })])).toBe(PASSES)
    expect(withBuilds([build({ pack: { ...pack(1), size: 0 } })])).toBe(
      "malformed"
    )
    expect(withBuilds([build({ pack: pack(64) })])).toBe(PASSES)
    expect(LIMITS.packBytes).toBe(512 * MiB)
    expect(
      withBuilds([build({ pack: { ...pack(64), size: LIMITS.packBytes + 1 } })])
    ).toBe("malformed")
    expect(withBuilds([build({ pack: { ...pack(1), size: 1.5 } })])).toBe(
      "malformed"
    )
    expect(withBuilds([build({ pack: { ...pack(1), hash: "abc" } })])).toBe(
      "malformed"
    )
  })

  test("F24: 1 to 64 chunks, exactly ceil(size / 8 MiB) of them", () => {
    expect(withBuilds([build({ pack: { ...pack(1), chunks: [] } })])).toBe(
      "malformed"
    )
    expect(
      withBuilds([build({ pack: { ...pack(3), size: 16 * MiB + 1 } })])
    ).toBe(PASSES)
    expect(withBuilds([build({ pack: { ...pack(3), size: 16 * MiB } })])).toBe(
      "malformed"
    )
    expect(
      withBuilds([build({ pack: { ...pack(2), size: 16 * MiB + 1 } })])
    ).toBe("malformed")
    expect(
      withBuilds([build({ pack: { ...pack(1), chunks: ["A".repeat(64)] } })])
    ).toBe("malformed")
    // A chunk may repeat within one build: part 5 says nothing against it.
    expect(
      withBuilds([
        build({
          pack: { hash: hex(1), size: 16 * MiB, chunks: [hex(7), hex(7)] },
        }),
      ])
    ).toBe(PASSES)
  })

  test("F24 and F6: at most 64 distinct chunks across all builds of a deploy", () => {
    const first = build({ pack: pack(33, 1000) })
    expect(withBuilds([first, build({ pack: pack(31, 2000) })])).toBe(PASSES)
    expect(withBuilds([first, build({ pack: pack(32, 2000) })])).toBe(
      "malformed"
    )
    // The same chunks in two builds count once.
    expect(withBuilds([first, build({ pack: pack(33, 1000) })])).toBe(PASSES)
  })

  test("F25: the Dockerfile's path", () => {
    for (const dockerfile of [
      "Dockerfile",
      "docker/Dockerfile.prod",
      "a".repeat(LIMITS.dockerfileLength),
    ])
      expect([dockerfile, withBuilds([build({ dockerfile })])]).toEqual([
        dockerfile,
        PASSES,
      ])
    for (const dockerfile of [
      "",
      "a".repeat(LIMITS.dockerfileLength + 1),
      "/Dockerfile",
      "../Dockerfile",
      "a/../Dockerfile",
      "./Dockerfile",
      "a\\Dockerfile",
      "Docker\u0000file",
      "Docker\nfile",
      "Docker\u202efile",
      "Docker\u200bfile",
      "Docker\u2028file",
      "Docker\ud800file",
    ])
      expect([dockerfile, withBuilds([build({ dockerfile })])]).toEqual([
        dockerfile,
        "malformed",
      ])
  })

  test("F26: the target", () => {
    for (const target of [null, "build", "a", `a${"b".repeat(62)}`, "x.y_z-1"])
      expect(withBuilds([build({ target })])).toBe(PASSES)
    for (const target of ["", `a${"b".repeat(63)}`, ".x", "-x", "a b", "a/b"])
      expect([target, withBuilds([build({ target })])]).toEqual([
        target,
        "malformed",
      ])
  })

  test("F27: build arguments, each and all", () => {
    const args = (count: number) =>
      Array.from({ length: count }, (_, n) => arg(n))
    expect(withBuilds([build({ args: args(LIMITS.argsPerBuild) })])).toBe(
      PASSES
    )
    expect(withBuilds([build({ args: args(LIMITS.argsPerBuild + 1) })])).toBe(
      "malformed"
    )
    const limit = LIMITS.argValueBytes
    expect(limit).toBe(4 * KiB)
    for (const value of ["", "a".repeat(limit), `${"a".repeat(limit - 3)}€`])
      expect(withBuilds([build({ args: [{ name: "A", value }] })])).toBe(PASSES)
    for (const value of [
      "a".repeat(limit + 1),
      `${"a".repeat(limit - 2)}€`,
      "a\u0000b",
      "a\ud800",
    ])
      expect(withBuilds([build({ args: [{ name: "A", value }] })])).toBe(
        "malformed"
      )
    for (const name of [
      "HTTP_PROXY",
      "https_proxy",
      "BUILDKIT_INLINE_CACHE",
      "PATH",
      "1A",
      "A-B",
      "A".repeat(129),
    ])
      expect([
        name,
        withBuilds([build({ args: [{ name, value: "x" }] })]),
      ]).toEqual([name, "malformed"])
    expect(
      withBuilds([build({ args: [{ name: "A".repeat(128), value: "x" }] })])
    ).toBe(PASSES)
    expect(withBuilds([build({ args: [arg(2), arg(1)] })])).toBe("malformed")
    expect(withBuilds([build({ args: [arg(1), arg(1, "y")] })])).toBe(
      "malformed"
    )
    const loose = { name: "A", value: "x", secret: true }
    expect(withBuilds([build({ args: [loose] })])).toBe("malformed")
  })

  test("F27 and F6: all values of a deploy are at most 64 KiB", () => {
    const full = (count: number) =>
      Array.from({ length: count }, (_, n) =>
        arg(n, "a".repeat(LIMITS.argValueBytes))
      )
    expect(LIMITS.argBytesPerDeploy).toBe(64 * KiB)
    expect(withBuilds([build({ args: full(16) })])).toBe(PASSES)
    expect(withBuilds([build({ args: [...full(16), arg(99, "a")] })])).toBe(
      "malformed"
    )
    // Across builds too.
    const half = full(8)
    expect(withBuilds([build({ args: half }), build({ args: half })])).toBe(
      PASSES
    )
    expect(
      withBuilds([
        build({ args: half }),
        build({ args: [...half, arg(99, "a")] }),
      ])
    ).toBe("malformed")
  })

  test("F28: the secrets a build reads", () => {
    const secrets = listed(LIMITS.buildSecretsPerBuild + 1)
    const names = secrets.map((secret) => secret.name)
    // A key is computed only for a build whose secrets are all listed; the others are refused before their key counts.
    const reading = (read: string[]) =>
      withBuilds(
        [
          build(
            {
              secrets: read,
              key: read.every((name) => names.includes(name))
                ? undefined
                : hex(0),
            },
            secrets
          ),
        ],
        secrets
      )
    expect(reading(names.slice(0, LIMITS.buildSecretsPerBuild))).toBe(PASSES)
    expect(reading(names)).toBe("malformed")
    expect(reading([names[1]!, names[0]!])).toBe("malformed")
    expect(reading([names[0]!, names[0]!])).toBe("malformed")
    expect(reading(["1A"])).toBe("malformed")
    // A build secret the deploy does not list.
    expect(
      withBuilds(
        [
          build({ secrets: ["NPM_TOKEN"] }, [
            { name: "NPM_TOKEN", hash: hex(9) },
          ]),
        ],
        listed(1)
      )
    ).toBe("malformed")
  })

  test("F29, F30: the network and the time limit", () => {
    for (const network of ["default", "none"] as const)
      expect(withBuilds([build({ network })])).toBe(PASSES)
    for (const network of ["host", "", "bridge"])
      expect(withBuilds([build({ network: network as "none" })])).toBe(
        "malformed"
      )
    for (const timeout of [1, LIMITS.buildSeconds])
      expect(withBuilds([build({ timeout })])).toBe(PASSES)
    for (const timeout of [0, LIMITS.buildSeconds + 1, 1.5, -1])
      expect(withBuilds([build({ timeout })])).toBe("malformed")
  })
})

describe("the build key (F21)", () => {
  test("is the domain's hash of the JSON of its array, for the design's part 3.2 build", () => {
    const secrets = [{ name: "DATABASE_URL", hash: hex(3) }]
    const recipe = {
      pack: {
        hash: hex(10),
        size: 18874368,
        chunks: [hex(11), hex(12), hex(13)],
      },
      dockerfile: "Dockerfile",
      target: null,
      args: [{ name: "NODE_ENV", value: "production" }],
      secrets: [],
      network: "default" as const,
      timeout: 1800,
    }
    const written = `["${hex(10)}","Dockerfile",null,[["NODE_ENV","production"]],[],"default"]`
    expect(buildKey(recipe, secrets)).toBe(
      toHex(hash("zekno/v1/build", utf8(written)))
    )
  })

  test("names each build secret with the hash the deploy lists for it", () => {
    const secrets = [
      { name: "NPM_TOKEN", hash: hex(8) },
      { name: "OTHER", hash: hex(9) },
    ]
    const recipe = {
      pack: { hash: hex(10), size: 1, chunks: [hex(11)] },
      dockerfile: "web/Dockerfile",
      target: "prod",
      args: [],
      secrets: ["NPM_TOKEN"],
      network: "none" as const,
      timeout: 60,
    }
    const written = `["${hex(10)}","web/Dockerfile","prod",[],[["NPM_TOKEN","${hex(8)}"]],"none"]`
    expect(buildKey(recipe, secrets)).toBe(
      toHex(hash("zekno/v1/build", utf8(written)))
    )
    // A new value of the secret gives a new key.
    expect(buildKey(recipe, [{ name: "NPM_TOKEN", hash: hex(7) }])).not.toBe(
      buildKey(recipe, secrets)
    )
  })

  test("refuses a build secret the deploy does not list", () => {
    expect(() =>
      buildKey(
        {
          pack: { hash: hex(1) },
          dockerfile: "Dockerfile",
          target: null,
          args: [],
          secrets: ["NPM_TOKEN"],
          network: "default",
        },
        []
      )
    ).toThrow(expect.objectContaining({ code: "invalid_argument" }))
  })
})
