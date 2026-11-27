/**
 * Objects in a repository's packs, read from files with no `git` run
 * (specs/016-build-from-source, contracts/cli.md CL4 steps 2 and 3; plan.md
 * item 9 (a)), as git's `Documentation/gitformat-pack.txt` lays them out: an
 * `.idx` of version 2 beside each `.pack` of version 2 or 3, objects whole or
 * as offset and reference deltas.
 *
 * Both files are read in small bounded pieces at the places the index names,
 * never whole: an object is at most 16 MiB inflated and 64 deltas deep, and
 * anything malformed gives up. `git/objects.ts` checks every object it gives
 * against its id.
 */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

/** The most an object may hold inflated, in bytes (CL4 step 2). */
export const OBJECT_BYTES = 16 * 1024 * 1024

/** The most deltas an object may be built through (CL4 step 2). */
export const DELTA_DEPTH = 64

/** The most packs one repository's reader opens. */
export const PACK_FILES = 256

/** An object's kind by its number in a pack, and its bytes. */
export type RawObject = { readonly kind: 1 | 2 | 3 | 4; readonly data: Buffer }

/** Raised inside the reader on anything it does not take; the reader then gives up. */
export class Malformed extends Error {}

const HASH_BYTES = 20
const IDX_HEADER = 8 + 256 * 4

/** A regular file opened without blocking, with its size; undefined when it is not one. */
function openFile(path: string): { fd: number; size: number } | undefined {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch {
    return undefined
  }
  const info = fstatSync(fd)
  if (!info.isFile()) {
    closeSync(fd)
    return undefined
  }
  return { fd, size: info.size }
}

/** Up to `length` bytes of an open file from `position`; fewer only at its end. */
function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const read = readSync(fd, buffer, done, length - done, position + done)
    if (read === 0) break
    done += read
  }
  return buffer.subarray(0, done)
}

/** Inflated zlib data of exactly `size` bytes, from compressed bytes that may run past its end. */
export function inflateExactly(compressed: Buffer, size: number): Buffer {
  let data: Buffer
  try {
    data = inflateSync(compressed, { maxOutputLength: Math.max(size, 1) })
  } catch {
    throw new Malformed()
  }
  if (data.length !== size) throw new Malformed()
  return data
}

/** A delta applied to its base, as git's `patch_delta` applies it. */
function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let at = 0
  const size = () => {
    let value = 0
    let shift = 0
    for (;;) {
      if (at >= delta.length || shift > 49) throw new Malformed()
      const byte = delta[at++]!
      value += (byte & 0x7f) * 2 ** shift
      shift += 7
      if (!(byte & 0x80)) return value
    }
  }
  if (size() !== base.length) throw new Malformed()
  const target = size()
  if (target > OBJECT_BYTES) throw new Malformed()
  const out = Buffer.alloc(target)
  let written = 0
  const next = () => {
    if (at >= delta.length) throw new Malformed()
    return delta[at++]!
  }
  while (at < delta.length) {
    const op = next()
    if (op & 0x80) {
      let offset = 0
      let length = 0
      if (op & 0x01) offset += next()
      if (op & 0x02) offset += next() * 0x100
      if (op & 0x04) offset += next() * 0x10000
      if (op & 0x08) offset += next() * 0x1000000
      if (op & 0x10) length += next()
      if (op & 0x20) length += next() * 0x100
      if (op & 0x40) length += next() * 0x10000
      if (length === 0) length = 0x10000
      if (offset + length > base.length || written + length > target)
        throw new Malformed()
      base.copy(out, written, offset, offset + length)
      written += length
    } else if (op !== 0) {
      if (at + op > delta.length || written + op > target) throw new Malformed()
      delta.copy(out, written, at, at + op)
      at += op
      written += op
    } else throw new Malformed()
  }
  if (written !== target) throw new Malformed()
  return out
}

/** Finds an object by id in any pack or as a loose file, for a reference delta's base, one level deeper. */
export type BaseReader = (oid: string, depth: number) => RawObject

/** One pack and its index, open for reading. */
class Pack {
  private constructor(
    private readonly idx: { fd: number; size: number },
    private readonly pack: { fd: number; size: number },
    private readonly count: number,
    private readonly fanout: readonly number[],
    private readonly largeOffsets: number
  ) {}

  /** A pack and its `.idx`, their headers checked, or undefined when either is malformed. */
  static open(idxPath: string, packPath: string): Pack | undefined {
    const idx = openFile(idxPath)
    const pack = idx === undefined ? undefined : openFile(packPath)
    if (idx === undefined || pack === undefined) {
      if (idx !== undefined) closeSync(idx.fd)
      return undefined
    }
    const head = readAt(idx.fd, 0, IDX_HEADER)
    const packHead = readAt(pack.fd, 0, 12)
    const fanout = Array.from({ length: 256 }, (_, at) =>
      head.length === IDX_HEADER ? head.readUInt32BE(8 + at * 4) : 0
    )
    const count = fanout[255]!
    const least = IDX_HEADER + count * (HASH_BYTES + 8) + 2 * HASH_BYTES
    const fine =
      head.length === IDX_HEADER &&
      head.readUInt32BE(0) === 0xff744f63 &&
      head.readUInt32BE(4) === 2 &&
      fanout.every((value, at) => at === 0 || value >= fanout[at - 1]!) &&
      idx.size >= least &&
      (idx.size - least) % 8 === 0 &&
      packHead.length === 12 &&
      packHead.toString("latin1", 0, 4) === "PACK" &&
      [2, 3].includes(packHead.readUInt32BE(4)) &&
      packHead.readUInt32BE(8) === count &&
      pack.size >= 12 + HASH_BYTES
    if (!fine) {
      closeSync(idx.fd)
      closeSync(pack.fd)
      return undefined
    }
    return new Pack(idx, pack, count, fanout, (idx.size - least) / 8)
  }

