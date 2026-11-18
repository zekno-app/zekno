/**
 * Helpers for the runner's tests of deploy version 2 (specs/014-deploy-v2):
 * an envelope of any kind signed the way the core library signs, a state as
 * runner 0.1.0 leaves it, the record files a runner keeps, and version-2
 * deploys built and sent the way a zekno of this feature sends them.
 */
import {
  createDeployV2,
  createSecret,
  createSecretRemoval,
  keyIdOf,
  parseRunnerState,
  type Envelope,
  type SecretRecord,
  type Signer,
  type TeamTrust,
} from "@workspace/core"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import { COMPOSE, filesUnder, session } from "./helpers"

const encoder = new TextEncoder()
const base64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url")

/**
 * Signs `payload` as `signer` the way the core library signs every message:
 * `zekno-sig-v1\n<kind>\n<length>\n` then the payload's bytes, with the
 * signature and the payload in base64url without padding and the signer's
 * key id. Neither the kind nor the content is checked, so a test can make a
 * genuine envelope the library would refuse to build, such as one with an
 * unknown field or `v: 3`. A string is signed as its UTF-8 bytes. The signer
 * must sign at once, as `createSigner`'s does.
 */
export function signPayload(
  kind: string,
  payload: string | Uint8Array,
  signer: Signer
): Envelope {
  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload
  const head = encoder.encode(`zekno-sig-v1\n${kind}\n${bytes.length}\n`)
  const input = new Uint8Array(head.length + bytes.length)
  input.set(head)
  input.set(bytes, head.length)
  const sig = signer.sign(input)
  if (!(sig instanceof Uint8Array))
    throw new Error(
      "signPayload takes a signer that signs at once, as createSigner's does."
    )
  return {
    payloadType: kind,
    payload: base64Url(bytes),
    signature: { keyId: keyIdOf(signer.publicKey), sig: base64Url(sig) },
  }
}

/**
 * Rewrites `state.json` in the runner's folder `home` the way runner 0.1.0
 * writes it: `{ serverId, team, lastSequence, secrets }` with no version mark
 * and no formats (research R2). The server, the team list and the secrets
 * stay as the file has them; `lastSequence` is the one given. Throws when the
 * result is not a state runner 0.1.0 reads, whose strict schema is today's
 * version-1 one.
 */
export function olderState(
  home: string,
  lastSequence: Record<string, number>
): void {
  const path = join(home, "state.json")
  const stored = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >
  const state = {
    serverId: stored.serverId,
    team: stored.team,
    lastSequence,
    secrets: stored.secrets,
  }
  parseRunnerState(state)
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 })
  chmodSync(path, 0o600)
}

/** A file under the runner's `records/` folder. */
export type RecordFile = {
  /** From the runner's folder: `records/<app>/<hash>.json`. */
  path: string
  content: string
  mode: number
}

/**
 * Every file under `records/` in the runner's folder `home`, sorted by path,
 * each with its content and mode: what a test compares before and after a
 * request. A file that is not a record, such as one left half-written, is
 * listed too, so a test sees it. Empty when there is no `records/` folder.
 */
export function recordFiles(home: string): RecordFile[] {
  return filesUnder(join(home, "records"))
    .map((file) => ({ ...file, path: relative(home, file.path) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** The value each deploy sets when a test names none, as `buildDeploy` does. */
export const GREETING = "hello from the test"

/**
 * Sets `values` for the app and signs a version-2 deploy made against
 * `previous` that lists them, with `statements` listed too (records the
 * runner already holds, not sent again) and `removals` removed. Each value is
 * a new record (`createSecret`) at `secretVersion`, by default the number this
 * deploy will have, as `buildDeploy` numbers its secrets. Gives the envelope
 * and the records it made; the test decides which records to send.
 */
export async function buildDeployV2(input: {
  trust: TeamTrust
  serverId: string
  signer: Signer
  previous: number
  app?: string
  compose?: string
  values?: Record<string, string>
  secretVersion?: number
  statements?: readonly Envelope[]
  removals?: readonly { name: string; version: number }[]
  expiresAt?: Date | null
  later?: Parameters<typeof createDeployV2>[0]["later"]
}): Promise<{ envelope: Envelope; records: SecretRecord[] }> {
  const { trust, serverId, signer } = input
  const app = input.app ?? "web"
  const records: SecretRecord[] = []
  for (const [name, value] of Object.entries(input.values ?? { GREETING })) {
    records.push(
      await createSecret({
        trust,
        serverId,
        app,
        name,
        value,
        version: input.secretVersion ?? input.previous + 1,
        signer,
      })
    )
  }
  const removals: Envelope[] = []
  for (const removal of input.removals ?? [])
    removals.push(
      await createSecretRemoval({ trust, serverId, app, ...removal, signer })
    )
  const envelope = await createDeployV2({
    trust,
    serverId,
    app,
    previous: input.previous,
    compose: input.compose ?? COMPOSE,
    statements: [
      ...records.map((record) => record.envelope),
      ...(input.statements ?? []),
    ],
    removals,
    expiresAt: input.expiresAt ?? null,
    later: input.later,
    signer,
  })
  return { envelope, records }
}

/** The runner's folder and the stand-in Docker, as `world()` gives them. */
type Place = { home: string; docker: { path: string } }

/**
 * Sends one `deploy` request on a session of its own, the way a zekno of this
 * feature does, and gives its events and its result once the session closed.
 * `input` is sent as given, so a test can send what no zekno would.
 */
export async function deployV2(
  w: Place,
  input: unknown,
  options: { env?: Record<string, string> } = {}
): Promise<{
  events: Record<string, unknown>[]
  result: Record<string, unknown>
}> {
  const s = session(w.home, w.docker.path, options.env)
  const answer = await s.request({ command: "deploy", input })
  await s.close()
  return answer
}

/** Asks the runner for the statements it holds for `app` (`records`), on a session of its own. */
export async function recordsOf(
  w: Place,
  app: string
): Promise<Record<string, unknown>> {
  const s = session(w.home, w.docker.path)
  const { result } = await s.request({ command: "records", input: { app } })
  await s.close()
  return result
}

/** The payload of an envelope, parsed, for a test to read or to change and sign again. */
export function payloadOf(envelope: Envelope): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8")
  ) as Record<string, unknown>
}

/** The ciphertext hash a secret record's statement names: the name of its file on the runner. */
export const hashOf = (record: SecretRecord): string =>
  payloadOf(record.envelope).hash as string

/**
 * What a refused request must leave exactly as it was (contracts/
 * runner-checks.md, "What a refusal leaves"): the bytes of `state.json`,
 * every file under `apps/` (each app's Compose file), every file under
 * `records/`, and the calls of the stand-in Docker. Compare two with
 * `toEqual`.
 */
export function leftAsItWas(w: {
  home: string
  docker: { calls: () => unknown[] }
}) {
  const state = join(w.home, "state.json")
  return {
    state: existsSync(state) ? readFileSync(state, "utf8") : undefined,
    apps: filesUnder(join(w.home, "apps")),
    records: recordFiles(w.home),
    calls: w.docker.calls(),
  }
}
