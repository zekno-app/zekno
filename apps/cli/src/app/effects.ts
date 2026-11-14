/**
 * What the app does outside its state: reading the profile, and running the
 * operations of apps/cli/src/ops/ that the reducer asks for. Each result
 * comes back as an event for the reducer. Nothing here draws anything.
 *
 * While the app is on screen nothing may be written to the terminal behind
 * Ink's back, so what a runner, Docker or SSH write on standard error comes
 * back as events too, never straight to the terminal.
 */
import { CoreError, type RunnerStatus, type RunnerVersion, type TeamTrust } from "@workspace/core"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { isAccepted } from "../accepted"
import { expectedValues } from "../compose-file"
import { readCompose, type ComposeText } from "../compose-read"
import { openTeam, reach, TAMPERED, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import type { InstallEvent } from "../install"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployPlan } from "../ops/deploy"
import { createTeam } from "../ops/init"
import { writeLink } from "../ops/link"
import { followLogs, LOG_TAIL, prepareLogs, type LogLine } from "../ops/logs"
import { prepareSecretSet, removeSecret, setSecret } from "../ops/secret"
import { addServer, isOutdated, prepareServerAdd, prepareServerUpdate, updateRunner } from "../ops/server"
import { locateServer, readOver, stateOf, type AppStates, type RunState, type StatusResult } from "../ops/status"
import { profileStore, type Server } from "../profile"
import { DEFAULT_COMPOSE, findProject, notAcceptedHere, shownPath, tilde, type ProjectLink } from "../project"
import { RUNNER_RELEASE } from "../runner-release"
import { sanitize } from "../sanitize"
import { openSession, type Session, type SessionMode } from "../session"
import type { ErrorLines, Target } from "../transport"
import { askingConnect, batchOnly, oneAtATime, wouldHaveAsked, type Terminal } from "./hand-over"
import {
  DEPLOY_LINES,
  LOG_LINES,
  LOG_TEXT_KEPT,
  type AddStepName,
  type AppEvent,
  type Effect,
  type LogLine as ShownLine,
  type Notice,
  type Start,
  type TeamView,
} from "./state"
import { seconds } from "./time"
import { appDetails, appNames, appsOf, latestAccepted, secretNamesOf } from "./views"

/** What the app needs from the outside world: what every operation needs. */
export type AppDeps = OpDeps

/**
 * Typed as the SSH destination in "add a server", it adds the runner on this
 * machine instead, for trying zekno out. It is how Home names such a server,
 * and it can never be an SSH destination (it has a space).
 */
export const THIS_MACHINE = "this machine"

/** The Compose file a deploy from the app uses when no zekno.json names another, in the folder the app was started from. */
export const COMPOSE_FILE = DEFAULT_COMPOSE

/** How long log lines are gathered before they are drawn together, so a burst is drawn once and not line by line. */
export const LOG_BATCH_MS = 50

/**
 * How long a read in the background may take: over a server's kept session,
 * or connecting again in batch mode and reading. Past it the session is
 * closed and the server shown as not reached, never with state that looks
 * current when it is not.
 */
export const READ_LIMIT_MS = 20_000

/**
 * A server whose kept session ended, or that could not be reached, is
 * connected to again in the background no sooner than this after it was
 * lost or last tried: never a new login every few seconds.
 */
export const RETRY_MS = 30_000

/** How long each kept session has, once the app closes, to end before it is stopped. */
const CLOSE_MS = 1000

/**
 * Said for a server that SSH could not reach without asking something, when
 * the app read it on its own. Only what the person does on purpose may ask.
 */
export const needsAnswer = (destination: string): string =>
  `SSH needs an answer to reach ${sanitize(destination)}. zekno asks only when it starts and when you add or update a server, deploy or open logs, never in the background.`

/** Said for a server whose read in the background got no answer within `ms`. */
export const noAnswer = (server: string, ms = READ_LIMIT_MS): string => `${server} did not answer within ${ms / 1000} seconds.`

/**
 * Each app's state from a runner's answer, for `app-states`. With no answer,
 * none is known. With `names`, only those apps are kept: the ones this
 * machine has a history for, which are the only ones Home shows.
 */
export function statesFor(states: AppStates | undefined, names?: readonly string[]): Record<string, RunState> {
  if (states === undefined) return {}
  const apps = names ?? Object.keys(states)
  return Object.fromEntries(apps.filter((app) => Object.hasOwn(states, app)).map((app) => [app, stateOf(states, app)]))
}

/** The last deploy the runner accepted of each of `names`, as its status says, for `app-states`. */
export function acceptedFor(status: RunnerStatus, names: readonly string[]): Record<string, number> {
  const last = status.lastSequence
  return Object.fromEntries(names.filter((app) => Object.hasOwn(last, app) && last[app]! >= 1).map((app) => [app, last[app]!]))
}

