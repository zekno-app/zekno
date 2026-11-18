/**
 * Each refusal of the runner's `deploy`, in the order of contracts/
 * runner-checks.md (K1 to K16; K7 and K10 are in deploy-v2.test.ts). Each
 * case is built to fail at its check and at no earlier one, after one genuine
 * deploy, so there is state to protect. A refusal uses no number and leaves
 * the state's bytes, the Compose file, the record files and Docker as they
 * were, except the team lists it carried (K3).
 */
import { describe, expect, test } from "bun:test"
import {
  createDeployV2,
  createSecret,
  createSigner,
  generateMemberKeyPair,
  LIMITS,
  PAYLOAD_TYPES,
  proposeRoster,
  type Envelope,
  type SecretRecord,
} from "@workspace/core"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  deployV2,
  hashOf,
  leftAsItWas,
  payloadOf,
  signPayload,
} from "../support/deploy-v2"
import {
  buildDeploy,
  fakeDocker,
  filesUnder,
  tempDir,
  world,
} from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

/** A world whose runner accepted one genuine version-2 deploy of `web`, with GREETING at version 1. */
async function ready(): Promise<World> {
  const w = await world()
  const first = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 0,
  })
  const answer = await deployV2(w, { rosters: w.rosters, ...first })
  if (answer.result.outcome !== "started")
    throw new Error(`the first deploy failed: ${JSON.stringify(answer)}`)
  return w
}

/** The next deploy of `web` (against 1), as a genuine zekno would sign it, with what it supplies. */
const next = (
  w: World,
  change: Partial<Parameters<typeof buildDeployV2>[0]> = {}
) =>
  buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 1,
    ...change,
  })

/** The same payload as `envelope`'s with `change`, signed again by a member: a deploy no zekno would sign. */
const resigned = (
  w: World,
  envelope: Envelope,
  change: Record<string, unknown>
): Envelope =>
  signPayload(
    PAYLOAD_TYPES.deployV2,
    JSON.stringify({ ...payloadOf(envelope), ...change }),
    w.signer
  )

/** Sends `input` and checks it is refused for `reason` and leaves everything as it was. */
async function refusedFor(w: World, input: unknown, reason: string) {
  const before = leftAsItWas(w)
  expect(await deployV2(w, input)).toEqual({
    events: [],
    result: { outcome: "refused", reason },
  })
  expect(leftAsItWas(w)).toEqual(before)
}

/** Someone who can start the runner, but whose key is in no team list. */
function stranger(w: World) {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const trust = {
    ...w.trust,
    members: [
      { name: "Mallory", publicKey: signer.publicKey, role: "admin" as const },
    ],
  }
  return { signer, trust }
}

