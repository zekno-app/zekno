/**
 * The gate of a version-2 deploy, K4 to K10 of contracts/runner-checks.md in
 * their order (specs/016-build-from-source, contracts/core.md, CO9): the
 * envelope, the signer and the signature, the payload with F4 to F7, the
 * role, team, team list and server, `previous`, and the expiry. It uses
 * nothing up and opens no secret; `verifyDeployV2` runs it first.
 */
import { openEnvelope, PAYLOAD_TYPES } from "../crypto/envelope"
import { LIMITS } from "../protocol/limits"
import {
  CoreError,
  ok,
  refuse,
  type DeployV2Refusal,
  type Result,
} from "../protocol/result"
import { memberByKeyId, serverKeyOf, type Member } from "../team/roster"
import { DEPLOY_ROLES } from "./deploy"
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
