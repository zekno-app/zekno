/**
 * Pass 1: the walk (specs/016-build-from-source, contracts/cli.md CL2,
 * "Entries", "The Dockerfile's name", "Names", "Pass 1"; FR-013, FR-014,
 * FR-015, FR-018; tasks T116). Every fixture is written at run time in a
 * temporary folder: links, a FIFO, names with control characters and names
 * the repository's `.gitignore` matches cannot be committed. No sentence is
 * checked: a stop is checked by its id and values.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { compareNames } from "@workspace/core"

import { BuildStop, type BuildLine } from "../../src/shared/build-lines"
import { readIgnoreFile } from "../../src/pack/ignore"
import {
  requireDockerfile,
  walkFolder,
  type Walk,
  type WalkOptions,
} from "../../src/pack/walk"

let root: string
let elsewhere: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-walk-")))
  elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "zekno-walk-out-")))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
})

/** Writes a file under the root, its folders made first. */
function write(path: string, content: string | Uint8Array = "x"): string {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

/** The walk of the root with its ignore file read as a deploy reads it. */
function walk(options: Partial<WalkOptions> = {}): Walk {
  const dockerfile =
    options.dockerfile === undefined ? "Dockerfile" : options.dockerfile
  return walkFolder(root, {
    dockerfile,
    ignore:
      options.ignore ??
      readIgnoreFile(
        root,
        dockerfile === null
          ? { builder: "railpack" }
          : { builder: "dockerfile", dockerfile }
      ),
    include: options.include ?? [],
    agreed: options.agreed ?? (() => false),
    zeknoHome: options.zeknoHome ?? join(elsewhere, "zekno-home"),
  })
}

const names = (found: Walk) => found.entries.map((entry) => entry.name)
const leftOut = (found: Walk) => found.leftOut.map((entry) => entry.path)

/** The line of the stop a call throws; fails when it throws something else or nothing. */
function stopOf(work: () => unknown): BuildLine {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(BuildStop)
    // Until the words tasks, the text said is the id (FR-092).
    expect((error as BuildStop).message).toBe((error as BuildStop).line.id)
    return (error as BuildStop).line
  }
  throw new Error("expected a stop")
}

describe("entries (CL2)", () => {
  test("files and folders, each by lstat, in the order of their UTF-8 bytes, with fixed modes", () => {
    write("Dockerfile", "FROM scratch\n")
    write("src/app.ts", "export {}\n")
    write("src/lib/util.ts", "")
    const run = write("bin/run.sh", "#!/bin/sh\n")
    chmodSync(run, 0o744)
    const other = write("bin/other.sh", "#!/bin/sh\n")
    // Only the owner's bit counts: a file others may run but its owner may not stays plain.
    chmodSync(other, 0o611)
    mkdirSync(join(root, "empty"))
    // UTF-16 order puts U+1F600 before U+FF5E; UTF-8 order, the pack's, does not.
    write("\u{1F600}.txt")
    write("～.txt")
    write("a-b")
    write("a/b")
    write("a0")

    const found = walk()
    expect(names(found)).toEqual([
      "Dockerfile",
      "a-b",
      "a/",
      "a/b",
      "a0",
      "bin/",
      "bin/other.sh",
      "bin/run.sh",
      "empty/",
      "src/",
      "src/app.ts",
      "src/lib/",
      "src/lib/util.ts",
      "～.txt",
      "\u{1F600}.txt",
    ])
    expect(names(found)).toEqual([...names(found)].sort(compareNames))
    const byName = new Map(found.entries.map((entry) => [entry.name, entry]))
    expect(byName.get("bin/run.sh")?.mode).toBe(0o755)
    expect(byName.get("bin/other.sh")?.mode).toBe(0o644)
    expect(byName.get("src/app.ts")?.mode).toBe(0o644)
    expect(byName.get("empty/")).toMatchObject({ kind: "folder", mode: 0o755 })
    expect(byName.get("src/app.ts")?.size).toBe(10)
    expect(found.leftOut).toEqual([])
    expect(found.dockerfileSent).toBe(true)
  })

  test("links in and out of the folder are never sent, never followed, and are listed with where they lead", () => {
    write("Dockerfile")
    write("src/a.txt", "a")
    writeFileSync(join(elsewhere, "secret.txt"), "outside")
    mkdirSync(join(elsewhere, "folder"))
    writeFileSync(join(elsewhere, "folder", "inner.txt"), "outside")
    symlinkSync("src/a.txt", join(root, "inside"))
    symlinkSync(join(elsewhere, "secret.txt"), join(root, "outside"))
    symlinkSync(join(elsewhere, "folder"), join(root, "shared"))
    symlinkSync("../../nowhere", join(root, "src", "dangling"))
    symlinkSync("../src", join(root, "src", "loop"))

    const found = walk()
    expect(names(found)).toEqual(["Dockerfile", "src/", "src/a.txt"])
    expect(found.leftOut).toEqual([
      { rule: "link", path: "inside", out: false },
      { rule: "link", path: "outside", out: true },
      { rule: "link", path: "shared", out: true },
      { rule: "link", path: "src/dangling", out: true },
      { rule: "link", path: "src/loop", out: false },
    ])
  })

  test("a FIFO is never opened nor sent, and is listed as not a file", () => {
    write("Dockerfile")
    const made = Bun.spawnSync(["mkfifo", join(root, "pipe")])
    expect(made.exitCode).toBe(0)
    const found = walk()
    expect(names(found)).toEqual(["Dockerfile"])
    expect(found.leftOut).toEqual([
      { rule: "not_a_file", path: "pipe", kind: "fifo" },
    ])
  })

  test("a link named in the ignore file is left out by it", () => {
    write("Dockerfile")
    write(".dockerignore", "outside\n")
    symlinkSync(elsewhere, join(root, "outside"))
    expect(walk().leftOut).toEqual([
      { rule: "ignore_file", path: "outside", folder: false },
    ])
  })
})

