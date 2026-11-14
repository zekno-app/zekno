import {
  compareRunnerVersions,
  CoreError,
  proposeRoster,
  RUNNER_PROTOCOL,
  RunnerReportSchema,
  RunnerSetupResponseSchema,
  RunnerStatusSchema,
  serverConfirmationCode,
  type RunnerVersion,
  type ServerPublicKey,
} from "@workspace/core"
import { join, resolve } from "node:path"

import { reach, teamOf, type OpDeps, type Team } from "../context"
import { CliError, RunnerRefused, UsageError } from "../errors"
import {
  isRunnerFileName,
  notNamedRunner,
  readRunnerFile,
  releaseFiles,
  RUNNER_PATHS,
  runInstaller,
  type InstallEvent,
  type InstallRequest,
  type InstallSource,
} from "../install"
import { NAME, type Server } from "../profile"
import { RUNNER_RELEASE, type RunnerRelease } from "../runner-release"
import { openSession, type Session, type SessionMode } from "../session"
import { RUNNER_PATH, SSH_DESTINATION, type RunnerProcess, type Target, type Transport } from "../transport"
import { locateServer } from "./status"

export type ServerAddOptions = { ssh?: string; local?: boolean; home?: string; runnerPath?: string; runnerFile?: string }

/** A server to connect, checked on this machine. Nothing has been asked of it yet. */
export type ServerAddPlan = {
  team: Team
  name: string
  target: Target
  /**
   * Over SSH with no `--runner-path`: the runner is looked for on the server
   * first, and installed when it is not there. `target.runnerPath` is then
   * decided by where the installer found or put it.
   */
  install?: InstallRequest
}

/** What has been done on the server so far. */
export type ServerAddStage = "connected" | "set_up" | "added"

export type ServerAddCallbacks = {
  stage?: (stage: ServerAddStage) => void
  /** Each step of the installer as it completes, when it runs. */
  install?: (event: InstallEvent) => void
  /** A line the installer printed that is not one of its own, cleaned. */
  detail?: (line: string) => void
  /** The runner was already set up for this team by an earlier attempt that stopped half way. */
  resumed?: () => void
  /** The server code, as soon as setup has finished: derived on this machine from the key the server sent. */
  code?: (code: string) => void
}

export type ServerAddResult = {
  name: string
  target: Target
  /** The server code, derived on this machine from the key the server sent. */
  code: string
  mode: SessionMode
  /** The runner's version, when it says. A runner from before sessions does not. */
  runner?: RunnerVersion
  /** The runner against the one this CLI carries. Undefined for a runner on this machine, which is never compared. */
  relation?: RunnerRelation
  /** The installer put the runner there just now. */
  installed: boolean
  /** With `keep`: the session the server was added over, still open, for the caller to read over and close. */
  session?: Session
}

export type AddSessionOptions = {
  /**
   * Hands the session the server was added over back open, once the server
   * is added, instead of closing it: the app keeps it for its reads, so SSH
   * does not ask a second time. Only a runner that speaks sessions has one.
   */
  keep?: boolean
  /** Stops the session at once, whenever it is signalled, also once it was handed back. */
  signal?: AbortSignal
}

const release = (deps: Pick<OpDeps, "release">): RunnerRelease => deps.release ?? RUNNER_RELEASE

/** Compares two runner versions: negative when `a` is older (packages/core, `compareRunnerVersions`). */
export function compareVersions(a: string, b: string): number {
  return compareRunnerVersions(a, b)
}

/**
 * A runner against the one this CLI carries (specs/005-runner-release/contracts/versions.md,
 * "The relation"): older, the same or newer, and what does not work until it is updated.
 */
export type RunnerRelation = {
  relation: "older" | "same" | "newer"
  /**
   * What needs the runner this CLI carries: with no sessions, running state
   * and logs; with sessions of a lower protocol, some of what this CLI does;
   * otherwise nothing.
   */
  missing: "state and logs" | "some" | "nothing"
  /** It speaks a newer protocol than this CLI: this CLI is updated before it deploys there. */
  newerProtocol: boolean
}

/**
 * How a runner stands to the version this CLI carries. One that does not
 * speak sessions does not report its version, and sessions came before every
 * release, so it is older. Otherwise the versions are compared by the one
 * order of packages/core, and the protocols say what works in between.
 */
export function runnerRelation(mode: SessionMode, runner: RunnerVersion | undefined, carried: string): RunnerRelation {
  if (mode === "one-shot" || runner === undefined) return { relation: "older", missing: "state and logs", newerProtocol: false }
  const order = compareRunnerVersions(runner.version, carried)
  return {
    relation: order < 0 ? "older" : order > 0 ? "newer" : "same",
    missing: runner.protocol < RUNNER_PROTOCOL ? "some" : "nothing",
    newerProtocol: runner.protocol > RUNNER_PROTOCOL,
  }
}

