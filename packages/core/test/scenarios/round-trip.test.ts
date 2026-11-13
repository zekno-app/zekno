import { describe, expect, test } from "bun:test"

import { openSecrets, verifyDeploy, type VerifiedDeploy } from "../../src/index"
import { COMPOSE, overTheWire, person, publish, SAMPLE_SECRETS, setup } from "../helpers"

describe("User Story 1: a deploy only the team can authorize and only the server can read", () => {
  test("the agent accepts a member's deploy and recovers every secret exactly", async () => {
    const { founder, relay, server, trust } = await setup()
    await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    const delivered = overTheWire(relay.deploys[0]!)
    const verified = verifyDeploy({ ...delivered, state: server.state })
    expect(verified.ok).toBe(true)
    if (!verified.ok) return

    expect(verified.value.deploy.compose).toBe(COMPOSE)
    expect(verified.value.signer.name).toBe("Ada")
    expect(verified.value.nextState.lastSequence).toEqual({ web: 1 })

    const opened = openSecrets(verified.value, server.secretKey)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect({ ...opened.value }).toEqual({ ...SAMPLE_SECRETS })
  })

  test("nothing the relay stores contains a secret value in readable form", async () => {
    const { founder, relay, server, trust } = await setup()
    await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    const stored = JSON.stringify(relay)
    const decodedPayloads = relay.deploys
      .map((deploy) => Buffer.from(deploy.envelope.payload, "base64url").toString("utf8"))
      .join("\n")
    for (const value of Object.values(SAMPLE_SECRETS)) {
      expect(stored).not.toContain(value)
      expect(decodedPayloads).not.toContain(value)
      expect(stored).not.toContain(Buffer.from(value).toString("base64url"))
    }
    // The control plane does see names, which the spec lists as metadata.
    expect(stored).toContain("DATABASE_URL")
  })

  test("a party holding everything except the server's secret key opens nothing", async () => {
    const { founder, relay, server, trust } = await setup()
    await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const verified = verifyDeploy({ ...relay.deploys[0]!, state: server.state })
    if (!verified.ok) throw new Error("expected acceptance")

    const attacker = (await setup("Mallory")).server
    const opened = openSecrets(verified.value, attacker.secretKey)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.code).toBe("wrong_server_key")
  })

  test("a deploy signed by a key the team never approved is refused before any decryption", async () => {
    const { relay, server, trust } = await setup()
    const stranger = person("Mallory")
    // The stranger builds a deploy against a team list they invented.
    const forgedTrust = { ...trust, members: [{ name: "Mallory", publicKey: stranger.publicKey, role: "admin" as const }] }
    await publish({ relay, trust: forgedTrust, server, signer: stranger.signer, sequence: 1 })

    const verified = verifyDeploy({ ...relay.deploys[0]!, state: server.state })
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.error.code).toBe("unknown_signer")
  })

  test("a deploy altered by one byte after signing is refused", async () => {
    const { founder, relay, server, trust } = await setup()
    await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const delivered = overTheWire(relay.deploys[0]!)

    const payload = Buffer.from(delivered.envelope.payload, "base64url")
    const index = payload.indexOf("example/web:1")
    payload[index] = payload[index]! ^ 1
    delivered.envelope.payload = payload.toString("base64url")

    const verified = verifyDeploy({ ...delivered, state: server.state })
    expect(verified.ok).toBe(false)
    if (!verified.ok) expect(verified.error.code).toBe("bad_signature")
  })

  test("there is no way to open secrets without passing verification", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })
    const verified = verifyDeploy({ ...deploy, state: server.state })
    if (!verified.ok) throw new Error("expected acceptance")

    // A look-alike built by hand, and a copy of a genuine result, are both refused.
    const lookalike = { ...verified.value } as VerifiedDeploy
    const handMade = {
      deploy: verified.value.deploy,
      signer: verified.value.signer,
      nextState: verified.value.nextState,
    } as VerifiedDeploy
    for (const fake of [lookalike, handMade]) {
      const opened = openSecrets(fake, server.secretKey)
      expect(opened.ok).toBe(false)
      if (!opened.ok) expect(opened.error.code).toBe("not_verified")
    }
  })

  test("a deploy with no secrets is valid", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1, values: {} })
    const verified = verifyDeploy({ ...deploy, state: server.state })
    expect(verified.ok).toBe(true)
    if (verified.ok) {
      const opened = openSecrets(verified.value, server.secretKey)
      expect(opened.ok && Object.keys(opened.value).length).toBe(0)
    }
  })
})
