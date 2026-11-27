/**
 * A pack's pieces (specs/016-build-from-source, contracts/core.md CO5;
 * data-model.md, "A piece"): the tar cut at fixed 8 MiB boundaries of its
 * bytes, each piece compressed alone with zstd (item 10 (a)), then sealed for
 * the server's key. zstd is Bun's built-in `node:zlib`, imported here, so the
 * bound on what a piece may open to is written once, in `decompressPiece`
 * (FR-029a). No package is added. On the runner, `openPiece` opens a piece
 * only for a deploy a verifier registered.
 */
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib"

import { toHex, wipe } from "../crypto/encoding"
import { hash } from "../crypto/hash"
import {
  decodeKey,
  serverIdOf,
  serverPublicKeyOf,
  tryDecodeKey,
  type ServerPublicKey,
  type ServerSecretKey,
} from "../crypto/keys"
import { sodium } from "../crypto/sodium"
import type { VerifiedDeployV2 } from "../deploy/deploy-v2"
import { isRegistered } from "../deploy/open"
import { LIMITS } from "../protocol/limits"
import { CoreError, ok, refuse, type Result } from "../protocol/result"

const ZSTD_LEVEL = 3

function isPackSize(size: number): boolean {
  return Number.isSafeInteger(size) && size >= 1 && size <= LIMITS.packBytes
}

/** The number of pieces of a pack of `size` bytes: ceil(size / 8 MiB). */
export function pieceCount(size: number): number {
  if (!isPackSize(size))
    throw new CoreError("invalid_argument", "A pack is 1 byte to 512 MiB.")
  return Math.ceil(size / LIMITS.chunkBytes)
}

/** L(i) = min(8 MiB, size - i * 8 MiB): the bytes piece `index` of a pack holds. */
export function pieceLength(size: number, index: number): number {
  const count = pieceCount(size)
  if (!Number.isSafeInteger(index) || index < 0 || index >= count)
    throw new CoreError(
      "invalid_argument",
      "No piece of the pack has this number."
    )
  return Math.min(LIMITS.chunkBytes, size - index * LIMITS.chunkBytes)
}

/** The tar's fixed 8 MiB slices, cut at those boundaries of its bytes and never at entries. Views, not copies. */
export function cutPieces(tar: Uint8Array): Uint8Array[] {
  const count = pieceCount(tar.length)
  return Array.from({ length: count }, (_, index) =>
    tar.subarray(
      index * LIMITS.chunkBytes,
      index * LIMITS.chunkBytes + pieceLength(tar.length, index)
    )
  )
}

function asBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)
}

