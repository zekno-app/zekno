/**
 * The build record (specs/016-build-from-source, contracts/core.md CO14,
 * CO10; FR-031a, FR-066): the runner's side file `kept/<app>/<key>.json` and
 * the `records` of `builds`. The server's word, read strictly, with no field
 * that could carry a line the builder printed.
 */
import { describe, expect, test } from "bun:test"

import {
  ARCHES,
  BUILD_REASONS,
  BUILDING_LIMIT_SECONDS,
  BUILDING_PHASES,
  BuildRecordSchema,
  DIGEST,
  DOCKER_VERSION,
  readBuildRecord,
} from "../../src/deploy/build-record"
import { CoreError } from "../../src/protocol/result"

const hex = (digit: string) => digit.repeat(64)
const digest = (digit: string) => `sha256:${hex(digit)}`
const base = (path: string, digit = "a") =>
  `docker.io/library/${path}@sha256:${hex(digit)}`

const dockerfileRecord = () => ({
  key: hex("1"),
  manifest: digest("2"),
  config: digest("3"),
  builder: "dockerfile",
  railpack: null,
  docker: { engine: "27.3.1", buildx: "0.17.1", buildkit: "0.16.0" },
  reader: { kind: "dockerfile", version: "1.12.0" },
  cache: false,
  bases: [base("alpine"), base("node")],
  arch: "amd64",
  built: "2026-11-27T10:00:00.000Z",
})

const railpackRecord = () => ({
  ...dockerfileRecord(),
  builder: "railpack",
  railpack: "0.9.2",
  reader: { kind: "railpack", frontend: digest("4") },
  cache: true,
  bases: [`ghcr.io/railwayapp/railpack-runtime:0.9.2@sha256:${hex("5")}`],
  arch: "arm64",
})

/** CO14's keys, in its order. */
const RECORD_KEYS = [
  "key",
  "manifest",
  "config",
  "builder",
  "railpack",
  "docker",
  "reader",
  "cache",
  "bases",
  "arch",
  "built",
]

const throwsInvalid = (value: unknown) => {
  try {
    readBuildRecord(value)
  } catch (error) {
    return error instanceof CoreError && error.code === "invalid_argument"
  }
  return false
}

describe("the values the record, the report and the state share", () => {
  test("the bounded reasons and the processors, in the contract's order", () => {
    expect(BUILD_REASONS).toEqual([
      "step_failed",
      "out_of_memory",
      "out_of_disk",
      "time_limit",
      "wrong_processor",
      "cache_used",
      "team_changed",
      "runner_restarted",
    ])
    expect(ARCHES).toEqual(["amd64", "arm64", "other"])
  })

  test("the phases of a deploy that builds, and its longest time: 8 builds of 2 hours", () => {
    expect(BUILDING_PHASES).toEqual(["building", "stopping", "starting"])
    expect(BUILDING_LIMIT_SECONDS).toBe(57_600)
  })

  test("a digest is sha256: and 64 lowercase hex", () => {
    expect(DIGEST.test(digest("a"))).toBe(true)
    for (const text of [
      hex("a"),
      `sha256:${"a".repeat(63)}`,
      `sha256:${"a".repeat(65)}`,
      `sha256:${"A".repeat(64)}`,
      `sha512:${hex("a")}`,
      ` ${digest("a")}`,
      `${digest("a")}\n`,
    ])
      expect([text, DIGEST.test(text)]).toEqual([text, false])
  })

  test("a Docker version: three numbers and an optional suffix, never a leading v", () => {
    for (const text of [
      "27.3.1",
      "0.17.1",
      "0.17.1-desktop.1",
      "20.10.24+dfsg1",
      "26.1.3-0ubuntu1.24.04.1",
      "9999.9999.999999",
      `1.2.3-${"a".repeat(64)}`,
    ])
      expect([text, DOCKER_VERSION.test(text)]).toEqual([text, true])
    for (const text of [
      "v27.3.1",
      "27.3",
      "27",
      "27.3.1.4",
      "27.3.1-",
      "27.3.1 ",
      "27.3.1\n",
      "10000.0.0",
      "1.2.1234567",
      `1.2.3-${"a".repeat(65)}`,
      "1.2.3-a b",
      "1.2.3_x",
      "latest",
      "",
    ])
      expect([text, DOCKER_VERSION.test(text)]).toEqual([text, false])
  })
})

