/**
 * The bounds on what the runner keeps of secrets, and on what it answers
 * about them (specs/014-deploy-v2, FR-025; contracts/runner-checks.md K15,
 * contracts/protocol.md P6). A deploy after which the runner would keep more
 * than 8,192 live records or 64 MiB of record files is refused `too_large`
 * with nothing changed, and so is one that supplies a record whose statement
 * is longer than 4,096 characters (security review S2); a `records` answer
 * leaves out a kept statement that long, and one that would not fit its
 * schema (256 statements) is refused `too_large` rather than sent.
 */
import { describe, expect, test } from "bun:test"
import {
  LIMITS,
  SESSION_FRAME_BYTES,
  type Envelope,
  type SecretRecord,
} from "@workspace/core"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  deployV2,
  hashOf,
  leftAsItWas,
  payloadOf,
  recordsOf,
  signPayload,
} from "../support/deploy-v2"
import { world } from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

/** A distinct 64-digit hex value for each number. */
const hex = (n: number): string => n.toString(16).padStart(64, "0")

const MiB = 1024 * 1024

/** A world whose runner accepted a first deploy of `web` with `values`, each supplied at version 1. */
async function holding(values: Record<string, string>) {
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
  return { w, records: first.records }
}

/** Adds an app `big` at format 2 to the stored state, its entries named by `hashes`, and each file with `content`. */
function addBig(w: World, hashes: string[], content: (hash: string) => string) {
  const path = join(w.home, "state.json")
  const state = JSON.parse(readFileSync(path, "utf8"))
  state.lastSequence.big = 1
  state.formats.big = 2
  hashes.forEach((hash, n) => {
    state.secrets[`big/S${n}`] = { version: 1, hash }
  })
  writeFileSync(path, JSON.stringify(state))
  const folder = join(w.home, "records", "big")
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  for (const hash of hashes)
    writeFileSync(join(folder, `${hash}.json`), content(hash), { mode: 0o600 })
  return folder
}

/** The next deploy of `web`, against 1, setting `values` again. */
const next = (w: World, values: Record<string, string>) =>
  buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 1,
    values,
  })

async function refusedFor(w: World, input: unknown, reason: string) {
  const before = leftAsItWas(w)
  expect(await deployV2(w, input)).toEqual({
    events: [],
    result: { outcome: "refused", reason },
  })
  expect(leftAsItWas(w)).toEqual(before)
}