/**
 * Gathers items and hands them on together, `LOG_BATCH_MS` after the first,
 * so a burst is drawn once. Once `limit` are waiting, `add` returns a promise
 * that settles when they are handed on: the session waits for it before it
 * reads the next line, so a runner that sends faster than the screen draws
 * is slowed down in the connection, not held in this process.
 */
function batcher<T>(limit: number, handOn: (items: T[]) => void) {
  let items: T[] = []
  let waiting: (() => void)[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    const taken = items
    const released = waiting
    items = []
    waiting = []
    if (taken.length > 0) handOn(taken)
    for (const resolve of released) resolve()
  }
  return {
    add(item: T): Promise<void> | undefined {
      items.push(item)
      timer ??= setTimeout(flush, LOG_BATCH_MS)
      return items.length < limit ? undefined : new Promise((resolve) => waiting.push(resolve))
    },
    flush,
  }
}

/**
 * The verified team as the screens show it, with each server's apps from
 * this machine's verified deploy history (views.ts). `openTeam` proves the
 * team lists and the server names; the member's name and each server's
 * address are plain text in the profile folder, which anything on this
 * machine could have changed, so they are cleaned like text from a server
 * before anyone sees them.
 */
export function teamView(team: Team, home: string): TeamView {
  return {
    member: sanitize(team.profile.memberName),
    version: team.trust.version,
    code: team.teamCode,
    servers: team.profile.servers.map((server) => ({
      name: server.name,
      destination: server.target.kind === "ssh" ? sanitize(server.target.destination) : undefined,
      apps: appsOf(team, server, home),
    })),
  }
}

export { tilde }

/**
 * The profile is read and verified before anything is drawn (contracts/app.md,
 * "Start"): no profile is first run, a profile that verifies is Home, and one
 * that does not is the error screen with the reason. The screen says in its
 * own words that the folder may have been changed, so that sentence is not
 * repeated after the reason. With a `cwd` linked by a zekno.json this
 * machine accepted, Home opens on its server and app ("Linked folder"); a
 * zekno.json that cannot be used is said on Home, and chooses nothing: one
 * that was not made or accepted here, one that names a server that is not
 * connected, one that cannot be read. Nothing here reaches a server.
 */
export async function loadStart(deps: Pick<OpDeps, "home" | "keyStore"> & { cwd?: string }): Promise<Start> {
  if (!profileStore(deps.home).exists()) return { kind: "no-team" }
  let team: Team
  try {
    team = await openTeam(deps)
  } catch (error) {
    const reason = reasonOf(error)
    if (reason === undefined) throw error
    // A reason can quote a path or a name read from the profile folder.
    return { kind: "profile-error", reason: sanitize(reason.replace(` ${TAMPERED}`, "")), folder: sanitize(tilde(deps.home)) }
  }
  const view = teamView(team, deps.home)
  if (deps.cwd === undefined) return { kind: "team", team: view }
  try {
    const link = findProject(deps.cwd)
    if (!link) return { kind: "team", team: view }
    // A zekno.json from a cloned folder would otherwise choose the app that `d` replaces.
    if (!isAccepted(deps.home, link)) return { kind: "team", team: view, problem: notAcceptedHere(link, deps.cwd) }
    // The server it names must be one of the verified team's; the app name was held to its pattern when it was read.
    if (!team.profile.servers.some((server) => server.name === link.server)) {
      return { kind: "team", team: view, problem: notConnected(link) }
    }
    return { kind: "team", team: view, linked: { server: link.server, app: link.app, compose: sanitize(link.compose) } }
  } catch (error) {
    const reason = reasonOf(error)
    if (reason === undefined) throw error
    return { kind: "team", team: view, problem: sanitize(reason) }
  }
}

/** Said when a zekno.json names a server this machine is not connected to: it then chooses nothing. */
const notConnected = (link: ProjectLink): string => `${shownPath(link.path)} names a server "${link.server}" that is not connected to this machine.`

/** Said when `d` is pressed on an app or server other than the one the folder is linked to. */
export const linkedElsewhere = (link: Pick<ProjectLink, "app" | "server">): string =>
  `This folder is linked to ${link.app} on ${link.server}. Select it to deploy this folder. ` +
  "To deploy it elsewhere, run `zekno deploy --app <name> --server <name>` here."

/** What the add-server screen says beside a runner that was already on the server. */
export function foundDetail(version: string | undefined, carried: string): string {
  if (version === undefined) return "from before 0.2.0, out of date"
  return version === carried ? `version ${version}` : `version ${version}${compareOlder(version, carried) ? ", out of date" : ""}`
}

const compareOlder = (version: string, carried: string): boolean => isOutdated("session", { version, protocol: 2 }, carried)

/** The sentence for a failure a person can act on, or undefined for one nobody planned for. */
function reasonOf(error: unknown): string | undefined {
  if (error instanceof CliError || error instanceof UsageError) return error.message
  if (error instanceof CoreError) return `That could not be done (${error.code}).`
  return undefined
}

