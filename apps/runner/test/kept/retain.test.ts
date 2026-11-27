/**
 * Kept images and the drop list (specs/016-build-from-source, T089;
 * contracts/runner.md RB14 steps 1 and 2; core.md CO13; FR-063, FR-067):
 * after U, or after a failed build, `keepAfter` with the `running` U left
 * moves the images no kept deploy names from `images` to `drop`, under the
 * state lock, before anything is removed; then each `drop` entry's image is
 * removed while its tag still leads to it, never with `-f`, and the entry
 * and its record file leave once it is gone. A removal Docker refuses keeps
 * its entry for the next deploy, and a cut anywhere is taken up by the next
 * deploy of the app.
 *
 * The runner's folder is set up in this process (`kept-home.ts`); Docker is
 * the stand-in, which refuses `image rm` without `-f` while a container uses
 * the image.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { builtImageName, keepAfter, withAppBuilds } from "@workspace/core"
import { chmodSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { writeState } from "../../src/home/home"
import { recordedKeys, writeRecord } from "../../src/kept/records"
import { retain } from "../../src/kept/retain"
import {
  fakeDocker,
  tempDir,
  waitFor,
  type FakeDocker,
} from "../support/helpers"
import { buildsOf, keptHome, laidDown, recordFor, stateIn } from "./kept-home"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

const hex = (c: string) => c.repeat(64)
const [K1, K2, K3, K4, K5] = ["1", "2", "3", "4", "5"].map(hex) as [
  string,
  string,
  string,
  string,
  string,
]
const tag = (key: string) => builtImageName("web", key)

async function setUp(): Promise<{ docker: FakeDocker; home: string }> {
  const docker = fakeDocker()
  process.env.ZEKNO_DOCKER = docker.path
  return { docker, home: await keptHome() }
}

/** The `zekno.invalid` tags the stand-in still has, sorted. */
const tags = (docker: FakeDocker) =>
  docker
    .model()
    .images.map((image) => image.tag)
    .sort()

const keysOf = (list: readonly { key: string }[] | undefined) =>
  (list ?? []).map((each) => each.key)

/** A deploy of `web` that built each of `keys`, B3 then U then R, as the runner runs them. */
async function deployBuilding(
  home: string,
  docker: FakeDocker,
  sequence: number,
  keys: string[],
  built: string[] = keys
) {
  const deploy = laidDown(home, docker, { sequence, keys, built })
  return retain(home, "web", sequence, deploy)
}