describe("names (CL2, C7)", () => {
  test("a name holding a control character stops with C7, its place cleaned", () => {
    write("Dockerfile")
    write("src/bad\u0001name.txt")
    expect(stopOf(() => walk())).toEqual({
      id: "C7",
      path: "src/bad?name.txt",
      why: "control_character",
    })
  })

  test("a name left out is shown with what drawing would hide cleaned: a right-to-left override, a zero-width space", () => {
    write("Dockerfile")
    write(".dockerignore", "ign*\n")
    write("ign‮evil")
    write("ign​zero")
    expect(leftOut(walk()).sort()).toEqual(["ign?evil", "ign?zero"])
  })

  test("a name with a control character that is not sent stops nothing", () => {
    write("Dockerfile")
    write(".dockerignore", "tmp\n")
    write("tmp/bad\u001bname.txt")
    expect(leftOut(walk())).toEqual(["tmp"])
  })

  test("a name that is not valid UTF-8 stops with C7, where the file system holds one", () => {
    write("Dockerfile")
    const bad = Buffer.concat([
      Buffer.from(`${root}/caf`),
      Buffer.from([0xe9]),
      Buffer.from(".txt"),
    ])
    try {
      writeFileSync(bad, "x")
    } catch {
      // APFS and HFS+ hold only valid UTF-8 names: there is nothing to walk.
      return
    }
    expect(stopOf(() => walk())).toEqual({
      id: "C7",
      path: "caf?.txt",
      why: "not_utf8",
    })
  })

  test("a file whose name is 100 bytes is sent; a folder whose last part is 100 bytes is C7, its / counted", () => {
    write("Dockerfile")
    const hundred = "n".repeat(100)
    write(hundred)
    expect(names(walk())).toContain(hundred)
    write(`deep/${hundred}/file.txt`)
    expect(stopOf(() => walk())).toEqual({
      id: "C7",
      path: `deep/${hundred}`,
      why: "too_long",
    })
  })

  test("a path with no split point stops with C7", () => {
    write("Dockerfile")
    write(`a/${"p".repeat(160)}/${"q".repeat(90)}`)
    const line = stopOf(() => walk())
    expect(line).toMatchObject({ id: "C7", why: "too_long" })
  })
})

