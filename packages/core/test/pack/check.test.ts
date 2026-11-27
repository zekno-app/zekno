import { describe, expect, test } from "bun:test"

import { concat, toHex, utf8 } from "../../src/crypto/encoding"
import { hash } from "../../src/crypto/hash"
import { createPackChecker, type PackItem } from "../../src/pack/check"
import {
  createTarWriter,
  header,
  TAR_END,
  type TarEntry,
} from "../../src/pack/tar"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"

const MiB = 1024 * 1024

type Spec = TarEntry & { data?: Uint8Array }

function pack(entries: Spec[]): Uint8Array {
  const writer = createTarWriter()
  const parts: Uint8Array[] = []
  for (const { data, ...entry } of entries) {
    parts.push(writer.begin(entry))
    if (data) parts.push(writer.data(data))
    parts.push(writer.finish())
  }
  parts.push(writer.end())
  return concat(...parts)
}

function signedOf(bytes: Uint8Array): { size: number; hash: string } {
  return { size: bytes.length, hash: toHex(hash("zekno/v1/pack", bytes)) }
}

type Checked =
  | { ok: true; items: PackItem[]; entries: number }
  | { ok: false; at: "write" | "end"; code: string }

/**
 * Feeds the bytes in pieces of the given sizes (the rest at the end) and
 * gathers what comes out, each file's data copied into one item, since each
 * write cuts the data where it ends.
 */
function check(
  bytes: Uint8Array,
  pieces: Iterable<number> = [],
  signed = signedOf(bytes)
): Checked {
  const checker = createPackChecker(signed)
  const items: PackItem[] = []
  let size = 0
  let data: { bytes: Uint8Array; filled: number } | undefined
  let offset = 0
  const feed = (part: Uint8Array): Checked | undefined => {
    const result = checker.write(part)
    if (!result.ok) return { ok: false, at: "write", code: result.error.code }
    for (const item of result.value) {
      if (item.kind !== "data") {
        size = item.kind === "file" ? item.size : 0
        data = undefined
        items.push(item)
        continue
      }
      if (!data) {
        data = { bytes: new Uint8Array(size), filled: 0 }
        items.push({ kind: "data", bytes: data.bytes })
      }
      data.bytes.set(item.bytes, data.filled)
      data.filled += item.bytes.length
    }
    return undefined
  }
  for (const piece of pieces) {
    const refused = feed(bytes.subarray(offset, offset + piece))
    if (refused) return refused
    offset += piece
  }
  const refused = feed(bytes.subarray(offset))
  if (refused) return refused
  const ended = checker.end()
  if (!ended.ok) return { ok: false, at: "end", code: ended.error.code }
  return { ok: true, items, entries: ended.value.entries }
}

function bytesOf(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    out[i] = seed >>> 24
  }
  return out
}

function* every(size: number, total: number): Generator<number> {
  for (let offset = 0; offset < total; offset += size)
    yield Math.min(size, total - offset)
}

const file = (
  name: string,
  data: Uint8Array,
  mode: 0o644 | 0o755 = 0o644
): Spec => ({
  name,
  kind: "file",
  mode,
  size: data.length,
  data,
})
const folder = (name: string): Spec => ({
  name,
  kind: "folder",
  mode: 0o755,
  size: 0,
})

const small = pack([
  file("Dockerfile", utf8("hello")),
  folder("deep/"),
  folder(`deep/${"l".repeat(99)}/`),
  file(`deep/${"l".repeat(99)}/${"m".repeat(99)}`, bytesOf(1300, 1), 0o755),
  file("empty", new Uint8Array()),
  folder("src/"),
  file("src/a", bytesOf(512, 2)),
  file("～", utf8("tilde")),
  folder("\u{1F600}/"),
])

