/**
 * The streaming checker the runner runs on a build's opened pieces, in order
 * (specs/016-build-from-source, contracts/core.md CO5; runner.md RB4; FR-029,
 * FR-030). It accepts only the one form `pack/tar.ts` writes: every header is
 * rebuilt from what was parsed and compared whole, so the mode, owner, time,
 * magic, split and checksum are each checked; then the zero padding, the
 * order, each parent folder, no folder with a file's name, the end, the
 * number of entries, the signed size and the signed fingerprint. Anything
 * else is `pack_mismatch`.
 */
import { fromUtf8, toHex } from "../crypto/encoding"
import { hashStream } from "../crypto/hash"
import { LIMITS } from "../protocol/limits"
import {
  CoreError,
  ok,
  refuse,
  type Refused,
  type Result,
} from "../protocol/result"
import {
  BLOCK_BYTES,
  compareNames,
  header,
  paddingFor,
  parentOf,
  type TarEntry,
} from "./tar"

/** What the checker gives, in the pack's order, so the runner can write the code out in the same pass. */
export type PackItem =
  | { kind: "folder"; name: string }
  | { kind: "file"; name: string; mode: 0o644 | 0o755; size: number }
  /** Part of the file before it: a view of the bytes written, not a copy. */
  | { kind: "data"; bytes: Uint8Array }

export type PackMismatch = "pack_mismatch"

export interface PackChecker {
  /** The items these bytes complete, or the refusal; once refused, always that refusal. */
  write(bytes: Uint8Array): Result<PackItem[], PackMismatch>
  /** Once every byte is written: the number of entries, or the refusal. */
  end(): Result<{ entries: number }, PackMismatch>
}

const HEX64 = /^[0-9a-f]{64}$/

// Where a header's fields sit (ustar): name, mode, size, typeflag, prefix.
const NAME: readonly [number, number] = [0, 100]
const MODE: readonly [number, number] = [100, 108]
const SIZE: readonly [number, number] = [124, 136]
const TYPEFLAG = 156
const PREFIX: readonly [number, number] = [345, 500]

/** The bytes of a text field up to its first NUL. */
function field(block: Uint8Array, [start, end]: readonly [number, number]) {
  const bytes = block.subarray(start, end)
  const nul = bytes.indexOf(0)
  return nul === -1 ? bytes : bytes.subarray(0, nul)
}

/** An octal number field, read up to its first NUL; undefined when it is not one. */
function octal(block: Uint8Array, at: readonly [number, number]) {
  const text = fromUtf8(field(block, at))
  return text !== undefined && /^[0-7]{1,12}$/.test(text)
    ? parseInt(text, 8)
    : undefined
}

