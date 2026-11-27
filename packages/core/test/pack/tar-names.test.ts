import { describe, expect, test } from "bun:test"

import { utf8 } from "../../src/crypto/encoding"
import { compareNames, isPackName, splitsAsUstar } from "../../src/pack/tar"

/** The order a byte-by-byte comparison of the UTF-8 gives, written apart from the code under test. */
function byBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(utf8(a)), Buffer.from(utf8(b)))
}

describe("compareNames: the order of the UTF-8 bytes (CO5, FR-016)", () => {
  test("it and JavaScript's < disagree on U+1F600 and U+FF5E", () => {
    const emoji = "\u{1F600}"
    const tilde = "\uFF5E"
    // UTF-16 puts the emoji's high surrogate (0xD83D) before 0xFF5E ...
    expect(emoji < tilde).toBe(true)
    // ... while UTF-8 puts 0xEF 0xBD 0x9E before 0xF0 0x9F 0x98 0x80.
    expect(compareNames(tilde, emoji)).toBeLessThan(0)
    expect(compareNames(emoji, tilde)).toBeGreaterThan(0)
  })

  test("equal names compare as 0, and a name before its longer form", () => {
    expect(compareNames("a/b", "a/b")).toBe(0)
    expect(compareNames("a", "a/")).toBeLessThan(0)
    expect(compareNames("a/", "a")).toBeGreaterThan(0)
    expect(compareNames("", "a")).toBeLessThan(0)
  })

  test("a sort by compareNames equals a sort of the UTF-8 bytes", () => {
    const names = [
      "\u{1F600}",
      "\uFF5E",
      "z",
      "Z",
      "a/",
      "a",
      "a/b",
      "a-b",
      "a.b",
      "\u00E9",
      "e\u0301",
      "\u4E2D",
      "\u{10FFFF}",
      "\uE000",
      "\uFFFD",
      "~",
      "a/\u{1F600}",
      "a/\uFF5E",
      "README.md",
      "readme.md",
      " space",
    ]
    const sorted = [...names].sort(compareNames)
    const expected = [...names].sort(byBytes)
    expect(sorted).toEqual(expected)
    expect(sorted).not.toEqual([...names].sort())
  })
})

describe("splitsAsUstar at its edges (CO5, item 16)", () => {
  const x = (n: number) => "x".repeat(n)

  test("a top-level file of 100 bytes fits, of 101 does not", () => {
    expect(splitsAsUstar(x(100))).toBe(true)
    expect(splitsAsUstar(x(101))).toBe(false)
  })

  test("a top-level folder of 99 bytes and its / fits, of 100 and its / does not", () => {
    expect(splitsAsUstar(`${x(99)}/`)).toBe(true)
    expect(splitsAsUstar(`${x(100)}/`)).toBe(false)
  })

  test("dir/<100 bytes>/ is refused: the trailing / counts", () => {
    expect(splitsAsUstar(`dir/${x(100)}/`)).toBe(false)
    expect(splitsAsUstar(`dir/${x(99)}/`)).toBe(true)
    expect(splitsAsUstar(`dir/${x(100)}`)).toBe(true)
  })

  test("a prefix of 155 bytes with a name of 100 fits, a prefix of 156 does not", () => {
    expect(splitsAsUstar(`${x(155)}/${x(100)}`)).toBe(true)
    expect(splitsAsUstar(`${x(156)}/${x(100)}`)).toBe(false)
    expect(splitsAsUstar(`${x(77)}/${x(77)}/${x(100)}`)).toBe(true)
    expect(splitsAsUstar(`${x(155)}/${x(101)}`)).toBe(false)
  })

  test("a/<160 bytes>/<90 bytes> is refused: no / splits it", () => {
    expect(splitsAsUstar(`a/${x(160)}/${x(90)}`)).toBe(false)
  })

  test("a name is counted in UTF-8 bytes, not characters", () => {
    const three = "\u3042" // three bytes in UTF-8
    expect(utf8(three.repeat(34))).toHaveLength(102)
    expect(splitsAsUstar(three.repeat(34))).toBe(false)
    expect(splitsAsUstar(three.repeat(33))).toBe(true)
  })

  test("a / at the start never splits a name", () => {
    expect(splitsAsUstar(`/${x(100)}`)).toBe(false)
  })
})

describe("isPackName: the names the one form holds (CO5, FR-030)", () => {
  test("plain names of each kind are accepted", () => {
    for (const name of [
      "a",
      "a/b",
      ".hidden",
      "...",
      "a..b",
      "with space",
      "\u{1F600}",
      "Dockerfile",
    ]) {
      expect(isPackName(name, "file")).toBe(true)
      expect(isPackName(`${name}/`, "folder")).toBe(true)
    }
  })

  test("a lone surrogate is refused (not valid UTF-8)", () => {
    expect(isPackName("\uD800", "file")).toBe(false)
    expect(isPackName("a/\uDC00b", "file")).toBe(false)
    expect(isPackName("\uD800/", "folder")).toBe(false)
  })

  test("an absolute name is refused", () => {
    expect(isPackName("/a", "file")).toBe(false)
    expect(isPackName("/a/", "folder")).toBe(false)
    expect(isPackName("/", "folder")).toBe(false)
  })

  test("an empty name or an empty part is refused", () => {
    expect(isPackName("", "file")).toBe(false)
    expect(isPackName("a//b", "file")).toBe(false)
    expect(isPackName("a//", "folder")).toBe(false)
    expect(isPackName("a//b/", "folder")).toBe(false)
  })

  test("a . or .. part is refused", () => {
    for (const name of [
      ".",
      "..",
      "./a",
      "a/.",
      "a/./b",
      "../a",
      "a/..",
      "a/../b",
    ]) {
      expect(isPackName(name, "file")).toBe(false)
      expect(isPackName(`${name}/`, "folder")).toBe(false)
    }
  })

  test("a control character is refused", () => {
    for (const control of [
      "\u0000",
      "\u0001",
      "\n",
      "\t",
      "\u001f",
      "\u007f",
      "\u0085",
      "\u009f",
    ]) {
      expect(isPackName(`a${control}b`, "file")).toBe(false)
      expect(isPackName(`a${control}b/`, "folder")).toBe(false)
    }
  })

  test("a folder ends with exactly one /, a file never with one", () => {
    expect(isPackName("a", "folder")).toBe(false)
    expect(isPackName("a/b", "folder")).toBe(false)
    expect(isPackName("a//", "folder")).toBe(false)
    expect(isPackName("a/", "file")).toBe(false)
    expect(isPackName("a/b/", "file")).toBe(false)
  })

  test("a value that is not text is refused", () => {
    expect(isPackName(undefined as unknown as string, "file")).toBe(false)
    expect(isPackName(7 as unknown as string, "folder")).toBe(false)
  })
})