describe("retain: which images are kept (RB14 step 1, CO13)", () => {
  test("four distinct deploys keep three: the oldest one's image is removed, with its record, and no call holds the state lock", async () => {
    const { docker, home } = await setUp()
    expect(await deployBuilding(home, docker, 1, [K1])).toEqual({
      dropped: [],
      waiting: [],
    })
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    expect(await deployBuilding(home, docker, 4, [K4])).toEqual({
      dropped: [K1],
      waiting: [],
    })
    const builds = buildsOf(home)!
    expect(builds.running).toBe(4)
    expect(builds.deploys).toEqual([
      { sequence: 4, keys: [K4] },
      { sequence: 3, keys: [K3] },
      { sequence: 2, keys: [K2] },
    ])
    expect(keysOf(builds.images)).toEqual([K2, K3, K4])
    expect(builds.drop).toEqual([])
    expect(tags(docker)).toEqual([tag(K2), tag(K3), tag(K4)])
    expect(recordedKeys(home, "web")).toEqual([K2, K3, K4])
    // Each removal without -f, and no Docker call while the state lock was held (RB1).
    const removals = docker
      .argv()
      .filter((args) => args[0] === "image" && args[1] === "rm")
    expect(removals).toEqual([["image", "rm", tag(K1)]])
    for (const call of docker.calls()) {
      expect(call.stateLock).toBe(false)
      expect(call.cwd).toBe(home)
    }
  })

  test("deploys with the same keys are counted once", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    // Deploy 4 runs deploy 2's image again: two deploys, one set of keys.
    const again = laidDown(home, docker, { sequence: 4, keys: [K2] })
    expect(await retain(home, "web", 4, again)).toEqual({
      dropped: [],
      waiting: [],
    })
    const builds = buildsOf(home)!
    expect(builds.deploys).toEqual([
      { sequence: 4, keys: [K2] },
      { sequence: 3, keys: [K3] },
      { sequence: 1, keys: [K1] },
    ])
    expect(keysOf(builds.images)).toEqual([K1, K2, K3])
    expect(tags(docker)).toEqual([tag(K1), tag(K2), tag(K3)])
  })

  test("a failed build pushes nothing out, nor does a reuse", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    const before = buildsOf(home)
    const calls = docker.argv().length

    // Deploy 4's build failed: nothing of it was recorded, and `running` stays.
    expect(
      await retain(home, "web", 3, {
        sequence: 4,
        keys: [K4],
        outcome: "build_failed",
      })
    ).toEqual({ dropped: [], waiting: [] })
    expect(buildsOf(home)).toEqual(before)
    expect(docker.argv().length).toBe(calls)

    // Deploy 5 reuses deploy 1's image.
    const reuse = laidDown(home, docker, { sequence: 5, keys: [K1] })
    expect(await retain(home, "web", 5, reuse)).toEqual({
      dropped: [],
      waiting: [],
    })
    expect(keysOf(buildsOf(home)!.images)).toEqual([K1, K2, K3])
    expect(buildsOf(home)!.running).toBe(5)
    expect(tags(docker)).toEqual([tag(K1), tag(K2), tag(K3)])
  })

  test("a deploy that builds nothing, of an app with builds, keeps the two newest others", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    // Deploy 4 runs a registry image: no keys.
    expect(
      await retain(home, "web", 4, { sequence: 4, keys: [], outcome: "reused" })
    ).toEqual({ dropped: [K1], waiting: [] })
    expect(buildsOf(home)!.running).toBe(4)
    expect(keysOf(buildsOf(home)!.images)).toEqual([K2, K3])
    expect(tags(docker)).toEqual([tag(K2), tag(K3)])
  })

  test("an app with no builds in the state is left as it is", async () => {
    const { docker, home } = await setUp()
    const before = stateIn(home)
    expect(
      await retain(home, "web", 1, {
        sequence: 1,
        keys: [K1],
        outcome: "build_failed",
      })
    ).toEqual({ dropped: [], waiting: [] })
    expect(stateIn(home)).toEqual(before)
    expect(docker.calls()).toEqual([])
  })
})

