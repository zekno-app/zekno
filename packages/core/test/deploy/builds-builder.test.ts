/**
 * The builder of a build entry (specs/016-build-from-source,
 * contracts/core.md CO1; FR-008, FR-024): the Dockerfile's and Railpack's
 * own fields at their edges, one builder by its name, and 014's flat shape
 * refused, read through `readDeployV2Payload`. A build that keeps every rule
 * "passes": it reads, unless this step does not carry it out (CO7), when it
 * is `unsupported_version`. The rows both builders share are in
 * builds.test.ts.
 */
import { describe, expect, test } from "bun:test"

import { toHex, utf8 } from "../../src/crypto/encoding"
import { hash } from "../../src/crypto/hash"
import { readDeployV2Payload } from "../../src/deploy/message"
import { LIMITS } from "../../src/protocol/limits"
import {
  build,
  hex,
  image,
  keyed,
  KiB,
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

/** A deploy with these builds. */
const withBuilds = (builds: unknown[]) => code(payload({ builds }))

/** A Dockerfile build whose builder is changed by `change`. */
const dockerfile = (change: Record<string, unknown>) =>
  keyed({
    ...build(),
    builder: {
      name: "dockerfile",
      dockerfile: "Dockerfile",
      target: null,
      ...change,
    },
  })

/** A Railpack build whose builder is changed by `change`. */
const railpack = (change: Record<string, unknown>) =>
  keyed({
    ...railpackBuild(),
    builder: { ...railpackBuild().builder, ...change },
  })

const PLAN = { hash: hex(113), size: 1, piece: hex(114) }

describe("CO1: the Dockerfile builder", () => {
  test("its path: inside the pack, as a person reads it, 1 to 255 characters", () => {
    for (const path of [
      "Dockerfile",
      "docker/Dockerfile.prod",
      "a".repeat(LIMITS.dockerfileLength),
    ])
      expect([path, withBuilds([dockerfile({ dockerfile: path })])]).toEqual([
        path,
        DOCKERFILE_PASSES,
      ])
    for (const path of [
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
      expect([path, withBuilds([dockerfile({ dockerfile: path })])]).toEqual([
        path,
        "malformed",
      ])
  })

  test("its target", () => {
    for (const target of [null, "build", "a", `a${"b".repeat(62)}`, "x.y_z-1"])
      expect(withBuilds([dockerfile({ target })])).toBe(DOCKERFILE_PASSES)
    for (const target of ["", `a${"b".repeat(63)}`, ".x", "-x", "a b", "a/b"])
      expect([target, withBuilds([dockerfile({ target })])]).toEqual([
        target,
        "malformed",
      ])
  })

  test("a credential name is a Dockerfile build's argument like any other (CO6)", () => {
    expect(
      withBuilds([build({ args: [{ name: "GIT_AUTH_TOKEN", value: "x" }] })])
    ).toBe(DOCKERFILE_PASSES)
  })
})

describe("CO1: the Railpack builder", () => {
  test("its version: three numbers of at most 4, 4 and 6 digits", () => {
    for (const version of ["0.0.0", "0.9.2", "9999.9999.999999"])
      expect([version, withBuilds([railpack({ version })])]).toEqual([
        version,
        RAILPACK_PASSES,
      ])
    for (const version of [
      "",
      "1.2",
      "1.2.3.4",
      "v1.2.3",
      "10000.0.0",
      "0.10000.0",
      "0.0.1000000",
      "1.2.3-beta",
      " 1.2.3",
      "1.2.3\n",
      "\u0661.\u0662.\u0663",
    ])
      expect([version, withBuilds([railpack({ version })])]).toEqual([
        version,
        "malformed",
      ])
  })

  test("its frontend: a reference by digest (CO3), never zekno.invalid", () => {
    const digest = `sha256:${hex(7)}`
    for (const frontend of [
      `ghcr.io/railwayapp/railpack-frontend:0.9.2@${digest}`,
      `localhost:5000/frontend@${digest}`,
    ])
      expect(withBuilds([railpack({ frontend })])).toBe(RAILPACK_PASSES)
    for (const frontend of [
      "ghcr.io/railwayapp/railpack-frontend",
      "ghcr.io/railwayapp/railpack-frontend:0.9.2",
      `railwayapp/railpack-frontend@${digest}`,
      `zekno.invalid/frontend@${digest}`,
      `ghcr.io/x@sha256:${"a".repeat(63)}`,
    ])
      expect([frontend, withBuilds([railpack({ frontend })])]).toEqual([
        frontend,
        "malformed",
      ])
  })

  test("its images: 1 to 8 references by digest, sorted and each once", () => {
    expect(LIMITS.railpackImages).toBe(8)
    const images = (count: number) =>
      Array.from({ length: count }, (_, n) => image(`i${n}`, 300 + n))
    expect(withBuilds([railpack({ images: images(1) })])).toBe(RAILPACK_PASSES)
    expect(withBuilds([railpack({ images: images(8) })])).toBe(RAILPACK_PASSES)
    expect(withBuilds([railpack({ images: images(9) })])).toBe("malformed")
    expect(withBuilds([railpack({ images: [] })])).toBe("malformed")
    expect(withBuilds([railpack({ images: [...images(2)].reverse() })])).toBe(
      "malformed"
    )
    const [one] = images(1)
    expect(withBuilds([railpack({ images: [one, one] })])).toBe("malformed")
    expect(
      withBuilds([railpack({ images: [`zekno.invalid/x@sha256:${hex(1)}`] })])
    ).toBe("malformed")
    expect(withBuilds([railpack({ images: ["ghcr.io/x:1"] })])).toBe(
      "malformed"
    )
  })

  test("its plan: a hash, a size of 1 byte to 256 KiB, and a piece", () => {
    expect(LIMITS.planBytes).toBe(256 * KiB)
    for (const size of [1, LIMITS.planBytes])
      expect(withBuilds([railpack({ plan: { ...PLAN, size } })])).toBe(
        RAILPACK_PASSES
      )
    for (const size of [0, LIMITS.planBytes + 1, 1.5])
      expect([
        size,
        withBuilds([railpack({ plan: { ...PLAN, size } })]),
      ]).toEqual([size, "malformed"])
    for (const plan of [
      { ...PLAN, hash: "abc" },
      { ...PLAN, piece: hex(0xabc).toUpperCase() },
      { ...PLAN, extra: 1 },
      { hash: PLAN.hash, size: PLAN.size },
    ])
      expect(withBuilds([railpack({ plan })])).toBe("malformed")
  })

  test("a credential name is never a Railpack build's argument (CO6)", () => {
    for (const name of ["GIT_AUTH_TOKEN", "http_auth_header_x"])
      expect(
        withBuilds([railpackBuild({ args: [{ name, value: "x" }] })])
      ).toBe("malformed")
  })
})

describe("CO1: one builder, by its name", () => {
  test("a Dockerfile builder with Railpack's fields is refused, and the reverse", () => {
    const rail = railpackBuild().builder
    expect(withBuilds([dockerfile({ version: "0.9.2" })])).toBe("malformed")
    expect(withBuilds([dockerfile({ plan: PLAN })])).toBe("malformed")
    expect(withBuilds([railpack({ dockerfile: "Dockerfile" })])).toBe(
      "malformed"
    )
    expect(withBuilds([railpack({ target: null })])).toBe("malformed")
    // Railpack's fields under the Dockerfile's name, and the reverse.
    expect(withBuilds([railpack({ name: "dockerfile" })])).toBe("malformed")
    expect(withBuilds([dockerfile({ name: "railpack" })])).toBe("malformed")
    for (const name of ["nixpacks", "Dockerfile", "", null])
      expect(withBuilds([railpack({ ...rail, name })])).toBe("malformed")
    const { name: _name, ...nameless } = rail
    expect(withBuilds([{ ...railpackBuild(), builder: nameless }])).toBe(
      "malformed"
    )
    expect(withBuilds([{ ...build(), builder: null }])).toBe("malformed")
  })

  test("014's flat shape is refused", () => {
    // Its key as 014 made it, so only the shape refuses it.
    const key = toHex(
      hash(
        "zekno/v1/build",
        utf8(JSON.stringify([hex(100), "Dockerfile", null, [], [], "default"]))
      )
    )
    const flat = {
      key,
      pack: { hash: hex(100), size: 1, chunks: [hex(101)] },
      dockerfile: "Dockerfile",
      target: null,
      args: [],
      secrets: [],
      network: "default",
      timeout: 1800,
    }
    expect(withBuilds([flat])).toBe("malformed")
    const { builder: _builder, ...rest } = build()
    expect(
      withBuilds([{ ...rest, dockerfile: "Dockerfile", target: null }])
    ).toBe("malformed")
  })
})
