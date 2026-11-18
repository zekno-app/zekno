/**
 * The secret records the runner keeps (specs/014-deploy-v2, research R13;
 * contracts/state.md ST7): for each live secret of an app at format 2, its
 * latest record, statement and sealed value, as it arrived, in
 * `records/<app>/<hash>.json`, where `<hash>` is the ciphertext hash the
 * signed listing names. Files are named by app and hash, never by secret name,
 * since two names can differ only in letter case. Everything here is sealed or
 * signed: nothing decrypted is ever written.
 *
 * A new file is written and synced before the state that names it, and a
 * file no state names is deleted after, so the state of an app at format 2
 * never names a missing file.
 */
import { SecretRecordSchema, type SecretRecord } from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs"
import { join } from "node:path"

import { ensureDir, writeAtomic } from "./home"

/** An app's name and a ciphertext hash, as the core library holds them: the only names a path is made of. */
const APP = /^[a-z0-9][a-z0-9-]{0,62}$/
const HASH = /^[0-9a-f]{64}$/

/**
 * The largest file that can be a record: a statement of at most 1 MiB, about
 * 1.4 MiB as base64url, and a sealed value of about 0.5 MiB as base64url. A
 * larger file is not one this runner wrote, and is not read whole.
 */
const RECORD_FILE_BYTES = 4 * 1024 * 1024

const folderOf = (dir: string, app: string) => join(dir, "records", app)

/** Where the record of `app` under `hash` is kept. Throws for a name that is not an app's or a hash. */
export function recordPath(dir: string, app: string, hash: string): string {
  if (!APP.test(app) || !HASH.test(hash))
    throw new Error("A record is named by an app and a ciphertext hash.")
  return join(folderOf(dir, app), `${hash}.json`)
}

/**
 * The record kept for `app` under `hash`, or undefined when there is none or
 * it does not read as a record: missing, not a plain file (a link is not
 * followed), too large, not JSON, or not of the record's shape. Nothing here
 * checks a signature: the core library verifies every record at every use.
 */
export function readRecord(
  dir: string,
  app: string,
  hash: string
): SecretRecord | undefined {
  let handle: number
  try {
    handle = openSync(
      recordPath(dir, app, hash),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
  } catch {
    return undefined
  }
  try {
    const info = fstatSync(handle)
    if (!info.isFile() || info.size > RECORD_FILE_BYTES) return undefined
    const parsed = SecretRecordSchema.safeParse(
      JSON.parse(readFileSync(handle, "utf8"))
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  } finally {
    closeSync(handle)
  }
}

/** What a record is kept as: the bytes `writeRecord` writes, so its size can be counted before it is written. */
export const recordText = (record: SecretRecord): string =>
  JSON.stringify(record)

/**
 * Keeps `record` for `app` under `hash`, the hash its listing names, mode 0600
 * in folders only the runner can enter. Written whole and synced, folder
 * included, before it returns: a reader sees the old file or the new one.
 */
export function writeRecord(
  dir: string,
  app: string,
  hash: string,
  record: SecretRecord
): void {
  const path = recordPath(dir, app, hash)
  ensureDir(join(dir, "records"))
  ensureDir(folderOf(dir, app))
  writeAtomic(path, recordText(record))
}

/**
 * Deletes every file of `records/<app>/` but the records of `keep`: older
 * versions, removed secrets, and whatever a run that stopped half-way left.
 * Called only after the state that names `keep` is saved. A file that cannot
 * be deleted now is left for the app's next deploy: the state never names
 * it, so it is never used.
 */
export function removeUnnamed(
  dir: string,
  app: string,
  keep: readonly string[]
): void {
  const folder = folderOf(dir, app)
  const named = new Set(keep.map((hash) => `${hash}.json`))
  let entries: string[]
  try {
    entries = readdirSync(folder)
  } catch {
    return // No folder: nothing kept, nothing to delete.
  }
  for (const entry of entries) {
    if (named.has(entry)) continue
    try {
      if (!lstatSync(join(folder, entry)).isDirectory())
        unlinkSync(join(folder, entry))
    } catch {
      // Left for the next deploy of the app.
    }
  }
}

/**
 * The record files named by `named` that are on disk, each counted once, and
 * their bytes. A name with no file counts nothing: an entry a version-1
 * deploy wrote has none.
 */
export function recordFilesOf(
  dir: string,
  named: Iterable<{ app: string; hash: string }>
): { files: number; bytes: number } {
  const seen = new Set<string>()
  let files = 0
  let bytes = 0
  for (const { app, hash } of named) {
    const path = recordPath(dir, app, hash)
    if (seen.has(path)) continue
    seen.add(path)
    try {
      const info = lstatSync(path)
      if (!info.isFile()) continue
      files += 1
      bytes += info.size
    } catch {
      // No file.
    }
  }
  return { files, bytes }
}
