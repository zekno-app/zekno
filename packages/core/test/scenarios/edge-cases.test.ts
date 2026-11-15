import { describe, expect, test } from "bun:test"

import {
  applyRosterUpdate,
  CoreError,
  createDeploy,
  LIMITS,
  openSecrets,
  trustFoundingRoster,
  verifyDeploy,
} from "../../src/index"
import { COMPOSE, person, publish, setSecret, setup, propose } from "../support/helpers"

const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "accepted" : result.error!.code

describe("edge cases from the specification", () => {
  test("a secret name cannot appear twice in one deploy", async () => {
    const { founder, relay, server, trust } = await setup()
    const set = (value: string) => setSecret({ relay, trust, server, signer: founder.signer, name: "TOKEN", value })
    await expect(
      createDeploy({ trust, serverId: server.serverId, app: "web", sequence: 1, compose: COMPOSE, secrets: [await set("a"), await set("b")], signer: founder.signer })
    ).rejects.toMatchObject({ code: "invalid_argument" })
  })

  test("the first deploy for an app may carry any number, which becomes the floor", async () => {
    const { founder, relay, server, trust } = await setup()
    const first = await publish({ relay, trust, server, signer: founder.signer, sequence: 41 })
    const accepted = verifyDeploy({ ...first, state: server.state })
    if (!accepted.ok) throw new Error("expected acceptance")
    const lower = await publish({ relay, trust, server, signer: founder.signer, sequence: 40 })
    const same = await publish({ relay, trust, server, signer: founder.signer, sequence: 41 })
    expect(code(verifyDeploy({ ...lower, state: accepted.value.nextState }))).toBe("replayed")
    expect(code(verifyDeploy({ ...same, state: accepted.value.nextState }))).toBe("replayed")
  })

  test("two members using the same number: the first accepted wins", async () => {
    const { founder, relay, server, trust } = await setup()
    const grace = person("Grace")
    const update = await propose({ trust, members: [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }], signer: founder.signer })
    const team = applyRosterUpdate(trust, update)
    if (!team.ok) throw new Error("expected acceptance")
    const state = { ...server.state, team: team.value }

    const fromAda = await publish({ relay, trust: team.value, server, signer: founder.signer, sequence: 1 })
    const fromGrace = await publish({ relay, trust: team.value, server, signer: grace.signer, sequence: 1 })
    const first = verifyDeploy({ ...fromGrace, state })
    if (!first.ok) throw new Error("expected acceptance")
    expect(code(verifyDeploy({ ...fromAda, state: first.value.nextState }))).toBe("replayed")
  })

  test("invalid deploy numbers, app names and oversized content cannot be signed", async () => {
    const { founder, server, trust } = await setup()
    const base = { trust, serverId: server.serverId, app: "web", sequence: 1, compose: COMPOSE, secrets: [], signer: founder.signer }
    for (const sequence of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1" as never]) {
      await expect(createDeploy({ ...base, sequence })).rejects.toBeInstanceOf(CoreError)
    }
    for (const app of ["", "Web", "-web", "web_app", "a".repeat(64), "constructor "]) {
      await expect(createDeploy({ ...base, app })).rejects.toBeInstanceOf(CoreError)
    }
    await expect(createDeploy({ ...base, compose: "x".repeat(LIMITS.composeBytes + 1) })).rejects.toMatchObject({ code: "too_large" })
    await expect(createDeploy({ ...base, signer: person("Mallory").signer })).rejects.toMatchObject({ code: "not_member" })
    await expect(createDeploy({ ...base, secrets: [{ name: "A", ciphertext: "!!" } as never] })).rejects.toMatchObject({ code: "untrusted_secret" })
    await expect(createDeploy({ ...base, secrets: "none" as never })).rejects.toMatchObject({ code: "invalid_argument" })
  })

  test("app and secret names that collide with object internals are just names", async () => {
    const { founder, relay, server, trust } = await setup()
    const values = { __proto__x: "one", constructor: "two", toString: "three", hasOwnProperty: "four" }
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, app: "constructor", values })
    const verified = verifyDeploy({ ...deploy, state: server.state })
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.value.nextState.lastSequence).toEqual({ constructor: 1 })
    const opened = openSecrets(verified.value, server.secretKey)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect({ ...opened.value }).toEqual(values)

    // A secret literally named __proto__ is kept as data and pollutes nothing.
    const proto = await publish({ relay, trust, server, signer: founder.signer, sequence: 2, app: "constructor", values: JSON.parse('{"__proto__":"polluted"}') as Record<string, string> })
    const verifiedProto = verifyDeploy({ ...proto, state: verified.value.nextState })
    if (!verifiedProto.ok) throw new Error("expected acceptance")
    const openedProto = openSecrets(verifiedProto.value, server.secretKey)
    expect(openedProto.ok && Object.getOwnPropertyNames(openedProto.value)).toEqual(["__proto__"])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test("garbage, truncated and empty input is refused with a reason, never an unhandled failure", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const state = server.state
    const garbage: unknown[] = [null, undefined, 0, "", "garbage", [], {}, { envelope: 1 }, new Uint8Array(8), Symbol.iterator, () => 1]
    for (const input of garbage) {
      expect(verifyDeploy({ envelope: input, secrets: deploy.secrets, state }).ok).toBe(false)
      expect(code(verifyDeploy({ envelope: deploy.envelope, secrets: input, state }))).toBe("secrets_mismatch")
      expect(applyRosterUpdate(trust, input).ok).toBe(false)
      expect(trustFoundingRoster(input, "0000-0000-0000-0000-0000").ok).toBe(false)
    }
    const truncated = { ...deploy.envelope, payload: deploy.envelope.payload.slice(0, 40) }
    expect(verifyDeploy({ envelope: truncated, secrets: deploy.secrets, state }).ok).toBe(false)
    const notBase64 = { ...deploy.envelope, payload: "****" }
    expect(code(verifyDeploy({ envelope: notBase64, secrets: deploy.secrets, state }))).toBe("malformed")
  })

  test("signed content that is not a valid deploy is refused as malformed", async () => {
    const { founder, server } = await setup()
    const { signEnvelope } = await import("../../src/crypto/envelope")
    const { PAYLOAD_TYPES } = await import("../../src/index")
    const sign = (text: string) => signEnvelope(PAYLOAD_TYPES.deploy, new TextEncoder().encode(text), founder.signer)
    for (const text of ["not json", "[]", "null", "{}", '{"v":1}', '{"v":1,"unknown":true}']) {
      expect(code(verifyDeploy({ envelope: await sign(text), secrets: [], state: server.state }))).toBe("malformed")
    }
    const invalidUtf8 = await signEnvelope(PAYLOAD_TYPES.deploy, new Uint8Array([0xff, 0xfe, 0xfd]), founder.signer)
    expect(code(verifyDeploy({ envelope: invalidUtf8, secrets: [], state: server.state }))).toBe("malformed")
  })

  test("an invalid or incomplete runner state is an error, never a weaker check", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const { secrets: _secrets, ...withoutSecrets } = server.state
    const { lastSequence: _last, ...withoutSequence } = server.state
    const broken: unknown[] = [
      null,
      withoutSecrets,
      withoutSequence,
      { ...server.state, lastSequence: { web: "5" } },
      { ...server.state, lastSequence: [] },
      { ...server.state, secrets: [] },
      { ...server.state, secrets: { "web/API_KEY": 2 } },
      { ...server.state, team: { ...server.state.team, hash: "abc" } },
      { ...server.state, team: { ...server.state.team, members: [{ name: "x", publicKey: "nope", role: "admin" }] } },
      { ...server.state, extra: true },
    ]
    for (const state of broken) {
      expect(() => verifyDeploy({ ...deploy, state: state as never })).toThrow(CoreError)
    }
    // State that went to disk and back as JSON is fine.
    expect(verifyDeploy({ ...deploy, state: JSON.parse(JSON.stringify(server.state)) }).ok).toBe(true)
    // Damaged stored trust is reported the same way wherever it is used.
    const damaged = { ...trust, hash: "abc" }
    expect(() => applyRosterUpdate(damaged, relay.rosters[1])).toThrow(CoreError)
    await expect(createDeploy({ trust: damaged, serverId: server.serverId, app: "web", sequence: 2, compose: COMPOSE, secrets: [], signer: founder.signer })).rejects.toBeInstanceOf(CoreError)
  })

  test("names that could mislead a reader are not allowed in a team list", async () => {
    const { founder, trust } = await setup()
    const grace = person("Grace")
    for (const name of ["", " Grace", "Grace ", "Gra\u0000ce", "Gra\u202Ece", "Gra\u200Bce", "Gra\u2028ce", "\u0085", "x".repeat(65)]) {
      await expect(propose({ trust, members: [...trust.members, { name, publicKey: grace.publicKey, role: "deployer" }], signer: founder.signer })).rejects.toMatchObject({ code: "invalid_members" })
    }
    // Ordinary names in any script are fine.
    for (const name of ["Grace Hopper", "Zoë", "李雷", "Ольга"]) {
      expect((await propose({ trust, members: [...trust.members, { name, publicKey: grace.publicKey, role: "deployer" }], signer: founder.signer })).payloadType).toBe("zekno.roster.v1")
    }
  })

  test("the same team change delivered twice changes nothing the second time", async () => {
    const { founder, trust } = await setup()
    const grace = person("Grace")
    const update = await propose({ trust, members: [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }], signer: founder.signer })
    const once = applyRosterUpdate(trust, update)
    if (!once.ok) throw new Error("expected acceptance")
    expect(code(applyRosterUpdate(once.value, update))).toBe("wrong_version")
  })

  test("the wrong kind of secret key cannot open a deploy", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const verified = verifyDeploy({ ...deploy, state: server.state })
    if (!verified.ok) throw new Error("expected acceptance")
    for (const key of [server.publicKey, "zk_ssk_short", "", 7, null]) {
      expect(code(openSecrets(verified.value, key as never))).toBe("wrong_server_key")
    }
  })
})
