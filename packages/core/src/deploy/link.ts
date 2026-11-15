import { z } from "zod"

import { DEPLOY_ROLES } from "./deploy"
import { isWellFormed, utf8 } from "../crypto/encoding"
import { hasOtherVersion, openEnvelope, parseJson, PAYLOAD_TYPES, signEnvelope, type Envelope } from "../crypto/envelope"
import type { Signer } from "../crypto/keys"
import { LIMITS } from "../protocol/limits"
import { CoreError, ok, refuse, type LinkRefusal, type Result } from "../protocol/result"
import { assertTrust, memberByKeyId, serverKeyOf, TEAM_ID, type Member, type TeamTrust } from "../team/roster"
import { APP_NAME, SERVER_ID } from "../secrets/secrets"

/**
 * Whether a path stays inside the folder it is relative to, read as any
 * system reads it: not absolute, no backslash (a separator elsewhere), and
 * no `.` or `..` part. A client that resolves it must then not leave the
 * folder through it, whatever it does with symbolic links.
 */
const staysInside = (path: string): boolean =>
  !path.startsWith("/") && !path.includes("\\") && !path.split("/").some((part) => part === "." || part === "..")

/**
 * The Compose file's path, relative to the linked folder. A person reads it
 * before using the link, so it holds no control, format or line-separator
 * character, which covers bidirectional overrides and zero-width characters.
 * It never names a file outside the folder (`staysInside`).
 */
const composePath = z
  .string()
  .min(1)
  .max(LIMITS.linkComposeLength)
  .refine((path) => isWellFormed(path) && !/[\p{C}\u2028\u2029]/u.test(path))
  .refine(staysInside)

/**
 * What a link says: this team's folder deploys this app to this server from
 * this Compose file. The team is named by id only, not by the hash of a team
 * list, so a link outlives later team lists; whether its signer still counts
 * is decided by the team list the verifier holds now. No time is in it, so
 * the same content always gives the same bytes.
 */
const LinkSchema = z.strictObject({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID),
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  compose: composePath,
})

/** A link that passed verification against the team list. */
export type VerifiedLink = {
  readonly serverId: string
  readonly app: string
  readonly compose: string
  /** The member who signed it, as the team list names them now. */
  readonly signer: Member
}

/**
 * Signs a member's statement that a folder deploys `app` to one of the
 * team's servers from the Compose file at `compose`, relative to the folder.
 * It says nothing about which folder: the client that reads it decides that,
 * and must not take a link found in a folder as proof that it was made there.
 */
export async function createLink(input: {
  trust: TeamTrust
  serverId: string
  app: string
  compose: string
  signer: Signer
}): Promise<Envelope> {
  assertTrust(input.trust)
  if (!input.trust.members.some((member) => member.publicKey === input.signer.publicKey)) {
    throw new CoreError("not_member", "The signer is not a member of this team.")
  }
  if (!serverKeyOf(input.trust, input.serverId)) {
    throw new CoreError("unknown_server", "This server is not in the team list.")
  }
  const link = {
    v: 1 as const,
    teamId: input.trust.teamId,
    serverId: input.serverId,
    app: input.app,
    compose: input.compose,
  }
  if (!LinkSchema.safeParse(link).success) {
    throw new CoreError("invalid_argument", "The app name or the Compose file's path is not valid.")
  }
  return signEnvelope(PAYLOAD_TYPES.link, utf8(JSON.stringify(link)), input.signer)
}

/**
 * Checks a link that came from a file anyone could have written: signed as a
 * link (never another kind of message), by a member of the team list held
 * now whose role may deploy, for this team, naming one of this team's
 * servers. A member removed since, or a server taken off the list, makes it
 * stop counting.
 */
export function verifyLink(trust: TeamTrust, envelope: unknown): Result<VerifiedLink, LinkRefusal> {
  assertTrust(trust)
  // 1. Signature, against the team list held now. The size is checked before anything is parsed.
  const opened = openEnvelope(envelope, PAYLOAD_TYPES.link, (keyId) => memberByKeyId(trust.members, keyId)?.publicKey)
  if (!opened.ok) return opened
  const signer = trust.members.find((member) => member.publicKey === opened.value.signerKey)!

  // 2. Only now is the content parsed.
  const json = parseJson(opened.value.payload)
  if (json === undefined) return refuse("malformed", "The link is not valid JSON.")
  if (hasOtherVersion(json)) {
    return refuse("unsupported_version", "This link uses a format version this library does not know.")
  }
  const parsed = LinkSchema.safeParse(json)
  if (!parsed.success) return refuse("malformed", "The link does not match its definition.")
  const link = parsed.data

  // 3. Who signed it, and for whom. Every role there is today may deploy (`ROLES` equals
  // `DEPLOY_ROLES`), so this refuses nothing yet; it is kept for a role that may not deploy.
  if (!DEPLOY_ROLES.includes(signer.role)) {
    return refuse("role_not_allowed", "The signer's role does not allow deploys.")
  }
  if (link.teamId !== trust.teamId) return refuse("wrong_team", "This link belongs to another team.")
  if (!serverKeyOf(trust, link.serverId)) return refuse("unknown_server", "This link names a server that is not in the team list.")
  return ok(Object.freeze({ serverId: link.serverId, app: link.app, compose: link.compose, signer }))
}
