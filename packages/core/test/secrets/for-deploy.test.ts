/**
 * What a deploy lists, supplies, and what stops it (contracts/cli.md CL12 to
 * CL17; data-model.md, "What a deploy lists"). For version 1 with no runner
 * statements the result is exactly `currentSecrets`'s.
 */
import { describe, expect, test } from "bun:test"

import {
  createSecretRemoval,
  currentSecrets,
  keyIdOf,
  PAYLOAD_TYPES,
  type Envelope,
  type SecretRecord,
  type TeamTrust,
} from "../../src/index"
import { signEnvelope } from "../../src/crypto/envelope"
import { secretsForDeploy } from "../../src/secrets/for-deploy"
import { changeTeam, person, setSecret, setup } from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

/** A team whose member Bea set secrets and was then removed. */
async function world() {
  const base = await setup()
  const bea = person("Bea")
  const withBea = await changeTeam({
    relay: base.relay,
    trust: base.trust,
    signer: base.founder.signer,
    members: [
      ...base.trust.members,
      { name: "Bea", publicKey: bea.publicKey, role: "deployer" },
    ],
  })
  const now = await changeTeam({
    relay: base.relay,
    trust: withBea,
    signer: base.founder.signer,
    members: base.trust.members,
  })
  const set = (
    name: string,
    version: number,
    options: {
      by?: "Bea"
      trust?: TeamTrust
      app?: string
      value?: string
    } = {}
  ) =>
    setSecret({
      relay: base.relay,
      trust: options.by ? withBea : (options.trust ?? now),
      server: base.server,
      signer: options.by ? bea.signer : base.founder.signer,
      name,
      value: options.value ?? `${name} at ${version}`,
      version,
      app: options.app,
    })
  const remove = (name: string, version: number) =>
    createSecretRemoval({
      trust: now,
      serverId: base.server.serverId,
      app: "web",
      name,
      version,
      signer: base.founder.signer,
    })
  return { ...base, bea, now, former: [keyIdOf(bea.publicKey)], set, remove }
}

function list(
  w: World,
  input: {
    records?: readonly unknown[]
    removals?: readonly unknown[]
    held?: readonly unknown[]
    live?: readonly { name: string; version: number }[]
    former?: readonly string[]
    format?: 1 | 2
  }
) {
  return secretsForDeploy({
    trust: w.now,
    serverId: w.server.serverId,
    app: "web",
    records: input.records ?? [],
    removals: input.removals ?? [],
    held: input.held ?? [],
    live: input.live ?? [],
    former: input.former ?? w.former,
    format: input.format ?? 2,
  })
}

const names = (envelopes: readonly Envelope[]) =>
  envelopes.map(
    (envelope) =>
      (
        JSON.parse(Buffer.from(envelope.payload, "base64url").toString()) as {
          name: string
        }
      ).name
  )

/** Every case of this file's own items, as `currentSecrets` sees them. */
async function cases(w: World) {
  const a1 = await w.set("A", 1)
  const a2 = await w.set("A", 2)
  const b1 = await w.set("B", 1)
  const otherA2 = await w.set("A", 2, { value: "another value" })
  const stranger = person("Mallory")
  const strangers: SecretRecord = {
    envelope: await signEnvelope(
      PAYLOAD_TYPES.secret,
      Buffer.from(a2.envelope.payload, "base64url"),
      stranger.signer
    ),
    sealed: a2.sealed,
  }
  return {
    nothing: { records: [], removals: [] },
    "two names": { records: [b1, a1], removals: [] },
    "the higher version wins": { records: [a1, a2], removals: [] },
    "a removal above a record": {
      records: [a2],
      removals: [await w.remove("A", 3)],
    },
    "a record above a removal": {
      records: [await w.set("A", 4), a1],
      removals: [await w.remove("A", 3)],
    },
    "a conflict": { records: [a2, otherA2, b1], removals: [] },
    "the same record twice": { records: [a2, a2], removals: [] },
    "a record by a key no list has": { records: [strangers, b1], removals: [] },
    "a record for another app": {
      records: [await w.set("C", 1, { app: "api" }), b1],
      removals: [],
    },
    "a record that is not one": {
      records: [{ envelope: 1 }, "x"],
      removals: ["y"],
    },
    "a newer record by a removed member": {
      records: [a1, await w.set("A", 5, { by: "Bea" })],
      removals: [],
    },
  } as Record<string, { records: unknown[]; removals: unknown[] }>
}