/** Checks the name and how to reach the server; reads `--runner-file` once, here. */
export async function prepareServerAdd(deps: OpDeps, name: string | undefined, options: ServerAddOptions): Promise<ServerAddPlan> {
  const team = await teamOf(deps)
  if (!name || !NAME.test(name)) {
    throw new UsageError("Give the server a name of lowercase letters, digits and hyphens.")
  }
  if (team.profile.servers.some((server) => server.name === name)) {
    throw new CliError(`A server named "${name}" is already connected.`)
  }
  if (Boolean(options.ssh) === Boolean(options.local)) {
    throw new UsageError("Say how to reach the server: `--ssh <destination>` or `--local`.")
  }
  if (options.runnerFile !== undefined && (!options.ssh || options.runnerPath !== undefined)) {
    throw new UsageError("`--runner-file` sends a runner over SSH: use it with `--ssh` and without `--runner-path`.")
  }

  if (!options.ssh) {
    return { team, name, target: { kind: "local", home: options.home ? resolve(deps.cwd, options.home) : join(deps.home, "runner", name) } }
  }
  if (!SSH_DESTINATION.test(options.ssh)) throw new CliError("That SSH destination is not valid. Use the form user@host.")
  if (options.runnerPath !== undefined) {
    if (!RUNNER_PATH.test(options.runnerPath)) throw new CliError("That runner path is not valid.")
    // A runner already installed there: nothing is installed.
    return { team, name, target: { kind: "ssh", destination: options.ssh, runnerPath: options.runnerPath } }
  }
  const carried = release(deps)
  const source: InstallSource =
    options.runnerFile !== undefined
      ? { kind: "file", file: await readRunnerFile(resolve(deps.cwd, options.runnerFile)) }
      : { kind: "release", files: releaseFiles(carried) }
  return {
    team,
    name,
    target: { kind: "ssh", destination: options.ssh, runnerPath: RUNNER_PATHS.path },
    install: { mode: "add", version: carried.version, source },
  }
}

/**
 * Asks the runner to set itself up for this team. A runner that says it is
 * already set up is accepted only when it shows this team: that is what an
 * earlier `server add` leaves behind when it stops half way.
 */
async function setUp(
  team: Team,
  session: Session,
  resumed: (() => void) | undefined
): Promise<{ serverId: string; serverPublicKey: ServerPublicKey }> {
  try {
    return await session.request("setup", RunnerSetupResponseSchema, {
      input: { founding: team.profile.rosters[0], teamCode: team.teamCode },
    })
  } catch (refusal) {
    if (!(refusal instanceof RunnerRefused) || refusal.reason !== "already_set_up") throw refusal
    const status = await session.request("status", RunnerStatusSchema)
    const known = team.chain[status.team.version - 1]
    if (status.team.teamId !== team.trust.teamId || known?.hash !== status.team.hash) throw refusal
    const existing = team.trust.servers.find((server) => server.serverId === status.serverId)
    if (existing) throw new CliError(`That server is already connected as "${existing.name}".`)
    resumed?.()
    return status
  }
}

/** The runner reached as usual, except that its first session is the one the installer handed over. */
function continuing(transport: Transport, session: RunnerProcess): Transport {
  let handed = false
  return {
    ...transport,
    open() {
      if (handed) return transport.open()
      handed = true
      return session
    },
  }
}

/**
 * Connects a server, over one session: the runner sets itself up for this
 * team, then an admin adds it to the team list and the runner is given the
 * new list. Over SSH with no runner path given, the installer runs first: it
 * checks Docker, finds the runner or installs it, and hands its connection
 * over to the session, so a server reached with a published release is
 * reached once. A runner that is already there is used as it is, never
 * replaced without being asked (FR-012); one that is older is reported.
 * The session is closed at the end, or, with `options.keep`, handed back
 * open once the server was added; it is closed whenever adding fails.
 */
