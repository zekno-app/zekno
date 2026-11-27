/**
 * The answers kept on this machine (specs/016-build-from-source,
 * data-model.md, "Answers kept on this machine"; contracts/cli.md CL5,
 * "Kept answers"; tasks T109): `agreed.json` in the profile folder, its
 * kinds `folders`, `files` and `secrets`, mode 600, written whole, at most
 * 1,024 entries of each kind with the oldest dropped, a damaged file
 * counted as empty, and a link in its place replaced, never written
 * through. Each test has a profile folder of its own, never `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  agree,
  AGREED_BYTES,
  AGREED_FILE,
  AGREED_KEPT,
  AGREED_PATH,
  isAgreed,
  readAgreed,
  type Agreed,
} from "../../src/profile/agreed"

const home = () => mkdtempSync(join(tmpdir(), "zekno-agreed-"))
const mode = (path: string) => statSync(path).mode & 0o777
const NONE: Agreed = { folders: [], files: [], secrets: [] }

const FOLDER = { folder: "/work/shop", settings: "/work/shop/zekno.app.json" }
const FILE = { folder: "/work/shop", path: "config/.env.production" }
const SECRET = {
  server: `srv_${"a".repeat(32)}`,
  app: "shop",
  service: "web",
  name: "NPM_TOKEN",
}

/** Writes the file as something other than zekno might. */
const planted = (at: string, text: string) =>
  writeFileSync(join(at, AGREED_FILE), text)

describe("agree and readAgreed", () => {
  test("each kind written, mode 600, read back; nothing else in the profile folder", () => {
    const at = home()
    expect(readAgreed(at)).toEqual(NONE)
    agree(at, "folders", FOLDER)
    agree(at, "files", FILE)
    agree(at, "secrets", SECRET)
    expect(readAgreed(at)).toEqual({
      folders: [FOLDER],
      files: [FILE],
      secrets: [SECRET],
    })
    expect(mode(join(at, AGREED_FILE))).toBe(0o600)
    expect(readdirSync(at)).toEqual([AGREED_FILE])
    expect(isAgreed(at, "folders", FOLDER)).toBe(true)
    expect(isAgreed(at, "files", FILE)).toBe(true)
    expect(isAgreed(at, "secrets", SECRET)).toBe(true)
    // Every field counts: the same folder with another settings file, or another service's secret, is not agreed.
    expect(
      isAgreed(at, "folders", { ...FOLDER, settings: "/work/shop/other.json" })
    ).toBe(false)
    expect(isAgreed(at, "secrets", { ...SECRET, service: "worker" })).toBe(
      false
    )
  })

  test("the same answer twice is kept once, as the newest", () => {
    const at = home()
    const other = {
      folder: "/work/blog",
      settings: "/work/blog/zekno.app.json",
    }
    agree(at, "folders", FOLDER)
    agree(at, "folders", other)
    agree(at, "folders", FOLDER)
    expect(readAgreed(at).folders).toEqual([other, FOLDER])
  })
})

