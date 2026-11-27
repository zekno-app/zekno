/**
 * Staging (specs/016-build-from-source, contracts/runner.md RB2 steps 4 and
 * 6; data-model.md, "Staging and work folders"; FR-028, FR-069): one
 * deploy's sealed pieces in `packs/<app>/`, named by fingerprint, beside a
 * `deploy.json` naming the deploy; another deploy's piece replaces them;
 * the cleaning of deploys that can no longer run, of pieces older than 24
 * hours and of staging past 2 GiB. The clock is passed in. No piece is
 * opened, and `building/` is never touched.
 */
import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  cleanPacks,
  readStagedDeploy,
  stagedBytes,
  stagedFor,
  stagePiece,
} from "../../src/pack/stage"
import { tempDir } from "../support/helpers"

const MIB = 1024 * 1024
const HOUR_MS = 60 * 60 * 1000
const T0 = new Date("2026-11-28T10:00:00.000Z")
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR_MS)

/** 64 hex characters made of one: a payload's hash or a fingerprint. */
const hex = (c: string) => c.repeat(64)
const A = { payload: hex("a"), previous: 4 }
const B = { payload: hex("b"), previous: 4 }
const piece = (byte: number, length = 16) => new Uint8Array(length).fill(byte)

const folder = (dir: string, app: string) => join(dir, "packs", app)
const listed = (dir: string, app: string) =>
  existsSync(folder(dir, app)) ? readdirSync(folder(dir, app)).sort() : []

describe("stagePiece", () => {
  test("writes the piece by its fingerprint, mode 600, beside the file that names its deploy", () => {
    const dir = tempDir("stage")
    const sealed = piece(7, 300)
    stagePiece(dir, "web", A, hex("1"), sealed, T0)
    const path = join(folder(dir, "web"), hex("1"))
    expect(new Uint8Array(readFileSync(path))).toEqual(sealed)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(folder(dir, "web")).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, "packs")).mode & 0o777).toBe(0o700)
    expect(
      JSON.parse(readFileSync(join(folder(dir, "web"), "deploy.json"), "utf8"))
    ).toEqual({ payload: hex("a"), previous: 4, staged: T0.toISOString() })
    expect(statSync(join(folder(dir, "web"), "deploy.json")).mode & 0o777).toBe(
      0o600
    )
    expect(readStagedDeploy(dir, "web")).toEqual({
      payload: hex("a"),
      previous: 4,
      staged: T0.toISOString(),
    })
  })

  test("a second piece of the same deploy joins the first and keeps when it was first staged", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    stagePiece(dir, "web", A, hex("2"), piece(2), at(1))
    expect(stagedFor(dir, "web", A.payload)).toEqual([hex("1"), hex("2")])
    expect(readStagedDeploy(dir, "web")?.staged).toBe(T0.toISOString())
  })

  test("a second deploy's piece empties the first's", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    stagePiece(dir, "web", A, hex("2"), piece(2), T0)
    stagePiece(dir, "web", B, hex("3"), piece(3), at(1))
    expect(listed(dir, "web")).toEqual([hex("3"), "deploy.json"])
    expect(stagedFor(dir, "web", A.payload)).toEqual([])
    expect(stagedFor(dir, "web", B.payload)).toEqual([hex("3")])
    expect(readStagedDeploy(dir, "web")).toEqual({
      ...B,
      staged: at(1).toISOString(),
    })
  })

  test("another app's pieces are left alone", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    stagePiece(dir, "api", B, hex("2"), piece(2), T0)
    expect(stagedFor(dir, "web", A.payload)).toEqual([hex("1")])
    expect(stagedFor(dir, "api", B.payload)).toEqual([hex("2")])
  })

  test("a damaged deploy.json empties the folder before the piece is written", () => {
    for (const damaged of [
      "{",
      "null",
      JSON.stringify({ payload: hex("a"), previous: 4 }),
      JSON.stringify({ ...A, staged: T0.toISOString(), extra: 1 }),
      JSON.stringify({ ...A, payload: "A".repeat(64), staged: "x" }),
      JSON.stringify({ ...A, previous: -1, staged: T0.toISOString() }),
      JSON.stringify({ ...A, previous: 1.5, staged: T0.toISOString() }),
      JSON.stringify({ ...A, staged: "yesterday" }),
    ]) {
      const dir = tempDir("stage")
      stagePiece(dir, "web", A, hex("1"), piece(1), T0)
      writeFileSync(join(folder(dir, "web"), "deploy.json"), damaged)
      expect(readStagedDeploy(dir, "web")).toBeUndefined()
      expect(stagedFor(dir, "web", A.payload)).toEqual([])
      stagePiece(dir, "web", A, hex("2"), piece(2), at(1))
      expect(listed(dir, "web")).toEqual([hex("2"), "deploy.json"])
    }
  })

  test("a fingerprint that is not 64 hex throws, and nothing is written", () => {
    const dir = tempDir("stage")
    for (const bad of [
      "",
      hex("a").slice(1),
      `${hex("a")}0`,
      "A".repeat(64),
      `../${"a".repeat(61)}`,
      "deploy.json",
    ])
      expect(() => stagePiece(dir, "web", A, bad, piece(1), T0)).toThrow()
    expect(existsSync(join(dir, "packs"))).toBe(false)
  })

  test("an app name or a deploy outside its pattern throws", () => {
    const dir = tempDir("stage")
    for (const app of ["", "../web", "Web", "a/b", ".."])
      expect(() => stagePiece(dir, app, A, hex("1"), piece(1), T0)).toThrow()
    expect(() =>
      stagePiece(dir, "web", { payload: "x", previous: 4 }, hex("1"), piece(1))
    ).toThrow()
    expect(() =>
      stagePiece(dir, "web", { ...A, previous: -1 }, hex("1"), piece(1))
    ).toThrow()
    expect(existsSync(join(dir, "packs"))).toBe(false)
  })
})

