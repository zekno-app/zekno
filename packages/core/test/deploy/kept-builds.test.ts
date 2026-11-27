/**
 * The images an app keeps (specs/016-build-from-source, contracts/core.md
 * CO13, CO19; FR-063, FR-064, FR-067, FR-068): `keepAfter` against FR-067's
 * cases (five builds, failures, reuses, rollbacks, an image to remove
 * reused), `withDropped` once a removal succeeded (RB14), and `withFresh`.
 * After every call, the keys the deploys name are exactly the images kept.
 */
import { describe, expect, test } from "bun:test"

import { keepAfter, withDropped, withFresh } from "../../src/deploy/kept-builds"
import { AppBuildsSchema, type AppBuilds } from "../../src/deploy/state"
import { LIMITS } from "../../src/protocol/limits"
import { CoreError } from "../../src/protocol/result"
import { AT, baseOf, entry, imageOf, keyOf } from "../support/builds"
import { deepFreeze } from "../support/deploy-v2"

type Deploy = Parameters<typeof keepAfter>[1]

/** The keys the deploys name together, sorted, each once. */
const namedKeys = (builds: AppBuilds) =>
  [...new Set(builds.deploys.flatMap((deploy) => deploy.keys))].sort()

/** The entry reads by its own rules, and its deploys name exactly the images it keeps. */
function agrees(builds: AppBuilds): AppBuilds {
  expect(AppBuildsSchema.safeParse(builds).success).toBe(true)
  expect(namedKeys(builds)).toEqual(builds.images.map((image) => image.key))
  return builds
}

/** `keepAfter`, frozen in, checked out. */
const keep = (
  builds: AppBuilds | undefined,
  deploy: Deploy,
  running: number | null
) => agrees(keepAfter(deepFreeze(builds), deepFreeze(deploy), running))

/**
 * A deploy carried through the runner's two calls: at B3 with the running
 * deploy as it was, and before RB14 with the one U left, by default this
 * deploy.
 */
function deployed(
  builds: AppBuilds | undefined,
  deploy: Deploy,
  runningAfter: number | null = deploy.sequence
): AppBuilds {
  const atB3 = keep(builds, deploy, builds?.running ?? null)
  return keep(atB3, deploy, runningAfter)
}

/** Deploy `n` that built image `n`, and images `shared` it reused. */
const built = (n: number, shared: readonly number[] = []): Deploy => ({
  sequence: n,
  keys: [...shared, n].map(keyOf).sort(),
  outcome: "built",
  images: [imageOf(n)],
})

/** Deploy `n` that built nothing and reused the images of `keys`. */
const reused = (n: number, keys: readonly number[]): Deploy => ({
  sequence: n,
  keys: keys.map(keyOf).sort(),
  outcome: "reused",
  images: [],
})

/** Deploys 1 to `count`, each building one image of its own. */
function builds(count: number): AppBuilds {
  let kept: AppBuilds | undefined
  for (let n = 1; n <= count; n++) kept = deployed(kept, built(n))
  return kept!
}

const deploysOf = (...sequences: number[][]) =>
  sequences.map(([sequence, ...keys]) => ({
    sequence: sequence!,
    keys: keys.map(keyOf),
  }))