export async function addServer(
  deps: OpDeps,
  plan: ServerAddPlan,
  callbacks: ServerAddCallbacks = {},
  options: AddSessionOptions = {}
): Promise<ServerAddResult> {
  const { team, name } = plan
  const { profile, trust } = team
  let target = plan.target
  let transport = reach(deps, target)
  let installed = false
  if (plan.install && target.kind === "ssh") {
    const done = await runInstaller(
      transport,
      plan.install,
      { destination: target.destination },
      (event) => {
        if (event.kind === "connected") callbacks.stage?.("connected")
        callbacks.install?.(event)
      },
      callbacks.detail
    )
    // The path is this CLI's own for the place the installer named, never one the server sent.
    if (done.place !== "target") target = { ...target, runnerPath: RUNNER_PATHS[done.place] }
    installed = done.events.some((event) => event.kind === "install")
    transport = done.session ? continuing(reach(deps, target), done.session) : reach(deps, target)
  }
  const reached = target
  const session = await openSession(transport, { signal: options.signal })
  let kept = false
  try {
    if (!plan.install) callbacks.stage?.("connected")
    const answer = await setUp(team, session, callbacks.resumed)
    if (trust.servers.some((server) => server.serverId === answer.serverId)) {
      throw new CliError("That server is already connected under another name.")
    }
    const code = serverConfirmationCode(answer.serverPublicKey)
    callbacks.code?.(code)
    callbacks.stage?.("set_up")

    const next = await team
      .withSigner((signer) => proposeRoster({ trust, servers: [...trust.servers, { name, publicKey: answer.serverPublicKey }], signer }))
      .catch((error: unknown) => {
        if (error instanceof CoreError) throw new CliError(`The server could not be added to the team list (${error.code}).`)
        throw error
      })

    const rosters = [...profile.rosters, next.envelope]
    team.store.save({ ...profile, rosters, servers: [...profile.servers, { name, serverId: answer.serverId, target: reached }] })
    await session.request("sync", RunnerReportSchema, { input: { rosters } })
    callbacks.stage?.("added")
    kept = options.keep === true && session.mode === "session"
    return {
      name,
      target: reached,
      // The code is derived here from the key that came back, never taken on the runner's word.
      code,
      mode: session.mode,
      runner: session.runner,
      ...(reached.kind === "ssh" ? { relation: runnerRelation(session.mode, session.runner, release(deps).version) } : {}),
      installed,
      ...(kept ? { session } : {}),
    }
  } finally {
    if (!kept) await session.close()
  }
}

/** A runner to replace, checked on this machine. Nothing has been asked of the server yet. */
export type ServerUpdatePlan = { server: Server; request: Extract<InstallRequest, { mode: "update" }> }

export type ServerUpdateResult = {
  server: string
  /** The version the runner has now. */
  version: string
  /** False when it already had this version. */
  updated: boolean
  /** The version it had before, when it said. */
  from?: string
}

/** Finds the server and what its runner would be replaced with. Only a runner reached over SSH is replaced this way. */
export async function prepareServerUpdate(deps: OpDeps, name: string | undefined): Promise<ServerUpdatePlan> {
  if (!name) throw new UsageError("Say which server: `zekno server update <name>`.")
  const { server } = await locateServer(deps, name)
  if (server.target.kind !== "ssh") {
    throw new CliError(`${server.name} is a runner on this machine. It comes with zekno itself, so there is nothing to update.`)
  }
  // Checked before anyone is asked anything: the path is from the profile file, which is not signed.
  if (!isRunnerFileName(server.target.runnerPath)) throw new CliError(notNamedRunner(server.target.runnerPath, server.name))
  const carried = release(deps)
  return {
    server,
    request: {
      mode: "update",
      version: carried.version,
      runnerPath: server.target.runnerPath,
      source: { kind: "release", files: releaseFiles(carried) },
    },
  }
}

/**
 * Replaces the runner on a server with the version this CLI carries, by the
 * same verified route as `server add`: the server downloads it and installs
 * it only when its SHA-256 matches the one this CLI holds. A runner that
 * already has this version is left as it is. Its folder, key and state are
 * not touched, so its apps keep running.
 */
export async function updateRunner(
  deps: OpDeps,
  plan: ServerUpdatePlan,
  callbacks: Pick<ServerAddCallbacks, "install" | "detail"> = {}
): Promise<ServerUpdateResult> {
  const { server, request } = plan
  if (server.target.kind !== "ssh") throw new CliError("Only a runner reached over SSH is updated this way.")
  const done = await runInstaller(
    reach(deps, server.target),
    request,
    { destination: server.target.destination, server: server.name },
    callbacks.install,
    callbacks.detail
  )
  const found = done.events.find((event) => event.kind === "runner")
  return {
    server: server.name,
    version: request.version,
    updated: done.events.some((event) => event.kind === "install"),
    from: found?.kind === "runner" ? found.version : undefined,
  }
}

/** The servers of the verified team. */
export async function listServers(deps: OpDeps): Promise<Server[]> {
  const { profile } = await teamOf(deps)
  return profile.servers
}
