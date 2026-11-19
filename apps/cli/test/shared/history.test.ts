/**
 * One entry of the deploy history, read by its kind (specs/014-deploy-v2,
 * contracts/cli.md, "The history"; research R32; tasks T026): a version-1
 * and a version-2 deploy each read from under its own signature, with the
 * fields both share and `previous` for version 2; anything that does not
 * read is `undefined`, never an error.
 */
import { describe, expect, test } from "bun:test"
import { PAYLOAD_TYPES } from "@workspace/core"

import { readDeployEntry } from "../../src/shared/history"
import { payloadOf, signAs, signingTeam } from "../support/signing-team"

const COMPOSE = "services:\n  web:\n    image: example/web:1\n"

describe("readDeployEntry", () => {
  test("a version-1 deploy: format 1, the fields both kinds share, the signer, and no `previous`", async () => {
    const t = await signingTeam()
    const record = await t.secret("DATABASE_URL", "postgres://demo", 1)
    const removal = await t.removal("OLD", 2)
    const envelope = await t.deployV1(7, COMPOSE, [record], [removal])
    const entry = readDeployEntry(envelope, t.trust)
    const signed = payloadOf(envelope)
    expect(entry?.format).toBe(1)
    expect(entry?.signer.name).toBe("Ada")
    expect(entry?.deploy).toEqual({
      teamId: t.trust.teamId,
      teamHash: t.trust.hash,
      serverId: t.server.serverId,
      app: "demo",
      sequence: 7,
      createdAt: signed.createdAt as string,
      compose: COMPOSE,
      secrets: [
        {
          name: "DATABASE_URL",
          hash: payloadOf(record.envelope).hash as string,
          version: 1,
        },
      ],
      removed: [{ name: "OLD", version: 2 }],
    })
    expect(entry?.deploy).not.toHaveProperty("previous")
  })

  test("a version-2 deploy: format 2, the same fields, and `previous`", async () => {
    const t = await signingTeam()
    const record = await t.secret("DATABASE_URL", "postgres://demo", 3)
    const envelope = await t.deployV2(41, COMPOSE, [record.envelope])
    const entry = readDeployEntry(envelope, t.trust)
    const signed = payloadOf(envelope)
    expect(entry?.format).toBe(2)
    expect(entry?.signer.name).toBe("Ada")
    expect(entry?.deploy).toEqual({
      teamId: t.trust.teamId,
      teamHash: t.trust.hash,
      serverId: t.server.serverId,
      app: "demo",
      previous: 41,
      sequence: 42,
      createdAt: signed.createdAt as string,
      compose: COMPOSE,
      secrets: [
        {
          name: "DATABASE_URL",
          hash: payloadOf(record.envelope).hash as string,
          version: 3,
        },
      ],
      removed: [],
      // What it signed of the routes and the health check: none (specs/015-domains-https, research R30).
      routes: [],
      health: null,
    })
  })

  test("a version-2 deploy keeps the routes and the health check it signed (specs/015-domains-https, research R30)", async () => {
    const t = await signingTeam()
    const routes = [
      { domain: "www.example.com", service: "web", port: 3000 },
      { domain: "shop.example.com", service: "web", port: 3000 },
    ]
    const health = {
      timeout: 90,
      services: [{ service: "web", http: { port: 3000, path: "/health" } }],
    }
    const envelope = await t.deployV2(0, COMPOSE, [], [], { routes, health })
    const entry = readDeployEntry(envelope, t.trust)
    // Read from under the signature, sorted by domain as they were signed.
    expect(entry?.deploy.routes).toEqual([routes[1]!, routes[0]!])
    expect(entry?.deploy.health).toEqual(health)
    // A version-1 deploy has neither.
    const v1 = readDeployEntry(await t.deployV1(1, COMPOSE), t.trust)
    expect(v1?.deploy).not.toHaveProperty("routes")
    expect(v1?.deploy).not.toHaveProperty("health")
  })

  test("undefined for an entry changed after signing, of either kind", async () => {
    const t = await signingTeam()
    for (const envelope of [
      await t.deployV1(1, COMPOSE),
      await t.deployV2(0, COMPOSE),
    ]) {
      const payload = payloadOf(envelope)
      const changed = {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify({ ...payload, compose: "services: {}\n" })
        ).toString("base64url"),
      }
      expect(readDeployEntry(changed, t.trust)).toBeUndefined()
    }
  })

  test("undefined for another team's deploy, of either kind", async () => {
    const ours = await signingTeam()
    const theirs = await signingTeam()
    expect(
      readDeployEntry(await theirs.deployV1(1, COMPOSE), ours.trust)
    ).toBeUndefined()
    expect(
      readDeployEntry(await theirs.deployV2(0, COMPOSE), ours.trust)
    ).toBeUndefined()
  })

  test("undefined for an envelope that is not a deploy: a removal's, a secret's statement", async () => {
    const t = await signingTeam()
    expect(readDeployEntry(await t.removal("OLD", 1), t.trust)).toBeUndefined()
    expect(
      readDeployEntry((await t.secret("A", "a", 1)).envelope, t.trust)
    ).toBeUndefined()
  })

  test("undefined for a version-2 payload with a field no reader knows, signed by a member", async () => {
    const t = await signingTeam()
    const payload = payloadOf(await t.deployV2(0, COMPOSE))
    const unknown = await signAs(
      PAYLOAD_TYPES.deployV2,
      JSON.stringify({ ...payload, colour: "blue" }),
      t.signer
    )
    expect(readDeployEntry(unknown, t.trust)).toBeUndefined()
    // The same bytes without the field read: only the field is refused.
    const same = await signAs(
      PAYLOAD_TYPES.deployV2,
      JSON.stringify(payload),
      t.signer
    )
    expect(readDeployEntry(same, t.trust)?.format).toBe(2)
  })

  test("undefined for anything that is not an envelope", async () => {
    const t = await signingTeam()
    for (const value of [undefined, null, 3, "x", [], {}, { payloadType: 1 }])
      expect(readDeployEntry(value, t.trust)).toBeUndefined()
  })
})
