import { describe, expect, test } from "bun:test"

import {
  CoreError,
  createSigner,
  generateMemberKeyPair,
  generateServerKeyPair,
  isKey,
  keyIdOf,
  serverIdOf,
} from "../../src/index"
import { decodeKey } from "../../src/crypto/keys"

describe("keys", () => {
  test("each kind of key carries its own marking", () => {
    const member = generateMemberKeyPair()
    const server = generateServerKeyPair()
    expect(member.publicKey.startsWith("zk_mpk_")).toBe(true)
    expect(member.secretKey.startsWith("zk_msk_")).toBe(true)
    expect(server.publicKey.startsWith("zk_spk_")).toBe(true)
    expect(server.secretKey.startsWith("zk_ssk_")).toBe(true)
    expect(server.serverId).toBe(serverIdOf(server.publicKey))
    expect(keyIdOf(member.publicKey)).toMatch(/^[0-9a-f]{32}$/)
  })

  test("generated keys are different every time", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateMemberKeyPair().secretKey))
    expect(keys.size).toBe(50)
  })

  test("a key of the wrong kind is rejected, never silently used", () => {
    const member = generateMemberKeyPair()
    const server = generateServerKeyPair()
    expect(isKey("memberPublic", server.publicKey)).toBe(false)
    expect(isKey("serverPublic", member.publicKey)).toBe(false)
    expect(isKey("memberPublic", member.secretKey)).toBe(false)
    // Same bytes under another marking: both public keys are 32 bytes long.
    const relabelled = member.publicKey.replace("zk_mpk_", "zk_spk_")
    expect(isKey("serverPublic", relabelled)).toBe(true) // 32 bytes are 32 bytes...
    expect(() => keyIdOf(relabelled as never)).toThrow(CoreError) // ...but the marking is checked where it matters
    expect(() => serverIdOf(member.publicKey as never)).toThrow(CoreError)
  })

  test("truncated, padded, non-canonical and non-text keys are rejected", () => {
    const { publicKey } = generateMemberKeyPair()
    for (const bad of [publicKey.slice(0, -2), `${publicKey}AA`, `${publicKey}=`, "zk_mpk_", "", 42, null, undefined, {}]) {
      expect(isKey("memberPublic", bad)).toBe(false)
    }
    // A non-canonical encoding of the same bytes: flip unused trailing bits.
    const last = publicKey.at(-1)!
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const twin = publicKey.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1]
    expect(isKey("memberPublic", twin) && twin !== publicKey).toBe(false)
  })

  test("an error about a secret key never contains the key", () => {
    const { secretKey } = generateMemberKeyPair()
    const corrupted = secretKey.slice(0, -4)
    try {
      createSigner(corrupted as never)
      throw new Error("expected a CoreError")
    } catch (error) {
      expect(error).toBeInstanceOf(CoreError)
      expect((error as CoreError).code).toBe("invalid_key")
      expect(String((error as Error).message)).not.toContain(corrupted.slice(7, 30))
    }
  })

  test("a secret key whose embedded public half was swapped is rejected", () => {
    const a = decodeKey("memberSecret", generateMemberKeyPair().secretKey)
    const b = decodeKey("memberSecret", generateMemberKeyPair().secretKey)
    const mixed = new Uint8Array([...a.subarray(0, 32), ...b.subarray(32)])
    const text = `zk_msk_${Buffer.from(mixed).toString("base64url")}`
    expect(() => createSigner(text as never)).toThrow(CoreError)
  })

  test("a destroyed signer no longer signs", () => {
    const signer = createSigner(generateMemberKeyPair().secretKey)
    expect(signer.sign(new Uint8Array([1, 2, 3]))).toBeInstanceOf(Uint8Array)
    signer.destroy()
    expect(() => signer.sign(new Uint8Array([1, 2, 3]))).toThrow(CoreError)
  })
})
