import {
  afterVersionOneDeploy,
  applyRosterUpdate,
  CoreError,
  generateServerKeyPair,
  LIMITS,
  newRunnerState,
  openSecrets,
  parseMessage,
  readRunnerState,
  RunnerApplyRequestSchema,
  RunnerSetupRequestSchema,
  RunnerSyncRequestSchema,
  serverConfirmationCode,
  serverIdOf,
  takesVersionOne,
  trustFoundingRoster,
  verifyDeploy,
  versionOneView,
  type Envelope,
  type RunnerReport,
  type RunnerSetupResponse,
  type RunnerState,
  type RunnerStatus,
  type ServerPublicKey,
  type ServerSecretKey,
  type StoredRunnerState,
} from "@workspace/core"

import { boundedRestart, restart, type RestartBounds } from "../builder/restart"
import { composeUp } from "../docker/compose"
import {
  isPrivate,
  isSetUp,
  readKeys,
  readState,
  takeDir,
  writeCompose,
  writeKeys,
  writeState,
} from "../home/home"
import { acquireLock, withStateLock } from "../home/locks"

type Reason = NonNullable<RunnerReport["reason"]>
export const refused = (reason: Reason): RunnerReport => ({
  outcome: "refused",
  reason,
})

type Loaded = {
  /** The stored state with its mark (contracts/state.md). A state runner 0.1.0 wrote is marked in memory only. */
  state: StoredRunnerState
  publicKey: ServerPublicKey
  secretKey: ServerSecretKey
}

/**
 * Reads the key and the state, or says why the runner cannot act. Reading
 * writes nothing: a state from before version 2 stays as it is on disk until
 * the first request that saves one (ST10).
 */
export function load(dir: string): Loaded | RunnerReport {
  if (!isSetUp(dir)) return refused("not_set_up")
  // Someone else's folder, or a key or state others can read, is not a state to act on.
  if (!isPrivate(dir)) return refused("invalid_state")
  try {
    const keys = readKeys(dir)
    const state = readRunnerState(readState(dir))
    if (serverIdOf(keys.publicKey as ServerPublicKey) !== state.serverId)
      return refused("invalid_state")
    return {
      state,
      publicKey: keys.publicKey as ServerPublicKey,
      secretKey: keys.secretKey as ServerSecretKey,
    }
  } catch {
    // Missing, unreadable or damaged: never treated as "nothing accepted yet".
    return refused("invalid_state")
  }
}

/**
 * Applies the team lists the runner does not have yet. `rosters` is the whole
 * chain from version 1. Only the team changes: the state given back is whole,
 * with its mark, ready to be saved as it is (ST4).
 */
export function follow(
  state: StoredRunnerState,
  rosters: readonly Envelope[]
): StoredRunnerState | RunnerReport {
  let team = state.team
  for (const envelope of rosters.slice(team.version)) {
    const applied = applyRosterUpdate(team, envelope)
    if (!applied.ok) return refused(applied.error.code)
    team = applied.value
  }
  return team === state.team ? state : { ...state, team }
}

export const isReport = (value: object): value is RunnerReport =>
  "outcome" in value

/** Whether a state holds no more apps and secrets than a runner may report (LIMITS). */
export const withinLimits = (state: RunnerState): boolean =>
  Object.keys(state.lastSequence).length <= LIMITS.appsPerServer &&
  Object.keys(state.secrets).length <= LIMITS.secretsPerServer

/**
 * Sets the server up for one team. Runs once: a server that already has a key
 * is left alone. Whoever runs this first decides which team the server
 * obeys, so nobody else should be able to start the runner before then.
 * It takes the deploy lock, then the state lock, and is `busy` at once when
 * either is held (specs/016-build-from-source, contracts/runner.md RB1).
 */
