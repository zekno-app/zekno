/**
 * Can Docker build (specs/016-build-from-source, contracts/runner.md RB5;
 * FR-034a, FR-078): what `docker version`, `docker buildx version`,
 * `docker context show`, `docker buildx inspect` and buildx's help texts
 * say, read through the stand-in for Docker as Docker 29 prints them, and
 * `canBuild`'s answer from those facts. The buildx floor is not here: it
 * waits for check L2 (T074). Real Docker: job `older-engine` (B5) on
 * 29.4.3, Ubuntu's `docker.io` with and without its buildx, and
 * `floor-no-buildx`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  canBuild,
  dockerFacts,
  ENGINE_FLOOR,
  readVersion,
  type DockerFacts,
} from "../../src/builder/facts"
import { fakeDocker, type FakeDocker } from "../support/docker/fake"
import { isAlive, tempDir } from "../support/helpers"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

/** The stand-in for Docker, scripted as given, used by the calls that follow. */
function standIn(docker: Parameters<FakeDocker["script"]>[0]["docker"] = {}) {
  const d = fakeDocker()
  d.script({ docker })
  process.env.ZEKNO_DOCKER = d.path
  return d
}

const home = () => tempDir("facts-home")

/** The calls RB5 makes, in order, when every one can answer. */
const ALL_CALLS = [
  ["version", "--format", "json"],
  ["buildx", "version"],
  ["context", "show"],
  ["buildx", "inspect", "--builder", "default"],
  ["buildx", "build", "--help"],
  ["buildx", "prune", "--help"],
]

/** Facts of a Docker that can build, for `canBuild` alone. */
const ABLE: DockerFacts = {
  engine: "29.6.1",
  arch: "amd64",
  buildx: "0.34.1",
  context: "default",
  driver: "docker",
  buildkit: "0.31.1",
  policy: true,
  maxUsedSpace: true,
}

describe("dockerFacts", () => {
  test("reads each answer of a Docker that can build, each call in order, in the runner's folder", async () => {
    const d = standIn()
    const dir = home()
    expect(await dockerFacts(dir)).toEqual(ABLE)
    expect(d.argv()).toEqual(ALL_CALLS)
    for (const call of d.calls()) expect(call.cwd).toBe(realpathSync(dir))
  })

  test("aarch64 reads as arm64, and any other processor as other", async () => {
    standIn({ arch: "aarch64" })
    expect((await dockerFacts(home())).arch).toBe("arm64")
    standIn({ arch: "arm64" })
    expect((await dockerFacts(home())).arch).toBe("arm64")
    standIn({ arch: "s390x" })
    expect((await dockerFacts(home())).arch).toBe("other")
  })

  test("a docker-container builder: its driver and its BuildKit", async () => {
    standIn({ driver: "docker-container", buildkit: "v0.26.2" })
    const facts = await dockerFacts(home())
    expect(facts).toMatchObject({
      driver: "docker-container",
      buildkit: "0.26.2",
    })
    expect(canBuild(facts)).toEqual({ can: "no_build_plugin" })
  })

  test("the builder asked is the current context's", async () => {
    const d = standIn({ context: "desktop-linux" })
    const facts = await dockerFacts(home())
    expect(facts.context).toBe("desktop-linux")
    expect(facts.driver).toBe("docker")
    expect(d.argv()).toContainEqual([
      "buildx",
      "inspect",
      "--builder",
      "desktop-linux",
    ])
  })

  test("the plugin missing: no buildx, no driver, no flags", async () => {
    const d = standIn({ buildx: null })
    const facts = await dockerFacts(home())
    expect(facts).toEqual({
      ...ABLE,
      buildx: null,
      driver: null,
      buildkit: null,
      policy: false,
      maxUsedSpace: false,
    })
    expect(canBuild(facts)).toEqual({ can: "no_build_plugin" })
    // Neither its builder nor its help is asked of a Docker without it.
    expect(d.argv()).toEqual(ALL_CALLS.slice(0, 3))
  })

  test("the help texts say whether --policy and --max-used-space exist", async () => {
    standIn({ policy: false, maxUsedSpace: false })
    expect(await dockerFacts(home())).toMatchObject({
      policy: false,
      maxUsedSpace: false,
    })
    standIn({ policy: true, maxUsedSpace: false })
    expect(await dockerFacts(home())).toMatchObject({
      policy: true,
      maxUsedSpace: false,
    })
  })

  test("no engine answering: no engine, and its builder is not asked", async () => {
    const d = standIn({ engine: null })
    const facts = await dockerFacts(home())
    expect(facts).toMatchObject({
      engine: null,
      arch: "other",
      buildx: "0.34.1",
      driver: null,
      buildkit: null,
    })
    expect(canBuild(facts)).toEqual({ can: "no_docker" })
    expect(d.argv()).not.toContainEqual([
      "buildx",
      "inspect",
      "--builder",
      "default",
    ])
  })

  test("a suffixed version is kept as Docker gave it, without its v, and compared by its numbers", async () => {
    standIn({ engine: "29.5.0-rc.1", buildx: "v0.35.0-desktop.2" })
    const facts = await dockerFacts(home())
    expect(facts.engine).toBe("29.5.0-rc.1")
    expect(facts.buildx).toBe("0.35.0-desktop.2")
    expect(canBuild(facts)).toEqual({ can: "yes" })
  })

  test("Ubuntu's buildx, whose version has no v", async () => {
    standIn({ buildx: "0.30.1" })
    expect((await dockerFacts(home())).buildx).toBe("0.30.1")
  })

  test("engines 29.4.3 and 29.1.3 are too old", async () => {
    for (const engine of ["29.4.3", "29.1.3"]) {
      standIn({ engine })
      const facts = await dockerFacts(home())
      expect(facts.engine).toBe(engine)
      expect(canBuild(facts)).toEqual({
        can: "docker_too_old",
        docker: { engine, buildx: "0.34.1" },
      })
    }
  })

  test("a call that hangs is cut at its limit, and the others are still asked", async () => {
    const d = fakeDocker()
    // `docker buildx inspect` never answers; every other call goes to the stand-in.
    const dir = tempDir("facts-hang")
    const path = join(dir, "docker")
    const pid = join(dir, "inspect.pid")
    writeFileSync(
      path,
      `#!/bin/sh
if [ "$1 $2" = "buildx inspect" ]; then echo $$ > "${pid}"; exec sleep 60; fi
exec "${d.path}" "$@"
`
    )
    chmodSync(path, 0o755)
    process.env.ZEKNO_DOCKER = path
    const started = Date.now()
    const facts = await dockerFacts(home(), { timeoutMs: 1000 })
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(facts).toMatchObject({
      engine: "29.6.1",
      buildx: "0.34.1",
      driver: null,
      buildkit: null,
      policy: true,
      maxUsedSpace: true,
    })
    expect(canBuild(facts)).toEqual({ can: "no_build_plugin" })
    const hung = Number(await Bun.file(pid).text())
    expect(isAlive(hung)).toBe(false)
  })

  test("an answer that does not read gives nothing", async () => {
    standIn({ engine: "twenty-nine", buildx: "latest" })
    const facts = await dockerFacts(home())
    expect(facts).toMatchObject({ engine: null, buildx: null })
    expect(canBuild(facts)).toEqual({ can: "no_docker" })
    standIn({ buildkit: "dev" })
    const kit = await dockerFacts(home())
    expect(kit).toMatchObject({ driver: "docker", buildkit: null })
    expect(canBuild(kit)).toEqual({ can: "yes" })
  })
})

