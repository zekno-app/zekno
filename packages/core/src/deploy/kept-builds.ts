/**
 * The builds an app keeps, and the build in progress, as the runner changes
 * them (specs/016-build-from-source, contracts/core.md CO13; FR-031b,
 * FR-045, FR-063, FR-064, FR-067, FR-068). Pure functions: each gives a new
 * value read back through the state's strict rules, so a rule broken throws
 * `CoreError`, and none changes what it was given. The runner writes each
 * result as one state write under the state lock (RB3, RB10, RB15).
 */
import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import {
  AppBuildsSchema,
  BUILD_OUTCOMES,
  KeptImageSchema,
  readMarked,
  type AppBuilds,
  type Building,
  type BuildOutcome,
  type KeptImage,
  type StoredRunnerState,
} from "./state"
import { sortedAndUnique } from "./state-marks"

/** A deploy's builds as the runner hands them to `keepAfter`: its number, its keys, how they ended, and the images it made. */
export type KeptDeploy = {
  readonly sequence: number
  /** The deploy's build keys, sorted, each once; none for a deploy that built nothing. */
  readonly keys: readonly string[]
  readonly outcome: BuildOutcome
  /** The images this deploy made, each of one of its keys. */
  readonly images: readonly KeptImage[]
}

const KeptDeploySchema = z
  .strictObject({
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    keys: z
      .array(z.string().regex(/^[0-9a-f]{64}$/))
      .max(LIMITS.buildsPerDeploy)
      .refine(sortedAndUnique),
    outcome: z.enum(BUILD_OUTCOMES),
    images: z.array(KeptImageSchema).max(LIMITS.buildsPerDeploy),
  })
  .refine((deploy) => {
    const made = deploy.images.map((image) => image.key)
    return (
      new Set(made).size === made.length &&
      made.every((key) => deploy.keys.includes(key))
    )
  })

/**
 * Beside the running deploy's images, the runner keeps those of this many
 * other deploys: the two most recent (FR-067).
 */
const OTHERS_KEPT = LIMITS.keptDeploysPerApp - 1

/** An app's entry with nothing kept, for an app's first deploy that builds. */
const NOTHING_KEPT: AppBuilds = {
  running: null,
  images: [],
  deploys: [],
  drop: [],
  fresh: [],
  last: null,
}

/** `value` read by the rules of an app's entry (CO13), or `CoreError`. */
function readAppBuilds(value: unknown): AppBuilds {
  const parsed = AppBuildsSchema.safeParse(value)
  if (!parsed.success)
    throw new CoreError("invalid_argument", "The app's builds are not valid.")
  return parsed.data as AppBuilds
}

const byKey = (a: KeptImage, b: KeptImage) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0

/**
 * The app's entry after a deploy's builds (CO13, FR-067). A failed build
 * leaves the entry unchanged: its images were never recorded. Otherwise the
 * deploy joins `deploys` with its keys (a deploy that built nothing joins
 * nothing), its new images join `images`, a key of the deploy found in
 * `drop` (reused by K14a) moves back to `images`, and `running` is set. The
 * entry then keeps the running deploy's keys and the two newest other
 * deploys, deploys with the same keys counted once, and every image no kept
 * deploy names moves to `drop`, so a reuse of a kept deploy's keys or a
 * failure never pushes an image out. Called at B3 with the new images and
 * the old `running`, and again before RB14 with the `running` U left, the
 * same deploy given twice changing nothing more; `deploys` and `images` name
 * the same keys at every write. `last` is not set here. Throws `CoreError`
 * for a deploy outside its rules, or one that names a build the runner keeps
 * no image of.
 */
