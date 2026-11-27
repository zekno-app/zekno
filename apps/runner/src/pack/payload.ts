/**
 * The name a staged deploy goes by (specs/016-build-from-source,
 * contracts/runner.md, "Names and paths the runner uses", RB2 step 6):
 * `packs/<app>/deploy.json` names the deploy whose pieces the folder holds
 * by the hash of its signed payload. `pack` stages each piece under it, and
 * K14d (RB4) finds the pieces of the deploy it checks by it, so a piece is
 * only ever used by the deploy that listed it.
 *
 * SHA-256 of the payload's bytes, as 64 lowercase hex. The signature is
 * left out: the same payload signed by another member is the same deploy,
 * with the same pieces. Called only for an envelope the gate has opened, so
 * the payload is base64url in its one spelling.
 */
import { createHash } from "node:crypto"

import type { Envelope } from "@workspace/core"

export function payloadHash(envelope: Pick<Envelope, "payload">): string {
  return createHash("sha256")
    .update(Buffer.from(envelope.payload, "base64url"))
    .digest("hex")
}
