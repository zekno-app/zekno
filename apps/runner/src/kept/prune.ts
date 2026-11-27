/**
 * The cache bound and staging, and step R as a whole (specs/016-build-from-
 * source, contracts/runner.md RB14 steps 3 and 4, RB3 R and the bullets
 * under its table; FR-068, FR-069).
 *
 * `pruneCache` brings the builder's cache within `LIMITS.buildCacheBytes`
 * (10 GiB): `docker buildx prune --builder <name> --force --max-used-space
 * 10gb`, or `--keep-storage 10gb` on a buildx whose help text does not list
 * `--max-used-space` (`dockerFacts`), under a limit of its own, 120
 * seconds. Cut by it, nothing is recorded, and the next deploy runs it
 * again. The cache is the builder's, so it reaches builds made outside
 * Zekno too; the docs say so.
 *
 * `tidyAfterDeploy` is step R: kept images and the drop list (`retain`),
 * then the prune, then the cleaning of `packs/` (RB2 step 4) under the state
 * lock, in that order, under the deploy lock and before the answer: zekno
 * closes the session once it has the answer and stops a local runner 5
 * seconds later, so nothing here may wait for after it. It runs for a
 * deploy of an app that has builds in the state or that built; a deploy of
 * an app with none makes exactly today's calls, which is none here.
 */
import { LIMITS } from "@workspace/core"

import { dockerFacts, type DockerFacts } from "../builder/facts"
import { isReport, load, withState, type StateWait } from "../commands/commands"
import { runDocker, TIMED_OUT } from "../docker/run"
import { cleanPacks } from "../pack/stage"
import { retain, type Retained, type RetainDeploy } from "./retain"

/** The prune's limit of its own (RB14 step 3). */
export const PRUNE_LIMIT_MS = 120_000

const KIB = 1024
const MIB = KIB * KIB
const GIB = MIB * KIB

/**
 * A size as buildx reads it (go-units' `RAMInBytes`, binary units): `10gb`
 * is 10 GiB. In the largest unit that holds it whole.
 */
export function cacheBound(bytes: number = LIMITS.buildCacheBytes): string {
  if (bytes % GIB === 0) return `${bytes / GIB}gb`
  if (bytes % MIB === 0) return `${bytes / MIB}mb`
  return `${bytes}b`
}

/**
 * How the prune ended: done; cut at its limit; refused or failed by Docker;
 * or skipped, with no buildx or no builder name to give it.
 */
export type Pruned = "pruned" | "cut" | "failed" | "skipped"

/**
 * RB14 step 3, through `runDocker` in the runner's folder, under the deploy
 * lock and never the state lock (RB1). The builder is the current context's,
 * as `dockerFacts` read it (a name held to Docker's pattern, so never read
 * as a flag). Never throws. `timeoutMs` is for tests.
 */
export async function pruneCache(
  dir: string,
  facts: Pick<DockerFacts, "buildx" | "context" | "maxUsedSpace">,
  options: { timeoutMs?: number } = {}
): Promise<Pruned> {
  if (facts.buildx === null || facts.context === null) return "skipped"
  const answer = await runDocker(
    dir,
    [
      "buildx",
      "prune",
      "--builder",
      facts.context,
      "--force",
      facts.maxUsedSpace ? "--max-used-space" : "--keep-storage",
      cacheBound(),
    ],
    { timeoutMs: options.timeoutMs ?? PRUNE_LIMIT_MS }
  )
  if (answer.code === TIMED_OUT) return "cut"
  return answer.code === 0 ? "pruned" : "failed"
}

/** What step R is told of the deploy it runs after. */
export type TidyInput = {
  /** The deploy whose Compose text is in force once U ran, or the one before after a failed build. */
  readonly running: number | null
  /** The deploy itself, as `retain` takes it. */
  readonly deploy: RetainDeploy
  /** Whether this deploy built (B1 ran), whatever the outcome. */
  readonly built: boolean
  /** What K14b read of Docker; asked here when no build was run (`dockerFacts`). */
  readonly facts?: DockerFacts
  /** The clock for the cleaning of `packs/`; now when not given. */
  readonly now?: Date
  /** For tests: the prune's limit, and how long a state write waits for the state lock. */
  readonly pruneLimitMs?: number
  readonly wait?: StateWait
}

/** What step R did: nothing, for an app with no builds that built nothing; else each part's outcome. */
export type Tidied =
  | { readonly ran: false }
  | {
      readonly ran: true
      readonly retained: Retained
      readonly pruned: Pruned
      /** Whether `packs/` was cleaned: false when the state lock was not had in time, or the state did not read. */
      readonly cleaned: boolean
    }

/**
 * Step R of RB3 for `app` (RB14): `retain`, `pruneCache`, then `cleanPacks`
 * under the state lock. Whether the app has builds is read from the state
 * without a lock (the runner writes it atomically, and this runner holds the
 * deploy lock). Never throws: each part that does not finish is taken up by
 * the next deploy of the app.
 */
export async function tidyAfterDeploy(
  dir: string,
  app: string,
  input: TidyInput
): Promise<Tidied> {
  const loaded = load(dir)
  const hasBuilds = !isReport(loaded) && Object.hasOwn(loaded.state.builds, app)
  if (!hasBuilds && !input.built) return { ran: false }

  const wait = input.wait ?? {}
  const retained = await retain(dir, app, input.running, input.deploy, {
    wait,
  })

  let pruned: Pruned = "failed"
  try {
    const facts = input.facts ?? (await dockerFacts(dir))
    pruned = await pruneCache(
      dir,
      facts,
      input.pruneLimitMs === undefined ? {} : { timeoutMs: input.pruneLimitMs }
    )
  } catch {
    // Docker could not be asked: the next deploy prunes again.
  }

  let cleaned = false
  try {
    const now = input.now ?? new Date()
    const done = await withState(
      dir,
      (state) => {
        cleanPacks(dir, state.state, now)
        return { cleaned: true }
      },
      wait
    )
    cleaned = !isReport(done)
  } catch {
    // The next `pack` or deploy cleans again.
  }
  return { ran: true, retained, pruned, cleaned }
}
