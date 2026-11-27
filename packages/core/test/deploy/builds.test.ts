/**
 * The build entry (specs/016-build-from-source, contracts/core.md CO1; FR-008,
 * FR-021, FR-021a, FR-024), each row of its table at its edges for both
 * builders, read through `readDeployV2Payload`: a build that breaks a rule is
 * `malformed`. A build that keeps every rule "passes": it reads, unless this
 * step does not carry it out (CO7), when it is `unsupported_version`. Each
 * builder's own fields are in builds-builder.test.ts, the key in
 * build-key.test.ts, the rules across fields in builds-across.test.ts.
 */
import { describe, expect, test } from "bun:test"

import type { Build } from "../../src/deploy/builds"
import { readDeployV2Payload } from "../../src/deploy/message"
import { LIMITS } from "../../src/protocol/limits"
import {
  build,
  hex,
  keyed,
  KiB,
  listed,
  MiB,
  pack,
  payload,
  railpackBuild,
} from "../support/payload-v2"

/** What a Dockerfile build with no secret that keeps every rule reads as: carried out at step 1 (CO7). */
const DOCKERFILE_PASSES = "read"
/** What a Railpack build that keeps every rule reads as: refused until step 2 (CO7). */
const RAILPACK_PASSES = "unsupported_version"

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

/** Both builders, each with what a build of it that keeps every rule reads as. */
const BUILDERS = [
  ["a Dockerfile build", build, DOCKERFILE_PASSES],
  ["a Railpack build", railpackBuild, RAILPACK_PASSES],
] as const

/** Builds with distinct keys, sorted by key, as a deploy lists them. */
const sortedByKey = (builds: Build[]) =>
  [...builds].sort((a, b) => (a.key < b.key ? -1 : 1))

describe("CO1: the payload's builds", () => {
  test("at most 8 builds in a deploy", () => {
    const builds = (count: number) =>
      sortedByKey(
        Array.from({ length: count }, (_, n) =>
          build({ pack: { hash: hex(500 + n), size: 1, chunks: [hex(1)] } })
        )
      )
    expect(withBuilds(builds(LIMITS.buildsPerDeploy))).toBe(DOCKERFILE_PASSES)
    expect(withBuilds(builds(LIMITS.buildsPerDeploy + 1))).toBe("malformed")
  })
})

