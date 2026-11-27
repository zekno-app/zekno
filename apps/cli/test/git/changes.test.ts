/**
 * The uncommitted-changes fact (specs/016-build-from-source, contracts/cli.md
 * CL4 steps 3 and 4; FR-017a; tasks T122): the files pass 2 sends against the
 * index, by stat with git's racy rule, else by the blob id of the bytes pass 2
 * read through its per-file hook; the index against HEAD's tree, through the
 * `TREE` extension or HEAD's objects. Any difference gives B13 once; nothing
 * changed, no repository, a repository zekno's readers cannot follow, and a
 * check past 2 seconds give nothing. Every repository is written by the test
 * (`worktree.ts`), no `git` is run, and the pack is the same in every case.
 * Only the id is checked, never words.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CHANGES_MS, checkChanges } from "../../src/git/changes"
import type { FileHook } from "../../src/pack/spool"
import {
  type Files,
  packOf,
  PAST,
  type Staged,
  writeRepository,
  writeStatIndex,
  writeTrees,
  writeWorktree,
} from "./worktree"

let top: string

beforeEach(() => {
  top = realpathSync(mkdtempSync(join(tmpdir(), "zekno-changes-")))
})

afterEach(() => {
  rmSync(top, { recursive: true, force: true })
})

const FILES: Files = {
  Dockerfile: "FROM node:22\n",
  "run.sh": { content: "#!/bin/sh\necho hi\n", runs: true },
  "src/app.js": "console.log('app')\n",
  "src/lib/util.js": "export const one = 1\n",
}

/** The index of `files` as `git add` writes it. */
const stagedOf = (files: Files): Staged[] =>
  Object.entries(files).map(([path, file]) =>
    typeof file === "string"
      ? { path, content: file }
      : "gitlink" in file
        ? { path, content: "", gitlink: file.gitlink }
        : { path, content: file.content, runs: file.runs }
  )

/** A repository with `FILES` committed, written to disk and staged, its `TREE` extension valid when `cached`. */
function committedRepository(cached = false): string {
  writeWorktree(top, FILES)
  const { git, trees } = writeRepository(top, FILES)
  writeStatIndex(top, git, stagedOf(FILES), cached ? trees : undefined)
  return git
}

/**
 * The fact for the folder sent, `root`: the check is handed every file as
 * pass 2 hands it, and the pack it gives is the pack with no check at all.
 */
function factOf(root = top, now?: () => number) {
  const check = checkChanges(root, now === undefined ? {} : { now })
  const hook: FileHook = check.hook
  expect(packOf(root, hook)).toBe(packOf(root))
  return check.finish()
}

/** A file changed after it was staged: new bytes and a later time. */
function change(path: string, content: string) {
  const full = join(top, path)
  writeFileSync(full, content)
  const later = new Date(PAST.getTime() + 60_000)
  utimesSync(full, later, later)
}

describe("nothing changed: no fact", () => {
  test("every file as staged and HEAD's tree as the index, read from objects", () => {
    committedRepository()
    expect(factOf()).toBeNull()
  })

  test("the same, through a valid TREE extension", () => {
    committedRepository(true)
    expect(factOf()).toBeNull()
  })

  test("a valid TREE extension is trusted, as git trusts it: HEAD's objects are not read", () => {
    const changed = { ...FILES, "src/app.js": "console.log('staged')\n" }
    writeWorktree(top, changed)
    const { git, trees } = writeRepository(top, FILES)
    // It names HEAD's own trees for an index that differs from them.
    writeStatIndex(top, git, stagedOf(changed), trees)
    expect(factOf()).toBeNull()
  })

  test("a file whose stat is trusted is not read again, as git does not read it", () => {
    const git = committedRepository()
    // Same size and times as staged, not racy: git's own blind spot, kept.
    writeFileSync(join(top, "src/app.js"), "console.log('APP')\n")
    utimesSync(join(top, "src/app.js"), PAST, PAST)
    writeStatIndex(top, git, stagedOf(FILES))
    expect(factOf()).toBeNull()
  })
})

