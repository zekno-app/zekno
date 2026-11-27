/**
 * Staging (specs/016-build-from-source, contracts/runner.md RB2 steps 4 and
 * 6; data-model.md, "Staging and work folders"; FR-028, FR-069): the sealed
 * pieces `pack` brings, kept until a deploy can use them.
 *
 * `packs/<app>/` holds one deploy's pieces, each named by its fingerprint,
 * and `deploy.json`, which names that deploy: the payload's hash, the
 * deploy's `previous` and when it was first staged. Another deploy's piece
 * for the app empties the folder first. Nothing is kept of a deploy that can
 * no longer run, nothing older than `LIMITS.stagingSeconds` (24 hours), and
 * no more than `LIMITS.stagingBytes` (2 GiB) in all.
 *
 * Callers hold the state lock (RB1): every read-then-write of `packs/` is
 * under it. No piece is opened here; a piece is opened only in RB4, for a
 * deploy that can run. `building/` is never touched.
 */
import { LIMITS, type RunnerState } from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"

import { ensureDir, paths, writeAtomic } from "../home/home"

/** The deploy a staged piece belongs to, as `pack` names it. */
export type DeployOfPieces = {
  /** The hash of the deploy's signed payload, as 64 hex characters. */
  readonly payload: string
  /** The app's number the deploy was made against. */
  readonly previous: number
}

/** What `deploy.json` holds: the deploy, and when its first piece was staged. */
export type StagedDeploy = DeployOfPieces & {
  /** An ISO time from the runner's clock. */
  readonly staged: string
}

/** An app's name, as core holds it (CO1): an entry of `packs/` with another name is none of the runner's. */
const APP = /^[a-z0-9][a-z0-9-]{0,62}$/
/** A fingerprint or a payload's hash: 64 lowercase hex characters. */
const HEX64 = /^[0-9a-f]{64}$/
/** An ISO time as the runner writes it, with `toISOString`. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/** The largest `deploy.json` read: the runner's own is under 200 bytes. */
const DEPLOY_FILE_BYTES = 4096
const DEPLOY_FILE = "deploy.json"

/**
 * The runner's atomic write (`home.ts`), given the piece's bytes. It writes
 * with `writeFileSync`, which takes bytes as it takes text; its declared
 * type names text only.
 */
const writeBytesAtomic = writeAtomic as (
  path: string,
  content: string | Uint8Array,
  mode?: number
) => void

/** `packs/`, the folder of every app's staged pieces. */
const packsOf = (dir: string) => join(dir, "packs")

/** `packs/<app>/`. Throws for a name that is not an app's (`paths`). */
const folderOf = (dir: string, app: string) => paths(dir).packs(app)

const isDeploy = (deploy: DeployOfPieces): boolean =>
  HEX64.test(deploy.payload) &&
  Number.isSafeInteger(deploy.previous) &&
  deploy.previous >= 0

/** True when `value` is exactly what `deploy.json` holds: these three fields and nothing else. */
function isStagedDeploy(value: unknown): value is StagedDeploy {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false
  const fields = Object.keys(value).sort()
  if (fields.join(" ") !== "payload previous staged") return false
  const { payload, previous, staged } = value as Record<string, unknown>
  return (
    typeof payload === "string" &&
    typeof previous === "number" &&
    isDeploy({ payload, previous }) &&
    typeof staged === "string" &&
    ISO_TIME.test(staged) &&
    Number.isFinite(Date.parse(staged))
  )
}

/**
 * The deploy whose pieces `packs/<app>/` holds, or undefined when there is
 * none or its file does not read by the strict rule: missing, not a plain
 * file (a link is not followed), too large, not JSON, or of another shape.
 */
export function readStagedDeploy(
  dir: string,
  app: string
): StagedDeploy | undefined {
  let handle: number
  try {
    handle = openSync(
      paths(dir).packDeploy(app),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
  } catch {
    return undefined
  }
  try {
    const info = fstatSync(handle)
    if (!info.isFile() || info.size > DEPLOY_FILE_BYTES) return undefined
    const value: unknown = JSON.parse(readFileSync(handle, "utf8"))
    return isStagedDeploy(value) ? value : undefined
  } catch {
    return undefined
  } finally {
    closeSync(handle)
  }
}

/** The entries of a folder, or none when it cannot be read. */
function entriesOf(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}

/** Deletes one entry of `packs/`; a link is removed, never followed. */
const remove = (path: string) => rmSync(path, { recursive: true, force: true })

/** Empties `packs/<app>/`, keeping the folder. */
function empty(folder: string): void {
  for (const entry of entriesOf(folder)) remove(join(folder, entry))
}

/** The pieces in `folder` and their sizes: plain files named by a fingerprint. */
function piecesIn(folder: string): { fingerprint: string; bytes: number }[] {
  const pieces: { fingerprint: string; bytes: number }[] = []
  for (const entry of entriesOf(folder)) {
    if (!HEX64.test(entry)) continue
    try {
      const info = lstatSync(join(folder, entry))
      if (info.isFile()) pieces.push({ fingerprint: entry, bytes: info.size })
    } catch {
      // Gone since the folder was read.
    }
  }
  return pieces.sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0
  )
}

