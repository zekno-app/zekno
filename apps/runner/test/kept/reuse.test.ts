/**
 * K14a, whether a build is kept (specs/016-build-from-source,
 * contracts/runner.md RB3 K14a, RB4 first bullet, RB14 last paragraph;
 * FR-061, FR-062, FR-064): kept when the state records the key for the app,
 * in `images` or in `drop`, and the image under its tag is still the one the
 * runner made, by its manifest digest (the containerd store) or its config
 * digest (the classic store; E01, T10). A recorded key whose image is gone or
 * leads elsewhere is named for `pack_missing`'s `missing.images`.
 *
 * Docker here is a stand-in that answers `docker image inspect --format
 * '{{.Id}}'` from a table of tags, and records each argument list. Check L4
 * runs the same on real Docker, both stores.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { builtImageName, type AppBuilds } from "@workspace/core"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { keptBuilds, missingImages } from "../../src/kept/reuse"
import { tempDir } from "../support/helpers"

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
const image = (key: string, manifest: string, config: string) => ({
  key,
  manifest: digest(manifest),
  config: digest(config),
})

/**
 * A stand-in Docker for `image inspect`: each tag in `images` answers its
 * `.Id`; any other is "No such image", as Docker 29 says it. `down` makes
 * every call fail as Docker does when its daemon does not answer. Each
 * argument list is recorded, one call a line.
 */
