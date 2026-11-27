/**
 * The image a build made (specs/016-build-from-source, T078; contracts/
 * runner.md RB11 first three bullets, RB9 last bullet; FR-041, FR-061,
 * FR-066): the two digests and the base images read from `meta.json`, which
 * is deleted once read; the tag's `.Id` held to one of the two digests and
 * its architecture to the server's. Docker is a stand-in script that answers
 * `image inspect` as the test writes it. Real Docker: L4 (identity, both
 * stores), L9 (materials), B1 (ARM64).
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { checkImage, readMeta } from "../../src/builder/metadata"
import { tempDir } from "../support/helpers"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

const hex = (char: string) => char.repeat(64)
const MANIFEST = `sha256:${hex("a")}`
const CONFIG = `sha256:${hex("c")}`
const KEY = hex("e")

/** A work folder holding `meta.json` as buildx writes it. */
function work(meta: unknown): string {
  const dir = tempDir("meta-work")
  writeFileSync(
    join(dir, "meta.json"),
    typeof meta === "string" ? meta : JSON.stringify(meta, null, 2)
  )
  return dir
}

/** A material of SLSA 0.2's provenance, as BuildKit names an image. */
const material = (uri: string, digest?: string) => ({
  uri,
  ...(digest === undefined ? {} : { digest: { sha256: digest } }),
})

/** `meta.json` as E01 recorded it: the two digests, the record's ref, the provenance with its materials and the build's arguments. */
const META = (materials: unknown[]) => ({
  "buildx.build.provenance": {
    buildType: "https://mobyproject.org/buildkit@v1",
    materials,
    invocation: {
      configSource: { entryPoint: "Dockerfile" },
      parameters: { args: { "build-arg:TOKEN": "a value never kept" } },
    },
  },
  "buildx.build.ref": "default/default/kcf12h1o0p8v2vw7ly89cnofl",
  "containerimage.config.digest": CONFIG,
  "containerimage.descriptor": {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: MANIFEST,
    size: 482,
  },
  "containerimage.digest": MANIFEST,
  "image.name": `zekno.invalid/blog:${KEY}`,
})

describe("readMeta", () => {
  test("reads the two digests and the base images, then deletes meta.json", () => {
    const dir = work(
      META([
        material("pkg:docker/busybox@1.36?platform=linux%2Farm64", hex("7")),
        material(
          `pkg:docker/node@sha256:${hex("1")}?platform=linux%2Famd64`,
          hex("1")
        ),
        material(
          "pkg:docker/ghcr.io/acme/base@2?digest=sha256:" +
            hex("2") +
            "&platform=linux%2Famd64",
          hex("2")
        ),
        material("pkg:docker/127.0.0.1:5000/check/base@1", hex("3")),
        material("https://example.com/file.tar.gz", hex("4")),
        material("pkg:docker/docker/dockerfile@1", hex("5")),
      ])
    )
    expect(readMeta(dir)).toEqual({
      digests: { manifest: MANIFEST, config: CONFIG },
      bases: [
        `127.0.0.1:5000/check/base:1@sha256:${hex("3")}`,
        `docker.io/docker/dockerfile:1@sha256:${hex("5")}`,
        `docker.io/library/busybox:1.36@sha256:${hex("7")}`,
        `docker.io/library/node@sha256:${hex("1")}`,
        `ghcr.io/acme/base:2@sha256:${hex("2")}`,
      ],
    })
    expect(existsSync(join(dir, "meta.json"))).toBe(false)
  })

  test("reads SLSA 1.0's resolved dependencies as materials", () => {
    const dir = work({
      "containerimage.digest": MANIFEST,
      "containerimage.config.digest": CONFIG,
      "buildx.build.provenance": {
        buildDefinition: {
          resolvedDependencies: [material("pkg:docker/alpine@3.20", hex("6"))],
        },
      },
    })
    expect(readMeta(dir).bases).toEqual([
      `docker.io/library/alpine:3.20@sha256:${hex("6")}`,
    ])
  })

  test("20 materials are kept to 16, sorted, each once", () => {
    const twenty = Array.from({ length: 20 }, (_, index) =>
      material(
        `pkg:docker/example.com/base${String(index).padStart(2, "0")}@1`,
        hex(String(index % 10))
      )
    )
    const dir = work(META([...twenty, twenty[0]]))
    const { bases } = readMeta(dir)
    expect(bases).toHaveLength(16)
    expect(bases).toEqual([...bases].sort())
    expect(bases[0]).toBe(`example.com/base00:1@sha256:${hex("0")}`)
    expect(bases[15]).toBe(`example.com/base15:1@sha256:${hex("5")}`)
  })

  test("a material with no digest, or one outside the pattern, is left out", () => {
    const dir = work(
      META([
        material("pkg:docker/busybox@1.36"),
        { uri: "pkg:docker/busybox@1.37", digest: { sha512: hex("8") } },
        material("pkg:docker/busybox@1.38", "not hex"),
        material("pkg:docker/busybox@1.39", hex("A")),
        material("pkg:docker/zekno.invalid/check-other@k1", hex("9")),
        material(`pkg:docker/example.com/${"x".repeat(250)}@1`, hex("9")),
        material("pkg:docker/Example.com/UPPER@1", hex("9")),
        material("pkg:docker/@1", hex("9")),
        { uri: 7, digest: { sha256: hex("9") } },
        "not a material",
        material("pkg:docker/alpine@3.20", hex("6")),
      ])
    )
    expect(readMeta(dir).bases).toEqual([
      `docker.io/library/alpine:3.20@sha256:${hex("6")}`,
    ])
  })

  test("a missing or malformed digest gives no digests", () => {
    for (const meta of [
      { "containerimage.config.digest": CONFIG },
      { "containerimage.digest": MANIFEST },
      {
        "containerimage.digest": "sha256:abc",
        "containerimage.config.digest": CONFIG,
      },
      {
        "containerimage.digest": MANIFEST,
        "containerimage.config.digest": `${CONFIG} `,
      },
      {
        "containerimage.digest": MANIFEST.toUpperCase(),
        "containerimage.config.digest": CONFIG,
      },
      { "containerimage.digest": 7, "containerimage.config.digest": CONFIG },
      [],
      "not json",
    ]) {
      const dir = work(meta)
      expect(readMeta(dir)).toEqual({ bases: [] })
      expect(existsSync(join(dir, "meta.json"))).toBe(false)
    }
  })

  test("no meta.json gives nothing", () => {
    expect(readMeta(tempDir("meta-none"))).toEqual({ bases: [] })
  })

  test("a meta.json over 1 MiB is not read, and is deleted", () => {
    const dir = work({
      ...META([]),
      padding: "p".repeat(1024 * 1024),
    })
    expect(readMeta(dir)).toEqual({ bases: [] })
    expect(existsSync(join(dir, "meta.json"))).toBe(false)
  })

  test("a meta.json that is a link is not followed, and the link is removed", () => {
    const elsewhere = work(META([]))
    const dir = tempDir("meta-link")
    symlinkSync(join(elsewhere, "meta.json"), join(dir, "meta.json"))
    expect(readMeta(dir)).toEqual({ bases: [] })
    expect(existsSync(join(dir, "meta.json"))).toBe(false)
    expect(existsSync(join(elsewhere, "meta.json"))).toBe(true)
  })

  test("never the iidfile", () => {
    const dir = work({ ...META([]), "containerimage.digest": undefined })
    writeFileSync(join(dir, "iid"), CONFIG)
    mkdirSync(join(dir, "more"))
    expect(readMeta(dir).digests).toBeUndefined()
  })
})

