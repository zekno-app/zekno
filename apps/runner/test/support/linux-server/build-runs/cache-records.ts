/**
 * The build cache a Linux check made, and its removal by exact id
 * (specs/016-build-from-source, T017 and T018). A check lists the cache's
 * records before its first build (`docker buildx du --verbose`); at the end
 * it prunes, one id at a time, each record listed then that was not listed
 * before, and never another. A record that has a child goes once its child
 * has gone, so the pruning runs in passes. Every command runs in the
 * stand-in, with RB7's environment (a BUILDX_CONFIG of the check's own),
 * through `gate.ts`.
 *
 *   const before = await cacheIds(open.inStandIn, HOME)
 *   // ... the check's builds, then its images and records removed ...
 *   const left = await pruneNewCache(open.inStandIn, HOME, before)
 */
import { firstLine } from "../host/host-lists"
import { type InStandIn, newRunToken, rb7Command, rb7Env } from "./rb7"

const ID = /^ID:\s+([A-Za-z0-9]+)\s*$/

/** The ids `docker buildx du --verbose` printed, each once, in order. */
export function cacheIdsOf(text: string): string[] {
  const ids: string[] = []
  for (const line of text.split("\n")) {
    const found = ID.exec(line.trim())
    if (found && !ids.includes(found[1]!)) ids.push(found[1]!)
  }
  return ids
}

/** Those of `after` not in `before`: the records the check made. */
export function newIds(
  before: readonly string[],
  after: readonly string[]
): string[] {
  return after.filter((id) => !before.includes(id))
}

/** `docker buildx du --verbose` of the default builder. */
export const DU = [
  "docker",
  "buildx",
  "du",
  "--builder",
  "default",
  "--verbose",
]

/** `docker buildx prune` of one record, by its id, of any type. */
export function pruneArgs(id: string): string[] {
  if (!/^[A-Za-z0-9]+$/.test(id))
    throw new Error(`${JSON.stringify(id)} is not a cache record's id`)
  return [
    ...["docker", "buildx", "prune", "--builder", "default"],
    ...["--force", "--all", "--filter", `id=${id}`],
  ]
}

const env = (home: string) => rb7Env({ home, run: newRunToken() })

/** The ids of the cache's records now. */
export async function cacheIds(
  run: InStandIn,
  home: string
): Promise<string[]> {
  const answer = await run(rb7Command(DU, env(home)), { timeoutMs: 300_000 })
  if (answer.code !== 0)
    throw new Error(
      `docker buildx du failed (exit ${answer.code}): ${firstLine(answer)}`
    )
  return cacheIdsOf(answer.stdout)
}

/** How many passes the pruning makes at most. */
export const PASSES = 4

/**
 * Prunes the records made since `before` was listed, one id at a time, in
 * passes until none is left or a pass removes nothing. Gives the ids left.
 */
export async function pruneNewCache(
  run: InStandIn,
  home: string,
  before: readonly string[]
): Promise<string[]> {
  let left = newIds(before, await cacheIds(run, home))
  for (let pass = 0; pass < PASSES && left.length > 0; pass++) {
    for (const id of left)
      await run(rb7Command(pruneArgs(id), env(home)), { timeoutMs: 300_000 })
    const now = await cacheIds(run, home)
    const still = left.filter((id) => now.includes(id))
    if (still.length === left.length) return still
    left = still
  }
  return left
}
