import { describe, expect, test } from "bun:test"
import { constants, zstdCompressSync } from "node:zlib"

import { toHex, utf8 } from "../../src/crypto/encoding"
import { hash } from "../../src/crypto/hash"
import {
  decodeKey,
  generateMemberKeyPair,
  generateServerKeyPair,
  type ServerPublicKey,
} from "../../src/crypto/keys"
import { sodium } from "../../src/crypto/sodium"
import {
  compressPiece,
  cutPieces,
  decompressPiece,
  pieceCount,
  pieceFingerprint,
  pieceLength,
  sealPiece,
} from "../../src/pack/pieces"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"

const MiB = 1024 * 1024

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof CoreError ? error.code : "not a CoreError"
  }
  return undefined
}

describe("pieceLength: L(i) = min(8 MiB, size - i * 8 MiB) (CO5, FR-029a)", () => {
  test("8 MiB is the piece", () => {
    expect(LIMITS.chunkBytes).toBe(8 * MiB)
  })

  for (const size of [1, 8 * MiB, 8 * MiB + 1, 512 * MiB]) {
    test(`a pack of ${size} bytes`, () => {
      const count = Math.ceil(size / (8 * MiB))
      expect(pieceCount(size)).toBe(count)
      let total = 0
      for (let i = 0; i < count; i++) {
        const length = pieceLength(size, i)
        expect(length).toBe(Math.min(8 * MiB, size - i * 8 * MiB))
        total += length
      }
      expect(total).toBe(size)
      expect(codeOf(() => pieceLength(size, count))).toBe("invalid_argument")
      expect(codeOf(() => pieceLength(size, -1))).toBe("invalid_argument")
      expect(codeOf(() => pieceLength(size, 0.5))).toBe("invalid_argument")
    })
  }

  test("the counts: 1, 1, 2 and 64", () => {
    expect([1, 8 * MiB, 8 * MiB + 1, 512 * MiB].map(pieceCount)).toEqual([
      1, 1, 2, 64,
    ])
  })

  test("a size no pack has throws", () => {
    for (const size of [0, -1, 1.5, LIMITS.packBytes + 1]) {
      expect(codeOf(() => pieceLength(size, 0))).toBe("invalid_argument")
      expect(codeOf(() => pieceCount(size))).toBe("invalid_argument")
    }
  })
})

describe("cutPieces: fixed 8 MiB slices of the bytes, never at entries", () => {
  test("8 MiB + 1 bytes give 8 MiB and 1 byte, the same bytes in order", () => {
    const tar = sodium.randombytes_buf(8 * MiB + 1)
    const pieces = cutPieces(tar)
    expect(pieces.map((piece) => piece.length)).toEqual([8 * MiB, 1])
    expect(pieces[0]).toEqual(tar.subarray(0, 8 * MiB))
    expect(pieces[1]).toEqual(tar.subarray(8 * MiB))
  })

  test("one byte and 16 MiB", () => {
    expect(cutPieces(new Uint8Array(1)).map((piece) => piece.length)).toEqual([
      1,
    ])
    expect(
      cutPieces(new Uint8Array(16 * MiB)).map((piece) => piece.length)
    ).toEqual([8 * MiB, 8 * MiB])
  })

  test("no bytes, or more than a pack holds, throws", () => {
    expect(codeOf(() => cutPieces(new Uint8Array()))).toBe("invalid_argument")
    expect(codeOf(() => cutPieces(new Uint8Array(LIMITS.packBytes + 1)))).toBe(
      "invalid_argument"
    )
  })
})

describe("compressPiece and decompressPiece: zstd, bounded by the length (item 10 (a))", () => {
  test("zstd at level 3, as node:zlib makes it", () => {
    const bytes = new TextEncoder().encode("the same text again ".repeat(1000))
    const expected = zstdCompressSync(bytes, {
      params: { [constants.ZSTD_c_compressionLevel]: 3 },
    })
    expect(compressPiece(bytes)).toEqual(new Uint8Array(expected))
    expect(compressPiece(bytes).subarray(0, 4)).toEqual(
      new Uint8Array([0x28, 0xb5, 0x2f, 0xfd])
    )
  })

  test("8 MiB of random bytes make the round trip", () => {
    const bytes = sodium.randombytes_buf(8 * MiB)
    const opened = decompressPiece(compressPiece(bytes), 8 * MiB)
    expect(opened).toBeInstanceOf(Uint8Array)
    expect(opened!.length).toBe(8 * MiB)
    expect(Buffer.from(opened!).equals(Buffer.from(bytes))).toBe(true)
  })

  test("a 64 MiB zero bomb fails at 8 MiB, without making 64 MiB", () => {
    const zeros = new Uint8Array(64 * MiB)
    const bomb = compressPiece(zeros)
    expect(bomb.length).toBeLessThan(4 * 1024)
    Bun.gc(true)
    const before = process.memoryUsage().rss
    expect(decompressPiece(bomb, 8 * MiB)).toBeUndefined()
    const grown = process.memoryUsage().rss - before
    expect(grown).toBeLessThan(32 * MiB)
    // Kept alive to here, so its pages cannot be reused for an output of 64 MiB.
    expect(zeros.length).toBe(64 * MiB)
  })

  test("a piece that opens to one byte more or one less than the length fails", () => {
    const bytes = sodium.randombytes_buf(1000)
    const compressed = compressPiece(bytes)
    expect(decompressPiece(compressed, 1000)).toEqual(bytes)
    expect(decompressPiece(compressed, 999)).toBeUndefined()
    expect(decompressPiece(compressed, 1001)).toBeUndefined()
  })

  test("bytes that are not zstd fail", () => {
    expect(decompressPiece(sodium.randombytes_buf(1000), 1000)).toBeUndefined()
    expect(decompressPiece(new Uint8Array(), 1)).toBeUndefined()
  })

  test("a length outside 1 to 8 MiB throws", () => {
    const compressed = compressPiece(new Uint8Array(1))
    for (const length of [0, -1, 1.5, 8 * MiB + 1])
      expect(codeOf(() => decompressPiece(compressed, length))).toBe(
        "invalid_argument"
      )
  })
})