describe("each refusal, in order", () => {
  test("K1: a request that is not a deploy request is invalid_request", async () => {
    const w = await ready()
    const { envelope, records } = await next(w)
    for (const input of [
      undefined,
      "garbage",
      {},
      { rosters: w.rosters, envelope },
      { rosters: w.rosters, envelope, records, extra: 1 },
      { rosters: w.rosters, envelope: { payloadType: "x" }, records },
      { rosters: w.rosters, envelope, records: [{ envelope }] },
    ])
      await refusedFor(w, input, "invalid_request")
  })

  test("K2: a runner never set up is not_set_up, and nothing is written", async () => {
    const w = await world()
    const home = tempDir("runner")
    const docker = fakeDocker()
    const { envelope, records } = await next(w, { previous: 0 })
    expect(
      await deployV2(
        { home, docker },
        { rosters: w.rosters, envelope, records }
      )
    ).toEqual({
      events: [],
      result: { outcome: "refused", reason: "not_set_up" },
    })
    expect(filesUnder(home)).toEqual([])
    expect(docker.calls()).toEqual([])
  })

  test("K2: a lock another run holds is busy", async () => {
    const w = await ready()
    writeFileSync(join(w.home, "lock"), String(process.pid)) // this test process is alive
    const { envelope, records } = await next(w)
    await refusedFor(w, { rosters: w.rosters, envelope, records }, "busy")
    rmSync(join(w.home, "lock"))
    expect(
      (await deployV2(w, { rosters: w.rosters, envelope, records })).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
  })

  test("K2: a damaged state, or a marked one with a part missing, is invalid_state", async () => {
    const w = await ready()
    const path = join(w.home, "state.json")
    const good = readFileSync(path, "utf8")
    const marked = JSON.parse(good) as Record<string, unknown>
    const { formats: _formats, ...withoutFormats } = marked
    const { envelope, records } = await next(w)
    for (const damaged of [
      "",
      "{",
      "null",
      JSON.stringify(withoutFormats),
      JSON.stringify({ ...marked, v: 3 }),
      JSON.stringify({ ...marked, formats: { web: 2, api: 2 } }),
      JSON.stringify({ ...marked, extra: 1 }),
    ]) {
      writeFileSync(path, damaged)
      await refusedFor(
        w,
        { rosters: w.rosters, envelope, records },
        "invalid_state"
      )
    }
  })

  test("K3: a team list the attacker signed themselves is refused with its own reason", async () => {
    const w = await ready()
    const mallory = stranger(w)
    const forged = await proposeRoster({
      trust: {
        ...w.trust,
        members: [...w.trust.members, ...mallory.trust.members],
      },
      signer: mallory.signer,
    })
    const { envelope, records } = await next(w)
    await refusedFor(
      w,
      { rosters: [...w.rosters, forged.envelope], envelope, records },
      "unknown_signer"
    )
  })

  test("K4: a deploy of version 1 sent as version 2 is wrong_payload_type", async () => {
    const w = await ready()
    const older = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope: older.envelope, records: [] },
      "wrong_payload_type"
    )
  })

  test("K5: a deploy signed by a key no team list has is unknown_signer; one with a byte changed is bad_signature", async () => {
    const w = await ready()
    const mallory = stranger(w)
    const forged = await createDeployV2({
      trust: mallory.trust,
      serverId: w.serverId,
      app: "web",
      previous: 1,
      compose: "services:\n  miner:\n    image: example/miner\n",
      statements: [],
      removals: [],
      expiresAt: null,
      signer: mallory.signer,
    })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope: forged, records: [] },
      "unknown_signer"
    )

    const { envelope, records } = await next(w)
    const payload = Buffer.from(envelope.payload, "base64url")
    const at = payload.indexOf("example/web:1")
    payload[at] = payload[at]! ^ 1
    await refusedFor(
      w,
      {
        rosters: w.rosters,
        envelope: { ...envelope, payload: payload.toString("base64url") },
        records,
      },
      "bad_signature"
    )
  })

  test("K6: a payload a member signed that breaks a rule of the format is malformed", async () => {
    const w = await ready()
    const { envelope, records } = await next(w)
    for (const change of [
      { sequence: 3 },
      { previous: -1, sequence: 0 },
      { compose: 7 },
      { secrets: "none" },
    ])
      await refusedFor(
        w,
        {
          rosters: w.rosters,
          envelope: resigned(w, envelope, change),
          records,
        },
        "malformed"
      )
    const notJson = signPayload(PAYLOAD_TYPES.deployV2, "not json", w.signer)
    await refusedFor(
      w,
      { rosters: w.rosters, envelope: notJson, records },
      "malformed"
    )
  })

  test("K8: another team, an older team list, another server, a server the list no longer has", async () => {
    const w = await ready()
    const { envelope, records } = await next(w)
    // Every role a team list can hold today may deploy, so role_not_allowed cannot be reached yet.
    for (const [change, reason] of [
      [{ teamId: `team_${"B".repeat(22)}` }, "wrong_team"],
      [{ teamHash: "0".repeat(64) }, "stale_team"],
      [{ serverId: `srv_${"0".repeat(32)}` }, "wrong_server"],
    ] as const)
      await refusedFor(
        w,
        {
          rosters: w.rosters,
          envelope: resigned(w, envelope, change),
          records,
        },
        reason
      )

    // A team list that takes the server out: it is followed and saved (K3), and the deploy refused.
    const before = leftAsItWas(w)
    const without = await proposeRoster({
      trust: w.trust,
      servers: [],
      signer: w.signer,
    })
    const answer = await deployV2(w, {
      rosters: [...w.rosters, without.envelope],
      envelope: resigned(w, envelope, { teamHash: without.trust.hash }),
      records,
    })
    expect(answer.result).toEqual({
      outcome: "refused",
      reason: "unknown_server",
    })
    const after = leftAsItWas(w)
    expect({ ...after, state: undefined }).toEqual({
      ...before,
      state: undefined,
    })
    const saved = JSON.parse(after.state!) as Record<string, unknown>
    expect((saved.team as { hash: string }).hash).toBe(without.trust.hash)
    expect({ ...saved, team: undefined }).toEqual({
      ...(JSON.parse(before.state!) as Record<string, unknown>),
      team: undefined,
    })
  })

  test("K9: made against a number below the app's is replayed; above it, sequence_jump", async () => {
    const w = await ready()
    for (const [previous, reason] of [
      [0, "replayed"],
      [2, "sequence_jump"],
    ] as const) {
      const { envelope, records } = await next(w, { previous })
      await refusedFor(w, { rosters: w.rosters, envelope, records }, reason)
    }
  })

  test("K11: a deploy that leaves out a secret the runner holds is secrets_mismatch", async () => {
    const w = await ready()
    const { envelope, records } = await next(w, { values: {} })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope, records },
      "secrets_mismatch"
    )
  })

  test("K12: a secret at the version held with another value is stale_secret", async () => {
    const w = await ready()
    const { envelope, records } = await next(w, { secretVersion: 1 })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope, records },
      "stale_secret"
    )
  })

  test("K13, supplied: a record set by a key no list has is untrusted_secret; a record of another version than listed is secrets_mismatch", async () => {
    const w = await ready()
    const { envelope } = await next(w, { values: {} })
    const listing = (record: SecretRecord, version: number) =>
      resigned(w, envelope, {
        secrets: [{ name: "GREETING", hash: hashOf(record), version }],
      })

    const mallory = stranger(w)
    const theirs = await createSecret({
      trust: mallory.trust,
      serverId: w.serverId,
      app: "web",
      name: "GREETING",
      value: "from mallory",
      version: 2,
      signer: mallory.signer,
    })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope: listing(theirs, 2), records: [theirs] },
      "untrusted_secret"
    )

    const ours = await createSecret({
      trust: w.trust,
      serverId: w.serverId,
      app: "web",
      name: "GREETING",
      value: "a newer value",
      version: 3,
      signer: w.signer,
    })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope: listing(ours, 2), records: [ours] },
      "secrets_mismatch"
    )
  })

  test("K14: a record sent for a secret the deploy does not list is secrets_mismatch", async () => {
    const w = await ready()
    const { envelope, records } = await next(w)
    const unlisted = await createSecret({
      trust: w.trust,
      serverId: w.serverId,
      app: "web",
      name: "UNLISTED",
      value: "never listed",
      version: 1,
      signer: w.signer,
    })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope, records: [...records, unlisted] },
      "secrets_mismatch"
    )
  })

  test("K15: a deploy of one app past 1,024 is too_large", async () => {
    const w = await ready()
    const path = join(w.home, "state.json")
    const held = JSON.parse(readFileSync(path, "utf8"))
    // As many apps as a runner holds, `web` among them, as hardening.test.ts builds it.
    for (let n = 1; n < LIMITS.appsPerServer; n++) {
      held.lastSequence[`app-${n}`] = 1
      held.formats[`app-${n}`] = 1
    }
    writeFileSync(path, JSON.stringify(held))
    const { envelope, records } = await next(w, {
      previous: 0,
      app: "one-more",
    })
    await refusedFor(w, { rosters: w.rosters, envelope, records }, "too_large")
  })

  test("K16: a statement for web over a value sealed for another app is secrets_mismatch", async () => {
    const w = await ready()
    const forApi = await createSecret({
      trust: w.trust,
      serverId: w.serverId,
      app: "api",
      name: "GREETING",
      value: "sealed for api",
      version: 2,
      signer: w.signer,
    })
    // A member signs a statement for web over it: it verifies, and does not open.
    const crossed: SecretRecord = {
      envelope: signPayload(
        PAYLOAD_TYPES.secret,
        JSON.stringify({ ...payloadOf(forApi.envelope), app: "web" }),
        w.signer
      ),
      sealed: forApi.sealed,
    }
    const envelope = await createDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      app: "web",
      previous: 1,
      compose: "services:\n  web:\n    image: example/web:1\n",
      statements: [crossed.envelope],
      removals: [],
      expiresAt: null,
      signer: w.signer,
    })
    await refusedFor(
      w,
      { rosters: w.rosters, envelope, records: [crossed] },
      "secrets_mismatch"
    )
  })
})
