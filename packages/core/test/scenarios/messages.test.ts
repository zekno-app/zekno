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
  test("a deploy travels client to control plane to runner using only the shared definitions", async () => {
    const { founder, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    // Client to control plane.
    const upload = parseMessage(PublishDeployRequestSchema, JSON.stringify(deploy))
    expect(upload.ok).toBe(true)
    if (!upload.ok) return
    // Control plane to runner, as bytes.
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
    // Every refusal a runner can produce is reportable.
    for (const reason of DEPLOY_REFUSALS) {
      expect(parseMessage(StatusReportSchema, { ...report, reason }).ok).toBe(true)
    }
  })

  test("the messages between the CLI and the runner round-trip and reject anything else", async () => {
    const core = await import("../../src/index")
    const { founder, team, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    expect(parseMessage(core.RunnerSetupRequestSchema, JSON.stringify({ founding: team.envelope, teamCode: team.confirmationCode })).ok).toBe(true)
    const answer = { serverPublicKey: server.publicKey, serverId: server.serverId, code: core.serverConfirmationCode(server.publicKey) }
    expect(parseMessage(core.RunnerSetupResponseSchema, answer).ok).toBe(true)
    // An id that does not belong to the key is rejected.
    expect(code(parseMessage(core.RunnerSetupResponseSchema, { ...answer, serverId: `srv_${"0".repeat(32)}` }))).toBe("malformed")
    expect(parseMessage(core.RunnerSyncRequestSchema, { rosters: relay.rosters }).ok).toBe(true)
    expect(parseMessage(core.RunnerApplyRequestSchema, JSON.stringify({ rosters: relay.rosters, deploy })).ok).toBe(true)
    expect(code(parseMessage(core.RunnerApplyRequestSchema, { rosters: relay.rosters }))).toBe("malformed")

    // A report says what happened and, only for a refusal, why. No free text.
    for (const report of [{ outcome: "ok" }, { outcome: "started", app: "web", sequence: 1 }, { outcome: "start_failed", app: "web", sequence: 1 }, { outcome: "refused", reason: "replayed" }, { outcome: "refused", reason: "busy" }, { outcome: "refused", reason: "code_mismatch" }]) {
      expect(parseMessage(core.RunnerReportSchema, report).ok).toBe(true)
    }
    for (const report of [{ outcome: "refused" }, { outcome: "started", reason: "replayed" }, { outcome: "refused", reason: "something else" }, { outcome: "started", message: "DATABASE_URL=..." }, { outcome: "done" }]) {
      expect(code(parseMessage(core.RunnerReportSchema, report))).toBe("malformed")
    }
    const status = {
      serverId: server.serverId, serverPublicKey: server.publicKey,
      team: { teamId: trust.teamId, version: trust.version, hash: trust.hash },
      lastSequence: { web: 1 }, secrets: { "web/DATABASE_URL": { version: 1, removed: false } },
    }
    expect(parseMessage(core.RunnerStatusSchema, status).ok).toBe(true)
    expect(code(parseMessage(core.RunnerStatusSchema, { ...status, secrets: { "web/DATABASE_URL": { version: 1, removed: false, value: "x" } } }))).toBe("malformed")
  })

  test("session messages: requests, frames, state and logs", async () => {
    const core = await import("../../src/index")
    expect(parseMessage(core.RunnerVersionSchema, { version: "0.1.0", protocol: core.RUNNER_PROTOCOL }).ok).toBe(true)
    expect(code(parseMessage(core.RunnerVersionSchema, { version: "0.1", protocol: 2 }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerVersionSchema, { version: "0.1.0; rm -rf /", protocol: 2 }))).toBe("malformed")

    for (const command of core.SESSION_COMMANDS) expect(parseMessage(core.SessionRequestSchema, { command }).ok).toBe(true)
    expect(parseMessage(core.SessionRequestSchema, JSON.stringify({ command: "logs", input: { app: "web", tail: 10 } })).ok).toBe(true)
    expect(code(parseMessage(core.SessionRequestSchema, { command: "exec" }))).toBe("malformed")
    expect(code(parseMessage(core.SessionRequestSchema, { command: "status", extra: 1 }))).toBe("malformed")

    // A frame is an event or a result, never both and nothing else.
    expect(parseMessage(core.SessionFrameSchema, { event: "progress", line: " Container web-1  Started" }).ok).toBe(true)
    expect(parseMessage(core.SessionFrameSchema, { event: "log", service: "web", time: "2026-11-13T16:56:04.136118801Z", line: "started" }).ok).toBe(true)
    expect(parseMessage(core.SessionFrameSchema, { result: { outcome: "ok" } }).ok).toBe(true)
    expect(code(parseMessage(core.SessionFrameSchema, { event: "progress", line: "x".repeat(4097) }))).toBe("malformed")
    expect(code(parseMessage(core.SessionFrameSchema, { event: "log", service: "web", time: "yesterday", line: "x" }))).toBe("malformed")
    expect(code(parseMessage(core.SessionFrameSchema, { event: "log", service: "we b", time: "2026-11-13T16:56:04Z", line: "x" }))).toBe("malformed")
    expect(code(parseMessage(core.SessionFrameSchema, { event: "shell", line: "x" }))).toBe("malformed")
    expect(code(parseMessage(core.SessionFrameSchema, { event: "progress", line: "x", result: {} }))).toBe("malformed")

    const states = { apps: { web: { services: [{ service: "web", state: "running", exitCode: 0, health: "" }, { service: "worker", state: "exited", exitCode: 3, health: "" }] } } }
    expect(parseMessage(core.RunnerAppStatesSchema, states).ok).toBe(true)
    expect(code(parseMessage(core.RunnerAppStatesSchema, { apps: { web: { services: [{ service: "web", state: "running", exitCode: 0, health: "", labels: "com.docker…" }] } } }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerAppStatesSchema, { apps: { "../etc": { services: [] } } }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerAppStatesSchema, { apps: { web: { services: [{ service: "web", state: "on fire", exitCode: 0, health: "" }] } } }))).toBe("malformed")

    expect(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 200 }).ok).toBe(true)
    expect(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 200, follow: false }).ok).toBe(true)
    expect(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 200, follow: true }).ok).toBe(true)
    expect(code(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 200, follow: "false" }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 200, follow: 0 }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 200, since: "1h" }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerLogsRequestSchema, { app: "web", tail: 100000 }))).toBe("malformed")
    expect(code(parseMessage(core.RunnerLogsRequestSchema, { app: "web; cat /etc/passwd", tail: 1 }))).toBe("malformed")
  })

  test("a runner's answers have bounds: apps, secrets and services, and the longest frame of each request", async () => {
    const core = await import("../../src/index")
    const { server, trust } = await setup()
    const name = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, "0")}`.padEnd(63, "x")
    const apps = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, n) => [name("a", n), Number.MAX_SAFE_INTEGER]))
    const secrets = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, n) => [`${name("a", n % 1024)}/${name("S", n).padEnd(128, "_")}`, { version: Number.MAX_SAFE_INTEGER, removed: false }]))
    const status = (lastSequence: object, held: object) => ({
      serverId: server.serverId,
      serverPublicKey: server.publicKey,
      team: { teamId: trust.teamId, version: Number.MAX_SAFE_INTEGER, hash: trust.hash },
      lastSequence,
      secrets: held,
    })
    // The most a runner holds is accepted; one more app or secret is not a runner's answer.
    const largest = status(apps(LIMITS.appsPerServer), secrets(LIMITS.secretsPerServer))
    expect(parseMessage(core.RunnerStatusSchema, largest).ok).toBe(true)
    expect(code(parseMessage(core.RunnerStatusSchema, status(apps(LIMITS.appsPerServer + 1), {})))).toBe("malformed")
    expect(code(parseMessage(core.RunnerStatusSchema, status({}, secrets(LIMITS.secretsPerServer + 1))))).toBe("malformed")
    expect(code(parseMessage(core.RunnerStatusSchema, status({}, { [`web/${"A".repeat(129)}`]: { version: 1, removed: false } })))).toBe("malformed")

    const service = (n: number) => ({ service: name("s", n), state: "restarting", exitCode: 255, health: "unhealthy" })
    const states = (count: number, each: number) =>
      ({ apps: Object.fromEntries(Array.from({ length: count }, (_, n) => [name("a", n), { services: Array.from({ length: each }, (_, s) => service(s)) }])) })
    const fullest = states(LIMITS.appsPerServer, LIMITS.servicesPerServer / LIMITS.appsPerServer)
    expect(parseMessage(core.RunnerAppStatesSchema, fullest).ok).toBe(true)
    expect(code(parseMessage(core.RunnerAppStatesSchema, states(LIMITS.appsPerServer + 1, 0)))).toBe("malformed")
    expect(code(parseMessage(core.RunnerAppStatesSchema, states(LIMITS.servicesPerServer / LIMITS.servicesPerApp + 1, LIMITS.servicesPerApp)))).toBe("malformed")

    // The longest frame each request can bring, written out, is at most two thirds of its limit, and every limit is far below a message's.
    const written = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
    const wide = "\u0001".repeat(16384)
    const longest = {
      version: written({ result: { version: "1000.1000.1000", protocol: 1_000_000 } }),
      status: written({ result: largest }),
      state: written({ result: fullest }),
      apply: written({ event: "progress", line: wide.slice(0, 4096) }),
      logs: written({ event: "log", service: "s".repeat(63), time: "2026-11-14T21:52:03.123456789+00:00", line: wide }),
    } as const
    for (const [command, bytes] of Object.entries(longest)) {
      expect(bytes * 1.5).toBeLessThan(core.SESSION_FRAME_BYTES[command as keyof typeof longest])
    }
    for (const limit of Object.values(core.SESSION_FRAME_BYTES)) expect(limit).toBeLessThanOrEqual(LIMITS.messageBytes / 8)
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
