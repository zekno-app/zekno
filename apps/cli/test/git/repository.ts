/**
 * Repositories written by the git readers' tests, with no `git` run
 * (specs/016-build-from-source, tasks T119): one fixed object set, written
 * loose or found in the pack kept in `fixtures/` (made once and checked with
 * `git verify-pack`), indexes of versions 2, 3 and 4, and small packs made at
 * run time for the cases the kept one cannot show.
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync } from "node:zlib"

/** The pack kept in `fixtures/`: B whole, C an offset delta of B, D a reference delta of C, the trees and the commit. */
export const FIXTURE_PACK = join(import.meta.dir, "fixtures")

const sha1 = (data: Uint8Array): Buffer =>
  Buffer.from(new Bun.CryptoHasher("sha1").update(data).digest())

/** An object's id, as git names it. */
export const objectId = (type: string, data: Uint8Array): string =>
  sha1(Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data])).toString(
    "hex"
  )

/** The fixed object set: four blobs, two trees and a commit. */
export const OBJECTS = {
  A: Buffer.from("hello\n"),
  B: Buffer.from(
    "The base text of a delta, long enough that a delta saves room.\nLine two of it.\nLine three of it.\n"
  ),
  C: Buffer.from(
    "The base text of a delta, long enough that a delta saves room.\nLine two, changed.\nLine three of it.\n"
  ),
  D: Buffer.from(
    "The base text of a delta, long enough that a delta saves room.\nLine two, changed.\nLine three of it.\nA fourth line.\n"
  ),
}

/** The ids of the fixed set, as `git verify-pack -v` listed them for the kept pack. */
export const IDS = {
  A: "ce013625030ba8dba906f756967f9e9ca394464a",
  B: "2827a545dcc6ec9a316f60b4bc4b2fc07b83a127",
  C: "5029725dd5a59372b893b64f15140159ac71c320",
  D: "7364fe866fd371d46c17d246303518217aab7bfb",
  T2: "b1f1e4dfcca6e2eeafd5740f64365cbc0f9fa2d0",
  T: "56e12c9859406df0aa897c4fe3fc3deb0e9f4724",
  K: "a6c500bca997f0c150be16c77f46c61bfda0b3e4",
}

/** A git folder with its objects and refs folders, under `top`. */
export function gitFolder(top: string): string {
  const git = join(top, ".git")
  mkdirSync(join(git, "objects", "pack"), { recursive: true })
  mkdirSync(join(git, "refs", "heads"), { recursive: true })
  return git
}

/** The kept pack copied into a git folder's `objects/pack/`. */
export function copyFixturePack(git: string): void {
  for (const name of readdirSync(FIXTURE_PACK))
    copyFileSync(join(FIXTURE_PACK, name), join(git, "objects", "pack", name))
}

/** A loose object written as git writes it, its id returned; `bytes` replaces what is stored, to write one malformed. */
export function writeLoose(
  git: string,
  type: string,
  data: Uint8Array,
  bytes?: Uint8Array
): string {
  const id = objectId(type, data)
  const folder = join(git, "objects", id.slice(0, 2))
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, id.slice(2)),
    bytes ??
      deflateSync(
        Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data])
      )
  )
  return id
}

/** One entry of an index written by `writeIndex`. */
export type WrittenEntry = {
  path: string
  oid: string
  mode?: number
  size?: number
  mtime?: number
  stage?: number
  assumeUnchanged?: boolean
  skipWorktree?: boolean
  intentToAdd?: boolean
}

/** A node of the `TREE` extension: entry count -1 for one no longer valid. */
export type WrittenTree = {
  name: string
  count: number
  oid?: string
  subtrees: WrittenTree[]
}

function treeBytes(tree: WrittenTree): Buffer {
  return Buffer.concat([
    Buffer.from(`${tree.name}\0${tree.count} ${tree.subtrees.length}\n`),
    tree.count >= 0 ? Buffer.from(tree.oid!, "hex") : Buffer.alloc(0),
    ...tree.subtrees.map(treeBytes),
  ])
}