function docker(
  images: Record<string, string>,
  options: { down?: boolean } = {}
) {
  const dir = tempDir("reuse-docker")
  const path = join(dir, "docker")
  const table = join(dir, "images")
  const calls = join(dir, "calls")
  writeFileSync(
    table,
    Object.entries(images)
      .map(([tag, id]) => `${tag} ${id}\n`)
      .join("")
  )
  writeFileSync(
    path,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
${
  options.down
    ? `echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1`
    : ""
}
[ "$1 $2 $3 $4" = "image inspect --format {{.Id}}" ] || { echo "unknown call" >&2; exit 2; }
id=$(awk -v t="$5" '$1 == t { print $2 }' "${table}")
if [ -z "$id" ]; then echo "Error response from daemon: No such image: $5" >&2; exit 1; fi
echo "$id"
`
  )
  chmodSync(path, 0o755)
  process.env.ZEKNO_DOCKER = path
  return {
    calls: () =>
      existsSync(calls)
        ? readFileSync(calls, "utf8").split("\n").filter(Boolean)
        : [],
  }
}

/** A state whose `web` keeps `images` and is to remove `drop`. */
function stateWith(
  images: AppBuilds["images"],
  drop: AppBuilds["drop"] = []
): { builds: Record<string, AppBuilds> } {
  return {
    builds: {
      web: {
        running: 3,
        images,
        deploys:
          images.length > 0
            ? [{ sequence: 3, keys: images.map((each) => each.key) }]
            : [],
        drop,
        fresh: [],
        last: null,
      },
    },
  }
}

const tag = (key: string) => builtImageName("web", key)
const home = () => tempDir("reuse-home")

describe("keptBuilds", () => {
  test("kept when .Id equals the manifest digest, as the containerd store gives it", async () => {
    const d = docker({ [tag(K1)]: digest("a") })
    const state = stateWith([image(K1, "a", "b")])
    expect(await keptBuilds(home(), state, "web", [{ key: K1 }])).toEqual([
      { key: K1, reuse: "kept" },
    ])
    expect(d.calls()).toEqual([`image inspect --format {{.Id}} ${tag(K1)}`])
  })

  test("kept when .Id equals the config digest, as the classic store gives it", async () => {
    docker({ [tag(K1)]: digest("b") })
    const state = stateWith([image(K1, "a", "b")])
    expect(await keptBuilds(home(), state, "web", [{ key: K1 }])).toEqual([
      { key: K1, reuse: "kept" },
    ])
  })

  test("a key in drop whose image is still there is kept", async () => {
    docker({ [tag(K2)]: digest("c") })
    const state = stateWith([image(K1, "a", "b")], [image(K2, "c", "d")])
    expect(await keptBuilds(home(), state, "web", [{ key: K2 }])).toEqual([
      { key: K2, reuse: "kept" },
    ])
  })

  test("a tag retagged by hand is changed", async () => {
    docker({ [tag(K1)]: digest("e") })
    const state = stateWith([image(K1, "a", "b")])
    expect(await keptBuilds(home(), state, "web", [{ key: K1 }])).toEqual([
      { key: K1, reuse: "not_kept", image: "changed" },
    ])
  })

  test("a removed image is gone", async () => {
    docker({})
    const state = stateWith([image(K1, "a", "b")], [image(K2, "c", "d")])
    expect(
      await keptBuilds(home(), state, "web", [{ key: K1 }, { key: K2 }])
    ).toEqual([
      { key: K1, reuse: "not_kept", image: "gone" },
      { key: K2, reuse: "not_kept", image: "gone" },
    ])
  })

  test("a key the state never recorded is not_kept with no images entry, and Docker is not asked", async () => {
    // Its image is even there: only a key the runner recorded can be kept.
    const d = docker({ [tag(K3)]: digest("a") })
    const state = stateWith([image(K1, "a", "b")])
    const reuse = await keptBuilds(home(), state, "web", [{ key: K3 }])
    expect(reuse).toEqual([{ key: K3, reuse: "not_kept" }])
    expect(missingImages(reuse)).toEqual([])
    expect(d.calls()).toEqual([])
    // An app the state has no builds for.
    expect(
      await keptBuilds(home(), { builds: {} }, "web", [{ key: K1 }])
    ).toEqual([{ key: K1, reuse: "not_kept" }])
  })

  test("a key recorded for another app is not kept for this one", async () => {
    docker({ [builtImageName("api", K1)]: digest("a"), [tag(K1)]: digest("a") })
    const state = {
      builds: { api: stateWith([image(K1, "a", "b")]).builds.web! },
    }
    expect(await keptBuilds(home(), state, "web", [{ key: K1 }])).toEqual([
      { key: K1, reuse: "not_kept" },
    ])
  })

  test("Docker failing is not_kept, with no images entry", async () => {
    docker({ [tag(K1)]: digest("a") }, { down: true })
    const state = stateWith([image(K1, "a", "b")])
    const reuse = await keptBuilds(home(), state, "web", [{ key: K1 }])
    expect(reuse).toEqual([{ key: K1, reuse: "not_kept" }])
    expect(missingImages(reuse)).toEqual([])
  })

  test("each build in the order given, in the runner's folder", async () => {
    const d = docker({ [tag(K1)]: digest("a"), [tag(K2)]: digest("x") })
    const state = stateWith([image(K1, "a", "b"), image(K2, "c", "d")])
    expect(
      await keptBuilds(home(), state, "web", [{ key: K2 }, { key: K1 }])
    ).toEqual([
      { key: K2, reuse: "not_kept", image: "changed" },
      { key: K1, reuse: "kept" },
    ])
    expect(d.calls()).toEqual([
      `image inspect --format {{.Id}} ${tag(K2)}`,
      `image inspect --format {{.Id}} ${tag(K1)}`,
    ])
  })
})

describe("missingImages", () => {
  test("the recorded builds whose image is gone or changed, sorted by key, each once, for pack_missing", () => {
    expect(
      missingImages([
        { key: K3, reuse: "not_kept", image: "changed" },
        { key: K1, reuse: "kept" },
        { key: K2, reuse: "not_kept", image: "gone" },
        { key: K2, reuse: "not_kept", image: "gone" },
        { key: hex("4"), reuse: "not_kept" },
      ])
    ).toEqual([
      { key: K2, state: "gone" },
      { key: K3, state: "changed" },
    ])
  })
})
