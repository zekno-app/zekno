import { afterAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  confirmationCodesMatch,
  createDeploy,
  createSecret,
  createTeam,
  parseMessage,
  proposeRoster,
  PublishDeployRequestSchema,
  RegisterServerRequestSchema,
  serverConfirmationCode,
  StatusReportSchema,
  type PublishDeployRequest,
  type RegisterServerRequest,
  type RosterChainResponse,
  type StatusReport,
} from "../../src/index"
import { COMPOSE, overTheWire, person, SAMPLE_SECRETS } from "../support/helpers"

/**
 * End to end across real boundaries: the client is this process, the runner
 * is a separate process, and everything between them crosses an HTTP relay
 * as JSON. The relay here is also the attacker.
 */
const runnerScript = join(import.meta.dir, "../fixtures/runner.ts")

function startRelay(chain: RosterChainResponse) {
  const rosters = chain
  const stored = {
    servers: [] as RegisterServerRequest[],
    uploads: [] as PublishDeployRequest[],
    queue: [] as PublishDeployRequest[],
    status: [] as StatusReport[],
    refusals: [] as string[],
    rejected: 0,
  }
  const accept = async <T>(request: Request, schema: Parameters<typeof parseMessage>[0], into: T[]) => {
    const parsed = parseMessage(schema, await request.text())
    if (!parsed.ok) {
      stored.rejected += 1
      return new Response(parsed.error.code, { status: 400 })
    }
    into.push(parsed.value as T)
    return new Response("ok")
  }
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (request.method === "GET" && pathname === "/rosters") return Response.json(rosters)
      if (request.method === "GET" && pathname === "/deploys") {
        return Response.json({ deploys: stored.queue.splice(0) })
      }
      if (request.method === "POST" && pathname === "/servers") return accept(request, RegisterServerRequestSchema, stored.servers)
      if (request.method === "POST" && pathname === "/status") return accept(request, StatusReportSchema, stored.status)
      if (request.method === "POST" && pathname === "/refusals") {
        stored.refusals.push(((await request.json()) as { reason: string }).reason)
        return new Response("ok")
      }
      return new Response("not found", { status: 404 })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stored, rosters, stop: () => server.stop(true) }
}

/** Reads the runner's standard output as one JSON value per line. */
function lines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  return async function next(): Promise<Record<string, unknown>> {
    for (;;) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        return JSON.parse(line) as Record<string, unknown>
      }
      const { value, done } = await reader.read()
      if (done) throw new Error(`the runner exited early; remaining output: ${buffer}`)
      buffer += decoder.decode(value, { stream: true })
    }
  }
}

const cleanup: (() => void)[] = []
afterAll(() => cleanup.forEach((stop) => stop()))

