import { concat, utf8 } from "./encoding"
import { CoreError } from "../protocol/result"
import { sodium } from "./sodium"

/**
 * Every use of the hash has its own domain, so a hash made for one purpose
 * can never be mistaken for a hash made for another. `pack`, `pack-chunk`
 * and `build` are the signed deploy's version 2 (design, part 3): a whole
 * source pack, one sealed chunk of it, and a build key. Building from source
 * (specs/016-build-from-source, contracts/core.md CO4 and CO5) adds three:
 * `plan`, the fingerprint of a Railpack build's plan as signed
 * (`builder.plan.hash`); `build-reads`, the `secrets-hash` Railpack is given,
 * made from a build's signed arguments and listed secret fingerprints;
 * `build-salt`, the name a build with secrets is given for the runner's
 * host entry, made from the app and those fingerprints.
 */
export const HASH_DOMAINS = [
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
] as const

export type HashDomain = (typeof HASH_DOMAINS)[number]

const SEPARATOR = new Uint8Array([0])

/** BLAKE2b over `domain || 0x00 || data`. Domains never contain a zero byte. */
export function hash(
  domain: HashDomain,
  data: Uint8Array,
  length = 32
): Uint8Array {
  return sodium.crypto_generichash(
    length,
    concat(utf8(domain), SEPARATOR, data),
    null
  )
}

/** A hash fed in pieces, for bytes too large to hold at once. */
export interface HashStream {
  update(bytes: Uint8Array): void
  digest(): Uint8Array
}

/**
 * The same BLAKE2b over `domain || 0x00 || data` as `hash`, with the data
 * given piece by piece, so a pack of up to 512 MiB is fingerprinted as it is
 * written or read (CO5, FR-016). After `digest` the stream is spent: a
 * second `digest`, or another `update`, throws.
 */
export function hashStream(domain: HashDomain, length = 32): HashStream {
  const state = sodium.crypto_generichash_init(null, length)
  sodium.crypto_generichash_update(state, utf8(domain))
  sodium.crypto_generichash_update(state, SEPARATOR)
  let spent = false

  function stillOpen(): void {
    if (spent)
      throw new CoreError(
        "invalid_argument",
        "This hash has already given its digest."
      )
  }

  return {
    update(bytes) {
      stillOpen()
      sodium.crypto_generichash_update(state, bytes)
    },
    digest() {
      stillOpen()
      spent = true
      return sodium.crypto_generichash_final(state, length)
    },
  }
}