describe.each(BUILDERS)("CO1: %s", (_, made, PASSES) => {
  test("is a strict object", () => {
    const good = made()
    expect(withBuilds([good])).toBe(PASSES)
    expect(withBuilds([{ ...good, cache: true }])).toBe("malformed")
    for (const field of Object.keys(good)) {
      const missing: Record<string, unknown> = { ...good }
      delete missing[field]
      expect([field, withBuilds([missing])]).toEqual([field, "malformed"])
    }
    expect(withBuilds([{ ...good, pack: { ...good.pack, url: "x" } }])).toBe(
      "malformed"
    )
    expect(
      withBuilds([{ ...good, builder: { ...good.builder, extra: 1 } }])
    ).toBe("malformed")
  })

  test("the key is 64 lowercase hex", () => {
    const good = made()
    expect(withBuilds([{ ...good, key: good.key.toUpperCase() }])).toBe(
      "malformed"
    )
    expect(withBuilds([{ ...good, key: good.key.slice(1) }])).toBe("malformed")
  })

  test("pack: its hash, and a size from 1 byte to 512 MiB", () => {
    expect(LIMITS.packBytes).toBe(512 * MiB)
    expect(withBuilds([made({ pack: { ...pack(1), size: 1 } })])).toBe(PASSES)
    expect(withBuilds([made({ pack: { ...pack(1), size: 0 } })])).toBe(
      "malformed"
    )
    expect(withBuilds([made({ pack: pack(64) })])).toBe(PASSES)
    expect(
      withBuilds([made({ pack: { ...pack(64), size: LIMITS.packBytes + 1 } })])
    ).toBe("malformed")
    expect(withBuilds([made({ pack: { ...pack(1), size: 1.5 } })])).toBe(
      "malformed"
    )
    expect(withBuilds([made({ pack: { ...pack(1), hash: "abc" } })])).toBe(
      "malformed"
    )
  })

  test("pack.chunks: exactly ceil(size / 8 MiB) fingerprints, 1 to 64", () => {
    expect(withBuilds([made({ pack: { ...pack(1), chunks: [] } })])).toBe(
      "malformed"
    )
    expect(
      withBuilds([made({ pack: { ...pack(3), size: 16 * MiB + 1 } })])
    ).toBe(PASSES)
    expect(withBuilds([made({ pack: { ...pack(3), size: 16 * MiB } })])).toBe(
      "malformed"
    )
    expect(
      withBuilds([made({ pack: { ...pack(2), size: 16 * MiB + 1 } })])
    ).toBe("malformed")
    expect(
      withBuilds([made({ pack: { ...pack(1), chunks: ["A".repeat(64)] } })])
    ).toBe("malformed")
    // A chunk may repeat within one build: nothing says otherwise.
    expect(
      withBuilds([
        made({
          pack: { hash: hex(1), size: 16 * MiB, chunks: [hex(7), hex(7)] },
        }),
      ])
    ).toBe(PASSES)
  })

  test("args: at most 32, by name, sorted and each once", () => {
    const args = (count: number) =>
      Array.from({ length: count }, (_, n) => arg(n))
    expect(withBuilds([made({ args: args(LIMITS.argsPerBuild) })])).toBe(PASSES)
    expect(withBuilds([made({ args: args(LIMITS.argsPerBuild + 1) })])).toBe(
      "malformed"
    )
    for (const name of ["1A", "A-B", "A".repeat(129), ""])
      expect([
        name,
        withBuilds([made({ args: [{ name, value: "x" }] })]),
      ]).toEqual([name, "malformed"])
    expect(
      withBuilds([made({ args: [{ name: "A".repeat(128), value: "x" }] })])
    ).toBe(PASSES)
    expect(withBuilds([made({ args: [arg(2), arg(1)] })])).toBe("malformed")
    expect(withBuilds([made({ args: [arg(1), arg(1, "y")] })])).toBe(
      "malformed"
    )
    const loose = { name: "A", value: "x", secret: true }
    expect(withBuilds([made({ args: [loose] })])).toBe("malformed")
  })

  test("args: never a name a build is never given (CO6), in any case", () => {
    for (const name of [
      "HTTP_PROXY",
      "https_proxy",
      "BUILDKIT_INLINE_CACHE",
      "PATH",
      "SOURCE_DATE_EPOCH",
      "targetarch",
      "BuildPlatform",
    ])
      expect([
        name,
        withBuilds([made({ args: [{ name, value: "x" }] })]),
      ]).toEqual([name, "malformed"])
    for (const name of ["TARGETARCHS", "MY_PATH", "HTTP_AUTH_TOKEN"])
      expect([
        name,
        withBuilds([made({ args: [{ name, value: "x" }] })]),
      ]).toEqual([name, PASSES])
  })

  test("args: each value plain text of at most 4 KiB as UTF-8", () => {
    const limit = LIMITS.argValueBytes
    expect(limit).toBe(4 * KiB)
    for (const value of ["", "a".repeat(limit), `${"a".repeat(limit - 3)}€`])
      expect(withBuilds([made({ args: [{ name: "A", value }] })])).toBe(PASSES)
    for (const value of [
      "a".repeat(limit + 1),
      `${"a".repeat(limit - 2)}€`,
      "a\u0000b",
      "a\ud800",
    ])
      expect(withBuilds([made({ args: [{ name: "A", value }] })])).toBe(
        "malformed"
      )
  })

  test("secrets: at most 32 secret names, sorted and each once", () => {
    const secrets = listed(LIMITS.buildSecretsPerBuild + 1)
    const names = secrets.map((secret) => secret.name)
    // A key is computed only for a build whose secrets are all listed.
    const reading = (read: string[]) =>
      withBuilds(
        [
          made(
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
    expect(reading(names.slice(0, LIMITS.buildSecretsPerBuild))).not.toBe(
      "malformed"
    )
    expect(reading(names)).toBe("malformed")
    expect(reading([names[1]!, names[0]!])).toBe("malformed")
    expect(reading([names[0]!, names[0]!])).toBe("malformed")
    expect(reading(["1A"])).toBe("malformed")
  })

  test("secrets: never a credential name (CO6, FR-037b), in any case", () => {
    for (const name of [
      "GIT_AUTH_TOKEN",
      "git_auth_header",
      "HTTP_AUTH_TOKEN_GITHUB",
      "Http_Auth_Header_x",
    ]) {
      const secrets = [{ name, hash: hex(9), version: 1 }]
      expect([
        name,
        withBuilds([made({ secrets: [name] }, secrets)], secrets),
      ]).toEqual([name, "malformed"])
    }
    // A near name is a secret like any other.
    const secrets = [{ name: "HTTP_AUTH_TOKEN", hash: hex(9), version: 1 }]
    expect(
      withBuilds([made({ secrets: ["HTTP_AUTH_TOKEN"] }, secrets)], secrets)
    ).not.toBe("malformed")
  })

  test("network: default or none", () => {
    for (const network of ["default", "none"] as const)
      expect(withBuilds([made({ network })])).toBe(PASSES)
    for (const network of ["host", "", "bridge", null])
      expect(withBuilds([keyed({ ...made(), network })])).toBe("malformed")
  })

  test("timeout: 1 to 7,200 seconds", () => {
    expect(LIMITS.buildSeconds).toBe(7200)
    for (const timeout of [1, LIMITS.buildSeconds])
      expect(withBuilds([made({ timeout })])).toBe(PASSES)
    for (const timeout of [0, LIMITS.buildSeconds + 1, 1.5, -1])
      expect(withBuilds([made({ timeout })])).toBe("malformed")
  })

  test("fresh: null, or a whole number from 1", () => {
    for (const fresh of [null, 1, 41])
      expect([fresh, withBuilds([made({ fresh })])]).toEqual([fresh, PASSES])
    for (const fresh of [0, -1, 1.5, "1", true, Number.MAX_SAFE_INTEGER + 1])
      expect([fresh, withBuilds([keyed({ ...made(), fresh })])]).toEqual([
        fresh,
        "malformed",
      ])
  })
})
