import { describe, expect, test } from "bun:test"

import { concat, toHex, utf8 } from "../../src/crypto/encoding"
import { hash } from "../../src/crypto/hash"
import { createPackChecker } from "../../src/pack/check"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"
import {
  createTarWriter,
  header,
  PACK_TIME,
  paddingFor,
  TAR_END,
  type TarEntry,
} from "../../src/pack/tar"
import { readUstar, type ReadEntry } from "./ustar-reader"

/** A 512-byte block with each field written at its offset, the checksum left as spaces. */
function block(fields: Array<[offset: number, text: string]>): Uint8Array {
  const out = new Uint8Array(512)
  out.fill(0x20, 148, 156)
  for (const [offset, text] of fields) out.set(utf8(text), offset)
  return out
}

/** The ustar checksum, worked out here apart from the writer: six octal digits, NUL, space. */
function withChecksum(bytes: Uint8Array): Uint8Array {
  const sum = bytes.reduce((total, byte) => total + byte, 0)
  bytes.set(utf8(`${sum.toString(8).padStart(6, "0")}\0 `), 148)
  return bytes
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof CoreError ? error.code : "not a CoreError"
  }
  return undefined
}

const FIXED: Array<[number, string]> = [
  [108, "0000000\0"], // uid
  [116, "0000000\0"], // gid
  [136, "07033241600\0"], // mtime: 946684800, 2000-01-01
  [257, "ustar\0"], // magic
  [263, "00"], // version
  [329, "0000000\0"], // devmajor
  [337, "0000000\0"], // devminor
]

describe("header: the exact 512 bytes of the one form (CO5, FR-016)", () => {
  test("PACK_TIME is 2000-01-01", () => {
    expect(PACK_TIME).toBe(946684800)
    expect(new Date(PACK_TIME * 1000).toISOString()).toBe(
      "2000-01-01T00:00:00.000Z"
    )
  })

  test("a file", () => {
    const expected = withChecksum(
      block([
        [0, "hello.txt"],
        [100, "0000644\0"],
        [124, "00000000005\0"],
        [156, "0"],
        ...FIXED,
      ])
    )
    expect(expected.subarray(148, 156)).toEqual(utf8("011076\0 "))
    expect(
      header({ name: "hello.txt", kind: "file", mode: 0o644, size: 5 })
    ).toEqual(expected)
  })

  test("a folder", () => {
    const expected = withChecksum(
      block([
        [0, "src/"],
        [100, "0000755\0"],
        [124, "00000000000\0"],
        [156, "5"],
        ...FIXED,
      ])
    )
    expect(
      header({ name: "src/", kind: "folder", mode: 0o755, size: 0 })
    ).toEqual(expected)
  })

  test("a split name: the last / that fits, an executable file", () => {
    const name = `${"d".repeat(60)}/${"e".repeat(60)}/${"f".repeat(30)}`
    const expected = withChecksum(
      block([
        [0, "f".repeat(30)],
        [100, "0000755\0"],
        [124, "00000001750\0"], // 1000
        [156, "0"],
        ...FIXED,
        [345, `${"d".repeat(60)}/${"e".repeat(60)}`],
      ])
    )
    expect(header({ name, kind: "file", mode: 0o755, size: 1000 })).toEqual(
      expected
    )
  })

  test("a split folder keeps its trailing / in the name field", () => {
    const name = `${"p".repeat(150)}/${"q".repeat(98)}/`
    const expected = withChecksum(
      block([
        [0, `${"q".repeat(98)}/`],
        [100, "0000755\0"],
        [124, "00000000000\0"],
        [156, "5"],
        ...FIXED,
        [345, "p".repeat(150)],
      ])
    )
    expect(header({ name, kind: "folder", mode: 0o755, size: 0 })).toEqual(
      expected
    )
  })

  test("a name of exactly 100 bytes fills the name field with no NUL", () => {
    const bytes = header({
      name: "n".repeat(100),
      kind: "file",
      mode: 0o644,
      size: 0,
    })
    expect(bytes.subarray(0, 100)).toEqual(utf8("n".repeat(100)))
    expect(bytes.subarray(345, 500).every((byte) => byte === 0)).toBe(true)
  })
})