export function setup(
  dir: string,
  input: string
): RunnerSetupResponse | RunnerReport {
  const request = parseMessage(RunnerSetupRequestSchema, input)
  if (!request.ok) return refused("invalid_request")
  if (isSetUp(dir)) return refused("already_set_up")
  const team = trustFoundingRoster(
    request.value.founding,
    request.value.teamCode
  )
  if (!team.ok) return refused(team.error.code)

  // The folder is taken now, and made private, before the locks are made in it.
  takeDir(dir)
  const releaseDeploy = acquireLock(dir)
  if (!releaseDeploy) return refused("busy")
  let releaseState: (() => void) | undefined
  try {
    releaseState = acquireLock(dir, "state.lock")
  } catch (error) {
    // A state lock that cannot be made (a full disk): the deploy lock is not left held for this process's life.
    releaseDeploy()
    throw error
  }
  if (!releaseState) {
    releaseDeploy()
    return refused("busy")
  }
  const release = () => {
    releaseState()
    releaseDeploy()
  }
  try {
    if (isSetUp(dir)) return refused("already_set_up")
    const keys = generateServerKeyPair()
    // The key first, created exclusively: two setups can never both succeed.
    writeKeys(dir, keys)
    // Marked from the start, with no app at format 1: it takes no version-1 deploy at all (ST3).
    writeState(
      dir,
      newRunnerState({ serverId: keys.serverId, team: team.value })
    )
    return {
      serverPublicKey: keys.publicKey,
      serverId: keys.serverId,
      code: serverConfirmationCode(keys.publicKey),
    }
  } finally {
    release()
  }
}

/**
 * `setup` as a request (specs/016-build-from-source, contracts/runner.md
 * RB1 fifth bullet; data-model.md, "The locks"). On a server not yet set
 * up: `setup`. On one set up, it takes the deploy lock as every request
 * that takes it does, so RB15 runs first when the state's `building` is
 * set, and answers `already_set_up`, or `busy` while another run holds the
 * lock or a record of that build still runs. A folder others could write
 * gets no lock made in it, and the answer it always had.
 */
export async function setupRequest(
  dir: string,
  input: string
): Promise<RunnerSetupResponse | RunnerReport> {
  const request = parseMessage(RunnerSetupRequestSchema, input)
  if (!request.ok || !isSetUp(dir) || !isPrivate(dir)) return setup(dir, input)
  return locked(dir, () => Promise.resolve(refused("already_set_up")))
}

/** What the server holds, as every zekno reads it: built from the version-1 view, so its shape never changes (FR-033). */
export function status(dir: string): RunnerStatus | RunnerReport {
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const state = versionOneView(loaded.state)
  return {
    serverId: state.serverId,
    serverPublicKey: loaded.publicKey,
    team: {
      teamId: state.team.teamId,
      version: state.team.version,
      hash: state.team.hash,
    },
    lastSequence: { ...state.lastSequence },
    secrets: Object.fromEntries(
      Object.entries(state.secrets).map(([key, known]) => [
        key,
        { version: known.version, removed: known.hash === null },
      ])
    ),
  }
}

/**
 * `status` as a request (specs/016-build-from-source, contracts/runner.md
 * RB1 sixth bullet): RB15's bounded part first, then `status`'s answer,
 * whose shape never changes.
 */
export async function statusRequest(
  dir: string
): Promise<RunnerStatus | RunnerReport> {
  await boundedFirst(dir)
  return status(dir)
}

/**
 * The bounds RB15 runs with where requests come in: the contract's, with
 * the folder that stands for `/proc` taken from `ZEKNO_RUNNER_PROC` when it
 * is set, a seam for tests as `ZEKNO_RUNNER_UNPACKED` is (the stand-in for
 * Docker keeps its build clients' entries there). Never set on a server.
 */
function requestBounds(): RestartBounds {
  const procRoot = process.env.ZEKNO_RUNNER_PROC
  return procRoot ? { procRoot } : {}
}

/**
 * RB15 under the deploy lock when the state, read again, has `building`
 * set: D was free or its holder gone, so no runner watches that build any
 * more (RB1, fifth bullet). True once the request may go on; false while a
 * record of that build still runs, and `building` stays.
 */
async function restartFirst(dir: string): Promise<boolean> {
  const loaded = load(dir)
  // A state that does not read is the work's to report.
  if (isReport(loaded) || loaded.state.building === null) return true
  return (await restart(dir, loaded.state, requestBounds())).cleared
}

/**
 * Runs one piece of work while holding the deploy lock, so two deploys never
 * interleave (specs/016-build-from-source, contracts/runner.md RB1). The
 * folder is checked before the lock is made in it: a folder others could
 * write is refused, and left as it is (security review S3). When another
 * run holds the lock, the answer is `busy` at once, or what `busy` gives.
 * RB15 runs first when the state's `building` is set, and while a record
 * of that build still runs the answer is what `busy` gives: a deploy's
 * answer then carries `building`, phase `stopping`.
 */