describe("version 1, with no runner statements", () => {
  test("supply, removals and what is left out are exactly currentSecrets's, for every case", async () => {
    const w = await world()
    for (const [what, items] of Object.entries(await cases(w))) {
      const today = currentSecrets({
        trust: w.now,
        serverId: w.server.serverId,
        app: "web",
        ...items,
      })
      const listed = list(w, { ...items, format: 1, former: [] })
      expect([
        what,
        listed.supply,
        listed.removals,
        listed.ignored,
        listed.blocked,
      ]).toEqual([what, today.secrets, today.removals, today.ignored, []])
      expect(listed.statements).toEqual(
        today.secrets.map((record) => record.envelope)
      )
    }
  })

  test("a conflict is left out with conflict, on both formats", async () => {
    const w = await world()
    const items = (await cases(w))["a conflict"]!
    for (const format of [1, 2] as const) {
      const listed = list(w, { ...items, format })
      expect(names(listed.statements)).toEqual(["B"])
      expect(listed.ignored).toContainEqual({
        kind: "record",
        name: "A",
        reason: "conflict",
      })
    }
  })
})

describe("CL15, C4: a secret set by someone no longer in the team", () => {
  test("an own record by a former member that is the newest blocks, on both formats", async () => {
    const w = await world()
    const beas = await w.set("A", 5, { by: "Bea" })
    for (const format of [1, 2] as const) {
      const listed = list(w, {
        records: [await w.set("A", 1), beas, await w.set("B", 1)],
        format,
      })
      expect(listed.blocked).toEqual([{ name: "A", why: "former_member" }])
      expect(names(listed.statements)).toEqual(["B"])
      expect(listed.ignored).toEqual([])
    }
    // With no record of the name that verifies, it blocks too.
    expect(list(w, { records: [beas], format: 1 }).blocked).toEqual([
      { name: "A", why: "former_member" },
    ])
  })

  test("a runner statement by a former member that is the newest blocks", async () => {
    const w = await world()
    const beas = await w.set("A", 5, { by: "Bea" })
    const listed = list(w, {
      records: [await w.set("A", 4)],
      held: [beas.envelope],
    })
    expect(listed.blocked).toEqual([{ name: "A", why: "former_member" }])
    expect(listed.statements).toEqual([])
    expect(listed.supply).toEqual([])
  })

  test("an older one is left out with its warning only; a key no list ever had is not a former member", async () => {
    const w = await world()
    const old = await w.set("A", 1, { by: "Bea" })
    const newer = await w.set("A", 2)
    const listed = list(w, { records: [old, newer], held: [old.envelope] })
    expect(listed.blocked).toEqual([])
    expect(listed.statements).toEqual([newer.envelope])
    expect(listed.ignored).toEqual([
      { kind: "record", reason: "unknown_signer" },
      { kind: "record", reason: "unknown_signer" },
    ])
    // The same newest statement, by a key that was never in a list, blocks nothing.
    const stranger = person("Mallory")
    const strangers: SecretRecord = {
      envelope: await signEnvelope(
        PAYLOAD_TYPES.secret,
        Buffer.from((await w.set("A", 9)).envelope.payload, "base64url"),
        stranger.signer
      ),
      sealed: newer.sealed,
    }
    const unknown = list(w, {
      records: [newer, strangers],
      held: [strangers.envelope],
    })
    expect(unknown.blocked).toEqual([])
    expect(unknown.statements).toEqual([newer.envelope])
    // The same envelope with the removed member's key id given as former: then it blocks.
    expect(
      list(w, {
        records: [newer, strangers],
        former: [keyIdOf(stranger.publicKey)],
      }).blocked
    ).toEqual([{ name: "A", why: "former_member" }])
  })

  test("C4 comes before C5 for a live name", async () => {
    const w = await world()
    const beas = await w.set("A", 5, { by: "Bea" })
    expect(
      list(w, { held: [beas.envelope], live: [{ name: "A", version: 5 }] })
        .blocked
    ).toEqual([{ name: "A", why: "former_member" }])
  })
})