describe("stagedFor and stagedBytes", () => {
  test("lists only that deploy's pieces, and counts every app's pieces", () => {
    const dir = tempDir("stage")
    expect(stagedFor(dir, "web", A.payload)).toEqual([])
    expect(stagedBytes(dir)).toBe(0)
    stagePiece(dir, "web", A, hex("2"), piece(2, 100), T0)
    stagePiece(dir, "web", A, hex("1"), piece(1, 50), T0)
    stagePiece(dir, "api", B, hex("3"), piece(3, 7), T0)
    expect(stagedFor(dir, "web", A.payload)).toEqual([hex("1"), hex("2")])
    expect(stagedFor(dir, "web", B.payload)).toEqual([])
    expect(stagedBytes(dir)).toBe(157)
  })

  test("a file that is not a piece is not listed or counted", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1, 10), T0)
    writeFileSync(join(folder(dir, "web"), `${hex("2")}.x.tmp`), "left")
    mkdirSync(join(folder(dir, "web"), hex("3")))
    expect(stagedFor(dir, "web", A.payload)).toEqual([hex("1")])
    expect(stagedBytes(dir)).toBe(10)
  })
})

describe("cleanPacks", () => {
  test("deletes the pieces of a deploy that can no longer run: its previous is not the app's last number", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    stagePiece(
      dir,
      "api",
      { payload: hex("b"), previous: 0 },
      hex("2"),
      piece(2),
      T0
    )
    cleanPacks(dir, { lastSequence: { web: 4 } }, T0)
    expect(stagedFor(dir, "web", A.payload)).toEqual([hex("1")])
    // An app the state does not know yet is at 0: its first deploy can still run.
    expect(stagedFor(dir, "api", hex("b"))).toEqual([hex("2")])
    cleanPacks(dir, { lastSequence: { web: 5, api: 1 } }, T0)
    expect(listed(dir, "web")).toEqual([])
    expect(listed(dir, "api")).toEqual([])
    expect(stagedBytes(dir)).toBe(0)
  })

  test("deletes pieces older than 24 hours, and keeps those exactly 24 hours old", () => {
    const dir = tempDir("stage")
    const state = { lastSequence: { web: 4, api: 4 } }
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    stagePiece(dir, "api", B, hex("2"), piece(2), at(1))
    expect<number>(LIMITS.stagingSeconds).toBe(24 * 60 * 60)
    cleanPacks(dir, state, at(24))
    expect(stagedFor(dir, "web", A.payload)).toEqual([hex("1")])
    cleanPacks(dir, state, new Date(at(24).getTime() + 1))
    expect(listed(dir, "web")).toEqual([])
    expect(stagedFor(dir, "api", B.payload)).toEqual([hex("2")])
  })

  test("past 2 GiB in all, deletes the oldest deploys' pieces first until staging is within it", () => {
    const dir = tempDir("stage")
    const state = { lastSequence: { a: 4, b: 4, c: 4 } }
    // Sparse files: their size counts, and no disk is used.
    const grow = (app: string, fingerprint: string, bytes: number) =>
      truncateSync(join(folder(dir, app), fingerprint), bytes)
    stagePiece(dir, "b", A, hex("1"), piece(1), at(1))
    stagePiece(dir, "a", A, hex("2"), piece(2), T0)
    stagePiece(dir, "c", A, hex("3"), piece(3), at(2))
    grow("a", hex("2"), 900 * MIB)
    grow("b", hex("1"), 900 * MIB)
    grow("c", hex("3"), 900 * MIB)
    expect(LIMITS.stagingBytes).toBe(2048 * MIB)
    expect(stagedBytes(dir)).toBe(2700 * MIB)
    cleanPacks(dir, state, at(3))
    expect(listed(dir, "a")).toEqual([])
    expect(stagedFor(dir, "b", A.payload)).toEqual([hex("1")])
    expect(stagedFor(dir, "c", A.payload)).toEqual([hex("3")])
    expect(stagedBytes(dir)).toBe(1800 * MIB)
    // Exactly 2 GiB is within it.
    grow("c", hex("3"), 2048 * MIB - 900 * MIB)
    cleanPacks(dir, state, at(3))
    expect(stagedBytes(dir)).toBe(2048 * MIB)
  })

  test("a damaged deploy.json empties the folder", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    writeFileSync(join(folder(dir, "web"), "deploy.json"), "not json")
    cleanPacks(dir, { lastSequence: { web: 4 } }, T0)
    expect(listed(dir, "web")).toEqual([])
    expect(stagedBytes(dir)).toBe(0)
  })

  test("pieces with no deploy.json, leftovers of a write cut short, and entries that are no app's are deleted", () => {
    const dir = tempDir("stage")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    writeFileSync(join(folder(dir, "web"), `${hex("2")}.abc.tmp`), "cut")
    mkdirSync(join(dir, "packs", "api"))
    writeFileSync(join(dir, "packs", "api", hex("3")), "no deploy file")
    writeFileSync(join(dir, "packs", "stray"), "x")
    mkdirSync(join(dir, "packs", "Not-An-App"))
    cleanPacks(dir, { lastSequence: { web: 4, api: 4 } }, T0)
    expect(listed(dir, "web")).toEqual([hex("1"), "deploy.json"])
    expect(listed(dir, "api")).toEqual([])
    expect(readdirSync(join(dir, "packs")).sort()).toEqual(["web"])
  })

  test("building/ is left alone", () => {
    const dir = tempDir("stage")
    const building = join(dir, "building", "web")
    mkdirSync(building, { recursive: true })
    writeFileSync(join(building, hex("9")), "being checked")
    stagePiece(dir, "web", A, hex("1"), piece(1), T0)
    stagePiece(dir, "web", B, hex("2"), piece(2), T0)
    cleanPacks(dir, { lastSequence: { web: 9 } }, at(48))
    expect(listed(dir, "web")).toEqual([])
    expect(readFileSync(join(building, hex("9")), "utf8")).toBe("being checked")
  })

  test("nothing staged: nothing to do", () => {
    const dir = tempDir("stage")
    cleanPacks(dir, { lastSequence: {} }, T0)
    expect(existsSync(join(dir, "packs"))).toBe(false)
  })
})
