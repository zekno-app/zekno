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
import { homedir } from "node:os"

import { openTeam, TAMPERED, type OpDeps, type Team } from "../context"
import { CliError } from "../errors"
import { profileStore } from "../profile"
import { sanitize } from "../sanitize"
import type { ErrorLines } from "../transport"
import type { AppEvent, Effect, Notice, Start, TeamView } from "./state"

/** What the app needs from the outside world: what every operation needs. */
export type AppDeps = OpDeps

/** Said for a key whose screen or action a later part of this feature builds. */
export const NOT_BUILT = "That is not built yet."

/**
 * The verified team as the screens show it. `openTeam` proves the team lists
 * and the server names; the member's name and each server's address are
 * plain text in the profile folder, which anything on this machine could
 * have changed, so they are cleaned like text from a server before anyone
 * sees them.
 */
export function teamView(team: Team): TeamView {
  return {
    member: sanitize(team.profile.memberName),
    version: team.trust.version,
    servers: team.profile.servers.map((server) => ({
      name: server.name,
      destination: server.target.kind === "ssh" ? sanitize(server.target.destination) : undefined,
      apps: [],
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
    return { kind: "team", team: teamView(await openTeam(deps)) }
  } catch (error) {
    const reason = reasonOf(error)
    if (reason === undefined) throw error
    // A reason can quote a path or a name read from the profile folder.
    return { kind: "profile-error", reason: sanitize(reason.replace(` ${TAMPERED}`, "")), folder: sanitize(tilde(deps.home)) }
  }
}

/** The sentence for a failure a person can act on, or undefined for one nobody planned for. */
function reasonOf(error: unknown): string | undefined {
  if (error instanceof CliError) return error.message
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
  const perform = (work: () => Promise<void>): void => {
    void work().catch((error: unknown) => {
      const reason = reasonOf(error)
      if (reason === undefined) fail(error)
      else dispatch({ type: "failed", notice: { tone: "error", text: reason } })
    })
  }

  return {
    deps: ops,
    run(effect) {
      switch (effect.kind) {
        case "exit":
          // The shell closes the app itself (app.tsx).
          return
        default:
          perform(async () => notice("info", NOT_BUILT))
      }
    },
  }
}