describe("across processes and a real HTTP relay", () => {
  test("pair a server, deploy, then survive a replay, a swap and a forgery", async () => {
    // The developer's machine.
    const ada = person("Ada")
    const team = await createTeam({ founderName: "Ada", signer: ada.signer })
    const relay = startRelay({ rosters: [team.envelope] })
    cleanup.push(relay.stop)

    // The server: a separate process. A person typed the team's code on it.
    const runner = Bun.spawn(["bun", runnerScript], {
      env: { ...process.env, RELAY_URL: relay.url, CONFIRMED_CODE: team.confirmationCode, EXPECTED: "5" },
      stdout: "pipe",
      stderr: "inherit",
    })
    cleanup.push(() => runner.kill())
    const next = lines(runner.stdout)

    // Pairing: the key arrives through the relay, the code out of band.
    const registered = await next()
    expect(registered.type).toBe("registered")
    expect(relay.stored.servers).toHaveLength(1)
    const serverKey = relay.stored.servers[0]!.serverPublicKey
    expect(confirmationCodesMatch(serverConfirmationCode(serverKey), String(registered.code))).toBe(true)
    expect(await next()).toMatchObject({ type: "paired", team: team.trust.teamId })

    // The codes matched, so the admin adds the server to the team list. The runner picks it up.
    const serverId = relay.stored.servers[0]!.serverId
    const added = await proposeRoster({ trust: team.trust, servers: [{ name: "prod-1", publicKey: serverKey }], signer: ada.signer })
    relay.rosters.rosters.push(added.envelope)
    const trust = added.trust

    const build = async (sequence: number, values: Record<string, string>, compose = COMPOSE) => {
      const secrets = await Promise.all(
        Object.entries(values).map(([name, value]) =>
          createSecret({ trust, serverId, app: "web", name, value, version: sequence, signer: ada.signer })
        )
      )
      return createDeploy({ trust, serverId, app: "web", sequence, compose, secrets, signer: ada.signer })
    }
    // The client hands the relay a deploy; the relay stores it and queues it for the runner.
    const upload = (deploy: PublishDeployRequest) => {
      relay.stored.uploads.push(overTheWire(deploy))
      relay.stored.queue.push(overTheWire(deploy))
    }

    // 1. A genuine deploy is accepted and the secrets arrive intact.
    const first = await build(1, SAMPLE_SECRETS)
    upload(first)
    expect(await next()).toEqual({ type: "deploy", outcome: "accepted", sequence: 1, signer: "Ada", compose: COMPOSE, secrets: { ...SAMPLE_SECRETS } })

    // 2. The relay sends the same genuine deploy again.
    relay.stored.queue.push(overTheWire(first))
    expect(await next()).toEqual({ type: "deploy", outcome: "refused", reason: "replayed" })

    // 3. The relay exchanges two encrypted values in a new genuine deploy.
    const second = await build(2, SAMPLE_SECRETS, "services:\n  web:\n    image: example/web:2\n")
    const swapped = overTheWire(second)
    const [a, b] = [swapped.secrets[0]!, swapped.secrets[2]!]
    ;[a.ciphertext, b.ciphertext] = [b.ciphertext, a.ciphertext]
    relay.stored.queue.push(swapped)
    expect(await next()).toEqual({ type: "deploy", outcome: "refused", reason: "secrets_mismatch" })

    // 4. The relay signs its own deploy with its own key.
    const mallory = person("Mallory")
    const forgedTeam = { ...trust, members: [{ name: "Mallory", publicKey: mallory.publicKey, role: "admin" as const }] }
    const forged = await createDeploy({ trust: forgedTeam, serverId, app: "web", sequence: 9, compose: "services:\n  miner:\n    image: example/miner\n", secrets: [], signer: mallory.signer })
    relay.stored.queue.push(overTheWire(forged))
    expect(await next()).toEqual({ type: "deploy", outcome: "refused", reason: "unknown_signer" })

    // 5. The untouched second deploy still goes through afterwards.
    upload(second)
    expect(await next()).toMatchObject({ type: "deploy", outcome: "accepted", sequence: 2, secrets: { ...SAMPLE_SECRETS } })
    expect(await runner.exited).toBe(0)

    // What the relay ends up holding.
    expect(relay.stored.status.map((report) => [report.sequence, report.outcome])).toEqual([[1, "accepted"], [2, "accepted"]])
    expect(relay.stored.refusals).toEqual(["replayed", "secrets_mismatch", "unknown_signer"])
    expect(relay.stored.rejected).toBe(0)
    const everything = JSON.stringify(relay.stored)
    for (const value of Object.values(SAMPLE_SECRETS)) expect(everything).not.toContain(value)
    for (const upload of relay.stored.uploads) expect(parseMessage(PublishDeployRequestSchema, upload).ok).toBe(true)
  }, 30_000)

  test("a runner given the wrong confirmation code refuses to pair", async () => {
    const ada = person("Ada")
    const mallory = person("Mallory")
    const genuine = await createTeam({ founderName: "Ada", signer: ada.signer })
    const substituted = await createTeam({ founderName: "Ada", signer: mallory.signer })
    // The relay serves its own founding list; the person typed the genuine code.
    const relay = startRelay({ rosters: [substituted.envelope] })
    cleanup.push(relay.stop)

    const runner = Bun.spawn(["bun", runnerScript], {
      env: { ...process.env, RELAY_URL: relay.url, CONFIRMED_CODE: genuine.confirmationCode, EXPECTED: "1" },
      stdout: "pipe",
      stderr: "inherit",
    })
    cleanup.push(() => runner.kill())
    const next = lines(runner.stdout)
    expect((await next()).type).toBe("registered")
    expect(await next()).toEqual({ type: "pairing-refused", reason: "code_mismatch" })
    expect(await runner.exited).toBe(2)
  }, 30_000)
})
