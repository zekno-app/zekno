/**
 * The secrets of a version-2 deploy on the runner (contracts/runner-checks.md,
 * K11 to K14 and "The record of one listed secret"), the state it leaves
 * ("The next state"), and opening its values (K16, `openSecrets`). K15 is the
 * runner's: it counts files on disk. Signing and K4 to K10 are in
 * deploy-v2.test.ts.
 */
import { describe, expect, test } from "bun:test"

import {
  applyRosterUpdate,
  createSecret,
  createSecretRemoval,
  generateServerKeyPair,
  openSecrets,
  PAYLOAD_TYPES,
  type SecretRecord,
  type TeamTrust,
} from "../../src/index"
import { changeTeam, person } from "../support/helpers"
import {
  deepFreeze,
  deployV2,
  holding,
  payloadOf,
  reason,
  signAs,
  signV2,
  verify,
  world,
  type World,
} from "../support/deploy-v2"

/** A first deploy of `web` with these values, accepted, and what it leaves. */
async function accepted(w: World, values: Record<string, string>) {
  const { envelope, records } = await deployV2(w, { values })
  const result = verify(w, envelope, { records })
  if (!result.ok) throw new Error(result.error.code)
  return { state: result.value.nextState, records, held: holding(records) }
}

const remove = (w: World, name: string, version: number) =>
  createSecretRemoval({
    trust: w.trust,
    serverId: w.server.serverId,
    app: "web",
    name,
    version,
    signer: w.founder.signer,
  })

const hashOf = (record: SecretRecord) =>
  payloadOf(record.envelope).hash as string

function follow(team: TeamTrust, envelope: unknown): TeamTrust {
  const applied = applyRosterUpdate(team, envelope)
  if (!applied.ok) throw new Error(applied.error.code)
  return applied.value
}

describe("K11: every live secret is listed", () => {
  test("a live name left out is secrets_mismatch; listed, or removed, it passes", async () => {
    const w = await world()
    const first = await accepted(w, { A: "a", B: "b" })
    const [a] = first.records as [SecretRecord]
    const onlyA = await deployV2(w, { previous: 1, statements: [a.envelope] })
    const from = { state: first.state, held: first.held }
    expect(reason(verify(w, onlyA.envelope, from))).toBe("secrets_mismatch")
    const removingB = await deployV2(w, {
      previous: 1,
      statements: [a.envelope],
      removals: [await remove(w, "B", 2)],
    })
    expect(reason(verify(w, removingB.envelope, from))).toBe("accepted")
  })

  test("a removed name, and another app's secret, need not be listed", async () => {
    const w = await world()
    const state = {
      ...w.state,
      lastSequence: { web: 1, api: 1 },
      formats: { web: 2 as const, api: 2 as const },
      secrets: {
        "web/OLD": { version: 2, hash: null },
        "api/KEY": { version: 1, hash: "a".repeat(64) },
      },
    }
    const { envelope } = await deployV2(w, { previous: 1 })
    expect(reason(verify(w, envelope, { state }))).toBe("accepted")
  })
})

describe("K12: no secret goes back", () => {
  test("below the version held, or the same version with another hash, is stale_secret", async () => {
    const w = await world()
    const first = await accepted(w, { A: "a" })
    const state = {
      ...first.state,
      secrets: { "web/A": { version: 3, hash: hashOf(first.records[0]!) } },
    }
    const cases = [
      ["a lower version", { values: { A: "a" }, version: 2 }],
      ["the same version, another value", { values: { A: "b" }, version: 3 }],
      ["a removal below", { removals: [await remove(w, "A", 2)] }],
      [
        "a removal at the same version",
        { removals: [await remove(w, "A", 3)] },
      ],
    ] as const
    for (const [what, input] of cases) {
      const made = await deployV2(w, { previous: 1, ...input })
      expect([
        what,
        reason(verify(w, made.envelope, { state, records: made.records })),
      ]).toEqual([what, "stale_secret"])
    }
    const above = await deployV2(w, {
      previous: 1,
      removals: [await remove(w, "A", 4)],
    })
    expect(reason(verify(w, above.envelope, { state }))).toBe("accepted")
  })
})

