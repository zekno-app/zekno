import { describe, expect, test } from "bun:test"

import { toHex, utf8 } from "../../src/crypto/encoding"
import { HASH_DOMAINS, hash, hashStream } from "../../src/crypto/hash"
import { CoreError } from "../../src/protocol/result"

const MiB = 1024 * 1024

describe("hash domains (research R28)", () => {
  test("the list is pinned: 014's nine, then the plan, the build's reads and the build salt (016, CO5)", () => {
    expect([...HASH_DOMAINS]).toEqual([
      "zekno/v1/key-id",
      "zekno/v1/server-id",
      "zekno/v1/secret",
      "zekno/v1/roster",
      "zekno/v1/confirm/server",
      "zekno/v1/confirm/roster",
      "zekno/v1/pack",
      "zekno/v1/pack-chunk",
      "zekno/v1/build",
      "zekno/v1/plan",
      "zekno/v1/build-reads",
      "zekno/v1/build-salt",
    ])
  })

  test("the labels differ and none holds a zero byte", () => {
    expect(new Set(HASH_DOMAINS).size).toBe(HASH_DOMAINS.length)
    for (const domain of HASH_DOMAINS) expect(utf8(domain)).not.toContain(0)
  })

  test("the same bytes hash differently under every pair of domains", () => {
    const data = utf8("the same bytes")
    const hashes = HASH_DOMAINS.map((domain) => toHex(hash(domain, data)))
    expect(new Set(hashes).size).toBe(HASH_DOMAINS.length)
  })
})

/** Deterministic bytes, so a failure can be run again with the same input. */
function bytesOf(length: number): Uint8Array {
  const out = new Uint8Array(length)
  let seed = 0x2545f491
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    out[i] = seed >>> 24
  }
  return out
}

function streamed(
  domain: (typeof HASH_DOMAINS)[number],
  data: Uint8Array,
  pieces: Iterable<number>,
  length?: number
): Uint8Array {
  const stream = hashStream(domain, length)
  let offset = 0
  for (const size of pieces) {
    stream.update(data.subarray(offset, offset + size))
    offset += size
  }
  stream.update(data.subarray(offset))
  return stream.digest()
}

/** 64 KiB pieces, the last one short. */
function* even(total: number): Generator<number> {
  for (let offset = 0; offset < total; offset += 64 * 1024)
    yield Math.min(64 * 1024, total - offset)
}

/** Pieces of uneven sizes, empty ones among them, never past the end. */
function* uneven(total: number): Generator<number> {
  const sizes = [1, 0, 7, 65_537, 3, 1_000_003, 128, 0, 511, 4_194_305]
  let offset = 0
  for (let i = 0; offset < total; i++) {
    const size = Math.min(sizes[i % sizes.length]!, total - offset)
    yield size
    offset += size
  }
}

describe("hashStream equals the one-shot hash (CO5, FR-016)", () => {
  const big = bytesOf(20 * MiB)

  test("empty data, for every domain", () => {
    for (const domain of HASH_DOMAINS) {
      const stream = hashStream(domain)
      expect(toHex(stream.digest())).toBe(toHex(hash(domain, new Uint8Array())))
      expect(toHex(streamed(domain, new Uint8Array(), []))).toBe(
        toHex(hash(domain, new Uint8Array()))
      )
    }
  })

  test("one byte, for every domain", () => {
    for (const domain of HASH_DOMAINS) {
      const one = new Uint8Array([0x5a])
      expect(toHex(streamed(domain, one, [1]))).toBe(toHex(hash(domain, one)))
    }
  })

  test("20 MiB in 64 KiB pieces and in uneven pieces, for every domain", () => {
    for (const domain of HASH_DOMAINS) {
      const whole = toHex(hash(domain, big))
      expect(toHex(streamed(domain, big, even(big.length)))).toBe(whole)
      expect(toHex(streamed(domain, big, uneven(big.length)))).toBe(whole)
    }
  }, 120_000)

  test("another length gives the one-shot hash of that length", () => {
    const data = bytesOf(1000)
    const short = streamed("zekno/v1/pack", data, [10, 990], 16)
    expect(short).toHaveLength(16)
    expect(toHex(short)).toBe(toHex(hash("zekno/v1/pack", data, 16)))
  })

  test("a byte changed changes the digest", () => {
    const data = bytesOf(4096)
    const before = toHex(streamed("zekno/v1/pack", data, [100]))
    data[4000] = data[4000]! ^ 1
    expect(toHex(streamed("zekno/v1/pack", data, [100]))).not.toBe(before)
  })
})

describe("hashStream once digested", () => {
  function codeOf(run: () => unknown): string | undefined {
    try {
      run()
    } catch (error) {
      return error instanceof CoreError ? error.code : "not a CoreError"
    }
    return undefined
  }

  test("digest twice throws invalid_argument", () => {
    const stream = hashStream("zekno/v1/plan")
    stream.update(utf8("plan"))
    stream.digest()
    expect(codeOf(() => stream.digest())).toBe("invalid_argument")
  })

  test("an update after digest throws invalid_argument", () => {
    const stream = hashStream("zekno/v1/build-reads")
    stream.digest()
    expect(codeOf(() => stream.update(utf8("late")))).toBe("invalid_argument")
  })
})
