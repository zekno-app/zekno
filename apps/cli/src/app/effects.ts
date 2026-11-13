/**
 * What the app does outside its state: reading the profile, and running the
 * operations of apps/cli/src/ops/ that the reducer asks for. Each result
 * comes back as an event for the reducer. Nothing here draws anything.
 *
 * While the app is on screen nothing may be written to the terminal behind
 * Ink's back, so what a runner, Docker or SSH write on standard error comes
 * back as events too, never straight to the terminal.
 */
import { CoreError, type RunnerVersion } from "@workspace/core"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

import { openTeam, TAMPERED, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import type { InstallEvent } from "../install"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployPlan } from "../ops/deploy"
import { createTeam } from "../ops/init"
import { prepareSecretSet, removeSecret, setSecret } from "../ops/secret"
import { addServer, isOutdated, prepareServerAdd, prepareServerUpdate, updateRunner } from "../ops/server"
import { locateServer, readStatus } from "../ops/status"
import { profileStore, type Server } from "../profile"
import { RUNNER_RELEASE } from "../runner-release"
import { sanitize } from "../sanitize"
import type { SessionMode } from "../session"
import type { ErrorLines, Target } from "../transport"
import { askingConnect, oneAtATime, type Terminal } from "./hand-over"
import type { AddStepName, AppEvent, Effect, Notice, Start, TeamView } from "./state"
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
  const ops = routeErrorLines(base, (line) => dispatch({ type: "runner-line", line }))
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
      const lines = routeErrorLines(base, (line) => dispatch({ type: "add-line", line }))
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

  /** Asks one server what it holds, and marks it reachable or not, with its runner's version. */
  async function checkServer(team: Team, server: Server): Promise<void> {
    try {
      const result = await readStatus(ops, { team, server })
      dispatch({ type: "server-reached", server: server.name, reachable: true, runner: runnerOf(server.target, result.mode, result.runner, carried) })
    } catch (error) {
      const reason = reasonOf(error)
      if (reason === undefined) throw error
      dispatch({ type: "server-reached", server: server.name, reachable: false, problem: sanitize(reason) })
    }
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
    await checkServer(team, server)
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
            dispatch({ type: "app-view", server: server.name, app: effect.app, ...appDetails(team, server, effect.app) })
          })
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
        await Promise.all(team.profile.servers.map((server) => checkServer(team, server)))
      }),
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
