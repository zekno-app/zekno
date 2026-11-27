/**
 * The limits of pass 1 (specs/016-build-from-source, contracts/cli.md CL2,
 * "Pass 1"; data-model.md, "The pack"; FR-018; tasks T116): the pack's
 * exact size, C1 to C4, the warning B12 and the largest folders B4, from the
 * walk alone. Large folders are made of sparse files, so no test writes
 * hundreds of megabytes; every fixture is written at run time.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { LIMITS } from "@workspace/core"

import { BuildStop, type BuildLine } from "../../src/shared/build-lines"
import { readIgnoreFile } from "../../src/pack/ignore"
import {
  checkLimits,
  limitsOf,
  packSize,
  sizeWarning,
  WARN_BYTES,
} from "../../src/pack/limits"
import { spoolPack } from "../../src/pack/spool"
import { walkFolder, type Walk } from "../../src/pack/walk"

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-limits-")))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string | Uint8Array = "x"): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** A sparse file of `bytes`: its size counts, and nothing is written. */
function sparse(path: string, bytes: number): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  closeSync(openSync(full, "w"))
  truncateSync(full, bytes)
}

function walk(): Walk {
  return walkFolder(root, {
    dockerfile: "Dockerfile",
    ignore: readIgnoreFile(root, {
      builder: "dockerfile",
      dockerfile: "Dockerfile",
    }),
    include: [],
    agreed: () => false,
    zeknoHome: join(root, "..", "not-here"),
  })
}

function stopOf(work: () => unknown): BuildLine {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(BuildStop)
    expect((error as BuildStop).message).toBe((error as BuildStop).line.id)
    return (error as BuildStop).line
  }
  throw new Error("expected a stop")
}

const MB = 1000 * 1000
const MiB = 1024 * 1024

describe("the pack's exact size (CL2, CO5)", () => {
  test("from names and sizes as core's writer lays the pack out", async () => {
    write("Dockerfile", "FROM scratch\n")
    write("src/a.ts", "a".repeat(511))
    write("src/b.ts", "b".repeat(512))
    write("src/c.ts", "c".repeat(513))
    write("empty.txt", "")
    mkdirSync(join(root, "assets"))
    const found = walk()
    let tar = 0
    const spooled = await spoolPack(found.entries, (bytes) => {
      tar += bytes.length
    })
    expect(spooled).toBe(tar)
    expect(packSize(found.entries)).toBe(tar)
    expect(limitsOf(found)).toMatchObject({
      bytes: tar,
      entries: 7,
      files: 5,
    })
  })

  test("an empty pack is two zero blocks", () => {
    expect(packSize([])).toBe(1024)
  })
})

describe("B4 and B12 (CL2, FR-017, FR-018)", () => {
  test("the three largest top-level folders by the bytes they add to the pack, a top-level file not among them", () => {
    write("Dockerfile")
    sparse("big.sql", 50 * MB)
    sparse("src/a.ts", 9 * MiB)
    sparse("public/b.png", 6 * MiB)
    sparse("prisma/c.db", 1 * MiB)
    write("docs/d.md", "d")
    const limits = limitsOf(walk())
    expect(limits.largest.map(({ folder }) => folder)).toEqual([
      "src",
      "public",
      "prisma",
    ])
    // A folder's header, then the file's header and its data padded to blocks.
    expect(limits.largest[0]).toEqual({
      folder: "src",
      bytes: 512 + 512 + 9 * MiB,
    })
  })

  test("no warning at or below 100 MB, B12 with the largest folders above it", () => {
    write("Dockerfile")
    sparse("data/a.bin", 99 * MB)
    expect(sizeWarning(limitsOf(walk()))).toBeUndefined()
    sparse("public/b.bin", 2 * MB)
    const limits = limitsOf(walk())
    expect(limits.bytes).toBeGreaterThan(WARN_BYTES)
    expect(sizeWarning(limits)).toEqual({
      id: "B12",
      bytes: limits.bytes,
      largest: [...limits.largest],
    })
    expect(() => checkLimits(walk())).not.toThrow()
  })
})

describe("stops before signing (CL2, C1 to C4)", () => {
  test("an empty folder is C3", () => {
    expect(stopOf(() => checkLimits(walk()))).toEqual({ id: "C3" })
    mkdirSync(join(root, "nothing"))
    expect(stopOf(() => checkLimits(walk()))).toEqual({ id: "C3" })
  })

  test("every file left out is C4", () => {
    write(".env", "TOKEN=1\n")
    write("config/.npmrc", "//registry/:_authToken=1\n")
    expect(stopOf(() => checkLimits(walk()))).toEqual({ id: "C4" })
  })

  test("sparse files past 512 MiB are C1, naming the largest folders by bytes", () => {
    write("Dockerfile")
    sparse("data/a.bin", 300 * MiB)
    sparse("data/b.bin", 200 * MiB)
    sparse("media/c.bin", 20 * MiB)
    sparse("src/d.ts", 1000)
    const found = walk()
    const limits = limitsOf(found)
    expect(limits.bytes).toBeGreaterThan(LIMITS.packBytes)
    expect(stopOf(() => checkLimits(found))).toEqual({
      id: "C1",
      bytes: limits.bytes,
      largest: [
        { folder: "data", bytes: 512 + 2 * 512 + 500 * MiB },
        { folder: "media", bytes: 512 + 512 + 20 * MiB },
        { folder: "src", bytes: 512 + 512 + 1024 },
      ],
    })
  })

  test("exactly 512 MiB passes", () => {
    // The pack's own blocks: the Dockerfile's header and block, the data's header and the end.
    write("Dockerfile")
    sparse("data", LIMITS.packBytes - 512 * 3 - 1024)
    const found = walk()
    expect(limitsOf(found).bytes).toBe(LIMITS.packBytes)
    expect(() => checkLimits(found)).not.toThrow()
  })

  test(
    "50,001 entries is C2, naming the folders with the most entries; 50,000 passes",
    () => {
      write("Dockerfile")
      mkdirSync(join(root, "many"))
      mkdirSync(join(root, "few"))
      // The Dockerfile, many/, few/ and the files: 49,997 in many/ make 50,000 entries.
      for (let at = 0; at < 49_997; at++)
        closeSync(openSync(join(root, "many", `f${at}`), "w"))
      expect(limitsOf(walk()).entries).toBe(50_000)
      expect(() => checkLimits(walk())).not.toThrow()

      write("few/a")
      const found = walk()
      expect(stopOf(() => checkLimits(found))).toEqual({
        id: "C2",
        entries: 50_001,
        largest: [
          { folder: "many", entries: 49_998 },
          { folder: "few", entries: 2 },
        ],
      })
    },
    { timeout: 120_000 }
  )
})
