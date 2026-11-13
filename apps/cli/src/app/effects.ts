/**
 * What the app does outside its state: reading the profile, and running the
 * operations of apps/cli/src/ops/ that the reducer asks for. Each result
 * comes back as an event for the reducer. Nothing here draws anything.
 *
 * While the app is on screen nothing may be written to the terminal behind
 * Ink's back, so what a runner, Docker or SSH write on standard error comes
 * back as events too, never straight to the terminal.
 */
import { CoreError, type RunnerVersion, type TeamTrust } from "@workspace/core"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

import { openTeam, TAMPERED, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import type { InstallEvent } from "../install"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployPlan } from "../ops/deploy"
import { createTeam } from "../ops/init"
import { followLogs, LOG_TAIL, prepareLogs, type LogLine } from "../ops/logs"
import { prepareSecretSet, removeSecret, setSecret } from "../ops/secret"
import { addServer, isOutdated, prepareServerAdd, prepareServerUpdate, updateRunner } from "../ops/server"
import { locateServer, readStatus, stateOf, type AppStates, type RunState } from "../ops/status"
import { profileStore, type Server } from "../profile"
import { RUNNER_RELEASE } from "../runner-release"
import { sanitize } from "../sanitize"
import type { SessionMode } from "../session"
import type { ErrorLines, Target } from "../transport"
import { askingConnect, batchOnly, oneAtATime, wouldHaveAsked, type Terminal } from "./hand-over"
import { LOG_LINES, LOG_TEXT_KEPT, type AddStepName, type AppEvent, type Effect, type Notice, type Start, type TeamView } from "./state"
import { seconds } from "./time"
import { appDetails, appsOf, latestAccepted, secretNamesOf } from "./views"

/** What the app needs from the outside world: what every operation needs. */
export type AppDeps = OpDeps

/**
 * Typed as the SSH destination in "add a server", it adds the runner on this
 * machine instead, for trying zekno out. It is how Home names such a server,
 * and it can never be an SSH destination (it has a space).
 */
export const THIS_MACHINE = "this machine"

/** Said for a key whose screen or action a later part of this feature builds. */
export const NOT_BUILT = "That is not built yet."

/** The Compose file a deploy from the app uses, in the folder the app was started from. */
export const COMPOSE_FILE = "compose.yaml"

/** How long log lines are gathered before they are drawn together, so a burst is drawn once and not line by line. */
export const LOG_BATCH_MS = 50

/**
 * Said for a server that SSH could not reach without asking something, when
 * the app read it on its own. Only what the person does on purpose may ask.
 */
export const needsAnswer = (destination: string): string =>
  `SSH needs an answer to reach ${sanitize(destination)}. zekno asks only when you deploy or open logs, never in the background.`

