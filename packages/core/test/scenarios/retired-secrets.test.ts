import { describe, expect, test } from "bun:test"

import {
  createDeploy,
  createSecretRemoval,
  currentSecrets,
  openSecrets,
  parseMessage,
  PublishSecretRemovalRequestSchema,
  SecretsResponseSchema,
  verifyDeploy,
  verifySecretRemoval,
} from "../../src/index"
import { addServer, catchUp, changeTeam, overTheWire, person, setSecret, setup } from "../support/helpers"

const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "accepted" : result.error!.code

const COMPOSE = "services: {}\n"

/** A team that deployed DATABASE_URL and DEBUG_MODE, then retired DEBUG_MODE. */
async function retired() {
  const world = await setup()
  const { founder, relay, server, trust } = world
  const base = { trust, serverId: server.serverId, app: "web", compose: COMPOSE, signer: founder.signer }
  const database = await setSecret({ relay, trust, server, signer: founder.signer, name: "DATABASE_URL", value: "postgres://demo@db.example/app" })
  const debug = await setSecret({ relay, trust, server, signer: founder.signer, name: "DEBUG_MODE", value: "1" })

  const first = verifyDeploy({ ...(await createDeploy({ ...base, sequence: 1, secrets: [database, debug] })), state: server.state })
  if (!first.ok) throw new Error("expected acceptance")

  const removal = await createSecretRemoval({ trust, serverId: server.serverId, app: "web", name: "DEBUG_MODE", version: 2, signer: founder.signer })
  return { ...world, base, database, debug, removal, stateAfterFirst: first.value.nextState }
}

