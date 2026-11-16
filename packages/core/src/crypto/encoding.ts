import { sodium } from "./sodium"

const encoder = new TextEncoder()
// ignoreBOM keeps a leading U+FEFF as a character instead of silently dropping it.
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

const BASE64URL = /^[A-Za-z0-9_-]*$/
const HEX = /^(?:[0-9a-f]{2})*$/

export function utf8(text: string): Uint8Array {
  return encoder.encode(text)
}

/** Decodes UTF-8, or returns undefined when the bytes are not valid UTF-8. */
export function fromUtf8(bytes: Uint8Array): string | undefined {
  try {
    return strictDecoder.decode(bytes)
  } catch {
    return undefined
  }
}

/** True when the string has no lone surrogate, so it survives a round trip through UTF-8. */
export function isWellFormed(text: string): boolean {
  return fromUtf8(utf8(text)) === text
}

export function toBase64Url(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING)
}

/**
 * Decodes unpadded base64url. Returns undefined for anything that is not the
 * one canonical encoding of its bytes, so two different texts never decode to
 * the same value.
 */
export function fromBase64Url(text: string): Uint8Array | undefined {
  if (!BASE64URL.test(text)) return undefined
  try {
    const bytes = sodium.from_base64(
      text,
      sodium.base64_variants.URLSAFE_NO_PADDING
    )
    return toBase64Url(bytes) === text ? bytes : undefined
  } catch {
    return undefined
  }
}

export function toHex(bytes: Uint8Array): string {
  return sodium.to_hex(bytes)
}

/** Decodes lowercase hex, or returns undefined. */
export function fromHex(text: string): Uint8Array | undefined {
  if (!HEX.test(text)) return undefined
  try {
    return sodium.from_hex(text)
  } catch {
    return undefined
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  )
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Overwrites bytes that held key material. */
export function wipe(bytes: Uint8Array): void {
  sodium.memzero(bytes)
}