/**
 * Stages one sealed piece of `deploy` for `app` (RB2 step 6). When
 * `deploy.json` names another deploy, or does not read, `packs/<app>/` is
 * emptied first and the file names this deploy, staged at `now`; then the
 * piece is written by its fingerprint with the runner's atomic write, mode
 * 600. The deploy is named before its piece, so no piece is ever in the
 * folder under another deploy's name. Throws, writing nothing, for an app,
 * deploy or fingerprint outside its pattern. The caller holds the state
 * lock and has checked the piece's fingerprint and size (RB2 steps 1 to 3).
 */
export function stagePiece(
  dir: string,
  app: string,
  deploy: DeployOfPieces,
  fingerprint: string,
  sealed: Uint8Array,
  now: Date = new Date()
): void {
  // Throws for an app or a fingerprint outside its pattern, before anything is written.
  const path = paths(dir).packPiece(app, fingerprint)
  if (!isDeploy(deploy))
    throw new Error("A deploy is named by its payload's hash and previous.")
  const folder = folderOf(dir, app)
  ensureDir(packsOf(dir))
  ensureDir(folder)
  const staged = readStagedDeploy(dir, app)
  if (
    staged === undefined ||
    staged.payload !== deploy.payload ||
    staged.previous !== deploy.previous
  ) {
    empty(folder)
    const named: StagedDeploy = {
      payload: deploy.payload,
      previous: deploy.previous,
      staged: now.toISOString(),
    }
    writeAtomic(paths(dir).packDeploy(app), JSON.stringify(named))
  }
  writeBytesAtomic(path, sealed, 0o600)
}

/** The fingerprints staged for the deploy whose payload hashes to `payload`, sorted; none when another deploy's are. */
export function stagedFor(dir: string, app: string, payload: string): string[] {
  const staged = readStagedDeploy(dir, app)
  if (staged === undefined || staged.payload !== payload) return []
  return piecesIn(folderOf(dir, app)).map((piece) => piece.fingerprint)
}

/** The bytes of every piece staged, across the apps (RB2 step 6 holds it to `LIMITS.stagingBytes`). */
export function stagedBytes(dir: string): number {
  let bytes = 0
  for (const app of entriesOf(packsOf(dir))) {
    if (!APP.test(app)) continue
    for (const piece of piecesIn(join(packsOf(dir), app))) bytes += piece.bytes
  }
  return bytes
}

/**
 * Cleans `packs/` (RB2 step 4, RB14 step 4), with the clock passed in:
 * deletes the pieces of each app whose deploy can no longer run (its
 * `previous` is not the app's last number, 0 for an app the state does not
 * know), whose `deploy.json` does not read, or that were staged more than
 * `LIMITS.stagingSeconds` before `now`; then, oldest first, whole deploys
 * until what is left is within `LIMITS.stagingBytes`. Whatever else is in
 * `packs/` (a write cut short, an entry that is no app's) is deleted too.
 * The caller holds the state lock. `building/` is never touched.
 */
export function cleanPacks(
  dir: string,
  state: Pick<RunnerState, "lastSequence">,
  now: Date
): void {
  const packs = packsOf(dir)
  const left: { folder: string; staged: number; bytes: number }[] = []
  for (const app of entriesOf(packs)) {
    const folder = join(packs, app)
    let isFolder: boolean
    try {
      isFolder = lstatSync(folder).isDirectory()
    } catch {
      continue // Gone since the folder was read.
    }
    if (!APP.test(app) || !isFolder) {
      remove(folder)
      continue
    }
    const deploy = readStagedDeploy(dir, app)
    const staged = deploy === undefined ? NaN : Date.parse(deploy.staged)
    if (
      deploy === undefined ||
      deploy.previous !== (state.lastSequence[app] ?? 0) ||
      now.getTime() - staged > LIMITS.stagingSeconds * 1000
    ) {
      remove(folder)
      continue
    }
    // Only the pieces and the file that names their deploy stay.
    const pieces = piecesIn(folder)
    const kept = new Set([DEPLOY_FILE, ...pieces.map((p) => p.fingerprint)])
    for (const entry of entriesOf(folder))
      if (!kept.has(entry)) remove(join(folder, entry))
    const bytes = pieces.reduce((sum, piece) => sum + piece.bytes, 0)
    left.push({ folder, staged, bytes })
  }
  let total = left.reduce((sum, each) => sum + each.bytes, 0)
  left.sort((a, b) => a.staged - b.staged)
  for (const each of left) {
    if (total <= LIMITS.stagingBytes) break
    remove(each.folder)
    total -= each.bytes
  }
}
