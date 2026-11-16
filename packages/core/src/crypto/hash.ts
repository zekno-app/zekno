import { concat, utf8 } from "./encoding"
import { sodium } from "./sodium"

/**
 * Every use of the hash has its own domain, so a hash made for one purpose
 * can never be mistaken for a hash made for another.
 */
export type HashDomain =
  | "zekno/v1/key-id"
  | "zekno/v1/server-id"
  | "zekno/v1/secret"
  | "zekno/v1/roster"
  | "zekno/v1/confirm/server"
  | "zekno/v1/confirm/roster"

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