describe("readBuildRecord (CO14)", () => {
  test("a record of each builder reads, as it was", () => {
    const noBases = { ...dockerfileRecord(), bases: [], arch: "other" }
    for (const record of [dockerfileRecord(), railpackRecord(), noBases])
      expect(readBuildRecord(record) as unknown).toEqual(record)
  })

  test("keys come back in CO14's order, however they were written", () => {
    const shuffled = Object.fromEntries(
      Object.entries(dockerfileRecord()).reverse()
    )
    expect(Object.keys(readBuildRecord(shuffled))).toEqual(RECORD_KEYS)
    expect(Object.keys(BuildRecordSchema.shape)).toEqual(RECORD_KEYS)
  })

  test("16 bases read; 17 do not", () => {
    const bases = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        base(`image${String(index).padStart(2, "0")}`)
      )
    expect(
      readBuildRecord({ ...dockerfileRecord(), bases: bases(16) }).bases
    ).toHaveLength(16)
    expect(throwsInvalid({ ...dockerfileRecord(), bases: bases(17) })).toBe(
      true
    )
  })

  test("each field outside its rule throws invalid_argument", () => {
    const record = dockerfileRecord()
    const wrong: unknown[] = []
    const changes: Record<string, unknown>[] = [
      { key: hex("A") },
      { key: "1".repeat(63) },
      { key: undefined },
      { manifest: hex("2") },
      { manifest: `sha256:${"2".repeat(63)}` },
      { config: `sha512:${hex("3")}` },
      { config: null },
      { builder: "buildpack" },
      { builder: "Dockerfile" },
      { railpack: "0.9.2" },
      { docker: { ...record.docker, engine: "v27.3.1" } },
      { docker: { ...record.docker, engine: "latest" } },
      { docker: { ...record.docker, buildx: null } },
      { docker: { ...record.docker, buildx: "0.17" } },
      { docker: { ...record.docker, buildkit: "" } },
      { docker: { engine: "27.3.1", buildx: "0.17.1" } },
      { reader: { kind: "dockerfile", version: "1.12" } },
      { reader: { kind: "dockerfile" } },
      { reader: { kind: "docker", version: "1.12.0" } },
      { cache: "yes" },
      { cache: 0 },
      { bases: base("node") },
      { bases: [base("node"), base("alpine")] },
      { bases: [base("node"), base("node")] },
      { bases: [`docker.io/library/node:22`] },
      { bases: [`docker.io/library/node`] },
      { bases: [`zekno.invalid/shop@sha256:${hex("a")}`] },
      { bases: [`ZEKNO.invalid/shop@sha256:${hex("a")}`] },
      { bases: [`zekno.invalid:5000/shop@sha256:${hex("a")}`] },
      { bases: [`library/node@sha256:${hex("a")}`] },
      { bases: [`docker.io/${"a".repeat(240)}@sha256:${hex("a")}`] },
      { arch: "x86_64" },
      { arch: "AMD64" },
      { built: "2026-11-27" },
      { built: "yesterday" },
      { built: 1_764_237_600_000 },
    ]
    for (const change of changes) {
      const changed = { ...record, ...change }
      if (!throwsInvalid(changed)) wrong.push(change)
    }
    expect(wrong).toEqual([])
    for (const value of [null, undefined, "{}", [], 1])
      expect(throwsInvalid(value)).toBe(true)
  })

  test("the Railpack fields hold their own rules", () => {
    const record = railpackRecord()
    const wrong: unknown[] = []
    for (const change of [
      { railpack: null },
      { railpack: "v0.9.2" },
      { railpack: "0.9" },
      { railpack: "0.9.2-beta.1" },
      { reader: { kind: "railpack", frontend: hex("4") } },
      { reader: { kind: "railpack", frontend: `ghcr.io/x@${digest("4")}` } },
      { reader: { kind: "railpack" } },
    ] as Record<string, unknown>[])
      if (!throwsInvalid({ ...record, ...change })) wrong.push(change)
    expect(wrong).toEqual([])
  })

  test("a Railpack record with a Dockerfile reader, and the reverse, throw", () => {
    expect(
      throwsInvalid({
        ...railpackRecord(),
        reader: dockerfileRecord().reader,
      })
    ).toBe(true)
    expect(
      throwsInvalid({
        ...dockerfileRecord(),
        reader: railpackRecord().reader,
      })
    ).toBe(true)
    expect(
      throwsInvalid({
        ...dockerfileRecord(),
        builder: "railpack",
        railpack: "0.9.2",
      })
    ).toBe(true)
  })

  test("a key added, at any depth, throws", () => {
    for (const changed of [
      { ...dockerfileRecord(), log: "step 3 failed" },
      {
        ...dockerfileRecord(),
        docker: { ...dockerfileRecord().docker, driver: "docker" },
      },
      {
        ...dockerfileRecord(),
        reader: { ...dockerfileRecord().reader, frontend: digest("4") },
      },
      {
        ...railpackRecord(),
        reader: { ...railpackRecord().reader, version: "1.12.0" },
      },
    ])
      expect(throwsInvalid(changed)).toBe(true)
  })

  test("its keys hold no free-text field: every text in the record refuses a sentence", () => {
    const sentence = "RUN npm ci printed: token=abc"
    /** Every path to a text in the record, array places included. */
    const textPaths = (value: unknown, path: (string | number)[] = []) => {
      if (typeof value === "string") return [path]
      if (value === null || typeof value !== "object") return []
      const found: (string | number)[][] = []
      for (const [key, inner] of Object.entries(value))
        found.push(
          ...textPaths(inner, [
            ...path,
            Array.isArray(value) ? Number(key) : key,
          ])
        )
      return found
    }
    const withText = (record: unknown, path: (string | number)[]) => {
      const copy = structuredClone(record) as Record<string | number, unknown>
      let at = copy
      for (const step of path.slice(0, -1))
        at = at[step] as Record<string | number, unknown>
      at[path.at(-1)!] = sentence
      return copy
    }
    const seen = new Set<string>()
    const wrong: string[] = []
    for (const record of [dockerfileRecord(), railpackRecord()])
      for (const path of textPaths(record)) {
        seen.add(path.filter((step) => typeof step === "string").join("."))
        if (!throwsInvalid(withText(record, path))) wrong.push(path.join("."))
      }
    expect(wrong).toEqual([])
    expect([...seen].sort()).toEqual(
      [
        "key",
        "manifest",
        "config",
        "builder",
        "railpack",
        "docker.engine",
        "docker.buildx",
        "docker.buildkit",
        "reader.kind",
        "reader.version",
        "reader.frontend",
        "bases",
        "arch",
        "built",
      ].sort()
    )
  })
})
