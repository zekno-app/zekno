/**
 * A secret's statement on its own, without the sealed value it describes:
 * what a runner holds for a deploy to list, checked against the team list
 * (`verifySecretStatement`), and read without trusting it to name what a
 * deploy is blocked by (`peekSecretStatement`).
 */
import { describe, expect, test } from "bun:test"

import { keyIdOf, PAYLOAD_TYPES } from "../../src/index"
import { signEnvelope, type Envelope } from "../../src/crypto/envelope"
import { createSecretRemoval } from "../../src/secrets/secret-record"
import {
  peekSecretStatement,
  verifySecretStatement,
} from "../../src/secrets/statement"
import { addServer, person, setSecret, setup } from "../support/helpers"

/** A statement as `createSecret` writes it, changed by `change`, signed as a secret statement. */
async function statement(
  base: Envelope,
  change: Record<string, unknown>,
  signer: Parameters<typeof signEnvelope>[2]
): Promise<Envelope> {
  const json = JSON.parse(
    Buffer.from(base.payload, "base64url").toString("utf8")
  ) as Record<string, unknown>
  return signEnvelope(
    PAYLOAD_TYPES.secret,
    new TextEncoder().encode(JSON.stringify({ ...json, ...change })),
    signer
  )
}

async function world() {
  const { founder, relay, server, trust } = await setup()
  const record = await setSecret({
    relay,
    trust,
    server,
    signer: founder.signer,
    name: "DATABASE_URL",
    value: "postgres://demo",
    version: 3,
  })
  const check = (envelope: unknown, app = "web", serverId = server.serverId) =>
    verifySecretStatement({ envelope, trust, serverId, app })
  const code = (result: ReturnType<typeof check>) =>
    result.ok ? "verified" : result.error.code
  return { founder, relay, server, trust, record, check, code }
}

describe("verifySecretStatement", () => {
  test("a createSecret record's statement gives its name, version, hash, signer and envelope", async () => {
    const { founder, record, check } = await world()
    const verified = check(record.envelope)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.value).toEqual({
      name: "DATABASE_URL",
      version: 3,
      hash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string,
      signer: expect.objectContaining({
        publicKey: founder.publicKey,
      }) as never,
      envelope: record.envelope,
    })
    expect(Object.isFrozen(verified.value)).toBe(true)
  })

  test("each refusal, with the case that breaks only it", async () => {
    const { founder, relay, server, trust, record, check, code } = await world()
    const stranger = person("Mallory")
    const removal = await createSecretRemoval({
      trust,
      serverId: server.serverId,
      app: "web",
      name: "DATABASE_URL",
      version: 4,
      signer: founder.signer,
    })
    const broken = {
      ...record.envelope,
      signature: {
        ...record.envelope.signature,
        sig: `${record.envelope.signature.sig.slice(0, -2)}AA`,
      },
    }
    const other = await addServer({
      relay,
      trust,
      admin: founder.signer,
      name: "prod-2",
    })
    const elsewhere = await setSecret({
      relay,
      trust: other.trust,
      server: other.server,
      signer: founder.signer,
      name: "DATABASE_URL",
      value: "postgres://demo",
    })
    const cases: [string, unknown, string][] = [
      ["not an envelope", { hello: "world" }, "malformed"],
      ["a removal's envelope", removal, "wrong_payload_type"],
      [
        "signed by a key no list has",
        await statement(record.envelope, {}, stranger.signer),
        "unknown_signer",
      ],
      ["a broken signature", broken, "bad_signature"],
      [
        "a statement of another format version",
        await statement(record.envelope, { v: 2 }, founder.signer),
        "unsupported_version",
      ],
      [
        "a statement with an unknown field",
        await statement(record.envelope, { note: "x" }, founder.signer),
        "malformed",
      ],
      [
        "a statement that is not JSON",
        await signEnvelope(
          PAYLOAD_TYPES.secret,
          new TextEncoder().encode("{not json"),
          founder.signer
        ),
        "malformed",
      ],
      [
        "another team's",
        await statement(
          record.envelope,
          { teamId: `team_${"B".repeat(22)}` },
          founder.signer
        ),
        "wrong_team",
      ],
    ]
    for (const [what, envelope, reason] of cases)
      expect([what, code(check(envelope))]).toEqual([what, reason])
    // Set for another server of the team, and for another app.
    expect(code(check(elsewhere.envelope))).toBe("wrong_server")
    expect(
      code(
        verifySecretStatement({
          envelope: elsewhere.envelope,
          trust: other.trust,
          serverId: other.server.serverId,
          app: "web",
        })
      )
    ).toBe("verified")
    expect(code(check(record.envelope, "api"))).toBe("wrong_app")
  })
})

describe("peekSecretStatement", () => {
  test("gives name, version and key id of a statement no list vouches for", async () => {
    const { record } = await world()
    const stranger = person("Mallory")
    const signed = await statement(record.envelope, {}, stranger.signer)
    expect(peekSecretStatement(signed)).toEqual({
      name: "DATABASE_URL",
      version: 3,
      keyId: keyIdOf(stranger.publicKey),
    })
    const broken = {
      ...record.envelope,
      signature: { ...record.envelope.signature, sig: "A".repeat(86) },
    }
    expect(peekSecretStatement(broken)).toEqual({
      name: "DATABASE_URL",
      version: 3,
      keyId: record.envelope.signature.keyId,
    })
  })

  test("gives nothing for a removal, a payload that is not JSON, or a name that breaks the pattern", async () => {
    const { founder, server, trust, record } = await world()
    const removal = await createSecretRemoval({
      trust,
      serverId: server.serverId,
      app: "web",
      name: "DATABASE_URL",
      version: 4,
      signer: founder.signer,
    })
    expect(peekSecretStatement(removal)).toBeUndefined()
    expect(
      peekSecretStatement(
        await signEnvelope(
          PAYLOAD_TYPES.secret,
          new TextEncoder().encode("{not json"),
          founder.signer
        )
      )
    ).toBeUndefined()
    for (const name of ["DATABASE-URL", "1ABC", "\u202eLRE", "A".repeat(129)])
      expect(
        peekSecretStatement(
          await statement(record.envelope, { name }, founder.signer)
        )
      ).toBeUndefined()
    for (const value of [undefined, null, "x", {}, { payload: 1 }])
      expect(peekSecretStatement(value)).toBeUndefined()
  })
})
