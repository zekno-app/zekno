import { utf8 } from "./encoding"
import { hash } from "./hash"
import { decodeKey, type ServerPublicKey } from "./keys"
import { sodium } from "./sodium"

/** Crockford base32: no I, L, O or U, so characters are hard to confuse when read aloud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const CODE_LENGTH = 20 // 20 characters of 5 bits: 100 bits

/** Formats the first 100 bits of a digest as five groups of four characters. */
function formatCode(digest: Uint8Array): string {
  let bits = 0
  let buffer = 0
  let code = ""
  for (const byte of digest) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5 && code.length < CODE_LENGTH) {
      bits -= 5
      code += ALPHABET[(buffer >> bits) & 31]
    }
    buffer &= (1 << bits) - 1
    if (code.length === CODE_LENGTH) break
  }
  return code.replace(/(.{4})(?=.)/g, "$1-")
}

/** The code a person compares to confirm they hold a server's genuine public key. */
export function serverConfirmationCode(publicKey: ServerPublicKey): string {
  return formatCode(hash("zekno/v1/confirm/server", decodeKey("serverPublic", publicKey)))
}

/** The code for a founding team list, from that list's hash. */
export function rosterCodeFromHash(rosterHash: Uint8Array): string {
  return formatCode(hash("zekno/v1/confirm/roster", rosterHash))
}

function normalize(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
}

/**
 * Compares two confirmation codes, ignoring case, separators and the letters
 * people mistype for digits. Takes the same time whether or not they match.
 */
export function confirmationCodesMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const left = normalize(a)
  const right = normalize(b)
  if (left.length !== CODE_LENGTH || right.length !== CODE_LENGTH) return false
  return sodium.memcmp(utf8(left), utf8(right))
}
