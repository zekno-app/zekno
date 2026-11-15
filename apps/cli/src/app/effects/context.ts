/**
 * What the app's effects share: the operations' needs as the app runs them,
 * the events and failures each result becomes, the verified team list last
 * read, and whether the app is closing. createEffects (effects.ts) makes one
 * context, and each concern of this folder is given it.
 */
import { CoreError, type TeamTrust } from "@workspace/core"

import { openTeam, type OpDeps, type Team } from "../../cli/context"
import { CliError, UsageError } from "../../cli/errors"
import type { Server } from "../../profile/profile"
import type { ErrorLines } from "../../server/transport"
import { appDetails, appsOf } from "../../shared/views"
import { RUNNER_RELEASE } from "../../version/runner-release"
import { askingConnect, oneAtATime, type Terminal } from "../hand-over"
import type { AppEvent } from "../state/events"
import type { Notice, Start } from "../state/types"

/** The sentence for a failure a person can act on, or undefined for one nobody planned for. */
export function reasonOf(error: unknown): string | undefined {
  if (error instanceof CliError || error instanceof UsageError) return error.message
  if (error instanceof CoreError) return `That could not be done (${error.code}).`
  return undefined
}

/** The same operations' needs, with standard error sent to `out` instead of the terminal. */
export function routeErrorLines(deps: OpDeps, out: ErrorLines): OpDeps {
  return { ...deps, connect: (target, localRunner, options) => deps.connect(target, localRunner, { errorLines: out, ...options }) }
}

export type Context = {
  /** What the app was given: what every operation needs. */
  deps: OpDeps
  dispatch: (event: AppEvent) => void
  fail: (error: unknown) => void
  /**
   * SSH destinations that SSH could not reach without asking when the app
   * read them on its own. They are not read in the background again until
   * the person connects to them on purpose, which may ask and be answered:
   * a background read every few seconds must never ask, and repeated failed
   * logins could also get this machine shut out by the server.
   */
  asking: Set<string>
  /** How the app connects on purpose: a connection made this way clears the destination from `asking`. */
  purposeful: OpDeps
  /** What operations are run with: standard error comes back as `runner-line` events. */
  ops: OpDeps
  /**
   * The verified team list and servers, from the last time the profile was
   * verified. Reads in the background use them, so the keychain is not
   * opened every few seconds. They hold no key.
   */
  known: { team: Pick<Team, "trust">; servers: readonly Server[] } | undefined
  remember(team: { trust: TeamTrust; profile: { servers: readonly Server[] } }): void
  /** What the app opened on (`loadStart`), when it was a verified team. */
  opened: Extract<Start, { kind: "team" }> | undefined
  /**
   * The verified team list a zekno.json is judged against: the latest this
   * run verified, or the one the app opened with. Only when neither is there
   * is the profile verified again, which reads the keychain; nothing is
   * signed with it. When one is known nothing is awaited, so a question `d`
   * asks is open as soon as `d` was pressed.
   */
  trustKnown(): TeamTrust | undefined
  trustNow(): Promise<TeamTrust>
  /** The app is closing: nothing more is read or kept. */
  closed: boolean
  /** The version of the runner this zekno carries. */
  carried: string
  notice(tone: Notice["tone"], text: string): void
  /** Runs work in the background and reports how it failed, if it did. */
  perform(work: () => Promise<void>): Promise<void>
  /** Reads one app's history and secrets again, and its server's apps for Home. */
  refresh(team: Team, server: Server, app: string): void
}

/**
 * The context of the effects. With a `terminal`, every connection over SSH
 * is made in batch mode first, and the terminal is handed over only when SSH
 * has to ask (hand-over.ts).
 */
export function createContext(
  deps: OpDeps,
  dispatch: (event: AppEvent) => void,
  fail: (error: unknown) => void,
  terminal?: Terminal,
  start?: Start
): Context {
  const base: OpDeps = terminal ? { ...deps, connect: askingConnect(deps.connect, oneAtATime(terminal)) } : deps
  const asking = new Set<string>()
  const purposeful: OpDeps = {
    ...base,
    connect(target, localRunner, options) {
      if (target.kind === "ssh") asking.delete(target.destination)
      return base.connect(target, localRunner, options)
    },
  }
  const ops = routeErrorLines(purposeful, (line) => dispatch({ type: "runner-line", line }))
  const opened = start?.kind === "team" ? start : undefined

  const context: Context = {
    deps,
    dispatch,
    fail,
    asking,
    purposeful,
    ops,
    known: undefined,
    remember(team) {
      context.known = { team: { trust: team.trust }, servers: team.profile.servers }
    },
    opened,
    trustKnown: () => context.known?.team.trust ?? opened?.trust,
    trustNow: async () => context.trustKnown() ?? (await openTeam(ops)).trust,
    closed: false,
    carried: (deps.release ?? RUNNER_RELEASE).version,
    notice: (tone, text) => dispatch({ type: "notice", notice: { tone, text } }),
    perform: (work) =>
      work().catch((error: unknown) => {
        const reason = reasonOf(error)
        if (reason === undefined) fail(error)
        else dispatch({ type: "failed", notice: { tone: "error", text: reason } })
      }),
    refresh(team, server, app) {
      dispatch({ type: "server-apps", server: server.name, apps: appsOf(team, server, deps.home) })
      dispatch({ type: "app-view", server: server.name, app, ...appDetails(team, server, app) })
    },
  }
  return context
}
