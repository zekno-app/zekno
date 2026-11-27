/**
 * The cache bound and staging (specs/016-build-from-source, T090;
 * contracts/runner.md RB14 steps 3 and 4, RB3 R and the bullets under its
 * table; FR-068, FR-069): after each deploy of an app that has builds, or
 * that built, the builder's cache is brought within 10 GiB with the flag
 * this buildx has (`--max-used-space`, else `--keep-storage`), under a limit
 * of its own; cut by it, nothing is recorded and the next deploy runs it
 * again. Then `packs/` is cleaned under the state lock. R runs kept images,
 * the prune and the cleaning in that order; an app with none makes no call.
 *
 * The runner's folder is set up in this process (`kept-home.ts`); Docker is
 * the stand-in, which answers `buildx prune --help` with or without
 * `--max-used-space`, records each prune's options and can hang one.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { builtImageName, LIMITS } from "@workspace/core"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { dockerFacts } from "../../src/builder/facts"
import { cacheBound, pruneCache, tidyAfterDeploy } from "../../src/kept/prune"
import { stagePiece } from "../../src/pack/stage"
import { fakeDocker, type FakeDocker } from "../support/helpers"
import { buildsOf, keptHome, laidDown } from "./kept-home"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

const GIB = 1024 ** 3
const hex = (c: string) => c.repeat(64)
const [K1, K2, K3, K4] = ["1", "2", "3", "4"].map(hex) as [
  string,
  string,
  string,
  string,
]

async function setUp(): Promise<{ docker: FakeDocker; home: string }> {
  const docker = fakeDocker()
  process.env.ZEKNO_DOCKER = docker.path
  return { docker, home: await keptHome({ web: 20, api: 3 }) }
}

/** The calls made, by their first words, in order. */
const verbs = (docker: FakeDocker) =>
  docker.argv().map((args) => args.slice(0, 2).join(" "))

/** Stages a piece for `app`'s deploy made against `previous`, an hour before now. */
const staged = (home: string, app: string, previous: number) => {
  stagePiece(
    home,
    app,
    { payload: hex("a"), previous },
    hex("f"),
    new Uint8Array(16),
    new Date(Date.now() - 60 * 60 * 1000)
  )
  return join(home, "packs", app)
}

describe("pruneCache (RB14 step 3)", () => {
  test("the bound is LIMITS.buildCacheBytes as buildx reads it: 10gb", () => {
    expect(LIMITS.buildCacheBytes).toBe(10 * GIB)
    expect(cacheBound()).toBe("10gb")
    expect(cacheBound(512 * 1024 ** 2)).toBe("512mb")
    expect(cacheBound(1000)).toBe("1000b")
  })

  test("each flag as the help text says: --max-used-space when buildx lists it, else --keep-storage", async () => {
    const { docker, home } = await setUp()
    docker.script({ du: 25 * GIB })
    const facts = await dockerFacts(home)
    expect(facts.maxUsedSpace).toBe(true)
    expect(await pruneCache(home, facts)).toBe("pruned")
    expect(docker.model().prunes.at(-1)).toEqual([
      "--builder",
      "default",
      "--force",
      "--max-used-space",
      "10gb",
    ])
    // The stand-in brought the cache within the bound, as buildx would.
    expect(docker.model().script.du).toBe(10 * GIB)

    docker.script({ docker: { maxUsedSpace: false, context: "server-1" } })
    const older = await dockerFacts(home)
    expect(older.maxUsedSpace).toBe(false)
    expect(await pruneCache(home, older)).toBe("pruned")
    expect(docker.model().prunes.at(-1)).toEqual([
      "--builder",
      "server-1",
      "--force",
      "--keep-storage",
      "10gb",
    ])
    // The exact list Docker was given, and never under the state lock.
    expect(docker.argv().at(-1)).toEqual([
      "buildx",
      "prune",
      "--builder",
      "server-1",
      "--force",
      "--keep-storage",
      "10gb",
    ])
    for (const call of docker.calls()) expect(call.stateLock).toBe(false)
  })

  test("a prune that hangs is cut at its limit, and nothing is recorded", async () => {
    const { docker, home } = await setUp()
    const facts = await dockerFacts(home)
    docker.script({ pruneHangs: true })
    const began = performance.now()
    expect(await pruneCache(home, facts, { timeoutMs: 500 })).toBe("cut")
    expect(performance.now() - began).toBeLessThan(5000)
    expect(buildsOf(home)).toBeUndefined()
  }, 15_000)

  test("a prune Docker refuses is failed, not thrown; no buildx or no builder name makes no call", async () => {
    const { docker, home } = await setUp()
    const facts = await dockerFacts(home)
    docker.script({ failing: ["buildx prune"] })
    expect(await pruneCache(home, facts)).toBe("failed")
    const calls = docker.argv().length
    expect(await pruneCache(home, { ...facts, buildx: null })).toBe("skipped")
    expect(await pruneCache(home, { ...facts, context: null })).toBe("skipped")
    expect(docker.argv().length).toBe(calls)
  })

  test("the limit of its own is 120 seconds", async () => {
    const { PRUNE_LIMIT_MS } = await import("../../src/kept/prune")
    expect(PRUNE_LIMIT_MS).toBe(120_000)
  })
})

