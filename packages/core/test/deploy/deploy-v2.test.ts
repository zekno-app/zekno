/**
 * Signing and reading a version-2 deploy (contracts/message.md, "Signing" and
 * "Reading"), and the runner's checks K4 to K10 (contracts/runner-checks.md).
 * K11 to K16 are in listed-secrets.test.ts, the pairings of kind and version
 * (SC-002) in kind-and-version.test.ts.
 */
import { describe, expect, test } from "bun:test"

import {
  createDeploy,
  createSecretRemoval,
  LIMITS,
  PAYLOAD_TYPES,
} from "../../src/index"
import { base64UrlLength } from "../../src/protocol/limits"
import { createDeployV2, readSignedDeployV2 } from "../../src/deploy/deploy-v2"
import { readDeployV2Payload } from "../../src/deploy/message"
import { newRunnerState } from "../../src/deploy/state"
import { COMPOSE, person, setSecret } from "../support/helpers"
import {
  deployV2,
  NOW,
  payloadOf,
  reason,
  signAs,
  signV2,
  verify,
  world,
  type World,
} from "../support/deploy-v2"

const DAY = 24 * 60 * 60 * 1000
const route = { domain: "demo.example.com", service: "web", port: 3000 }
const health = {
  timeout: 60,
  services: [{ service: "web", http: { port: 3000, path: "/health" } }],
}
/** A later field no runner carries out yet (F7). */
const predeploy = { service: "web", command: ["migrate"], timeout: 60 }

/** The arguments of a good `createDeployV2` call in this world, changed by `change`. */
const signing = (w: World, change: Record<string, unknown> = {}) => ({
  trust: w.trust,
  serverId: w.server.serverId,
  app: "web",
  previous: 0,
  compose: COMPOSE,
  statements: [],
  removals: [],
  expiresAt: null,
  signer: w.founder.signer,
  now: NOW,
  ...change,
})

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => "signed",
    (error: { code?: string }) => error.code
  )

