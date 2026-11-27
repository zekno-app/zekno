/**
 * Images no record will name (specs/016-build-from-source, T084;
 * contracts/runner.md RB11 last two bullets; FR-043, FR-067, SC-012): the
 * images a deploy that ends `build_failed` tagged are removed while each tag
 * still leads to the image its build made; a leftover under a tag, an image
 * none of the state's digests for its key name, is removed before the key
 * is built. Never with `-f`: an image a container uses stays, and the
 * failure is reported, not thrown.
 *
 * Docker is the stand-in (`test/support/docker/`), which keeps the images
 * builds tag and refuses `image rm` without `-f` while a container uses one.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { builtImageName } from "@workspace/core"
import { realpathSync } from "node:fs"

import { removeDeployImages, removeLeftover } from "../../src/kept/leftovers"
import { fakeDocker, tempDir, type FakeDocker } from "../support/helpers"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

const hex = (c: string) => c.repeat(64)
const digest = (c: string) => `sha256:${hex(c)}`
const K1 = hex("1")
const K2 = hex("2")
const K3 = hex("3")
const tag = (key: string) => builtImageName("web", key)

/** The stand-in, used by the calls that follow, and the runner's folder Docker runs in. */
function setUp(): { docker: FakeDocker; home: string } {
  const docker = fakeDocker()
  process.env.ZEKNO_DOCKER = docker.path
  return { docker, home: realpathSync(tempDir("leftovers-home")) }
}

/** The tags the stand-in still has. */
const tags = (docker: FakeDocker) =>
  docker
    .model()
    .images.map((image) => image.tag)
    .sort()

/** Every `image rm` the stand-in answered, each argument list as passed. */
const removals = (docker: FakeDocker) =>
  docker.argv().filter((args) => args[0] === "image" && args[1] === "rm")

/** True when no call passed a force flag. */
const neverForced = (docker: FakeDocker) =>
  docker
    .argv()
    .every((args) => !args.includes("-f") && !args.includes("--force"))

describe("removeDeployImages", () => {
  test("each image the deploy tagged is removed while its tag leads to it, by the manifest or the config digest, without -f", async () => {
    const { docker, home } = setUp()
    const one = docker.image(tag(K1))
    // The classic store gives the config digest as `.Id`.
    const two = docker.image(tag(K2), { id: digest("c"), config: digest("c") })
    const removed = await removeDeployImages(home, "web", [
      { key: K1, manifest: one.manifest, config: one.config },
      { key: K2, manifest: two.manifest, config: two.config },
    ])
    expect(removed).toEqual([
      { key: K1, removal: "removed" },
      { key: K2, removal: "removed" },
    ])
    expect(tags(docker)).toEqual([])
    expect(removals(docker)).toEqual([
      ["image", "rm", tag(K1)],
      ["image", "rm", tag(K2)],
    ])
    expect(neverForced(docker)).toBe(true)
    // Each call in the runner's folder, none while the state lock is held (RB1).
    for (const call of docker.calls()) {
      expect(call.cwd).toBe(home)
      expect(call.stateLock).toBe(false)
    }
  })

  test("an image whose tag now leads elsewhere is left", async () => {
    const { docker, home } = setUp()
    // The build made one image; the tag was moved to another since.
    docker.image(tag(K1), { id: digest("e"), manifest: digest("e") })
    const removed = await removeDeployImages(home, "web", [
      { key: K1, manifest: digest("a"), config: digest("b") },
    ])
    expect(removed).toEqual([{ key: K1, removal: "left" }])
    expect(tags(docker)).toEqual([tag(K1)])
    expect(removals(docker)).toEqual([])
  })

  test("a tag with no image is gone, and nothing is removed", async () => {
    const { docker, home } = setUp()
    const removed = await removeDeployImages(home, "web", [
      { key: K1, manifest: digest("a"), config: digest("b") },
    ])
    expect(removed).toEqual([{ key: K1, removal: "gone" }])
    expect(removals(docker)).toEqual([])
  })

  test("a removal that fails is reported, not thrown, and the next build's image is still tried", async () => {
    const { docker, home } = setUp()
    const used = docker.image(tag(K1))
    const free = docker.image(tag(K2))
    // A container uses the first image: Docker refuses to remove it without -f.
    docker.container({ name: "someone", image: tag(K1) })
    const removed = await removeDeployImages(home, "web", [
      { key: K1, manifest: used.manifest, config: used.config },
      { key: K2, manifest: free.manifest, config: free.config },
    ])
    expect(removed).toEqual([
      { key: K1, removal: "failed" },
      { key: K2, removal: "removed" },
    ])
    expect(tags(docker)).toEqual([tag(K1)])
    expect(neverForced(docker)).toBe(true)
  })

  test("Docker failing to answer is reported as failed, and nothing is removed", async () => {
    const { docker, home } = setUp()
    const made = docker.image(tag(K1))
    docker.script({ failing: ["image inspect"] })
    const removed = await removeDeployImages(home, "web", [
      { key: K1, manifest: made.manifest, config: made.config },
    ])
    expect(removed).toEqual([{ key: K1, removal: "failed" }])
    expect(tags(docker)).toEqual([tag(K1)])
    expect(removals(docker)).toEqual([])
  })

  test("a deploy that tagged nothing makes no call", async () => {
    const { docker, home } = setUp()
    expect(await removeDeployImages(home, "web", [])).toEqual([])
    expect(docker.calls()).toEqual([])
  })
})

