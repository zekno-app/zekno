/**
 * Secrets by version on the runner (specs/014-deploy-v2, US2; contracts/
 * runner-checks.md K11 to K17, contracts/state.md ST7, contracts/protocol.md
 * P5 and P6). The runner keeps each live secret's latest record, sealed as it
 * arrived, so a deploy sends a record only when the runner lacks it. Every
 * live secret must be accounted for, and a held record counts only while it
 * matches the listing in every field and still verifies. The bounds on what
 * it keeps, and on the `records` answer, are in secrets-v2-bounds.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  createSecret,
  createSigner,
  generateMemberKeyPair,
  PAYLOAD_TYPES,
  proposeRoster,
  SecretRecordSchema,
  type SecretRecord,
} from "@workspace/core"
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  deployV2,
  hashOf,
  leftAsItWas,
  olderState,
  payloadOf,
  recordFiles,
  recordsOf,
  signPayload,
} from "../support/deploy-v2"
import { filesUnder, runner, waitFor, world } from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

const VALUES = { B_KEY: "value of b", A_KEY: "value of a", C_KEY: "value of c" }

const stateOf = (home: string) =>
  JSON.parse(readFileSync(join(home, "state.json"), "utf8")) as {
    secrets: Record<string, { version: number; hash: string | null }>
    formats: Record<string, number>
    lastSequence: Record<string, number>
  }

const byName = (a: SecretRecord, b: SecretRecord) =>
  a.sealed.name < b.sealed.name ? -1 : 1

/** A world whose runner accepted a first deploy of `web` with `values`, each supplied at version 1. */
async function holding(values: Record<string, string> = VALUES) {
  const w = await world()
  const first = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 0,
    values,
  })
  const answer = await deployV2(w, { rosters: w.rosters, ...first })
  if (answer.result.outcome !== "started")
    throw new Error(`the first deploy failed: ${JSON.stringify(answer)}`)
  return { w, records: [...first.records].sort(byName) }
}

/** The next deploy of `web`, against 1: `values` set again, `held` listed by their statements alone. */
const second = (
  w: World,
  input: {
    values?: Record<string, string>
    held?: readonly SecretRecord[]
    removals?: { name: string; version: number }[]
  }
) =>
  buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 1,
    values: input.values ?? {},
    statements: (input.held ?? []).map((record) => record.envelope),
    removals: input.removals,
  })

const fileOf = (w: World, record: SecretRecord) =>
  join(w.home, "records", "web", `${hashOf(record)}.json`)

/** Sends `input` and checks it is refused for `reason` and leaves everything as it was. */
async function refusedFor(w: World, input: unknown, reason: string) {
  const before = leftAsItWas(w)
  expect(await deployV2(w, input)).toEqual({
    events: [],
    result: { outcome: "refused", reason },
  })
  expect(leftAsItWas(w)).toEqual(before)
}