/** The same operations' needs, with standard error sent to `out` instead of the terminal. */
export function routeErrorLines(deps: OpDeps, out: ErrorLines): OpDeps {
  return { ...deps, connect: (target, localRunner, options) => deps.connect(target, localRunner, { errorLines: out, ...options }) }
}

export type Effects = {
  /** Starts one effect. Its results arrive later, as events. */
  run(effect: Effect): void
  /** What operations are run with: standard error comes back as `runner-line` events. */
  deps: OpDeps
  /**
   * Asks every server what it holds, all at once and in the background, and
   * marks each reachable or not as its answer arrives. A server that is slow
   * or gone holds up nothing else: not the others, not drawing, not keys.
   * This is the app's deliberate connection to each server: SSH may ask
   * (hand-over.ts). The session each one opens is kept for the reads that
   * follow (`refresh`).
   */
  checkServers(): Promise<void>
  /**
   * Stores a value typed in the hidden prompt, then says so with
   * `secret-saved`, or why not with `secret-refused`. The value goes to the
   * secret operation and nowhere else: not into an event, a line or the state.
   */
  saveSecret(where: { server: string; app: string; name: string }, value: string): Promise<void>
  /**
   * The app is closing: the logs being followed are let go, nothing more is
   * read in the background, and every kept session is closed. Resolves once
   * each of their processes has exited: given a moment to end, then stopped.
   * `now`: stopped at once, as on a signal, when nothing can be waited for.
   */
  close(options?: { now?: boolean }): Promise<void>
}

/** The times the reads in the background keep to. Tests pass their own. */
export type Timing = {
  /** The clock `RETRY_MS` is measured with. */
  now?: () => number
  /** How long a read in the background may take (`READ_LIMIT_MS`). */
  readLimitMs?: number
  /** How long before a server that was lost is connected to again in the background (`RETRY_MS`). */
  retryMs?: number
}

/**
 * A server's kept session, for reading what it holds and runs every few
 * seconds over one connection (contracts/app.md, "Refresh"). `session` is
 * undefined while it is being opened.
 */
type Watch = {
  /** Stops it at once: the runner process, or SSH, is stopped, while opening or after. */
  stop: AbortController
  session?: Session
  /** It is being opened or read: one read per server at a time. */
  busy: boolean
}

/**
 * The Compose file a deploy from the app signs, read when `d` was pressed:
 * its text and path, how the missing-values list names it, the app it
 * deploys, and whether the folder is linked to that app.
 */
type Source = { read: ComposeText; named: string; app: string; linked: boolean }