describe("K13: the record of each listed secret", () => {
  test("supplied: verified now, with the listed version and hash, and used even when one is held", async () => {
    const w = await world()
    const first = await accepted(w, { A: "a" })
    const again = await deployV2(w, {
      previous: 1,
      statements: [first.records[0]!.envelope],
    })
    const state = first.state
    expect(
      reason(verify(w, again.envelope, { state, records: first.records }))
    ).toBe("accepted")
    const both = verify(w, again.envelope, {
      state,
      records: first.records,
      held: first.held,
    })
    expect(both.ok && both.value.write).toEqual(first.records)
  })

  test("supplied: by a key no list has, untrusted_secret; of another version than the listing, secrets_mismatch", async () => {
    const w = await world()
    const stranger = person("Mallory")
    const [record] = (await deployV2(w, { values: { A: "a" } })).records
    const listing = await deployV2(w, { statements: [record!.envelope] })
    const strangers: SecretRecord = {
      envelope: await signAs(
        PAYLOAD_TYPES.secret,
        payloadOf(record!.envelope),
        stranger.signer
      ),
      sealed: record!.sealed,
    }
    expect(reason(verify(w, listing.envelope, { records: [strangers] }))).toBe(
      "untrusted_secret"
    )
    const newer = await createSecret({
      trust: w.trust,
      serverId: w.server.serverId,
      app: "web",
      name: "A",
      value: "a",
      version: 2,
      signer: w.founder.signer,
    })
    expect(reason(verify(w, listing.envelope, { records: [newer] }))).toBe(
      "secrets_mismatch"
    )
    // Records that are not a list of records within the limit.
    for (const records of [
      "none",
      [{ envelope: record!.envelope }],
      new Array(257).fill(record),
    ])
      expect(reason(verify(w, listing.envelope, { records }))).toBe(
        "secrets_mismatch"
      )
  })

  test("held: none, or a file whose statement's name, version, hash or app differs, is secret_missing", async () => {
    const w = await world()
    const first = await accepted(w, { A: "a", B: "b" })
    const [a, b] = first.records as [SecretRecord, SecretRecord]
    const listing = await deployV2(w, {
      previous: 1,
      statements: [a.envelope, b.envelope],
    })
    const resigned = async (change: Record<string, unknown>) => ({
      ...a,
      envelope: await signAs(
        PAYLOAD_TYPES.secret,
        { ...payloadOf(a.envelope), ...change },
        w.founder.signer
      ),
    })
    const underA = (held: unknown) =>
      new Map([
        [`web/${hashOf(a)}`, held],
        [`web/${hashOf(b)}`, b],
      ])
    const cases: [string, Map<string, unknown>][] = [
      ["nothing held", new Map([[`web/${hashOf(b)}`, b]])],
      ["B's record under A's hash", underA(b)],
      ["another version", underA(await resigned({ version: 2 }))],
      ["another name", underA(await resigned({ name: "C" }))],
      ["another hash", underA(await resigned({ hash: "c".repeat(64) }))],
      ["another app", underA(await resigned({ app: "api" }))],
      ["not a record", underA("garbage")],
    ]
    const state = first.state
    for (const [what, held] of cases)
      expect([
        what,
        reason(verify(w, listing.envelope, { state, held })),
      ]).toEqual([what, "secret_missing"])
    expect(
      reason(verify(w, listing.envelope, { state, held: first.held }))
    ).toBe("accepted")
    // A held function that fails reads as nothing held.
    const failing = {
      get: () => {
        throw new Error("the disk is gone")
      },
    } as unknown as Map<string, unknown>
    expect(reason(verify(w, listing.envelope, { state, held: failing }))).toBe(
      "secret_missing"
    )
  })

  test("held or supplied: a record set by a member the list no longer has is untrusted_secret, and so is one broken on disk", async () => {
    const w = await world()
    const bea = person("Bea")
    const withBea = await changeTeam({
      relay: w.relay,
      trust: w.trust,
      signer: w.founder.signer,
      members: [
        ...w.trust.members,
        { name: "Bea", publicKey: bea.publicKey, role: "deployer" },
      ],
    })
    const runnerWithBea = {
      ...w.state,
      team: follow(w.state.team, w.relay.rosters.at(-1)),
    }
    const beas = await createSecret({
      trust: withBea,
      serverId: w.server.serverId,
      app: "web",
      name: "A",
      value: "a",
      version: 1,
      signer: bea.signer,
    })
    const first = await deployV2(
      { ...w, trust: withBea },
      { statements: [beas.envelope] }
    )
    const done = verify(w, first.envelope, {
      state: runnerWithBea,
      records: [beas],
    })
    if (!done.ok) throw new Error(done.error.code)
    const held = holding([beas])

    // Still a member: the held record counts, unless it was changed on disk.
    const second = await deployV2(
      { ...w, trust: withBea },
      { previous: 1, statements: [beas.envelope] }
    )
    const state = done.value.nextState
    expect(reason(verify(w, second.envelope, { state, held }))).toBe("accepted")
    const ciphertext = beas.sealed.ciphertext
    const broken = new Map([
      [
        `web/${hashOf(beas)}`,
        {
          ...beas,
          sealed: {
            ...beas.sealed,
            ciphertext: `${ciphertext.slice(0, -4)}AAAA`,
          },
        },
      ],
    ])
    expect(reason(verify(w, second.envelope, { state, held: broken }))).toBe(
      "untrusted_secret"
    )

    // Bea is removed and the runner follows. A deploy that lists her secret is refused.
    const without = await changeTeam({
      relay: w.relay,
      trust: withBea,
      signer: w.founder.signer,
      members: w.trust.members,
    })
    const followed = {
      ...state,
      team: follow(state.team, w.relay.rosters.at(-1)),
    }
    const made = payloadOf(
      (await deployV2({ ...w, trust: without }, { previous: 1 })).envelope
    )
    const listing = await signV2(
      { ...made, secrets: payloadOf(first.envelope).secrets },
      w.founder.signer
    )
    expect(reason(verify(w, listing, { state: followed, held }))).toBe(
      "untrusted_secret"
    )
    expect(
      reason(verify(w, listing, { state: followed, records: [beas] }))
    ).toBe("untrusted_secret")
  })
})