describe("the runner keeps each live secret's latest record", () => {
  test("a deploy's supplied records are kept as records/<app>/<hash>.json, mode 0600 in 0700 folders, as sent; no file holds a value", async () => {
    const { w, records } = await holding()
    const kept = recordFiles(w.home)
    expect(kept.map((file) => file.path)).toEqual(
      records.map((record) => `records/web/${hashOf(record)}.json`).sort()
    )
    for (const file of kept) {
      expect(file.mode).toBe(0o600)
      const record = SecretRecordSchema.parse(JSON.parse(file.content))
      expect(records).toContainEqual(record)
    }
    for (const folder of ["records", "records/web"])
      expect(statSync(join(w.home, folder)).mode & 0o777).toBe(0o700)
    // ST7: every live entry names its file, and no other file is there.
    const state = stateOf(w.home)
    expect(
      Object.values(state.secrets)
        .map((entry) => `records/web/${entry.hash}.json`)
        .sort()
    ).toEqual(kept.map((file) => file.path))
    for (const file of filesUnder(w.home))
      for (const value of Object.values(VALUES))
        expect(file.content).not.toContain(value)
  })

  test("a second deploy that lists the same versions and sends no record starts from the held files, every value in Docker's environment", async () => {
    const { w, records } = await holding()
    const before = recordFiles(w.home)
    const { envelope } = await second(w, { held: records })
    expect(
      (await deployV2(w, { rosters: w.rosters, envelope, records: [] })).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    const calls = w.docker.calls()
    expect(calls).toHaveLength(2)
    for (const [name, value] of Object.entries(VALUES))
      expect(calls[1]!.env[name]).toBe(value)
    expect(recordFiles(w.home)).toEqual(before)
  })

  test("a secret set again: its new file is kept and the old one deleted, once the state that names the new one is saved", async () => {
    const { w, records } = await holding()
    const [a, b, c] = records as [SecretRecord, SecretRecord, SecretRecord]
    w.docker.holdUp()
    const next = await second(w, {
      values: { A_KEY: "a newer value of a" },
      held: [b, c],
    })
    const [newer] = next.records as [SecretRecord]
    const running = deployV2(w, { rosters: w.rosters, ...next })
    await waitFor(w.docker.upStarted, "docker compose up to start")
    // While Docker runs, the state already names the new file, and the old one is gone.
    expect(stateOf(w.home).secrets["web/A_KEY"]).toEqual({
      version: 2,
      hash: hashOf(newer),
    })
    expect(recordFiles(w.home).map((file) => file.path)).toEqual(
      [newer, b, c].map((record) => `records/web/${hashOf(record)}.json`).sort()
    )
    w.docker.releaseUp()
    expect((await running).result.outcome).toBe("started")
    expect(
      recordFiles(w.home).some((file) => file.path.includes(hashOf(a)))
    ).toBe(false)
    expect(w.docker.calls()[1]!.env.A_KEY).toBe("a newer value of a")
  })

  test("a removal: the entry's hash is null and its file deleted", async () => {
    const { w, records } = await holding()
    const [a, b, c] = records as [SecretRecord, SecretRecord, SecretRecord]
    const next = await second(w, {
      held: [a, c],
      removals: [{ name: "B_KEY", version: 2 }],
    })
    expect((await deployV2(w, { rosters: w.rosters, ...next })).result).toEqual(
      { outcome: "started", app: "web", sequence: 2 }
    )
    expect(stateOf(w.home).secrets["web/B_KEY"]).toEqual({
      version: 2,
      hash: null,
    })
    expect(recordFiles(w.home).map((file) => file.path)).toEqual(
      [a, c].map((record) => `records/web/${hashOf(record)}.json`).sort()
    )
    expect(w.docker.calls()[1]!.env.B_KEY).toBeUndefined()
    expect(
      recordFiles(w.home).some((file) => file.path.includes(hashOf(b)))
    ).toBe(false)
  })

  test("a file of the app no state names, as a crash leaves, is deleted at the app's next deploy; another app's files stay", async () => {
    const { w, records } = await holding()
    const stray = join(w.home, "records", "web", `${"e".repeat(64)}.json`)
    const half = join(
      w.home,
      "records",
      "web",
      `${hashOf(records[0]!)}.json.0123.tmp`
    )
    writeFileSync(stray, readFileSync(fileOf(w, records[0]!)))
    writeFileSync(half, "{")
    const other = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      app: "api",
    })
    expect(
      (await deployV2(w, { rosters: w.rosters, ...other })).result.outcome
    ).toBe("started")
    // A deploy of another app leaves web's folder alone.
    expect(recordFiles(w.home).map((file) => file.path)).toContain(
      `records/web/${"e".repeat(64)}.json`
    )
    const { envelope } = await second(w, { held: records })
    expect(
      (await deployV2(w, { rosters: w.rosters, envelope, records: [] })).result
        .outcome
    ).toBe("started")
    expect(recordFiles(w.home).map((file) => file.path)).toEqual(
      [
        ...records.map((record) => `records/web/${hashOf(record)}.json`),
        `records/api/${hashOf(other.records[0]!)}.json`,
      ].sort()
    )
  })
})

