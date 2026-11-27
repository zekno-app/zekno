/**
 * Docker's own record of a build (specs/016-build-from-source,
 * contracts/runner.md RB12; FR-031b). Docker keeps a record of each build,
 * with its build arguments and the builder's whole output (map-runner E01),
 * until it is removed. With the runner's private `BUILDX_CONFIG`
 * (`<home>/buildx`), buildx leaves one file per build the runner started at
 * `<home>/buildx/refs/<builder>/<node>/<ref>` (E04), so the runner always
 * finds exactly its own records, after a restart too, and removes only
 * those: a record with no ref file here is never touched. A ref file's
 * contents are paths, and are never read.
 *
 *   const before = refsNow(home)
 *   const child = startClient()                       // run.ts
 *   const ref = await newRef(home, before, child.exited)
 *   …
 *   if (ref) await removeRecord(ref)                  // B2, whatever the outcome
 *
 * When a removal fails, the ref file stays, and the next deploy tries every
 * ref left first (`leftRefs`, T086). Each Docker call goes through
 * `runDocker`, with a time limit.
 */
import { lstatSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { runDocker } from "../docker/run"

/** One build's ref: the file buildx left at `<home>/buildx/refs/<builder>/<node>/<id>`. */
export type BuildRef = {
  /** The runner's folder, `<home>`. */
  readonly home: string
  /** The builder the build ran on, the folder the file is in: what `--builder` names. */
  readonly builder: string
  readonly node: string
  /** The record's id, the file's name: what `history inspect` and `history rm` name. */
  readonly id: string
}

/** Where buildx's record of a build stands: still running, ended, or not known (Docker failed, was cut, or said nothing readable). */
export type RecordState = "running" | "ended" | "unknown"

/** How often the folder is read while the client runs, until its ref shows (RB12). */
const EVERY_MS = 250
/** How long one `history inspect` may take when its caller says nothing: RB15's bounded part asks 10 seconds. */
const INSPECT_MS = 10_000
/** How long one `history rm` may take: `runDocker`'s own limit. */
const REMOVE_MS = 60_000

/** A builder's or a node's name as buildx makes it from a Docker context's name; never one read as a flag. */
const BUILDER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$/
/** A record's id as buildx names its ref files (25 lowercase letters and digits on Docker 29); never one read as a flag. */
const RECORD_ID = /^[A-Za-z0-9]{1,64}$/

/** The folder of every ref the runner's builds left (RB12). */
export const refsFolder = (dir: string) => join(dir, "buildx", "refs")

/** The ref file of `ref`. */
export const refFile = (ref: BuildRef) =>
  join(refsFolder(ref.home), ref.builder, ref.node, ref.id)

/** Whether each name of `ref` is one buildx gives, so nothing of it is read as a flag or a path. */
const fits = (ref: BuildRef) =>
  BUILDER_NAME.test(ref.builder) &&
  BUILDER_NAME.test(ref.node) &&
  RECORD_ID.test(ref.id)

/** The names in `folder` that are entries of the kind asked, sorted; none when it cannot be read. */
function entries(folder: string, kind: "folder" | "file"): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) =>
        kind === "folder" ? entry.isDirectory() : entry.isFile()
      )
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Every ref file now in `<home>/buildx/refs/<builder>/<node>/`, sorted.
 * Only plain files whose names buildx would give are listed: a link, a
 * folder or another name is never a ref, so never removed.
 */
export function refsNow(dir: string): BuildRef[] {
  const refs: BuildRef[] = []
  const root = refsFolder(dir)
  for (const builder of entries(root, "folder"))
    for (const node of entries(join(root, builder), "folder"))
      for (const id of entries(join(root, builder, node), "file")) {
        const ref = { home: dir, builder, node, id }
        if (fits(ref)) refs.push(ref)
      }
  return refs
}

/** Every ref file left, by an earlier build whose record could not be removed: the next deploy tries each first (RB12, T086). */
export const leftRefs = (dir: string): BuildRef[] => refsNow(dir)

const keyOf = (ref: BuildRef) => `${ref.builder}/${ref.node}/${ref.id}`

/**
 * This build's ref: the file that is not among `before`. After the client
 * starts, the folder is read every `everyMs` until a new file shows or the
 * client ends, and once more after it ends (when buildx writes the file is
 * not settled: at the start, or after the first vertex). Undefined when the
 * client ended without one.
 */
export async function newRef(
  dir: string,
  before: readonly BuildRef[],
  ended: Promise<unknown>,
  options: { everyMs?: number } = {}
): Promise<BuildRef | undefined> {
  const known = new Set(before.map(keyOf))
  let over = false
  const settled = ended.then(
    () => {
      over = true
    },
    () => {
      over = true
    }
  )
  for (;;) {
    const endedBefore = over
    const found = refsNow(dir).find((ref) => !known.has(keyOf(ref)))
    if (found !== undefined || endedBefore) return found
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      settled,
      new Promise((resolve) => {
        timer = setTimeout(resolve, options.everyMs ?? EVERY_MS)
      }),
    ])
    clearTimeout(timer)
  }
}

/**
 * The record's state, from `docker buildx history inspect --builder <name>
 * <ref>`: `running` while its duration says `(running)` (or a status says
 * `Running`); `ended` once it shows a duration, a status or an error
 * without that; `unknown` when Docker fails, is cut at `limitMs`, or prints
 * nothing of the kind.
 */
export async function recordState(
  ref: BuildRef,
  limitMs = INSPECT_MS
): Promise<RecordState> {
  if (!fits(ref)) return "unknown"
  const answer = await runDocker(
    ref.home,
    ["buildx", "history", "inspect", "--builder", ref.builder, ref.id],
    { timeoutMs: limitMs }
  )
  if (answer.code !== 0) return "unknown"
  const lines = answer.stdout.split("\n").map((line) => line.trim())
  if (
    lines.some(
      (line) =>
        /^Duration:.*\(running\)/i.test(line) ||
        /^Status:\s*Running\b/i.test(line)
    )
  )
    return "running"
  if (lines.some((line) => /^(?:Duration|Status|Error):/i.test(line)))
    return "ended"
  return "unknown"
}

/**
 * Removes the build's record, `docker buildx history rm --builder <name>
 * <ref>`, then its ref file. True when nothing of it is left here: removed,
 * or no ref file here to name it (such a record is never touched). False
 * when Docker's removal failed, and the file stays for the next deploy; or
 * when the ref's names are not buildx's, and nothing is done.
 */
export async function removeRecord(
  ref: BuildRef,
  limitMs = REMOVE_MS
): Promise<boolean> {
  if (!fits(ref)) return false
  const file = refFile(ref)
  try {
    if (!lstatSync(file).isFile()) return false
  } catch {
    return true
  }
  const answer = await runDocker(
    ref.home,
    ["buildx", "history", "rm", "--builder", ref.builder, ref.id],
    { timeoutMs: limitMs }
  )
  if (answer.code !== 0) return false
  try {
    rmSync(file, { force: true })
  } catch {
    return false
  }
  return true
}
