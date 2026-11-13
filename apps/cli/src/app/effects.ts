/**
 * What the app does outside its state: reading the profile, and running the
 * operations of apps/cli/src/ops/ that the reducer asks for. Each result
 * comes back as an event for the reducer. Nothing here draws anything.
 *
 * While the app is on screen nothing may be written to the terminal behind
 * Ink's back, so what a runner, Docker or SSH write on standard error comes
 * back as events too, never straight to the terminal.
 */
import { CoreError } from "@workspace/core"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

import { openTeam, TAMPERED, type OpDeps, type Team } from "../context"
import { CliError, UsageError } from "../errors"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployPlan } from "../ops/deploy"
import { prepareSecretSet, removeSecret, setSecret } from "../ops/secret"
import { locateServer, readStatus } from "../ops/status"
import { profileStore, type Server } from "../profile"
import { sanitize } from "../sanitize"
import type { ErrorLines } from "../transport"
import type { AppEvent, Effect, Notice, Start, TeamView } from "./state"
import { seconds } from "./time"
import { appDetails, appsOf, latestAccepted, secretNamesOf } from "./views"

/** What the app needs from the outside world: what every operation needs. */
export type AppDeps = OpDeps

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

/**
 * Runs the effects the reducer asks for. A failure a person can act on
 * becomes a line on the screen and the app carries on; anything else is
 * passed to `fail`, which closes the app and restores the terminal.
 */
export function createEffects(deps: AppDeps, dispatch: (event: AppEvent) => void, fail: (error: unknown) => void): Effects {
  const ops = routeErrorLines(deps, (line) => dispatch({ type: "runner-line", line }))
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
        await Promise.all(
          team.profile.servers.map(async (server) => {
            try {
              await readStatus(ops, { team, server })
              dispatch({ type: "server-reached", server: server.name, reachable: true })
            } catch (error) {
              const reason = reasonOf(error)
              if (reason === undefined) throw error
              dispatch({ type: "server-reached", server: server.name, reachable: false, problem: sanitize(reason) })
            }
          })
        )
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
