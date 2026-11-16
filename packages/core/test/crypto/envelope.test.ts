import { describe, expect, test } from "bun:test"

import {
  CoreError,
  createSigner,
  generateMemberKeyPair,
  LIMITS,
  PAYLOAD_TYPES,
  type Signer,
} from "../../src/index"
import {
  openEnvelope,
  readEnvelope,
  signEnvelope,
} from "../../src/crypto/envelope"

const bytes = (text: string) => new TextEncoder().encode(text)

function signerPair() {
  const pair = generateMemberKeyPair()
  return { signer: createSigner(pair.secretKey), publicKey: pair.publicKey }
}

describe("signed envelopes", () => {
  test("verifies exactly what was signed, by the key that signed it", async () => {
    const { signer, publicKey } = signerPair()
    const envelope = await signEnvelope(
      PAYLOAD_TYPES.deploy,
      bytes('{"a":1}'),
      signer
    )
    const opened = openEnvelope(envelope, PAYLOAD_TYPES.deploy, () => publicKey)
    expect(opened.ok).toBe(true)
    if (opened.ok)
      expect(new TextDecoder().decode(opened.value.payload)).toBe('{"a":1}')
  })

  test("refuses another key, another kind, a changed payload and a changed signature", async () => {
    const { signer, publicKey } = signerPair()
    const other = signerPair()
    const envelope = await signEnvelope(
      PAYLOAD_TYPES.deploy,
      bytes('{"a":1}'),
      signer
    )
    const code = (
      input: unknown,
      type = PAYLOAD_TYPES.deploy as string,
      key = publicKey
    ) => {
      const result = openEnvelope(input, type as never, () => key)
      return result.ok ? "accepted" : result.error.code
    }
    expect(code(envelope, PAYLOAD_TYPES.deploy, other.publicKey)).toBe(
      "bad_signature"
    )
    expect(code(envelope, PAYLOAD_TYPES.roster)).toBe("wrong_payload_type")
    expect(
      code(
        { ...envelope, payloadType: PAYLOAD_TYPES.roster },
        PAYLOAD_TYPES.roster
      )
    ).toBe("bad_signature")
    expect(
      code({
        ...envelope,
        payload: Buffer.from('{"a":2}').toString("base64url"),
      })
    ).toBe("bad_signature")
    const sig = Buffer.from(envelope.signature.sig, "base64url")
    sig[0] = sig[0]! ^ 1
    expect(
      code({
        ...envelope,
        signature: { ...envelope.signature, sig: sig.toString("base64url") },
      })
    ).toBe("bad_signature")
    expect(
      openEnvelope(envelope, PAYLOAD_TYPES.deploy, () => undefined)
    ).toMatchObject({ ok: false, error: { code: "unknown_signer" } })
  })

  test("length is part of what is signed, so payloads cannot be spliced", async () => {
    const { signer, publicKey } = signerPair()
    const short = await signEnvelope(
      PAYLOAD_TYPES.deploy,
      bytes("12\nabc"),
      signer
    )
    // Same signature presented with a payload that only differs in where the boundary falls.
    const spliced = {
      ...short,
      payload: Buffer.from("2\nabc").toString("base64url"),
    }
    expect(
      openEnvelope(spliced, PAYLOAD_TYPES.deploy, () => publicKey).ok
    ).toBe(false)
  })

  test("rejects anything that is not an envelope, without throwing", () => {
    for (const input of [
      null,
      undefined,
      1,
      "x",
      [],
      {},
      { payloadType: "zekno.deploy.v1" },
      { payloadType: 1, payload: 2, signature: 3 },
    ]) {
      const result = readEnvelope(input, PAYLOAD_TYPES.deploy)
      expect(result.ok).toBe(false)
    }
    const oversized = {
      payloadType: PAYLOAD_TYPES.deploy,
      payload: "A".repeat(LIMITS.payloadBytes * 2),
      signature: { keyId: "0".repeat(32), sig: "A".repeat(86) },
    }
    expect(readEnvelope(oversized, PAYLOAD_TYPES.deploy)).toMatchObject({
      ok: false,
      error: { code: "too_large" },
    })
  })

  test("a signer that returns a signature for a different key is caught", async () => {
    const honest = signerPair()
    const other = signerPair()
    const lying: Signer = {
      publicKey: honest.publicKey,
      sign: (message) => other.signer.sign(message),
    }
    await expect(
      signEnvelope(PAYLOAD_TYPES.deploy, bytes("{}"), lying)
    ).rejects.toMatchObject({ code: "signer_failed" })
    const broken: Signer = {
      publicKey: honest.publicKey,
      sign: () => new Uint8Array(10),
    }
    await expect(
      signEnvelope(PAYLOAD_TYPES.deploy, bytes("{}"), broken)
    ).rejects.toBeInstanceOf(CoreError)
  })

  test("an asynchronous signer, such as a keychain or hardware key, works", async () => {
    const { signer, publicKey } = signerPair()
    const remote: Signer = {
      publicKey,
      sign: async (message) => signer.sign(message),
    }
    const envelope = await signEnvelope(
      PAYLOAD_TYPES.roster,
      bytes("{}"),
      remote
    )
    expect(
      openEnvelope(envelope, PAYLOAD_TYPES.roster, () => publicKey).ok
    ).toBe(true)
  })
})
