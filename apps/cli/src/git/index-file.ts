/**
 * A repository's index, read from its bytes with no `git` run
 * (specs/016-build-from-source, contracts/cli.md CL4 steps 2 and 3; plan.md
 * item 9 (a)), as git's `Documentation/gitformat-index.txt` lays it out:
 * versions 2, 3 and 4, each entry with its stat fields, mode, id, stage and
 * flags (assume-unchanged, skip-worktree, intent-to-add), and the `TREE`
 * extension.
 *
 * The reader gives up, leaving the uncommitted-changes line out, on a split
 * index (`link`) or a sparse one (`sdir`, or a folder entry), on any other
 * extension git itself must understand (a lowercase signature), on anything
 * malformed, and past its bounds: 128 MiB and 1,000,000 entries. An index
 * whose checksum is zeros (`index.skipHash`) is read; any other checksum must
 * match.
 */
import { join } from "node:path"

import { readBounded } from "./find"

/** The most an index may hold, in bytes (CL4 step 2). */
export const INDEX_BYTES = 128 * 1024 * 1024

/** The most entries an index may have (CL4 step 2). */
export const INDEX_ENTRIES = 1_000_000

/** A time of the index: seconds and nanoseconds, each as git keeps them in 32 bits. */
export type IndexTime = {
  readonly seconds: number
  readonly nanoseconds: number
}

/** One entry of the index. */
export type IndexEntry = {
  readonly path: string
  /** `0o100644`, `0o100755`, `0o120000` (a link) or `0o160000` (a submodule). */
  readonly mode: number
  readonly oid: string
  /** The size on disk when it was staged, cut to 32 bits. */
  readonly size: number
  readonly ctime: IndexTime
  readonly mtime: IndexTime
  readonly dev: number
  readonly ino: number
  readonly uid: number
  readonly gid: number
  /** 0, or 1 to 3 for the sides of a conflict. */
  readonly stage: number
  readonly assumeUnchanged: boolean
  readonly skipWorktree: boolean
  readonly intentToAdd: boolean
}

/** A tree of the `TREE` extension: its path from the top, how many entries it covers (-1: no longer valid), its id when valid. */
export type CacheTree = {
  readonly path: string
  readonly entryCount: number
  readonly oid: string | null
  readonly subtrees: readonly CacheTree[]
}

/** What the index holds. */
export type GitIndex = {
  readonly version: 2 | 3 | 4
  readonly entries: readonly IndexEntry[]
  /** The `TREE` extension, null when the index has none. */
  readonly tree: CacheTree | null
}

/** Raised inside the reader on anything it does not take; the reader then gives up. */
class Malformed extends Error {}

const HASH_BYTES = 20
const SIGNATURE = 0x44495243 // "DIRC"
const decoder = new TextDecoder()

/** The kinds of entry the index holds, by the top bits of the mode; a folder (sparse) is not among them. */
const MODES = new Set([0o100000, 0o120000, 0o160000])

