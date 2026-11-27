/**
 * The steps of a deploy that builds (specs/016-build-from-source,
 * contracts/runner.md RB3), called from `deploy.ts` in the order of RB3's
 * table: K1 to K14 (`deploy.ts`), K14a, K14b, K14c (`planBuilds`), K15 and
 * K16 (`deploy.ts`), K14d (`checkCode`), K17 (`deploy.ts`, with
 * `buildingOf`). So a deploy whose Docker, disk, limits or secrets fail says
 * so before zekno uploads up to 512 MiB, and nothing can refuse a deploy
 * between the check of its pieces and the number but K17's second look at
 * the team lists.
 *
 * Every step here holds the deploy lock and never the state lock, but
 * K14d's move (RB1: no Docker call and no piece read under the state lock).
 * A refusal before K17 changes nothing but the team lists of K3, uses no
 * number, and leaves no piece in `building/<app>/` (`dropBuilding` for a
 * refusal after K14d moved them there).
 *
 * B1 and B2 come here (T086), after K17, for the builds `planBuilds` gave
 * as not kept; B3, U and R go to `deploy-after.ts` beside this file (T087,
 * T088, T090), so each stays under 500 lines.
 */
import {
  LIMITS,
  type Build,
  type Building,
  type DeployV2,
  type Envelope,
  type RunnerReport,
  type ServerSecretKey,
  type StoredRunnerState,
  type VerifiedDeployV2,
} from "@workspace/core"

import { canBuild, dockerFacts, type DockerFacts } from "../builder/facts"
import {
  belowFloor,
  buildPlaces,
  dockerRoot,
  leastFree,
  type StatFs,
} from "../disk/free"
import { keptBuilds, missingImages, type Reuse } from "../kept/reuse"
import {
  checkBuild,
  dropBuilding,
  moveToBuilding,
  stagedDeployOf,
} from "../pack/open"

/** What K14a to K14c found for a deploy, and what the steps after the number build. */
export type BuildPlan = {
  /** K14a for each build of the deploy, in key order. */
  readonly reuse: readonly Reuse[]
  /** The builds not kept, in key order: the ones K14d checks and B1 builds. */
  readonly toBuild: readonly Build[]
  /** What Docker said of itself at K14b; undefined when every build is kept, or there is none. */
  readonly facts: DockerFacts | undefined
}

const NONE: BuildPlan = { reuse: [], toBuild: [], facts: undefined }

/**
 * K14b's answer for a deploy (RB5): `docker_too_old` with the versions, or
 * `no_build_plugin`; undefined when Docker can build. A Docker whose engine
 * does not answer is `no_build_plugin`: the builder's driver cannot be read
 * as `docker`, which RB5 refuses so, and the deploy's refusals have no
 * `no_docker` (CO10; only `builder` names it, RB17).
 */
function dockerRefusal(facts: DockerFacts): RunnerReport | undefined {
  const can = canBuild(facts)
  if (can.can === "yes") return undefined
  if (can.can === "docker_too_old")
    return { outcome: "refused", reason: "docker_too_old", docker: can.docker }
  return { outcome: "refused", reason: "no_build_plugin" }
}

/**
 * K14a, K14b and K14c for a verified deploy, under the deploy lock alone.
 * K14a: each build is kept when the state K4 to K14 read (`state`) records
 * its key for the app and Docker still has its image (`keptBuilds`). Only
 * when a build is not kept: K14b, Docker's facts held to RB5
 * (`docker_too_old`, `no_build_plugin`); then K14c, the least free space of
 * the places a build writes to against `LIMITS.diskFloorBytes`, `low_disk`
 * with `disk` below it (RB6; a place that cannot be read is free 0). A work
 * folders' parent that is not private throws (`unpackedDir`), as a runner's
 * folder that is not private is `invalid_state`. A deploy with no build asks
 * Docker nothing. `statfs` is given only by tests.
 */
