/**
 * Helpers for the runner's tests of deploy version 2 (specs/014-deploy-v2):
 * an envelope of any kind signed the way the core library signs, a state as
 * runner 0.1.0 leaves it, and the record files a runner keeps.
 */
import {
  keyIdOf,
  parseRunnerState,
  type Envelope,
  type Signer,
} from "@workspace/core"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import { filesUnder } from "./helpers"

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
