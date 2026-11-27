/**
 * The gate of a version-2 deploy, K4 to K10 of contracts/runner-checks.md in
 * their order (specs/016-build-from-source, contracts/core.md, CO9): the
 * envelope, the signer and the signature, the payload with F4 to F7, the
 * role, team, team list and server, `previous`, and the expiry. It uses
 * nothing up and opens no secret; `verifyDeployV2` runs it first, and
 * `admitPiece` runs it for the runner's `pack`.
 */
import { openEnvelope, PAYLOAD_TYPES } from "../crypto/envelope"
import { pieceFingerprint } from "../pack/pieces"
import { LIMITS } from "../protocol/limits"
import {
  CoreError,
  ok,
  refuse,
  type DeployV2Refusal,
  type Result,
} from "../protocol/result"
import { verifySecret } from "../secrets/secret-record"
import { memberByKeyId, serverKeyOf, type Member } from "../team/roster"
import { DEPLOY_ROLES } from "./deploy"
import type { VerifiedDeployV2 } from "./deploy-v2"
import { readDeployV2PayloadBytes, type DeployV2 } from "./message"
import { readMarked, type StoredRunnerState } from "./state"

export const isTime = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime())

/**
 * K4 to K10 of a version-2 deploy against `state`, in their order; the first
 * that fails is the answer, and nothing is changed or decrypted. It gives
 * the deploy, the member who signed it, and `state` as read by `readMarked`.
 * `now` is the runner's clock, the only check that reads one; `via` says
 * where the deploy came from: one taken from the hosted service must carry
 * an expiry.
 */
export function gateDeployV2(input: {
  envelope: unknown
  state: StoredRunnerState
  now: Date
  via: "session" | "hosted service"
}): Result<
  { deploy: DeployV2; signer: Member; state: StoredRunnerState },
  DeployV2Refusal