describe("createDeployV2", () => {
  test("lists the secrets of the statements and removals it is given, sorted by name", async () => {
    const w = await world()
    const set = (name: string, version: number) =>
      setSecret({
        relay: w.relay,
        trust: w.trust,
        server: w.server,
        signer: w.founder.signer,
        name,
        value: `value of ${name}`,
        version,
      })
    const remove = (name: string, version: number) =>
      createSecretRemoval({
        trust: w.trust,
        serverId: w.server.serverId,
        app: "web",
        name,
        version,
        signer: w.founder.signer,
      })
    const b = await set("B", 3)
    const a = await set("A", 1)
    const envelope = await createDeployV2(
      signing(w, {
        previous: 41,
        statements: [b.envelope, a.envelope],
        removals: [await remove("D", 2), await remove("C", 5)],
        expiresAt: new Date(NOW.getTime() + DAY),
      })
    )
    const payload = payloadOf(envelope)
    expect(payload).toEqual({
      v: 2,
      teamId: w.trust.teamId,
      teamHash: w.trust.hash,
      serverId: w.server.serverId,
      app: "web",
      previous: 41,
      sequence: 42,
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + DAY).toISOString(),
      compose: COMPOSE,
      secrets: [
        { name: "A", hash: payloadOf(a.envelope).hash, version: 1 },
        { name: "B", hash: payloadOf(b.envelope).hash, version: 3 },
      ],
      removed: [
        { name: "C", version: 5 },
        { name: "D", version: 2 },
      ],
      builds: [],
      predeploy: null,
      health: null,
      routes: [],
    })
    expect(envelope.payloadType).toBe(PAYLOAD_TYPES.deployV2)
    // The payload reads back as itself.
    expect(readDeployV2Payload(payload)).toEqual({
      ok: true,
      value: payload as never,
    })
  })

  test("with routes and a health check, makes a deploy both readers take; a later field still asks for what no runner does", async () => {
    const w = await world()
    const envelope = await createDeployV2(
      signing(w, { routes: [route], health })
    )
    expect(payloadOf(envelope).routes).toEqual([route])
    expect(payloadOf(envelope).health).toEqual(health)
    expect(reason(readSignedDeployV2({ envelope, trust: w.trust }))).toBe(
      "accepted"
    )
    expect(reason(readDeployV2Payload(payloadOf(envelope)))).toBe("accepted")
    const later = await createDeployV2(signing(w, { later: { predeploy } }))
    expect(reason(readDeployV2Payload(payloadOf(later)))).toBe(
      "unsupported_version"
    )
  })

  test("each refusal the contract names", async () => {
    const w = await world()
    const record = await setSecret({
      relay: w.relay,
      trust: w.trust,
      server: w.server,
      signer: w.founder.signer,
      name: "A",
      value: "x",
    })
    const elsewhere = await setSecret({
      relay: w.relay,
      trust: w.trust,
      server: w.server,
      signer: w.founder.signer,
      name: "A",
      value: "x",
      app: "api",
    })
    const removal = await createSecretRemoval({
      trust: w.trust,
      serverId: w.server.serverId,
      app: "web",
      name: "A",
      version: 2,
      signer: w.founder.signer,
    })
    const stranger = person("Mallory")
    const strangers = await signAs(
      PAYLOAD_TYPES.secret,
      payloadOf(record.envelope),
      stranger.signer
    )
    for (const [change, code] of [
      [{ signer: stranger.signer }, "not_member"],
      [{ serverId: `srv_${"0".repeat(32)}` }, "unknown_server"],
      [{ compose: "a".repeat(LIMITS.composeBytes + 1) }, "too_large"],
      [{ compose: 42 }, "too_large"],
      [{ statements: [elsewhere.envelope] }, "untrusted_secret"],
      [{ statements: [strangers] }, "untrusted_secret"],
      [{ statements: [removal] }, "untrusted_secret"],
      [{ removals: [record.envelope] }, "untrusted_secret"],
      [{ statements: [record.envelope, record.envelope] }, "invalid_argument"],
      [
        { statements: [record.envelope], removals: [removal] },
        "invalid_argument",
      ],
      [{ statements: "none" }, "invalid_argument"],
      [
        { statements: new Array(257).fill(record.envelope) },
        "invalid_argument",
      ],
      [{ removals: null }, "invalid_argument"],
      [{ app: "Web" }, "invalid_argument"],
      [{ previous: -1 }, "invalid_argument"],
      [{ previous: Number.MAX_SAFE_INTEGER }, "invalid_argument"],
      [{ previous: "41" }, "invalid_argument"],
      [{ expiresAt: new Date(Number.NaN) }, "invalid_argument"],
      [{ expiresAt: "tomorrow" }, "invalid_argument"],
      [{ now: new Date(Number.NaN) }, "invalid_argument"],
      [{ routes: [{ ...route, domain: "demo.invalid" }] }, "invalid_argument"],
      [{ health: { ...health, timeout: 0 } }, "invalid_argument"],
    ] as const)
      expect([
        change,
        await refusal(createDeployV2(signing(w, change) as never)),
      ]).toEqual([change, code])
    // The refused statement's reason is named in the message.
    expect(
      createDeployV2(signing(w, { statements: [elsewhere.envelope] }))
    ).rejects.toThrow("(wrong_app)")
  })
})

describe("readSignedDeployV2", () => {
  test("a member's deploy reads, with its signer; a non-member's is unknown_signer", async () => {
    const w = await world()
    const { envelope } = await deployV2(w)
    const read = readSignedDeployV2({ envelope, trust: w.trust })
    expect(read.ok && read.value.signer.publicKey).toBe(w.founder.publicKey)
    expect(read.ok && read.value.deploy).toEqual(payloadOf(envelope) as never)
    const stranger = person("Mallory")
    expect(
      reason(
        readSignedDeployV2({
          envelope: await signV2(payloadOf(envelope), stranger.signer),
          trust: w.trust,
        })
      )
    ).toBe("unknown_signer")
  })

  test("F4 to F6 apply, F7 does not", async () => {
    const w = await world()
    const { envelope } = await deployV2(w, { later: { predeploy } })
    expect(reason(readSignedDeployV2({ envelope, trust: w.trust }))).toBe(
      "accepted"
    )
    const broken = await signV2(
      { ...payloadOf(envelope), sequence: 5 },
      w.founder.signer
    )
    expect(
      reason(readSignedDeployV2({ envelope: broken, trust: w.trust }))
    ).toBe("malformed")
  })
})