describe("keepAfter (FR-067)", () => {
  test("five builds that each change the code keep the running deploy and the two newest others, and the oldest images are in drop", () => {
    const kept = builds(5)
    expect(kept.running).toBe(5)
    expect(kept.deploys).toEqual(deploysOf([5, 5], [4, 4], [3, 3]))
    expect(kept.images).toEqual([imageOf(3), imageOf(4), imageOf(5)])
    expect(kept.drop).toEqual([imageOf(1), imageOf(2)])
  })

  test("an image two deploys share is kept while either is", () => {
    // Image 0 is a service no later deploy changes: deploy 1 built it, each later one reused it.
    let kept = deployed(undefined, {
      ...built(1, [0]),
      images: [imageOf(0), imageOf(1)],
    })
    for (let n = 2; n <= 5; n++) kept = deployed(kept, built(n, [0]))
    expect(kept.deploys).toEqual(deploysOf([5, 0, 5], [4, 0, 4], [3, 0, 3]))
    expect(kept.images).toEqual([
      imageOf(0),
      imageOf(3),
      imageOf(4),
      imageOf(5),
    ])
    expect(kept.drop).toEqual([imageOf(1), imageOf(2)])
  })

  test("a deploy of two builds whose second fails changes nothing", () => {
    const before = builds(3)
    const failed: Deploy = {
      sequence: 4,
      keys: [keyOf(4), keyOf(5)],
      outcome: "build_failed",
      images: [imageOf(4)],
    }
    // At B3, and again with the running U left: U did not run.
    expect(keep(before, failed, before.running)).toEqual(before)
    expect(keep(before, failed, null)).toEqual(before)
    // An app's first deploy that failed keeps nothing.
    expect(keep(undefined, failed, null)).toEqual(entry())
  })

  test("a reuse after three kept deploys pushes nothing out", () => {
    const before = builds(3)
    // Nothing changed since deploy 3.
    const again = deployed(before, reused(4, [3]))
    expect(again.running).toBe(4)
    expect(again.images).toEqual(before.images)
    expect(again.drop).toEqual([])
    expect(again.deploys).toEqual(deploysOf([4, 3], [2, 2], [1, 1]))
    // A rollback to deploy 1, whose image is still kept.
    const back = deployed(again, reused(5, [1]))
    expect(back.running).toBe(5)
    expect(back.images).toEqual(before.images)
    expect(back.drop).toEqual([])
    expect(back.deploys).toEqual(deploysOf([5, 1], [4, 3], [2, 2]))
  })

  test("a rollback to deploy 2 whose image is in drop moves it back to images and keeps it", () => {
    const before = builds(5)
    expect(before.drop).toContainEqual(imageOf(2))
    const back = deployed(before, reused(6, [2]))
    expect(back.running).toBe(6)
    expect(back.images).toEqual([imageOf(2), imageOf(4), imageOf(5)])
    expect(back.drop).toEqual([imageOf(1), imageOf(3)])
    expect(back.deploys).toEqual(deploysOf([6, 2], [5, 5], [4, 4]))
    // Kept at B3 too, while 5 still runs: its record moved back, digests and all.
    const atB3 = keep(before, reused(6, [2]), 5)
    expect(atB3.images).toContainEqual(imageOf(2))
    expect(atB3.drop).not.toContainEqual(imageOf(2))
  })

  test("a deploy that built nothing, as running, keeps the two newest built deploys", () => {
    const before = builds(3)
    const nothing: Deploy = {
      sequence: 4,
      keys: [],
      outcome: "built",
      images: [],
    }
    // At B3, with deploy 3 still running, it joins nothing and pushes nothing out.
    expect(keep(before, nothing, 3)).toEqual(before)
    const after = deployed(before, nothing)
    expect(after.running).toBe(4)
    expect(after.deploys).toEqual(deploysOf([3, 3], [2, 2]))
    expect(after.images).toEqual([imageOf(2), imageOf(3)])
    expect(after.drop).toEqual([imageOf(1)])
  })

  test("deploys with the same keys are counted once", () => {
    // Deploys 1 and 2 built; 3 and 4 reused deploy 2's image; 5 built.
    let kept = deployed(deployed(undefined, built(1)), built(2))
    kept = deployed(deployed(kept, reused(3, [2])), reused(4, [2]))
    kept = deployed(kept, built(5))
    expect(kept.deploys).toEqual(deploysOf([5, 5], [4, 2], [1, 1]))
    expect(kept.images).toEqual([imageOf(1), imageOf(2), imageOf(5)])
    expect(kept.drop).toEqual([])
  })

  test("a call made twice with the same deploy gives the same entry", () => {
    const before = builds(4)
    const once = keep(before, built(5), 5)
    expect(keep(once, built(5), 5)).toEqual(once)
  })

  test("the fresh bases and the last outcome are kept as they were; last is not set here", () => {
    const fresh = [{ base: baseOf(1), sequence: 1 }]
    const last = {
      sequence: 1,
      outcome: "built" as const,
      reason: null,
      at: AT,
    }
    const before = { ...deployed(undefined, built(1)), fresh, last }
    const after = keep(before, built(2), 1)
    expect(after.fresh).toEqual(fresh)
    expect(after.last).toEqual(last)
  })

  test("a deploy that names a build the runner keeps no image of, or anything outside the rules, throws CoreError", () => {
    const before = builds(3)
    for (const deploy of [
      reused(4, [9]),
      { ...built(4), keys: [keyOf(5), keyOf(4)] },
      { ...built(4), keys: [keyOf(4), keyOf(4)] },
      { ...built(4), images: [imageOf(5)] },
      { ...built(4), images: [imageOf(4), imageOf(4)] },
      { ...built(4), images: [{ ...imageOf(4), manifest: "sha256:x" }] },
      { ...built(4), outcome: "refused" },
      { ...built(4), sequence: 0 },
      {
        ...built(4),
        keys: Array.from({ length: LIMITS.buildsPerDeploy + 1 }, (_, n) =>
          keyOf(10 + n)
        ),
      },
    ])
      expect(() => keepAfter(before, deploy as Deploy, 4)).toThrow(CoreError)
    expect(() => keepAfter(before, built(4), 0)).toThrow(CoreError)
    expect(() => keepAfter({ ...before, images: [] }, built(4), 4)).toThrow(
      CoreError
    )
  })
})