describe("canBuild", () => {
  test("yes for a Docker that can build", () => {
    expect(canBuild(ABLE)).toEqual({ can: "yes" })
  })

  test("no engine answer is no_docker, whatever else is known", () => {
    expect(canBuild({ ...ABLE, engine: null })).toEqual({ can: "no_docker" })
    expect(canBuild({ ...ABLE, engine: null, buildx: null })).toEqual({
      can: "no_docker",
    })
  })

  test("an engine below 29.5.0 is docker_too_old, with the engine and buildx", () => {
    expect(ENGINE_FLOOR).toBe("29.5.0")
    expect(canBuild({ ...ABLE, engine: "29.4.3" })).toEqual({
      can: "docker_too_old",
      docker: { engine: "29.4.3", buildx: "0.34.1" },
    })
    expect(canBuild({ ...ABLE, engine: "28.10.9", buildx: null })).toEqual({
      can: "docker_too_old",
      docker: { engine: "28.10.9", buildx: null },
    })
    // Exactly the floor, and above it by any part, compared as numbers.
    for (const engine of ["29.5.0", "29.10.0", "29.5.1", "30.0.0", "100.0.0"])
      expect(canBuild({ ...ABLE, engine })).toEqual({ can: "yes" })
    expect(canBuild({ ...ABLE, engine: "29.4.99" }).can).toBe("docker_too_old")
  })

  test("buildx missing or failing, or a driver other than docker, is no_build_plugin", () => {
    expect(canBuild({ ...ABLE, buildx: null })).toEqual({
      can: "no_build_plugin",
    })
    expect(canBuild({ ...ABLE, driver: null })).toEqual({
      can: "no_build_plugin",
    })
    for (const driver of ["docker-container", "kubernetes", "remote"])
      expect(canBuild({ ...ABLE, driver })).toEqual({ can: "no_build_plugin" })
  })

  test("an engine too old comes before a missing plugin", () => {
    expect(
      canBuild({ ...ABLE, engine: "29.1.3", buildx: null, driver: null })
    ).toEqual({
      can: "docker_too_old",
      docker: { engine: "29.1.3", buildx: null },
    })
  })
})

describe("readVersion", () => {
  test("a version held to its pattern, without its v; its numbers", () => {
    expect(readVersion("v0.35.0-desktop.2")).toEqual({
      text: "0.35.0-desktop.2",
      numbers: [0, 35, 0],
    })
    expect(readVersion("29.4.3")).toEqual({
      text: "29.4.3",
      numbers: [29, 4, 3],
    })
    expect(readVersion("26.1.5+dfsg1")).toEqual({
      text: "26.1.5+dfsg1",
      numbers: [26, 1, 5],
    })
    for (const bad of [
      "",
      "v",
      "29.4",
      "29.4.3.1",
      "latest",
      "v29.4.3 x",
      "29.4.3\n",
    ])
      expect(readVersion(bad)).toBeUndefined()
  })
})