describe("every live secret is accounted for, and a held record must match and verify", () => {
  test("K11: a deploy that leaves out a live name is secrets_mismatch", async () => {
    const { w, records } = await holding()
    const { envelope } = await second(w, { held: records.slice(1) })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope, records: [] },
      "secrets_mismatch"
    )
  })

  test("K13, held: a missing file, or a file whose statement's name, version or hash differs, is secret_missing", async () => {
    const { w, records } = await holding()
    const [a, b] = records as [SecretRecord, SecretRecord]
    const { envelope } = await second(w, { held: records })
    const request = { rosters: w.rosters, envelope, records: [] }
    const resigned = (change: Record<string, unknown>): SecretRecord => ({
      ...a,
      envelope: signPayload(
        PAYLOAD_TYPES.secret,
        JSON.stringify({ ...payloadOf(a.envelope), ...change }),
        w.signer
      ),
    })
    const path = fileOf(w, a)
    const good = readFileSync(path, "utf8")

    rmSync(path)
    await refusedFor(w, request, "secret_missing")
    for (const held of [
      b,
      resigned({ name: "D_KEY" }),
      resigned({ version: 2 }),
      resigned({ hash: "d".repeat(64) }),
      resigned({ app: "api" }),
      "not a record",
    ]) {
      writeFileSync(
        path,
        typeof held === "string" ? held : JSON.stringify(held),
        {
          mode: 0o600,
        }
      )
      await refusedFor(w, request, "secret_missing")
    }
    writeFileSync(path, good)
    expect((await deployV2(w, request)).result.outcome).toBe("started")
  })

  test("K13, held: a record whose signature was broken on disk is untrusted_secret", async () => {
    const { w, records } = await holding()
    const [a] = records as [SecretRecord]
    const sig = a.envelope.signature.sig
    const broken: SecretRecord = {
      ...a,
      envelope: {
        ...a.envelope,
        signature: {
          ...a.envelope.signature,
          sig: `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`,
        },
      },
    }
    writeFileSync(fileOf(w, a), JSON.stringify(broken))
    const { envelope } = await second(w, { held: records })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope, records: [] },
      "untrusted_secret"
    )
  })

  test("a record supplied for a secret the runner holds replaces the held one", async () => {
    const { w, records } = await holding()
    const [a, ...rest] = records as [SecretRecord, ...SecretRecord[]]
    rmSync(fileOf(w, a))
    const { envelope } = await second(w, { held: records })
    expect(
      (await deployV2(w, { rosters: w.rosters, envelope, records: [a] })).result
        .outcome
    ).toBe("started")
    expect(recordFiles(w.home).map((file) => file.path)).toEqual(
      [a, ...rest].map((record) => `records/web/${hashOf(record)}.json`).sort()
    )
  })
})

