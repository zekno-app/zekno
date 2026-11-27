/**
 * Checking the code before the number (specs/016-build-from-source,
 * contracts/runner.md RB4, RB3 K14d; data-model.md, "Staging and work
 * folders"; FR-029, FR-030, FR-031, SC-006).
 *
 * K14d has two parts. `moveToBuilding`, under the state lock: when every
 * piece the builds not kept list is staged for this deploy, they are moved
 * from `packs/<app>/` to `building/<app>/`, emptied first; else the answer
 * is `pack_missing` with the pieces it lacks, and nothing moves. Then
 * `checkBuild`, under the deploy lock alone (RB1: no piece is read while the
 * state lock is held): each piece of a build, in order, opened with the
 * server's key by core's `openPiece` to exactly its length, fed to core's
 * checker, which hashes the pack as it streams and accepts only the one
 * form, the signed size and the signed fingerprint. A Dockerfile build's
 * pack must also hold a regular file under exactly the signed name, byte for
 * byte, since BuildKit's reader would otherwise fall back to a file named
 * `dockerfile`. On `pack_mismatch`, `building/<app>/` is deleted, so the
 * same envelope sent again gets `pack_missing` and each full check costs a
 * full upload.
 *
 * Nothing opened is ever written (FR-031): the opened bytes are held only
 * as long as the checker needs them, and the Dockerfile, at most 1 MiB, in
 * memory for the `# syntax=` rules of T074 (after check L2) and T195 (a
 * build with secrets, step 1b). Neither rule is here yet.
 */
import {
  createPackChecker,
  LIMITS,
  openPiece,
  pieceLength,
  type Build,
  type Envelope,
  type RunnerReport,
  type ServerSecretKey,
  type VerifiedDeployV2,
} from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"

import { ensureDir, paths } from "../home/home"
import { withStateLock } from "../home/locks"
import type { MissingImage } from "../kept/reuse"
import { payloadHash } from "./payload"
import { readStagedDeploy, stagedFor, type DeployOfPieces } from "./stage"

/** The most of a Dockerfile the runner reads, as zekno reads no more before signing (CL3, RB4). */
export const DOCKERFILE_BYTES = 1024 * 1024

const MISMATCH: RunnerReport = { outcome: "refused", reason: "pack_mismatch" }

/**
 * The deploy staged pieces belong to, as `pack` names it in
 * `packs/<app>/deploy.json` (RB2 step 6): its payload's hash
 * (`payloadHash`, the one name `pack` stages under) and the number the
 * deploy was made against.
 */
export function stagedDeployOf(
  envelope: Pick<Envelope, "payload">,
  previous: number
): DeployOfPieces {
  return { payload: payloadHash(envelope), previous }
}

/** What `moveToBuilding` reads of a build: the pieces it lists, and a Railpack build's plan piece (step 2). */
export type ListedPieces = {
  readonly pack: { readonly chunks: readonly string[] }
  readonly builder?: Build["builder"]
}

/** Every piece the builds list, each once, sorted. */
function listedPieces(builds: readonly ListedPieces[]): string[] {
  const listed = new Set<string>()
  for (const build of builds) {
    for (const chunk of build.pack.chunks) listed.add(chunk)
    if (build.builder?.name === "railpack") listed.add(build.builder.plan.piece)
  }
  // Fingerprints are lowercase hex: their order as text is their order as bytes.
  return [...listed].sort()
}

/** The pieces K14d moved to `building/<app>/`, sorted. */
export type Moved = { readonly moved: readonly string[] }

/**
 * K14d's move, under the state lock (RB1: every read-then-write of `packs/`
 * takes it), waiting for it as `withStateLock` does (`busy` once the wait
 * has passed). `builds` are the builds not kept; `images` are K14a's
 * recorded builds whose image is gone or leads elsewhere (`missingImages`),
 * named only with `pack_missing`. When every piece they list is staged for
 * `deploy` (the payload's hash and `previous` that `deploy.json` names),
 * `building/<app>/` is emptied and those pieces are moved into it; else
 * `pack_missing` with the pieces not staged, sorted, each once, at most
 * `LIMITS.missingPieces` (72), and nothing moves. The lock is released
 * before the answer.
 *
 * Emptied with it is everything else in `building/`: the deploy lock is
 * held, and RB15 has run first (RB1), so the state names no build under
 * way, and whatever is there was left by a runner that died between an
 * earlier move and its K17, which no restart would ever delete.
 */
export async function moveToBuilding(
  dir: string,
  app: string,
  deploy: DeployOfPieces,
  builds: readonly ListedPieces[],
  images: readonly MissingImage[] = [],
  wait: { waitMs?: number } = {}
): Promise<Moved | RunnerReport> {
  const listed = listedPieces(builds)
  return withStateLock(
    dir,
    (): Moved | RunnerReport => {
      const staged = readStagedDeploy(dir, app)
      const here = new Set(
        staged?.payload === deploy.payload &&
          staged.previous === deploy.previous
          ? stagedFor(dir, app, deploy.payload)
          : []
      )
      const missing = listed.filter((fingerprint) => !here.has(fingerprint))
      if (missing.length > 0)
        return {
          outcome: "refused",
          reason: "pack_missing",
          missing: {
            pieces: missing.slice(0, LIMITS.missingPieces),
            images: images.map(({ key, state }) => ({ key, state })),
          },
        }
      const building = paths(dir).building(app)
      const all = join(dir, "building")
      ensureDir(all)
      // Emptied first: whatever an earlier check or build left, of this app or another, is not this deploy's.
      for (const left of readdirSync(all))
        rmSync(join(all, left), { recursive: true, force: true })
      ensureDir(building)
      for (const fingerprint of listed)
        renameSync(
          paths(dir).packPiece(app, fingerprint),
          join(building, fingerprint)
        )
      return { moved: listed }
    },
    wait
  )
}