describe("K14: each supplied record names a listed secret, once", () => {
  test("a record not listed, one for a removed name, and two for one name are secrets_mismatch", async () => {
    const w = await world()
    const { records } = await deployV2(w, { values: { A: "a", B: "b" } })
    const [a, b] = records as [SecretRecord, SecretRecord]
    const onlyA = await deployV2(w, { statements: [a.envelope] })
    expect(reason(verify(w, onlyA.envelope, { records: [a, b] }))).toBe(
      "secrets_mismatch"
    )
    const removingB = await deployV2(w, {
      statements: [a.envelope],
      removals: [await remove(w, "B", 2)],
    })
    expect(reason(verify(w, removingB.envelope, { records: [a, b] }))).toBe(
      "secrets_mismatch"
    )
    expect(reason(verify(w, onlyA.envelope, { records: [a, a] }))).toBe(
      "secrets_mismatch"
    )
    expect(reason(verify(w, onlyA.envelope, { records: [a] }))).toBe("accepted")
  })

  test("failing K13 and K14 gives K13's reason; failing K12 and K13, K12's", async () => {
    const w = await world()
    const stranger = person("Mallory")
    const { records } = await deployV2(w, { values: { A: "a", B: "b" } })
    const [a, b] = records as [SecretRecord, SecretRecord]
    const onlyA = await deployV2(w, { statements: [a.envelope] })
    const strangers = {
      ...a,
      envelope: await signAs(
        PAYLOAD_TYPES.secret,
        payloadOf(a.envelope),
        stranger.signer
      ),
    }
    expect(reason(verify(w, onlyA.envelope, { records: [strangers, b] }))).toBe(
      "untrusted_secret"
    )
    const state = {
      ...w.state,
      secrets: { "web/A": { version: 5, hash: "c".repeat(64) } },
    }
    expect(reason(verify(w, onlyA.envelope, { state }))).toBe("stale_secret")
  })
})