export async function planBuilds(
  dir: string,
  state: Pick<StoredRunnerState, "builds">,
  verified: VerifiedDeployV2,
  statfs?: StatFs
): Promise<BuildPlan | RunnerReport> {
  const { app, builds } = verified.deploy
  if (builds.length === 0) return NONE
  // K14a.
  const reuse = await keptBuilds(dir, state, app, builds)
  const toBuild = builds.filter(
    (_, index) => reuse[index]!.reuse === "not_kept"
  )
  if (toBuild.length === 0) return { reuse, toBuild, facts: undefined }
  // K14b.
  const facts = await dockerFacts(dir)
  const refusal = dockerRefusal(facts)
  if (refusal !== undefined) return refusal
  // K14c, once per deploy, before the number.
  const free = leastFree(buildPlaces(dir, await dockerRoot(dir)), statfs)
  if (belowFloor(free))
    return {
      outcome: "refused",
      reason: "low_disk",
      disk: { free, floor: LIMITS.diskFloorBytes },
    }
  return { reuse, toBuild, facts }
}

/** What K14d gives each build it checked: its Dockerfile, by key, for the `# syntax=` rules (T074, T195). */
export type CheckedCode = {
  readonly dockerfiles: ReadonlyMap<string, Uint8Array | null>
}

/**
 * K14d (RB4), for the builds `plan` gave as not kept, after K15 and K16:
 * under the state lock, every piece they list must be staged for this
 * deploy (named by `envelope`'s payload and `previous`), and is moved to
 * `building/<app>/`; else `pack_missing`, naming K14a's recorded builds
 * whose image is gone or changed, and nothing moves. Then each build's
 * pieces are checked under the deploy lock alone, in key order, with the
 * server's secret key; the first `pack_mismatch` is the answer, and
 * `building/<app>/` is then deleted, as it is when anything throws. A
 * deploy with nothing to build takes no lock and reads nothing.
 */
export async function checkCode(
  dir: string,
  envelope: Pick<Envelope, "payload">,
  verified: VerifiedDeployV2,
  plan: BuildPlan,
  serverSecretKey: ServerSecretKey
): Promise<CheckedCode | RunnerReport> {
  const dockerfiles = new Map<string, Uint8Array | null>()
  if (plan.toBuild.length === 0) return { dockerfiles }
  const { app, previous } = verified.deploy
  try {
    const moved = await moveToBuilding(
      dir,
      app,
      stagedDeployOf(envelope, previous),
      plan.toBuild,
      missingImages(plan.reuse)
    )
    if ("outcome" in moved) return moved
    for (const build of plan.toBuild) {
      const checked = checkBuild(dir, app, verified, build, serverSecretKey)
      if ("outcome" in checked) return checked
      dockerfiles.set(build.key, checked.dockerfile)
    }
  } catch (error) {
    // A move cut short, or a check that threw: no piece stays for a deploy that used no number.
    dropBuilding(dir, app)
    throw error
  }
  return { dockerfiles }
}

/** A run token: 32 hex characters from 16 random bytes (CO13, RB15). */
export const runToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")

/**
 * The state's `building` that K17 writes with the number (CO13; RB3, RB15):
 * for the builds not kept, their keys, in key order, and as `limit` the sum
 * of their signed timeouts; phase `building`, a new run token, the time now
 * and no stop. Null when nothing is built, so a deploy whose builds are all
 * kept, or that has none, never sets it.
 */
export function buildingOf(
  deploy: Pick<DeployV2, "app" | "sequence">,
  plan: Pick<BuildPlan, "toBuild">,
  now: Date = new Date()
): Building | null {
  if (plan.toBuild.length === 0) return null
  return {
    app: deploy.app,
    sequence: deploy.sequence,
    keys: plan.toBuild.map((build) => build.key),
    since: now.toISOString(),
    limit: plan.toBuild.reduce((sum, build) => sum + build.timeout, 0),
    phase: "building",
    run: runToken(),
    stopped: null,
  }
}