describe("header refuses what the one form does not hold", () => {
  const file = (entry: Partial<TarEntry>) => () =>
    header({ name: "a", kind: "file", mode: 0o644, size: 0, ...entry })

  test("a name isPackName refuses", () => {
    for (const name of [
      "",
      "/a",
      "a//b",
      "a/../b",
      "./a",
      "a\nb",
      "\uD800",
      "a/",
    ])
      expect(codeOf(file({ name }))).toBe("invalid_argument")
    expect(codeOf(file({ name: "a", kind: "folder", mode: 0o755 }))).toBe(
      "invalid_argument"
    )
  })

  test("a name splitsAsUstar refuses", () => {
    expect(codeOf(file({ name: "x".repeat(101) }))).toBe("invalid_argument")
    expect(
      codeOf(file({ name: `${"x".repeat(100)}/`, kind: "folder", mode: 0o755 }))
    ).toBe("invalid_argument")
    expect(
      codeOf(file({ name: `a/${"x".repeat(160)}/${"y".repeat(90)}` }))
    ).toBe("invalid_argument")
  })

  test("a folder with mode 0644, or with a size", () => {
    expect(codeOf(file({ name: "a/", kind: "folder", mode: 0o644 }))).toBe(
      "invalid_argument"
    )
    expect(
      codeOf(file({ name: "a/", kind: "folder", mode: 0o755, size: 1 }))
    ).toBe("invalid_argument")
  })

  test("a mode other than 0644 and 0755", () => {
    for (const mode of [0o600, 0o777, 0o4755, 0])
      expect(codeOf(file({ mode: mode as 0o644 }))).toBe("invalid_argument")
  })

  test("a size that is not a whole number from 0 to the pack's limit", () => {
    for (const size of [-1, 0.5, Number.NaN, LIMITS.packBytes + 1])
      expect(codeOf(file({ size }))).toBe("invalid_argument")
    expect(codeOf(file({ size: LIMITS.packBytes }))).toBeUndefined()
  })

  test("a kind other than file and folder", () => {
    expect(codeOf(file({ kind: "link" as "file" }))).toBe("invalid_argument")
  })
})

describe("paddingFor and TAR_END", () => {
  test("padding brings data to a whole block, with zeros", () => {
    expect(paddingFor(0)).toHaveLength(0)
    expect(paddingFor(1)).toHaveLength(511)
    expect(paddingFor(511)).toHaveLength(1)
    expect(paddingFor(512)).toHaveLength(0)
    expect(paddingFor(513)).toHaveLength(511)
    expect(paddingFor(1000).every((byte) => byte === 0)).toBe(true)
  })

  test("the end is two zero blocks", () => {
    expect(TAR_END).toEqual(new Uint8Array(1024))
  })
})

type Spec = TarEntry & { data?: Uint8Array[] }

function write(entries: Spec[]): Uint8Array {
  const writer = createTarWriter()
  const parts: Uint8Array[] = []
  for (const { data = [], ...entry } of entries) {
    parts.push(writer.begin(entry))
    for (const piece of data) parts.push(writer.data(piece))
    parts.push(writer.finish())
  }
  parts.push(writer.end())
  return concat(...parts)
}

function bytesOf(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    out[i] = seed >>> 24
  }
  return out
}

// Both split between prefix and name: "deep" | "<99 l>/", "deep/<99 l>" | "<99 m>".
const longFolder = `deep/${"l".repeat(99)}/`
const splitFile = `${longFolder}${"m".repeat(99)}`
// In the order of the UTF-8 bytes: U+FF5E before U+1F600, though `<` says otherwise.
const sample: Spec[] = [
  {
    name: "Dockerfile",
    kind: "file",
    mode: 0o644,
    size: 13,
    data: [utf8("FROM scratch\n")],
  },
  { name: "deep/", kind: "folder", mode: 0o755, size: 0 },
  { name: longFolder, kind: "folder", mode: 0o755, size: 0 },
  {
    name: splitFile,
    kind: "file",
    mode: 0o644,
    size: 512,
    data: [bytesOf(512, 3)],
  },
  {
    name: "empty",
    kind: "file",
    mode: 0o644,
    size: 0,
    data: [new Uint8Array()],
  },
  { name: "src/", kind: "folder", mode: 0o755, size: 0 },
  { name: "src/a b.ts", kind: "file", mode: 0o644, size: 1, data: [utf8("x")] },
  { name: "\uFF5E", kind: "file", mode: 0o644, size: 0 },
  { name: "\u{1F600}/", kind: "folder", mode: 0o755, size: 0 },
  {
    name: "\u{1F600}/run.sh",
    kind: "file",
    mode: 0o755,
    size: 1300,
    data: [bytesOf(700, 1), bytesOf(600, 2)],
  },
]

describe("createTarWriter: the one form, read back by a second reader (CO19, item 2)", () => {
  test("the same entries give the same bytes", () => {
    expect(write(sample)).toEqual(write(sample))
  })

  test("the reader written in the test reads back every name, type, mode, size and data", () => {
    const bytes = write(sample)
    expect(bytes.length % 512).toBe(0)
    const read = readUstar(bytes)
    expect(read.endBlocks).toBe(2)
    expect(read.after).toBe(0)
    const expected: ReadEntry[] = sample.map(
      ({ name, kind, mode, size, data = [] }) => ({
        name,
        type: kind === "file" ? "0" : "5",
        mode,
        size,
        data: concat(...data),
        uid: 0,
        gid: 0,
        mtime: PACK_TIME,
      })
    )
    expect(read.entries).toEqual(expected)
  })

  test("the runner's checker, the first reader, accepts what the writer writes, with the same entries", () => {
    const bytes = write(sample)
    const checker = createPackChecker({
      size: bytes.length,
      hash: toHex(hash("zekno/v1/pack", bytes)),
    })
    const written = checker.write(bytes)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(checker.end()).toEqual({
      ok: true,
      value: { entries: sample.length },
    })
    const entries = written.value.filter((item) => item.kind !== "data")
    expect(entries).toEqual(
      sample.map(({ name, kind, mode, size }) =>
        kind === "folder" ? { kind, name } : { kind, name, mode, size }
      )
    )
    const data = written.value.flatMap((item) =>
      item.kind === "data" ? [item.bytes] : []
    )
    expect(concat(...data)).toEqual(
      concat(...sample.flatMap(({ data = [] }) => data))
    )
  })

  test("writer's data gives back the same bytes", () => {
    const writer = createTarWriter()
    writer.begin({ name: "a", kind: "file", mode: 0o644, size: 3 })
    const piece = utf8("abc")
    expect(writer.data(piece)).toEqual(piece)
  })
})