describe("K15: what the runner keeps of secrets stays within its bounds", () => {
  test("8,192 live records fit; one more is too_large", async () => {
    const { w } = await holding({ GREETING: "g" })
    // With web/GREETING, 8,191 live records, each with its file.
    addBig(
      w,
      Array.from({ length: LIMITS.secretsPerServer - 2 }, (_, n) => hex(n)),
      () => "{}"
    )
    const oneMore = await next(w, { GREETING: "g2", ONE: "1", TWO: "2" })
    await refusedFor(w, { rosters: w.rosters, ...oneMore }, "too_large")
    const exactly = await next(w, { GREETING: "g2", ONE: "1" })
    expect(
      (await deployV2(w, { rosters: w.rosters, ...exactly })).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
  }, 30_000)

  test("64 MiB of record files fit; one byte more is too_large", async () => {
    const { w } = await holding({ GREETING: "g" })
    const deploy = await next(w, { GREETING: "g2" })
    const [record] = deploy.records as [SecretRecord]
    // What the runner will keep after the deploy: the new record of web, and big's file.
    const kept =
      LIMITS.recordBytesPerServer - Buffer.byteLength(JSON.stringify(record))
    const folder = addBig(w, [hex(1)], () => "")
    const big = join(folder, `${hex(1)}.json`)
    try {
      truncateSync(big, kept + 1)
      await refusedFor(w, { rosters: w.rosters, ...deploy }, "too_large")
      truncateSync(big, kept)
      expect(
        (await deployV2(w, { rosters: w.rosters, ...deploy })).result
      ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    } finally {
      rmSync(big, { force: true })
    }
  }, 30_000)
})

/**
 * `record` with its statement padded with JSON whitespace to `length`
 * characters of base64url and signed again by `signer`: a statement every
 * check of its signature, schema and hash reads (security review S2).
 */
function padded(
  record: SecretRecord,
  length: number,
  signer: World["signer"]
): SecretRecord {
  const json = JSON.stringify(payloadOf(record.envelope))
  const bytes = Math.floor((length * 3) / 4)
  const text = `${json.slice(0, -1)}${" ".repeat(bytes - json.length)}}`
  return { ...record, envelope: signPayload("zekno.secret.v1", text, signer) }
}

describe("K13: a supplied record's statement is at most 4,096 characters (security review S2)", () => {
  test("longer is too_large, and nothing is kept; at 4,096 it is kept", async () => {
    const { w } = await holding({ GREETING: "g" })
    const build = async (length: number) => {
      const made = await next(w, { GREETING: "g2" })
      const long = padded(made.records[0]!, length, w.signer)
      expect(long.envelope.payload).toHaveLength(length)
      return buildDeployV2({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        previous: 1,
        values: {},
        statements: [long.envelope],
      }).then(({ envelope }) => ({ envelope, records: [long] }))
    }
    // 4,098 is the shortest base64url text past 4,096; 1,365,000 is the padding of probe 4.
    for (const length of [4098, 1_365_000])
      await refusedFor(
        w,
        { rosters: w.rosters, ...(await build(length)) },
        "too_large"
      )
    const exactly = await build(4096)
    expect(
      (await deployV2(w, { rosters: w.rosters, ...exactly })).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    expect(await recordsOf(w, "web")).toEqual({
      statements: [exactly.records[0]!.envelope],
    })
  }, 30_000)
})

describe("the records answer stays within its frame", () => {
  /** The frame a `records` answer of these statements takes, as the session writes it. */
  const frameBytes = (statements: Envelope[]) =>
    Buffer.byteLength(JSON.stringify({ result: { statements } })) + 1

  test("a kept statement longer than 4,096 characters is left out, the others are sent, and nothing changes (security review S2)", async () => {
    const { w, records } = await holding({ A: "a", B: "b", C: "c", D: "d" })
    const sorted = [...records].sort((a, b) =>
      a.sealed.name < b.sealed.name ? -1 : 1
    )
    // Files that read as records, kept as a runner before the limit kept what it was sent.
    const swollen = (record: SecretRecord, length: number): SecretRecord => ({
      ...record,
      envelope: { ...record.envelope, payload: "A".repeat(length) },
    })
    const kept = [
      swollen(sorted[0]!, 1_300_000),
      swollen(sorted[1]!, 4096),
      sorted[2]!,
      swollen(sorted[3]!, 4097),
    ]
    sorted.forEach((record, n) =>
      writeFileSync(
        join(w.home, "records", "web", `${hashOf(record)}.json`),
        JSON.stringify(kept[n])
      )
    )
    const before = leftAsItWas(w)
    expect(await recordsOf(w, "web")).toEqual({
      statements: [kept[1]!.envelope, kept[2]!.envelope],
    })
    expect(leftAsItWas(w)).toEqual(before)
  }, 30_000)

  test("the longest answer of statements within the limit fits its frame", () => {
    expect(SESSION_FRAME_BYTES.records).toBe(4 * MiB)
    const longest: Envelope = {
      payloadType: "zekno.secret.v1",
      payload: "A".repeat(LIMITS.statementPayloadLength),
      signature: { keyId: "a".repeat(32), sig: "A".repeat(86) },
    }
    const answer = new Array<Envelope>(LIMITS.secretsPerDeploy).fill(longest)
    expect(frameBytes(answer)).toBeLessThan(SESSION_FRAME_BYTES.records)
  })

  test("an answer of more statements than its schema takes is too_large", async () => {
    const { w, records } = await holding({ GREETING: "g" })
    const [record] = records as [SecretRecord]
    const path = join(w.home, "state.json")
    const state = JSON.parse(readFileSync(path, "utf8"))
    const folder = join(w.home, "records", "web")
    for (let n = 0; n < LIMITS.secretsPerDeploy; n++) {
      state.secrets[`web/S${n}`] = { version: 1, hash: hex(n) }
      writeFileSync(join(folder, `${hex(n)}.json`), JSON.stringify(record))
    }
    writeFileSync(path, JSON.stringify(state))
    expect(await recordsOf(w, "web")).toEqual({
      outcome: "refused",
      reason: "too_large",
    })
  }, 30_000)
})
