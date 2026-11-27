/**
 * The index, read from its bytes with no `git` run (specs/016-build-from-source,
 * contracts/cli.md CL4 steps 2 and 3; plan.md item 9 (a); tasks T119):
 * versions 2, 3 and 4, each entry with its flags (assume-unchanged,
 * skip-worktree), and the `TREE` extension. Every index here is written by
 * the test (`repository.ts`; real git read the same writer's indexes alike).
 * A split or sparse index, anything malformed and anything past a bound gives
 * up, which leaves the uncommitted-changes line out.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  INDEX_BYTES,
  INDEX_ENTRIES,
  parseIndex,
  readIndex,
} from "../../src/git/index-file"
import {
  IDS,
  writeIndex,
  type WrittenEntry,
  type WrittenTree,
} from "./repository"

const ENTRIES: WrittenEntry[] = [
  { path: "a.txt", oid: IDS.A, size: 6, assumeUnchanged: true },
  { path: "dir/c.txt", oid: IDS.C, size: 96 },
  { path: "dir/d.txt", oid: IDS.D, size: 111, mtime: 1_700_000_123 },
  { path: "run.sh", oid: IDS.B, mode: 0o100755, size: 97 },
]

const TREE: WrittenTree = {
  name: "",
  count: 4,
  oid: IDS.T,
  subtrees: [{ name: "dir", count: 2, oid: IDS.T2, subtrees: [] }],
}

describe("versions 2, 3 and 4", () => {
  for (const version of [2, 3, 4] as const)
    test(`version ${version}: every entry, its stat fields, its mode, its id and its flags`, () => {
      const read = parseIndex(
        writeIndex(
          [
            ...ENTRIES.slice(0, 1),
            {
              ...ENTRIES[1]!,
              skipWorktree: version >= 3,
              intentToAdd: version >= 3,
            },
            ...ENTRIES.slice(2),
          ],
          { version }
        )
      )
      expect(read?.version).toBe(version)
      expect(
        read?.entries.map(({ path, mode, oid, size, stage }) => ({
          path,
          mode,
          oid,
          size,
          stage,
        }))
      ).toEqual([
        { path: "a.txt", mode: 0o100644, oid: IDS.A, size: 6, stage: 0 },
        { path: "dir/c.txt", mode: 0o100644, oid: IDS.C, size: 96, stage: 0 },
        { path: "dir/d.txt", mode: 0o100644, oid: IDS.D, size: 111, stage: 0 },
        { path: "run.sh", mode: 0o100755, oid: IDS.B, size: 97, stage: 0 },
      ])
      expect(read?.entries[2]).toMatchObject({
        mtime: { seconds: 1_700_000_123, nanoseconds: 0 },
        ctime: { seconds: 1_700_000_123, nanoseconds: 0 },
        dev: 5,
        ino: 7,
        uid: 501,
        gid: 20,
      })
      expect(
        read?.entries.map((entry) => [
          entry.assumeUnchanged,
          entry.skipWorktree,
          entry.intentToAdd,
        ])
      ).toEqual([
        [true, false, false],
        [false, version >= 3, version >= 3],
        [false, false, false],
        [false, false, false],
      ])
    })

  test("a link, a submodule and the stages of a conflict are entries too", () => {
    const read = parseIndex(
      writeIndex([
        { path: "link", oid: IDS.A, mode: 0o120000 },
        { path: "mod", oid: IDS.K, mode: 0o160000, size: 0 },
        { path: "x", oid: IDS.A, stage: 1 },
        { path: "x", oid: IDS.B, stage: 2 },
        { path: "x", oid: IDS.C, stage: 3 },
      ])
    )
    expect(
      read?.entries.map(({ path, mode, stage }) => [path, mode, stage])
    ).toEqual([
      ["link", 0o120000, 0],
      ["mod", 0o160000, 0],
      ["x", 0o100644, 1],
      ["x", 0o100644, 2],
      ["x", 0o100644, 3],
    ])
  })

  test("a name past 4,095 bytes, and one that is not ASCII, are read whole", () => {
    const long = `${"d/".repeat(2100)}f`
    const read = parseIndex(
      writeIndex(
        [
          { path: long, oid: IDS.A },
          { path: "é.txt", oid: IDS.A },
        ],
        { version: 4 }
      )
    )
    expect(read?.entries.map((entry) => entry.path)).toEqual([long, "é.txt"])
    expect(
      parseIndex(writeIndex([{ path: long, oid: IDS.A }]))?.entries[0]!.path
    ).toBe(long)
  })
})

describe("the TREE extension", () => {
  test("each tree's path, how many entries it covers, its id and its subtrees; one no longer valid has no id", () => {
    const read = parseIndex(
      writeIndex(ENTRIES, {
        tree: {
          ...TREE,
          subtrees: [
            ...TREE.subtrees,
            { name: "gone", count: -1, subtrees: [] },
          ],
        },
      })
    )
    expect(read?.tree).toEqual({
      path: "",
      entryCount: 4,
      oid: IDS.T,
      subtrees: [
        { path: "dir", entryCount: 2, oid: IDS.T2, subtrees: [] },
        { path: "gone", entryCount: -1, oid: null, subtrees: [] },
      ],
    })
  })

  test("with no TREE extension there is no tree; an optional extension zekno does not read is skipped", () => {
    const read = parseIndex(
      writeIndex(ENTRIES, {
        extensions: [
          ["UNTR", Buffer.from("anything")],
          ["REUC", Buffer.alloc(3)],
        ],
      })
    )
    expect(read?.tree).toBeNull()
    expect(read?.entries).toHaveLength(4)
  })

  test("a TREE extension that cannot be read gives up", () => {
    for (const data of [
      Buffer.from("\0x 0\n"),
      Buffer.from("\x004 1\n"),
      Buffer.from("\x004 0\n123"),
      Buffer.from("\0-2 0\n"),
    ])
      expect(
        parseIndex(writeIndex(ENTRIES, { extensions: [["TREE", data]] }))
      ).toBeUndefined()
  })
})

describe("what gives up", () => {
  test("a split index (link) or a sparse one (sdir, or a folder entry), and any other extension git must read", () => {
    expect(
      parseIndex(
        writeIndex(ENTRIES, { extensions: [["link", Buffer.alloc(20)]] })
      )
    ).toBeUndefined()
    expect(
      parseIndex(
        writeIndex(ENTRIES, { extensions: [["sdir", Buffer.alloc(0)]] })
      )
    ).toBeUndefined()
    expect(
      parseIndex(
        writeIndex(ENTRIES, { extensions: [["abcd", Buffer.alloc(0)]] })
      )
    ).toBeUndefined()
    expect(
      parseIndex(
        writeIndex([{ path: "dir/", oid: IDS.T2, mode: 0o040000 }], {
          version: 3,
        })
      )
    ).toBeUndefined()
  })

  test("another version, another signature, a checksum that does not match; a checksum of zeros is taken", () => {
    const good = writeIndex(ENTRIES)
    for (const version of [1, 5]) {
      const other = Buffer.from(good)
      other.writeUInt32BE(version, 4)
      expect(parseIndex(other)).toBeUndefined()
    }
    const signature = Buffer.from(good)
    signature.write("DIRX", 0)
    expect(parseIndex(signature)).toBeUndefined()
    const flipped = Buffer.from(good)
    flipped[20] = flipped[20]! ^ 1
    expect(parseIndex(flipped)).toBeUndefined()
    expect(
      parseIndex(writeIndex(ENTRIES, { zeroChecksum: true }))?.entries
    ).toHaveLength(4)
  })

  test("entries cut short, out of order, or an extended flag in version 2", () => {
    const good = writeIndex(ENTRIES)
    expect(parseIndex(good.subarray(0, 100))).toBeUndefined()
    expect(parseIndex(writeIndex(ENTRIES, { count: 5 }))).toBeUndefined()
    expect(parseIndex(writeIndex([ENTRIES[1]!, ENTRIES[0]!]))).toBeUndefined()
    expect(parseIndex(writeIndex([ENTRIES[0]!, ENTRIES[0]!]))).toBeUndefined()
    expect(
      parseIndex(
        writeIndex([{ ...ENTRIES[0]!, skipWorktree: true }], { version: 2 })
      )
    ).toBeUndefined()
  })

  test(`more than ${INDEX_ENTRIES} entries`, () => {
    expect(
      parseIndex(writeIndex([], { count: INDEX_ENTRIES + 1 }))
    ).toBeUndefined()
  })
})

describe("readIndex", () => {
  let git: string
  beforeEach(() => {
    git = realpathSync(mkdtempSync(join(tmpdir(), "zekno-git-index-")))
  })
  afterEach(() => {
    rmSync(git, { recursive: true, force: true })
  })

  test("reads the git folder's index; with none, nothing is staged", () => {
    expect(readIndex(git)).toEqual({ version: 2, entries: [], tree: null })
    writeFileSync(join(git, "index"), writeIndex(ENTRIES, { tree: TREE }))
    expect(readIndex(git)?.entries).toHaveLength(4)
  })

  test(`an index over ${INDEX_BYTES} bytes, or one that is not a file, gives up without reading it`, () => {
    writeFileSync(join(git, "index"), "")
    truncateSync(join(git, "index"), INDEX_BYTES + 1)
    expect(readIndex(git)).toBeUndefined()
    rmSync(join(git, "index"))
    expect(Bun.spawnSync(["mkfifo", join(git, "index")]).exitCode).toBe(0)
    expect(readIndex(git)).toBeUndefined()
  })
})
