/**
 * The build record (specs/016-build-from-source, T085; contracts/runner.md
 * RB11 fourth bullet, RB14 step 2; core.md CO14; FR-066): the runner's side
 * file `kept/<app>/<key>.json`, written through core's strict schema, mode
 * 600, atomically; read back for `builds`, a file that does not read
 * skipped; removed once its image leaves `drop`. Never a line the builder
 * printed: every field is held to a pattern or a list.
 */
import { describe, expect, test } from "bun:test"
import { CoreError, type BuildRecord } from "@workspace/core"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import type { DockerFacts } from "../../src/builder/facts"
import {
  readRecords,
  recordedKeys,
  recordOf,
  removeRecord,
  writeRecord,
} from "../../src/kept/records"
import { tempDir } from "../support/helpers"

const hex = (c: string) => c.repeat(64)
const digest = (c: string) => `sha256:${hex(c)}`
const K1 = hex("1")
const K2 = hex("2")
const K3 = hex("3")

/** A Dockerfile build's record, as B3 writes it. */
const record = (
  key: string,
  change: Partial<BuildRecord> = {}
): BuildRecord => ({
  key,
  manifest: digest("a"),
  config: digest("b"),
  builder: "dockerfile",
  railpack: null,
  docker: { engine: "29.6.1", buildx: "0.34.1", buildkit: "0.31.1" },
  reader: { kind: "dockerfile", version: "1.20.1" },
  cache: false,
  bases: [`docker.io/library/node:22@${digest("c")}`],
  arch: "amd64",
  built: "2026-11-28T10:00:00.000Z",
  ...change,
})

const fileOf = (dir: string, app: string, key: string) =>
  join(dir, "kept", app, `${key}.json`)

const mode = (path: string) => statSync(path).mode & 0o777

describe("writeRecord and readRecords", () => {
  test("a record read back equal, in the order of the keys asked", () => {
    const dir = tempDir("records")
    const first = record(K1)
    const second = record(K2, {
      builder: "railpack",
      railpack: "0.9.2",
      reader: { kind: "railpack", frontend: digest("f") },
      cache: true,
      bases: [],
      arch: "arm64",
    })
    writeRecord(dir, "web", first)
    writeRecord(dir, "web", second)
    expect(readRecords(dir, "web", [K2, K1])).toEqual([second, first])
    // Keys with no file are skipped, as are another app's.
    expect(readRecords(dir, "web", [K3])).toEqual([])
    expect(readRecords(dir, "api", [K1])).toEqual([])
  })

  test("the file is mode 600, its folders 700, and nothing but the record is left beside it", () => {
    const dir = tempDir("records")
    writeRecord(dir, "web", record(K1))
    expect(mode(fileOf(dir, "web", K1))).toBe(0o600)
    expect(mode(join(dir, "kept"))).toBe(0o700)
    expect(mode(join(dir, "kept", "web"))).toBe(0o700)
    // Written whole and moved into place: no temporary file stays.
    expect(readdirSync(join(dir, "kept", "web"))).toEqual([`${K1}.json`])
    // Written again, it is replaced whole.
    writeRecord(dir, "web", record(K1, { cache: true }))
    expect(readRecords(dir, "web", [K1])).toEqual([record(K1, { cache: true })])
    expect(mode(fileOf(dir, "web", K1))).toBe(0o600)
  })

  test("the file holds CO14's fields in CO14's order, and nothing more", () => {
    const dir = tempDir("records")
    writeRecord(dir, "web", record(K1))
    expect(
      Object.keys(JSON.parse(readFileSync(fileOf(dir, "web", K1), "utf8")))
    ).toEqual([
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
    ])
  })

  test("a damaged file is skipped, and the others are still read", () => {
    const dir = tempDir("records")
    writeRecord(dir, "web", record(K1))
    writeRecord(dir, "web", record(K2))
    writeRecord(dir, "web", record(K3))
    // Cut short, as a disk that filled up might leave it.
    const cut = readFileSync(fileOf(dir, "web", K2), "utf8")
    writeFileSync(fileOf(dir, "web", K2), cut.slice(0, cut.length / 2))
    expect(readRecords(dir, "web", [K1, K2, K3])).toEqual([
      record(K1),
      record(K3),
    ])
    // A field the schema does not know.
    writeFileSync(
      fileOf(dir, "web", K2),
      JSON.stringify({ ...record(K2), log: "#9 RUN npm ci" })
    )
    expect(readRecords(dir, "web", [K2])).toEqual([])
    // A record of another key under this key's name.
    writeFileSync(fileOf(dir, "web", K2), JSON.stringify(record(K1)))
    expect(readRecords(dir, "web", [K2])).toEqual([])
    // Too large to be a record.
    writeFileSync(fileOf(dir, "web", K2), " ".repeat(64 * 1024))
    expect(readRecords(dir, "web", [K2])).toEqual([])
  })

  test("a link in a record's place is not followed, and a folder there is not read", () => {
    const dir = tempDir("records")
    const elsewhere = join(tempDir("records-elsewhere"), "record.json")
    writeFileSync(elsewhere, JSON.stringify(record(K1)))
    mkdirSync(join(dir, "kept", "web"), { recursive: true })
    symlinkSync(elsewhere, fileOf(dir, "web", K1))
    mkdirSync(fileOf(dir, "web", K2))
    expect(readRecords(dir, "web", [K1, K2])).toEqual([])
  })

  test("a key or an app that is not one is skipped when reading and refused when writing", () => {
    const dir = tempDir("records")
    expect(readRecords(dir, "web", ["../state"])).toEqual([])
    expect(readRecords(dir, "../web", [K1])).toEqual([])
    expect(() => writeRecord(dir, "../web", record(K1))).toThrow()
    expect(existsSync(join(dir, "kept"))).toBe(false)
  })

  test("a field holding a builder's line is refused by the schema, and nothing is written", () => {
    const dir = tempDir("records")
    const line = "#9 [build 4/7] RUN npm ci\n#9 ERROR: process did not complete"
    for (const bad of [
      record(K1, { reader: { kind: "dockerfile", version: `1.20.1 ${line}` } }),
      record(K1, { bases: [line] }),
      record(K1, {
        docker: { engine: line, buildx: "0.34.1", buildkit: "0.31.1" },
      }),
      record(K1, { built: line }),
      { ...record(K1), output: line } as BuildRecord,
      // A Dockerfile build with Railpack's version, and a key that is not one.
      record(K1, { railpack: "0.9.2" }),
      record("not a key"),
    ]) {
      expect(() => writeRecord(dir, "web", bad)).toThrow(CoreError)
    }
    expect(existsSync(fileOf(dir, "web", K1))).toBe(false)
  })
})

