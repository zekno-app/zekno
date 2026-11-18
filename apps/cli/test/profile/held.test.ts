/**
 * What this machine remembers of a server (specs/014-deploy-v2,
 * data-model.md, "What this machine remembers of the server"; research R9;
 * tasks T077): `held/<serverId>/<app>.json`, the statements and versions the
 * runner reported to the last version-2 deploy of the app. Written whole as
 * every profile file is; read as a floor only, so anything that does not
 * read is empty, never an error.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
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

import { profileStore, type Held } from "../../src/profile/profile"
import { signingTeam } from "../support/signing-team"

const SERVER = "srv_0123456789abcdef0123456789abcdef"
const EMPTY: Held = { statements: [], versions: [] }

const home = () => mkdtempSync(join(tmpdir(), "zekno-held-"))
const fileOf = (at: string, app = "demo") =>
  join(at, "held", SERVER, `${app}.json`)
const mode = (path: string) => statSync(path).mode & 0o777

/** What a version-2 deploy keeps: two statements of the runner's and the app's versions. */
async function remembered(): Promise<Held> {
  const t = await signingTeam()
  const one = await t.secret("DATABASE_URL", "postgres://demo", 3)
  const two = await t.secret("PAYMENTS_KEY", "demo-key", 1)
  return {
    statements: [one.envelope, two.envelope],
    versions: [
      { name: "DATABASE_URL", version: 3, removed: false },
      { name: "OLD", version: 2, removed: true },
      { name: "PAYMENTS_KEY", version: 1, removed: false },
    ],
  }
}

/** Writes `json` where the file goes, as something other than zekno might. */
function planted(at: string, json: unknown, app = "demo"): void {
  mkdirSync(join(at, "held", SERVER), { recursive: true })
  writeFileSync(
    fileOf(at, app),
    typeof json === "string" ? json : JSON.stringify(json)
  )
}

describe("saveHeld and held", () => {
  test("written to held/<serverId>/<app>.json, mode 0600 in 0700 folders, and read back", async () => {
    const at = home()
    const store = profileStore(at)
    const held = await remembered()
    store.saveHeld(SERVER, "demo", held)
    expect(mode(fileOf(at))).toBe(0o600)
    expect(mode(join(at, "held"))).toBe(0o700)
    expect(mode(join(at, "held", SERVER))).toBe(0o700)
    expect(mode(at)).toBe(0o700)
    expect(store.held(SERVER, "demo")).toEqual(held)
    // Another app of the same server is its own file.
    expect(store.held(SERVER, "shop")).toEqual(EMPTY)
  })

  test("a second save replaces the file whole", async () => {
    const at = home()
    const store = profileStore(at)
    store.saveHeld(SERVER, "demo", await remembered())
    const after: Held = {
      statements: [],
      versions: [{ name: "DATABASE_URL", version: 4, removed: true }],
    }
    store.saveHeld(SERVER, "demo", after)
    expect(store.held(SERVER, "demo")).toEqual(after)
    expect(JSON.parse(readFileSync(fileOf(at), "utf8"))).toEqual(after)
  })

  test("through a new file and a rename: a link at the path is replaced, not written through, and no temporary file is left", async () => {
    const at = home()
    const store = profileStore(at)
    const outside = join(at, "outside.json")
    writeFileSync(outside, "kept\n")
    mkdirSync(join(at, "held", SERVER), { recursive: true })
    symlinkSync(outside, fileOf(at))
    store.saveHeld(SERVER, "demo", await remembered())
    expect(readFileSync(outside, "utf8")).toBe("kept\n")
    expect(lstatSync(fileOf(at)).isSymbolicLink()).toBe(false)
    expect(readdirSync(join(at, "held", SERVER))).toEqual(["demo.json"])
  })

  test("a write that fails leaves no temporary file and says which file", async () => {
    const at = home()
    const store = profileStore(at)
    // A folder where the file goes: the rename cannot replace it.
    mkdirSync(fileOf(at), { recursive: true })
    expect(() => store.saveHeld(SERVER, "demo", EMPTY)).toThrow(
      `Could not write ${fileOf(at)}.`
    )
    expect(readdirSync(join(at, "held", SERVER))).toEqual(["demo.json"])
    expect(store.held(SERVER, "demo")).toEqual(EMPTY)
  })

  test("a missing file, and a missing folder, read as empty", () => {
    const at = home()
    expect(profileStore(at).held(SERVER, "demo")).toEqual(EMPTY)
    expect(existsSync(join(at, "held"))).toBe(false)
  })

  test("anything that does not match reads as empty, never an error", async () => {
    const good = await remembered()
    const statement = good.statements[0]!
    const version = good.versions[0]!
    const cases: [string, unknown][] = [
      ["not JSON", "{not json"],
      ["an empty file", ""],
      ["null", null],
      ["a list", []],
      ["an unknown field", { ...good, secrets: [] }],
      ["no versions", { statements: good.statements }],
      ["no statements", { versions: good.versions }],
      ["a statement that is not an envelope", { ...good, statements: [{}] }],
      [
        "a 257th statement",
        { ...good, statements: Array(257).fill(statement) },
      ],
      [
        "a statement whose payload is longer than 4,096 characters",
        {
          ...good,
          statements: [{ ...statement, payload: "A".repeat(4097) }],
        },
      ],
      ["an 8,193rd version", { ...good, versions: Array(8193).fill(version) }],
      [
        "a name that breaks the name rule",
        { ...good, versions: [{ ...version, name: "1ABC" }] },
      ],
      [
        "a name longer than 128 characters",
        { ...good, versions: [{ ...version, name: "A".repeat(129) }] },
      ],
      ["a version of 0", { ...good, versions: [{ ...version, version: 0 }] }],
      [
        "a version past 2^53 - 1",
        {
          ...good,
          versions: [{ ...version, version: Number.MAX_SAFE_INTEGER + 2 }],
        },
      ],
      [
        "a version that is not whole",
        { ...good, versions: [{ ...version, version: 1.5 }] },
      ],
      [
        "an unknown field in a version",
        { ...good, versions: [{ ...version, value: "x" }] },
      ],
    ]
    for (const [what, json] of cases) {
      const at = home()
      planted(at, json)
      expect({ what, read: profileStore(at).held(SERVER, "demo") }).toEqual({
        what,
        read: EMPTY,
      })
    }
  })

  test("at the bounds: 256 statements of 4,096 characters and 8,192 versions read", async () => {
    const good = await remembered()
    const statement = good.statements[0]!
    const at = home()
    const full: Held = {
      statements: Array(256).fill({ ...statement, payload: "A".repeat(4096) }),
      versions: Array(8192).fill({
        name: "A".repeat(128),
        version: Number.MAX_SAFE_INTEGER,
        removed: false,
      }),
    }
    planted(at, full)
    expect(profileStore(at).held(SERVER, "demo")).toEqual(full)
  })

  test("a file that cannot be read, such as a folder where it goes, reads as empty", () => {
    const at = home()
    mkdirSync(fileOf(at), { recursive: true })
    expect(profileStore(at).held(SERVER, "demo")).toEqual(EMPTY)
  })
})
