/**
 * What the app does outside its state: reading the profile, and running the
 * operations of apps/cli/src/ops/ that the reducer asks for. Each result
 * comes back as an event for the reducer. Nothing here draws anything.
 *
 * While the app is on screen nothing may be written to the terminal behind
 * Ink's back, so what a runner, Docker or SSH write on standard error comes
 * back as events too, never straight to the terminal.
 *
 * This file puts the effects together and says which concern runs each
 * effect. The concerns are the other files of this folder: what they share
 * (context.ts), the profile (profile.ts), reading the servers (servers.ts),
 * deploys and rollbacks (deploys.ts), this folder's zekno.json (links.ts),
 * logs (logs.ts, with batcher.ts), adding a server (add-server.ts), updating
 * a runner (update-runner.ts) and secrets (secrets.ts).
 */
import type { OpDeps } from "../../cli/context"
import { locateServer } from "../../ops/status"
import { appDetails } from "../../shared/views"
import type { Terminal } from "../hand-over"
import type { AppEvent, Effect } from "../state/events"
import type { Start } from "../state/types"
import { createAdding } from "./add-server"
import { createContext, reasonOf } from "./context"
import { createDeploys } from "./deploys"
import { useLink } from "./links"
import { createLogs } from "./logs"
import { createKey } from "./profile"
import { removeChosenSecret, saveSecret } from "./secrets"
import { createServers, type Timing } from "./servers"
import { createRunnerUpdates } from "./update-runner"

/** What the app needs from the outside world: what every operation needs. */
export type AppDeps = OpDeps

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

/**
 * Runs the effects the reducer asks for. A failure a person can act on
 * becomes a line on the screen and the app carries on; anything else is
 * passed to `fail`, which closes the app and restores the terminal.
 *
 * With a `terminal`, every connection over SSH is made in batch mode first,
 * and the terminal is handed over only when SSH has to ask (hand-over.ts).
 * `start` is what the app opened on (`loadStart`): the verified team list
 * this folder's zekno.json was judged against, and the file it asks about.
 */
export function createEffects(
  deps: AppDeps,
  dispatch: (event: AppEvent) => void,
  fail: (error: unknown) => void,
  terminal?: Terminal,
  timing: Timing = {},
  start?: Start
): Effects {
  const context = createContext(deps, dispatch, fail, terminal, start)
  const { ops, remember, perform } = context
  const servers = createServers(context, timing)
  const deploys = createDeploys(context)
  const logs = createLogs(context)
  const adding = createAdding(context, servers)
  const updates = createRunnerUpdates(context, servers)

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
            if (!context.closed) await servers.readInBackground(team, server)
          })
          return
        case "refresh":
          servers.refreshStates(effect.server)
          return
        case "logs":
          logs.startLogs(effect)
          return
        case "stop-logs":
          logs.stopLogs()
          return
        case "deploy":
        case "rollback":
          void perform(() => deploys.deploy(effect))
          return
        case "deploy-continue":
          void perform(() => deploys.goOn(effect))
          return
        case "create-key":
          void perform(() => createKey(context, effect))
          return
        case "add-server":
          void adding.add(effect).catch((error: unknown) => {
            const reason = reasonOf(error)
            if (reason === undefined) fail(error)
            else dispatch({ type: "failed", notice: { tone: "error", text: reason }, from: "add-server" })
          })
          return
        case "update-runner":
          void perform(() => updates.update(effect))
          return
        case "connect":
          void perform(() => servers.connectOnPurpose(effect.server))
          return
        case "use-link":
          void perform(() => useLink(context, effect))
          return
        case "remove-secret":
          void perform(() => removeChosenSecret(context, effect))
          return
      }
    },
    checkServers: servers.checkServers,
    close(options = {}) {
      context.closed = true
      logs.stopLogs()
      return servers.close(options)
    },
    saveSecret: (where, value) => saveSecret(context, where, value),
  }
}
