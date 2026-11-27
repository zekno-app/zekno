/**
 * HEAD and objects, read from files with no `git` run
 * (specs/016-build-from-source, contracts/cli.md CL4 steps 2 and 3; plan.md
 * item 9 (a); tasks T119): HEAD as a branch (a loose ref or `packed-refs`) or
 * a commit id, a branch with no commit; objects from loose files and from
 * packs (`.idx` version 2 and `.pack`, offset and reference deltas). The kept
 * pack in `fixtures/` is copied at run time into a temporary
 * `.git/objects/pack/`; other repositories are written by the test. Anything
 * malformed or past a bound gives up.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deflateSync } from "node:zlib"

import {
  commitTree,
  DELTA_DEPTH,
  filesOf,
  OBJECT_BYTES,
  ObjectReader,
  parseTree,
  readHead,
  subtreeOf,
} from "../../src/git/objects"
import {
  copyFixturePack,
  gitFolder,
  IDS,
  objectId,
  OBJECTS,
  writeLoose,
  writePack,
} from "./repository"

let top: string
let git: string

beforeEach(() => {
  top = realpathSync(mkdtempSync(join(tmpdir(), "zekno-git-objects-")))
  git = gitFolder(top)
})

afterEach(() => {
  rmSync(top, { recursive: true, force: true })
})

/** The fixed set: A loose, the rest in the kept pack. */
function fixedSet(): ObjectReader {
  copyFixturePack(git)
  writeLoose(git, "blob", OBJECTS.A)
  return new ObjectReader(git)
}

describe("objects", () => {
  test("a loose object, inflated and checked against its id", () => {
    const reader = fixedSet()
    expect(reader.read(IDS.A)).toEqual({ type: "blob", data: OBJECTS.A })
  })

  test("packed objects: whole, an offset delta, a reference delta on top of it, trees and the commit", () => {
    const reader = fixedSet()
    expect(reader.read(IDS.B)).toEqual({ type: "blob", data: OBJECTS.B })
    expect(reader.read(IDS.C)).toEqual({ type: "blob", data: OBJECTS.C })
    expect(reader.read(IDS.D)).toEqual({ type: "blob", data: OBJECTS.D })
    expect(reader.read(IDS.T2)?.type).toBe("tree")
    expect(reader.read(IDS.K)?.type).toBe("commit")
  })

  test("a reference delta whose base is loose, and one whose base is in another pack", () => {
    copyFixturePack(git)
    writeLoose(git, "blob", OBJECTS.A)
    const target = Buffer.from("hello, from a delta of a loose object\n")
    const second = Buffer.from("and one more, from a delta in another pack\n")
    writePack(
      git,
      [
        { refDeltaOf: IDS.A, base: OBJECTS.A, data: target },
        { refDeltaOf: IDS.B, base: OBJECTS.B, data: second },
      ],
      [objectId("blob", target), objectId("blob", second)]
    )
    const reader = new ObjectReader(git)
    expect(reader.read(objectId("blob", target))).toEqual({
      type: "blob",
      data: target,
    })
    expect(reader.read(objectId("blob", second))).toEqual({
      type: "blob",
      data: second,
    })
  })

  test("a missing object, or an id that is not one, gives up", () => {
    const reader = fixedSet()
    expect(reader.read("0".repeat(40))).toBeUndefined()
    expect(reader.read("not an id")).toBeUndefined()
  })

  test("a loose object that is not zlib, whose bytes are not its id's, or whose size is not what it says, gives up", () => {
    writeLoose(git, "blob", OBJECTS.A, Buffer.from("not deflated"))
    expect(new ObjectReader(git).read(IDS.A)).toBeUndefined()
    writeLoose(
      git,
      "blob",
      OBJECTS.A,
      deflateSync(Buffer.from("blob 6\0hellO\n"))
    )
    expect(new ObjectReader(git).read(IDS.A)).toBeUndefined()
    writeLoose(
      git,
      "blob",
      OBJECTS.A,
      deflateSync(Buffer.from("blob 7\0hello\n"))
    )
    expect(new ObjectReader(git).read(IDS.A)).toBeUndefined()
    writeLoose(
      git,
      "blob",
      OBJECTS.A,
      deflateSync(Buffer.from("blub 6\0hello\n"))
    )
    expect(new ObjectReader(git).read(IDS.A)).toBeUndefined()
  })

  test(`an object over ${OBJECT_BYTES} bytes inflated gives up; one of exactly that is read`, () => {
    const largest = Buffer.alloc(OBJECT_BYTES, 0x61)
    const id = writeLoose(git, "blob", largest)
    expect(new ObjectReader(git).read(id)?.data.length).toBe(OBJECT_BYTES)
    const over = Buffer.alloc(OBJECT_BYTES + 1, 0x61)
    const overId = writeLoose(git, "blob", over)
    expect(new ObjectReader(git).read(overId)).toBeUndefined()
    // The same in a pack: its header says more than the bound.
    rmSync(join(git, "objects", overId.slice(0, 2)), { recursive: true })
    writePack(git, [{ type: 3, data: over }], [overId])
    expect(new ObjectReader(git).read(overId)).toBeUndefined()
  })

  test(`a chain of ${DELTA_DEPTH} deltas is read; one more gives up; a delta that names itself gives up`, () => {
    const chain = (length: number) => {
      const versions = Array.from({ length: length + 1 }, (_, at) =>
        Buffer.from(`version ${at}\n`)
      )
      writePack(
        git,
        versions.map((data, at) =>
          at === 0
            ? { type: 3 as const, data }
            : { ofsDeltaOf: at - 1, base: versions[at - 1]!, data }
        ),
        versions.map((data) => objectId("blob", data))
      )
      return objectId("blob", versions.at(-1)!)
    }
    expect(
      new ObjectReader(git).read(chain(DELTA_DEPTH))?.data.toString()
    ).toBe(`version ${DELTA_DEPTH}\n`)
    rmSync(join(git, "objects", "pack"), { recursive: true })
    expect(new ObjectReader(git).read(chain(DELTA_DEPTH + 1))).toBeUndefined()
    rmSync(join(git, "objects", "pack"), { recursive: true })
    const self = Buffer.from("a delta of itself\n")
    writePack(
      git,
      [{ refDeltaOf: objectId("blob", self), base: self, data: self }],
      [objectId("blob", self)]
    )
    expect(new ObjectReader(git).read(objectId("blob", self))).toBeUndefined()
  })

  test("a pack or an index that is malformed gives up", () => {
    copyFixturePack(git)
    const folder = join(git, "objects", "pack")
    const [idx] = readdirSync(folder).filter((name) => name.endsWith(".idx"))
    const pack = idx!.replace(/\.idx$/, ".pack")
    const original = {
      idx: readFileSync(join(folder, idx!)),
      pack: readFileSync(join(folder, pack)),
    }
    const broken = (name: string, bytes: Buffer) => {
      writeFileSync(join(folder, name), bytes)
      const read = new ObjectReader(git).read(IDS.K)
      writeFileSync(join(folder, idx!), original.idx)
      writeFileSync(join(folder, pack), original.pack)
      return read
    }
    expect(new ObjectReader(git).read(IDS.K)?.type).toBe("commit")
    const magic = Buffer.from(original.idx)
    magic[0] = 0
    expect(broken(idx!, magic)).toBeUndefined()
    expect(broken(idx!, original.idx.subarray(0, 1000))).toBeUndefined()
    const header = Buffer.from(original.pack)
    header.write("KCAP", 0)
    expect(broken(pack, header)).toBeUndefined()
    expect(broken(pack, original.pack.subarray(0, 380))).toBeUndefined()
    const flipped = Buffer.from(original.pack)
    flipped[400] = flipped[400]! ^ 0xff
    expect(broken(pack, flipped)).toBeUndefined()
    renameSync(join(folder, pack), join(folder, "elsewhere"))
    expect(new ObjectReader(git).read(IDS.K)).toBeUndefined()
  })
})

