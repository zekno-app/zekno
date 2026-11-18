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

import { composeUp } from "../docker/compose"
import {
  acquireLock,
  isPrivate,
  isSetUp,
  readKeys,
  readState,
  writeCompose,
  writeKeys,
  writeState,
} from "../home/home"

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
  // Someone else's folder, or a key others can read, is not a state to act on.
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

  const release = acquireLock(dir)
  if (!release) return refused("busy")
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

/** Runs one piece of work while holding the lock, so two runs never interleave. */
export async function locked(
  dir: string,
  work: () => Promise<RunnerReport>
): Promise<RunnerReport> {
  if (!isSetUp(dir)) return refused("not_set_up")
  const release = acquireLock(dir)
  if (!release) return refused("busy")
  try {
    return await work()
  } catch (error) {
    // The core library reports unusable stored state this way.
    if (error instanceof CoreError) return refused("invalid_state")
    throw error
  } finally {
    release()
  }
}

/** Takes newer team lists. */
export function sync(dir: string, input: string): Promise<RunnerReport> {
  const request = parseMessage(RunnerSyncRequestSchema, input)
  if (!request.ok) return Promise.resolve(refused("invalid_request"))
  return locked(dir, async () => {
    const loaded = load(dir)
    if (isReport(loaded)) return loaded
    const next = follow(loaded.state, request.value.rosters)
    if (isReport(next)) return next
    if (next !== loaded.state) writeState(dir, next)
    return { outcome: "ok" }
  })
}

/**
 * Saves the Compose text of an accepted deploy and starts it in the runner's
 * own folder. Called only once the deploy's number is used: whatever happens
 * here, the outcome is `started` or `start_failed`.
 */
export async function startApp(
  dir: string,
  deploy: { app: string; sequence: number; compose: string },
  secrets: Record<string, string>,
  onProgress?: (line: string) => void
): Promise<RunnerReport> {
  const { app, sequence } = deploy
  try {
    const file = writeCompose(dir, app, deploy.compose)
    const exit = await composeUp({
      dir,
      app,
      file,
      secrets,
      onLine: onProgress,
    })
    return { outcome: exit === 0 ? "started" : "start_failed", app, sequence }
  } catch {
    return { outcome: "start_failed", app, sequence }
  }
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
 */
export function apply(
  dir: string,
  input: string,
  onProgress?: (line: string) => void
): Promise<RunnerReport> {
  const request = parseMessage(RunnerApplyRequestSchema, input)
  if (!request.ok) return Promise.resolve(refused("invalid_request"))
  return locked(dir, async () => {
    const loaded = load(dir)
    if (isReport(loaded)) return loaded

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
    return startApp(dir, verified.value.deploy, secrets.value, onProgress)
  })
}
