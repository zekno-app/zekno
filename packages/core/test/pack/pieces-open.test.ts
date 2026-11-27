/**
 * Opening a piece on the runner (specs/016-build-from-source,
 * contracts/core.md CO5, CO19; FR-026, FR-029): only for a deploy
 * `verifyDeployV2` registered, as `openSecrets` opens secrets; a sealed
 * piece over its bound is refused before it is opened; it must open with
 * the deploy's server's key and decompress to exactly its signed length.
 * Anything else is `pack_mismatch`. Sealing is in pieces.test.ts.
 */
import { describe, expect, test } from "bun:test"

import { verifyDeploy } from "../../src/index"
import { utf8 } from "../../src/crypto/encoding"
import {
  decodeKey,
  generateServerKeyPair,
  type ServerSecretKey,
} from "../../src/crypto/keys"
import { sodium } from "../../src/crypto/sodium"
import type { VerifiedDeployV2 } from "../../src/deploy/deploy-v2"
import { admitPiece } from "../../src/deploy/gate"
import { isRegistered } from "../../src/deploy/open"
import { compressPiece, openPiece, sealPiece } from "../../src/pack/pieces"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"
import { publish } from "../support/helpers"
import {
  deployV2,
  NOW,
  reason,
  verify,
  world,
  type World,
} from "../support/deploy-v2"
import { build, hex } from "../support/payload-v2"

const MiB = 1024 * 1024

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return error instanceof CoreError ? error.code : "not a CoreError"
  }
  return undefined
}

/** A deploy whose one build lists this piece, verified on this world's server, and the envelope it came in. */
async function listing(w: World, fingerprint: string) {
  const { envelope } = await deployV2(w, {
    builds: [
      build({ pack: { hash: hex(100), size: 1000, chunks: [fingerprint] } }),
    ],
  })
  const result = verify(w, envelope)
  if (!result.ok) throw new Error(result.error.code)
  return { envelope, verified: result.value }
}

/** A deploy with no build, verified: `openPiece` asks only that a verifier registered it. */
async function verifiedDeploy(w: World): Promise<VerifiedDeployV2> {
  const result = verify(w, (await deployV2(w)).envelope)
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

/** `bytes` compressed and sealed for `publicKey`, as `sealPiece` does, with no bound on `bytes`. */
const sealedFor = (bytes: Uint8Array, publicKey: string) =>
  sodium.crypto_box_seal(
    compressPiece(bytes),
    decodeKey("serverPublic", publicKey)
  )

describe("openPiece: a piece opens to exactly its bytes", () => {
  test("a listed piece of a verified deploy opens to the bytes sealed", async () => {
    const w = await world()
    const bytes = sodium.randombytes_buf(1000)
    const { sealed, fingerprint } = sealPiece(bytes, w.server.publicKey)
    const { verified } = await listing(w, fingerprint)
    const opened = openPiece(verified, sealed, 1000, w.server.secretKey)
    expect(reason(opened)).toBe("accepted")
    if (opened.ok) expect(opened.value).toEqual(bytes)
    // Opening uses nothing up: the same piece opens again.
    expect(reason(openPiece(verified, sealed, 1000, w.server.secretKey))).toBe(
      "accepted"
    )
  })

  test("8 MiB of random bytes open whole", async () => {
    const w = await world()
    const bytes = sodium.randombytes_buf(LIMITS.chunkBytes)
    const { sealed } = sealPiece(bytes, w.server.publicKey)
    const opened = openPiece(
      await verifiedDeploy(w),
      sealed,
      LIMITS.chunkBytes,
      w.server.secretKey
    )
    expect(
      opened.ok && Buffer.from(opened.value).equals(Buffer.from(bytes))
    ).toBe(true)
  })
})

describe("openPiece: pack_mismatch", () => {
  test("sealed for one byte more, or one less, than the length", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    for (const size of [1001, 999]) {
      const { sealed } = sealPiece(
        sodium.randombytes_buf(size),
        w.server.publicKey
      )
      expect(
        reason(openPiece(verified, sealed, 1000, w.server.secretKey))
      ).toBe("pack_mismatch")
    }
  })

  test("a piece sealed for server A, in a deploy to server B, opened with B's key (FR-026)", async () => {
    const w = await world()
    const serverA = generateServerKeyPair()
    // Server B is this world's: the deploy is addressed to it and lists the piece.
    const { sealed, fingerprint } = sealPiece(
      utf8("code for server A"),
      serverA.publicKey
    )
    const { envelope, verified } = await listing(w, fingerprint)
    expect(
      reason(admitPiece({ envelope, state: w.state, now: NOW, piece: sealed }))
    ).toBe("accepted")
    expect(reason(openPiece(verified, sealed, 17, w.server.secretKey))).toBe(
      "pack_mismatch"
    )
  })

  test("a 64 MiB zero bomb sealed as a piece, without making 64 MiB", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    const zeros = new Uint8Array(64 * MiB)
    const bomb = sealedFor(zeros, w.server.publicKey)
    expect(bomb.length).toBeLessThan(4 * 1024)
    Bun.gc(true)
    const before = process.memoryUsage().rss
    expect(
      reason(openPiece(verified, bomb, LIMITS.chunkBytes, w.server.secretKey))
    ).toBe("pack_mismatch")
    expect(process.memoryUsage().rss - before).toBeLessThan(32 * MiB)
    // Kept alive to here, so its pages cannot be reused for an output of 64 MiB.
    expect(zeros.length).toBe(64 * MiB)
  })

  test("sealedPieceBytes + 1 bytes, before anything is opened", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    const over = new Uint8Array(LIMITS.sealedPieceBytes + 1)
    expect(reason(openPiece(verified, over, 1, w.server.secretKey))).toBe(
      "pack_mismatch"
    )
  })

  test("random bytes, and no bytes", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    for (const sealed of [
      sodium.randombytes_buf(1000),
      sodium.randombytes_buf(LIMITS.sealedPieceBytes),
      new Uint8Array(),
    ])
      expect(
        reason(openPiece(verified, sealed, 1000, w.server.secretKey))
      ).toBe("pack_mismatch")
    // Sealed for this server, but not zstd inside.
    const plain = sodium.crypto_box_seal(
      sodium.randombytes_buf(1000),
      decodeKey("serverPublic", w.server.publicKey)
    )
    expect(reason(openPiece(verified, plain, 1000, w.server.secretKey))).toBe(
      "pack_mismatch"
    )
  })
})