describe("trees and commits", () => {
  test("a commit's tree, a tree's entries, a subtree by its path", () => {
    const reader = fixedSet()
    const tree = commitTree(reader.read(IDS.K)!.data)
    expect(tree).toBe(IDS.T)
    expect(parseTree(reader.read(IDS.T)!.data)).toEqual([
      { mode: 0o100644, name: "a.txt", oid: IDS.A },
      { mode: 0o040000, name: "dir", oid: IDS.T2 },
      { mode: 0o100755, name: "run.sh", oid: IDS.B },
    ])
    expect(subtreeOf(reader, IDS.T, "")).toBe(IDS.T)
    expect(subtreeOf(reader, IDS.T, "dir")).toBe(IDS.T2)
    expect(subtreeOf(reader, IDS.T, "missing/below")).toBeNull()
    expect(subtreeOf(reader, IDS.T, "a.txt")).toBeNull()
  })

  test("every file of a tree, its path from the tree, its mode and id", () => {
    expect(filesOf(fixedSet(), IDS.T)).toEqual(
      new Map([
        ["a.txt", { mode: 0o100644, oid: IDS.A }],
        ["dir/c.txt", { mode: 0o100644, oid: IDS.C }],
        ["dir/d.txt", { mode: 0o100644, oid: IDS.D }],
        ["run.sh", { mode: 0o100755, oid: IDS.B }],
      ])
    )
  })

  test("the check's time is asked before each tree is read: once it is past, the reading stops there", () => {
    let asked = 0
    // T, then dir: the second tree is never read.
    expect(filesOf(fixedSet(), IDS.T, () => ++asked > 1)).toBeUndefined()
    expect(asked).toBe(2)
    expect(subtreeOf(fixedSet(), IDS.T, "dir", () => true)).toBeUndefined()
    expect(filesOf(fixedSet(), IDS.T, () => false)?.size).toBe(4)
  })

  test("every entry read counts toward the bound of 1,000,000, a name given again and again too", () => {
    const blob = writeLoose(git, "blob", Buffer.from("x"))
    const entry = (mode: string, name: string, oid: string) =>
      Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, "hex")])
    // One tree naming the file `f` 20,000 times, and 60 folders that all name that tree: 1,200,000 entries, 60 paths.
    const inner = writeLoose(
      git,
      "tree",
      Buffer.concat(
        Array.from({ length: 20_000 }, () => entry("100644", "f", blob))
      )
    )
    const outer = writeLoose(
      git,
      "tree",
      Buffer.concat(
        Array.from({ length: 60 }, (_, at) =>
          entry("40000", `d${String(at).padStart(2, "0")}`, inner)
        )
      )
    )
    const reader = new ObjectReader(git)
    try {
      expect(filesOf(reader, outer)).toBeUndefined()
    } finally {
      reader.close()
    }
  })

  test("a commit with no tree line, or a tree that cannot be read, gives up", () => {
    expect(commitTree(Buffer.from("author x\n"))).toBeUndefined()
    expect(commitTree(Buffer.from("tree 123\n"))).toBeUndefined()
    for (const bytes of [
      Buffer.from("100644 a"),
      Buffer.concat([Buffer.from("100644 \0"), Buffer.alloc(20)]),
      Buffer.concat([Buffer.from("100644 a/b\0"), Buffer.alloc(20)]),
      Buffer.concat([Buffer.from("100644 ..\0"), Buffer.alloc(20)]),
      Buffer.concat([Buffer.from("777 a\0"), Buffer.alloc(20)]),
      Buffer.concat([Buffer.from("100644 a\0"), Buffer.alloc(19)]),
    ])
      expect(parseTree(bytes)).toBeUndefined()
    const reader = fixedSet()
    expect(filesOf(reader, IDS.A)).toBeUndefined()
  })
})