/** Each app's state from a runner's answer, for `app-states`. With no answer, none is known. */
export function statesFor(states: AppStates | undefined): Record<string, RunState> {
  if (states === undefined) return {}
  return Object.fromEntries(Object.keys(states).map((app) => [app, stateOf(states, app)]))
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

/** A path as a person reads it: under their home folder it starts with `~`. */
export function tilde(path: string, home = homedir()): string {
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/**
 * The profile is read and verified before anything is drawn (contracts/app.md,
 * "Start"): no profile is first run, a profile that verifies is Home, and one
 * that does not is the error screen with the reason. The screen says in its
 * own words that the folder may have been changed, so that sentence is not
 * repeated after the reason. Nothing here reaches a server.
 */
export async function loadStart(deps: Pick<OpDeps, "home" | "keyStore">): Promise<Start> {
  if (!profileStore(deps.home).exists()) return { kind: "no-team" }
  try {
    return { kind: "team", team: teamView(await openTeam(deps), deps.home) }
  } catch (error) {
    const reason = reasonOf(error)
    if (reason === undefined) throw error
    // A reason can quote a path or a name read from the profile folder.
    return { kind: "profile-error", reason: sanitize(reason.replace(` ${TAMPERED}`, "")), folder: sanitize(tilde(deps.home)) }
  }
}

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
   */
  checkServers(): Promise<void>
  /**
   * Stores a value typed in the hidden prompt, then says so with
   * `secret-saved`, or why not with `secret-refused`. The value goes to the
   * secret operation and nowhere else: not into an event, a line or the state.
   */
  saveSecret(where: { server: string; app: string; name: string }, value: string): Promise<void>
  /** The app is closing: the logs being followed are let go, and nothing more is read in the background. */
  close(): void
}

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
  terminal?: Terminal
): Effects {
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

  /** The servers being read now: one read per server at a time, however slow it is. */
  const reading = new Set<string>()
  let closed = false

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

  /** Checks a deploy or rollback on this machine, or says why it cannot go ahead. */
  async function plan(effect: Extract<Effect, { kind: "deploy" | "rollback" }>): Promise<(DeployPlan & { from: string }) | undefined> {
    if (effect.kind === "rollback") {
      const to = effect.to === undefined ? undefined : String(effect.to)
      const rollback = await prepareRollback(ops, { app: effect.app, server: effect.server, to }, { warning: (text) => notice("warning", text) })
      return { ...rollback, from: `what deploy ${rollback.from} ran` }
    }
    if (!effect.app) {
      notice("info", `Choose an app first. To deploy a new app, run zekno deploy --app <name> --server ${effect.server} in its folder.`)
      return undefined
    }
    // Until a folder can be linked to an app, the app deploys compose.yaml from the folder it was started in.
    const path = resolve(ops.cwd, COMPOSE_FILE)
    if (!existsSync(path)) {
      notice("error", `There is no ${COMPOSE_FILE} in ${sanitize(tilde(ops.cwd))}. To deploy another file, run zekno deploy -f <file>.`)
      return undefined
    }
    return { ...(await prepareDeploy(ops, { app: effect.app, server: effect.server, file: COMPOSE_FILE })), from: sanitize(tilde(path)) }
  }

  /** Signs and sends a deploy, with its stages and Docker's lines as events, and its result as a line wherever the person is. */
  async function deploy(effect: Extract<Effect, { kind: "deploy" | "rollback" }>): Promise<void> {
    if (deploying) return notice("info", "A deploy is already in progress.")
    deploying = true
    try {
      const planned = await plan(effect)
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
      let result
      try {
        result = await sendDeploy(ops, planned, {
          stage: (stage, info) => dispatch({ type: "deploy-stage", stage, sequence: info.sequence, secrets: info.secrets }),
          progress: (line) => dispatch({ type: "deploy-progress", line }),
          warning: (text) => notice("warning", text),
        })
      } catch (error) {
        const reason = reasonOf(error)
        if (reason === undefined) return fail(error)
        dispatch({ type: "deploy-ended", outcome: "error", notice: { tone: "error", text: reason }, at: Date.now() })
        return refresh(team, server, app)
      }
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

  /**
   * Asks one server what it holds and what is running, over one connection,
   * and marks it reachable or not, with its runner's version and its apps'
   * state. A server still being read is not asked again: a slow server never
   * piles up connections.
   *
   * In the background (`quietly`, the reads every few seconds and when a
   * screen opens) SSH runs in batch mode only and the terminal is never
   * handed over. Where SSH would have asked, the server counts as not reached
   * and is not read in the background again until the person connects to it
   * on purpose (`asking`).
   */
  async function readServer(team: Pick<Team, "trust">, server: Server, quietly: boolean): Promise<void> {
    const destination = server.target.kind === "ssh" ? server.target.destination : undefined
    if (reading.has(server.name) || (quietly && destination !== undefined && asking.has(destination))) return
    reading.add(server.name)
    // What SSH writes on standard error in the background is only looked at to tell whether it would have asked.
    const lines: string[] = []
    try {
      const result = await readStatus(quietly ? { ...deps, connect: batchOnly(deps.connect, lines) } : ops, { team, server })
      if (closed) return
      dispatch({ type: "server-reached", server: server.name, reachable: true, runner: runnerOf(server.target, result.mode, result.runner, carried) })
      dispatch({ type: "app-states", server: server.name, states: statesFor(result.states) })
    } catch (error) {
      const reason = reasonOf(error)
      if (reason === undefined) throw error
      if (closed) return
      const asks = quietly && destination !== undefined && wouldHaveAsked(lines)
      if (asks) asking.add(destination)
      dispatch({ type: "server-reached", server: server.name, reachable: false, problem: asks ? needsAnswer(destination) : sanitize(reason) })
    } finally {
      reading.delete(server.name)
    }
  }

  /** Reads again, in the background, what is running: on one server, or on every server the app knows. */
  function refreshStates(server: string | undefined): void {
    if (!known || closed) return
    const { team } = known
    for (const entry of known.servers) {
      if (server === undefined || entry.name === server) void readServer(team, entry, true).catch(fail)
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
    let batch: { time: string; service: string; line: string }[] = []
    let fresh = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      clearTimeout(timer)
      timer = undefined
      if (!current() || batch.length === 0) return
      const lines = batch
      batch = []
      // The first lines of a connection replace those of an earlier one: Docker sends its last lines again.
      dispatch({ type: "log-lines", lines, ...(fresh ? { fresh: true } : {}) })
      fresh = false
    }
    const onLine = (line: LogLine) => {
      if (!current()) return
      const text = line.text.length <= LOG_TEXT_KEPT ? line.text : [...line.text].slice(0, LOG_TEXT_KEPT).join("")
      batch.push({ time: line.time, service: line.service, line: text })
      // More than the screen keeps would only be let go of there.
      if (batch.length > LOG_LINES) batch.splice(0, batch.length - LOG_LINES)
      timer ??= setTimeout(flush, LOG_BATCH_MS)
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
    await readServer(team, server, false)
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
            await readServer(team, server, true)
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
        default:
          void perform(async () => notice("info", NOT_BUILT))
      }
    },
    checkServers: () =>
      perform(async () => {
        const team = await openTeam(ops)
        remember(team)
        await Promise.all(team.profile.servers.map((server) => readServer(team, server, false)))
      }),
    close() {
      closed = true
      stopLogs()
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
