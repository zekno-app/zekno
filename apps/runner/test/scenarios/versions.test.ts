/**
 * Version 1 and version 2 on one runner (specs/014-deploy-v2, US4;
 * contracts/state.md): the stored state's mark, the version-1 path, and the
 * helpers that build what an older program leaves behind.
 */
import { describe, expect, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  parseMessage,
  proposeRoster,
  RunnerStatusSchema,
} from "@workspace/core"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  deployV2,
  leftAsItWas,
  olderState,
  recordsOf,
  signPayload,
} from "../support/deploy-v2"
import {
  buildDeploy,
  fakeDocker,
  runner,
  session,
  tempDir,
  world,
} from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

/** Every part of a marked state (contracts/state.md, "The shape"). */
const PARTS = ["formats", "lastSequence", "secrets", "serverId", "team", "v"]

const fileOf = (home: string) => readFileSync(join(home, "state.json"), "utf8")
const stateOf = (home: string) =>
  JSON.parse(fileOf(home)) as Record<string, unknown>

/** A version-1 deploy of `app` numbered `sequence`, applied with the one-shot command. */
async function apply(w: World, sequence: number, app = "web") {
  const deploy = await buildDeploy({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    sequence,
    app,
  })
  return runner(w.home, w.docker.path, "apply", { rosters: w.rosters, deploy })
}

/** A version-2 deploy of `app` made against `previous`, sent in a session. */
async function deploy(w: World, previous: number, app = "web") {
  const built = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
    app,
  })
  return (await deployV2(w, { rosters: w.rosters, ...built })).result
}

describe("the test helpers sign as the core library does", () => {
  test("signPayload of a version-1 deploy's payload gives exactly the envelope createDeploy gave", async () => {
    const w = await world()
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 1,
    })
    const bytes = Buffer.from(deploy.envelope.payload, "base64url")
    // Ed25519 is deterministic: the same bytes signed by the same key give the same signature.
    expect(signPayload(deploy.envelope.payloadType, bytes, w.signer)).toEqual(
      deploy.envelope
    )
    expect(
      signPayload(deploy.envelope.payloadType, bytes.toString("utf8"), w.signer)
    ).toEqual(deploy.envelope)
  })
})

describe("the stored state carries its mark, and every write keeps it whole (ST3, ST4)", () => {
  test("after setup, state.json is marked, with no app at any format", async () => {
    const signer = createSigner(generateMemberKeyPair().secretKey)
    const team = await createTeam({ founderName: "Ada", signer })
    const home = tempDir("runner")
    const setup = await runner(home, fakeDocker().path, "setup", {
      founding: team.envelope,
      teamCode: team.confirmationCode,
    })
    expect(setup.code).toBe(0)
    expect(stateOf(home)).toEqual({
      v: 2,
      serverId: setup.json!.serverId,
      team: team.trust,
      lastSequence: {},
      secrets: {},
      formats: {},
    })
    // world() sets up, then syncs a team list: still marked, every part there.
    const w = await world()
    expect(Object.keys(stateOf(w.home)).sort()).toEqual(PARTS)
    expect(stateOf(w.home)).toMatchObject({ v: 2, formats: {} })
  })

  test("after sync, apply and deploy, the file has the mark and every part", async () => {
    const w = await world()
    olderState(w.home, { web: 1 })
    expect(Object.keys(stateOf(w.home)).sort()).toEqual(
      PARTS.filter((part) => part !== "v" && part !== "formats")
    )

    const newer = await proposeRoster({ trust: w.trust, signer: w.signer })
    const rosters = [...w.rosters, newer.envelope]
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters })).json
    ).toEqual({ outcome: "ok" })
    expect(stateOf(w.home)).toMatchObject({ v: 2, formats: { web: 1 } })
    expect(Object.keys(stateOf(w.home)).sort()).toEqual(PARTS)

    const synced = { ...w, rosters, trust: newer.trust }
    expect((await apply(synced, 2)).json?.outcome).toBe("started")
    expect(Object.keys(stateOf(w.home)).sort()).toEqual(PARTS)
    expect(stateOf(w.home)).toMatchObject({
      v: 2,
      formats: { web: 1 },
      lastSequence: { web: 2 },
    })

    expect((await deploy(synced, 2)).outcome).toBe("started")
    expect(Object.keys(stateOf(w.home)).sort()).toEqual(PARTS)
    expect(stateOf(w.home)).toMatchObject({
      v: 2,
      formats: { web: 2 },
      lastSequence: { web: 3 },
    })
  })
})

