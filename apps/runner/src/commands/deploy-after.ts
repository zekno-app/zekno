/**
 * The steps of a version-2 deploy once its number is used (specs/016-build-
 * from-source, contracts/runner.md RB3 U and R and the bullets under its
 * table, RB13, RB14; data-model.md, "Kept images, after each deploy";
 * FR-043, FR-067, FR-068, FR-069), called from `deploy.ts` after K17, under
 * the deploy lock. Each state write takes the state lock, reads the state
 * again and changes only its own part; no Docker call is made under it
 * (RB1).
 *
 * U: when every build of the deploy was kept (K14a), its first state write
 * makes the deploy the app's running entry (`keepAfter`) with `last`
 * `reused`. Then the Compose text is written and `up --no-build` runs
 * (RB13), then routes and health as in feature 015 (RN3, RN11, RN12); then
 * `building` is cleared while it is still this deploy's, by its run token.
 * A build that succeeded stays recorded and kept when `up`, routes or
 * health fail.
 *
 * R (RB14, `tidyAfterDeploy`): kept images and the drop list with the
 * `running` U left, the cache prune and the cleaning of `packs/`, after U
 * and before the answer, since zekno closes the session once it has the
 * answer. A deploy of an app with no builds that built nothing makes
 * exactly today's calls.
 *
 * B1 and B2 (T086, `deploy-build.ts`) and B3 (T087, here before U) wait for
 * the build command, which waits for check L2 (T073). Until they come, a
 * deploy with a build not kept goes on from K17 to U as before: its image
 * is not there, so `up` fails (E08), and U clears its `building`.
 */
import {
  keepAfter,
  withAppBuilds,
  withBuilding,
  type Building,
  type RunnerReport,
  type VerifiedDeployV2,
} from "@workspace/core"

import { waitHealthy } from "../health/wait"
import { writeState } from "../home/home"
import { tidyAfterDeploy } from "../kept/prune"
import { putRoutesInForce } from "../routes/apply"
import { retryReleased } from "../routes/released"
import { composeStart, withState } from "./commands"
import type { BuildPlan } from "./deploy-build"

/** What U and R are given of a deploy whose number K17 used. */
export type AfterNumber = {
  readonly verified: VerifiedDeployV2
  /** The secrets K16 opened, by name. */
  readonly secrets: Record<string, string>
  /** What K14a to K14c found. */
  readonly plan: BuildPlan
  /** The `building` K17 wrote with the number; null when nothing is built. */
  readonly building: Building | null
  readonly onProgress?: (line: string) => void
  readonly onHealth: (service: string) => void
  /** How long `up` may run: the runner's own limit when left out (docker/compose.ts). */
  readonly limitMs?: number
}

/** The deploy's build keys, sorted, as `keepAfter` takes them (CO13). */
const keysOf = (verified: VerifiedDeployV2): string[] =>
  verified.deploy.builds.map((build) => build.key).sort()

/**
 * U's first state write when every build was kept (RB3, second bullet under
 * its table; CO13): under the state lock, the state read again, the app's
 * entry after `keepAfter` with this deploy running, a key found in `drop`
 * back in `images`, and `last` `reused`. Not written when the lock stays
 * held past its wait or the entry does not take the deploy: R's
 * `keepAfter` still makes it the running deploy, and only `last` is lost.
 */
async function recordReuse(
  dir: string,
  verified: VerifiedDeployV2
): Promise<void> {
  const { app, sequence } = verified.deploy
  try {
    await withState(dir, (fresh) => {
      const next = keepAfter(
        fresh.state.builds[app],
        { sequence, keys: keysOf(verified), outcome: "reused", images: [] },
        sequence
      )
      const last = {
        sequence,
        outcome: "reused" as const,
        reason: null,
        at: new Date().toISOString(),
      }
      writeState(dir, withAppBuilds(fresh.state, app, { ...next, last }))
    })
  } catch {
    // Not written: see above.
  }
}

/**
 * U's last state write (RB3 U; data-model.md, `building` "cleared once U
 * has run"): under the state lock, the state read again, `building`
 * cleared while it holds this deploy's run token. Not written when the lock
 * stays held past its wait: the next request that takes the deploy lock
 * then finds it and runs RB15.
 */
async function clearBuilding(dir: string, run: string): Promise<void> {
  try {
    await withState(dir, (fresh) => {
      if (fresh.state.building?.run === run)
        writeState(dir, withBuilding(fresh.state, null))
    })
  } catch {
    // Not written: see above.
  }
}

/**
 * What follows `up` (RN3, RN11, RN12): for an app with no route and no
 * health check that held none, only the certificates of released domains
 * still to delete, tried again; else the routes put in force, carried out
 * as far as they go even when `up` failed, so that a domain this deploy
 * releases is released; then, only when both went well, the wait for health.
 * A start stopped at its time limit is reported with its `startLimit`.
 */
async function afterUp(
  dir: string,
  verified: VerifiedDeployV2,
  started: Pick<RunnerReport, "outcome" | "startLimit">,
  onHealth: (service: string) => void
): Promise<RunnerReport> {
  const { app, sequence, routes, health } = verified.deploy
  const done = { app, sequence }
  if (
    routes.length === 0 &&
    health === null &&
    !Object.hasOwn(verified.nextState.routes, app)
  ) {
    // RN10's first step, for each released domain still to delete; with none, no Docker call. Not reported.
    await retryReleased(dir, verified.nextState)
    return { ...started, ...done }
  }

  const inForce = await putRoutesInForce({ dir, app, routes, health })
  // Their own failure is not reported over start_failed.
  if (started.outcome === "start_failed") return { ...started, ...done }
  if (!inForce.ok)
    return { outcome: "routes_failed", ...done, routes: inForce.failure }
  if (health !== null) {
    const waited = await waitHealthy({
      dir,
      app,
      health,
      names: inForce.names,
      // The limit is the app's: the time the routes took, such as a first fetch of the proxy's image, is not counted.
      deadline: Date.now() + health.timeout * 1000,
      onHealth,
    })
    if (!waited.ok)
      return {
        outcome: "unhealthy",
        ...done,
        health: { service: waited.service, http: waited.http },
      }
  }
  return { outcome: "started", ...done }
}

/**
 * U, then R, then the answer (RB3). The deploy that reached `up` is the one
 * whose Compose text is in force, whatever `up`, routes or health gave, so
 * R keeps its images as the running ones (FR-067).
 */
export async function afterNumber(
  dir: string,
  input: AfterNumber
): Promise<RunnerReport> {
  const { verified, plan } = input
  const { app, sequence } = verified.deploy
  const built = plan.toBuild.length > 0

  // U.
  if (!built && plan.reuse.length > 0) await recordReuse(dir, verified)
  const started = await composeStart(
    dir,
    verified.deploy,
    input.secrets,
    input.onProgress,
    input.limitMs
  )
  const answer = await afterUp(dir, verified, started, input.onHealth)
  if (input.building !== null) await clearBuilding(dir, input.building.run)

  // R, before the answer; it never throws.
  await tidyAfterDeploy(dir, app, {
    running: sequence,
    deploy: {
      sequence,
      keys: keysOf(verified),
      outcome: built ? "built" : "reused",
    },
    built,
    facts: plan.facts,
  })
  return answer
}
