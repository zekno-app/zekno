import { describe, expect, test } from "bun:test"

import { toHex, utf8 } from "../../src/crypto/encoding"
import { HASH_DOMAINS, hash } from "../../src/crypto/hash"

describe("hash domains (research R28)", () => {
  test("there are nine, the three of version 2 among them", () => {
    expect(HASH_DOMAINS).toHaveLength(9)
    for (const domain of [
      "zekno/v1/pack",
      "zekno/v1/pack-chunk",
      "zekno/v1/build",
    ] as const)
      expect(HASH_DOMAINS).toContain(domain)
  })

  test("the nine labels differ and none holds a zero byte", () => {
    expect(new Set(HASH_DOMAINS).size).toBe(HASH_DOMAINS.length)
    for (const domain of HASH_DOMAINS) expect(utf8(domain)).not.toContain(0)
  })

  test("the same bytes hash differently under every pair of domains", () => {
    const data = utf8("the same bytes")
    const hashes = HASH_DOMAINS.map((domain) => toHex(hash(domain, data)))
    expect(new Set(hashes).size).toBe(HASH_DOMAINS.length)
  })
})