describe("the next state, what to write and what to keep", () => {
  test("are what runner-checks.md says, and the state given is never changed", async () => {
    const w = await world()
    const first = await accepted(w, { A: "a", B: "b", C: "c" })
    const [a] = first.records as [SecretRecord]
    const before = deepFreeze({
      ...first.state,
      lastSequence: { ...first.state.lastSequence, api: 7 },
      formats: { ...first.state.formats, api: 1 as const },
    })
    const copy = JSON.stringify(before)
    const second = await deployV2(w, {
      previous: 1,
      statements: [a.envelope],
      values: { B: "new b" },
      version: 2,
      removals: [await remove(w, "C", 2)],
    })
    const [newB] = second.records as [SecretRecord]
    const result = verify(w, second.envelope, {
      state: before,
      records: second.records,
      held: first.held,
    })
    expect(JSON.stringify(before)).toBe(copy)
    if (!result.ok) throw new Error(result.error.code)
    expect(result.value.nextState).toEqual({
      v: 4,
      serverId: w.server.serverId,
      team: before.team,
      lastSequence: { web: 2, api: 7 },
      secrets: {
        "web/A": { version: 1, hash: hashOf(a) },
        "web/B": { version: 2, hash: hashOf(newB) },
        "web/C": { version: 2, hash: null },
      },
      formats: { web: 2, api: 1 },
      routes: {},
      released: [],
    })
    expect(result.value.write).toEqual([newB])
    expect(result.value.keep).toEqual([hashOf(a), hashOf(newB)].sort())
    expect(result.value.deploy).toEqual(payloadOf(second.envelope) as never)
    expect(result.value.signer.publicKey).toBe(w.founder.publicKey)
    for (const part of [
      result.value,
      result.value.nextState,
      result.value.nextState.secrets,
      result.value.nextState.lastSequence,
      result.value.write,
      result.value.keep,
    ])
      expect(Object.isFrozen(part)).toBe(true)
    // A refusal changes nothing either.
    expect(reason(verify(w, second.envelope, { state: before }))).toBe(
      "secret_missing"
    )
    expect(JSON.stringify(before)).toBe(copy)
  })
})

describe("K16: openSecrets", () => {
  test("opens the values of a verified version-2 deploy, supplied or held", async () => {
    const w = await world()
    const values = { DATABASE_URL: "postgres://demo", PAYMENTS_KEY: "demo" }
    const { envelope, records } = await deployV2(w, { values })
    const result = verify(w, envelope, { records })
    if (!result.ok) throw new Error(result.error.code)
    expect(openSecrets(result.value, w.server.secretKey)).toEqual({
      ok: true,
      value: values,
    })
    const again = await deployV2(w, {
      previous: 1,
      statements: records.map((record) => record.envelope),
    })
    const held = verify(w, again.envelope, {
      state: result.value.nextState,
      held: holding(records),
    })
    if (!held.ok) throw new Error(held.error.code)
    expect(openSecrets(held.value, w.server.secretKey)).toEqual({
      ok: true,
      value: values,
    })
  })

  test("refuses a copy, another server's key, and a value sealed for another app", async () => {
    const w = await world()
    const { envelope, records } = await deployV2(w, { values: { A: "a" } })
    const result = verify(w, envelope, { records })
    if (!result.ok) throw new Error(result.error.code)
    expect(reason(openSecrets({ ...result.value }, w.server.secretKey))).toBe(
      "not_verified"
    )
    expect(
      reason(openSecrets(result.value, generateServerKeyPair().secretKey))
    ).toBe("wrong_server_key")
    // A member signs a statement for web over a value sealed for api: it verifies, and does not open.
    const forApi = await createSecret({
      trust: w.trust,
      serverId: w.server.serverId,
      app: "api",
      name: "A",
      value: "a",
      version: 1,
      signer: w.founder.signer,
    })
    const crossed: SecretRecord = {
      envelope: await signAs(
        PAYLOAD_TYPES.secret,
        { ...payloadOf(forApi.envelope), app: "web" },
        w.founder.signer
      ),
      sealed: forApi.sealed,
    }
    const listing = await deployV2(w, { statements: [crossed.envelope] })
    const opened = verify(w, listing.envelope, { records: [crossed] })
    if (!opened.ok) throw new Error(opened.error.code)
    expect(reason(openSecrets(opened.value, w.server.secretKey))).toBe(
      "binding_mismatch"
    )
  })
})