/** A size in bytes as the board writes it: "27 MB". */
export const megabytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`

/** The runner's version and whether it is older than the one this zekno carries, for Home. Undefined for a runner on this machine. */
function runnerOf(target: Target, mode: SessionMode, runner: RunnerVersion | undefined, carried: string) {
  if (target.kind !== "ssh") return undefined
  return { version: runner?.version, outdated: isOutdated(mode, runner, carried) }
}

/**
 * Runs the effects the reducer asks for. A failure a person can act on
 * becomes a line on the screen and the app carries on; anything else is
 * passed to `fail`, which closes the app and restores the terminal.
 *
 * With a `terminal`, every connection over SSH is made in batch mode first,
 * and the terminal is handed over only when SSH has to ask (hand-over.ts).
 */
export function createEffects(
  deps: AppDeps,
  dispatch: (event: AppEvent) => void,
  fail: (error: unknown) => void,
  terminal?: Terminal,
  timing: Timing = {}
): Effects {
  const now = timing.now ?? Date.now
  const readLimitMs = timing.readLimitMs ?? READ_LIMIT_MS
  const retryMs = timing.retryMs ?? RETRY_MS
  const base: OpDeps = terminal ? { ...deps, connect: askingConnect(deps.connect, oneAtATime(terminal)) } : deps
  /**
   * SSH destinations that SSH could not reach without asking when the app
   * read them on its own. They are not read in the background again until
   * the person connects to them on purpose, which may ask and be answered:
   * a background read every few seconds must never ask, and repeated failed
   * logins could also get this machine shut out by the server.
   */
  const asking = new Set<string>()
  const purposeful: OpDeps = {
    ...base,
    connect(target, localRunner, options) {
      if (target.kind === "ssh") asking.delete(target.destination)
      return base.connect(target, localRunner, options)
    },
  }
  const ops = routeErrorLines(purposeful, (line) => dispatch({ type: "runner-line", line }))

  /**
   * The verified team list and servers, from the last time the profile was
   * verified. Reads in the background use them, so the keychain is not
   * opened every few seconds. They hold no key.
   */
  let known: { team: Pick<Team, "trust">; servers: readonly Server[] } | undefined
  const remember = (team: { trust: TeamTrust; profile: { servers: readonly Server[] } }) => {
    known = { team: { trust: team.trust }, servers: team.profile.servers }
  }

  /** Each server's kept session, by name (`Watch`). */
  const watches = new Map<string, Watch>()
  /** Kept sessions that were replaced or lost and are being closed: closing the app waits for them too. */
  const lettingGo = new Set<Watch>()
  /** When each server that was lost may next be connected to in the background. */
  const retryAt = new Map<string, number>()
  /**
   * Servers whose runner does not speak sessions: there is no session to
   * keep, and state cannot be read from it, so it is not read in the
   * background at all. Its update (`u`) reads it again.
   */
  const oneShot = new Set<string>()
  let closed = false
  let closing: Promise<void> | undefined

  const carried = (deps.release ?? RUNNER_RELEASE).version
  const notice = (tone: Notice["tone"], text: string) => dispatch({ type: "notice", notice: { tone, text } })

  /** Runs work in the background and reports how it failed, if it did. */
  const perform = (work: () => Promise<void>): Promise<void> =>
    work().catch((error: unknown) => {
      const reason = reasonOf(error)
      if (reason === undefined) fail(error)
      else dispatch({ type: "failed", notice: { tone: "error", text: reason } })
    })

  /** Reads one app's history and secrets again, and its server's apps for Home. */
  const refresh = (team: Team, server: Server, app: string) => {
    dispatch({ type: "server-apps", server: server.name, apps: appsOf(team, server, deps.home) })
    dispatch({ type: "app-view", server: server.name, app, ...appDetails(team, server, app) })
  }

  /**
   * One deploy at a time. The reducer already ignores `d` and `r` while a
   * deploy runs; this also covers the moment before it has started, so two
   * deploys are never signed side by side from the same history.
   */
  let deploying = false

  /**
   * The deploy from the app that waits on a question: "remember this
   * folder?" (`link`) or the values the Compose file expects (`values`). Its
   * answer comes back as `deploy-continue` for the same server and app. Only
   * names and the Compose file's text are kept while the question is open,
   * never the team or its key: the text that was read when `d` was pressed
   * is the text whose names were listed and the text that is signed, and the
   * file is not read again.
   */
  let waiting: { server: string; app: string; on: "link" | "values"; source: Source } | undefined
  /** "n" to "remember this folder?": it is not asked again while the app is open. */
  let linkSkipped = false

  /**
   * Where a deploy from the app takes its service definition, read once
   * (compose-read.ts): the Compose file the zekno.json that applies here
   * names, or compose.yaml in the folder the app was started in. Either must
   * stay inside its folder. Undefined, with a line saying why, when `d`
   * deploys nothing:
   *
   * - the zekno.json was not made or accepted on this machine: it is never
   *   used, and no other is offered in its place;
   * - the folder is linked to another app or server than the one selected:
   *   it deploys only to its own, and on a server with no apps only when
   *   that server is its own (a zekno.json naming a server that is not
   *   connected supplies nothing);
   * - there is no Compose file, or no app is selected in a folder that is
   *   not linked.
   */
  function composeOf(server: string, selected: string | undefined): Source | undefined {
    const link = findProject(ops.cwd)
    if (link) {
      if (!isAccepted(deps.home, link)) {
        notice("error", notAcceptedHere(link, ops.cwd))
        return undefined
      }
      if (link.server !== server || (selected !== undefined && selected !== link.app)) {
        const connected = known === undefined || known.servers.some((entry) => entry.name === link.server)
        notice(connected ? "info" : "error", connected ? linkedElsewhere(link) : notConnected(link))
        return undefined
      }
      return { read: readCompose({ kind: "project", link }), named: sanitize(link.compose), app: link.app, linked: true }
    }
    if (!existsSync(resolve(ops.cwd, COMPOSE_FILE))) {
      notice("error", `There is no ${COMPOSE_FILE} in ${shownPath(ops.cwd)}, and no zekno.json names another. Run zekno link -f <file> here to name one.`)
      return undefined
    }
    if (selected === undefined) {
      notice("info", `Choose an app first. To deploy a new app, run zekno link --app <name> --server ${server} in its folder.`)
      return undefined
    }
    return { read: readCompose({ kind: "default", folder: ops.cwd }), named: COMPOSE_FILE, app: selected, linked: false }
  }

  /**
   * Checks a deploy or rollback on this machine, or says why it cannot go
   * ahead. A deploy of a folder that is not linked first asks whether to
   * remember it (board "Two questions the app asks"); then the values its
   * Compose file expects that have no secret are listed (board "Set a
   * secret"). Each question ends this plan; its answer starts the next part
   * (`after`), with everything checked again.
   */
  async function plan(
    effect: Extract<Effect, { kind: "deploy" | "rollback" }>,
    after?: NonNullable<typeof waiting>
  ): Promise<(DeployPlan & { from: string }) | undefined> {
    if (effect.kind === "rollback") {
      const to = effect.to === undefined ? undefined : String(effect.to)
      const rollback = await prepareRollback(ops, { app: effect.app, server: effect.server, to }, { warning: (text) => notice("warning", text) })
      return { ...rollback, from: `what deploy ${rollback.from} ran` }
    }
    // After a question, the Compose file read when `d` was pressed: not read again.
    const source = after?.source ?? composeOf(effect.server, effect.app)
    if (!source) return undefined
    // On a server with no apps yet, `d` deploys the app the folder is linked to, when that server is the folder's.
    const app = source.app
    if (!source.linked && after === undefined && !linkSkipped) {
      waiting = { server: effect.server, app, on: "link", source }
      dispatch({ type: "ask-remember-folder", server: effect.server, app, compose: COMPOSE_FILE })
      return undefined
    }
    const planned = await prepareDeploy(ops, { app, server: effect.server, read: source.read })
    if (after?.on !== "values") {
      // Names only: the secrets' values are never opened here.
      const set = new Set(secretNamesOf(planned.team, planned.server, app))
      const missing = expectedValues(planned.compose).filter((name) => !set.has(name))
      if (missing.length > 0) {
        waiting = { server: planned.server.name, app, on: "values", source }
        dispatch({ type: "missing-values", server: planned.server.name, app, names: missing, file: source.named })
        return undefined
      }
    }
    return { ...planned, from: shownPath(source.read.path) }
  }

  /**
   * Goes on with the deploy that waited on a question, with its answer: for
   * "remember this folder?", zekno.json is written (never over an existing
   * one) or not; for the missing values, they were set or skipped. An answer
   * nothing waits for is ignored.
   */
  async function goOn(effect: Extract<Effect, { kind: "deploy-continue" }>): Promise<void> {
    const asked = waiting
    if (!asked || asked.server !== effect.server || asked.app !== effect.app) return
    const about = effect.answer === "write-link" || effect.answer === "skip-link" ? "link" : "values"
    if (asked.on !== about) return
    waiting = undefined
    if (effect.answer === "write-link") {
      // Written by a "yes" here, so accepted on this machine (accepted.ts).
      writeLink(deps.home, ops.cwd, { app: effect.app, server: effect.server, compose: COMPOSE_FILE })
      dispatch({ type: "linked", linked: { server: effect.server, app: effect.app, compose: COMPOSE_FILE } })
    }
    if (effect.answer === "skip-link") linkSkipped = true
    await deploy({ kind: "deploy", server: effect.server, app: effect.app }, asked)
  }

  /** Signs and sends a deploy, with its stages and Docker's lines as events, and its result as a line wherever the person is. */
  async function deploy(effect: Extract<Effect, { kind: "deploy" | "rollback" }>, after?: NonNullable<typeof waiting>): Promise<void> {
    if (deploying) return notice("info", "A deploy is already in progress.")
    deploying = true
    try {
      const planned = await plan(effect, after)
      if (!planned) return
      const { team, server, app } = planned
      const started = Date.now()
      dispatch({
        type: "deploy-started",
        server: server.name,
        app,
        at: started,
        from: planned.from,
        replaces: latestAccepted(team, server, app),
        secretNames: secretNamesOf(team, server, app),
      })
      // Docker's lines are drawn in batches, and past `DEPLOY_LINES` waiting the runner is read no further until they are.
      const lines = batcher<string>(DEPLOY_LINES, (taken) => dispatch({ type: "deploy-progress", lines: taken }))
      let result
      try {
        result = await sendDeploy(ops, planned, {
          stage: (stage, info) => dispatch({ type: "deploy-stage", stage, sequence: info.sequence, secrets: info.secrets }),
          progress: (line) => lines.add(line),
          warning: (text) => notice("warning", text),
        })
      } catch (error) {
        lines.flush()
        const reason = reasonOf(error)
        if (reason === undefined) return fail(error)
        dispatch({ type: "deploy-ended", outcome: "error", notice: { tone: "error", text: reason }, at: Date.now() })
        return refresh(team, server, app)
      }
      lines.flush()
      const ended = Date.now()
      const text =
        result.outcome === "started"
          ? `${app} is live on ${server.name} in ${seconds(ended - started)}`
          : `${server.name} accepted deploy ${result.sequence}, but the app did not start.`
      dispatch({ type: "deploy-ended", outcome: result.outcome, notice: { tone: result.outcome === "started" ? "success" : "error", text }, at: ended })
      dispatch({ type: "server-reached", server: server.name, reachable: true })
      refresh(team, server, app)
    } finally {
      deploying = false
    }
  }

  /** One server added at a time, so two never take the same name or race on the team list. */
  let adding = false

  /**
   * Adds a server from the app, each step as an event: over SSH the
   * installer checks Docker and finds or installs the runner, then the
   * runner is set up and the server added to the signed team list. What the
   * server prints on standard error is kept for `o`.
   */
  async function add(effect: Extract<Effect, { kind: "add-server" }>): Promise<void> {
    // The reducer reopens a running one rather than starting another; this holds even if it did not.
    if (adding) return notice("info", "A server is already being added. Wait for it to finish.")
    adding = true
    try {
      const local = effect.destination === THIS_MACHINE
      const lines = routeErrorLines(purposeful, (line) => dispatch({ type: "add-line", line }))
      const plan = await prepareServerAdd(lines, effect.name, local ? { local: true } : { ssh: effect.destination })
      const started = Date.now()
      dispatch({ type: "add-started", destination: local ? THIS_MACHINE : effect.destination, name: plan.name, local })
      const step = (name: AddStepName, detail?: string, found?: boolean) => dispatch({ type: "add-step", step: name, detail, found })
      let bytes: number | undefined
      let resumed = false
      const installed = (event: InstallEvent) => {
        if (event.kind === "docker") step("docker", event.version ? `v${event.version}` : undefined)
        else if (event.kind === "runner") step("runner", foundDetail(event.version, carried), true)
        else if (event.kind === "download") bytes = event.bytes
        else if (event.kind === "install") step("runner", `${bytes === undefined ? "" : `${megabytes(bytes)}, `}checksum verified`)
      }
      const result = await addServer(lines, plan, {
        stage(stage) {
          if (stage === "connected") step("connect", local ? undefined : seconds(Date.now() - started))
          else if (stage === "set_up") step("set_up", resumed ? "carried on from an earlier attempt" : undefined)
          else step("added")
        },
        install: installed,
        detail: (line) => dispatch({ type: "add-line", line }),
        resumed: () => (resumed = true),
        code: (code) => dispatch({ type: "add-code", code }),
      })
      const team = await openTeam(ops)
      remember(team)
      const runner = runnerOf(result.target, result.mode, result.runner, carried)
      const text = runner?.outdated
        ? `Connected ${result.name}. Its runner is older than this zekno: deploys work, and u updates it. Server code ${result.code}.`
        : `Connected ${result.name} and added it to the signed team list. Server code ${result.code}.`
      dispatch({ type: "server-added", team: teamView(team, deps.home), notice: { tone: runner?.outdated ? "warning" : "success", text } })
      dispatch({ type: "server-reached", server: result.name, reachable: true, runner })
    } finally {
      adding = false
    }
  }

  /** What a server answered, for the reducer: reached, its runner's version, and its apps' state and last deploy numbers. */
  function report(server: Server, result: StatusResult): void {
    dispatch({ type: "server-reached", server: server.name, reachable: true, runner: runnerOf(server.target, result.mode, result.runner, carried) })
    // Only the apps this machine has a history for: Home shows no other, so no other is kept.
    const names = appNames(deps.home, server)
    dispatch({ type: "app-states", server: server.name, states: statesFor(result.states, names), accepted: acceptedFor(result.status, names) })
  }

  /** Closes a kept session that is no longer the server's, and keeps track of it until its process has exited. */
  function letGo(entry: Watch): void {
    lettingGo.add(entry)
    const exited = entry.session ? entry.session.close() : (entry.stop.abort(), Promise.resolve(undefined))
    void exited.finally(() => lettingGo.delete(entry))
  }

  /** The server is no longer read over `entry`: it is closed, and connected to again in the background no sooner than `retryMs` from now. */
  function lose(name: string, entry: Watch): void {
    if (watches.get(name) === entry) watches.delete(name)
    retryAt.set(name, now() + retryMs)
    letGo(entry)
  }

  /**
   * Gives a read in the background `readLimitMs`. Past it, the session is
   * closed, so the read fails at once, and its process is stopped if it does
   * not end by itself; a connection still being made is stopped outright.
   */
  function timeLimit(entry: Watch) {
    let late = false
    const timer = setTimeout(() => {
      late = true
      if (entry.session) void entry.session.close()
      else entry.stop.abort()
    }, readLimitMs)
    return {
      get late() {
        return late
      },
      clear: () => clearTimeout(timer),
    }
  }

  /**
   * Connects to a server, checks that it is the server that was connected
   * and on this team, reads what it holds and runs, and keeps the session for
   * the reads that follow. The identity is checked here, once per session;
   * each later read checks the status it gets against it again.
   *
   * `deliberately`: as the app does when it starts, or after an update. SSH
   * may then ask, and the terminal is handed over (hand-over.ts); there is
   * no time limit, since SSH may be waiting for a password. Otherwise, in
   * the background: batch mode only, the terminal never handed over, and
   * `readLimitMs` for all of it. Where SSH would have asked, the server
   * counts as not reached and is not connected to in the background again
   * until the person connects to it on purpose (`asking`).
   */
  async function connect(team: Pick<Team, "trust">, server: Server, deliberately: boolean): Promise<void> {
    const name = server.name
    const destination = server.target.kind === "ssh" ? server.target.destination : undefined
    const before = watches.get(name)
    if (before) {
      watches.delete(name)
      letGo(before)
    }
    const entry: Watch = { stop: new AbortController(), busy: true }
    watches.set(name, entry)
    const current = () => !closed && watches.get(name) === entry
    // What SSH writes on standard error in the background is only looked at to tell whether it would have asked.
    const lines: string[] = []
    const via = deliberately ? ops : { ...deps, connect: batchOnly(deps.connect, lines) }
    const limit = deliberately ? undefined : timeLimit(entry)
    try {
      const session = await openSession(reach(via, server.target), { signal: entry.stop.signal })
      if (session.mode === "session") entry.session = session
      if (!current()) return letGo(entry)
      const result = await readOver(session, { team, server }, { whole: true })
      if (!current()) return letGo(entry)
      if (session.mode !== "session") {
        // Nothing is kept open for a runner from before sessions, and it is not read in the background.
        oneShot.add(name)
        watches.delete(name)
      } else {
        oneShot.delete(name)
      }
      retryAt.delete(name)
      report(server, result)
    } catch (error) {
      const reason = reasonOf(error)
      if (reason === undefined) throw error
      if (!current()) return letGo(entry)
      lose(name, entry)
      const asks = !deliberately && destination !== undefined && wouldHaveAsked(lines)
      if (asks) asking.add(destination)
      const problem = asks ? needsAnswer(destination) : limit?.late ? noAnswer(name, readLimitMs) : sanitize(reason)
      dispatch({ type: "server-reached", server: name, reachable: false, problem })
    } finally {
      limit?.clear()
      entry.busy = false
    }
  }

  /** Reads what a server holds and runs over its kept session, within `readLimitMs`. A read that fails or takes too long loses the session. */
  async function readKept(team: Pick<Team, "trust">, server: Server, entry: Watch, session: Session): Promise<void> {
    const name = server.name
    entry.busy = true
    const limit = timeLimit(entry)
    try {
      const result = await readOver(session, { team, server }, { whole: true })
      if (closed || watches.get(name) !== entry) return
      report(server, result)
    } catch (error) {
      const reason = reasonOf(error)
      if (reason === undefined) throw error
      if (closed || watches.get(name) !== entry) return
      lose(name, entry)
      dispatch({ type: "server-reached", server: name, reachable: false, problem: limit.late ? noAnswer(name, readLimitMs) : sanitize(reason) })
    } finally {
      limit.clear()
      entry.busy = false
    }
  }

  /**
   * Reads a server in the background (contracts/app.md, "Refresh"): over its
   * kept session, with no new connection. Without one, it is connected to
   * again in batch mode, at most once every `retryMs`, and never when SSH
   * would have to ask. One read per server at a time, however slow it is.
   */
  async function readInBackground(team: Pick<Team, "trust">, server: Server): Promise<void> {
    const name = server.name
    const entry = watches.get(name)
    if (entry?.busy) return
    if (entry?.session) return readKept(team, server, entry, entry.session)
    if (oneShot.has(name)) return
    const destination = server.target.kind === "ssh" ? server.target.destination : undefined
    if (destination !== undefined && asking.has(destination)) return
    if (now() < (retryAt.get(name) ?? 0)) return
    return connect(team, server, false)
  }

  /** Reads again, in the background, what is running: on one server, or on every server the app knows. */
  function refreshStates(server: string | undefined): void {
    if (!known || closed) return
    const { team } = known
    for (const entry of known.servers) {
      if (server === undefined || entry.name === server) void readInBackground(team, entry).catch(fail)
    }
  }

  /** The logs being followed for the logs screen. */
  let following: { id: number; stop: AbortController } | undefined
  let followed = 0

  /** Lets go of the logs being followed: their session is closed, and the runner stops Docker's log command. */
  function stopLogs(): void {
    following?.stop.abort()
    following = undefined
  }

  /**
   * Follows an app's logs for the logs screen over a session of its own
   * (research R4), and hands its lines to the reducer in small batches. Each
   * line was cleaned as it arrived (session.ts) and only its first
   * `LOG_TEXT_KEPT` characters are kept. Nothing is written anywhere. When
   * the logs stop coming, the screen is told why, and Enter starts again.
   */
  function startLogs(effect: Extract<Effect, { kind: "logs" }>): void {
    stopLogs()
    const id = ++followed
    const stop = new AbortController()
    following = { id, stop }
    const current = () => following?.id === id && !closed
    let fresh = true
    // At most what the screen keeps waits to be drawn; past that the session reads nothing more until it is.
    const batch = batcher<ShownLine>(LOG_LINES, (lines) => {
      // Lines of a session that was let go never reach the screen.
      if (!current()) return
      // The first lines of a connection replace those of an earlier one: Docker sends its last lines again.
      dispatch({ type: "log-lines", lines, ...(fresh ? { fresh: true } : {}) })
      fresh = false
    })
    const flush = batch.flush
    const onLine = (line: LogLine) => {
      if (!current()) return
      const text = line.text.length <= LOG_TEXT_KEPT ? line.text : [...line.text].slice(0, LOG_TEXT_KEPT).join("")
      return batch.add({ time: line.time, service: line.service, line: text })
    }
    void (async () => {
      let problem: string
      try {
        const plan = await prepareLogs(ops, { app: effect.app, server: effect.server })
        const end = await followLogs(ops, plan, { tail: LOG_TAIL, follow: true, stop: stop.signal }, onLine)
        if (end === "stopped") return
        problem = `Docker stopped sending the logs of ${effect.app}.`
      } catch (error) {
        if (!current()) return
        const reason = reasonOf(error)
        if (reason === undefined) return fail(error)
        problem = sanitize(reason)
      }
      if (!current()) return
      flush()
      following = undefined
      dispatch({ type: "logs-dropped", problem })
    })()
  }

  /** The servers whose runner is being replaced, so one is never replaced twice at once. */
  const updating = new Set<string>()

  /** Replaces a server's runner, after the question was answered, then asks the server again. */
  async function update(effect: Extract<Effect, { kind: "update-runner" }>): Promise<void> {
    if (updating.has(effect.server)) return notice("info", `The runner on ${effect.server} is already being updated.`)
    updating.add(effect.server)
    try {
      await replace(effect)
    } finally {
      updating.delete(effect.server)
    }
  }

  async function replace(effect: Extract<Effect, { kind: "update-runner" }>): Promise<void> {
    const plan = await prepareServerUpdate(ops, effect.server)
    notice("info", `Updating the runner on ${plan.server.name}. The server downloads it and checks it before it replaces the old one.`)
    const result = await updateRunner(ops, plan, { detail: (line) => dispatch({ type: "runner-line", line }) })
    notice(
      "success",
      result.updated
        ? `Updated the runner on ${result.server} to ${result.version}. It matched the checksum this zekno holds.`
        : `The runner on ${result.server} already has version ${result.version}.`
    )
    const { team, server } = await locateServer(ops, effect.server)
    remember(team)
    // The kept session still runs the old runner: a new one is opened, on purpose, and kept instead.
    oneShot.delete(server.name)
    await connect(team, server, true)
  }

  return {
    deps: ops,
    run(effect) {
      switch (effect.kind) {
        case "exit":
          // The shell closes the app itself (app.tsx).
          return
        case "open-app":
          void perform(async () => {
            const { team, server } = await locateServer(ops, effect.server)
            remember(team)
            dispatch({ type: "app-view", server: server.name, app: effect.app, ...appDetails(team, server, effect.app) })
            // A screen that opens reads what is running (contracts/app.md, "Refresh"), in the background.
            if (!closed) await readInBackground(team, server)
          })
          return
        case "refresh":
          refreshStates(effect.server)
          return
        case "logs":
          startLogs(effect)
          return
        case "stop-logs":
          stopLogs()
          return
        case "deploy":
        case "rollback":
          void perform(() => deploy(effect))
          return
        case "deploy-continue":
          void perform(() => goOn(effect))
          return
        case "create-key":
          void perform(async () => {
            await createTeam(ops, effect.name)
            dispatch({ type: "team-created", team: teamView(await openTeam(ops), deps.home) })
          })
          return
        case "add-server":
          void add(effect).catch((error: unknown) => {
            const reason = reasonOf(error)
            if (reason === undefined) fail(error)
            else dispatch({ type: "failed", notice: { tone: "error", text: reason }, from: "add-server" })
          })
          return
        case "update-runner":
          void perform(() => update(effect))
          return
        case "remove-secret":
          void perform(async () => {
            const removed = await removeSecret(ops, effect.name, { app: effect.app, server: effect.server })
            notice("success", `Removed ${removed.name} from ${removed.app} on ${removed.server}. It takes effect on the next deploy.`)
            const { team, server } = await locateServer(ops, effect.server)
            refresh(team, server, effect.app)
          })
          return
      }
    },
    checkServers: () =>
      perform(async () => {
        const team = await openTeam(ops)
        remember(team)
        if (closed) return
        await Promise.all(team.profile.servers.map((server) => connect(team, server, true)))
      }),
    close(options = {}) {
      closed = true
      stopLogs()
      for (const entry of watches.values()) {
        // Each is given a moment to end by itself, then stopped.
        void entry.session?.close(CLOSE_MS)
        letGo(entry)
      }
      watches.clear()
      // On a signal nothing can be waited for: every process is stopped now.
      if (options.now) for (const entry of lettingGo) entry.stop.abort()
      closing ??= Promise.all([...lettingGo].map((entry) => entry.session?.close())).then(() => {})
      return closing
    },
    async saveSecret(where, value) {
      try {
        const planned = await prepareSecretSet(ops, where.name, { app: where.app, server: where.server })
        const set = await setSecret(planned, value)
        dispatch({
          type: "secret-saved",
          notice: { tone: "success", text: `Set ${set.name}, version ${set.version}, for ${set.app} on ${set.server}. It takes effect on the next deploy.` },
        })
        refresh(planned.team, planned.server, planned.app)
      } catch (error) {
        // The operation's sentences never quote the value.
        const reason = reasonOf(error)
        if (reason === undefined) return fail(error)
        dispatch({ type: "secret-refused", notice: { tone: "error", text: reason } })
      }
    },
  }
}
