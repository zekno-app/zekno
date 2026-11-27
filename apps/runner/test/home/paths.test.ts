/**
 * The names and paths the runner uses for building from source
 * (specs/016-build-from-source, contracts/runner.md, "Names and paths the
 * runner uses"; FR-031, FR-047, FR-050; T062). Every path is worked out from
 * a temporary folder or from figures given to it: no test here touches the
 * real home, `/var/lib` or `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join, relative } from "node:path"

import {
  buildxConfig,
  defaultHome,
  defaultUnpacked,
  paths,
  unpackedDir,
  workFolder,
} from "../../src/home/home"
import { tempDir } from "../support/helpers"

const KEY = "ab".repeat(32)
const FINGERPRINT = "0123456789abcdef".repeat(4)

/** Runs `work` with `ZEKNO_RUNNER_UNPACKED` set to `root`, then puts the variable back as it was. */
function withUnpacked<T>(root: string, work: () => T): T {
  const before = process.env.ZEKNO_RUNNER_UNPACKED
  process.env.ZEKNO_RUNNER_UNPACKED = root
  try {
    return work()
  } finally {
    if (before === undefined) delete process.env.ZEKNO_RUNNER_UNPACKED
    else process.env.ZEKNO_RUNNER_UNPACKED = before
  }
}

const modeOf = (path: string) => statSync(path).mode & 0o777

describe("each path, for root and for another user", () => {
  const cases = [
    {
      who: "root",
      home: defaultHome({
        isRoot: true,
        userHome: "/root",
        userFolderSetUp: false,
        ownsSystemFolder: false,
      }),
      unpacked: defaultUnpacked({ isRoot: true, userHome: "/root" }),
      base: "/var/lib/zekno",
      unpackedAt: "/var/lib/zekno-unpacked",
    },
    {
      who: "another user",
      home: defaultHome({
        isRoot: false,
        userHome: "/home/ada",
        userFolderSetUp: false,
        ownsSystemFolder: false,
      }),
      unpacked: defaultUnpacked({ isRoot: false, userHome: "/home/ada" }),
      base: "/home/ada/.local/state/zekno",
      unpackedAt: "/home/ada/.local/state/zekno-unpacked",
    },
  ]
  for (const { who, home, unpacked, base, unpackedAt } of cases)
    test(who, () => {
      expect(home).toBe(base)
      const at = paths(home)
      expect(at.lock).toBe(`${base}/lock`)
      expect(at.stateLock).toBe(`${base}/state.lock`)
      expect(at.packs("web")).toBe(`${base}/packs/web`)
      expect(at.packDeploy("web")).toBe(`${base}/packs/web/deploy.json`)
      expect(at.packPiece("web", FINGERPRINT)).toBe(
        `${base}/packs/web/${FINGERPRINT}`
      )
      expect(at.building("web")).toBe(`${base}/building/web`)
      expect(at.kept("web", KEY)).toBe(`${base}/kept/web/${KEY}.json`)
      expect(at.buildx).toBe(`${base}/buildx`)
      expect(unpacked).toBe(unpackedAt)
      // Work folders are never under the runner's folder.
      expect(relative(home, unpacked)).toStartWith("..")
    })

  test("a user who owns the system folder still unpacks in their own folder", () => {
    expect(
      defaultHome({
        isRoot: false,
        userHome: "/home/ada",
        userFolderSetUp: false,
        ownsSystemFolder: true,
      })
    ).toBe("/var/lib/zekno")
    expect(defaultUnpacked({ isRoot: false, userHome: "/home/ada" })).toBe(
      "/home/ada/.local/state/zekno-unpacked"
    )
  })

  test("working the paths out makes nothing", () => {
    const home = tempDir("paths")
    const at = paths(home)
    void at.packs("web")
    void at.building("web")
    void at.kept("web", KEY)
    void at.buildx
    expect(readdirSync(home)).toEqual([])
  })
})

describe("a path is made of a checked app name and a checked key only", () => {
  const home = "/srv/zekno"
  const badApps = [
    "",
    "a/b",
    "..",
    "../web",
    "web/..",
    ".",
    "Web",
    "-web",
    "web.app",
    "web ",
    "a".repeat(64),
    "web\u0000",
  ]
  const badKeys = [
    "",
    "..",
    "../" + KEY.slice(3),
    KEY.toUpperCase(),
    KEY.slice(1),
    `${KEY}0`,
    `${KEY.slice(1)}/`,
    "deploy.json",
  ]

  test("an app name with /, .., or anything else outside core's pattern throws", () => {
    const at = paths(home)
    for (const app of badApps) {
      expect(() => at.packs(app)).toThrow()
      expect(() => at.packDeploy(app)).toThrow()
      expect(() => at.packPiece(app, FINGERPRINT)).toThrow()
      expect(() => at.building(app)).toThrow()
      expect(() => at.kept(app, KEY)).toThrow()
    }
  })

  test("a key or a fingerprint that is not 64 lowercase hex throws", () => {
    const at = paths(home)
    for (const key of badKeys) {
      expect(() => at.kept("web", key)).toThrow()
      expect(() => at.packPiece("web", key)).toThrow()
    }
  })

  test("names at the edge of core's pattern are taken", () => {
    const at = paths(home)
    for (const app of ["a", "0", "web-2", `a${"-".repeat(62)}`, "a".repeat(63)])
      expect(at.building(app)).toBe(`${home}/building/${app}`)
    // A value that is not text at all throws too.
    expect(() => at.packs(7 as unknown as string)).toThrow()
    expect(() => at.kept("web", null as unknown as string)).toThrow()
  })
})