describe("removeLeftover", () => {
  test("a leftover is removed before its key is built: an image none of the state's digests for the key name", async () => {
    const { docker, home } = setUp()
    // Left by a failed deploy, or by a runner that died: not the image the state records.
    docker.image(tag(K1), { id: digest("9"), manifest: digest("9") })
    const left = await removeLeftover(home, "web", K1, {
      manifest: digest("a"),
      config: digest("b"),
    })
    expect(left).toBe("removed")
    expect(tags(docker)).toEqual([])
    expect(removals(docker)).toEqual([["image", "rm", tag(K1)]])
    expect(neverForced(docker)).toBe(true)
  })

  test("with no record of the key, any image under its tag is a leftover", async () => {
    const { docker, home } = setUp()
    docker.image(tag(K2))
    expect(await removeLeftover(home, "web", K2, undefined)).toBe("removed")
    expect(tags(docker)).toEqual([])
  })

  test("the image the state records for the key, by either digest, is not a leftover", async () => {
    const { docker, home } = setUp()
    const kept = docker.image(tag(K1))
    expect(
      await removeLeftover(home, "web", K1, {
        manifest: kept.manifest,
        config: kept.config,
      })
    ).toBe("recorded")
    const classic = docker.image(tag(K2), {
      id: digest("d"),
      config: digest("d"),
    })
    expect(
      await removeLeftover(home, "web", K2, {
        manifest: classic.manifest,
        config: digest("d"),
      })
    ).toBe("recorded")
    expect(tags(docker)).toEqual([tag(K1), tag(K2)])
    expect(removals(docker)).toEqual([])
  })

  test("no image under the tag: nothing to remove", async () => {
    const { docker, home } = setUp()
    expect(await removeLeftover(home, "web", K3, undefined)).toBe("none")
    expect(removals(docker)).toEqual([])
  })

  test("a leftover a container uses is reported as failed, not thrown, and stays", async () => {
    const { docker, home } = setUp()
    docker.image(tag(K1))
    docker.container({ name: "someone", image: tag(K1) })
    expect(await removeLeftover(home, "web", K1, undefined)).toBe("failed")
    expect(tags(docker)).toEqual([tag(K1)])
    expect(neverForced(docker)).toBe(true)
  })

  test("Docker failing to answer: nothing is known of the image, so nothing is removed", async () => {
    const { docker, home } = setUp()
    docker.image(tag(K1))
    docker.script({ failing: ["image inspect"] })
    expect(await removeLeftover(home, "web", K1, undefined)).toBe("failed")
    expect(tags(docker)).toEqual([tag(K1)])
    expect(removals(docker)).toEqual([])
  })
})