describe("CL16, C5: a live secret this machine cannot check", () => {
  test("a live name with nothing verified, and one whose newest is below status's version, stop version 2", async () => {
    const w = await world()
    const a1 = await w.set("A", 1)
    const listed = list(w, {
      records: [a1],
      live: [
        { name: "A", version: 2 },
        { name: "X", version: 1 },
      ],
    })
    expect(listed.blocked).toEqual([
      { name: "A", why: "cannot_check" },
      { name: "X", why: "cannot_check" },
    ])
    expect(listed.statements).toEqual([])
  })

  test("not on version 1, and not when the newest is at or above status's version", async () => {
    const w = await world()
    const a2 = await w.set("A", 2)
    const live = [
      { name: "A", version: 3 },
      { name: "X", version: 1 },
    ]
    expect(list(w, { records: [a2], live, format: 1 }).blocked).toEqual([])
    expect(
      list(w, { records: [a2], live: [{ name: "A", version: 2 }] }).blocked
    ).toEqual([])
    // A removal at or above it lists the name as removed.
    const removed = list(w, {
      records: [a2],
      removals: [await w.remove("A", 3)],
      live: [{ name: "A", version: 2 }],
    })
    expect(removed.blocked).toEqual([])
    expect(names(removed.removals)).toEqual(["A"])
  })
})

describe("CL12 to CL14: what is listed and supplied", () => {
  test("version 2: an own record whose hash the runner has is not supplied; a runner statement supplies nothing", async () => {
    const w = await world()
    const a1 = await w.set("A", 1)
    const b2 = await w.set("B", 2)
    const c1 = await w.set("C", 1)
    const listed = list(w, {
      records: [c1, a1],
      held: [a1.envelope, b2.envelope],
    })
    expect(names(listed.statements)).toEqual(["A", "B", "C"])
    expect(listed.supply).toEqual([c1])
    // The runner's statement chosen over an older own record supplies nothing.
    const older = list(w, {
      records: [await w.set("B", 1)],
      held: [b2.envelope],
    })
    expect(older.statements).toEqual([b2.envelope])
    expect(older.supply).toEqual([])
    // Version 1 supplies every chosen record.
    expect(list(w, { records: [c1, a1], format: 1 }).supply).toEqual([a1, c1])
  })

  test("a runner statement that does not verify is left out with its warning", async () => {
    const w = await world()
    const forApi = await w.set("A", 1, { app: "api" })
    const listed = list(w, { held: [forApi.envelope, "garbage"] })
    expect(listed.statements).toEqual([])
    expect(listed.ignored).toEqual([
      { kind: "record", reason: "wrong_app" },
      { kind: "record", reason: "malformed" },
    ])
  })

  test("every list is sorted by name", async () => {
    const w = await world()
    const records = await Promise.all(
      ["D", "B", "A"].map((name) => w.set(name, 1))
    )
    const listed = list(w, {
      records,
      removals: [await w.remove("Z", 2), await w.remove("C", 2)],
      held: [(await w.set("E", 1)).envelope],
      live: [
        { name: "Y", version: 1 },
        { name: "X", version: 1 },
      ],
    })
    expect(names(listed.statements)).toEqual(["A", "B", "D", "E"])
    expect(names(listed.removals)).toEqual(["C", "Z"])
    expect(listed.supply.map((record) => record.sealed.name)).toEqual([
      "A",
      "B",
      "D",
    ])
    expect(listed.blocked.map((entry) => entry.name)).toEqual(["X", "Y"])
  })

  test("a caller's mistake throws", async () => {
    const w = await world()
    expect(() => list(w, { format: 3 as 1 })).toThrow(
      expect.objectContaining({ code: "invalid_argument" })
    )
    const statement = (await w.set("A", 1)).envelope
    expect(() => list(w, { format: 1, held: [statement] })).toThrow(
      expect.objectContaining({ code: "invalid_argument" })
    )
    expect(() => list(w, { held: new Array(257).fill("x") })).toThrow(
      expect.objectContaining({ code: "too_large" })
    )
    expect(() => list(w, { live: [{ name: "A" } as never] })).toThrow(
      expect.objectContaining({ code: "invalid_argument" })
    )
  })
})