describe("tidyAfterDeploy: step R (RB3 R, RB14)", () => {
  test("an app with no builds, whose deploy built nothing, makes no call and changes nothing", async () => {
    const { docker, home } = await setUp()
    const packs = staged(home, "api", 1)
    expect(
      await tidyAfterDeploy(home, "api", {
        running: 4,
        deploy: { sequence: 4, keys: [], outcome: "reused" },
        built: false,
      })
    ).toEqual({ ran: false })
    expect(docker.calls()).toEqual([])
    expect(docker.model().prunes).toEqual([])
    // Not R's to clean for such an app: exactly today's deploy.
    expect(existsSync(packs)).toBe(true)
  })

  test("kept images, then the prune, then the cleaning of packs/, in that order", async () => {
    const { docker, home } = await setUp()
    for (const [sequence, key] of [
      [1, K1],
      [2, K2],
      [3, K3],
    ] as const) {
      const deploy = laidDown(home, docker, {
        sequence,
        keys: [key],
        built: [key],
      })
      await tidyAfterDeploy(home, "web", {
        running: sequence,
        deploy,
        built: true,
      })
    }
    // A deploy of api that can no longer run left its pieces.
    const packs = staged(home, "api", 1)
    const deploy = laidDown(home, docker, {
      sequence: 4,
      keys: [K4],
      built: [K4],
    })
    const before = docker.argv().length
    const tidied = await tidyAfterDeploy(home, "web", {
      running: 4,
      deploy,
      built: true,
    })
    expect(tidied).toEqual({
      ran: true,
      retained: { dropped: [K1], waiting: [] },
      pruned: "pruned",
      cleaned: true,
    })
    const order = verbs(docker).slice(before)
    // The image of deploy 1 removed before the facts are asked and the cache pruned.
    expect(order.indexOf("image rm")).toBeGreaterThanOrEqual(0)
    expect(order.indexOf("image rm")).toBeLessThan(
      order.indexOf("buildx prune")
    )
    expect(order.at(-1)).toBe("buildx prune")
    expect(existsSync(packs)).toBe(false)
    expect(
      docker
        .model()
        .images.map((each) => each.tag)
        .sort()
    ).toEqual([K2, K3, K4].map((key) => builtImageName("web", key)))
  })

  test("with facts K14b read, they are used and not asked again", async () => {
    const { docker, home } = await setUp()
    const facts = await dockerFacts(home)
    const deploy = laidDown(home, docker, {
      sequence: 1,
      keys: [K1],
      built: [K1],
    })
    const before = docker.argv().length
    await tidyAfterDeploy(home, "web", {
      running: 1,
      deploy,
      built: true,
      facts,
    })
    expect(verbs(docker).slice(before)).toEqual(["buildx prune"])
  })

  test("a deploy whose first build failed, with nothing recorded, still prunes the cache it made", async () => {
    const { docker, home } = await setUp()
    const tidied = await tidyAfterDeploy(home, "web", {
      running: null,
      deploy: { sequence: 1, keys: [K1], outcome: "build_failed" },
      built: true,
    })
    expect(tidied).toMatchObject({ ran: true, pruned: "pruned", cleaned: true })
    expect(buildsOf(home)).toBeUndefined()
    expect(docker.model().prunes).toHaveLength(1)
  })

  test("a prune that hangs is cut, the cleaning still runs, and R ends", async () => {
    const { docker, home } = await setUp()
    const deploy = laidDown(home, docker, {
      sequence: 1,
      keys: [K1],
      built: [K1],
    })
    const packs = staged(home, "api", 1)
    docker.script({ pruneHangs: true })
    const began = performance.now()
    const tidied = await tidyAfterDeploy(home, "web", {
      running: 1,
      deploy,
      built: true,
      pruneLimitMs: 500,
    })
    expect(performance.now() - began).toBeLessThan(10_000)
    expect(tidied).toMatchObject({ ran: true, pruned: "cut", cleaned: true })
    expect(existsSync(packs)).toBe(false)
    // Cut, nothing is recorded: the next deploy prunes again.
    docker.script({ pruneHangs: false })
    const next = laidDown(home, docker, { sequence: 2, keys: [K1] })
    expect(
      await tidyAfterDeploy(home, "web", {
        running: 2,
        deploy: next,
        built: false,
      })
    ).toMatchObject({ ran: true, pruned: "pruned" })
    expect(docker.model().prunes).toHaveLength(2)
  }, 20_000)
})