/** A stand-in Docker whose `image inspect` prints `out` and exits `code`; it logs each call. */
function standIn(out: string, code = 0) {
  const dir = tempDir("meta-docker")
  const path = join(dir, "docker")
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/calls.log"\nprintf '%s' '${out}'\nexit ${code}\n`
  )
  chmodSync(path, 0o755)
  process.env.ZEKNO_DOCKER = path
  return () => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n")
}

/** The runner's folder, where every Docker call starts. */
const HOME = tempDir("meta-home")

describe("checkImage", () => {
  const digests = { manifest: MANIFEST, config: CONFIG }

  test("asks Docker for the tag's .Id and architecture", async () => {
    const calls = standIn(`${MANIFEST} amd64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "amd64")).toEqual({
      ok: true,
      arch: "amd64",
    })
    expect(calls()).toEqual([
      `image inspect --format {{.Id}} {{.Architecture}} zekno.invalid/blog:${KEY}`,
    ])
  })

  test(".Id equal to the manifest digest, then to the config digest (the two stores)", async () => {
    standIn(`${MANIFEST} arm64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "arm64")).toEqual({
      ok: true,
      arch: "arm64",
    })
    standIn(`${CONFIG} arm64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "arm64")).toEqual({
      ok: true,
      arch: "arm64",
    })
  })

  test("a third digest is step_failed", async () => {
    standIn(`sha256:${hex("b")} amd64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "amd64")).toEqual({
      ok: false,
      reason: "step_failed",
    })
  })

  test("an arm64 image on an amd64 server is wrong_processor, with both", async () => {
    standIn(`${MANIFEST} arm64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "amd64")).toEqual({
      ok: false,
      reason: "wrong_processor",
      arch: { image: "arm64", server: "amd64" },
    })
    standIn(`${MANIFEST} riscv64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "arm64")).toEqual({
      ok: false,
      reason: "wrong_processor",
      arch: { image: "other", server: "arm64" },
    })
  })

  test("another processor's .Id is still step_failed: the tag is not this build's", async () => {
    standIn(`sha256:${hex("b")} arm64\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "amd64")).toEqual({
      ok: false,
      reason: "step_failed",
    })
  })

  test("no digests, no such image, or an answer it cannot read is step_failed", async () => {
    standIn(`${MANIFEST} amd64\n`)
    expect(await checkImage(HOME, "blog", KEY, undefined, "amd64")).toEqual({
      ok: false,
      reason: "step_failed",
    })
    standIn(
      `Error response from daemon: No such image: zekno.invalid/blog:${KEY}`,
      1
    )
    expect(await checkImage(HOME, "blog", KEY, digests, "amd64")).toEqual({
      ok: false,
      reason: "step_failed",
    })
    for (const out of [
      `${MANIFEST}`,
      `${MANIFEST} amd64 extra`,
      "",
      `${MANIFEST}  amd64`,
      `${MANIFEST.slice(0, -1)} amd64`,
    ]) {
      standIn(out)
      expect(await checkImage(HOME, "blog", KEY, digests, "amd64")).toEqual({
        ok: false,
        reason: "step_failed",
      })
    }
  })

  test("an image on a server of another processor is never taken as the server's", async () => {
    standIn(`${MANIFEST} s390x\n`)
    expect(await checkImage(HOME, "blog", KEY, digests, "other")).toEqual({
      ok: false,
      reason: "wrong_processor",
      arch: { image: "other", server: "other" },
    })
  })
})