describe("buildx's own folder", () => {
  test("is made on first use, mode 700, and given as an absolute path for BUILDX_CONFIG", () => {
    const home = tempDir("paths")
    expect(existsSync(join(home, "buildx"))).toBe(false)
    const config = buildxConfig(home)
    expect(config).toBe(join(home, "buildx"))
    expect(config.startsWith("/")).toBe(true)
    expect(statSync(config).isDirectory()).toBe(true)
    expect(modeOf(config)).toBe(0o700)
  })

  test("a second use leaves the folder and what buildx wrote in it as they are", () => {
    const home = tempDir("paths")
    const config = buildxConfig(home)
    mkdirSync(join(config, "refs"))
    writeFileSync(join(config, "refs", "ref"), "x")
    expect(buildxConfig(home)).toBe(config)
    expect(readFileSync(join(config, "refs", "ref"), "utf8")).toBe("x")
  })

  test("a relative folder of the runner's still gives an absolute path", () => {
    const home = tempDir("paths")
    const relativeHome = relative(process.cwd(), home)
    expect(buildxConfig(relativeHome)).toBe(join(home, "buildx"))
  })
})

describe("the folder for unpacked builds", () => {
  test("is ZEKNO_RUNNER_UNPACKED when set: made when it is not there, mode 700", () => {
    const root = join(tempDir("paths"), "unpacked")
    expect(withUnpacked(root, unpackedDir)).toBe(root)
    expect(modeOf(root)).toBe(0o700)
  })

  test("an unpacked folder others can write, or read, is refused, and left as it is", () => {
    for (const mode of [0o777, 0o770, 0o707, 0o750, 0o705]) {
      const root = tempDir("paths")
      chmodSync(root, mode)
      try {
        expect(() => withUnpacked(root, unpackedDir)).toThrow()
        expect(() => withUnpacked(root, () => workFolder())).toThrow()
        expect(modeOf(root)).toBe(mode)
        expect(readdirSync(root)).toEqual([])
      } finally {
        chmodSync(root, 0o700)
      }
    }
  })

  test("a private folder already there is taken as it is", () => {
    const root = tempDir("paths")
    chmodSync(root, 0o700)
    writeFileSync(join(root, "left"), "x")
    expect(withUnpacked(root, unpackedDir)).toBe(root)
    expect(readdirSync(root)).toEqual(["left"])
  })
})

describe("work folders", () => {
  test("each is a new folder of 24 hex in the unpacked folder, mode 700", () => {
    const root = join(tempDir("paths"), "unpacked")
    const made = withUnpacked(root, () => workFolder())
    expect(relative(root, made)).toMatch(/^[0-9a-f]{24}$/)
    expect(statSync(made).isDirectory()).toBe(true)
    expect(modeOf(made)).toBe(0o700)
    expect(readdirSync(made)).toEqual([])
    expect(modeOf(root)).toBe(0o700)
  })

  test("two work folders never share a name", () => {
    const root = tempDir("paths")
    chmodSync(root, 0o700)
    const made = withUnpacked(root, () =>
      Array.from({ length: 50 }, () => workFolder())
    )
    expect(new Set(made).size).toBe(50)
    expect(readdirSync(root).sort()).toEqual(
      made.map((path) => relative(root, path)).sort()
    )
  })

  test("a folder already there is never used again: the next name is tried, and the folder is left as it was", () => {
    const root = tempDir("paths")
    chmodSync(root, 0o700)
    const taken = "a".repeat(24)
    mkdirSync(join(root, taken), { mode: 0o755 })
    writeFileSync(join(root, taken, "theirs"), "x")
    const names = [taken, taken, "b".repeat(24)]
    const made = withUnpacked(root, () => workFolder(() => names.shift()!))
    expect(made).toBe(join(root, "b".repeat(24)))
    expect(names).toEqual([])
    expect(readdirSync(join(root, taken))).toEqual(["theirs"])
    expect(modeOf(join(root, taken))).toBe(0o755)
    expect(readdirSync(made)).toEqual([])
  })

  test("a name that is a file already there is tried again too", () => {
    const root = tempDir("paths")
    chmodSync(root, 0o700)
    const taken = "c".repeat(24)
    writeFileSync(join(root, taken), "x")
    const names = [taken, "d".repeat(24)]
    const made = withUnpacked(root, () => workFolder(() => names.shift()!))
    expect(made).toBe(join(root, "d".repeat(24)))
    expect(readFileSync(join(root, taken), "utf8")).toBe("x")
  })
})

describe("home.ts", () => {
  test("stays under 500 lines", () => {
    const text = readFileSync(
      join(import.meta.dir, "../../src/home/home.ts"),
      "utf8"
    )
    expect(text.split("\n").length).toBeLessThan(500)
  })
})