describe("the version-1 path on this runner", () => {
  test("SC-007: a version-1 deploy of an app held before keeps the mark and every app's format (ST5)", async () => {
    const w = await world()
    olderState(w.home, { web: 1, api: 3 })
    expect(await deploy(w, 3, "api")).toEqual({
      outcome: "started",
      app: "api",
      sequence: 4,
    })
    const before = stateOf(w.home)
    expect(before.formats).toEqual({ web: 1, api: 2 })

    expect((await apply(w, 2)).json).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    const after = stateOf(w.home)
    expect(after.v).toBe(2)
    expect(after.formats).toEqual({ web: 1, api: 2 })
    expect(after.lastSequence).toEqual({ web: 2, api: 4 })
    expect(after.serverId).toBe(before.serverId)
    expect(after.team).toEqual(before.team)
    expect(after.secrets).toEqual({
      ...(before.secrets as object),
      "web/GREETING": {
        version: 2,
        hash: (after.secrets as Record<string, { hash: string }>)[
          "web/GREETING"
        ]!.hash,
      },
    })
    // It keeps no record: the secret came by version 1.
    expect(
      leftAsItWas(w).records.filter((file) =>
        file.path.startsWith("records/web/")
      )
    ).toEqual([])
  })

  test("ST6, FR-031: apply of a new app is unsupported_version, the state's bytes unchanged", async () => {
    const w = await world()
    const before = leftAsItWas(w)
    const result = await apply(w, 1)
    expect(result.code).toBe(1)
    expect(result.json).toEqual({
      outcome: "refused",
      reason: "unsupported_version",
    })
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("ST6, FR-031: apply of an app after its first version-2 deploy is unsupported_version, the state's bytes unchanged", async () => {
    const w = await world()
    olderState(w.home, { web: 1 })
    expect((await deploy(w, 1)).outcome).toBe("started")
    const before = leftAsItWas(w)
    expect((await apply(w, 3)).json).toEqual({
      outcome: "refused",
      reason: "unsupported_version",
    })
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("the same through a session, and for an app a state from before marks at format 2 (its number 0)", async () => {
    const w = await world()
    olderState(w.home, { web: 0 })
    const before = leftAsItWas(w)
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 1,
    })
    const s = session(w.home, w.docker.path)
    expect(
      (
        await s.request({
          command: "apply",
          input: { rosters: w.rosters, deploy },
        })
      ).result
    ).toEqual({ outcome: "refused", reason: "unsupported_version" })
    expect((await s.close()).code).toBe(0)
    expect(leftAsItWas(w)).toEqual(before)
  })
})

describe("reading writes nothing, and today's answers keep their shape", () => {
  test("ST10: status and records on a state from before version 2 answer, and leave its bytes as they were", async () => {
    const w = await world()
    olderState(w.home, { web: 2 })
    const before = fileOf(w.home)
    const status = await runner(w.home, w.docker.path, "status")
    expect(status.json).toEqual({
      serverId: w.serverId,
      serverPublicKey: w.setup.json!.serverPublicKey,
      team: {
        teamId: w.trust.teamId,
        version: w.trust.version,
        hash: w.trust.hash,
      },
      lastSequence: { web: 2 },
      secrets: {},
    })
    expect(await recordsOf(w, "web")).toEqual({ statements: [] })
    expect(fileOf(w.home)).toBe(before)
  })

  test("FR-033: status after a version-2 deploy has exactly the keys of its schema, and no mark", async () => {
    const w = await world()
    expect((await deploy(w, 0)).outcome).toBe("started")
    const status = await runner(w.home, w.docker.path, "status")
    expect(Object.keys(status.json!).sort()).toEqual([
      "lastSequence",
      "secrets",
      "serverId",
      "serverPublicKey",
      "team",
    ])
    expect(Object.keys(status.json!.team as object).sort()).toEqual([
      "hash",
      "teamId",
      "version",
    ])
    expect(parseMessage(RunnerStatusSchema, status.json).ok).toBe(true)
    expect(status.json!.secrets).toEqual({
      "web/GREETING": { version: 1, removed: false },
    })
  })
})