describe("removeRecord", () => {
  test("removes the file, and removing a missing file is fine", () => {
    const dir = tempDir("records")
    writeRecord(dir, "web", record(K1))
    writeRecord(dir, "web", record(K2))
    expect(removeRecord(dir, "web", K1)).toBe(true)
    expect(existsSync(fileOf(dir, "web", K1))).toBe(false)
    expect(readRecords(dir, "web", [K1, K2])).toEqual([record(K2)])
    // Gone already, never written, an app with no folder: nothing to do.
    expect(removeRecord(dir, "web", K1)).toBe(true)
    expect(removeRecord(dir, "web", K3)).toBe(true)
    expect(removeRecord(dir, "api", K1)).toBe(true)
    expect(removeRecord(tempDir("records-empty"), "web", K1)).toBe(true)
  })

  test("a key that is not one removes nothing", () => {
    const dir = tempDir("records")
    writeRecord(dir, "web", record(K1))
    expect(removeRecord(dir, "web", "../../state")).toBe(false)
    expect(readRecords(dir, "web", [K1])).toEqual([record(K1)])
  })
})

describe("recordedKeys", () => {
  test("the keys with a record file, sorted; other names are not keys; none without a folder", () => {
    const dir = tempDir("records")
    expect(recordedKeys(dir, "web")).toEqual([])
    writeRecord(dir, "web", record(K2))
    writeRecord(dir, "web", record(K1))
    writeFileSync(join(dir, "kept", "web", "notes.txt"), "")
    writeFileSync(join(dir, "kept", "web", `${K3}.json.tmp`), "")
    expect(recordedKeys(dir, "web")).toEqual([K1, K2])
    expect(recordedKeys(dir, "api")).toEqual([])
    expect(recordedKeys(dir, "../web")).toEqual([])
  })
})

describe("recordOf", () => {
  const facts: DockerFacts = {
    engine: "29.6.1",
    arch: "amd64",
    buildx: "0.34.1",
    context: "default",
    driver: "docker",
    buildkit: "0.31.1",
    policy: true,
    maxUsedSpace: true,
  }
  const input = {
    key: K1,
    digests: { manifest: digest("a"), config: digest("b") },
    reader: { kind: "dockerfile", version: "1.20.1" } as const,
    railpack: null,
    facts,
    cache: false,
    bases: [`docker.io/library/node:22@${digest("c")}`],
    arch: "amd64" as const,
    built: new Date("2026-11-28T10:00:00.000Z"),
  }

  test("the record of a build: its key and digests, the builder its reader names, the versions facts.ts read", () => {
    expect(recordOf(input)).toEqual(record(K1))
    expect(
      recordOf({
        ...input,
        reader: { kind: "railpack", frontend: digest("f") },
        railpack: "0.9.2",
      })
    ).toEqual(
      record(K1, {
        builder: "railpack",
        railpack: "0.9.2",
        reader: { kind: "railpack", frontend: digest("f") },
      })
    )
  })

  test("the bases are sorted and each kept once", () => {
    const a = `docker.io/library/alpine:3.20@${digest("d")}`
    const b = `docker.io/library/node:22@${digest("c")}`
    expect(recordOf({ ...input, bases: [b, a, b] })?.bases).toEqual([a, b])
  })

  test("no record when a version was not read, or a value does not fit the schema", () => {
    expect(
      recordOf({ ...input, facts: { ...facts, buildkit: null } })
    ).toBeUndefined()
    expect(
      recordOf({ ...input, facts: { ...facts, buildx: null } })
    ).toBeUndefined()
    expect(
      recordOf({ ...input, facts: { ...facts, engine: null } })
    ).toBeUndefined()
    expect(
      recordOf({
        ...input,
        reader: { kind: "dockerfile", version: "#9 ERROR" },
      })
    ).toBeUndefined()
    expect(recordOf({ ...input, built: new Date(Number.NaN) })).toBeUndefined()
  })
})