> {
  const state = readMarked(input.state)
  if (
    !isTime(input.now) ||
    (input.via !== "session" && input.via !== "hosted service")
  ) {
    throw new CoreError(
      "invalid_argument",
      "A deploy is checked against a clock, where it came from, and the records held."
    )
  }

  // K4, K5. The envelope's size, shape and kind; then the signer and the signature.
  const opened = openEnvelope(
    input.envelope,
    PAYLOAD_TYPES.deployV2,
    (keyId) => memberByKeyId(state.team.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const signer = state.team.members.find(
    (member) => member.publicKey === opened.value.signerKey
  )!

  // K6, K7. Only now is the payload read: its format in its one spelling, then a later field.
  const read = readDeployV2PayloadBytes(opened.value.payload)
  if (!read.ok) return read
  const deploy = read.value
  const app = deploy.app

  // K8. Who signed it, and for whom.
  if (!DEPLOY_ROLES.includes(signer.role))
    return refuse(
      "role_not_allowed",
      "The signer's role does not allow deploys."
    )
  if (deploy.teamId !== state.team.teamId)
    return refuse("wrong_team", "This deploy belongs to another team.")
  if (deploy.teamHash !== state.team.hash) {
    return refuse(
      "stale_team",
      "The signer and this server are on different versions of the team list."
    )
  }
  if (deploy.serverId !== state.serverId)
    return refuse("wrong_server", "This deploy is addressed to another server.")
  if (!serverKeyOf(state.team, state.serverId))
    return refuse("unknown_server", "This server is not in the team list.")

  // K9. The order: made against exactly the app's last number here.
  const last = Object.hasOwn(state.lastSequence, app)
    ? state.lastSequence[app]!
    : 0
  if (deploy.previous < last) {
    return refuse(
      "replayed",
      "Another deploy of this app was accepted after the one this deploy was made against."
    )
  }
  if (deploy.previous > last) {
    return refuse(
      "sequence_jump",
      "This deploy was made after a deploy this server does not hold."
    )
  }

  // K10. The expiry, by the runner's clock. The order above never depends on it.
  if (deploy.expiresAt === null) {
    if (input.via === "hosted service")
      return refuse(
        "expired",
        "A deploy taken from the hosted service must carry an expiry."
      )
  } else {
    const left = Date.parse(deploy.expiresAt) - input.now.getTime()
    if (left <= 0)
      return refuse("expired", "The time this deploy had to run has passed.")
    if (left > LIMITS.expiryWindowMs)
      return refuse(
        "expired",
        "This deploy's expiry is further ahead than the limit."
      )
  }

  return ok({ deploy, signer, state })
}

/**
 * The gate of the runner's `pack` (specs/016-build-from-source,
 * contracts/core.md CO9, CO12; FR-028; runner.md RB2 steps 2 and 3): a
 * piece is staged only for a deploy that would pass K4 to K10 now, as one
 * sent on a session, and only when that deploy lists it. A piece longer than
 * a sealed piece may be is `pack_mismatch` before anything is hashed; then
 * K4 to K10 with F7; then the piece's fingerprint must be in some build's
 * `pack.chunks`, or be a Railpack build's `plan.piece`, else `pack_mismatch`.
 * It uses nothing up, opens no secret, registers nothing (so `openSecrets`
 * and `openPiece` answer its result `not_verified`) and changes no state.
 */
export function admitPiece(input: {
  envelope: unknown
  state: StoredRunnerState
  now: Date
  piece: Uint8Array
}): Result<{ deploy: DeployV2; fingerprint: string }, DeployV2Refusal> {
  if (!(input.piece instanceof Uint8Array))
    throw new CoreError("invalid_argument", "A piece is given as bytes.")
  // RB2 step 2. The bound, before the envelope or the piece is hashed.
  if (input.piece.length > LIMITS.sealedPieceBytes)
    return refuse(
      "pack_mismatch",
      "This piece is larger than a sealed piece may be."
    )
  // K4 to K10, F7 among them, as for a deploy sent on a session.
  const gated = gateDeployV2({
    envelope: input.envelope,
    state: input.state,
    now: input.now,
    via: "session",
  })
  if (!gated.ok) return gated
  const { deploy } = gated.value
  // RB2 step 3. A piece the deploy lists: a code piece, or a Railpack build's plan piece.
  const fingerprint = pieceFingerprint(input.piece)
  const listed = deploy.builds.some(
    (build) =>
      build.pack.chunks.includes(fingerprint) ||
      (build.builder.name === "railpack" &&
        build.builder.plan.piece === fingerprint)
  )
  if (!listed)
    return refuse("pack_mismatch", "The deploy does not list this piece.")
  return ok({ deploy, fingerprint })
}

/**
 * Whether a verified deploy still counts under the team lists now in
 * `state` (specs/016-build-from-source, contracts/core.md CO9; FR-043,
 * FR-044): the runner asks it whenever they may have changed since K4 to
 * K14, at K17, before and every 5 seconds during each build, and at B3 (RB3,
 * RB10). K8 again: the signer is still a member, with a role that may
 * deploy; the deploy is for the state's team and server; the server is
 * still in the team list. Never the team hash, which every team list update
 * changes. And K13 again: every record K13 verified for the deploy, supplied
 * or held, verifies again, so a removed member's secret stops counting
 * during a build too (part 4.5 of deploy-v2.md). A version-2 payload's
 * removals carry a name and a version only, so there is no signed removal
 * to verify again.
 */
export function stillAllowed(
  state: StoredRunnerState,
  verified: VerifiedDeployV2
): boolean {
  const marked = readMarked(state)
  const { deploy } = verified
  // K8. Who signed it, by the role the team list gives the signer now.
  const signer = marked.team.members.find(
    (member) => member.publicKey === verified.signer.publicKey
  )
  if (
    signer === undefined ||
    !DEPLOY_ROLES.includes(signer.role) ||
    deploy.teamId !== marked.team.teamId ||
    deploy.serverId !== marked.serverId ||
    !serverKeyOf(marked.team, marked.serverId)
  )
    return false
  // K13. Each record the deploy used, against the team list now.
  return verified.used.every(
    (record) =>
      verifySecret({
        record,
        trust: marked.team,
        serverId: marked.serverId,
        app: deploy.app,
      }).ok
  )
}
