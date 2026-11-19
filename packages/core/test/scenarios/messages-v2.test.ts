/**
 * The session messages of feature 014 (contracts/protocol.md P2 to P8), and
 * the public names of the core library's version 2 (T019). The messages of
 * today are in messages.test.ts, which is past 500 lines and not made longer.
 */
import { describe, expect, test } from "bun:test"

import * as core from "../../src/index"
import type {
  Build,
  DeployV2,
  DeployV2Refusal,
  Health,
  Predeploy,
  Route,
  RunnerDeployRequest,
  RunnerRecords,
  StoredRunnerState,
  VerifiedDeployV2,
} from "../../src/index"
import { setSecret } from "../support/helpers"
import { deployV2, world } from "../support/deploy-v2"

const {
  DEPLOY_REFUSALS,
  DEPLOY_V2_REFUSALS,
  LIMITS,
  parseMessage,
  RunnerReportSchema,
  SESSION_COMMANDS,
  SESSION_FRAME_BYTES,
  StatusReportSchema,
} = core

const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "accepted" : result.error!.code

/** Bytes of a value written out as one JSON line. */
const written = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length

describe("P3: the deploy request", () => {
  test("reads its example and refuses anything else", async () => {
    const w = await world()
    const { envelope, records } = await deployV2(w, { values: { A: "a" } })
    const request = { rosters: w.relay.rosters, envelope, records }
    expect(
      parseMessage(core.RunnerDeployRequestSchema, JSON.stringify(request)).ok
    ).toBe(true)
    const { records: _records, ...missing } = request
    for (const message of [
      { ...request, deploy: envelope },
      { ...request, envelope: { ...envelope, extra: true } },
      missing,
      { ...request, records: "none" },
      { ...request, envelope: "x" },
      { ...request, records: [{ envelope: records[0]!.envelope }] },
      {
        ...request,
        records: new Array(LIMITS.secretsPerDeploy + 1).fill(records[0]),
      },
      { ...request, rosters: new Array(LIMITS.rosterChain + 1).fill(envelope) },
    ])
      expect(code(parseMessage(core.RunnerDeployRequestSchema, message))).toBe(
        "malformed"
      )
    expect(
      parseMessage(core.RunnerDeployRequestSchema, {
        ...request,
        records: new Array(LIMITS.secretsPerDeploy).fill(records[0]),
      }).ok
    ).toBe(true)
  })
})

describe("P5, P6: the records request and its answer", () => {
  test("the request names one app and nothing else", () => {
    expect(
      parseMessage(core.RunnerRecordsRequestSchema, { app: "web" }).ok
    ).toBe(true)
    for (const message of [
      { app: "web", hash: "a".repeat(64) },
      {},
      { app: 1 },
      { app: "../etc" },
      { app: "Web" },
      null,
    ])
      expect(code(parseMessage(core.RunnerRecordsRequestSchema, message))).toBe(
        "malformed"
      )
  })

  test("the answer is statements only, at most 256", async () => {
    const w = await world()
    const record = await setSecret({
      relay: w.relay,
      trust: w.trust,
      server: w.server,
      signer: w.founder.signer,
      name: "A",
      value: "a",
    })
    const answer = { statements: [record.envelope] }
    expect(
      parseMessage(core.RunnerRecordsSchema, JSON.stringify(answer)).ok
    ).toBe(true)
    expect(parseMessage(core.RunnerRecordsSchema, { statements: [] }).ok).toBe(
      true
    )
    for (const message of [
      { ...answer, sealed: [record.sealed] },
      { statements: [record] },
      {},
      { statements: "none" },
      {
        statements: new Array(LIMITS.secretsPerDeploy + 1).fill(
          record.envelope
        ),
      },
    ])
      expect(code(parseMessage(core.RunnerRecordsSchema, message))).toBe(
        "malformed"
      )
    expect(
      parseMessage(core.RunnerRecordsSchema, {
        statements: new Array(LIMITS.secretsPerDeploy).fill(record.envelope),
      }).ok
    ).toBe(true)
  })
})

