/**
 * The bounded reasons (specs/016-build-from-source, contracts/runner.md
 * RB16; data-model.md, "The bounded reasons"; FR-031a). A failed or stopped
 * build gets one reason, chosen from what the runner did and held, the first
 * that holds winning, in RB16's order:
 *
 *   time_limit, out_of_disk, team_changed, cache_used, wrong_processor,
 *   out_of_memory, step_failed
 *
 * The builder's text only helps choose among them: it is never returned,
 * never kept, and a step's own command never chooses (the text before
 * BuildKit's "did not complete successfully:" is read past). `step_failed`
 * covers every other failure, a piece that no longer matches on the second
 * pass among them. `reserved_image` joins after `wrong_processor` only if
 * check L9 settles item 17 so (T082); `runner_restarted` is written by the
 * restart path (RB15), never here.
 *
 *   reasonOf({ atLimit: true, error: "… no space left on device" })  // "time_limit"
 */
import type { BuildReason } from "@workspace/core"

/** A reason a deploy's answer may carry: every reason but `runner_restarted`, which only RB15 writes (RB16). */
export type DeployReason = Exclude<BuildReason, "runner_restarted">

/** What the runner did and held when a build failed or was stopped. Absent is false. */
export type Seen = {
  /** The runner stopped the client at the signed limit (RB10). */
  readonly atLimit?: boolean
  /** The runner stopped it because free disk fell below the floor (RB6, RB10). */
  readonly belowFloor?: boolean
  /** The team list watch, before or during the build, or B3 found the deploy no longer allowed (RB10, CO9). */
  readonly teamChanged?: boolean
  /** The build may reuse no cached step (its `fresh` is the deploy's number; FR-021a). */
  readonly fresh?: boolean
  /** A stage step other than `FROM` came from the cache (`progress.ts`, RB9). */
  readonly cached?: boolean
  /** RB11's architecture check found another processor's image. */
  readonly wrongArch?: boolean
  /** The failing step's error, as `progress.ts` keeps it: only helps choose. */
  readonly error?: string
  /** The end of the last error the builder gave, as `progress.ts` keeps it: only helps choose. */
  readonly lastError?: string
}

/** Where BuildKit's error of a step ends its quoted command; what follows is the cause. */
const CAUSE_AFTER = "did not complete successfully:"

/** The causes of `text`: each line after its last "did not complete successfully:", or the whole line when it has none. */
function causes(...texts: (string | undefined)[]): string[] {
  const found: string[] = []
  for (const text of texts)
    for (const line of (text ?? "").split("\n")) {
      const at = line.lastIndexOf(CAUSE_AFTER)
      found.push(at === -1 ? line : line.slice(at + CAUSE_AFTER.length))
    }
  return found
}

/** Whether the builder's error, past any step's command, says this. */
const says = (seen: Seen, words: RegExp) =>
  causes(seen.error, seen.lastError).some((cause) => words.test(cause))

/** ENOSPC as Go words it. */
const NO_SPACE = /no space left on device/i
/** ENOEXEC as Go words it: a binary of another processor. */
const EXEC_FORMAT = /exec format error/i
/** ENOMEM as Go words it (check L6, map-checks T6), or a step killed as the kernel kills one out of memory (128 + 9). */
const NO_MEMORY = /cannot allocate memory|\bexit code: 137\b/i

/** Why the build failed or was stopped, by RB16's order (FR-031a). */
export function reasonOf(seen: Seen): DeployReason {
  if (seen.atLimit) return "time_limit"
  if (seen.belowFloor || says(seen, NO_SPACE)) return "out_of_disk"
  if (seen.teamChanged) return "team_changed"
  if (seen.fresh && seen.cached) return "cache_used"
  if (seen.wrongArch || says(seen, EXEC_FORMAT)) return "wrong_processor"
  if (says(seen, NO_MEMORY)) return "out_of_memory"
  return "step_failed"
}