describe("withDropped (RB14)", () => {
  test("the image leaves drop once its removal succeeded; the rest is as it was", () => {
    const before = deepFreeze(builds(5))
    const after = agrees(withDropped(before, keyOf(1)))
    expect(after.drop).toEqual([imageOf(2)])
    expect({ ...after, drop: before.drop }).toEqual(before)
    expect(agrees(withDropped(after, keyOf(2))).drop).toEqual([])
  })

  test("a key not in drop throws invalid_argument", () => {
    const before = builds(5)
    for (const key of [keyOf(5), keyOf(9), "x"]) {
      expect(() => withDropped(before, key)).toThrow(CoreError)
      try {
        withDropped(before, key)
      } catch (error) {
        expect((error as CoreError).code).toBe("invalid_argument")
      }
    }
  })
})

describe("withFresh", () => {
  test("adds a base in order, and a base already there takes the new number", () => {
    const before = deepFreeze(builds(2))
    const one = agrees(withFresh(before, baseOf(2), 1))
    const two = agrees(withFresh(one, baseOf(1), 2))
    expect(two.fresh).toEqual([
      { base: baseOf(1), sequence: 2 },
      { base: baseOf(2), sequence: 1 },
    ])
    const again = agrees(withFresh(two, baseOf(2), 2))
    expect(again.fresh).toEqual([
      { base: baseOf(1), sequence: 2 },
      { base: baseOf(2), sequence: 2 },
    ])
    expect({ ...again, fresh: before.fresh }).toEqual(before)
  })

  test(`past ${LIMITS.freshPerApp} drops the oldest`, () => {
    expect(LIMITS.freshPerApp).toBe(24)
    let kept = builds(1)
    // Base n built fresh by deploy n + 1, the newest last.
    for (let n = 0; n < LIMITS.freshPerApp; n++)
      kept = agrees(withFresh(kept, baseOf(n), n + 1))
    expect(kept.fresh).toHaveLength(LIMITS.freshPerApp)
    const past = agrees(withFresh(kept, baseOf(99), 30))
    expect(past.fresh).toHaveLength(LIMITS.freshPerApp)
    expect(past.fresh.map((each) => each.base)).not.toContain(baseOf(0))
    expect(past.fresh.map((each) => each.base)).toContain(baseOf(99))
    expect(past.fresh.map((each) => each.base)).toEqual(
      [...past.fresh.map((each) => each.base)].sort()
    )
  })

  test("a base or a number outside the rules throws CoreError", () => {
    const before = builds(1)
    for (const [base, sequence] of [
      ["B".repeat(64), 1],
      [baseOf(1), 0],
      [baseOf(1), 1.5],
    ] as const)
      expect(() => withFresh(before, base, sequence)).toThrow(CoreError)
  })
})