describe("P2: the session's commands and the bound of each answer", () => {
  test("deploy and records come after version, and a session request names them", () => {
    // Feature 015 adds `proxy` after them (specs/015-domains-https, contracts/core.md).
    expect(SESSION_COMMANDS.slice(-4)).toEqual([
      "version",
      "deploy",
      "records",
      "proxy",
    ])
    for (const command of ["deploy", "records"])
      expect(parseMessage(core.SessionRequestSchema, { command }).ok).toBe(true)
  })

  test("the longest answer each new command can bring fits its bound, with room to spare", async () => {
    const w = await world()
    // The longest statement a runner holds: a name of 128 characters, an app of 63, the highest version.
    const longest = await setSecret({
      relay: w.relay,
      trust: w.trust,
      server: w.server,
      signer: w.founder.signer,
      app: "a".repeat(63),
      name: "S".repeat(LIMITS.secretNameLength),
      value: "x",
      version: Number.MAX_SAFE_INTEGER,
    })
    const records = {
      result: {
        statements: new Array(LIMITS.secretsPerDeploy).fill(longest.envelope),
      },
    }
    expect(parseMessage(core.RunnerRecordsSchema, records.result).ok).toBe(true)
    const wide = "\u0001".repeat(4096)
    const deploy = Math.max(
      written({ event: "progress", line: wide }),
      written({
        result: {
          outcome: "refused",
          reason: "untrusted_secret",
          app: "a".repeat(63),
          sequence: Number.MAX_SAFE_INTEGER,
        },
      })
    )
    expect(deploy * 1.5).toBeLessThan(SESSION_FRAME_BYTES.deploy)
    expect(written(records) * 1.5).toBeLessThan(SESSION_FRAME_BYTES.records)
    expect(SESSION_FRAME_BYTES.deploy).toBe(SESSION_FRAME_BYTES.apply)
    for (const limit of Object.values(SESSION_FRAME_BYTES))
      expect(limit).toBeLessThanOrEqual(LIMITS.messageBytes / 8)
  })

  test("P1: this library speaks protocol 4 since feature 015 (it was 3)", () => {
    expect(core.RUNNER_PROTOCOL).toBe(4)
  })
})

describe("P8: the reasons only version 2 has", () => {
  test("a runner's report takes them, and only with refused", () => {
    for (const reason of DEPLOY_V2_REFUSALS) {
      expect(
        parseMessage(RunnerReportSchema, { outcome: "refused", reason }).ok
      ).toBe(true)
      expect(
        code(
          parseMessage(RunnerReportSchema, {
            outcome: "started",
            app: "web",
            sequence: 1,
            reason,
          })
        )
      ).toBe("malformed")
    }
    expect(DEPLOY_V2_REFUSALS).toEqual([
      "secret_missing",
      "untrusted_secret",
      "expired",
      // Feature 015, K10b (specs/015-domains-https, contracts/core.md).
      "domain_taken",
    ])
    // None of them is a version-1 reason.
    for (const reason of DEPLOY_V2_REFUSALS)
      expect(DEPLOY_REFUSALS as readonly string[]).not.toContain(reason)
  })

  test("the hosted service's report does not take them", async () => {
    const w = await world()
    const report = {
      v: 1,
      teamId: w.trust.teamId,
      serverId: w.server.serverId,
      app: "web",
      sequence: 4,
      outcome: "refused",
      reason: "replayed",
      at: new Date(0).toISOString(),
    }
    expect(parseMessage(StatusReportSchema, report).ok).toBe(true)
    for (const reason of DEPLOY_V2_REFUSALS)
      expect(
        code(parseMessage(StatusReportSchema, { ...report, reason }))
      ).toBe("malformed")
  })
})

describe("T019: the public names of version 2", () => {
  test("every value is exported from the library's one entry point", () => {
    for (const name of [
      "createDeployV2",
      "readSignedDeployV2",
      "verifyDeployV2",
      "readDeployV2Payload",
      "buildKey",
      "readRunnerState",
      "newRunnerState",
      "versionOneView",
      "afterVersionOneDeploy",
      "takesVersionOne",
      "verifySecretStatement",
      "peekSecretStatement",
      "secretsForDeploy",
      "DEPLOY_V2_REFUSALS",
      "RunnerDeployRequestSchema",
      "RunnerRecordsRequestSchema",
      "RunnerRecordsSchema",
    ])
      expect([
        name,
        typeof (core as Record<string, unknown>)[name],
      ]).not.toEqual([name, "undefined"])
  })

  test("every type is exported too", () => {
    // Checked by the type checker: each name must resolve.
    type Exported = [
      DeployV2,
      VerifiedDeployV2,
      Build,
      Predeploy,
      Health,
      Route,
      StoredRunnerState,
      DeployV2Refusal,
      RunnerDeployRequest,
      RunnerRecords,
    ]
    const count: Exported["length"] = 10
    expect(count).toBe(10)
  })
})
