/**
 * The build cache a Linux check made in the stand-in, and its removal by
 * record id (specs/016-build-from-source, T012 to T014). A check lists the
 * builder's cache records before its first build (`cacheRecords`), and
 * afterwards removes, one by one by id, those its builds made
 * (`removeCacheMade`): never a record that was there before it.
 *
 *   const before = (await cacheRecords(run, HOME)).map((item) => item.id)
 *   // ... builds ...
 *   const left = await removeCacheMade(run, HOME, before)   // ids it could not remove
 *
 * `docker buildx du --verbose` is read as blocks of `Key: value` lines;
 * `docker buildx prune --filter id=<id>` takes one id a call (buildx turns
 * it into BuildKit's `id~=<id>`, which ids of letters and digits match only
 * exactly). `--all` lets it reach the cache mounts and the context records,
 * which a plain prune leaves. A record a later one rests on is removed in a
 * later pass. Every command runs in the stand-in with RB7's environment, so
 * buildx reads and writes only the check's own `BUILDX_CONFIG`.
 */
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "./rb7"
import { newRunToken, rb7Command, rb7Env } from "./rb7-args"

export type CacheRecord = {
  readonly id: string
  readonly type?: string
  readonly description?: string
}

/** A cache record's id as BuildKit makes them: letters and digits. */
export const RECORD_ID = /^[a-z0-9]{10,64}$/

export const DU_ARGS: readonly string[] = [
  "docker",
  "buildx",
  "du",
  "--builder",
  "default",
  "--verbose",
]

/** Removes the one record `id`, of whatever type, and nothing else. */
export function pruneArgs(id: string): string[] {
  if (!RECORD_ID.test(id))
    throw new Error(`${JSON.stringify(id)} is not a cache record's id`)
  return [
    ...["docker", "buildx", "prune", "--builder", "default"],
    ...["--force", "--all", "--filter", `id=${id}`],
  ]
}

/**
 * The records of `docker buildx du --verbose`: each `ID:` line starts one,
 * and the `Type:` and `Description:` lines after it, before the next, are
 * its own. An id that is not one of BuildKit's is skipped with its lines.
 */
export function cacheRecordsOf(text: string): CacheRecord[] {
  const records: { id: string; type?: string; description?: string }[] = []
  let current: (typeof records)[number] | undefined
  for (const line of text.split("\n")) {
    const found = /^([A-Za-z][A-Za-z ]*):[ \t]*(.*)$/.exec(line.trim())
    if (!found) continue
    const [, key, value] = found as unknown as [string, string, string]
    if (key === "ID") {
      current = RECORD_ID.test(value.trim()) ? { id: value.trim() } : undefined
      if (current) records.push(current)
    } else if (current && key === "Type" && current.type === undefined)
      current.type = value.trim()
    else if (
      current &&
      key === "Description" &&
      current.description === undefined
    )
      current.description = value.trim()
  }
  return records.map(({ id, type, description }) => ({
    id,
    ...(type ? { type } : {}),
    ...(description ? { description } : {}),
  }))
}

/** The records of `now` whose ids `before` did not hold. */
export function madeSince(
  before: readonly string[],
  now: readonly CacheRecord[]
): CacheRecord[] {
  const known = new Set(before)
  return now.filter((record) => !known.has(record.id))
}

const envOf = (home: string) => rb7Env({ home, run: newRunToken() })

/** The builder's cache records now; a failed listing throws one line. */
export async function cacheRecords(
  run: InStandIn,
  home: string
): Promise<CacheRecord[]> {
  const answer = await run(rb7Command(DU_ARGS, envOf(home)))
  if (answer.code !== 0)
    throw new Error(`docker buildx du failed: ${firstLine(answer)}`)
  return cacheRecordsOf(answer.stdout)
}

/**
 * Removes the records made since `before`, by id, in up to three passes.
 * Gives what is left: the ids it could not remove, or why it could not
 * list them.
 */
export async function removeCacheMade(
  run: InStandIn,
  home: string,
  before: readonly string[]
): Promise<string[]> {
  const env = envOf(home)
  const list = async () => {
    const answer = await run(rb7Command(DU_ARGS, env))
    if (answer.code !== 0)
      throw new Error(
        `the build cache could not be listed: ${firstLine(answer)}`
      )
    return cacheRecordsOf(answer.stdout)
  }
  try {
    let left = madeSince(before, await list()).map((record) => record.id)
    for (let pass = 0; pass < 3 && left.length > 0; pass++) {
      // The newest first: a record is listed after those it rests on.
      for (const id of [...left].reverse())
        await run(rb7Command(pruneArgs(id), env))
      const now = new Set((await list()).map((record) => record.id))
      const still = left.filter((id) => now.has(id))
      const stuck = still.length === left.length
      left = still
      if (stuck) break
    }
    return left
  } catch (error) {
    return [(error as Error).message]
  }
}
