/**
 * Signed version-2 deploys and a runner's stored state, for the tests of
 * `createDeployV2`, `readSignedDeployV2` and `verifyDeployV2`.
 */
import { createDeployV2, verifyDeployV2 } from "../../src/deploy/deploy-v2"
import { newRunnerState, type StoredRunnerState } from "../../src/deploy/state"
import {
  PAYLOAD_TYPES,
  signEnvelope,
  type Envelope,
  type PayloadType,
} from "../../src/crypto/envelope"
import type { Signer } from "../../src/crypto/keys"
import type { SecretRecord } from "../../src/secrets/secret-record"
import { COMPOSE, setSecret, setup } from "./helpers"
import { composeFor } from "./payload-v2"

/** The runner's clock in every test that does not set its own. */
export const NOW = new Date("2026-11-20T10:00:00.000Z")

/** A team with one admin and one server, the server's state as a runner of this feature sets it up. */
export async function world() {
  const base = await setup()
  const state = newRunnerState({
    serverId: base.server.serverId,
    team: base.server.state.team,
  })
  return { ...base, state }
}
export type World = Awaited<ReturnType<typeof world>>

/** The payload of an envelope, parsed, for a test to change and sign again. */
export function payloadOf(envelope: Envelope): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8")
  ) as Record<string, unknown>
}

/** Signs any payload as `kind`, as a careless or hostile member could. */
export function signAs(
  kind: PayloadType,
  payload: unknown,
  signer: Signer
): Promise<Envelope> {
  return signEnvelope(
    kind,
    new TextEncoder().encode(JSON.stringify(payload)),
    signer
  )
}

/** A version-2 envelope of this payload, signed by `signer`. */
export const signV2 = (payload: unknown, signer: Signer) =>
  signAs(PAYLOAD_TYPES.deployV2, payload, signer)

/**
 * Sets `values` for the app (each at `version`) and signs a deploy made
 * against `previous` that lists them, with `statements` and `removals` too,
 * and the `routes`, `health`, `builds` and `later` fields given. With builds,
 * the Compose text runs each build's image, as zekno writes it (CO2), unless
 * `compose` is given.
 */
export async function deployV2(
  w: World,
  input: {
    previous?: number
    app?: string
    values?: Record<string, string>
    version?: number
    statements?: readonly Envelope[]
    removals?: readonly Envelope[]
    expiresAt?: Date | null
    compose?: string
    routes?: Parameters<typeof createDeployV2>[0]["routes"]
    health?: Parameters<typeof createDeployV2>[0]["health"]
    builds?: Parameters<typeof createDeployV2>[0]["builds"]
    later?: Parameters<typeof createDeployV2>[0]["later"]
  } = {}
): Promise<{ envelope: Envelope; records: SecretRecord[] }> {
  const app = input.app ?? "web"
  const records: SecretRecord[] = []
  for (const [name, value] of Object.entries(input.values ?? {}))
    records.push(
      await setSecret({
        relay: w.relay,
        trust: w.trust,
        server: w.server,
        signer: w.founder.signer,
        name,
        value,
        app,
        version: input.version ?? 1,
      })
    )
  const envelope = await createDeployV2({
    trust: w.trust,
    serverId: w.server.serverId,
    app,
    previous: input.previous ?? 0,
    compose:
      input.compose ??
      (input.builds?.length ? composeFor(app, input.builds) : COMPOSE),
    statements: [
      ...records.map((record) => record.envelope),
      ...(input.statements ?? []),
    ],
    removals: input.removals ?? [],
    expiresAt: input.expiresAt ?? null,
    routes: input.routes,
    health: input.health,
    builds: input.builds,
    later: input.later,
    signer: w.founder.signer,
    now: NOW,
  })
  return { envelope, records }
}

/** Held records by app and hash, as a runner's `records/<app>/<hash>.json`. */
export type Held = Map<string, unknown>

export const holding = (records: readonly SecretRecord[], app = "web"): Held =>
  new Map(
    records.map((record) => [
      `${app}/${payloadOf(record.envelope).hash as string}`,
      record,
    ])
  )

/** `verifyDeployV2` with this world's state and the clock `NOW`, unless the test says otherwise. */
export function verify(
  w: World,
  envelope: unknown,
  options: {
    records?: unknown
    held?: Held
    state?: StoredRunnerState
    now?: Date
    via?: "session" | "hosted service"
  } = {}
) {
  const held = options.held ?? new Map()
  return verifyDeployV2({
    envelope,
    records: options.records ?? [],
    held: (app, hash) => held.get(`${app}/${hash}`),
    state: options.state ?? w.state,
    now: options.now ?? NOW,
    via: options.via ?? "session",
  })
}

/** What a result says: the reason it was refused for, or "accepted". */
export const reason = (result: {
  ok: boolean
  error?: { code: string }
}): string => (result.ok ? "accepted" : result.error!.code)

/** Freezes a value and everything in it, so a test sees any change. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