describe("the bounds", () => {
  test("at most 1,024 entries of each kind, the oldest dropped; the other kinds untouched", () => {
    const at = home()
    agree(at, "files", FILE)
    const folders = Array.from({ length: AGREED_KEPT }, (_, index) => ({
      folder: `/work/${index}`,
      settings: `/work/${index}/zekno.app.json`,
    }))
    writeFileSync(
      join(at, AGREED_FILE),
      JSON.stringify({ folders, files: [FILE], secrets: [] })
    )
    agree(at, "folders", FOLDER)
    const read = readAgreed(at)
    expect(read.folders).toHaveLength(AGREED_KEPT)
    expect(read.folders[0]).toEqual(folders[1]!)
    expect(read.folders.at(-1)).toEqual(FOLDER)
    expect(read.files).toEqual([FILE])
  })

  test("past its bytes, the oldest of the largest kind are left out until it can be read back", () => {
    const at = home()
    // Paths of the longest length taken, so 1,024 folders would not fit in the bytes.
    const long = (index: number, kind: string) =>
      `/${kind}/${String(index).padStart(4, "0")}/`.padEnd(AGREED_PATH, "x")
    const entry = (index: number) => ({
      folder: long(index, "f"),
      settings: long(index, "s"),
    })
    // As many as fit in the bytes, beside one secret: every entry is as long as the first.
    const count = Math.floor(
      (AGREED_BYTES - JSON.stringify({ ...NONE, secrets: [SECRET] }).length) /
        (JSON.stringify(entry(0)).length + 1)
    )
    expect(count).toBeLessThan(AGREED_KEPT)
    const folders = Array.from({ length: count }, (_, index) => entry(index))
    planted(at, JSON.stringify({ ...NONE, folders, secrets: [SECRET] }))
    expect(readAgreed(at).folders).toHaveLength(count)
    // One more folder, and the file would pass its bytes: the oldest go, the newest and the other kinds stay.
    agree(at, "folders", entry(count))
    expect(statSync(join(at, AGREED_FILE)).size).toBeLessThanOrEqual(
      AGREED_BYTES
    )
    const read = readAgreed(at)
    expect(read.folders.length).toBeLessThan(count + 1)
    expect(read.folders.length).toBeGreaterThan(count / 2)
    expect(read.folders[0]).not.toEqual(entry(0))
    expect(read.folders.at(-1)).toEqual(entry(count))
    expect(read.secrets).toEqual([SECRET])
  })
})

describe("a damaged file counts as empty", () => {
  const cases: [string, (at: string) => void][] = [
    ["not JSON", (at) => planted(at, "{")],
    [
      "not UTF-8",
      (at) => writeFileSync(join(at, AGREED_FILE), Buffer.from([0xff, 0xfe])),
    ],
    ["another shape", (at) => planted(at, JSON.stringify([FOLDER]))],
    [
      "a kind missing",
      (at) => planted(at, JSON.stringify({ folders: [FOLDER], files: [] })),
    ],
    [
      "a field it does not know",
      (at) =>
        planted(
          at,
          JSON.stringify({ ...NONE, folders: [{ ...FOLDER, extra: 1 }] })
        ),
    ],
    [
      "a secret whose server is not a server id",
      (at) =>
        planted(
          at,
          JSON.stringify({ ...NONE, secrets: [{ ...SECRET, server: "prod" }] })
        ),
    ],
    [
      "more than 1,024 entries of a kind",
      (at) =>
        planted(
          at,
          JSON.stringify({
            ...NONE,
            files: Array.from({ length: AGREED_KEPT + 1 }, () => FILE),
          })
        ),
    ],
    [
      "past its bytes",
      (at) =>
        planted(
          at,
          JSON.stringify({ ...NONE, files: [FILE] }) + " ".repeat(AGREED_BYTES)
        ),
    ],
    ["a folder", (at) => mkdirSync(join(at, AGREED_FILE))],
    [
      "a pipe, never waited on",
      (at) => {
        const made = Bun.spawnSync(["mkfifo", join(at, AGREED_FILE)])
        expect(made.exitCode).toBe(0)
      },
    ],
  ]
  for (const [name, plant] of cases)
    test(name, () => {
      const at = home()
      plant(at)
      expect(readAgreed(at)).toEqual(NONE)
      expect(isAgreed(at, "folders", FOLDER)).toBe(false)
    })

  test("the next answer replaces a damaged file whole", () => {
    const at = home()
    planted(at, "{")
    agree(at, "files", FILE)
    expect(readAgreed(at)).toEqual({ ...NONE, files: [FILE] })
  })
})

describe("a link in its place", () => {
  test("is not read through, and the next answer replaces it with a file; what it pointed to is untouched", () => {
    const at = home()
    const elsewhere = join(home(), "agreed-elsewhere.json")
    const text = JSON.stringify({ ...NONE, folders: [FOLDER] })
    writeFileSync(elsewhere, text)
    symlinkSync(elsewhere, join(at, AGREED_FILE))
    expect(readAgreed(at)).toEqual(NONE)
    agree(at, "files", FILE)
    expect(lstatSync(join(at, AGREED_FILE)).isFile()).toBe(true)
    expect(readAgreed(at)).toEqual({ ...NONE, files: [FILE] })
    expect(readFileSync(elsewhere, "utf8")).toBe(text)
  })
})