describe("records", () => {
  test("answers the statements of the held files, sorted by name, and never a sealed value", async () => {
    const { w, records } = await holding()
    const answer = await recordsOf(w, "web")
    expect(answer).toEqual({
      statements: records.map((record) => record.envelope),
    })
    for (const record of records)
      expect(JSON.stringify(answer)).not.toContain(record.sealed.ciphertext)
    // A read: it changes nothing.
    const before = leftAsItWas(w)
    await recordsOf(w, "web")
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("an app the runner does not hold, and an app at format 1, have no statements", async () => {
    const { w } = await holding()
    expect(await recordsOf(w, "api")).toEqual({ statements: [] })
    const older = await world()
    olderState(older.home, { web: 2 })
    const before = leftAsItWas(older)
    expect(await recordsOf(older, "web")).toEqual({ statements: [] })
    expect(leftAsItWas(older)).toEqual(before)
  })

  test("a held file that is missing or does not read is left out", async () => {
    const { w, records } = await holding()
    const [a, b, c] = records as [SecretRecord, SecretRecord, SecretRecord]
    rmSync(fileOf(w, a))
    writeFileSync(fileOf(w, b), "{")
    expect(await recordsOf(w, "web")).toEqual({ statements: [c.envelope] })
  })

  test("a runner never set up is not_set_up; a damaged state is invalid_state", async () => {
    const { w } = await holding()
    writeFileSync(join(w.home, "state.json"), "{")
    expect(await recordsOf(w, "web")).toEqual({
      outcome: "refused",
      reason: "invalid_state",
    })
    const fresh = { home: join(w.home, "elsewhere"), docker: w.docker }
    expect(await recordsOf(fresh, "web")).toEqual({
      outcome: "refused",
      reason: "not_set_up",
    })
    expect(filesUnder(fresh.home)).toEqual([])
  })
})

describe("a secret set by someone no longer in the team stops counting (US3)", () => {
  /**
   * A runner holding DATABASE_URL as Bea set it, Bea then taken out of the
   * team list by the admin, and that list already synced to the runner.
   */
  async function afterBeaLeft() {
    const w = await world()
    const bea = createSigner(generateMemberKeyPair().secretKey)
    const withBea = await proposeRoster({
      trust: w.trust,
      members: [
        ...w.trust.members,
        { name: "Bea", publicKey: bea.publicKey, role: "deployer" },
      ],
      signer: w.signer,
    })
    const rosters = [...w.rosters, withBea.envelope]
    const hers = await createSecret({
      trust: withBea.trust,
      serverId: w.serverId,
      app: "web",
      name: "DATABASE_URL",
      value: "postgres://set-by-bea",
      version: 1,
      signer: bea,
    })
    const first = await buildDeployV2({
      trust: withBea.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      values: {},
      statements: [hers.envelope],
    })
    const answer = await deployV2(w, {
      rosters,
      envelope: first.envelope,
      records: [hers],
    })
    if (answer.result.outcome !== "started")
      throw new Error(`the first deploy failed: ${JSON.stringify(answer)}`)

    const without = await proposeRoster({
      trust: withBea.trust,
      members: w.trust.members,
      signer: w.signer,
    })
    const after = [...rosters, without.envelope]
    const synced = await runner(w.home, w.docker.path, "sync", {
      rosters: after,
    })
    if (synced.json?.outcome !== "ok")
      throw new Error(`sync failed: ${JSON.stringify(synced.json)}`)

    // A deploy signed anyway by the admin, listing Bea's secret: no zekno of this feature signs it (C4).
    const { envelope } = await buildDeployV2({
      trust: without.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      values: {},
    })
    const listing = signPayload(
      PAYLOAD_TYPES.deployV2,
      JSON.stringify({
        ...payloadOf(envelope),
        secrets: [{ name: "DATABASE_URL", hash: hashOf(hers), version: 1 }],
      }),
      w.signer
    )
    return { w, rosters: after, trust: without.trust, hers, listing }
  }

  test("a deploy that lists it, held by the runner, is untrusted_secret: no number used, the state and records/ as they were", async () => {
    const { w, rosters, listing } = await afterBeaLeft()
    await refusedFor(
      w,
      { rosters, envelope: listing, records: [] },
      "untrusted_secret"
    )
    expect(stateOf(w.home).lastSequence).toEqual({ web: 1 })
  })

  test("so is one that supplies her record", async () => {
    const { w, rosters, hers, listing } = await afterBeaLeft()
    await refusedFor(
      w,
      { rosters, envelope: listing, records: [hers] },
      "untrusted_secret"
    )
  })

  test("once the admin sets it again, the deploy goes through, and her record is deleted", async () => {
    const { w, rosters, trust, hers } = await afterBeaLeft()
    const again = await buildDeployV2({
      trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      values: { DATABASE_URL: "postgres://set-again" },
      secretVersion: 2,
    })
    expect((await deployV2(w, { rosters, ...again })).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(recordFiles(w.home).map((file) => file.path)).toEqual([
      `records/web/${hashOf(again.records[0]!)}.json`,
    ])
    expect(
      recordFiles(w.home).some((file) => file.path.includes(hashOf(hers)))
    ).toBe(false)
  })
})