/** The entry a header describes, read loosely: `header` judges it by rebuilding. */
function parse(block: Uint8Array): TarEntry | undefined {
  const kind =
    block[TYPEFLAG] === 0x30
      ? "file"
      : block[TYPEFLAG] === 0x35
        ? "folder"
        : undefined
  const prefix = fromUtf8(field(block, PREFIX))
  const last = fromUtf8(field(block, NAME))
  const mode = octal(block, MODE)
  const size = octal(block, SIZE)
  if (kind === undefined || prefix === undefined || last === undefined)
    return undefined
  if (mode !== 0o644 && mode !== 0o755) return undefined
  if (size === undefined) return undefined
  const name = prefix === "" ? last : `${prefix}/${last}`
  return { name, kind, mode, size }
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

/**
 * Checks a pack as it streams, holding at most one 512-byte block across
 * writes. `signed` is the build's signed `pack`: its size in bytes (a byte
 * past it is a fault) and its fingerprint, the hex of `hash("zekno/v1/pack",
 * …)`. A size or fingerprint no deploy could sign is the caller's mistake.
 */
export function createPackChecker(signed: {
  size: number
  hash: string
}): PackChecker {
  if (
    !Number.isSafeInteger(signed.size) ||
    signed.size < 1 ||
    signed.size > LIMITS.packBytes
  )
    throw new CoreError(
      "invalid_argument",
      "A pack's signed size is 1 byte to 512 MiB."
    )
  if (typeof signed.hash !== "string" || !HEX64.test(signed.hash))
    throw new CoreError(
      "invalid_argument",
      "A pack's signed fingerprint is 64 hex digits."
    )

  const hasher = hashStream("zekno/v1/pack")
  let hashed = false
  const block = new Uint8Array(BLOCK_BYTES)
  let filled = 0
  // header: a header or the first zero block is next; data, padding: that
  // many bytes of them are left; end: the second zero block is next; ended:
  // nothing may follow.
  let phase: "header" | "data" | "padding" | "end" | "ended" = "header"
  let left = 0
  let padding = 0
  let written = 0
  let entries = 0
  let previous: string | undefined
  const folders = new Set<string>()
  const files = new Set<string>()
  let refused: Refused<PackMismatch> | undefined
  let accepted = false

  function fail(reason: string): Refused<PackMismatch> {
    if (!refused) {
      refused = refuse(
        "pack_mismatch",
        `The code is not in the one form zekno writes: ${reason}.`
      )
      // Frees the hash's state; its digest is no longer wanted.
      if (!hashed) hasher.digest()
      hashed = true
    }
    return refused
  }

  function afterEnd(): never {
    throw new CoreError(
      "invalid_argument",
      "This pack has already been accepted."
    )
  }

  /** Judges one whole header block; a refusal, or undefined with the item given. */
  function readHeader(items: PackItem[]): Refused<PackMismatch> | undefined {
    if (isZero(block)) {
      phase = "end"
      return undefined
    }
    if (entries >= LIMITS.packEntries)
      return fail(`more than ${LIMITS.packEntries} entries`)
    const entry = parse(block)
    if (!entry) return fail("a header is not one the pack holds")
    let rebuilt: Uint8Array
    try {
      rebuilt = header(entry)
    } catch {
      return fail("a header is not one the pack holds")
    }
    if (!sameBytes(rebuilt, block))
      return fail("a header differs from the one form")
    if (previous !== undefined && compareNames(previous, entry.name) >= 0)
      return fail("an entry is out of order")
    const parent = parentOf(entry.name)
    if (parent !== undefined && !folders.has(parent))
      return fail("an entry's folder does not come before it")
    // No walk gives a file and a folder one name; by the order, the file `x`
    // always comes before the folder `x/`, so this one check finds it (FR-030).
    if (entry.kind === "folder" && files.has(entry.name.slice(0, -1)))
      return fail("a folder has a file's name")
    previous = entry.name
    entries++
    if (entry.kind === "folder") {
      folders.add(entry.name)
      items.push({ kind: "folder", name: entry.name })
      return undefined
    }
    files.add(entry.name)
    items.push({
      kind: "file",
      name: entry.name,
      mode: entry.mode,
      size: entry.size,
    })
    if (entry.size > 0) {
      phase = "data"
      left = entry.size
      padding = paddingFor(entry.size).length
    }
    return undefined
  }

  return {
    write(bytes) {
      if (refused) return refused
      if (accepted) afterEnd()
      if (written + bytes.length > signed.size)
        return fail("it is longer than signed")
      written += bytes.length
      hasher.update(bytes)
      const items: PackItem[] = []
      let at = 0
      while (at < bytes.length) {
        if (phase === "ended") return fail("bytes follow its end")
        if (phase === "data") {
          const take = Math.min(left, bytes.length - at)
          items.push({ kind: "data", bytes: bytes.subarray(at, at + take) })
          at += take
          left -= take
          if (left === 0) {
            phase = padding > 0 ? "padding" : "header"
            left = padding
          }
          continue
        }
        if (phase === "padding") {
          const take = Math.min(left, bytes.length - at)
          if (!isZero(bytes.subarray(at, at + take)))
            return fail("a file's padding is not zero")
          at += take
          left -= take
          if (left === 0) phase = "header"
          continue
        }
        const take = Math.min(BLOCK_BYTES - filled, bytes.length - at)
        block.set(bytes.subarray(at, at + take), filled)
        filled += take
        at += take
        if (filled < BLOCK_BYTES) continue
        filled = 0
        if (phase === "end") {
          if (!isZero(block)) return fail("an entry follows a zero block")
          phase = "ended"
          continue
        }
        const refusal = readHeader(items)
        if (refusal) return refusal
      }
      return ok(items)
    },
    end() {
      if (refused) return refused
      if (accepted) afterEnd()
      if (phase !== "ended") return fail("it has no end")
      if (written !== signed.size) return fail("it is shorter than signed")
      const fingerprint = toHex(hasher.digest())
      hashed = true
      if (fingerprint !== signed.hash)
        return fail("its fingerprint is not the one signed")
      accepted = true
      return ok({ entries })
    },
  }
}
