/**
 * The name a staged deploy goes by (specs/016-build-from-source,
 * contracts/runner.md RB2 step 6): the hash of its signed payload's bytes,
 * which `packs/<app>/deploy.json` holds, so a deploy finds the pieces
 * staged for it and no other's.
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { payloadHash } from "../../src/pack/payload"

const envelopeOf = (payload: string, sig = "c2ln") => ({
  payloadType: "zekno/deploy-v2",
  payload: Buffer.from(payload).toString("base64url"),
  signature: { keyId: "a".repeat(32), sig },
})

describe("payloadHash", () => {
  test("SHA-256 of the payload's bytes, as 64 lowercase hex", () => {
    const envelope = envelopeOf('{"app":"web","previous":0}')
    expect(payloadHash(envelope)).toBe(
      createHash("sha256").update('{"app":"web","previous":0}').digest("hex")
    )
    expect(payloadHash(envelope)).toMatch(/^[0-9a-f]{64}$/)
  })

  test("one payload, one name, whoever signed it; another payload, another name", () => {
    const one = envelopeOf('{"app":"web","previous":0}', "b25l")
    const again = envelopeOf('{"app":"web","previous":0}', "dHdv")
    const other = envelopeOf('{"app":"web","previous":1}')
    expect(payloadHash(again)).toBe(payloadHash(one))
    expect(payloadHash(other)).not.toBe(payloadHash(one))
  })
})
