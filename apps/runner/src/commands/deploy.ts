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
 *
 * Since feature 016 (specs/016-build-from-source, contracts/runner.md RB3),
 * a deploy that builds takes the steps of RB3's table in its order: K1 to
 * K14 here; K14a to K14c in `deploy-build.ts` (which builds are kept, and,
 * when one is not, whether Docker can build and the disk holds it); K15 and
 * K16 here; K14d in `deploy-build.ts` (the code checked); K17 here, which
 * writes the number with the state's `building` when a build is not kept;
 * then U and R in `deploy-after.ts`, before the answer. A deploy of an app
 * with no build asks Docker nothing more than before.
 */
import {
  domainsAfter,
  healthBytesAfter,
  LIMITS,
  openSecrets,
  parseMessage,
  RunnerDeployRequestSchema,
  verifyDeployV2,
  withBuilding,
  type Building,
  type RunnerDeployRequest,
  type RunnerReport,
  type SecretRecord,
  type ServerSecretKey,
  type StoredRunnerState,
  type VerifiedDeployV2,
} from "@workspace/core"

import type { StatFs } from "../disk/free"
import { writeState } from "../home/home"
import {
  readRecord,
  recordFilesOf,
  recordText,
  removeUnnamed,
  writeRecord,
} from "../home/records"
import { dropBuilding } from "../pack/open"
import {
  follow,
  isReport,
  load,
  locked,
  refused,
  withinLimits,
  withState,
} from "./commands"
import { afterNumber } from "./deploy-after"
import { buildingOf, checkCode, planBuilds } from "./deploy-build"

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

/** A deploy that passed K4 to K16: verified against `state`, with its secrets opened. */
type Checked = {
  verified: VerifiedDeployV2
  secrets: Record<string, string>
  /** The state K4 to K14 read, after K3. */
  state: StoredRunnerState
}

/** What in-process tests give a deploy (K14c's free space), as they give `up` its limit. */
export type DeployOptions = {
  /** Stands for `fs.statfsSync` on each place a build writes to (RB6). */
  readonly statfs?: StatFs
}

/**
 * K4 to K14 against `state`: the envelope, the signer, the payload, the
 * order, the expiry and the secrets, each listed secret's record supplied or
 * held here and verified now.
 */
function verify(
  dir: string,
  request: RunnerDeployRequest,
  state: StoredRunnerState
): VerifiedDeployV2 | RunnerReport {
  const verified = verifyDeployV2({
    envelope: request.envelope,
    records: request.records,
    held: (app, hash) => readRecord(dir, app, hash),
    state,
    now: new Date(),
    via: "session",
  })
  return verified.ok ? verified.value : refused(verified.error.code)
}

/**
 * K15: what the runner would hold after the deploy fits what it may hold
 * and report, the domains and the health checks of every app with this
 * deploy's in place of the app's among them (RN2); else `too_large`.
 */
function beyondLimits(
  dir: string,
  verified: VerifiedDeployV2
): RunnerReport | undefined {
  const { app, routes, health } = verified.deploy
  if (
    !withinLimits(verified.nextState) ||
    !recordsFit(dir, verified) ||
    domainsAfter(verified.nextState, app, routes) > LIMITS.domainsPerServer ||
    healthBytesAfter(verified.nextState, app, health) >
      LIMITS.healthBytesPerServer
  )
    return refused("too_large")
  return undefined
}

/** K4 to K15 against `state`, as K17 runs them again. */
function check(
  dir: string,
  request: RunnerDeployRequest,
  state: StoredRunnerState
): VerifiedDeployV2 | RunnerReport {
  const verified = verify(dir, request, state)
  if (isReport(verified)) return verified
  return beyondLimits(dir, verified) ?? verified
}

/**
 * The answer to a deploy that finds the deploy lock held (specs/016-build-
 * from-source, contracts/runner.md RB1; core.md CO10): `busy` at once, with
 * the build under way when the state's `building` is set, read without a
 * lock: its app, the whole seconds since it started (0 when its start is
 * ahead of this clock), its limit and its phase.
 */
function busyAnswer(dir: string): RunnerReport {
  const loaded = load(dir)
  if (isReport(loaded) || loaded.state.building === null) return refused("busy")
  const { app, since, limit, phase } = loaded.state.building
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(since)) / 1000)
  )
  return { ...refused("busy"), building: { app, seconds, limit, phase } }
}

/**
 * The locks (specs/016-build-from-source, contracts/runner.md RB1; data-
 * model.md, "The locks"; FR-044): the deploy lock for the whole deploy; the
 * state lock for K3 to K14, for K14d's move of the pieces, then again at
 * K17, and around each later state write (the routes and the released
 * domains, in routes/), each reading the state again and changing only its
 * own part. No Docker call is made, and no piece is read, while the state
 * lock is held. A `sync` takes the state lock only, so it may land between
 * K14 and K17: K17 then runs K4 to K16 again against the state it reads.
 */
