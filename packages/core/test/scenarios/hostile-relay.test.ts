import { describe, expect, test } from "bun:test"

import { createDeploy, createSecret, generateServerKeyPair, openSecrets, verifyDeploy, verifySecret } from "../../src/index"
import { addServer, catchUp, changeTeam, overTheWire, person, publish, setSecret, setup } from "../support/helpers"

function refusal(result: { ok: boolean; error?: { code: string } }) {
  return result.ok ? "accepted" : result.error!.code
}

describe("User Story 2: a breached relay cannot replay, redirect or swap anything", () => {
  test("a genuine old deploy is refused as a replay", async () => {
    const { founder, relay, server, trust } = await setup()
    let state = server.state
    for (const sequence of [3, 4, 5]) {
      const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence })
      const verified = verifyDeploy({ ...deploy, state })
      if (!verified.ok) throw new Error("expected acceptance")
      state = verified.value.nextState
    }
    expect(state.lastSequence).toEqual({ web: 5 })

    // The attacker re-sends deploys 3 and 5, both validly signed.
    expect(refusal(verifyDeploy({ ...relay.deploys[0]!, state }))).toBe("replayed")
    expect(refusal(verifyDeploy({ ...relay.deploys[2]!, state }))).toBe("replayed")
  })

  test("a rollback is a new signed deploy with the next number", async () => {
    const { founder, relay, server, trust } = await setup()
    const first = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, compose: "services: { web: { image: example/web:1 } }\n" })
    const second = await publish({ relay, trust, server, signer: founder.signer, sequence: 2, compose: "services: { web: { image: example/web:2 } }\n" })
    let state = server.state
    for (const deploy of [first, second]) {
      const verified = verifyDeploy({ ...deploy, state })
      if (!verified.ok) throw new Error("expected acceptance")
      state = verified.value.nextState
    }

    const rollback = await publish({ relay, trust, server, signer: founder.signer, sequence: 3, compose: "services: { web: { image: example/web:1 } }\n" })
    const verified = verifyDeploy({ ...rollback, state })
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.value.deploy.compose).toContain("example/web:1")
  })

  test("numbers are tracked per app", async () => {
    const { founder, relay, server, trust } = await setup()
    const web = await publish({ relay, trust, server, signer: founder.signer, sequence: 7, app: "web" })
    const accepted = verifyDeploy({ ...web, state: server.state })
    if (!accepted.ok) throw new Error("expected acceptance")
    const worker = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, app: "worker" })
    expect(refusal(verifyDeploy({ ...worker, state: accepted.value.nextState }))).toBe("accepted")
  })

  test("a deploy signed for server A is refused by server B of the same team", async () => {
    const first = await setup()
    const { founder, relay, server: serverA } = first
    const { server: serverB, trust } = await addServer({ relay, trust: first.trust, admin: founder.signer, name: "prod-2" })
    catchUp(serverA, relay)
    const forA = await publish({ relay, trust, server: serverA, signer: founder.signer, sequence: 1 })

    expect(refusal(verifyDeploy({ ...forA, state: serverB.state }))).toBe("wrong_server")
    expect(refusal(verifyDeploy({ ...forA, state: serverA.state }))).toBe("accepted")
  })

  test("a deploy from another team is refused", async () => {
    const ours = await setup("Ada")
    const theirs = await setup("Mallory")
    // Mallory lists our server in her own team and signs a deploy addressed to it.
    const theirTrust = await changeTeam({
      relay: theirs.relay, trust: theirs.trust, signer: theirs.founder.signer,
      servers: [...theirs.trust.servers, { name: "victim", publicKey: ours.server.publicKey }],
    })
    const deploy = await publish({ relay: theirs.relay, trust: theirTrust, server: ours.server, signer: theirs.founder.signer, sequence: 1 })
    expect(refusal(verifyDeploy({ ...deploy, state: ours.server.state }))).toBe("unknown_signer")

    // Even if Mallory were a member of both teams, the team id would not match.
    const state = { ...ours.server.state, team: { ...ours.server.state.team, members: theirTrust.members } }
    expect(refusal(verifyDeploy({ ...deploy, state }))).toBe("wrong_team")
  })

  test("exchanging two secrets' encrypted values is refused", async () => {
    const { founder, relay, server, trust } = await setup()
    await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const delivered = overTheWire(relay.deploys[0]!)
    const database = delivered.secrets.find((secret) => secret.name === "DATABASE_URL")!
    const publicUrl = delivered.secrets.find((secret) => secret.name === "PUBLIC_URL")!
    ;[database.ciphertext, publicUrl.ciphertext] = [publicUrl.ciphertext, database.ciphertext]

    expect(refusal(verifyDeploy({ ...delivered, state: server.state }))).toBe("secrets_mismatch")
  })

  test("a missing, extra, duplicated or replaced encrypted value is refused", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const older = await publish({ relay, trust, server, signer: founder.signer, sequence: 2, values: { DATABASE_URL: "postgres://demo:older@db.example/app" } })

    const missing = { ...deploy, secrets: deploy.secrets.slice(1) }
    const extra = { ...deploy, secrets: [...deploy.secrets, { name: "EXTRA", ciphertext: deploy.secrets[0]!.ciphertext }] }
    const duplicated = { ...deploy, secrets: [...deploy.secrets.slice(0, -1), deploy.secrets[0]!] }
    // A genuine ciphertext for the same name, taken from another deploy.
    const replaced = { ...deploy, secrets: deploy.secrets.map((secret) => (secret.name === "DATABASE_URL" ? older.secrets[0]! : secret)) }

    for (const attempt of [missing, extra, duplicated, replaced]) {
      expect(refusal(verifyDeploy({ ...attempt, state: server.state }))).toBe("secrets_mismatch")
    }
  })

  test("a ciphertext the relay made itself never gets into a deploy a member signs", async () => {
    // Anyone can encrypt to a server's public key. The relay seals its own
    // DATABASE_URL and offers it to the client as the team's current secret.
    const { founder, relay, server, trust } = await setup()
    const genuine = await setSecret({ relay, trust, server, signer: founder.signer, name: "DATABASE_URL", value: "postgres://demo@db.example/app" })
    const mallory = person("Mallory")
    const malloryTrust = { ...trust, members: [{ name: "Mallory", publicKey: mallory.publicKey, role: "admin" as const }] }
    const planted = await createSecret({ trust: malloryTrust, serverId: server.serverId, app: "web", name: "DATABASE_URL", value: "postgres://attacker.example/steal", version: 2, signer: mallory.signer })

    const base = { trust, serverId: server.serverId, app: "web", sequence: 1, compose: "services: {}\n", signer: founder.signer }
    // Signed by a stranger.
    await expect(createDeploy({ ...base, secrets: [planted] })).rejects.toMatchObject({ code: "untrusted_secret" })
    // The relay's ciphertext under a teammate's genuine signature.
    const grafted = { envelope: genuine.envelope, sealed: planted.sealed }
    await expect(createDeploy({ ...base, secrets: [grafted] })).rejects.toMatchObject({ code: "untrusted_secret" })
    // A bare ciphertext with no signature at all.
    await expect(createDeploy({ ...base, secrets: [{ sealed: planted.sealed } as never] })).rejects.toMatchObject({ code: "untrusted_secret" })
    // The genuine record is fine.
    expect((await createDeploy({ ...base, secrets: [genuine] })).secrets).toHaveLength(1)

    expect(refusal(verifySecret({ record: planted, trust, serverId: server.serverId, app: "web" }))).toBe("unknown_signer")
    expect(refusal(verifySecret({ record: grafted, trust, serverId: server.serverId, app: "web" }))).toBe("secrets_mismatch")
  })

  test("a genuine secret set for another app, server or team is not accepted for this one", async () => {
    const first = await setup()
    const { founder, relay, server } = first
    const { server: other, trust } = await addServer({ relay, trust: first.trust, admin: founder.signer, name: "prod-2" })
    catchUp(server, relay)
    const forWorker = await setSecret({ relay, trust, server, signer: founder.signer, name: "TOKEN", value: "demo-worker-token", app: "worker" })
    const forOtherServer = await setSecret({ relay, trust, server: other, signer: founder.signer, name: "TOKEN", value: "demo-other-server" })
    const base = { trust, serverId: server.serverId, app: "web", sequence: 1, compose: "services: {}\n", signer: founder.signer }

    await expect(createDeploy({ ...base, secrets: [forWorker] })).rejects.toMatchObject({ code: "untrusted_secret" })
    await expect(createDeploy({ ...base, secrets: [forOtherServer] })).rejects.toMatchObject({ code: "untrusted_secret" })
    expect(refusal(verifySecret({ record: forWorker, trust, serverId: server.serverId, app: "web" }))).toBe("wrong_app")
    expect(refusal(verifySecret({ record: forOtherServer, trust, serverId: server.serverId, app: "web" }))).toBe("wrong_server")
    const theirs = await setup("Bob")
    expect(refusal(verifySecret({ record: forWorker, trust: { ...theirs.trust, members: trust.members }, serverId: server.serverId, app: "worker" }))).toBe("wrong_team")
    // A deploy envelope is not a secret statement.
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, values: {} })
    expect(refusal(verifySecret({ record: { envelope: deploy.envelope, sealed: forWorker.sealed }, trust, serverId: server.serverId, app: "web" }))).toBe("wrong_payload_type")
  })

  test("a key only the relay vouches for is never used to seal a secret or address a deploy", async () => {
    // A teammate who was not at the pairing asks the relay for the server's key.
    // The relay answers with its own. The library takes keys from the signed team list only.
    const { founder, relay, server, trust } = await setup()
    const relayOwned = generateServerKeyPair()
    const base = { trust, app: "web", signer: founder.signer }
    await expect(createSecret({ ...base, serverId: relayOwned.serverId, name: "TOKEN", value: "demo-value", version: 1 })).rejects.toMatchObject({ code: "unknown_server" })
    await expect(createDeploy({ ...base, serverId: relayOwned.serverId, sequence: 1, compose: "services: {}\n", secrets: [] })).rejects.toMatchObject({ code: "unknown_server" })
    // The genuine server, which an admin added after comparing codes, works.
    expect((await setSecret({ relay, trust, server, signer: founder.signer, name: "TOKEN", value: "demo-value" })).sealed.name).toBe("TOKEN")
  })

  test("a client that missed a team change cannot deploy to a server that has it", async () => {
    // Grace is removed. Servers know. The relay keeps the change from Ada's
    // second laptop, whose list still includes Grace, and feeds it a secret
    // Grace signed after her removal.
    const first = await setup()
    const { founder, relay, server } = first
    const grace = person("Grace")
    const withGrace = await changeTeam({ relay, trust: first.trust, signer: founder.signer, members: [...first.trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }] })
    await changeTeam({ relay, trust: withGrace, signer: founder.signer, members: first.trust.members })
    catchUp(server, relay)

    const fromGrace = await setSecret({ relay, trust: withGrace, server, signer: grace.signer, name: "DATABASE_URL", value: "postgres://attacker.example/steal" })
    const stale = await createDeploy({ trust: withGrace, serverId: server.serverId, app: "web", sequence: 1, compose: "services: {}\n", secrets: [fromGrace], signer: founder.signer })
    expect(refusal(verifyDeploy({ ...stale, state: server.state }))).toBe("stale_team")
  })

  test("a server removed from the team list stops accepting deploys", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, values: {} })
    const without = await changeTeam({ relay, trust, signer: founder.signer, servers: [] })
    catchUp(server, relay)
    expect(refusal(verifyDeploy({ ...deploy, state: server.state }))).toBe("stale_team")
    // Even a deploy signed against the new list cannot name it.
    await expect(createDeploy({ trust: without, serverId: server.serverId, app: "web", sequence: 2, compose: "services: {}\n", secrets: [], signer: founder.signer })).rejects.toMatchObject({ code: "unknown_server" })
  })

  test("a deploy number far above the last one is refused, so an app cannot be locked for good", async () => {
    const { founder, relay, server, trust } = await setup()
    // The relay tells the client the last deploy number was huge.
    const huge = await publish({ relay, trust, server, signer: founder.signer, sequence: Number.MAX_SAFE_INTEGER, values: {} })
    expect(refusal(verifyDeploy({ ...huge, state: server.state }))).toBe("sequence_jump")
    const normal = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, values: {} })
    expect(refusal(verifyDeploy({ ...normal, state: server.state }))).toBe("accepted")
  })

  test("two different values under the same secret version: the first accepted wins", async () => {
    // The relay hid a rotation from a member, who then signed a new value
    // with a version number that was already taken.
    const { founder, relay, server, trust } = await setup()
    const base = { trust, serverId: server.serverId, app: "web", compose: "services: {}\n", signer: founder.signer }
    const leaked = await setSecret({ relay, trust, server, signer: founder.signer, name: "API_KEY", value: "demo-leaked-key", version: 2 })
    const replacement = await setSecret({ relay, trust, server, signer: founder.signer, name: "API_KEY", value: "demo-replacement-key", version: 2 })

    const accepted = verifyDeploy({ ...(await createDeploy({ ...base, sequence: 1, secrets: [replacement] })), state: server.state })
    if (!accepted.ok) throw new Error("expected acceptance")
    const withLeaked = await createDeploy({ ...base, sequence: 2, secrets: [leaked] })
    expect(refusal(verifyDeploy({ ...withLeaked, state: accepted.value.nextState }))).toBe("stale_secret")
    // Redeploying the same ciphertext under the same version is fine.
    const again = await createDeploy({ ...base, sequence: 2, secrets: [replacement] })
    expect(refusal(verifyDeploy({ ...again, state: accepted.value.nextState }))).toBe("accepted")
  })

  test("the relay cannot bring back an older version of a secret", async () => {
    // The team rotates a credential. Later the relay serves the old, genuine
    // record to a client, which signs a deploy with it in good faith.
    const { founder, relay, server, trust } = await setup()
    const old = await setSecret({ relay, trust, server, signer: founder.signer, name: "API_KEY", value: "demo-old-key", version: 1 })
    const rotated = await setSecret({ relay, trust, server, signer: founder.signer, name: "API_KEY", value: "demo-new-key", version: 2 })
    const base = { trust, serverId: server.serverId, app: "web", compose: "services: {}\n", signer: founder.signer }

    let state = server.state
    for (const [sequence, record] of [[1, old], [2, rotated]] as const) {
      const verified = verifyDeploy({ ...(await createDeploy({ ...base, sequence, secrets: [record] })), state })
      if (!verified.ok) throw new Error("expected acceptance")
      state = verified.value.nextState
    }
    expect(state.secrets["web/API_KEY"]?.version).toBe(2)

    const withOld = await createDeploy({ ...base, sequence: 3, secrets: [old] })
    expect(refusal(verifyDeploy({ ...withOld, state }))).toBe("stale_secret")
    // Deploying again with the current version, or a newer one, is fine.
    const again = verifyDeploy({ ...(await createDeploy({ ...base, sequence: 3, secrets: [rotated] })), state })
    expect(refusal(again)).toBe("accepted")
    if (again.ok) {
      const opened = openSecrets(again.value, server.secretKey)
      expect(opened.ok && opened.value.API_KEY).toBe("demo-new-key")
    }
  })
})
