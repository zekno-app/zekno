import {
  applyRosterUpdate,
  CoreError,
  generateServerKeyPair,
  initialRunnerState,
  openSecrets,
  parseMessage,
  parseRunnerState,
  RunnerApplyRequestSchema,
  RunnerSetupRequestSchema,
  RunnerSyncRequestSchema,
  serverConfirmationCode,
  serverIdOf,
  trustFoundingRoster,
  verifyDeploy,
  type Envelope,
  type RunnerReport,
  type RunnerSetupResponse,
  type RunnerState,
  type RunnerStatus,
  type ServerPublicKey,
  type ServerSecretKey,
} from "@workspace/core"

import { composeUp } from "./compose"
import { acquireLock, isPrivate, isSetUp, readKeys, readState, writeCompose, writeKeys, writeState } from "./home"

type Reason = NonNullable<RunnerReport["reason"]>
export const refused = (reason: Reason): RunnerReport => ({ outcome: "refused", reason })

type Loaded = { state: RunnerState; publicKey: ServerPublicKey; secretKey: ServerSecretKey }

/** Reads the key and the state, or says why the runner cannot act. */
export function load(dir: string): Loaded | RunnerReport {
  if (!isSetUp(dir)) return refused("not_set_up")
  // Someone else's folder, or a key others can read, is not a state to act on.
  if (!isPrivate(dir)) return refused("invalid_state")
  try {
    const keys = readKeys(dir)
    const state = parseRunnerState(readState(dir))
    if (serverIdOf(keys.publicKey as ServerPublicKey) !== state.serverId) return refused("invalid_state")
    return { state, publicKey: keys.publicKey as ServerPublicKey, secretKey: keys.secretKey as ServerSecretKey }
  } catch {
    // Missing, unreadable or damaged: never treated as "nothing accepted yet".
    return refused("invalid_state")
  }
}

/** Applies the team lists the runner does not have yet. `rosters` is the whole chain from version 1. */
function follow(state: RunnerState, rosters: readonly Envelope[]): RunnerState | RunnerReport {
  let team = state.team
  for (const envelope of rosters.slice(team.version)) {
    const applied = applyRosterUpdate(team, envelope)
    if (!applied.ok) return refused(applied.error.code)
    team = applied.value
  }
  return team === state.team ? state : { ...state, team }
}

export const isReport = (value: object): value is RunnerReport => "outcome" in value

/**
 * Sets the server up for one team. Runs once: a server that already has a key
 * is left alone. Whoever runs this first decides which team the server
 * obeys, so nobody else should be able to start the runner before then.
 */
export function setup(dir: string, input: string): RunnerSetupResponse | RunnerReport {
  const request = parseMessage(RunnerSetupRequestSchema, input)
  if (!request.ok) return refused("invalid_request")
  if (isSetUp(dir)) return refused("already_set_up")
  const team = trustFoundingRoster(request.value.founding, request.value.teamCode)
  if (!team.ok) return refused(team.error.code)

  const release = acquireLock(dir)
  if (!release) return refused("busy")
  try {
    if (isSetUp(dir)) return refused("already_set_up")
    const keys = generateServerKeyPair()
    // The key first, created exclusively: two setups can never both succeed.
    writeKeys(dir, keys)
    writeState(dir, initialRunnerState({ serverId: keys.serverId, team: team.value }))
    return {
      serverPublicKey: keys.publicKey,
      serverId: keys.serverId,
      code: serverConfirmationCode(keys.publicKey),
    }
  } finally {
    release()
  }
}

export function status(dir: string): RunnerStatus | RunnerReport {
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const { state } = loaded
  return {
    serverId: state.serverId,
    serverPublicKey: loaded.publicKey,
    team: { teamId: state.team.teamId, version: state.team.version, hash: state.team.hash },
    lastSequence: { ...state.lastSequence },
    secrets: Object.fromEntries(
      Object.entries(state.secrets).map(([key, known]) => [key, { version: known.version, removed: known.hash === null }])
    ),
  }
}

/** Runs one piece of work while holding the lock, so two runs never interleave. */
async function locked(dir: string, work: () => Promise<RunnerReport>): Promise<RunnerReport> {
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
 * Takes newer team lists, then one deploy. Nothing is decrypted before the
 * core library has verified the deploy, and the new state is saved before
 * anything is started.
 */
export function apply(dir: string, input: string, onProgress?: (line: string) => void): Promise<RunnerReport> {
  const request = parseMessage(RunnerApplyRequestSchema, input)
  if (!request.ok) return Promise.resolve(refused("invalid_request"))
  return locked(dir, async () => {
    const loaded = load(dir)
    if (isReport(loaded)) return loaded

    const followed = follow(loaded.state, request.value.rosters)
    if (isReport(followed)) return followed
    if (followed !== loaded.state) writeState(dir, followed)

    const verified = verifyDeploy({ ...request.value.deploy, state: followed })
    if (!verified.ok) return refused(verified.error.code)

    // Open before saving: a deploy whose secrets cannot be opened must not use up its number.
    const secrets = openSecrets(verified.value, loaded.secretKey)
    if (!secrets.ok) return refused("secrets_mismatch")

    const { app, sequence, compose } = verified.value.deploy
    writeState(dir, verified.value.nextState)
    // From here the deploy is accepted and its number is used, whatever happens next.
    try {
      const file = writeCompose(dir, app, compose)
      const exit = await composeUp({ app, file, secrets: secrets.value, onLine: onProgress })
      return { outcome: exit === 0 ? "started" : "start_failed", app, sequence }
    } catch {
      return { outcome: "start_failed", app, sequence }
    }
  })
}
