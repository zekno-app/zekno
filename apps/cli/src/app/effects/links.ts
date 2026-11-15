/**
 * This folder's zekno.json in the app: what is said when it cannot be used,
 * and `y` to "use it here?", which records a file signed by the team as used
 * in this folder on this machine.
 */
import { accept } from "../../project/accepted"
import { findProject, type ProjectLink } from "../../project/file"
import { notSignedHere, standingOf } from "../../project/signed"
import { shownPath } from "../../project/shown"
import { sanitize } from "../../server/sanitize"
import type { Effect } from "../state/events"
import type { Context } from "./context"

/** Said when a zekno.json names a server this machine is not connected to: it then chooses nothing. */
export const notConnected = (link: ProjectLink): string => `${shownPath(link.path)} names a server "${link.server}" that is not connected to this machine.`

/**
 * Said when `d` is pressed in a folder whose zekno.json, signed by the team,
 * was not used here: "not now" was the answer when the app opened, or it
 * changed since. It is asked about again the next time the app opens.
 */
export const NOT_IN_USE = "This folder's zekno.json is not in use. Open zekno here again to be asked."

/** Said when `y` answers a question about a zekno.json that has changed since it was asked: it is not used. */
export const LINK_CHANGED = "zekno.json here changed after zekno opened, so it was not used. Open zekno here again to be asked."

/**
 * Said when `d` is pressed in a linked folder on a server with no apps that
 * is not the folder's own: there is no app there to deploy it to.
 */
export const linkedElsewhere = (link: Pick<ProjectLink, "app" | "server">): string =>
  `This folder is linked to ${link.app} on ${link.server}. Select it to deploy this folder. ` +
  "To deploy it elsewhere, run `zekno deploy --app <name> --server <name>` here."

/**
 * `y` to "use it here?": this folder's zekno.json is judged again, and is
 * recorded as used here only while it is still signed by the team, names
 * what the question named, and is the very file that was shown, byte for
 * byte. Then Home moves to its app, as for a linked folder, and nothing
 * more is said.
 */
export async function useLink(context: Context, effect: Extract<Effect, { kind: "use-link" }>): Promise<void> {
  const { deps, ops, opened, dispatch, notice, trustNow } = context
  const link = findProject(ops.cwd)
  if (!link) return notice("error", LINK_CHANGED)
  const standing = standingOf(link, await trustNow(), deps.home)
  if (standing.kind === "unsigned") return notice("error", notSignedHere(link, ops.cwd))
  const shown = opened?.firstUse
  const same = link.app === effect.app && link.server === effect.server && (shown === undefined || (shown.path === link.path && shown.sha256 === link.sha256))
  if (!same) return notice("error", LINK_CHANGED)
  if (standing.kind === "new") accept(deps.home, link)
  dispatch({ type: "link-used", linked: { server: link.server, app: link.app, compose: sanitize(link.compose) } })
}