/** git's varint, as `encode_varint` writes it. */
function varint(value: number): Buffer {
  const bytes = [value & 127]
  while ((value >>= 7)) bytes.unshift(128 | (--value & 127))
  return Buffer.from(bytes)
}

/**
 * An index of `version` holding `entries` (in the order given), the `TREE`
 * extension when given, other extensions as signature and bytes, and the
 * trailing checksum (zeros with `zeroChecksum`, as `index.skipHash` writes).
 */
export function writeIndex(
  entries: WrittenEntry[],
  options: {
    version?: 2 | 3 | 4
    tree?: WrittenTree
    extensions?: [string, Buffer][]
    zeroChecksum?: boolean
    count?: number
  } = {}
): Buffer {
  const version = options.version ?? 2
  const parts: Buffer[] = []
  const header = Buffer.alloc(12)
  header.write("DIRC", 0)
  header.writeUInt32BE(version, 4)
  header.writeUInt32BE(options.count ?? entries.length, 8)
  parts.push(header)
  let previous = ""
  for (const entry of entries) {
    const extended = entry.skipWorktree === true || entry.intentToAdd === true
    const fixed = Buffer.alloc(extended ? 64 : 62)
    const mtime = entry.mtime ?? 1_700_000_000
    fixed.writeUInt32BE(mtime, 0)
    fixed.writeUInt32BE(mtime, 8)
    fixed.writeUInt32BE(5, 16)
    fixed.writeUInt32BE(7, 20)
    fixed.writeUInt32BE(entry.mode ?? 0o100644, 24)
    fixed.writeUInt32BE(501, 28)
    fixed.writeUInt32BE(20, 32)
    fixed.writeUInt32BE(entry.size ?? 6, 36)
    Buffer.from(entry.oid, "hex").copy(fixed, 40)
    const name = Buffer.from(entry.path)
    const flags =
      (entry.assumeUnchanged === true ? 0x8000 : 0) |
      (extended ? 0x4000 : 0) |
      ((entry.stage ?? 0) << 12) |
      Math.min(name.length, 0xfff)
    fixed.writeUInt16BE(flags, 60)
    if (extended)
      fixed.writeUInt16BE(
        (entry.skipWorktree === true ? 0x4000 : 0) |
          (entry.intentToAdd === true ? 0x2000 : 0),
        62
      )
    if (version === 4) {
      let common = 0
      while (
        common < previous.length &&
        common < entry.path.length &&
        previous[common] === entry.path[common]
      )
        common++
      parts.push(
        fixed,
        varint(Buffer.byteLength(previous.slice(common))),
        Buffer.from(`${entry.path.slice(common)}\0`)
      )
    } else {
      const size = (fixed.length + name.length + 8) & ~7
      parts.push(fixed, name, Buffer.alloc(size - fixed.length - name.length))
    }
    previous = entry.path
  }
  const extensions: [string, Buffer][] = [
    ...(options.tree === undefined
      ? []
      : [["TREE", treeBytes(options.tree)] as [string, Buffer]]),
    ...(options.extensions ?? []),
  ]
  for (const [signature, data] of extensions) {
    const head = Buffer.alloc(8)
    head.write(signature, 0, "latin1")
    head.writeUInt32BE(data.length, 4)
    parts.push(head, data)
  }
  const body = Buffer.concat(parts)
  return Buffer.concat([
    body,
    options.zeroChecksum === true ? Buffer.alloc(20) : sha1(body),
  ])
}

/** One object of a pack written by `writePack`: whole, or the whole of `data` inserted as a delta of an earlier object. */
export type PackObject =
  | { type: 1 | 2 | 3 | 4; data: Buffer }
  | { ofsDeltaOf: number; base: Buffer; data: Buffer }
  | { refDeltaOf: string; base: Buffer; data: Buffer }