describe("createPackChecker accepts the one form, however it is cut (CO5, RB4)", () => {
  test("a small pack checked whole and byte by byte gives the same items", () => {
    const whole = check(small)
    expect(whole.ok).toBe(true)
    if (!whole.ok) return
    expect(whole.entries).toBe(9)
    const byByte = check(small, every(1, small.length))
    expect(byByte.ok && byByte.items).toEqual(whole.items)
    expect(whole.items).toEqual([
      { kind: "file", name: "Dockerfile", mode: 0o644, size: 5 },
      { kind: "data", bytes: utf8("hello") },
      { kind: "folder", name: "deep/" },
      { kind: "folder", name: `deep/${"l".repeat(99)}/` },
      {
        kind: "file",
        name: `deep/${"l".repeat(99)}/${"m".repeat(99)}`,
        mode: 0o755,
        size: 1300,
      },
      { kind: "data", bytes: bytesOf(1300, 1) },
      { kind: "file", name: "empty", mode: 0o644, size: 0 },
      { kind: "folder", name: "src/" },
      { kind: "file", name: "src/a", mode: 0o644, size: 512 },
      { kind: "data", bytes: bytesOf(512, 2) },
      { kind: "file", name: "～", mode: 0o644, size: 5 },
      { kind: "data", bytes: utf8("tilde") },
      { kind: "folder", name: "\u{1F600}/" },
    ])
  })

  test("a pack past 16 MiB checked whole, byte by byte, in 8 MiB slices and in uneven ones gives the same items", () => {
    const big = pack([
      file("a", bytesOf(9 * MiB + 3, 3)),
      folder("b/"),
      file("b/c", bytesOf(8 * MiB - 100, 4), 0o755),
      file("d", utf8("end")),
    ])
    expect(big.length).toBeGreaterThan(16 * MiB)
    const whole = check(big)
    expect(whole.ok).toBe(true)
    if (!whole.ok) return
    const expected = whole.items
    expect(expected.map((item) => item.kind)).toEqual([
      "file",
      "data",
      "folder",
      "file",
      "data",
      "file",
      "data",
    ])
    for (const pieces of [
      every(1, big.length),
      every(8 * MiB, big.length),
      [1, 511, 513, 4 * MiB + 7, 1023, 5 * MiB],
    ]) {
      const cut = check(big, pieces)
      expect(cut.ok && cut.items).toEqual(expected)
    }
  }, 120_000)

  test("an item's data is the bytes written, never more than one write holds", () => {
    const checker = createPackChecker(signedOf(small))
    const first = checker.write(small.subarray(0, 515))
    expect(first.ok && first.value).toEqual([
      { kind: "file", name: "Dockerfile", mode: 0o644, size: 5 },
      { kind: "data", bytes: utf8("hel") },
    ])
  })
})

/** Offsets of the ustar fields, written out here apart from the code under test. */
const FIELDS: Array<[name: string, offset: number, changedTo: number]> = [
  ["name", 50, 0x41], // past the name's NUL
  ["mode", 106, 0x30], // 0644 to 0640
  ["uid", 114, 0x31],
  ["gid", 122, 0x31],
  ["size", 124, 0x37], // far past the pack
  ["mtime", 146, 0x31],
  ["typeflag", 156, 0x31],
  ["linkname", 157, 0x61],
  ["magic", 262, 0x20], // GNU's "ustar "
  ["version", 263, 0x20],
  ["uname", 265, 0x72],
  ["gname", 297, 0x72],
  ["devmajor", 335, 0x31],
  ["devminor", 343, 0x31],
  ["prefix", 345, 0x61],
  ["the block's last 12 bytes", 505, 0x01],
]

/** The ustar checksum made again over a changed block, as a forger would. */
function resum(bytes: Uint8Array, at = 0): Uint8Array {
  const block = bytes.subarray(at, at + 512)
  block.fill(0x20, 148, 156)
  const sum = block.reduce((total, byte) => total + byte, 0)
  block.set(utf8(`${sum.toString(8).padStart(6, "0")}\0 `), 148)
  return bytes
}

function changed(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice()
  copy[offset] = value
  return copy
}

const refusedAtWrite: Checked = {
  ok: false,
  at: "write",
  code: "pack_mismatch",
}
const refusedAtEnd: Checked = { ok: false, at: "end", code: "pack_mismatch" }