export async function locked<Answer = RunnerReport>(
  dir: string,
  work: () => Promise<Answer | RunnerReport>,
  busy: () => RunnerReport = () => refused("busy")
): Promise<Answer | RunnerReport> {
  if (!isSetUp(dir)) return refused("not_set_up")
  if (!isPrivate(dir)) return refused("invalid_state")
  const release = acquireLock(dir)
  if (!release) return busy()
  try {
    if (!(await restartFirst(dir))) return busy()
    return await work()
  } catch (error) {
    // The core library reports unusable stored state this way.
    if (error instanceof CoreError) return refused("invalid_state")
    throw error
  } finally {
    release()
  }
}

/**
 * RB15's bounded part where a request that takes no deploy lock for its own
 * work comes in: `sync`, `pack`, `builds` and `status` (RB1, sixth bullet).
 * When the state, read without a lock (the runner writes it atomically),
 * has `building` set, D is tried once, without waiting: held by another
 * run, nothing is done; got, `boundedRestart` runs and D is released before
 * the request's own work. Never throws, and never waits for a record.
 */
export async function boundedFirst(dir: string): Promise<void> {
  if (!isSetUp(dir) || !isPrivate(dir)) return
  const seen = load(dir)
  if (isReport(seen) || seen.state.building === null) return
  let release: (() => void) | undefined
  try {
    release = acquireLock(dir)
  } catch {
    return
  }
  if (!release) return
  try {
    // Read again under D: the run that held it may have cleared it since.
    const loaded = load(dir)
    if (!isReport(loaded) && loaded.state.building !== null)
      await boundedRestart(dir, loaded.state, requestBounds())
  } catch {
    // What is left waits for a later request; this one goes on.
  } finally {
    release()
  }
}

/** How long a request waits for the state lock; tests pass a short one. */
export type StateWait = { waitMs?: number }

/**
 * Runs `work` under the state lock with the state read again (RB1): every
 * read-then-write of the state takes it, and changes only its own part of
 * what it read. The answer is `work`'s, or why it did not run: the folder or
 * the state that does not read, or `busy` once the wait has passed. No
 * Docker call is made, and no piece is read, inside `work`.
 */
export async function withState<Answer>(
  dir: string,
  work: (loaded: Loaded) => Answer | Promise<Answer>,
  wait: StateWait = {}
): Promise<Answer | RunnerReport> {
  if (!isSetUp(dir)) return refused("not_set_up")
  if (!isPrivate(dir)) return refused("invalid_state")
  try {
    return await withStateLock(
      dir,
      () => {
        const loaded = load(dir)
        return isReport(loaded) ? loaded : work(loaded)
      },
      wait
    )
  } catch (error) {
    if (error instanceof CoreError) return refused("invalid_state")
    throw error
  }
}

/**
 * Takes newer team lists, under the state lock only (RB1): never the deploy
 * lock for its own work, so a `sync` is answered during a deploy, and a team
 * list that removes a stolen key lands within the wait whatever a deploy
 * does (FR-044). RB15's bounded part comes first (`boundedFirst`).
 */
export async function sync(
  dir: string,
  input: string,
  wait: StateWait = {}
): Promise<RunnerReport> {
  const request = parseMessage(RunnerSyncRequestSchema, input)
  if (!request.ok) return refused("invalid_request")
  await boundedFirst(dir)
  return withState<RunnerReport>(
    dir,
    (loaded) => {
      const next = follow(loaded.state, request.value.rosters)
      if (isReport(next)) return next
      if (next !== loaded.state) writeState(dir, next)
      return { outcome: "ok" }
    },
    wait
  )
}

/**
 * How a start ended: `started` when Docker's exit status was 0, else
 * `start_failed`; with `startLimit`, the limit in whole seconds, when `up`
 * was stopped at its time limit (protocol 5; specs/015-domains-https,
 * contracts/core.md, "Outcomes"). Only a version-2 deploy's report carries
 * `startLimit` (deploy.ts).
 */
export type Start =
  { outcome: "started" } | { outcome: "start_failed"; startLimit?: number }

/** A limit as a report gives it: in whole seconds, rounded up, from 1 to a day. */
const wholeSeconds = (ms: number): number =>
  Math.min(86_400, Math.max(1, Math.ceil(ms / 1000)))

