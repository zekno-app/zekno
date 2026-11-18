/**
 * How long a secret statement may be where a runner takes one (security
 * review S2; contracts/message.md, "New limits"; contracts/runner-checks.md
 * K13). A real statement is under 1 KiB; one padded with JSON whitespace
 * still passes every check of its signature, schema and hash, and a runner
 * would keep it and hand it out at every `records` read. So a supplied
 * record whose statement is longer than `LIMITS.statementPayloadLength` is
 * refused `too_large`, and nothing this library signs is ever that long.
 */
import { describe, expect, test } from "bun:test"

import {
  createSecret,
  LIMITS,
  PAYLOAD_TYPES,
  type SecretRecord,
} from "../../src/index"
import { signEnvelope } from "../../src/crypto/envelope"
import {
  deployV2,
  payloadOf,
  reason,
  verify,
  world,
  type World,
} from "../support/deploy-v2"

/**
 * `record` with its statement padded with JSON whitespace to `length`
 * characters of base64url and signed again by the founder.
 */
async function padded(
  w: World,
  record: SecretRecord,
  length: number
): Promise<SecretRecord> {
  const json = JSON.stringify(payloadOf(record.envelope))
  const bytes = Math.floor((length * 3) / 4)
  const text = `${json.slice(0, -1)}${" ".repeat(bytes - json.length)}}`
  return {
    envelope: await signEnvelope(
      PAYLOAD_TYPES.secret,
      new TextEncoder().encode(text),
      w.founder.signer
    ),
    sealed: record.sealed,
  }
}

describe("K13: a supplied record's statement is at most 4,096 characters", () => {
  test("longer is too_large; at 4,096 it is taken", async () => {
    const w = await world()
    const [record] = (await deployV2(w, { values: { A: "a" } })).records as [
      SecretRecord,
    ]
    expect(LIMITS.statementPayloadLength).toBe(4096)
    // 4,098 is the shortest base64url text past 4,096: 4,097 characters decode to no bytes.
    for (const [length, expected] of [
      [4096, "accepted"],
      [4098, "too_large"],
      [1_365_000, "too_large"],
    ] as const) {
      const long = await padded(w, record, length)
      expect(long.envelope.payload).toHaveLength(length)
      const listing = await deployV2(w, { statements: [long.envelope] })
      expect([
        length,
        reason(verify(w, listing.envelope, { records: [long] })),
      ]).toEqual([length, expected])
    }
  })

  test("the longest statement createSecret can sign is well within it", async () => {
    const w = await world()
    // The longest app name, secret name, version and time a statement can carry.
    const record = await createSecret({
      trust: w.trust,
      serverId: w.server.serverId,
      app: `a${"-".repeat(61)}a`,
      name: `A${"_".repeat(LIMITS.secretNameLength - 1)}`,
      value: "x".repeat(LIMITS.secretValueBytes),
      version: Number.MAX_SAFE_INTEGER,
      signer: w.founder.signer,
      now: new Date(8.64e15),
    })
    expect(record.envelope.payload.length).toBeLessThan(1024)
    expect(record.envelope.payload.length).toBeLessThanOrEqual(
      LIMITS.statementPayloadLength
    )
  })
})