describe("the ignore file (CL2, FR-013)", () => {
  test("an excluded folder with no exception under it is left out whole and not entered", () => {
    write("Dockerfile")
    write(".dockerignore", "logs\n")
    write("logs/a.txt")
    write("logs/deep/b.txt")
    const found = walk()
    expect(names(found)).toEqual([".dockerignore", "Dockerfile"])
    expect(found.leftOut).toEqual([
      { rule: "ignore_file", path: "logs", folder: true },
    ])
    expect(found.ignoreFile).toBe(".dockerignore")
  })

  test("an excluded folder with an exception under it is entered: what comes back is sent, with its folder", () => {
    write("Dockerfile")
    write(".dockerignore", "logs\n!logs/keep.txt\n")
    write("logs/keep.txt")
    write("logs/other.txt")
    write("logs/deep/b.txt")
    const found = walk()
    expect(names(found)).toEqual([
      ".dockerignore",
      "Dockerfile",
      "logs/",
      "logs/keep.txt",
    ])
    expect(found.leftOut).toEqual([
      { rule: "ignore_file", path: "logs/deep", folder: true },
      { rule: "ignore_file", path: "logs/other.txt", folder: false },
    ])
  })

  test("an excluded folder entered for an exception that brings nothing back is not sent", () => {
    write("Dockerfile")
    write(".dockerignore", "logs\n!logs/keep.txt\n")
    write("logs/other.txt")
    expect(names(walk())).toEqual([".dockerignore", "Dockerfile"])
  })

  test("the Dockerfile and the ignore file in use are always sent, their folders with them", () => {
    write("docker/web.Dockerfile", "FROM scratch\n")
    write(
      "docker/web.Dockerfile.dockerignore",
      "docker\n*.Dockerfile\n*.dockerignore\n"
    )
    write("docker/notes.txt")
    write("src/a.ts")
    const found = walk({ dockerfile: "docker/web.Dockerfile" })
    expect(found.ignoreFile).toBe("docker/web.Dockerfile.dockerignore")
    expect(names(found)).toEqual([
      "docker/",
      "docker/web.Dockerfile",
      "docker/web.Dockerfile.dockerignore",
      "src/",
      "src/a.ts",
    ])
    expect(found.dockerfileSent).toBe(true)
  })
})

describe("the Dockerfile's name (CL2, C20)", () => {
  const at = {
    file: "zekno.app.json",
    service: "web",
    folder: "~/code/shop",
  }

  test("a file dockerfile does not stand for the setting Dockerfile", () => {
    write("dockerfile", "FROM scratch\n")
    const found = walk({ dockerfile: "Dockerfile" })
    expect(found.dockerfileSent).toBe(false)
    expect(names(found)).toEqual(["dockerfile"])
    expect(stopOf(() => requireDockerfile(found, at))).toEqual({
      id: "C20",
      ...at,
      dockerfile: "Dockerfile",
    })
  })

  test("the Dockerfile found under exactly its name passes", () => {
    write("Dockerfile", "FROM scratch\n")
    expect(() => requireDockerfile(walk(), at)).not.toThrow()
  })

  test("a Dockerfile that is a link is not found", () => {
    writeFileSync(join(elsewhere, "Dockerfile"), "FROM scratch\n")
    symlinkSync(join(elsewhere, "Dockerfile"), join(root, "Dockerfile"))
    expect(stopOf(() => requireDockerfile(walk(), at)).id).toBe("C20")
  })

  test("a build with no Dockerfile has none to find", () => {
    write("package.json", "{}")
    const found = walk({ dockerfile: null })
    expect(found.dockerfileSent).toBe(false)
    expect(names(found)).toEqual(["package.json"])
  })
})

describe("reading for content (CL2, C5)", () => {
  test("a small file that cannot be read stops with C5", () => {
    if (process.getuid?.() === 0) return
    write("Dockerfile")
    const locked = write("src/locked.txt", "x")
    chmodSync(locked, 0o000)
    try {
      expect(stopOf(() => walk())).toEqual({ id: "C5", path: "src/locked.txt" })
    } finally {
      chmodSync(locked, 0o644)
    }
  })

  test("an entry that is there but cannot be looked at stops with C5: it is not taken for one gone since the listing", () => {
    if (process.getuid?.() === 0) return
    write("Dockerfile")
    write("sub/a.txt")
    // Read but not searched: the names can be listed, `lstat` of each fails with EACCES.
    chmodSync(join(root, "sub"), 0o444)
    try {
      expect(stopOf(() => walk())).toEqual({ id: "C5", path: "sub/a.txt" })
    } finally {
      chmodSync(join(root, "sub"), 0o755)
    }
  })

  test("a folder that cannot be listed stops with C5", () => {
    if (process.getuid?.() === 0) return
    write("Dockerfile")
    write("private/a.txt")
    chmodSync(join(root, "private"), 0o000)
    try {
      expect(stopOf(() => walk())).toEqual({ id: "C5", path: "private" })
    } finally {
      chmodSync(join(root, "private"), 0o755)
    }
  })
})