describe("sealPiece: compressed, then sealed for the server's key (CO5; FR-026, FR-029a)", () => {
  const server = generateServerKeyPair()

  function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
    return Buffer.from(haystack).indexOf(Buffer.from(needle)) !== -1
  }

  test("a sealed piece is at most 8 MiB + 64 KiB", () => {
    expect(LIMITS.sealedPieceBytes).toBe(8 * MiB + 64 * 1024)
  })

  test("8 MiB of random bytes sealed stays within sealedPieceBytes", () => {
    const { sealed } = sealPiece(
      sodium.randombytes_buf(8 * MiB),
      server.publicKey
    )
    expect(sealed.length).toBeGreaterThan(8 * MiB)
    expect(sealed.length).toBeLessThanOrEqual(LIMITS.sealedPieceBytes)
  })

  test("the server's key opens it to the compressed piece and nothing else", () => {
    const bytes = utf8("FROM scratch\n".repeat(100))
    const { sealed } = sealPiece(bytes, server.publicKey)
    const opened = sodium.crypto_box_seal_open(
      sealed,
      decodeKey("serverPublic", server.publicKey),
      decodeKey("serverSecret", server.secretKey)
    )
    expect(opened).toEqual(compressPiece(bytes))
    expect(decompressPiece(opened, bytes.length)).toEqual(bytes)
  })

  test("the fingerprint is the hex of hash(zekno/v1/pack-chunk, sealed), as pieceFingerprint gives it", () => {
    const { sealed, fingerprint } = sealPiece(utf8("a piece"), server.publicKey)
    expect(fingerprint).toBe(toHex(hash("zekno/v1/pack-chunk", sealed)))
    expect(pieceFingerprint(sealed)).toBe(fingerprint)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  test("the same piece sealed twice gives two fingerprints", () => {
    const bytes = utf8("the same piece")
    const first = sealPiece(bytes, server.publicKey)
    const second = sealPiece(bytes, server.publicKey)
    expect(first.sealed).not.toEqual(second.sealed)
    expect(first.fingerprint).not.toBe(second.fingerprint)
  })

  test("a marker in a piece that compresses well, and in one that does not, is in neither sealed piece (SC-007)", () => {
    const marker = utf8("ZEKNO-MARKER-7f3a9c1e-never-in-a-sealed-piece")
    const plain = utf8(
      `${"line of text\n".repeat(4000)}${new TextDecoder().decode(marker)}\n`
    )
    const random = sodium.randombytes_buf(64 * 1024)
    random.set(marker, 30_000)
    for (const bytes of [plain, random]) {
      expect(contains(bytes, marker)).toBe(true)
      const { sealed } = sealPiece(bytes, server.publicKey)
      expect(contains(sealed, marker)).toBe(false)
    }
    // The random piece's marker is still whole once compressed: only the seal hides it.
    expect(contains(compressPiece(random), marker)).toBe(true)
  })

  test("a text that is not a server's public key throws invalid_key", () => {
    const member = generateMemberKeyPair().publicKey
    for (const key of [member, "zk_spk_short", "", server.secretKey])
      expect(
        codeOf(() => sealPiece(utf8("a"), key as unknown as ServerPublicKey))
      ).toBe("invalid_key")
  })

  test("0 bytes and 8 MiB + 1 throw invalid_argument", () => {
    expect(codeOf(() => sealPiece(new Uint8Array(), server.publicKey))).toBe(
      "invalid_argument"
    )
    expect(
      codeOf(() => sealPiece(new Uint8Array(8 * MiB + 1), server.publicKey))
    ).toBe("invalid_argument")
    expect(
      codeOf(() => sealPiece(new Uint8Array(8 * MiB), server.publicKey))
    ).toBeUndefined()
  })
})

describe("core's dependencies (item 10: zstd is Bun's own node:zlib)", () => {
  test("exactly libsodium-wrappers and zod", async () => {
    const manifest = (await Bun.file(
      new URL("../../package.json", import.meta.url)
    ).json()) as { dependencies?: Record<string, string> }
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "libsodium-wrappers",
      "zod",
    ])
  })
})
