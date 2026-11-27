/**
 * The reach of `source.root`, and the folders zekno never sends
 * (specs/016-build-from-source, contracts/cli.md CL1, "Reading", and CL2,
 * "The root"; FR-009; tasks T111): through real paths, the settings file's
 * folder, one inside it, or one above it up to the top of its git
 * repository, else C22; a link on the way that leads out, C23; a root that
 * is or holds the home folder or zekno's own, C21b in its four forms. Every
 * folder, `.git` and link is made by the test in a temporary folder; the home
 * and zekno's folder are passed in, never the real ones.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BuildStop } from "../../src/shared/build-lines"
import {
  checkReach,
  rootReach,
  rootRefusal,
} from "../../src/settings/build-reach"
import { readSettingsFile } from "../../src/settings/file"
import type { Settings } from "../../src/settings/types"

const FILE = "zekno.app.json"

let base: string
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "zekno-build-reach-")))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

/** Makes folders under `base`, and returns the path of the last. */
const folder = (...parts: string[]): string => {
  const path = join(base, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

/** A git repository's top: a `.git` folder made in it at run time (the repository cannot hold a nested one). */
const repository = (...parts: string[]): string => {
  const top = folder(...parts)
  mkdirSync(join(top, ".git"))
  return top
}

/** A settings file in `where`, with one built service whose root is `root`. */
const settingsIn = (where: string, root: string): string => {
  const path = join(where, FILE)
  writeFileSync(
    path,
    JSON.stringify({
      zekno: 1,
      services: { web: { source: { root }, build: { builder: "dockerfile" } } },
    })
  )
  return path
}

const built = (root: string): Settings => ({
  version: 1,
  services: [
    ["db", { image: "postgres:16" }],
    ["web", { root, build: { builder: "dockerfile" } }],
  ],
})

describe("rootReach: inside a git repository", () => {
  test("the settings file's folder, one inside it, and each folder above it up to the top are accepted", () => {
    const top = repository("repo")
    folder("repo", "apps", "web", "src")
    folder("repo", "packages", "ui")
    const file = join(base, "repo", "apps", "web", FILE)
    for (const [root, leads] of [
      [".", join(top, "apps", "web")],
      ["src", join(top, "apps", "web", "src")],
      ["./src/", join(top, "apps", "web", "src")],
      ["..", join(top, "apps")],
      ["../..", top],
      ["../../packages/ui", join(top, "packages", "ui")],
    ] as const)
      expect({ root, reach: rootReach(file, root) }).toEqual({
        root,
        reach: { folder: leads },
      })
  })

  test("C22: one above the top, its form in a repository", () => {
    repository("repo")
    folder("repo", "apps", "web")
    const file = join(base, "repo", "apps", "web", FILE)
    for (const root of ["../../..", "../../../repo-other", "../../../.."])
      expect(rootReach(file, root)).toEqual({ id: "C22", repository: true })
  })

  test("C23: a link on the way that leads out of the repository", () => {
    const outside = folder("elsewhere", "secrets")
    const web = folder("repo", "apps", "web")
    repository("repo")
    symlinkSync(join(base, "elsewhere"), join(web, "vendor"))
    const file = join(web, FILE)
    expect(rootReach(file, "vendor")).toEqual({ id: "C23" })
    expect(rootReach(file, "vendor/secrets")).toEqual({ id: "C23" })
    // A link whose `..` leads out, as the system resolves it.
    symlinkSync(outside, join(web, "deep"))
    expect(rootReach(file, "deep/..")).toEqual({ id: "C23" })
  })

  test("a link that stays inside the repository is followed and accepted", () => {
    const top = repository("repo")
    const shared = folder("repo", "shared")
    const web = folder("repo", "apps", "web")
    symlinkSync(shared, join(web, "shared"))
    expect(rootReach(join(web, FILE), "shared")).toEqual({
      folder: join(top, "shared"),
    })
  })

  test("a root not there yet is held to where it would be", () => {
    repository("repo")
    const web = folder("repo", "apps", "web")
    expect(rootReach(join(web, FILE), "not-yet/there")).toEqual({
      folder: join(web, "not-yet", "there"),
    })
    expect(rootReach(join(web, FILE), "../../../not-there")).toEqual({
      id: "C22",
      repository: true,
    })
  })
})

describe("rootReach: outside any git repository", () => {
  test("the settings file's folder and one inside it are accepted; one above is C22, its form outside a repository", () => {
    const web = folder("plain", "web")
    folder("plain", "web", "app")
    const file = join(web, FILE)
    expect(rootReach(file, ".")).toEqual({ folder: web })
    expect(rootReach(file, "app")).toEqual({ folder: join(web, "app") })
    expect(rootReach(file, "..")).toEqual({ id: "C22", repository: false })
    expect(rootReach(file, "app/../..")).toEqual({
      id: "C22",
      repository: false,
    })
  })

  test("C23: a link out of the settings file's folder", () => {
    const web = folder("plain", "web")
    folder("other")
    symlinkSync(join(base, "other"), join(web, "out"))
    expect(rootReach(join(web, FILE), "out")).toEqual({ id: "C23" })
  })

  test("an absolute root, or one with `\\`, is never followed: C22", () => {
    const web = folder("plain", "web")
    expect(rootReach(join(web, FILE), web)).toEqual({
      id: "C22",
      repository: false,
    })
    expect(rootReach(join(web, FILE), "a\\b")).toEqual({
      id: "C22",
      repository: false,
    })
  })
})

describe("checkReach: the reader's check right after the schema", () => {
  test("the first built service whose root breaks, by its id; a service that runs an image is not looked at", () => {
    const web = folder("plain", "web")
    const file = join(web, FILE)
    expect(checkReach(file, built("."))).toBeUndefined()
    expect(checkReach(file, built(".."))).toEqual({
      id: "C22",
      service: "web",
      repository: false,
    })
    folder("other")
    symlinkSync(join(base, "other"), join(web, "out"))
    expect(checkReach(file, built("out"))).toEqual({
      id: "C23",
      service: "web",
    })
    // A built service with no root sends the settings file's folder.
    expect(
      checkReach(file, {
        version: 1,
        services: [["web", { build: { builder: "dockerfile" } }]],
      })
    ).toBeUndefined()
  })

  test("read from the disk: a stop with exit status 1, the file and the service, the repository's form", () => {
    repository("repo")
    const web = folder("repo", "web")
    settingsIn(web, "../..")
    let thrown: unknown
    try {
      readSettingsFile({ kind: "default", folder: web }, web)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BuildStop)
    expect((thrown as BuildStop).line).toEqual({
      id: "C22",
      file: FILE,
      service: "web",
      repository: true,
    })
    expect((thrown as BuildStop).message).toBe("C22")
    settingsIn(web, "..")
    const read = readSettingsFile({ kind: "default", folder: web }, web)
    expect(read.settings.services[0]![1].root).toBe("..")
  })
})

describe("rootRefusal: never the home folder or zekno's own (C21b)", () => {
  test("a home folder made a git repository: a root reaching it passes the reach, and is C21b, `is` the home", () => {
    const home = repository("home", "ada")
    const zekno = folder("home", "ada", ".zekno")
    const project = folder("home", "ada", "code", "shop")
    const reach = rootReach(join(project, FILE), "../..")
    expect(reach).toEqual({ folder: home })
    expect(rootRefusal(home, home, zekno)).toEqual({
      id: "C21b",
      folder: home,
      relation: "is",
      whose: "home",
    })
  })

  test("a root that holds the home folder: C21b, `holds` the home", () => {
    const home = folder("Users", "ada")
    const zekno = folder("Users", "ada", ".zekno")
    expect(rootRefusal(join(base, "Users"), home, zekno)).toEqual({
      id: "C21b",
      folder: home,
      relation: "holds",
      whose: "home",
    })
  })

  test("zekno's own folder, by ZEKNO_HOME anywhere: C21b `is` and `holds` it", () => {
    const home = folder("Users", "ada")
    const zekno = folder("data", "zekno-home")
    expect(rootRefusal(zekno, home, zekno)).toEqual({
      id: "C21b",
      folder: zekno,
      relation: "is",
      whose: "zekno",
    })
    expect(rootRefusal(join(base, "data"), home, zekno)).toEqual({
      id: "C21b",
      folder: zekno,
      relation: "holds",
      whose: "zekno",
    })
  })

  test("compared by real path: a link to the home folder is the home folder; zekno's folder not made yet is compared where it would be", () => {
    const home = folder("Users", "ada")
    symlinkSync(home, join(base, "ada-link"))
    const zekno = join(home, ".zekno-not-made")
    expect(rootRefusal(join(base, "ada-link"), home, zekno)).toEqual({
      id: "C21b",
      folder: home,
      relation: "is",
      whose: "home",
    })
    expect(rootRefusal(home, join(base, "elsewhere"), zekno)).toEqual({
      id: "C21b",
      folder: zekno,
      relation: "holds",
      whose: "zekno",
    })
  })

  test("a project folder inside the home folder, beside zekno's, is no refusal", () => {
    const home = folder("Users", "ada")
    const zekno = folder("Users", "ada", ".zekno")
    const project = folder("Users", "ada", "code", "shop")
    expect(rootRefusal(project, home, zekno)).toBeUndefined()
    expect(rootRefusal(join(home, "code"), home, zekno)).toBeUndefined()
  })
})
