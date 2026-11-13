import { z } from "zod"

import { concat, fromBase64Url, fromUtf8, toBase64Url, utf8 } from "./encoding"
import { decodeKey, keyIdOf, type MemberPublicKey, type Signer } from "./keys"
import { base64UrlLength, LIMITS } from "./limits"
import { CoreError, ok, refuse, type Result } from "./result"
import { sodium } from "./sodium"

/** The kinds of signed message. A signature for one kind never verifies as another. */
export const PAYLOAD_TYPES = {
  deploy: "zekno.deploy.v1",
  roster: "zekno.roster.v1",
  secret: "zekno.secret.v1",
  secretRemoval: "zekno.secret-removal.v1",
} as const
export type PayloadType = (typeof PAYLOAD_TYPES)[keyof typeof PAYLOAD_TYPES]

const base64Url = (maxBytes: number) =>
  z.string().regex(/^[A-Za-z0-9_-]*$/).max(base64UrlLength(maxBytes))

/**
 * Signed bytes and who signed them. `payload` is the exact bytes that were
 * signed, so a verifier checks the signature first and parses afterwards.
 */
export const EnvelopeSchema = z.strictObject({
  payloadType: z.string().min(1).max(64),
  payload: base64Url(LIMITS.payloadBytes),
  signature: z.strictObject({
    keyId: z.string().regex(/^[0-9a-f]{32}$/),
    sig: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  }),
})
export type Envelope = z.infer<typeof EnvelopeSchema>

/** What is actually signed: a fixed tag, the kind, the length, then the payload. */
function signingInput(payloadType: string, payload: Uint8Array): Uint8Array {
  return concat(utf8(`zekno-sig-v1\n${payloadType}\n${payload.length}\n`), payload)
}

/** Signs a payload and checks the signer really produced a signature for its stated key. */
export async function signEnvelope(
  payloadType: PayloadType,
  payload: Uint8Array,
  signer: Signer
): Promise<Envelope> {
  if (payload.length > LIMITS.payloadBytes) {
    throw new CoreError("too_large", "The content to sign is larger than the payload limit.")
  }
  const publicKey = decodeKey("memberPublic", signer.publicKey)
  const input = signingInput(payloadType, payload)
  const sig = await signer.sign(input)
  if (
    !(sig instanceof Uint8Array) ||
    sig.length !== sodium.crypto_sign_BYTES ||
    !sodium.crypto_sign_verify_detached(sig, input, publicKey)
  ) {
    throw new CoreError("signer_failed", "The signer did not produce a valid signature for its public key.")
  }
  return {
    payloadType,
    payload: toBase64Url(payload),
    signature: { keyId: keyIdOf(signer.publicKey), sig: toBase64Url(sig) },
  }
}

export type EnvelopeRefusal =
  | "malformed"
  | "too_large"
  | "wrong_payload_type"
  | "unknown_signer"
  | "bad_signature"

export type ReadEnvelope = {
  readonly envelope: Envelope
  /** The exact signed bytes. Not yet trustworthy until the signature is checked. */
  readonly payload: Uint8Array
}

/** Checks the shape and kind of an envelope and extracts the signed bytes. Verifies nothing. */
export function readEnvelope(
  input: unknown,
  expectedType: PayloadType
): Result<ReadEnvelope, "malformed" | "too_large" | "wrong_payload_type"> {
  const candidate = input as { payload?: unknown } | null
  if (
    typeof candidate?.payload === "string" &&
    candidate.payload.length > base64UrlLength(LIMITS.payloadBytes)
  ) {
    return refuse("too_large", "The signed content is larger than the payload limit.")
  }
  const parsed = EnvelopeSchema.safeParse(input)
  if (!parsed.success) return refuse("malformed", "Not a signed envelope.")
  if (parsed.data.payloadType !== expectedType) {
    return refuse("wrong_payload_type", `Expected a ${expectedType} envelope.`)
  }
  const payload = fromBase64Url(parsed.data.payload)
  if (!payload) return refuse("malformed", "The signed content is not valid base64url.")
  return ok({ envelope: parsed.data, payload })
}

/** True when `publicKey` signed exactly these bytes as this kind of message. */
export function verifySignature(read: ReadEnvelope, publicKey: MemberPublicKey): boolean {
  const sig = fromBase64Url(read.envelope.signature.sig)
  if (!sig || sig.length !== sodium.crypto_sign_BYTES) return false
  try {
    return sodium.crypto_sign_verify_detached(
      sig,
      signingInput(read.envelope.payloadType, read.payload),
      decodeKey("memberPublic", publicKey)
    )
  } catch {
    return false
  }
}

/**
 * Reads an envelope and verifies it against a key the caller already trusts.
 * `resolveKey` maps the envelope's key id to that key, or to undefined.
 */
export function openEnvelope(
  input: unknown,
  expectedType: PayloadType,
  resolveKey: (keyId: string) => MemberPublicKey | undefined
): Result<ReadEnvelope & { readonly signerKey: MemberPublicKey }, EnvelopeRefusal> {
  const read = readEnvelope(input, expectedType)
  if (!read.ok) return read
  const signerKey = resolveKey(read.value.envelope.signature.keyId)
  if (!signerKey) return refuse("unknown_signer", "The signer is not a member of the team.")
  if (!verifySignature(read.value, signerKey)) {
    return refuse("bad_signature", "The signature does not match the content.")
  }
  return ok({ ...read.value, signerKey })
}

/** Parses verified bytes as JSON, or returns undefined. */
export function parseJson(bytes: Uint8Array): unknown {
  try {
    const text = fromUtf8(bytes)
    return text === undefined ? undefined : (JSON.parse(text) as unknown)
  } catch {
    return undefined
  }
}

/** True when a parsed payload declares a format version other than 1. */
export function hasOtherVersion(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "v") &&
    (value as { v: unknown }).v !== 1
  )
}