export function deploy(
  dir: string,
  input: string,
  onProgress?: (line: string) => void,
  onHealth: (service: string) => void = () => {},
  /** How long `up` may run: the runner's own limit when left out (docker/compose.ts). */
  limitMs?: number,
  options: DeployOptions = {}
): Promise<RunnerReport> {
  // K1. The request: at most a message's size, and exactly its schema.
  const request = parseMessage(RunnerDeployRequestSchema, input)
  if (!request.ok) return Promise.resolve(refused("invalid_request"))
  // K2. Set up, a private folder, the deploy lock: held by another run, busy at once (busyAnswer).
  return locked(
    dir,
    async () => {
      // K3 to K14, under the state lock: a key and a state that read; the team lists sent with it, saved whole
      // with the mark when they changed; the deploy checked against them.
      const first = await withState<
        | {
            verified: VerifiedDeployV2
            state: StoredRunnerState
            key: ServerSecretKey
          }
        | RunnerReport
      >(dir, (loaded) => {
        const followed = follow(loaded.state, request.value.rosters)
        if (isReport(followed)) return followed
        if (followed !== loaded.state) writeState(dir, followed)
        const verified = verify(dir, request.value, followed)
        if (isReport(verified)) return verified
        return { verified, state: followed, key: loaded.secretKey }
      })
      if (isReport(first)) return first
      const { app } = first.verified.deploy

      // K14a to K14c, under the deploy lock alone (deploy-build.ts): which builds are kept, and, only when one
      // is not, whether Docker can build and the disk holds it. A deploy with no build asks Docker nothing.
      const plan = await planBuilds(
        dir,
        first.state,
        first.verified,
        options.statfs
      )
      if (isReport(plan)) return plan

      // K15. What the runner would hold fits.
      const beyond = beyondLimits(dir, first.verified)
      if (beyond !== undefined) return beyond

      // K16. Every listed secret opens, or none is used.
      const opened = openSecrets(first.verified, first.key)
      if (!opened.ok) return refused("secrets_mismatch")
      const checked: Checked = {
        verified: first.verified,
        secrets: opened.value,
        state: first.state,
      }

      // K14d (deploy-build.ts): the pieces of each build not kept moved from staging under the state lock, then
      // checked under the deploy lock alone. Its refusals leave no piece in building/<app>/.
      const code = await checkCode(
        dir,
        request.value.envelope,
        first.verified,
        plan,
        first.key
      )
      if (isReport(code)) return code

      // K17, under the state lock, the state read again. When it changed since K4 to K14 read it, K4 to K16 run
      // again against it (FR-044). Then the records first, then the state that names them: the number is used
      // here, with `building` when a build is not kept (CO13), before anything starts. Then the files no live
      // secret names go.
      let accepted: (Checked & { building: Building | null }) | RunnerReport
      try {
        accepted = await withState<
          (Checked & { building: Building | null }) | RunnerReport
        >(dir, (fresh) => {
          let use = checked
          if (!Bun.deepEquals(fresh.state, checked.state)) {
            const again = check(dir, request.value, fresh.state)
            if (isReport(again)) return again
            const reopened = openSecrets(again, fresh.secretKey)
            if (!reopened.ok) return refused("secrets_mismatch")
            use = {
              verified: again,
              secrets: reopened.value,
              state: fresh.state,
            }
          }
          const { verified } = use
          // Made, and read back by core's rules, before anything is written.
          const building = buildingOf(verified.deploy, plan)
          const next =
            building === null
              ? verified.nextState
              : withBuilding(verified.nextState, building)
          for (const record of verified.write)
            writeRecord(dir, app, listedHash(verified, record), record)
          writeState(dir, next)
          removeUnnamed(dir, app, verified.keep)
          return { ...use, building }
        })
      } catch (error) {
        if (plan.toBuild.length > 0) dropBuilding(dir, app)
        throw error
      }
      if (isReport(accepted)) {
        // A refusal at K17 leaves no piece K14d moved.
        if (plan.toBuild.length > 0) dropBuilding(dir, app)
        return accepted
      }

      // The number is used. B1 and B2 come here for `plan.toBuild` (T086, deploy-build.ts), then B3 (T087,
      // deploy-after.ts), once the build command is settled (T073, after check L2). Then U and R (deploy-after.ts),
      // and the answer.
      return afterNumber(dir, {
        verified: accepted.verified,
        secrets: accepted.secrets,
        plan,
        building: accepted.building,
        onProgress,
        onHealth,
        limitMs,
      })
    },
    () => busyAnswer(dir)
  )
}
