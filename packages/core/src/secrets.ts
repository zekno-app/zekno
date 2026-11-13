import { z } from "zod"

import { fromBase64Url, fromUtf8, isWellFormed, toBase64Url, toHex, utf8, wipe } from "./encoding"
import { hash } from "./hash"
import { decodeKey, serverIdOf, type ServerPublicKey } from "./keys"
import { base64UrlLength, LIMITS } from "./limits"
import { CoreError, ok, refuse, type Result } from "./result"
import { sodium } from "./sodium"

/** Environment-variable convention: letters, digits and underscore, not starting with a digit. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
export const SERVER_ID = /^srv_[0-9a-f]{32}$/

export const secretName = z.string().regex(SECRET_NAME).max(LIMITS.secretNameLength)

/** Room for the record around the value: version, server, app and name. */
const RECORD_OVERHEAD = 1024
/** JSON escaping can turn one byte of the value into six ("\u0001"). */
const MAX_PLAINTEXT = LIMITS.secretValueBytes * 6 + RECORD_OVERHEAD
const MAX_CIPHERTEXT = MAX_PLAINTEXT + 48 // a sealed box adds 48 bytes

/** One secret, encrypted for one server. Safe to hand to the control plane. */
export const SealedSecretSchema = z.strictObject({
  name: secretName,
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/).max(base64UrlLength(MAX_CIPHERTEXT)),
})
export type SealedSecret = z.infer<typeof SealedSecretSchema>

/** What is encrypted: the value together with where it belongs. */
const RecordSchema = z.strictObject({
  v: z.literal(1),
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  name: secretName,
  value: z.string(),
})

/**
 * Encrypts a secret so that only the server holding the matching secret key
 * can read it. The name, app and server are sealed inside with the value, so
 * the ciphertext cannot be opened as a different secret.
 */
export function sealSecret(input: {
  serverPublicKey: ServerPublicKey
  app: string
  name: string
  value: string
}): SealedSecret {
  const key = decodeKey("serverPublic", input.serverPublicKey)
  if (typeof input.app !== "string" || !APP_NAME.test(input.app)) {
    throw new CoreError("invalid_argument", "The app name is not valid.")
  }
  if (!secretName.safeParse(input.name).success) {
    throw new CoreError("invalid_name", "A secret name uses letters, digits and underscore, and does not start with a digit.")
  }
  if (typeof input.value !== "string" || !isWellFormed(input.value)) {
    throw new CoreError("invalid_value", "A secret value must be well-formed text.")
  }
  if (utf8(input.value).length > LIMITS.secretValueBytes) {
    throw new CoreError("too_large", "The secret value is larger than the limit.")
  }
  const record = utf8(
    JSON.stringify({
      v: 1,
      serverId: serverIdOf(input.serverPublicKey),
      app: input.app,
      name: input.name,
      value: input.value,
    })
  )
  try {
    return { name: input.name, ciphertext: toBase64Url(sodium.crypto_box_seal(record, key)) }
  } finally {
    wipe(record)
  }
}

/** The hash of a sealed secret's ciphertext, as carried in a signed deploy. */
export function sealedSecretHash(sealed: SealedSecret): string | undefined {
  const ciphertext = fromBase64Url(sealed.ciphertext)
  return ciphertext ? toHex(hash("zekno/v1/secret", ciphertext)) : undefined
}

/**
 * Opens one sealed secret and checks it was sealed for this server, app and
 * name. Internal: callers reach it only through `openSecrets`, after a deploy
 * has been verified.
 */
export function openSealedSecret(
  sealed: SealedSecret,
  expected: { serverId: string; app: string },
  serverPublicKey: Uint8Array,
  serverSecretKey: Uint8Array
): Result<string, "decrypt_failed" | "binding_mismatch"> {
  const ciphertext = fromBase64Url(sealed.ciphertext)
  if (!ciphertext) return refuse("decrypt_failed", "A secret could not be decrypted.")
  let plaintext: Uint8Array
  try {
    plaintext = sodium.crypto_box_seal_open(ciphertext, serverPublicKey, serverSecretKey)
  } catch {
    return refuse("decrypt_failed", "A secret could not be decrypted.")
  }
  try {
    const text = fromUtf8(plaintext)
    let json: unknown
    try {
      json = text === undefined ? undefined : JSON.parse(text)
    } catch {
      json = undefined
    }
    const record = RecordSchema.safeParse(json)
    if (!record.success) return refuse("decrypt_failed", "A secret could not be decrypted.")
    if (
      record.data.serverId !== expected.serverId ||
      record.data.app !== expected.app ||
      record.data.name !== sealed.name
    ) {
      return refuse("binding_mismatch", "A secret was sealed for a different name, app or server.")
    }
    return ok(record.data.value)
  } finally {
    wipe(plaintext)
  }
}
