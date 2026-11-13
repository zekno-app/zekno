import { describe, expect, test } from "bun:test"

import {
  DEPLOY_REFUSALS,
  generateServerKeyPair,
  LIMITS,
  parseMessage,
  PendingDeploysResponseSchema,
  PublishDeployRequestSchema,
  PublishRosterRequestSchema,
  RegisterServerRequestSchema,
  RosterChainResponseSchema,
  StatusReportSchema,
  verifyDeploy,
  type StatusReport,
} from "../../src/index"
import { publish, setup } from "../helpers"

const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "accepted" : result.error!.code

describe("User Story 5: one description of every message", () => {
  test("a deploy travels client to control plane to agent using only the shared definitions", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    // Client to control plane.
    const upload = parseMessage(PublishDeployRequestSchema, JSON.stringify(deploy))
    expect(upload.ok).toBe(true)
    if (!upload.ok) return
    // Control plane to agent, as bytes.
    const body = new TextEncoder().encode(JSON.stringify({ deploys: [upload.value] }))
    const pending = parseMessage(PendingDeploysResponseSchema, body)
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    expect(verifyDeploy({ ...pending.value.deploys[0]!, state: server.state }).ok).toBe(true)
  })

  test("team lists and server registration round-trip", async () => {
    const { team } = await setup()
    expect(parseMessage(PublishRosterRequestSchema, JSON.stringify({ envelope: team.envelope })).ok).toBe(true)
    expect(parseMessage(RosterChainResponseSchema, { rosters: [team.envelope] }).ok).toBe(true)

    const server = generateServerKeyPair()
    const registration = { serverPublicKey: server.publicKey, serverId: server.serverId }
    expect(parseMessage(RegisterServerRequestSchema, registration)).toEqual({ ok: true, value: registration })

    // An id that is not the one derived from the key is rejected.
    const other = generateServerKeyPair()
    expect(code(parseMessage(RegisterServerRequestSchema, { ...registration, serverId: other.serverId }))).toBe("malformed")
  })

  test("unknown fields, missing fields and wrong types are rejected", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    const extraField = { ...deploy, note: "hello" }
    const nestedExtra = { ...deploy, envelope: { ...deploy.envelope, extra: true } }
    const missing = { envelope: deploy.envelope }
    const wrongType = { ...deploy, secrets: "none" }
    for (const message of [extraField, nestedExtra, missing, wrongType, null, 42, "text", []]) {
      expect(code(parseMessage(PublishDeployRequestSchema, message))).toBe("malformed")
    }
    expect(code(parseMessage(PublishDeployRequestSchema, "{not json"))).toBe("malformed")
    expect(code(parseMessage(PublishDeployRequestSchema, new Uint8Array([0xff, 0xfe])))).toBe("malformed")
  })

  test("an oversized message is rejected before its content is parsed", () => {
    const huge = `{"deploys":[${" ".repeat(2048)}]}`
    expect(code(parseMessage(PendingDeploysResponseSchema, huge, 1024))).toBe("too_large")
    expect(code(parseMessage(PendingDeploysResponseSchema, huge))).toBe("accepted")
    const tooMany = { deploys: new Array(LIMITS.pendingDeploys + 1).fill({}) }
    expect(code(parseMessage(PendingDeploysResponseSchema, tooMany))).toBe("malformed")
  })

  test("a status report carries metadata only", async () => {
    const { server, trust } = await setup()
    const report: StatusReport = {
      v: 1, teamId: trust.teamId, serverId: server.serverId, app: "web", sequence: 4,
      outcome: "refused", reason: "replayed", at: new Date().toISOString(),
    }
    expect(parseMessage(StatusReportSchema, report).ok).toBe(true)
    expect(parseMessage(StatusReportSchema, { ...report, outcome: "accepted", reason: undefined }).ok).toBe(true)

    // A reason is required for a refusal and forbidden otherwise.
    expect(code(parseMessage(StatusReportSchema, { ...report, reason: undefined }))).toBe("malformed")
    expect(code(parseMessage(StatusReportSchema, { ...report, outcome: "started" }))).toBe("malformed")
    // No field can carry log output, a message or a secret.
    for (const field of ["message", "log", "output", "error", "detail"]) {
      expect(code(parseMessage(StatusReportSchema, { ...report, [field]: "DATABASE_URL=postgres://..." }))).toBe("malformed")
    }
    expect(code(parseMessage(StatusReportSchema, { ...report, reason: "the database password is hunter2" }))).toBe("malformed")
    expect(code(parseMessage(StatusReportSchema, { ...report, v: 2 }))).toBe("malformed")
    // Every refusal an agent can produce is reportable.
    for (const reason of DEPLOY_REFUSALS) {
      expect(parseMessage(StatusReportSchema, { ...report, reason }).ok).toBe(true)
    }
  })

  test("a signed payload with an unknown format version is refused with that reason", async () => {
    const { founder, server, trust } = await setup()
    const { PAYLOAD_TYPES } = await import("../../src/index")
    const { signEnvelope } = await import("../../src/envelope")
    const future = { v: 2, teamId: trust.teamId, serverId: server.serverId, app: "web", sequence: 1, newField: true }
    const envelope = await signEnvelope(PAYLOAD_TYPES.deploy, new TextEncoder().encode(JSON.stringify(future)), founder.signer)
    expect(code(verifyDeploy({ envelope, secrets: [], state: server.state }))).toBe("unsupported_version")
  })
})