  close(): void {
    closeSync(this.idx.fd)
    closeSync(this.pack.fd)
  }

  /** Where an object is in the pack, by a binary search of the index's sorted ids; undefined when it is not there. */
  offsetOf(id: Buffer): number | undefined {
    let low = id[0] === 0 ? 0 : this.fanout[id[0]! - 1]!
    let high = this.fanout[id[0]!]!
    while (low < high) {
      const middle = (low + high) >>> 1
      const found = readAt(
        this.idx.fd,
        IDX_HEADER + middle * HASH_BYTES,
        HASH_BYTES
      )
      if (found.length !== HASH_BYTES) throw new Malformed()
      const order = Buffer.compare(found, id)
      if (order === 0) return this.offsetAt(middle)
      if (order < 0) low = middle + 1
      else high = middle
    }
    return undefined
  }

  /** The offset of the object at a place in the index: 31 bits, or a place in the table of large offsets. */
  private offsetAt(place: number): number {
    const table = IDX_HEADER + this.count * (HASH_BYTES + 4)
    const small = readAt(this.idx.fd, table + place * 4, 4)
    if (small.length !== 4) throw new Malformed()
    let offset = small.readUInt32BE(0)
    if (offset & 0x80000000) {
      const large = offset & 0x7fffffff
      if (large >= this.largeOffsets) throw new Malformed()
      const bytes = readAt(this.idx.fd, table + this.count * 4 + large * 8, 8)
      if (bytes.length !== 8) throw new Malformed()
      offset = Number(bytes.readBigUInt64BE(0))
    }
    if (offset < 12 || offset >= this.pack.size - HASH_BYTES)
      throw new Malformed()
    return offset
  }

  /** The object at an offset, its deltas applied, at most `DELTA_DEPTH` deep. */
  objectAt(offset: number, depth: number, base: BaseReader): RawObject {
    if (depth > DELTA_DEPTH) throw new Malformed()
    const end = this.pack.size - HASH_BYTES
    const head = readAt(this.pack.fd, offset, Math.min(32, end - offset))
    let at = 0
    const next = () => {
      if (at >= head.length) throw new Malformed()
      return head[at++]!
    }
    let byte = next()
    const kind = (byte >> 4) & 7
    let size = byte & 0x0f
    let shift = 4
    while (byte & 0x80) {
      byte = next()
      size += (byte & 0x7f) * 2 ** shift
      shift += 7
      if (shift > 46) throw new Malformed()
    }
    if (size > OBJECT_BYTES) throw new Malformed()
    let baseAt: number | undefined
    let baseId: string | undefined
    if (kind === 6) {
      byte = next()
      let distance = byte & 0x7f
      while (byte & 0x80) {
        byte = next()
        distance = (distance + 1) * 128 + (byte & 0x7f)
        if (distance > offset) throw new Malformed()
      }
      baseAt = offset - distance
      if (baseAt < 12 || baseAt >= offset) throw new Malformed()
    } else if (kind === 7) {
      if (at + HASH_BYTES > head.length) throw new Malformed()
      baseId = head.toString("hex", at, at + HASH_BYTES)
      at += HASH_BYTES
    } else if (kind < 1 || kind > 4) throw new Malformed()
    // Deflate never grows data by more than a few bytes in a thousand.
    const start = offset + at
    const window = Math.min(end - start, size + (size >>> 10) + 64)
    const data = inflateExactly(readAt(this.pack.fd, start, window), size)
    if (kind >= 1 && kind <= 4) return { kind: kind as RawObject["kind"], data }
    const from =
      baseAt !== undefined
        ? this.objectAt(baseAt, depth + 1, base)
        : base(baseId!, depth + 1)
    return { kind: from.kind, data: applyDelta(from.data, data) }
  }
}

/** The packs of a repository's `objects/pack/`, opened as they are first needed. */
export class Packs {
  private packs: Pack[] | undefined

  constructor(private readonly objects: string) {}

  /** Every pack with its `.idx`; a folder of more than `PACK_FILES`, or a pack that is malformed, gives up. */
  private all(): Pack[] {
    if (this.packs !== undefined) return this.packs
    let names: string[]
    try {
      names = readdirSync(join(this.objects, "pack"))
    } catch {
      names = []
    }
    const stems = names
      .filter((name) => /^pack-[0-9a-f]{40,64}\.idx$/.test(name))
      .map((name) => name.slice(0, -".idx".length))
      .sort()
    if (stems.length > PACK_FILES) throw new Malformed()
    this.packs = []
    for (const stem of stems) {
      const pack = Pack.open(
        join(this.objects, "pack", `${stem}.idx`),
        join(this.objects, "pack", `${stem}.pack`)
      )
      if (pack === undefined) throw new Malformed()
      this.packs.push(pack)
    }
    return this.packs
  }

  /** An object by its id from the first pack that holds it, or undefined when none does. */
  find(oid: string, depth: number, base: BaseReader): RawObject | undefined {
    const id = Buffer.from(oid, "hex")
    for (const pack of this.all()) {
      const offset = pack.offsetOf(id)
      if (offset !== undefined) return pack.objectAt(offset, depth, base)
    }
    return undefined
  }

  close(): void {
    for (const pack of this.packs ?? []) pack.close()
    this.packs = undefined
  }
}