describe("pack_mismatch: anything but the one form (CO5; FR-029, FR-030)", () => {
  // Each tampered pack is signed as it is, so only the form can refuse it.
  test("one byte changed in each header field", () => {
    for (const [, offset] of [...FIELDS, ["checksum", 150, 0]] as const) {
      const bytes = changed(small, offset, small[offset]! ^ 0x01)
      expect(check(bytes)).toEqual(refusedAtWrite)
    }
  })

  test("one byte changed in each header field, with its checksum made again", () => {
    for (const [, offset, value] of FIELDS) {
      const bytes = resum(changed(small, offset, value))
      expect(check(bytes)).toEqual(refusedAtWrite)
    }
  })

  test("a checksum in another form: NUL and space swapped", () => {
    const bytes = small.slice()
    bytes[154] = 0x20
    bytes[155] = 0x00
    expect(check(bytes)).toEqual(refusedAtWrite)
  })

  test("a name split at another / than the last one that fits", () => {
    const name = `${"d".repeat(60)}/${"e".repeat(60)}/${"f".repeat(30)}`
    const written = pack([
      folder(`${"d".repeat(60)}/`),
      folder(`${"d".repeat(60)}/${"e".repeat(60)}/`),
      file(name, new Uint8Array()),
    ])
    expect(check(written).ok).toBe(true)
    const third = 1024
    const bytes = written.slice()
    bytes.fill(0, third, third + 100)
    bytes.set(utf8(`${"e".repeat(60)}/${"f".repeat(30)}`), third)
    bytes.fill(0, third + 345, third + 500)
    bytes.set(utf8("d".repeat(60)), third + 345)
    expect(check(resum(bytes, third))).toEqual(refusedAtWrite)
  })

  test("a non-zero padding byte", () => {
    // "Dockerfile" holds 5 bytes, so its padding runs from 517 to 1023.
    expect(check(changed(small, 517, 1))).toEqual(refusedAtWrite)
    expect(check(changed(small, 1023, 1))).toEqual(refusedAtWrite)
  })

  test("data cut short", () => {
    expect(check(small.slice(0, 515))).toEqual(refusedAtEnd)
  })

  test("two entries swapped, and one name twice", () => {
    const empty = new Uint8Array()
    const bytes = pack([file("a", empty), file("b", empty)])
    expect(check(bytes).ok).toBe(true)
    const swapped = concat(
      bytes.subarray(512, 1024),
      bytes.subarray(0, 512),
      TAR_END
    )
    expect(check(swapped)).toEqual(refusedAtWrite)
    const twice = concat(
      bytes.subarray(0, 512),
      bytes.subarray(0, 512),
      TAR_END
    )
    expect(check(twice)).toEqual(refusedAtWrite)
  })

  test("the order is the UTF-8 bytes', not JavaScript's <", () => {
    const empty = new Uint8Array()
    const tilde = header({ name: "～", kind: "file", mode: 0o644, size: 0 })
    const emoji = header({
      name: "\u{1F600}",
      kind: "file",
      mode: 0o644,
      size: 0,
    })
    expect(check(concat(tilde, emoji, TAR_END)).ok).toBe(true)
    expect(check(concat(emoji, tilde, TAR_END))).toEqual(refusedAtWrite)
    expect(check(pack([file("～", empty), file("\u{1F600}", empty)])).ok).toBe(
      true
    )
  })

  test("a missing parent folder", () => {
    const bytes = pack([folder("src/"), file("src/a", utf8("a"))])
    expect(check(bytes).ok).toBe(true)
    expect(check(bytes.slice(512))).toEqual(refusedAtWrite)
  })

  test("a folder with a file's name, next to it or after other entries", () => {
    // No folder walk gives a file `a` and a folder `a/`: writing the code
    // out, the runner's `mkdir a` would meet the file. The writer refuses it
    // too, so the pack is made header by header.
    const head = (name: string, kind: "file" | "folder", size = 0) =>
      header({ name, kind, mode: kind === "file" ? 0o644 : 0o755, size })
    const data = (text: string) =>
      concat(utf8(text), new Uint8Array(512 - text.length))
    const shapes = [
      [head("a", "file", 4), data("#!/x"), head("a/", "folder")],
      [head("a", "file"), head("a-b", "file"), head("a/", "folder")],
      [head("a", "file"), head("a.b/", "folder"), head("a/", "folder")],
      [head("s/", "folder"), head("s/a", "file"), head("s/a/", "folder")],
    ]
    for (const shape of shapes)
      expect(check(concat(...shape, TAR_END))).toEqual(refusedAtWrite)
    const nested = concat(
      head("a", "file", 4),
      data("#!/x"),
      head("a/", "folder"),
      head("a/Dockerfile", "file", 9),
      data("FROM x\nRU"),
      TAR_END
    )
    expect(check(nested)).toEqual(refusedAtWrite)
    // A file and a folder whose names only begin alike are two entries.
    expect(
      check(concat(head("a", "file"), head("ab/", "folder"), TAR_END)).ok
    ).toBe(true)
    expect(
      check(concat(head("a/", "folder"), head("a/a", "file"), TAR_END)).ok
    ).toBe(true)
  })

  test("typeflags 1, 2, x, g, L and K", () => {
    const plain = header({ name: "a", kind: "file", mode: 0o644, size: 0 })
    for (const flag of ["1", "2", "x", "g", "L", "K", "\0", "6"]) {
      const block = plain.slice()
      block[156] = flag.charCodeAt(0)
      expect(check(concat(resum(block), TAR_END))).toEqual(refusedAtWrite)
    }
  })

  test("a folder with a size", () => {
    const block = header({ name: "a/", kind: "folder", mode: 0o755, size: 0 })
    block.set(utf8("00000000001\0"), 124)
    const bytes = concat(resum(block), new Uint8Array(512), TAR_END)
    bytes[512] = 0x41
    expect(check(bytes)).toEqual(refusedAtWrite)
  })

  test("a name with ..", () => {
    const parent = header({ name: "a/", kind: "folder", mode: 0o755, size: 0 })
    const child = header({ name: "a/zz", kind: "file", mode: 0o644, size: 0 })
    child.set(utf8(".."), 2)
    expect(check(concat(parent, resum(child), TAR_END))).toEqual(refusedAtWrite)
  })

  test("a name that is not UTF-8", () => {
    const block = header({ name: "ab", kind: "file", mode: 0o644, size: 0 })
    block[1] = 0xff
    expect(check(concat(resum(block), TAR_END))).toEqual(refusedAtWrite)
  })

  test("50,001 entries; 50,000 pass", () => {
    const headers = Array.from({ length: LIMITS.packEntries + 1 }, (_, i) =>
      header({
        name: `f${String(i).padStart(5, "0")}`,
        kind: "file",
        mode: 0o644,
        size: 0,
      })
    )
    expect(check(concat(...headers.slice(0, -1), TAR_END))).toMatchObject({
      ok: true,
      entries: 50_000,
    })
    expect(check(concat(...headers, TAR_END))).toEqual(refusedAtWrite)
  })

  test("a third zero block, and one byte after the end", () => {
    expect(check(concat(small, new Uint8Array(512)))).toEqual(refusedAtWrite)
    expect(check(concat(small, new Uint8Array(1)))).toEqual(refusedAtWrite)
    expect(check(concat(small, utf8("A")))).toEqual(refusedAtWrite)
  })

  test("no end, or half of one", () => {
    expect(check(small.slice(0, -1024))).toEqual(refusedAtEnd)
    expect(check(small.slice(0, -512))).toEqual(refusedAtEnd)
    expect(check(small.slice(0, -1))).toEqual(refusedAtEnd)
  })

  test("an entry after one zero block", () => {
    const entry = header({ name: "z", kind: "file", mode: 0o644, size: 0 })
    const bytes = concat(
      small.subarray(0, -1024),
      new Uint8Array(512),
      entry,
      TAR_END
    )
    expect(check(bytes)).toEqual(refusedAtWrite)
  })

  test("a signed size one less and one more than the pack", () => {
    const signed = signedOf(small)
    expect(check(small, [], { ...signed, size: small.length - 1 })).toEqual(
      refusedAtWrite
    )
    expect(check(small, [], { ...signed, size: small.length + 1 })).toEqual(
      refusedAtEnd
    )
  })

  test("another signed hash", () => {
    const other = toHex(hash("zekno/v1/pack", concat(small, utf8("x"))))
    expect(check(small, [], { size: small.length, hash: other })).toEqual(
      refusedAtEnd
    )
    const chunk = toHex(hash("zekno/v1/pack-chunk", small))
    expect(check(small, [], { size: small.length, hash: chunk })).toEqual(
      refusedAtEnd
    )
  })

  test("once refused, it stays refused", () => {
    const checker = createPackChecker(signedOf(small))
    const refused = checker.write(changed(small, 0, 0x2f).subarray(0, 512))
    if (refused.ok) throw new Error("a changed header was accepted")
    expect(refused.error.code).toBe("pack_mismatch")
    expect(checker.write(small.subarray(512))).toEqual(refused)
    const ended = checker.end()
    expect(!ended.ok && ended.error).toEqual(refused.error)
  })
})

describe("createPackChecker's caller", () => {
  function codeOf(run: () => unknown): string | undefined {
    try {
      run()
    } catch (error) {
      return error instanceof CoreError ? error.code : "not a CoreError"
    }
    return undefined
  }

  test("a signed size or hash that cannot be signed throws invalid_argument", () => {
    const hash = "0".repeat(64)
    for (const size of [0, -1, 1.5, Number.NaN, LIMITS.packBytes + 1])
      expect(codeOf(() => createPackChecker({ size, hash }))).toBe(
        "invalid_argument"
      )
    for (const bad of ["", "0".repeat(63), "A".repeat(64), "g".repeat(64)])
      expect(codeOf(() => createPackChecker({ size: 1536, hash: bad }))).toBe(
        "invalid_argument"
      )
  })

  test("a write or an end after the end was accepted throws invalid_argument", () => {
    const checker = createPackChecker(signedOf(small))
    expect(checker.write(small).ok).toBe(true)
    expect(checker.end().ok).toBe(true)
    expect(codeOf(() => checker.write(new Uint8Array()))).toBe(
      "invalid_argument"
    )
    expect(codeOf(() => checker.end())).toBe("invalid_argument")
  })
})
