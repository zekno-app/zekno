/**
 * Who signed a project file, and whether that counts: signed by a member of
 * the verified team list, for exactly what its plain fields say (`signerOf`);
 * and how the file stands on this machine (`standingOf`), with what is said
 * when it is not signed by the team. What is done with each standing is
 * `withProject`'s (project.ts).
 */
import { verifyLink, type Member, type TeamTrust } from "@workspace/core"

import { isAccepted } from "./accepted"
import { isHere, type ProjectLink } from "./file"
import { sanitize } from "../server/sanitize"
import { shownPath } from "./shown"

/**
 * The member who signed a project file, when it is signed by the team
 * (data-model.md): `signed` is a link that a member of the verified team
 * list, as it is now, signed for this team and one of its servers
 * (`verifyLink`), and it says exactly what the plain fields say: the same
 * app, the same Compose file, and the server the team list names by the
 * signed id. Undefined for any other file: no signature, another team's, a
 * removed member's, one edited after signing, or one for a server of
 * another name.
 */
export function signerOf(link: ProjectLink, trust: TeamTrust): Member | undefined {
  if (link.signed === undefined) return undefined
  const verified = verifyLink(trust, link.signed)
  if (!verified.ok) return undefined
  const { serverId, app, compose, signer } = verified.value
  const server = trust.servers.find((entry) => entry.serverId === serverId)
  return app === link.app && compose === link.compose && server?.name === link.server ? signer : undefined
}

/**
 * How a project file stands on this machine (data-model.md, "When a project
 * file is used"): not signed by the team; signed by the team and not yet used
 * in its folder here (`new`); or signed and used here before, byte for byte
 * (`used`). `member` is the signer's name from the team list, cleaned.
 */
export type Standing = { kind: "unsigned" } | { kind: "new" | "used"; member: string }

export function standingOf(link: ProjectLink, trust: TeamTrust, profile: string): Standing {
  const signer = signerOf(link, trust)
  if (!signer) return { kind: "unsigned" }
  return { kind: isAccepted(profile, link) ? "used" : "new", member: sanitize(signer.name) }
}

/** Said when a command would take a name from a zekno.json not signed by the team (S1). */
export const notSigned = (link: ProjectLink): string =>
  `zekno.json in ${shownPath(link.folder)} is not signed by your team, so zekno does not use it. It names ${link.app} on ${link.server}. ` +
  "To link this folder yourself, run `zekno link --app <name> --server <name> --force`. To leave the file aside, give --app and --server."

/** The same, as the app says it on Home about the folder it was started in, `cwd`. */
export function notSignedHere(link: ProjectLink, cwd: string): string {
  const which = isHere(link, cwd) ? "zekno.json here" : shownPath(link.path)
  return `${which} is not signed by your team, so zekno does not use it. It names ${link.app} on ${link.server}.`
}