describe("createTarWriter refuses", () => {
  function opened(...names: Array<[string, "file" | "folder"]>) {
    const writer = createTarWriter()
    for (const [name, kind] of names) {
      writer.begin({
        name,
        kind,
        mode: kind === "file" ? 0o644 : 0o755,
        size: 0,
      })
      writer.finish()
    }
    return writer
  }
  const fileNamed = (name: string): TarEntry => ({
    name,
    kind: "file",
    mode: 0o644,
    size: 0,
  })

  test("an entry not after the one before, by the UTF-8 bytes", () => {
    expect(codeOf(() => opened(["b", "file"]).begin(fileNamed("a")))).toBe(
      "invalid_argument"
    )
    expect(codeOf(() => opened(["a", "file"]).begin(fileNamed("a")))).toBe(
      "invalid_argument"
    )
    expect(
      codeOf(() => opened(["\u{1F600}", "file"]).begin(fileNamed("\uFF5E")))
    ).toBe("invalid_argument")
    expect(
      codeOf(() => opened(["\uFF5E", "file"]).begin(fileNamed("\u{1F600}")))
    ).toBeUndefined()
  })

  test("an entry whose parent folder was not an earlier entry", () => {
    expect(codeOf(() => opened().begin(fileNamed("a/b")))).toBe(
      "invalid_argument"
    )
    expect(codeOf(() => opened(["a", "file"]).begin(fileNamed("a/b")))).toBe(
      "invalid_argument"
    )
    expect(
      codeOf(() => opened(["a/", "folder"]).begin(fileNamed("a/b/c")))
    ).toBe("invalid_argument")
    expect(
      codeOf(() =>
        opened(["a/", "folder"], ["a/b/", "folder"]).begin(fileNamed("a/b/c"))
      )
    ).toBeUndefined()
  })

  test("a folder with the name of an earlier file", () => {
    const folderNamed = (name: string): TarEntry => ({
      name,
      kind: "folder",
      mode: 0o755,
      size: 0,
    })
    expect(codeOf(() => opened(["a", "file"]).begin(folderNamed("a/")))).toBe(
      "invalid_argument"
    )
    expect(
      codeOf(() =>
        opened(["a", "file"], ["a-b", "file"]).begin(folderNamed("a/"))
      )
    ).toBe("invalid_argument")
    expect(
      codeOf(() =>
        opened(["s/", "folder"], ["s/a", "file"]).begin(folderNamed("s/a/"))
      )
    ).toBe("invalid_argument")
    expect(
      codeOf(() => opened(["a", "file"]).begin(folderNamed("ab/")))
    ).toBeUndefined()
  })

  test("the 50,001st entry", () => {
    const writer = createTarWriter()
    for (let i = 0; i < LIMITS.packEntries; i++) {
      writer.begin(fileNamed(`f${String(i).padStart(5, "0")}`))
      writer.finish()
    }
    expect(codeOf(() => writer.begin(fileNamed("g")))).toBe("invalid_argument")
  })

  test("a header the writer cannot make", () => {
    expect(codeOf(() => opened().begin(fileNamed("a/../b")))).toBe(
      "invalid_argument"
    )
  })

  test("data past the entry's size, and finish before all of it came", () => {
    const writer = createTarWriter()
    writer.begin({ name: "a", kind: "file", mode: 0o644, size: 3 })
    writer.data(utf8("ab"))
    expect(codeOf(() => writer.data(utf8("cd")))).toBe("invalid_argument")
    expect(codeOf(() => writer.finish())).toBe("invalid_argument")
    writer.data(utf8("c"))
    expect(writer.finish()).toEqual(paddingFor(3))
  })

  test("data or finish with no entry open", () => {
    const writer = createTarWriter()
    expect(codeOf(() => writer.data(utf8("a")))).toBe("invalid_argument")
    expect(codeOf(() => writer.finish())).toBe("invalid_argument")
  })

  test("begin or end while an entry is open", () => {
    const writer = createTarWriter()
    writer.begin(fileNamed("a"))
    expect(codeOf(() => writer.begin(fileNamed("b")))).toBe("invalid_argument")
    expect(codeOf(() => writer.end())).toBe("invalid_argument")
  })

  test("anything after the end", () => {
    const writer = createTarWriter()
    expect(writer.end()).toEqual(TAR_END)
    expect(codeOf(() => writer.begin(fileNamed("a")))).toBe("invalid_argument")
    expect(codeOf(() => writer.end())).toBe("invalid_argument")
  })
})