/** A delta that inserts the whole target. */
function insertDelta(base: Buffer, target: Buffer): Buffer {
  const size = (value: number) => {
    const out: number[] = []
    do {
      let byte = value & 0x7f
      value >>>= 7
      if (value) byte |= 0x80
      out.push(byte)
    } while (value)
    return out
  }
  const out = [...size(base.length), ...size(target.length)]
  for (let at = 0; at < target.length; at += 127) {
    const chunk = target.subarray(at, at + 127)
    out.push(chunk.length, ...chunk)
  }
  return Buffer.from(out)
}

function typeHeader(type: number, size: number): Buffer {
  const out: number[] = []
  let byte = (type << 4) | (size & 0x0f)
  size = Math.floor(size / 16)
  while (size > 0) {
    out.push(byte | 0x80)
    byte = size & 0x7f
    size = Math.floor(size / 128)
  }
  out.push(byte)
  return Buffer.from(out)
}

/**
 * A pack and its `.idx` (version 2) holding `objects` under their given ids,
 * written into a git folder's `objects/pack/` and named by its checksum, as
 * git names it. `ids` names each object as the reader will look for it.
 */
export function writePack(
  git: string,
  objects: PackObject[],
  ids: string[]
): void {
  const offsets: number[] = []
  const records: Buffer[] = []
  let offset = 12
  objects.forEach((object) => {
    let record: Buffer
    if ("type" in object)
      record = Buffer.concat([
        typeHeader(object.type, object.data.length),
        deflateSync(object.data),
      ])
    else {
      const delta = insertDelta(object.base, object.data)
      if ("ofsDeltaOf" in object) {
        let distance = offset - offsets[object.ofsDeltaOf]!
        const bytes = [distance & 0x7f]
        while ((distance >>= 7)) bytes.unshift(0x80 | (--distance & 0x7f))
        record = Buffer.concat([
          typeHeader(6, delta.length),
          Buffer.from(bytes),
          deflateSync(delta),
        ])
      } else
        record = Buffer.concat([
          typeHeader(7, delta.length),
          Buffer.from(object.refDeltaOf, "hex"),
          deflateSync(delta),
        ])
    }
    offsets.push(offset)
    records.push(record)
    offset += record.length
  })
  const header = Buffer.from([
    0x50,
    0x41,
    0x43,
    0x4b,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    objects.length,
  ])
  const body = Buffer.concat([header, ...records])
  const sum = sha1(body)
  const sorted = ids
    .map((id, at) => ({
      id: Buffer.from(id, "hex"),
      offset: offsets[at]!,
      record: records[at]!,
    }))
    .sort((a, b) => Buffer.compare(a.id, b.id))
  const fanout = Buffer.alloc(1024)
  for (let byte = 0; byte < 256; byte++)
    fanout.writeUInt32BE(
      sorted.filter((each) => each.id[0]! <= byte).length,
      byte * 4
    )
  const crcs = Buffer.alloc(4 * sorted.length)
  const places = Buffer.alloc(4 * sorted.length)
  sorted.forEach((each, at) => {
    crcs.writeUInt32BE(Bun.hash.crc32(each.record) >>> 0, at * 4)
    places.writeUInt32BE(each.offset, at * 4)
  })
  const idx = Buffer.concat([
    Buffer.from([0xff, 0x74, 0x4f, 0x63, 0, 0, 0, 2]),
    fanout,
    ...sorted.map((each) => each.id),
    crcs,
    places,
    sum,
  ])
  const folder = join(git, "objects", "pack")
  mkdirSync(folder, { recursive: true })
  const stem = `pack-${sum.toString("hex")}`
  writeFileSync(join(folder, `${stem}.pack`), Buffer.concat([body, sum]))
  writeFileSync(join(folder, `${stem}.idx`), Buffer.concat([idx, sha1(idx)]))
}