/** What `checkBuild` gives a build whose pieces passed: its Dockerfile, for the `# syntax=` rules (T074, T195). */
export type CheckedBuild = {
  /** The entry under the signed Dockerfile name, whole; null for a build that names none. */
  readonly dockerfile: Uint8Array | null
}

/**
 * A sealed piece in `building/<app>/`: a plain file (a link is not
 * followed), no longer than a sealed piece may be, read whole. Undefined
 * for anything else, or a file that is not there.
 */
function readPiece(path: string): Uint8Array | undefined {
  let handle: number
  try {
    handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return undefined
  }
  try {
    const info = fstatSync(handle)
    if (!info.isFile() || info.size > LIMITS.sealedPieceBytes) return undefined
    return new Uint8Array(readFileSync(handle))
  } catch {
    return undefined
  } finally {
    closeSync(handle)
  }
}

/** The check itself; undefined for `pack_mismatch`. */
function checkPieces(
  folder: string,
  verified: VerifiedDeployV2,
  build: Build,
  serverSecretKey: ServerSecretKey
): CheckedBuild | undefined {
  const { size, hash, chunks } = build.pack
  // Core's checker hashes what it is given under `zekno/v1/pack` as it
  // streams, and holds it to the one form, the signed size and the signed
  // fingerprint (CO5).
  const checker = createPackChecker({ size, hash })
  const named =
    build.builder.name === "dockerfile" ? build.builder.dockerfile : undefined
  let dockerfile: Uint8Array[] | undefined
  let inside = false
  for (const [index, fingerprint] of chunks.entries()) {
    const sealed = readPiece(join(folder, fingerprint))
    if (sealed === undefined) return undefined
    // Exactly L(i) bytes, never more made: the pieces stop at the signed size.
    const opened = openPiece(
      verified,
      sealed,
      pieceLength(size, index),
      serverSecretKey
    )
    if (!opened.ok) {
      if (opened.error.code === "not_verified")
        throw new Error("A piece is opened only for a verified deploy.")
      return undefined
    }
    const items = checker.write(opened.value)
    if (!items.ok) return undefined
    for (const item of items.value) {
      if (item.kind === "data") {
        // A copy: the opened piece is let go once the checker is past it.
        if (inside) dockerfile!.push(item.bytes.slice())
        continue
      }
      // Byte for byte, a regular file: a folder's name ends with `/`, so `Dockerfile/` is never it.
      inside = false
      if (item.kind !== "file" || item.name !== named) continue
      // Longer than zekno ever reads, so never one it signed (CL3).
      if (item.size > DOCKERFILE_BYTES) return undefined
      inside = true
      dockerfile = []
    }
  }
  if (!checker.end().ok) return undefined
  if (named === undefined) return { dockerfile: null }
  if (dockerfile === undefined) return undefined
  // T074 (after check L2) and T195 (step 1b) refuse a `# syntax=` line of it here.
  return { dockerfile: new Uint8Array(Buffer.concat(dockerfile)) }
}

/**
 * K14d's check of one build not kept, under the deploy lock alone, once
 * `moveToBuilding` has moved its pieces: each piece in order from
 * `building/<app>/`, opened with the server's secret key for `verified`
 * (the deploy `verifyDeployV2` gave), to exactly its length, and fed to
 * core's checker, which stops at the signed size. Gives the build's
 * Dockerfile, or `pack_mismatch` for a piece missing, over its bound, that
 * does not open, opens to another length or was sealed for another server's
 * key (FR-026); a pack not in the one form or whose fingerprint differs;
 * and a Dockerfile build without a regular file under exactly its signed
 * name, or with one past 1 MiB. On `pack_mismatch`, and when anything
 * throws, `building/<app>/` is deleted. Nothing is written.
 *
 * CO5 writes `openPiece(verified, sealed, length)`; the server's secret key
 * is an argument of its own, here as there.
 */
export function checkBuild(
  dir: string,
  app: string,
  verified: VerifiedDeployV2,
  build: Build,
  serverSecretKey: ServerSecretKey
): CheckedBuild | RunnerReport {
  const folder = paths(dir).building(app)
  let checked: CheckedBuild | undefined
  try {
    checked = checkPieces(folder, verified, build, serverSecretKey)
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    throw error
  }
  if (checked !== undefined) return checked
  rmSync(folder, { recursive: true, force: true })
  return MISMATCH
}

/** Deletes `building/<app>/`: a refusal before the number leaves no piece moved there (RB3). */
export function dropBuilding(dir: string, app: string): void {
  rmSync(paths(dir).building(app), { recursive: true, force: true })
}
