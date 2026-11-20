/**
 * `deploy`: a signed deploy of version 2, in a session only (specs/
 * 014-deploy-v2; contracts/runner-checks.md, K1 to K17, in that order). A
 * deploy runs only when it was made against the app's last number here, so a
 * deploy that was overtaken can never run. Every check comes before the
 * number is used, and a refusal changes nothing but the team lists the
 * request carried. Nothing is decrypted before every check has passed, and
 * nothing decrypted is ever written.
 *
 * Since feature 015 (specs/015-domains-https, contracts/runner.md), the
 * deploy's routes and health check are carried out once `docker compose up`
 * has returned, under the same lock: the routes are put in force (RN4 to
 * RN10), then the wait for health (RN11), and the outcome is the first of
 * `start_failed`, `routes_failed`, `unhealthy` and `started` that holds
 * (RN12). A deploy of an app with no route and no health check, that held
 * none, makes exactly the calls it made before when no released domain's
 * certificate is still to delete (RN3).
 */
import {
  domainsAfter,
  healthBytesAfter,
  LIMITS,
  openSecrets,
  parseMessage,
  RunnerDeployRequestSchema,
  verifyDeployV2,
  type RunnerReport,
  type SecretRecord,
  type VerifiedDeployV2,
} from "@workspace/core"

import { waitHealthy } from "../health/wait"
import { writeState } from "../home/home"
import {
  readRecord,
  recordFilesOf,
  recordText,
  removeUnnamed,
  writeRecord,
} from "../home/records"
import { putRoutesInForce } from "../routes/apply"
import { retryReleased } from "../routes/released"
import {
  composeStart,
  follow,
  isReport,
  load,
  locked,
  refused,
  withinLimits,
} from "./commands"

/** The ciphertext hash the signed listing names for a supplied record: the name of its file. */
const listedHash = (verified: VerifiedDeployV2, record: SecretRecord) =>
  verified.deploy.secrets.find((secret) => secret.name === record.sealed.name)!
    .hash

/**
 * K15's part on disk: after the deploy, the runner keeps at most 8,192 live
 * records and 64 MiB of record files (FR-025). Counted over the files the
 * next state names: the records this deploy supplies by the bytes they will
 * take, every other by its size on disk now.
 */
function recordsFit(dir: string, verified: VerifiedDeployV2): boolean {
  const { app } = verified.deploy
  const supplied = new Map(
    verified.write.map((record) => [
      listedHash(verified, record),
      Buffer.byteLength(recordText(record)),
    ])
  )
  let files = 0
  let bytes = 0
  const kept: { app: string; hash: string }[] = []
  for (const [key, entry] of Object.entries(verified.nextState.secrets)) {
    if (entry.hash === null) continue
    const owner = key.slice(0, key.indexOf("/"))
    const size = owner === app ? supplied.get(entry.hash) : undefined
    if (size === undefined) kept.push({ app: owner, hash: entry.hash })
    else {
      files += 1
      bytes += size
      // Written once, however many entries name it.
      supplied.delete(entry.hash)
    }
  }
  const onDisk = recordFilesOf(dir, kept)
  return (
    files + onDisk.files <= LIMITS.secretsPerServer &&
    bytes + onDisk.bytes <= LIMITS.recordBytesPerServer
  )
}

/**
 * What follows `up` (RN3, RN11, RN12): for an app with no route and no
 * health check that held none, only the certificates of released domains
 * still to delete, tried again; else the routes put in force, carried out
 * as far as they go even when `up` failed, so that a domain this deploy
 * releases is released; then, only when both went well, the wait for health.
 */
async function afterUp(
  dir: string,
  verified: VerifiedDeployV2,
  started: boolean,
  onHealth: (service: string) => void
): Promise<RunnerReport> {
  const { app, sequence, routes, health } = verified.deploy
  const done = { app, sequence }
  if (
    routes.length === 0 &&
    health === null &&
    !Object.hasOwn(verified.nextState.routes, app)
  ) {
    // RN10's first step, for each released domain still to delete; with none, no Docker call. Not reported.
    await retryReleased(dir, verified.nextState)
    return { outcome: started ? "started" : "start_failed", ...done }
  }

  const inForce = await putRoutesInForce({ dir, app, routes, health })
  // Their own failure is not reported over start_failed.
  if (!started) return { outcome: "start_failed", ...done }
  if (!inForce.ok)
    return { outcome: "routes_failed", ...done, routes: inForce.failure }
  if (health !== null) {
    const waited = await waitHealthy({
      dir,
      app,
      health,
      names: inForce.names,
      // The limit is the app's: the time the routes took, such as a first fetch of the proxy's image, is not counted.
      deadline: Date.now() + health.timeout * 1000,
      onHealth,
    })
    if (!waited.ok)
      return {
        outcome: "unhealthy",
        ...done,
        health: { service: waited.service, http: waited.http },
      }
  }
  return { outcome: "started", ...done }
}

export function deploy(
  dir: string,
  input: string,
  onProgress?: (line: string) => void,
  onHealth: (service: string) => void = () => {}
): Promise<RunnerReport> {
  // K1. The request: at most a message's size, and exactly its schema.
  const request = parseMessage(RunnerDeployRequestSchema, input)
  if (!request.ok) return Promise.resolve(refused("invalid_request"))
  // K2. Set up, the deploy lock, a private folder and key, a state that reads.
  return locked(dir, async () => {
    const loaded = load(dir)
    if (isReport(loaded)) return loaded

    // K3. The team lists sent with it, saved whole with the mark when they changed.
    const followed = follow(loaded.state, request.value.rosters)
    if (isReport(followed)) return followed
    if (followed !== loaded.state) writeState(dir, followed)

    // K4 to K14. The envelope, the signer, the payload, the order, the expiry and the
    // secrets, each listed secret's record supplied or held here and verified now.
    const verified = verifyDeployV2({
      envelope: request.value.envelope,
      records: request.value.records,
      held: (app, hash) => readRecord(dir, app, hash),
      state: followed,
      now: new Date(),
      via: "session",
    })
    if (!verified.ok) return refused(verified.error.code)

    // K15. What the runner would hold after it fits what it may hold and report, the domains and the health
    // checks of every app with this deploy's in place of the app's among them (RN2).
    const { app, routes, health } = verified.value.deploy
    if (
      !withinLimits(verified.value.nextState) ||
      !recordsFit(dir, verified.value) ||
      domainsAfter(verified.value.nextState, app, routes) >
        LIMITS.domainsPerServer ||
      healthBytesAfter(verified.value.nextState, app, health) >
        LIMITS.healthBytesPerServer
    )
      return refused("too_large")

    // K16. Every listed secret opens, or none is used.
    const secrets = openSecrets(verified.value, loaded.secretKey)
    if (!secrets.ok) return refused("secrets_mismatch")

    // K17. The records first, then the state that names them: the number is used
    // here, before anything starts. Then the files no live secret names go.
    for (const record of verified.value.write)
      writeRecord(dir, app, listedHash(verified.value, record), record)
    writeState(dir, verified.value.nextState)
    removeUnnamed(dir, app, verified.value.keep)
    const started = await composeStart(
      dir,
      verified.value.deploy,
      secrets.value,
      onProgress
    )
    return afterUp(dir, verified.value, started, onHealth)
  })
}
