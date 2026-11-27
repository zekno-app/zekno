/**
 * Finding a folder's git repository from files alone (specs/016-build-from-source,
 * contracts/cli.md CL4 steps 1 and 2; plan.md item 9 (a); tasks T106). The
 * repository cannot hold a nested `.git`, so every `.git` here is written by
 * the test at run time in a temporary folder; `git` is never run.
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

import { readConfig } from "../../src/git/config"
import {
  findGit,
  POINTER_BYTES,
  readBounded,
  WALK_UP,
} from "../../src/git/find"

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-git-find-")))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A plain repository's git folder under `top`, with the files every git folder holds. */
function gitFolder(top: string, config = "[core]\n\tbare = false\n"): string {
  const git = join(top, ".git")
  mkdirSync(join(git, "objects"), { recursive: true })
  mkdirSync(join(git, "refs", "heads"), { recursive: true })
  writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n")
  writeFileSync(join(git, "config"), config)
  return git
}

/** `count` folders `l1/l2/…` under `top`, the deepest returned. */
function deep(top: string, count: number): string {
  const path = join(
    top,
    ...Array.from({ length: count }, (_, at) => `l${at + 1}`)
  )
  mkdirSync(path, { recursive: true })
  return path
}

describe("findGit", () => {
  test("a .git folder in the folder sent, or above it, gives that folder as git folder and common folder, and its parent as the top", () => {
    const git = gitFolder(root)
    const place = { gitDir: git, commonDir: git, top: root }
    expect(findGit(root)).toEqual(place)
    expect(findGit(deep(root, 3))).toEqual(place)
  })

  test(`the walk looks at the folder sent and ${WALK_UP} folders above it, no more: 64 levels deep is found, 65 is not`, () => {
    const git = gitFolder(root)
    expect(findGit(deep(root, 64))).toEqual({
      gitDir: git,
      commonDir: git,
      top: root,
    })
    expect(findGit(deep(root, 65))).toBeUndefined()
  })

  test("a worktree's .git file names its git folder relative to the file's folder, and that folder's commondir names where refs and objects are", () => {
    const main = join(root, "main")
    const common = gitFolder(main)
    const admin = join(common, "worktrees", "wt")
    mkdirSync(admin, { recursive: true })
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/feature\n")
    writeFileSync(join(admin, "commondir"), "../..\n")
    const tree = join(root, "wt")
    mkdirSync(join(tree, "src"), { recursive: true })
    writeFileSync(join(tree, ".git"), "gitdir: ../main/.git/worktrees/wt\n")
    expect(findGit(join(tree, "src"))).toEqual({
      gitDir: admin,
      commonDir: common,
      top: tree,
    })
  })

  test("a .git file may name its git folder by an absolute path, and a commondir by one too; with no commondir the git folder holds everything", () => {
    const modules = join(root, "parent", ".git", "modules", "sub")
    mkdirSync(modules, { recursive: true })
    const sub = join(root, "parent", "sub")
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, ".git"), `gitdir: ${modules}\r\n`)
    expect(findGit(sub)).toEqual({
      gitDir: modules,
      commonDir: modules,
      top: sub,
    })

    const elsewhere = join(root, "elsewhere")
    mkdirSync(elsewhere)
    writeFileSync(join(modules, "commondir"), elsewhere)
    expect(findGit(sub)).toEqual({
      gitDir: modules,
      commonDir: elsewhere,
      top: sub,
    })
  })

  test(`a .git file over ${POINTER_BYTES} bytes, or one that is not "gitdir: <path>", gives nothing`, () => {
    const target = join(root, "real")
    mkdirSync(target)
    const tree = join(root, "tree")
    mkdirSync(tree)
    const line = `gitdir: ${target}\n`
    writeFileSync(
      join(tree, ".git"),
      line + "\n".repeat(POINTER_BYTES - line.length)
    )
    expect(findGit(tree)).toEqual({
      gitDir: target,
      commonDir: target,
      top: tree,
    })
    writeFileSync(
      join(tree, ".git"),
      line + "\n".repeat(POINTER_BYTES - line.length + 1)
    )
    expect(findGit(tree)).toBeUndefined()
    for (const text of [
      "",
      "gitdir:",
      "gitdir: \n",
      `GITDIR: ${target}`,
      `gitdir:${target}`,
      `gitdir: ${target}\nmore\n`,
    ]) {
      writeFileSync(join(tree, ".git"), text)
      expect(findGit(tree)).toBeUndefined()
    }
  })

  test("a .git that names no folder, a commondir naming no folder, or one past its bound gives nothing, never a repository further up", () => {
    gitFolder(root)
    const tree = join(root, "tree")
    mkdirSync(tree)
    writeFileSync(join(tree, ".git"), "gitdir: nowhere\n")
    expect(findGit(tree)).toBeUndefined()

    const admin = join(root, "admin")
    mkdirSync(admin)
    writeFileSync(join(tree, ".git"), `gitdir: ${admin}\n`)
    writeFileSync(join(admin, "commondir"), "missing\n")
    expect(findGit(tree)).toBeUndefined()
    writeFileSync(join(admin, "commondir"), "x".repeat(POINTER_BYTES + 1))
    expect(findGit(tree)).toBeUndefined()
  })

  test("a .git that is a pipe, or a link to nothing, gives nothing, and the read does not wait on the pipe", () => {
    const tree = join(root, "tree")
    mkdirSync(tree)
    expect(Bun.spawnSync(["mkfifo", join(tree, ".git")]).exitCode).toBe(0)
    expect(findGit(tree)).toBeUndefined()
    const other = join(root, "other")
    mkdirSync(other)
    symlinkSync(join(root, "absent"), join(other, ".git"))
    expect(findGit(other)).toBeUndefined()
  })

  test("a folder that is not there gives nothing", () => {
    expect(findGit(join(root, "absent"))).toBeUndefined()
  })
})