/** A piece compressed alone with zstd at level 3, before it is sealed. */
export function compressPiece(bytes: Uint8Array): Uint8Array {
  return asBytes(
    zstdCompressSync(bytes, {
      params: { [constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL },
    })
  )
}

/**
 * The bytes a compressed piece opens to, only when exactly `length` come out
 * (FR-029a): zstd stops at `length` and never makes more, so a small piece
 * that would open to far more fails without filling memory. Undefined for
 * more, fewer, or bytes that are not zstd. `length` is the piece's L(i), or a
 * plan's signed size, at most 8 MiB.
 */
export function decompressPiece(
  bytes: Uint8Array,
  length: number
): Uint8Array | undefined {
  if (!Number.isSafeInteger(length) || length < 1 || length > LIMITS.chunkBytes)
    throw new CoreError("invalid_argument", "A piece opens to 1 byte to 8 MiB.")
  let opened: Buffer
  try {
    opened = zstdDecompressSync(bytes, { maxOutputLength: length })
  } catch {
    return undefined
  }
  return opened.length === length ? asBytes(opened) : undefined
}

/** The fingerprint a build's `pack.chunks` lists: the hex of `hash("zekno/v1/pack-chunk", sealed)`. */
export function pieceFingerprint(sealed: Uint8Array): string {
  return toHex(hash("zekno/v1/pack-chunk", sealed))
}

/**
 * A piece of 1 byte to 8 MiB compressed, then sealed with `crypto_box_seal`
 * for the server's key, which the CLI takes from the signed team list
 * (FR-026, FR-029a). Nothing else is inside. Sealing uses a fresh key each
 * time, so the same piece sealed twice has two fingerprints: the CLI keeps
 * each sealed piece from signing to the end of the upload (CL7, step 11).
 * Throws `invalid_key` for a text that is not a server's public key.
 */
export function sealPiece(
  bytes: Uint8Array,
  serverPublicKey: ServerPublicKey
): { sealed: Uint8Array; fingerprint: string } {
  if (bytes.length < 1 || bytes.length > LIMITS.chunkBytes)
    throw new CoreError("invalid_argument", "A piece is 1 byte to 8 MiB.")
  const key = decodeKey("serverPublic", serverPublicKey)
  const sealed = sodium.crypto_box_seal(compressPiece(bytes), key)
  return { sealed, fingerprint: pieceFingerprint(sealed) }
}

/**
 * The bytes a sealed piece holds, on the runner (CO5; FR-026, FR-029): only
 * for a deploy `verifyDeployV2` registered, as `openSecrets` opens only its
 * secrets, so no piece opens without every check of K4 to K14 behind it;
 * any other object is `not_verified`. A sealed piece over
 * `LIMITS.sealedPieceBytes` is `pack_mismatch` before it is opened; then it
 * must open with the server's secret key, which must be the deploy's
 * server's and is wiped after, and decompress to exactly `length` bytes, the
 * piece's L(i) or a plan's signed size, never more made. Anything else is
 * `pack_mismatch`: a piece sealed for another server among them. CO5 writes
 * `openPiece(verified, sealed, length)`; the key is a fourth argument, as
 * `openSecrets` takes it. Throws `CoreError`: `invalid_argument` for a
 * `length` that is not a whole number from 1 to 8 MiB, `invalid_key` for a
 * key that is not the deploy's server's secret key.
 */
export function openPiece(
  verified: VerifiedDeployV2,
  sealed: Uint8Array,
  length: number,
  serverSecretKey: ServerSecretKey
): Result<Uint8Array, "not_verified" | "pack_mismatch"> {
  if (!Number.isSafeInteger(length) || length < 1 || length > LIMITS.chunkBytes)
    throw new CoreError("invalid_argument", "A piece opens to 1 byte to 8 MiB.")
  if (!(sealed instanceof Uint8Array))
    throw new CoreError("invalid_argument", "A sealed piece is given as bytes.")
  // Registered by `verifyDeployV2`: a version-1 deploy has no piece to open.
  if (!isRegistered(verified) || verified.deploy?.v !== 2)
    return refuse(
      "not_verified",
      "A piece opens only for a deploy returned by verifyDeployV2."
    )
  if (sealed.length > LIMITS.sealedPieceBytes)
    return refuse(
      "pack_mismatch",
      "This piece is larger than a sealed piece may be."
    )
  const secretKey = tryDecodeKey("serverSecret", serverSecretKey)
  if (!secretKey)
    throw new CoreError("invalid_key", "Expected this server's secret key.")
  try {
    const publicKey = serverPublicKeyOf(secretKey)
    if (serverIdOf(publicKey) !== verified.deploy.serverId)
      throw new CoreError(
        "invalid_key",
        "This key does not belong to the server the deploy is addressed to."
      )
    let compressed: Uint8Array
    try {
      compressed = sodium.crypto_box_seal_open(
        sealed,
        decodeKey("serverPublic", publicKey),
        secretKey
      )
    } catch {
      return refuse(
        "pack_mismatch",
        "This piece does not open with this server's key."
      )
    }
    const opened = decompressPiece(compressed, length)
    if (!opened)
      return refuse(
        "pack_mismatch",
        "This piece does not open to the length the deploy signed."
      )
    return ok(opened)
  } finally {
    wipe(secretKey)
  }
}