describe("verifyDeployV2: K4 to K10", () => {
  test("K4: the envelope's size, shape and kind", async () => {
    const w = await world()
    const { envelope } = await deployV2(w)
    const huge = {
      ...envelope,
      payload: "A".repeat(base64UrlLength(LIMITS.payloadBytes) + 1),
    }
    expect(reason(verify(w, huge))).toBe("too_large")
    for (const shape of [null, "x", {}, { ...envelope, extra: 1 }])
      expect(reason(verify(w, shape))).toBe("malformed")
    const v1 = await createDeploy({
      trust: w.trust,
      serverId: w.server.serverId,
      app: "web",
      sequence: 1,
      compose: COMPOSE,
      secrets: [],
      signer: w.founder.signer,
    })
    expect(reason(verify(w, v1.envelope))).toBe("wrong_payload_type")
    expect(reason(verify(w, envelope))).toBe("accepted")
  })

  test("K5: the signer is a current member, and the signature is theirs", async () => {
    const w = await world()
    const { envelope } = await deployV2(w)
    const stranger = person("Mallory")
    expect(
      reason(verify(w, await signV2(payloadOf(envelope), stranger.signer)))
    ).toBe("unknown_signer")
    const tampered = {
      ...envelope,
      payload: Buffer.from(
        JSON.stringify({ ...payloadOf(envelope), compose: "evil" })
      ).toString("base64url"),
    }
    expect(reason(verify(w, tampered))).toBe("bad_signature")
  })

  test("K6 then K7: the payload's format, then a later field", async () => {
    const w = await world()
    const good = payloadOf((await deployV2(w)).envelope)
    const signed = (payload: unknown) => signV2(payload, w.founder.signer)
    expect(reason(verify(w, await signed({ ...good, sequence: 2 })))).toBe(
      "malformed"
    )
    expect(reason(verify(w, await signed({ ...good, v: 1 })))).toBe("malformed")
    expect(
      reason(
        verify(
          w,
          await signAs(
            PAYLOAD_TYPES.deployV2,
            "not an object",
            w.founder.signer
          )
        )
      )
    ).toBe("malformed")
    expect(reason(verify(w, await signed({ ...good, predeploy })))).toBe(
      "unsupported_version"
    )
    // Routes and a health check are carried out (specs/015-domains-https, contracts/core.md).
    expect(
      reason(verify(w, await signed({ ...good, routes: [route], health })))
    ).toBe("accepted")
  })

  test("K8: role, team, team list, server, server listed", async () => {
    const w = await world()
    const good = payloadOf((await deployV2(w)).envelope)
    const signed = (change: Record<string, unknown>) =>
      signV2({ ...good, ...change }, w.founder.signer)
    expect(
      reason(verify(w, await signed({ teamId: `team_${"B".repeat(22)}` })))
    ).toBe("wrong_team")
    expect(reason(verify(w, await signed({ teamHash: "b".repeat(64) })))).toBe(
      "stale_team"
    )
    expect(
      reason(verify(w, await signed({ serverId: `srv_${"0".repeat(32)}` })))
    ).toBe("wrong_server")
    // A runner whose team list does not list it: the founding list, which has no server.
    const unlisted = newRunnerState({
      serverId: w.server.serverId,
      team: w.team.trust,
    })
    expect(
      reason(
        verify(w, await signed({ teamHash: w.team.trust.hash }), {
          state: unlisted,
        })
      )
    ).toBe("unknown_server")
    // Every role there is today may deploy, so role_not_allowed cannot be reached yet.
  })

  test("K9: previous equal to the app's last number; lower is replayed, higher sequence_jump", async () => {
    const w = await world()
    const state = {
      ...w.state,
      lastSequence: { web: 3 },
      formats: { web: 2 as const },
    }
    const made = async (previous: number) =>
      (await deployV2(w, { previous })).envelope
    expect(reason(verify(w, await made(3), { state }))).toBe("accepted")
    expect(reason(verify(w, await made(2), { state }))).toBe("replayed")
    expect(reason(verify(w, await made(0), { state }))).toBe("replayed")
    expect(reason(verify(w, await made(4), { state }))).toBe("sequence_jump")
    expect(reason(verify(w, await made(1)))).toBe("sequence_jump")
    // The first deploy of an app the runner holds is refused, so a name typed as new replaces nothing.
    const held = {
      ...w.state,
      lastSequence: { web: 3, api: 1 },
      formats: { web: 2 as const, api: 1 as const },
    }
    expect(
      reason(
        verify(w, (await deployV2(w, { app: "api" })).envelope, { state: held })
      )
    ).toBe("replayed")
    expect(
      reason(
        verify(w, (await deployV2(w, { app: "api", previous: 1 })).envelope, {
          state: held,
        })
      )
    ).toBe("accepted")
  })

  test("K10: the expiry, by the clock given, and the 7-day window", async () => {
    const w = await world()
    const at = async (offset: number | null) =>
      (
        await deployV2(w, {
          expiresAt: offset === null ? null : new Date(NOW.getTime() + offset),
        })
      ).envelope
    for (const offset of [-60_000, 0, LIMITS.expiryWindowMs + 1])
      expect([offset, reason(verify(w, await at(offset)))]).toEqual([
        offset,
        "expired",
      ])
    for (const offset of [1, LIMITS.expiryWindowMs, null])
      expect([offset, reason(verify(w, await at(offset)))]).toEqual([
        offset,
        "accepted",
      ])
    expect(LIMITS.expiryWindowMs).toBe(7 * DAY)
    // Taken from the hosted service, a deploy must carry an expiry.
    expect(reason(verify(w, await at(null), { via: "hosted service" }))).toBe(
      "expired"
    )
    expect(reason(verify(w, await at(DAY), { via: "hosted service" }))).toBe(
      "accepted"
    )
    // The clock is the one given: the same deploy is expired a day later.
    expect(
      reason(verify(w, await at(DAY), { now: new Date(NOW.getTime() + DAY) }))
    ).toBe("expired")
  })

  test("a deploy that fails two checks gives the earlier", async () => {
    const w = await world()
    const stranger = person("Mallory")
    const good = payloadOf((await deployV2(w)).envelope)
    const state = {
      ...w.state,
      lastSequence: { web: 3 },
      formats: { web: 2 as const },
    }
    const pairs: [string, unknown, string][] = [
      [
        "K4 and K5",
        await signAs(PAYLOAD_TYPES.deploy, good, stranger.signer),
        "wrong_payload_type",
      ],
      [
        "K5 and K6",
        await signV2({ ...good, sequence: 9 }, stranger.signer),
        "unknown_signer",
      ],
      [
        "K6 and K7",
        await signV2({ ...good, sequence: 9, predeploy }, w.founder.signer),
        "malformed",
      ],
      [
        "K7 and K8",
        await signV2(
          { ...good, predeploy, teamHash: "b".repeat(64) },
          w.founder.signer
        ),
        "unsupported_version",
      ],
      [
        "K8 and K9",
        await signV2({ ...good, teamHash: "b".repeat(64) }, w.founder.signer),
        "stale_team",
      ],
      [
        "K9 and K10",
        await signV2(
          { ...good, expiresAt: new Date(NOW.getTime() - DAY).toISOString() },
          w.founder.signer
        ),
        "replayed",
      ],
    ]
    for (const [what, envelope, code] of pairs)
      expect([what, reason(verify(w, envelope, { state }))]).toEqual([
        what,
        code,
      ])
  })
})