/** A cursor over the index's bytes, every read held inside `end`. */
class Cursor {
  private readonly view: DataView
  constructor(
    readonly bytes: Uint8Array,
    public at: number,
    readonly end: number
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  need(count: number): void {
    if (this.at + count > this.end) throw new Malformed()
  }

  u32(): number {
    this.need(4)
    const value = this.view.getUint32(this.at)
    this.at += 4
    return value
  }

  u16(): number {
    this.need(2)
    const value = this.view.getUint16(this.at)
    this.at += 2
    return value
  }

  take(count: number): Uint8Array {
    this.need(count)
    const slice = this.bytes.subarray(this.at, this.at + count)
    this.at += count
    return slice
  }

  /** Bytes up to a NUL, which is passed over. */
  untilNul(): Uint8Array {
    const nul = this.bytes.indexOf(0, this.at)
    if (nul < 0 || nul >= this.end) throw new Malformed()
    const slice = this.bytes.subarray(this.at, nul)
    this.at = nul + 1
    return slice
  }

  /** git's varint, as `decode_varint` reads it. */
  varint(): number {
    this.need(1)
    let byte = this.bytes[this.at++]!
    let value = byte & 127
    while (byte & 128) {
      value += 1
      if (value > 2 ** 45) throw new Malformed()
      this.need(1)
      byte = this.bytes[this.at++]!
      value = value * 128 + (byte & 127)
    }
    return value
  }
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex")

/** Whether two names are in index order: by bytes, then by stage. */
function inOrder(
  before: Uint8Array,
  stageBefore: number,
  after: Uint8Array,
  stage: number
): boolean {
  const order = Buffer.compare(before, after)
  return order < 0 || (order === 0 && stageBefore < stage)
}

/** One entry at the cursor; `previous` is the name before it, which version 4 names are cut against. */
function entryAt(
  cursor: Cursor,
  version: 2 | 3 | 4,
  previous: Uint8Array
): { entry: IndexEntry; name: Uint8Array } {
  const start = cursor.at
  const time = (): IndexTime => ({
    seconds: cursor.u32(),
    nanoseconds: cursor.u32(),
  })
  const ctime = time()
  const mtime = time()
  const dev = cursor.u32()
  const ino = cursor.u32()
  const mode = cursor.u32()
  const uid = cursor.u32()
  const gid = cursor.u32()
  const size = cursor.u32()
  const oid = hex(cursor.take(HASH_BYTES))
  const flags = cursor.u16()
  const extended = (flags & 0x4000) !== 0
  if (extended && version < 3) throw new Malformed()
  const more = extended ? cursor.u16() : 0
  // Only skip-worktree and intent-to-add are known, as git knows them.
  if ((more & ~0x6000) !== 0) throw new Malformed()
  let name: Uint8Array
  if (version === 4) {
    const strip = cursor.varint()
    if (strip > previous.length) throw new Malformed()
    name = Buffer.concat([
      previous.subarray(0, previous.length - strip),
      cursor.untilNul(),
    ])
  } else {
    name = cursor.untilNul()
    // Padded with NULs to a multiple of 8 bytes, one at least, as `align_flex_name` writes it.
    const length = (cursor.at - 1 - start + 8) & ~7
    const padding = cursor.take(start + length - cursor.at)
    if (padding.some((byte) => byte !== 0)) throw new Malformed()
  }
  const length = flags & 0xfff
  if (
    name.length === 0 ||
    (length < 0xfff ? name.length !== length : name.length < 0xfff)
  )
    throw new Malformed()
  if (!MODES.has(mode & 0o170000)) throw new Malformed()
  return {
    name,
    entry: {
      path: decoder.decode(name),
      mode:
        (mode & 0o170000) === 0o100000
          ? mode & 0o111
            ? 0o100755
            : 0o100644
          : mode & 0o170000,
      oid,
      size,
      ctime,
      mtime,
      dev,
      ino,
      uid,
      gid,
      stage: (flags >> 12) & 3,
      assumeUnchanged: (flags & 0x8000) !== 0,
      skipWorktree: (more & 0x4000) !== 0,
      intentToAdd: (more & 0x2000) !== 0,
    },
  }
}

/** An ASCII whole number up to `stop`, as the `TREE` extension writes it; -1 only where allowed. */
function numberUntil(cursor: Cursor, stop: number, negative: boolean): number {
  const end = cursor.bytes.indexOf(stop, cursor.at)
  if (end < 0 || end >= cursor.end) throw new Malformed()
  const text = decoder.decode(cursor.bytes.subarray(cursor.at, end))
  cursor.at = end + 1
  if (
    !(negative ? /^(?:-1|0|[1-9][0-9]{0,8})$/ : /^(?:0|[1-9][0-9]{0,8})$/).test(
      text
    )
  )
    throw new Malformed()
  return Number(text)
}

/** The `TREE` extension's trees, root first, each followed by its subtrees. */
function treeAt(
  cursor: Cursor,
  parent: string | null,
  budget: { left: number }
): CacheTree {
  if (--budget.left < 0) throw new Malformed()
  const name = decoder.decode(cursor.untilNul())
  const entryCount = numberUntil(cursor, 0x20, true)
  const count = numberUntil(cursor, 0x0a, false)
  const oid = entryCount >= 0 ? hex(cursor.take(HASH_BYTES)) : null
  const path =
    parent === null ? name : parent === "" ? name : `${parent}/${name}`
  const subtrees: CacheTree[] = []
  for (let at = 0; at < count; at++) subtrees.push(treeAt(cursor, path, budget))
  return { path, entryCount, oid, subtrees }
}

/** An index's bytes read, or undefined when the reader gives up. */
export function parseIndex(bytes: Uint8Array): GitIndex | undefined {
  try {
    if (bytes.length < 12 + HASH_BYTES) throw new Malformed()
    const end = bytes.length - HASH_BYTES
    const sum = bytes.subarray(end)
    if (
      sum.some((byte) => byte !== 0) &&
      !Buffer.from(
        new Bun.CryptoHasher("sha1").update(bytes.subarray(0, end)).digest()
      ).equals(sum)
    )
      throw new Malformed()
    const cursor = new Cursor(bytes, 0, end)
    if (cursor.u32() !== SIGNATURE) throw new Malformed()
    const version = cursor.u32()
    if (version !== 2 && version !== 3 && version !== 4) throw new Malformed()
    const count = cursor.u32()
    if (count > INDEX_ENTRIES) throw new Malformed()
    const entries: IndexEntry[] = []
    let previous: Uint8Array = new Uint8Array(0)
    let previousStage = -1
    for (let at = 0; at < count; at++) {
      const { entry, name } = entryAt(cursor, version, previous)
      if (at > 0 && !inOrder(previous, previousStage, name, entry.stage))
        throw new Malformed()
      entries.push(entry)
      previous = name
      previousStage = entry.stage
    }
    let tree: CacheTree | null = null
    while (cursor.at < end) {
      const signature = decoder.decode(cursor.take(4))
      const size = cursor.u32()
      cursor.need(size)
      const data = new Cursor(bytes, cursor.at, cursor.at + size)
      if (signature === "TREE") {
        if (size > 0) tree = treeAt(data, null, { left: INDEX_ENTRIES })
        if (data.at !== data.end) throw new Malformed()
      } else if (!/^[A-Z]/.test(signature)) throw new Malformed()
      cursor.at += size
    }
    return { version, entries, tree }
  } catch (error) {
    if (error instanceof Malformed) return undefined
    throw error
  }
}

/**
 * The index of a git folder, or undefined when the reader gives up: past
 * `INDEX_BYTES`, not a regular file, or `parseIndex` gives up. A repository
 * with no index has nothing staged.
 */
export function readIndex(gitDir: string): GitIndex | undefined {
  const read = readBounded(join(gitDir, "index"), INDEX_BYTES)
  if (read === "missing") return { version: 2, entries: [], tree: null }
  if (read === "unreadable") return undefined
  return parseIndex(read)
}