export function keepAfter(
  appBuilds: AppBuilds | undefined,
  deploy: KeptDeploy,
  running: number | null
): AppBuilds {
  const before =
    appBuilds === undefined ? NOTHING_KEPT : readAppBuilds(appBuilds)
  const parsed = KeptDeploySchema.safeParse(deploy)
  if (!parsed.success)
    throw new CoreError(
      "invalid_argument",
      "The deploy's builds are not valid."
    )
  const given = parsed.data
  if (given.outcome === "build_failed") return before

  // Every image the runner made of this app and has not removed: a record
  // this deploy made wins over an older one of the same key.
  const known = new Map<string, KeptImage>()
  for (const image of [...before.drop, ...before.images, ...given.images])
    known.set(image.key, image)

  const candidates = [
    ...(given.keys.length > 0
      ? [{ sequence: given.sequence, keys: given.keys }]
      : []),
    ...before.deploys.filter((each) => each.sequence !== given.sequence),
  ].sort((a, b) => b.sequence - a.sequence)

  // The running deploy's keys, then the two newest others, each set of keys once.
  const runs = candidates.find((each) => each.sequence === running)
  const kept = runs === undefined ? [] : [runs]
  const seen = new Set(kept.map((each) => each.keys.join(" ")))
  let others = 0
  for (const each of candidates) {
    if (others === OTHERS_KEPT) break
    // Keys are sorted, so the same keys give the same text.
    const keys = each.keys.join(" ")
    if (each === runs || seen.has(keys)) continue
    seen.add(keys)
    kept.push(each)
    others += 1
  }
  kept.sort((a, b) => b.sequence - a.sequence)

  const named = new Set(kept.flatMap((each) => each.keys))
  const images: KeptImage[] = []
  for (const key of named) {
    const image = known.get(key)
    if (image === undefined)
      throw new CoreError(
        "invalid_argument",
        "A deploy names a build the runner keeps no image of."
      )
    images.push(image)
  }
  const drop = [...known.values()].filter((image) => !named.has(image.key))
  return readAppBuilds({
    running,
    images: images.sort(byKey),
    deploys: kept,
    drop: drop.sort(byKey),
    fresh: before.fresh,
    last: before.last,
  })
}

/**
 * The entry with `key` taken off `drop`, once its removal succeeded, or its
 * tag is gone or leads elsewhere (RB14). Throws `CoreError` for a key not in
 * `drop`.
 */
export function withDropped(appBuilds: AppBuilds, key: string): AppBuilds {
  const before = readAppBuilds(appBuilds)
  if (!before.drop.some((image) => image.key === key))
    throw new CoreError(
      "invalid_argument",
      "That image is not waiting for its removal."
    )
  return readAppBuilds({
    ...before,
    drop: before.drop.filter((image) => image.key !== key),
  })
}

/**
 * The entry with `base` built fresh by deploy `sequence` (CO13, `fresh`): a
 * base already there takes the new number; past `LIMITS.freshPerApp`, the
 * oldest is dropped, the first by base among the oldest.
 */
export function withFresh(
  appBuilds: AppBuilds,
  base: string,
  sequence: number
): AppBuilds {
  const before = readAppBuilds(appBuilds)
  const fresh = [
    ...before.fresh.filter((each) => each.base !== base),
    { base, sequence },
  ].sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0))
  while (fresh.length > LIMITS.freshPerApp) {
    let oldest = 0
    fresh.forEach((each, index) => {
      if (each.sequence < fresh[oldest]!.sequence) oldest = index
    })
    fresh.splice(oldest, 1)
  }
  return readAppBuilds({ ...before, fresh })
}

/**
 * The state with `app`'s builds set, or removed with null, the apps in order
 * of their names, and every other part as it was. Read back through the
 * strict rules: throws `CoreError` for an app not at format 2, a number past
 * the app's last, or any other rule broken.
 */
export function withAppBuilds(
  state: StoredRunnerState,
  app: string,
  appBuilds: AppBuilds | null
): StoredRunnerState {
  const entries: [string, AppBuilds][] = Object.entries(state.builds).filter(
    ([holder]) => holder !== app
  )
  if (appBuilds !== null) entries.push([app, appBuilds])
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return readMarked({ ...state, builds: Object.fromEntries(entries) })
}

/**
 * The state with its build in progress set, or cleared with null, and every
 * other part as it was (item 28; RB3, RB10, RB15): written with the number
 * (`building`), then `stopping` with its stop time, `starting` at B3, and
 * cleared. Read back through the strict rules: throws `CoreError` for a
 * build not at its app's last number, or a stop time without `stopping`, or
 * `stopping` without one.
 */
export function withBuilding(
  state: StoredRunnerState,
  building: Building | null
): StoredRunnerState {
  return readMarked({ ...state, building })
}
