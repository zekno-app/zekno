/**
 * The profile in the app: read and verified before anything is drawn, the
 * verified team as the screens show it, and the key created on first run.
 */
import { openTeam, TAMPERED, type OpDeps, type Team } from "../../cli/context"
import { createTeam } from "../../ops/init"
import { profileStore } from "../../profile/profile"
import { findProject } from "../../project/file"
import { aboveOf, namedFile } from "../../project/project"
import { notSignedHere, standingOf } from "../../project/signed"
import { tilde } from "../../project/shown"
import { sanitize } from "../../server/sanitize"
import { appsOf } from "../../shared/views"
import type { Effect } from "../state/events"
import type { Start, TeamView } from "../state/types"
import { reasonOf, type Context } from "./context"
import { notConnected } from "./links"

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
      destination:
        server.target.kind === "ssh"
          ? sanitize(server.target.destination)
          : undefined,
      apps: appsOf(team, server, home),
    })),
  }
}

/**
 * The profile is read and verified before anything is drawn (contracts/app.md,
 * "Start"): no profile is first run, a profile that verifies is Home, and one
 * that does not is the error screen with the reason. The screen says in its
 * own words that the folder may have been changed, so that sentence is not
 * repeated after the reason. A zekno.json that applies to `cwd` is judged
 * against the verified team list (project/signed.ts `standingOf`): signed by the
 * team and used here before, Home opens on its server and app ("Linked
 * folder"); signed by the team and not used here before, the app asks first
 * (`firstUse`); one that cannot be used is said on Home, and chooses
 * nothing: one not signed by the team, one that names a server that is not
 * connected, one that cannot be read. Nothing here reaches a server.
 */
export async function loadStart(
  deps: Pick<OpDeps, "home" | "keyStore"> & { cwd?: string }
): Promise<Start> {
  if (!profileStore(deps.home).exists()) return { kind: "no-team" }
  let team: Team
  try {
    team = await openTeam(deps)
  } catch (error) {
    const reason = reasonOf(error)
    if (reason === undefined) throw error
    // A reason can quote a path or a name read from the profile folder.
    return {
      kind: "profile-error",
      reason: sanitize(reason.replace(` ${TAMPERED}`, "")),
      folder: sanitize(tilde(deps.home)),
    }
  }
  const verified: Extract<Start, { kind: "team" }> = {
    kind: "team",
    team: teamView(team, deps.home),
    trust: team.trust,
  }
  if (deps.cwd === undefined) return verified
  try {
    const link = findProject(deps.cwd)
    if (!link) return verified
    // A zekno.json from outside the team would otherwise choose the app that `d` replaces.
    const standing = standingOf(link, team.trust, deps.home)
    if (standing.kind === "unsigned")
      return { ...verified, problem: notSignedHere(link, deps.cwd) }
    // The server it names must be one of the verified team's; the app name was held to its pattern when it was read.
    if (!team.profile.servers.some((server) => server.name === link.server))
      return { ...verified, problem: notConnected(link) }
    const linked = {
      server: link.server,
      app: link.app,
      compose: sanitize(link.compose),
    }
    // A copied file would otherwise deploy someone else's folder: the first time here, the person is asked.
    if (standing.kind === "new") {
      // A file in a folder above is named with its folder and Compose file: that is what a "yes" deploys.
      const above = aboveOf(link, deps.cwd)
      // In this folder, the file it names when that is not compose.yaml, as the single commands ask (security review S6).
      const file = above ? undefined : namedFile(link)
      return {
        ...verified,
        firstUse: {
          ...linked,
          member: standing.member,
          path: link.path,
          sha256: link.sha256,
          ...(above ? { above } : {}),
          ...(file === undefined ? {} : { file }),
        },
      }
    }
    return { ...verified, linked }
  } catch (error) {
    const reason = reasonOf(error)
    if (reason === undefined) throw error
    return { ...verified, problem: sanitize(reason) }
  }
}

/** First run: the key is created with the name typed, and step 2, adding a server, opens. */
export async function createKey(
  context: Context,
  effect: Extract<Effect, { kind: "create-key" }>
): Promise<void> {
  const { deps, ops, dispatch } = context
  await createTeam(ops, effect.name)
  dispatch({
    type: "team-created",
    team: teamView(await openTeam(ops), deps.home),
  })
}