describe("retired secrets: the relay cannot bring back a secret the team stopped using", () => {
  test("a client that sees the removal leaves the secret out and carries the removal to the server", async () => {
    const { trust, server, base, database, debug, removal, stateAfterFirst } = await retired()

    // Everything the relay holds for this app, as a client downloads it.
    const response = parseMessage(SecretsResponseSchema, JSON.stringify({ secrets: [database, debug], removals: [removal] }))
    if (!response.ok) throw new Error("expected a valid response")
    const current = currentSecrets({ trust, serverId: server.serverId, app: "web", records: response.value.secrets, removals: response.value.removals })
    expect(current.secrets.map((record) => record.sealed.name)).toEqual(["DATABASE_URL"])
    expect(current.removals).toHaveLength(1)
    expect(current.ignored).toEqual([])

    const deploy = await createDeploy({ ...base, sequence: 2, secrets: current.secrets, removals: current.removals })
    const verified = verifyDeploy({ ...deploy, state: stateAfterFirst })
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.value.deploy.removed).toEqual([{ name: "DEBUG_MODE", version: 2 }])
    expect(verified.value.nextState.secrets["web/DEBUG_MODE"]).toEqual({ version: 2, hash: null })
    const opened = openSecrets(verified.value, server.secretKey)
    expect(opened.ok && Object.keys(opened.value)).toEqual(["DATABASE_URL"])
  })

  test("once a server has seen the removal, the old genuine record is refused for good", async () => {
    const { base, database, debug, removal, stateAfterFirst } = await retired()
    const withRemoval = verifyDeploy({ ...(await createDeploy({ ...base, sequence: 2, secrets: [database], removals: [removal] })), state: stateAfterFirst })
    if (!withRemoval.ok) throw new Error("expected acceptance")

    // The relay hides the removal from another client and offers the old record again.
    // The record is genuinely signed, so the client includes it in good faith.
    const tricked = await createDeploy({ ...base, sequence: 3, secrets: [database, debug] })
    expect(code(verifyDeploy({ ...tricked, state: withRemoval.value.nextState }))).toBe("stale_secret")
    // Leaving it out works.
    const clean = await createDeploy({ ...base, sequence: 3, secrets: [database] })
    expect(code(verifyDeploy({ ...clean, state: withRemoval.value.nextState }))).toBe("accepted")
  })

  test("a retired name can be used again with a higher version, and the old removal cannot undo that", async () => {
    const { founder, relay, server, trust, base, database, debug, removal, stateAfterFirst } = await retired()
    const removed = verifyDeploy({ ...(await createDeploy({ ...base, sequence: 2, secrets: [database], removals: [removal] })), state: stateAfterFirst })
    if (!removed.ok) throw new Error("expected acceptance")

    const again = await setSecret({ relay, trust, server, signer: founder.signer, name: "DEBUG_MODE", value: "0", version: 3 })
    const current = currentSecrets({ trust, serverId: server.serverId, app: "web", records: [database, debug, again], removals: [removal] })
    expect(current.secrets.map((record) => record.sealed.name)).toEqual(["DATABASE_URL", "DEBUG_MODE"])
    expect(current.removals).toEqual([])

    const back = verifyDeploy({ ...(await createDeploy({ ...base, sequence: 3, secrets: current.secrets })), state: removed.value.nextState })
    if (!back.ok) throw new Error("expected acceptance")
    const opened = openSecrets(back.value, server.secretKey)
    expect(opened.ok && opened.value.DEBUG_MODE).toBe("0")

    // The relay replays the old removal into a later deploy.
    const replayed = await createDeploy({ ...base, sequence: 4, secrets: [database], removals: [removal] })
    expect(code(verifyDeploy({ ...replayed, state: back.value.nextState }))).toBe("stale_secret")
  })

  test("a removal the relay made up is ignored and reported, and cannot be put in a deploy", async () => {
    const { server, trust, base, database, debug } = await retired()
    const mallory = person("Mallory")
    const malloryTrust = { ...trust, members: [{ name: "Mallory", publicKey: mallory.publicKey, role: "admin" as const }] }
    const forged = await createSecretRemoval({ trust: malloryTrust, serverId: server.serverId, app: "web", name: "DATABASE_URL", version: 9, signer: mallory.signer })

    const current = currentSecrets({ trust, serverId: server.serverId, app: "web", records: [database, debug, { junk: true }], removals: [forged, "garbage"] })
    expect(current.secrets.map((record) => record.sealed.name)).toEqual(["DATABASE_URL", "DEBUG_MODE"])
    expect(current.removals).toEqual([])
    expect(current.ignored).toEqual([
      { kind: "record", reason: "malformed" },
      { kind: "removal", reason: "unknown_signer" },
      { kind: "removal", reason: "malformed" },
    ])
    await expect(createDeploy({ ...base, sequence: 2, secrets: [database], removals: [forged] })).rejects.toMatchObject({ code: "untrusted_secret" })
    expect(code(verifySecretRemoval({ removal: forged, trust, serverId: server.serverId, app: "web" }))).toBe("unknown_signer")
  })

  test("a removal for another app, server or team, or passed off as another kind of message, is refused", async () => {
    const first = await retired()
    const { founder, relay, server, removal, database } = first
    const { server: other, trust } = await addServer({ relay, trust: first.trust, admin: founder.signer, name: "prod-2" })
    catchUp(server, relay)
    const forOther = await createSecretRemoval({ trust, serverId: other.serverId, app: "web", name: "DEBUG_MODE", version: 2, signer: founder.signer })
    const forWorker = await createSecretRemoval({ trust, serverId: server.serverId, app: "worker", name: "DEBUG_MODE", version: 2, signer: founder.signer })
    const check = (item: unknown, team = trust) => code(verifySecretRemoval({ removal: item, trust: team, serverId: server.serverId, app: "web" }))

    expect(check(forOther)).toBe("wrong_server")
    expect(check(forWorker)).toBe("wrong_app")
    expect(check(overTheWire(removal))).toBe("accepted")
    const theirs = await setup("Bob")
    expect(check(removal, { ...theirs.trust, members: trust.members })).toBe("wrong_team")
    // A secret statement is not a removal, and relabelling it does not help.
    expect(check(database.envelope)).toBe("wrong_payload_type")
    expect(check({ ...database.envelope, payloadType: "zekno.secret-removal.v1" })).toBe("bad_signature")
    expect(parseMessage(PublishSecretRemovalRequestSchema, { envelope: removal }).ok).toBe(true)
  })

  test("a removed member's removals stop counting, like their secrets", async () => {
    const first = await setup()
    const { founder, relay, server } = first
    const grace = person("Grace")
    const withGrace = await changeTeam({ relay, trust: first.trust, signer: founder.signer, members: [...first.trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }] })
    const fromGrace = await createSecretRemoval({ trust: withGrace, serverId: server.serverId, app: "web", name: "DATABASE_URL", version: 2, signer: grace.signer })
    const without = await changeTeam({ relay, trust: withGrace, signer: founder.signer, members: first.trust.members })
    expect(code(verifySecretRemoval({ removal: fromGrace, trust: without, serverId: server.serverId, app: "web" }))).toBe("unknown_signer")
  })

  test("two different items claiming the same version of a name are reported, not guessed at", async () => {
    const { founder, relay, server, trust, database } = await retired()
    const one = await setSecret({ relay, trust, server, signer: founder.signer, name: "API_KEY", value: "demo-one", version: 4 })
    const two = await setSecret({ relay, trust, server, signer: founder.signer, name: "API_KEY", value: "demo-two", version: 4 })
    const gone = await createSecretRemoval({ trust, serverId: server.serverId, app: "web", name: "TOKEN", version: 2, signer: founder.signer })
    const token = await setSecret({ relay, trust, server, signer: founder.signer, name: "TOKEN", value: "demo-token", version: 2 })

    const current = currentSecrets({ trust, serverId: server.serverId, app: "web", records: [database, one, two, token, one], removals: [gone] })
    expect(current.secrets.map((record) => record.sealed.name)).toEqual(["DATABASE_URL"])
    expect(current.ignored).toEqual([
      { kind: "record", name: "API_KEY", reason: "conflict" },
      { kind: "record", name: "TOKEN", reason: "conflict" },
    ])
    // The same record delivered twice is not a conflict.
    const repeated = currentSecrets({ trust, serverId: server.serverId, app: "web", records: [one, one], removals: [] })
    expect(repeated.secrets).toHaveLength(1)
    expect(repeated.ignored).toEqual([])
  })

  test("a name cannot be both set and removed in one deploy", async () => {
    const { base, database, debug, removal, server, founder } = await retired()
    await expect(createDeploy({ ...base, sequence: 2, secrets: [database, debug], removals: [removal] })).rejects.toMatchObject({ code: "invalid_argument" })
    await expect(createDeploy({ ...base, sequence: 2, secrets: [database], removals: [removal, removal] })).rejects.toMatchObject({ code: "invalid_argument" })

    // A runner refuses one built by other means.
    const { signEnvelope } = await import("../../src/crypto/envelope")
    const { PAYLOAD_TYPES } = await import("../../src/index")
    const good = await createDeploy({ ...base, sequence: 2, secrets: [debug] })
    const payload = JSON.parse(Buffer.from(good.envelope.payload, "base64url").toString("utf8")) as { removed: unknown[] }
    payload.removed = [{ name: "DEBUG_MODE", version: 2 }]
    const crafted = await signEnvelope(PAYLOAD_TYPES.deploy, new TextEncoder().encode(JSON.stringify(payload)), founder.signer)
    expect(code(verifyDeploy({ envelope: crafted, secrets: good.secrets, state: server.state }))).toBe("malformed")
  })
})
