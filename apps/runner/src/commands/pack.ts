/**
 * `pack` (specs/016-build-from-source, contracts/runner.md RB2; core.md
 * CO9, CO12; FR-028, FR-040, FR-069): one sealed piece of a signed deploy,
 * staged before the deploy is sent, in a session only. A piece is staged
 * only for a deploy that would pass the gate now and lists it, so nobody
 * but a team member can fill the server's disk, and the deploy itself then
 * uploads nothing.
 *
 * Under the state lock only (RB1), never the deploy lock, so a piece is
 * staged while another deploy builds; in RB2's order: the request (and the
 * piece's bound once decoded); CO9's gate, K4 to K10 with F7, using nothing
 * up and opening no secret; the piece listed by one of the deploy's builds;
 * the cleaning of `packs/`; the free disk of `<home>`, read with `statfs`
 * only, less the piece, against the floor; staging past 2 GiB with it; then
 * the piece written by its fingerprint and `{ staged }`. No Docker call is
 * made and no piece is opened: a piece is opened in RB4, for a deploy that
 * can run. Once the request reads, RB15's bounded part comes first
 * (`boundedFirst`): when the state's `building` is set, the deploy lock is
 * tried once and released before the state lock is taken (RB1, RB2).
 */
import {
  admitPiece,
  LIMITS,
  parseMessage,
  RunnerPackRequestSchema,
  type Envelope,
  type RunnerPack,
  type RunnerReport,
} from "@workspace/core"
import { lstatSync, readdirSync, statfsSync } from "node:fs"
import { join } from "node:path"

import { belowFloor, leastFree, type StatFs } from "../disk/free"
import { paths } from "../home/home"
import { payloadHash } from "../pack/payload"
import {
  cleanPacks,
  readStagedDeploy,
  stagedBytes,
  stagePiece,
  type DeployOfPieces,
} from "../pack/stage"
import { boundedFirst, refused, withState, type StateWait } from "./commands"

/** How long the state lock is waited for, and, for in-process tests, a stand-in for the filesystem's free space. */
export type PackOptions = StateWait & { statfs?: StatFs }

/** base64url without padding, as the request's schema reads a piece. */
const BASE64URL = /^[A-Za-z0-9_-]+$/
/** A staged piece's name: its fingerprint. */
const HEX64 = /^[0-9a-f]{64}$/

/**
 * A request in the schema's form but for a piece longer than the schema
 * lets through: such a piece is over its bound once decoded, which CO10 and
 * CO12 make `pack_mismatch`, not a request that does not read. Undefined for
 * anything else the schema refused.
 */
function longPiece(
  input: string
): { envelope: Envelope; piece: string } | undefined {
  if (input.length > LIMITS.messageBytes) return undefined
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined
  const { piece } = value as { piece?: unknown }
  if (typeof piece !== "string" || !BASE64URL.test(piece)) return undefined
  // Every other part as the schema holds it, with a piece it lets through.
  const rest = parseMessage(RunnerPackRequestSchema, { ...value, piece: "AA" })
  return rest.ok ? { envelope: rest.value.envelope, piece } : undefined
}

/**
 * The request (RB2 step 1): the envelope as the schema reads it, and the
 * piece's bytes. Undefined when it is not `{ envelope, piece }`, or when the
 * piece is not base64url's one spelling of its bytes.
 */
function readRequest(
  input: string
): { envelope: Envelope; piece: Uint8Array } | undefined {
  const strict = parseMessage(RunnerPackRequestSchema, input)
  const request = strict.ok ? strict.value : longPiece(input)
  if (request === undefined) return undefined
  const piece = Buffer.from(request.piece, "base64url")
  if (piece.toString("base64url") !== request.piece) return undefined
  return { envelope: request.envelope, piece }
}

/** The size of a plain file, or 0 when there is none. */
function sizeOf(path: string): number {
  try {
    const info = lstatSync(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/** The bytes of the pieces in one app's folder, counted as `stagedBytes` counts them. */
function piecesIn(folder: string): number {
  let entries: string[]
  try {
    entries = readdirSync(folder)
  } catch {
    return 0
  }
  return entries
    .filter((entry) => HEX64.test(entry))
    .reduce((sum, entry) => sum + sizeOf(join(folder, entry)), 0)
}

/**
 * What staging holds once this piece is written (RB2 step 6, "past 2 GiB
 * with this piece"): every piece staged now, less what the write takes
 * away, plus this piece. `stagePiece` empties `packs/<app>/` first when it
 * holds another deploy's pieces, and a piece sent again takes the place of
 * its earlier copy, so neither is counted twice.
 */
function stagedWith(
  dir: string,
  app: string,
  deploy: DeployOfPieces,
  fingerprint: string,
  bytes: number
): number {
  const staged = readStagedDeploy(dir, app)
  const same =
    staged !== undefined &&
    staged.payload === deploy.payload &&
    staged.previous === deploy.previous
  const replaced = same
    ? sizeOf(paths(dir).packPiece(app, fingerprint))
    : piecesIn(paths(dir).packs(app))
  return stagedBytes(dir) - replaced + bytes
}

/**
 * Stages one sealed piece (RB2), or says why not: `invalid_request` for a
 * request that does not read; `pack_mismatch` for a piece over
 * `LIMITS.sealedPieceBytes` or one no build of the deploy lists; a reason
 * of the gate; `low_disk` with `disk` when the free disk of `<home>` less
 * the piece would fall below `LIMITS.diskFloorBytes` (a filesystem that
 * cannot be read counts as none free, RB6); `too_large` past
 * `LIMITS.stagingBytes`; `busy` once the state lock's wait has passed; and
 * the folder's and the state's own refusals. The answer is `{ staged }`
 * with the piece's fingerprint.
 */
export async function pack(
  dir: string,
  input: string,
  options: PackOptions = {}
): Promise<RunnerPack | RunnerReport> {
  const request = readRequest(input)
  if (request === undefined) return refused("invalid_request")
  // RB15's bounded part, under the deploy lock tried once, before the state lock (D before S).
  await boundedFirst(dir)
  const statfs = options.statfs ?? statfsSync
  return withState<RunnerPack | RunnerReport>(
    dir,
    (loaded) => {
      const now = new Date()
      // RB2 steps 1 to 3: the bound, the gate (K4 to K10, F7), the listing. Nothing used up, nothing opened.
      const admitted = admitPiece({
        envelope: request.envelope,
        state: loaded.state,
        now,
        piece: request.piece,
      })
      if (!admitted.ok) return refused(admitted.error.code)
      const { deploy, fingerprint } = admitted.value

      // Step 4: the deploys that can no longer run, the pieces past a day, staging past 2 GiB.
      cleanPacks(dir, loaded.state, now)

      // Step 5: staging never fills the disk under the running apps (FR-040).
      const free = leastFree([dir], statfs)
      if (belowFloor(free, request.piece.length))
        return {
          ...refused("low_disk"),
          disk: { free, floor: LIMITS.diskFloorBytes },
        }

      // Step 6: within 2 GiB with it, then written by its fingerprint under its deploy's name.
      const named: DeployOfPieces = {
        payload: payloadHash(request.envelope),
        previous: deploy.previous,
      }
      if (
        stagedWith(dir, deploy.app, named, fingerprint, request.piece.length) >
        LIMITS.stagingBytes
      )
        return refused("too_large")
      stagePiece(dir, deploy.app, named, fingerprint, request.piece, now)
      return { staged: fingerprint }
    },
    { waitMs: options.waitMs }
  )
}
