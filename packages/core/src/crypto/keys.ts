import { fromBase64Url, toBase64Url, toHex, wipe } from "./encoding"
import { hash } from "./hash"
import { CoreError } from "../protocol/result"
import { sodium } from "./sodium"

/** A team member's Ed25519 public key, in marked text form. */
export type MemberPublicKey = `zk_mpk_${string}`
/** A team member's Ed25519 secret key. Stays with that member's client. */
export type MemberSecretKey = `zk_msk_${string}`
/** A server's X25519 public key. Secrets are sealed for it. */
export type ServerPublicKey = `zk_spk_${string}`
/** A server's X25519 secret key. Never leaves the server. */
export type ServerSecretKey = `zk_ssk_${string}`

const KINDS = {
  memberPublic: { prefix: "zk_mpk_", bytes: 32, label: "member public key" },
  memberSecret: { prefix: "zk_msk_", bytes: 64, label: "member secret key" },
  serverPublic: { prefix: "zk_spk_", bytes: 32, label: "server public key" },
  serverSecret: { prefix: "zk_ssk_", bytes: 32, label: "server secret key" },
} as const

export type KeyKind = keyof typeof KINDS

type KeyOf<K extends KeyKind> = K extends "memberPublic"
  ? MemberPublicKey
  : K extends "memberSecret"
    ? MemberSecretKey
    : K extends "serverPublic"
      ? ServerPublicKey
      : ServerSecretKey

function encodeKey<K extends KeyKind>(kind: K, bytes: Uint8Array): KeyOf<K> {
  return `${KINDS[kind].prefix}${toBase64Url(bytes)}` as KeyOf<K>
}

/** The bytes of a key, or undefined when the text is not a key of that kind. */
export function tryDecodeKey(kind: KeyKind, text: unknown): Uint8Array | undefined {
  const { prefix, bytes } = KINDS[kind]
  if (typeof text !== "string" || !text.startsWith(prefix)) return undefined
  const decoded = fromBase64Url(text.slice(prefix.length))
  return decoded?.length === bytes ? decoded : undefined
}

/** The bytes of a key. Throws without echoing the text, which may be a secret key. */
export function decodeKey(kind: KeyKind, text: unknown): Uint8Array {
  const decoded = tryDecodeKey(kind, text)
  if (!decoded) throw new CoreError("invalid_key", `Expected a ${KINDS[kind].label}.`)
  return decoded
}

export function isKey<K extends KeyKind>(kind: K, text: unknown): text is KeyOf<K> {
  return tryDecodeKey(kind, text) !== undefined
}

export function generateMemberKeyPair(): {
  publicKey: MemberPublicKey
  secretKey: MemberSecretKey
} {
  const pair = sodium.crypto_sign_keypair()
  try {
    return {
      publicKey: encodeKey("memberPublic", pair.publicKey),
      secretKey: encodeKey("memberSecret", pair.privateKey),
    }
  } finally {
    wipe(pair.privateKey)
  }
}

export function generateServerKeyPair(): {
  publicKey: ServerPublicKey
  secretKey: ServerSecretKey
  serverId: string
} {
  const pair = sodium.crypto_box_keypair()
  try {
    const publicKey = encodeKey("serverPublic", pair.publicKey)
    return {
      publicKey,
      secretKey: encodeKey("serverSecret", pair.privateKey),
      serverId: serverIdOf(publicKey),
    }
  } finally {
    wipe(pair.privateKey)
  }
}

/** Names the signer of an envelope. Derived from the public key, so it cannot be chosen. */
export function keyIdOf(publicKey: MemberPublicKey): string {
  return toHex(hash("zekno/v1/key-id", decodeKey("memberPublic", publicKey), 16))
}

/** A server's identifier is derived from its public key: one cannot change without the other. */
export function serverIdOf(publicKey: ServerPublicKey): string {
  return `srv_${toHex(hash("zekno/v1/server-id", decodeKey("serverPublic", publicKey), 16))}`
}

/** The public key that belongs to a server secret key. */
export function serverPublicKeyOf(secretKeyBytes: Uint8Array): ServerPublicKey {
  return encodeKey("serverPublic", sodium.crypto_scalarmult_base(secretKeyBytes))
}

/**
 * Something that can sign as one member. A client that keeps its key in the
 * operating system's keychain or on a hardware device supplies its own, so
 * this library never needs to hold the secret key.
 */
export interface Signer {
  readonly publicKey: MemberPublicKey
  sign(message: Uint8Array): Uint8Array | Promise<Uint8Array>
}

/** A signer that holds the secret key in memory until `destroy` is called. */
export function createSigner(secretKey: MemberSecretKey): Signer & { destroy(): void } {
  const secret = decodeKey("memberSecret", secretKey)
  // An Ed25519 secret key is its 32-byte seed followed by the public key.
  // Derive the public key from the seed again instead of trusting the copy.
  const derived = sodium.crypto_sign_seed_keypair(secret.subarray(0, 32))
  const consistent = sodium.memcmp(derived.privateKey, secret)
  wipe(derived.privateKey)
  if (!consistent) {
    wipe(secret)
    throw new CoreError("invalid_key", "Expected a member secret key.")
  }
  const publicKey = encodeKey("memberPublic", derived.publicKey)
  let destroyed = false

  return {
    publicKey,
    sign(message) {
      if (destroyed) throw new CoreError("signer_failed", "This signer has been destroyed.")
      return sodium.crypto_sign_detached(message, secret)
    },
    destroy() {
      destroyed = true
      wipe(secret)
    },
  }
}