describe("readBounded", () => {
  test("gives a regular file's bytes within its bound, and says when the file is missing or cannot be read within it", () => {
    writeFileSync(join(root, "file"), "abc")
    expect(readBounded(join(root, "file"), 3)).toEqual(Buffer.from("abc"))
    expect(readBounded(join(root, "file"), 2)).toBe("unreadable")
    expect(readBounded(join(root, "absent"), 3)).toBe("missing")
    expect(readBounded(join(root, "file", "below"), 3)).toBe("missing")
    expect(readBounded(root, 3)).toBe("unreadable")
  })
})

describe("the repository's config (CL4 step 2)", () => {
  test("a usual config is read", () => {
    const git = gitFolder(
      root,
      "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n"
    )
    expect(readConfig(git)).toEqual({ fileMode: true })
  })

  test("a bare config gives up", () => {
    const git = gitFolder(
      root,
      "[core]\n\trepositoryformatversion = 0\n\tbare = true\n"
    )
    expect(readConfig(git)).toBeUndefined()
  })

  test("a SHA-256 config gives up", () => {
    const git = gitFolder(
      root,
      "[core]\n\trepositoryformatversion = 1\n\tbare = false\n[extensions]\n\tobjectformat = sha256\n"
    )
    expect(readConfig(git)).toBeUndefined()
  })

  test("a reftable config gives up", () => {
    const git = gitFolder(
      root,
      "[core]\n\trepositoryformatversion = 1\n\tbare = false\n[extensions]\n\trefStorage = reftable\n"
    )
    expect(readConfig(git)).toBeUndefined()
  })

  test("the repository found by findGit is read through its common folder", () => {
    const common = gitFolder(
      join(root, "main"),
      "[extensions]\n\tobjectFormat = sha256\n"
    )
    const admin = join(common, "worktrees", "wt")
    mkdirSync(admin, { recursive: true })
    writeFileSync(join(admin, "commondir"), "../..\n")
    writeFileSync(join(admin, "config"), "[core]\n")
    const tree = join(root, "wt")
    mkdirSync(tree)
    writeFileSync(join(tree, ".git"), `gitdir: ${admin}\n`)
    const place = findGit(tree)
    expect(place?.commonDir).toBe(common)
    expect(readConfig(place!.commonDir)).toBeUndefined()
  })
})