describe("openPiece: only a deploy verifyDeployV2 registered", () => {
  test("a hand-made object and admitPiece's result are not_verified", async () => {
    const w = await world()
    const { sealed, fingerprint } = sealPiece(utf8("code"), w.server.publicKey)
    const { envelope, verified } = await listing(w, fingerprint)
    expect(reason(openPiece(verified, sealed, 4, w.server.secretKey))).toBe(
      "accepted"
    )
    const copy = { ...verified } as VerifiedDeployV2
    const admitted = admitPiece({
      envelope,
      state: w.state,
      now: NOW,
      piece: sealed,
    })
    if (!admitted.ok) throw new Error(admitted.error.code)
    for (const made of [
      copy,
      admitted.value as unknown as VerifiedDeployV2,
      {} as VerifiedDeployV2,
      null as unknown as VerifiedDeployV2,
    ])
      expect(reason(openPiece(made, sealed, 4, w.server.secretKey))).toBe(
        "not_verified"
      )
  })

  test("a version-1 deploy verifyDeploy registered is not_verified", async () => {
    const w = await world()
    const sent = await publish({
      relay: w.relay,
      trust: w.trust,
      server: w.server,
      signer: w.founder.signer,
      sequence: 1,
      values: {},
    })
    const v1 = verifyDeploy({ ...sent, state: w.server.state })
    if (!v1.ok) throw new Error(v1.error.code)
    expect(isRegistered(v1.value)).toBe(true)
    const { sealed } = sealPiece(utf8("code"), w.server.publicKey)
    expect(
      reason(
        openPiece(
          v1.value as unknown as VerifiedDeployV2,
          sealed,
          4,
          w.server.secretKey
        )
      )
    ).toBe("not_verified")
  })

  test("isRegistered tells only whether a verifier registered the object", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    expect(isRegistered(verified)).toBe(true)
    expect(isRegistered({ ...verified })).toBe(false)
    expect(isRegistered({})).toBe(false)
  })
})

describe("openPiece: the caller's mistakes throw", () => {
  test("a length that is not a whole number from 1 to 8 MiB is invalid_argument", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    const { sealed } = sealPiece(utf8("code"), w.server.publicKey)
    for (const length of [0, -1, 1.5, Number.NaN, LIMITS.chunkBytes + 1])
      expect(
        codeOf(() => openPiece(verified, sealed, length, w.server.secretKey))
      ).toBe("invalid_argument")
  })

  test("a key that is not the deploy's server's secret key is invalid_key", async () => {
    const w = await world()
    const verified = await verifiedDeploy(w)
    const other = generateServerKeyPair()
    const { sealed } = sealPiece(utf8("code"), other.publicKey)
    for (const key of [other.secretKey, w.server.publicKey, "zk_ssk_short", ""])
      expect(
        codeOf(() =>
          openPiece(verified, sealed, 4, key as unknown as ServerSecretKey)
        )
      ).toBe("invalid_key")
  })
})