/**
 * Saves the Compose text of an accepted deploy and runs `docker compose up`
 * in the runner's own folder, for `limitMs` at most (by default the runner's
 * own limit, `START_LIMIT_MS` in docker/compose.ts). Never throws: a Compose
 * file that could not be written is a start that failed.
 */
export async function composeStart(
  dir: string,
  deploy: { app: string; compose: string },
  secrets: Record<string, string>,
  onProgress?: (line: string) => void,
  limitMs?: number
): Promise<Start> {
  try {
    const file = writeCompose(dir, deploy.app, deploy.compose)
    const ended = await composeUp(
      { dir, app: deploy.app, file, secrets, onLine: onProgress },
      limitMs
    )
    if ("stoppedAfterMs" in ended)
      return {
        outcome: "start_failed",
        startLimit: wholeSeconds(ended.stoppedAfterMs),
      }
    return { outcome: ended.exit === 0 ? "started" : "start_failed" }
  } catch {
    return { outcome: "start_failed" }
  }
}

/**
 * Saves the Compose text of an accepted deploy and starts it in the runner's
 * own folder. Called only once the deploy's number is used: whatever happens
 * here, the outcome is `started` or `start_failed`. The report is version 1's,
 * as every older zekno reads it: a start stopped at its time limit is
 * `start_failed` with nothing more.
 */
export async function startApp(
  dir: string,
  deploy: { app: string; sequence: number; compose: string },
  secrets: Record<string, string>,
  onProgress?: (line: string) => void,
  limitMs?: number
): Promise<RunnerReport> {
  const { app, sequence } = deploy
  const started = await composeStart(dir, deploy, secrets, onProgress, limitMs)
  return { outcome: started.outcome, app, sequence }
}

/**
 * Takes newer team lists, then one deploy of version 1. Nothing is decrypted
 * before the core library has verified the deploy, and the new state is
 * saved before anything is started.
 *
 * The deploy is checked against the version-1 view of the stored state, and
 * is then taken only for an app this runner held when it first read a state
 * from before version 2, and that has had no deploy of version 2 since
 * (FR-031): any other app is refused `unsupported_version`, a reason every
 * older zekno reads. What is saved is the whole stored state with only the
 * numbers and secret versions changed, so the mark and every app's format
 * survive (V21). No record is kept: version 1 carries none (FR-024).
 * `limitMs`: how long `up` may run, the runner's own limit when left out.
 *
 * It holds the deploy lock and the state lock for its whole span, `up`
 * among it, as it held its one lock before feature 016: the one request
 * that calls Docker under the state lock (specs/016-build-from-source,
 * contracts/runner.md RB1).
 */
export function apply(
  dir: string,
  input: string,
  onProgress?: (line: string) => void,
  limitMs?: number
): Promise<RunnerReport> {
  const request = parseMessage(RunnerApplyRequestSchema, input)
  if (!request.ok) return Promise.resolve(refused("invalid_request"))
  return locked(dir, () =>
    withState<RunnerReport>(dir, async (loaded) => {
      const followed = follow(loaded.state, request.value.rosters)
      if (isReport(followed)) return followed
      if (followed !== loaded.state) writeState(dir, followed)

      const verified = verifyDeploy({
        ...request.value.deploy,
        state: versionOneView(followed),
      })
      if (!verified.ok) return refused(verified.error.code)
      // The app is known only from under the signature, so the gate comes after it, before any write.
      if (!takesVersionOne(followed, verified.value.deploy.app))
        return refused("unsupported_version")
      const next = afterVersionOneDeploy(followed, verified.value.nextState)
      // What a runner holds must always fit the answers that report it (`status`, `state`),
      // so a deploy of one app or one secret more than that is refused before anything is opened.
      if (!withinLimits(next)) return refused("too_large")

      // Open before saving: a deploy whose secrets cannot be opened must not use up its number.
      const secrets = openSecrets(verified.value, loaded.secretKey)
      if (!secrets.ok) return refused("secrets_mismatch")

      writeState(dir, next)
      // From here the deploy is accepted and its number is used, whatever happens next.
      return startApp(
        dir,
        verified.value.deploy,
        secrets.value,
        onProgress,
        limitMs
      )
    })
  )
}