describe("retain: the drop list (RB14 step 2)", () => {
  test("a removal refused while a container uses the image keeps its drop entry, and succeeds at a later deploy", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    docker.container({ name: "zekno-web-web-1", image: tag(K1) })
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    expect(await deployBuilding(home, docker, 4, [K4])).toEqual({
      dropped: [],
      waiting: [K1],
    })
    expect(keysOf(buildsOf(home)!.drop)).toEqual([K1])
    expect(tags(docker)).toContain(tag(K1))
    expect(recordedKeys(home, "web")).toContain(K1)

    // The container goes; the next deploy removes the image, and pushes out the next oldest.
    docker.change("zekno-web-web-1", { image: tag(K4) })
    expect(await deployBuilding(home, docker, 5, [K5])).toEqual({
      dropped: [K1, K2],
      waiting: [],
    })
    expect(buildsOf(home)!.drop).toEqual([])
    expect(tags(docker)).toEqual([tag(K3), tag(K4), tag(K5)])
    expect(recordedKeys(home, "web")).toEqual([K3, K4, K5])
    expect(
      docker
        .argv()
        .every((args) => !args.includes("-f") && !args.includes("--force"))
    ).toBe(true)
  })

  test("a tag that leads elsewhere is left, and its entry dropped with its record", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    // Retagged by hand: the tag now names another image.
    const other = docker.image(tag(K1))
    expect(await deployBuilding(home, docker, 4, [K4])).toEqual({
      dropped: [K1],
      waiting: [],
    })
    expect(buildsOf(home)!.drop).toEqual([])
    expect(docker.model().images.find((each) => each.tag === tag(K1))).toEqual(
      other
    )
    expect(recordedKeys(home, "web")).toEqual([K2, K3, K4])
    expect(
      docker.argv().filter((args) => args[0] === "image" && args[1] === "rm")
    ).toEqual([])
  })

  test("an image already gone leaves drop with its record", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    // Removed by hand, through the stand-in.
    Bun.spawnSync([docker.path, "image", "rm", tag(K1)], { cwd: home })
    expect(tags(docker)).not.toContain(tag(K1))
    expect(await deployBuilding(home, docker, 4, [K4])).toEqual({
      dropped: [K1],
      waiting: [],
    })
    expect(recordedKeys(home, "web")).toEqual([K2, K3, K4])
  })

  test("an entry that leaves drop takes its record file with it, before the next entry's image is asked about", async () => {
    const { docker, home } = await setUp()
    const image = (key: string) => {
      const made = docker.image(tag(key))
      writeRecord(home, "web", recordFor(key, made))
      return { key, manifest: made.manifest, config: made.config }
    }
    writeState(
      home,
      withAppBuilds(stateIn(home), "web", {
        running: 3,
        images: [image(K3)],
        deploys: [{ sequence: 3, keys: [K3] }],
        drop: [image(K1), image(K2)],
        fresh: [],
        last: null,
      })
    )
    // Docker answers for K1's tag, and hangs at K2's, so the test looks between the two.
    const dir = tempDir("retain-hold")
    const wrapper = join(dir, "docker")
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1 $2 $5" = "image inspect ${tag(K2)}" ]; then touch "${dir}/held"; exec sleep 30; fi\nexec "${docker.path}" "$@"\n`
    )
    chmodSync(wrapper, 0o755)
    process.env.ZEKNO_DOCKER = wrapper

    const retained = retain(
      home,
      "web",
      3,
      { sequence: 3, keys: [K3], outcome: "reused" },
      { limit: { timeoutMs: 3000 } }
    )
    await waitFor(() => existsSync(join(dir, "held")), "the hold at K2's tag")
    expect(keysOf(buildsOf(home)!.drop)).toEqual([K2])
    expect(recordedKeys(home, "web")).toEqual([K2, K3])
    expect(await retained).toEqual({ dropped: [K1], waiting: [K2] })
  })

  test("Docker that does not answer leaves the entry for the next deploy", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    docker.script({ failing: ["image inspect"] })
    expect(await deployBuilding(home, docker, 4, [K4])).toEqual({
      dropped: [],
      waiting: [K1],
    })
    expect(keysOf(buildsOf(home)!.drop)).toEqual([K1])
    expect(tags(docker)).toContain(tag(K1))
  })
})

describe("retain: a cut anywhere is taken up by the next deploy", () => {
  test("a cut after the move to drop, before any removal, is finished by the next deploy", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    await deployBuilding(home, docker, 2, [K2])
    await deployBuilding(home, docker, 3, [K3])
    // Deploy 4: B3, then step 1 of R, then the runner is cut before it removes anything.
    const four = laidDown(home, docker, {
      sequence: 4,
      keys: [K4],
      built: [K4],
    })
    const state = stateIn(home)
    writeState(
      home,
      withAppBuilds(
        state,
        "web",
        keepAfter(state.builds.web, { ...four, images: [] }, 4)
      )
    )
    expect(keysOf(buildsOf(home)!.drop)).toEqual([K1])
    expect(tags(docker)).toContain(tag(K1))

    // The next deploy of the app takes it up.
    expect(await deployBuilding(home, docker, 5, [K5])).toEqual({
      dropped: [K1, K2],
      waiting: [],
    })
    expect(buildsOf(home)!.drop).toEqual([])
    expect(tags(docker)).toEqual([tag(K3), tag(K4), tag(K5)])
    expect(recordedKeys(home, "web")).toEqual([K3, K4, K5])
  })

  test("a record file a cut left behind, of a key the state no longer names, is deleted", async () => {
    const { docker, home } = await setUp()
    await deployBuilding(home, docker, 1, [K1])
    // Cut after the entry left drop, before its file was deleted; or after B3 wrote a record, before the state.
    writeRecord(
      home,
      "web",
      recordFor(K5, {
        manifest: `sha256:${hex("a")}`,
        config: `sha256:${hex("b")}`,
      })
    )
    expect(recordedKeys(home, "web")).toEqual([K1, K5])
    await deployBuilding(home, docker, 2, [K2])
    expect(recordedKeys(home, "web")).toEqual([K1, K2])
  })
})
