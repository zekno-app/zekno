/**
 * The build record (specs/016-build-from-source, contracts/runner.md RB11
 * fourth bullet, RB14 step 2, RB17; core.md CO14; FR-066): what the runner
 * says of each build it keeps, in its side file `kept/<app>/<key>.json`,
 * mode 600: the key and the two digests, the builder, the versions of
 * Docker Engine, buildx and BuildKit (`builder/facts.ts`), what read the
 * instructions, whether a cached step other than `FROM` was used, the base
 * images by digest, the processor and when it was built. The server's word,
 * shown as such, never signed. Never a line the builder printed: each value
 * passes core's strict schema before it is written, and again when it is
 * read.
 *
 * Written at B3 and removed once its image leaves `drop` (RB14 step 2), each
 * by a caller holding the state lock (RB1: S covers every read-then-write of
 * `kept/`); read for `builds` without a lock, which the atomic write allows.
 */
import { readBuildRecord, type Arch, type BuildRecord } from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { dirname } from "node:path"

import type { DockerFacts } from "../builder/facts"
import { ensureDir, paths, writeAtomic } from "../home/home"

/**
 * The largest record file read. A record with 16 bases of 255 characters is
 * under 5 KiB; anything larger is not one of the runner's.
 */
const MAX_RECORD_BYTES = 16 * 1024

/**
 * Writes the record of one build to `kept/<app>/<key>.json`, mode 600, with
 * the runner's atomic write, the folders made mode 700. The record is read
 * through core's strict schema first (CO14), so a field holding a builder's
 * line, or any value outside its pattern, throws `CoreError` and nothing is
 * written. Throws for an app or a key that is not one (`paths`). The caller
 * holds the state lock.
 */
export function writeRecord(
  dir: string,
  app: string,
  record: BuildRecord
): void {
  const checked = readBuildRecord(record)
  const path = paths(dir).kept(app, checked.key)
  ensureDir(dirname(dirname(path)))
  ensureDir(dirname(path))
  writeAtomic(path, JSON.stringify(checked), 0o600)
}

/** One record file read strictly, or undefined: missing, not a plain file (a link is not followed), too large, or not a record of `key`. */
function readOne(
  dir: string,
  app: string,
  key: string
): BuildRecord | undefined {
  let handle: number
  try {
    handle = openSync(
      paths(dir).kept(app, key),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
  } catch {
    return undefined
  }
  try {
    const info = fstatSync(handle)
    if (!info.isFile() || info.size > MAX_RECORD_BYTES) return undefined
    const record = readBuildRecord(JSON.parse(readFileSync(handle, "utf8")))
    return record.key === key ? record : undefined
  } catch {
    return undefined
  } finally {
    closeSync(handle)
  }
}

/**
 * The records of `keys` for `app`, in the order of `keys`, for `builds`
 * (RB17). A key with no file, or whose file does not read by the schema
 * (damaged, cut short, of another key, a link), is skipped, as is a key or
 * an app that is not one. Never throws.
 */
export function readRecords(
  dir: string,
  app: string,
  keys: readonly string[]
): BuildRecord[] {
  const records: BuildRecord[] = []
  for (const key of keys) {
    const record = readOne(dir, app, key)
    if (record !== undefined) records.push(record)
  }
  return records
}

/**
 * Deletes the record of `key` for `app`, once its image has left `drop`
 * (RB14 step 2). True when no file is left: deleted, or never there. False
 * for an app or a key that is not one, and when the file could not be
 * deleted. Never throws. The caller holds the state lock.
 */
export function removeRecord(dir: string, app: string, key: string): boolean {
  try {
    rmSync(paths(dir).kept(app, key), { force: true })
    return true
  } catch {
    return false
  }
}

/** A record file's name: a key and `.json`. */
const RECORD_FILE = /^[0-9a-f]{64}\.json$/

/**
 * The keys that have a record file in `kept/<app>/`, sorted: what RB14's
 * cleaning compares with the state, so a file a cut left behind is found.
 * None when the folder is not there or cannot be read, or the app is not
 * one. Never throws.
 */
export function recordedKeys(dir: string, app: string): string[] {
  try {
    const folder = dirname(paths(dir).kept(app, "0".repeat(64)))
    return readdirSync(folder)
      .filter((name) => RECORD_FILE.test(name))
      .map((name) => name.slice(0, 64))
      .sort()
  } catch {
    return []
  }
}

/** What B3 knows of a build that succeeded, for its record. */
export type RecordInput = {
  readonly key: string
  /** The manifest and config digests `meta.json` gave (RB11). */
  readonly digests: { readonly manifest: string; readonly config: string }
  /**
   * What read the build's instructions: Docker's built-in Dockerfile reader
   * with its version, read from Docker's record of the build before that
   * record is removed (RB12); or the Railpack frontend, by its digest.
   */
  readonly reader: BuildRecord["reader"]
  /** The Railpack version the deploy signed, for a Railpack build; else null. */
  readonly railpack: string | null
  /** The versions `dockerFacts` read (RB5). */
  readonly facts: Pick<DockerFacts, "engine" | "buildx" | "buildkit">
  /** A cached step other than `FROM` was used (RB9). */
  readonly cache: boolean
  /** The base images by digest, from `meta.json`'s materials (RB11). */
  readonly bases: readonly string[]
  readonly arch: Arch
  readonly built: Date
}

/**
 * The record of one build (CO14), or undefined when a version of Docker was
 * not read or a value does not fit the schema: the runner never writes a
 * record it cannot hold to its rules. The builder is the reader's kind; the
 * bases are sorted, each once.
 */
export function recordOf(input: RecordInput): BuildRecord | undefined {
  const { engine, buildx, buildkit } = input.facts
  if (engine === null || buildx === null || buildkit === null) return undefined
  try {
    return readBuildRecord({
      key: input.key,
      manifest: input.digests.manifest,
      config: input.digests.config,
      builder: input.reader.kind,
      railpack: input.railpack,
      docker: { engine, buildx, buildkit },
      reader: input.reader,
      cache: input.cache,
      bases: [...new Set(input.bases)].sort(),
      arch: input.arch,
      built: input.built.toISOString(),
    })
  } catch {
    return undefined
  }
}