describe("HEAD", () => {
  const place = () => ({ gitDir: git, commonDir: git })

  test("a branch with a loose ref", () => {
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(git, "refs/heads/main"), `${IDS.K}\n`)
    expect(readHead(place())).toEqual({ kind: "commit", oid: IDS.K })
  })

  test("a branch in packed-refs, peeled lines and comments among them", () => {
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/feature/x\n")
    writeFileSync(
      join(git, "packed-refs"),
      `# pack-refs with: peeled fully-peeled sorted \n${IDS.T} refs/heads/feature/a\n${IDS.K} refs/heads/feature/x\n${IDS.T} refs/tags/v1\n^${IDS.K}\n`
    )
    expect(readHead(place())).toEqual({ kind: "commit", oid: IDS.K })
  })

  test("a commit id, as a detached HEAD holds it", () => {
    writeFileSync(join(git, "HEAD"), `${IDS.K}\n`)
    expect(readHead(place())).toEqual({ kind: "commit", oid: IDS.K })
  })

  test("a branch with no commit yet: every file counts as new", () => {
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n")
    expect(readHead(place())).toEqual({ kind: "unborn" })
  })

  test("a worktree's HEAD is in its own git folder, its branch in the common one", () => {
    const admin = join(git, "worktrees", "wt")
    mkdirSync(admin, { recursive: true })
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/side\n")
    writeFileSync(join(git, "refs/heads/side"), `${IDS.K}\n`)
    expect(readHead({ gitDir: admin, commonDir: git })).toEqual({
      kind: "commit",
      oid: IDS.K,
    })
  })

  test("a ref that names another, within a few steps", () => {
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/a\n")
    writeFileSync(join(git, "refs/heads/a"), "ref: refs/heads/b\n")
    writeFileSync(join(git, "refs/heads/b"), `${IDS.K}\n`)
    expect(readHead(place())).toEqual({ kind: "commit", oid: IDS.K })
    writeFileSync(join(git, "refs/heads/b"), "ref: refs/heads/a\n")
    expect(readHead(place())).toBeUndefined()
  })

  test("a HEAD or a ref that cannot be read, or a name that leads out of refs/, gives up", () => {
    for (const head of [
      "",
      "garbage\n",
      "ref: ../../outside\n",
      "ref: refs/heads/../../x\n",
      "ref: HEAD\n",
      `${IDS.K.slice(1)}\n`,
    ]) {
      writeFileSync(join(git, "HEAD"), head)
      expect({ head, read: readHead(place()) }).toEqual({
        head,
        read: undefined,
      })
    }
    writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(git, "refs/heads/main"), "not an id\n")
    expect(readHead(place())).toBeUndefined()
    rmSync(join(git, "refs/heads/main"))
    writeFileSync(join(git, "packed-refs"), "garbage line\n")
    expect(readHead(place())).toBeUndefined()
    rmSync(join(git, "HEAD"))
    expect(readHead(place())).toBeUndefined()
  })
})