describe("changes: B13 once", () => {
  test("a changed file, of the same size or another", () => {
    committedRepository()
    change("src/app.js", "console.log('APP')\n")
    expect(factOf()).toEqual({ id: "B13" })
    change("src/app.js", "console.log('a longer app')\n")
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("a new file that is sent", () => {
    committedRepository()
    writeWorktree(top, { "src/new.js": "new\n" })
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("a staged change, through HEAD's objects and through the TREE extension", () => {
    const changed = { ...FILES, "src/app.js": "console.log('staged')\n" }
    writeWorktree(top, changed)
    const { git } = writeRepository(top, FILES)
    writeStatIndex(top, git, stagedOf(changed))
    expect(factOf()).toEqual({ id: "B13" })
    writeStatIndex(top, git, stagedOf(changed), writeTrees(git, changed))
    expect(factOf()).toEqual({ id: "B13" })
    // Not valid anywhere: HEAD's objects are read instead.
    writeStatIndex(top, git, stagedOf(changed), new Map())
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("a file staged that HEAD does not have", () => {
    const { "src/lib/util.js": _, ...fewer } = FILES
    writeWorktree(top, FILES)
    const { git } = writeRepository(top, fewer)
    writeStatIndex(top, git, stagedOf(FILES))
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("the racy rule: a file changed in the second the index was written is read again", () => {
    const git = committedRepository()
    writeFileSync(join(top, "src/app.js"), "console.log('APP')\n")
    utimesSync(join(top, "src/app.js"), PAST, PAST)
    writeStatIndex(top, git, stagedOf(FILES))
    utimesSync(join(git, "index"), PAST, PAST)
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("the executable bit, unless core.fileMode is false", () => {
    committedRepository()
    chmodSync(join(top, "src/app.js"), 0o755)
    expect(factOf()).toEqual({ id: "B13" })
    writeFileSync(join(top, ".git", "config"), "[core]\n\tfilemode = false\n")
    expect(factOf()).toBeNull()
  })

  test("an entry marked intent-to-add counts as new", () => {
    writeWorktree(top, { ...FILES, "later.txt": "" })
    const { git } = writeRepository(top, FILES)
    writeStatIndex(top, git, [
      ...stagedOf(FILES),
      { path: "later.txt", content: "", intentToAdd: true },
    ])
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("a branch with no commit: every file is new", () => {
    writeWorktree(top, FILES)
    const { git } = writeRepository(top, null)
    writeStatIndex(top, git, stagedOf(FILES))
    expect(factOf()).toEqual({ id: "B13" })
  })
})

describe("the folder sent is part of the repository", () => {
  test("changes outside it, staged or not, are not its own", () => {
    const git = committedRepository()
    writeStatIndex(top, git, [
      ...stagedOf(FILES).filter((entry) => entry.path !== "run.sh"),
      { path: "run.sh", content: "#!/bin/sh\necho staged\n", runs: true },
    ])
    change("Dockerfile", "FROM node:24\n")
    writeWorktree(top, { "new-at-top.txt": "x" })
    expect(factOf(join(top, "src"))).toBeNull()
  })

  test("a change inside it is", () => {
    committedRepository(true)
    change("src/lib/util.js", "export const one = 2\n")
    expect(factOf(join(top, "src"))).toEqual({ id: "B13" })
  })

  test("a folder HEAD does not have, with files sent, is new", () => {
    committedRepository()
    writeWorktree(top, { "fresh/a.txt": "a" })
    expect(factOf(join(top, "fresh"))).toEqual({ id: "B13" })
  })
})

describe("no fact when zekno cannot tell", () => {
  test("outside a repository", () => {
    writeWorktree(top, FILES)
    expect(factOf()).toBeNull()
  })

  test("a SHA-256 repository, and one whose refs are kept otherwise", () => {
    writeWorktree(top, FILES)
    const { git } = writeRepository(
      top,
      FILES,
      "[core]\n\trepositoryformatversion = 1\n[extensions]\n\tobjectFormat = sha256\n"
    )
    writeStatIndex(top, git, stagedOf(FILES))
    change("src/app.js", "changed\n")
    expect(factOf()).toBeNull()
    writeFileSync(
      join(git, "config"),
      "[core]\n\trepositoryformatversion = 1\n[extensions]\n\trefStorage = reftable\n"
    )
    expect(factOf()).toBeNull()
  })

  test("a reader past 2 seconds, even with a change to find", () => {
    committedRepository()
    change("src/app.js", "changed\n")
    let clock = 0
    expect(factOf(top, () => (clock += CHANGES_MS + 1))).toBeNull()
  })

  test("2 seconds in all: the steps add up", () => {
    committedRepository()
    // Four steps, the last finding src/app.js changed: 4 x 300 ms is within the time, 4 x 600 ms is not.
    change("src/app.js", "changed\n")
    let clock = 0
    expect(factOf(top, () => (clock += 300))).toEqual({ id: "B13" })
    expect(factOf(top, () => (clock += 600))).toBeNull()
  })

  test("the time runs out while HEAD's trees are read: the reading stops there, not once it is done, and no fact", () => {
    // A staged change found only through HEAD's objects: no TREE extension.
    const changed = { ...FILES, "src/lib/util.js": "export const one = 2\n" }
    writeWorktree(top, changed)
    const { git } = writeRepository(top, FILES)
    writeStatIndex(top, git, stagedOf(changed))
    // The clock stands still until the last step, then moves a second at each look.
    let clock = 0
    let ticking = false
    let looks = 0
    const now = () => {
      if (!ticking) return clock
      looks++
      return (clock += 1000)
    }
    const check = checkChanges(top, { now })
    packOf(top, check.hook)
    ticking = true
    expect(check.finish()).toBeNull()
    // The step's start, a look before the top tree and src, a third past 2 seconds before src/lib, and the step's end.
    expect(looks).toBe(5)
  })

  test("an index that cannot be read, or HEAD's objects missing", () => {
    const git = committedRepository()
    writeFileSync(join(git, "index"), "not an index")
    expect(factOf()).toBeNull()
    writeStatIndex(top, git, stagedOf(FILES))
    for (const folder of readdirSync(join(git, "objects")))
      if (folder !== "pack")
        rmSync(join(git, "objects", folder), { recursive: true })
    expect(factOf()).toBeNull()
  })
})

describe("files git does not keep", () => {
  test("a submodule's files are another repository's", () => {
    const files: Files = {
      ...FILES,
      "vendor/lib": { gitlink: "ab".repeat(20) },
    }
    writeWorktree(top, files)
    const { git } = writeRepository(top, files)
    writeStatIndex(top, git, stagedOf(files))
    writeWorktree(top, { "vendor/lib/a.txt": "a" })
    mkdirSync(join(top, "vendor", "lib", ".git"))
    expect(factOf()).toBeNull()
    // With no submodule there, the same file is new to this repository.
    writeStatIndex(top, git, stagedOf(FILES))
    expect(factOf()).toEqual({ id: "B13" })
  })

  test("a .git sent through source.include is not a change", () => {
    committedRepository()
    const check = checkChanges(top)
    for (const name of [".git/config", "vendor/.git/HEAD"]) {
      check.hook.begin(name, 3)
      check.hook.data(new Uint8Array(3))
      check.hook.end()
    }
    expect(check.finish()).toBeNull()
  })
})
