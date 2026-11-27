/**
 * `builder` (specs/016-build-from-source, T093; contracts/runner.md RB17
 * second bullet, RB5, RB6; core.md CO12 `BuilderAnswer`; FR-078 to FR-080),
 * against the real runner program in a session and the stand-in for Docker:
 * what the server can build with, whether it can build, its memory, its
 * least free disk and the floor, the build records left that could not be
 * removed (`stale`, item 28), and with `usage` what the runner's images and
 * the build cache take. No lock, and RB15's bounded part is not run.
 */
import { describe, expect, test } from "bun:test"
import {
  LIMITS,
  parseMessage,
  RunnerBuilderSchema,
  SESSION_FRAME_BYTES,
} from "@workspace/core"
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { DOCKER_DEFAULTS, type ScriptedDocker } from "../support/docker/model"
import { deployed, session, tempDir, world } from "../support/helpers"
import { addApp, changeState, digest, hex, tagOf } from "../support/kept-builds"

type World = Awaited<ReturnType<typeof world>>

const refused = (reason: string) => ({ outcome: "refused", reason })
/** A lock held by a live process other than the runner's: this test's own. */
const LIVE = `${process.pid}:held`
const FLOOR = LIMITS.diskFloorBytes

/**
 * What Docker says of itself (the stand-in's defaults with `docker` over
 * them), with Docker's root a folder of this machine, and the work folders'
 * parent another: folders that exist, so their free space reads.
 */
function places(w: World, docker: Partial<ScriptedDocker> = {}) {
  w.docker.script({
    docker: {
      ...DOCKER_DEFAULTS,
      dockerRootDir: tempDir("docker-root"),
      ...docker,
    },
  })
  return { ZEKNO_RUNNER_UNPACKED: tempDir("unpacked") }
}

/** Asks `builder` on a session of its own and gives its answer, after checking its frame. */
async function ask(
  w: World,
  env: Record<string, string>,
  input?: unknown,
  docker = w.docker.path
) {
  const s = session(w.home, docker, env)
  const { events, result } = await s.request(
    input === undefined ? { command: "builder" } : { command: "builder", input }
  )
  expect(events).toEqual([])
  await s.close()
  const lines = s.output().split("\n").filter(Boolean)
  expect(lines).toHaveLength(1)
  expect(Buffer.byteLength(lines[0]!)).toBeLessThan(SESSION_FRAME_BYTES.builder)
  return result
}

const isBuilder = (answer: unknown) =>
  parseMessage(RunnerBuilderSchema, answer).ok

/** The calls made since `from`, as Docker's argument lists. */
const callsSince = (w: World, from: number) =>
  w.docker
    .calls()
    .slice(from)
    .map((call) => call.args)

describe("builder", () => {
  test("a Docker that can build: its versions, processor and memory, the least free disk and the floor; no usage unless asked", async () => {
    const w = await world()
    const env = places(w)
    for (const input of [undefined, {}]) {
      const from = w.docker.calls().length
      const answer = await ask(w, env, input)
      expect(answer).toEqual({
        docker: {
          engine: "29.6.1",
          buildx: "0.34.1",
          buildkit: "0.31.1",
          driver: "docker",
        },
        arch: "amd64",
        memory: 8_324_206_592,
        disk: { free: expect.any(Number), floor: FLOOR },
        can: "yes",
        stale: 0,
      })
      expect(Object.hasOwn(answer, "usage")).toBe(false)
      expect((answer.disk as { free: number }).free).toBeGreaterThan(0)
      expect(isBuilder(answer)).toBe(true)
      const calls = callsSince(w, from)
      expect(calls).toContain("info --format {{.MemTotal}}")
      expect(calls).toContain("info --format {{.DockerRootDir}}")
      expect(calls.some((args) => args.startsWith("image "))).toBe(false)
      expect(calls.some((args) => args.startsWith("buildx du"))).toBe(false)
    }
    // No Docker call held the state lock.
    expect(w.docker.calls().every((call) => !call.stateLock)).toBe(true)
  }, 30_000)

  test("each can: no engine, an engine below the floor, no build plugin, a builder that is not Docker's own", async () => {
    const w = await world()
    const cases: [Partial<ScriptedDocker>, string, Record<string, unknown>][] =
      [
        [{ engine: null }, "no_docker", { engine: null }],
        [{ engine: "29.4.3" }, "docker_too_old", { engine: "29.4.3" }],
        [{ buildx: null }, "no_build_plugin", { buildx: null }],
        [
          { driver: "docker-container" },
          "no_build_plugin",
          { driver: "docker-container" },
        ],
        [
          { engine: "29.5.0", arch: "aarch64", buildx: "v0.35.0-desktop.2" },
          "yes",
          { engine: "29.5.0", buildx: "0.35.0-desktop.2" },
        ],
      ]
    for (const [docker, can, shown] of cases) {
      const env = places(w, docker)
      const answer = await ask(w, env)
      expect(answer.can).toBe(can)
      expect(answer.docker).toMatchObject(shown)
      expect(isBuilder(answer)).toBe(true)
    }
    // With no engine, Docker says nothing of its memory or root, so the free disk is not known.
    const env = places(w, { engine: null, arch: "amd64" })
    const answer = await ask(w, env)
    expect(answer).toMatchObject({
      docker: { engine: null, buildkit: null, driver: null },
      arch: "other",
      memory: null,
      disk: { free: null, floor: FLOOR },
      can: "no_docker",
    })
    expect(
      (await ask(w, places(w, { arch: "aarch64", buildx: "0.30.1" }))).arch
    ).toBe("arm64")
  }, 60_000)

  test("Docker missing altogether: no_docker with nulls, and usage null when asked", async () => {
    const w = await world()
    const missing = join(w.home, "no-such-docker")
    const env = { ZEKNO_RUNNER_UNPACKED: tempDir("unpacked") }
    const answer = await ask(w, env, undefined, missing)
    expect(answer).toEqual({
      docker: { engine: null, buildx: null, buildkit: null, driver: null },
      arch: "other",
      memory: null,
      disk: { free: null, floor: FLOOR },
      can: "no_docker",
      stale: 0,
    })
    expect(isBuilder(answer)).toBe(true)
    const asked = await ask(w, env, { usage: true }, missing)
    expect(asked.usage).toBeNull()
    expect(isBuilder(asked)).toBe(true)
  })

  test("usage when asked: the size of every image the state names, once each, and the build cache", async () => {
    const w = await world()
    const env = places(w)
    changeState(w.home, (state) => {
      addApp(state, "web", 4)
      addApp(state, "api", 1)
      state.builds.web = {
        running: 4,
        images: [
          { key: hex("a"), manifest: digest("1"), config: digest("2") },
          { key: hex("b"), manifest: digest("3"), config: digest("4") },
        ],
        deploys: [{ sequence: 4, keys: [hex("a"), hex("b")] }],
        drop: [{ key: hex("c"), manifest: digest("5"), config: digest("6") }],
        fresh: [],
        last: null,
      }
      state.builds.api = {
        running: 1,
        images: [{ key: hex("d"), manifest: digest("7"), config: digest("8") }],
        deploys: [{ sequence: 1, keys: [hex("d")] }],
        drop: [],
        fresh: [],
        last: null,
      }
    })
    w.docker.image(tagOf("web", hex("a")), { size: 1_000 })
    w.docker.image(tagOf("web", hex("b")), { size: 20_000 })
    w.docker.image(tagOf("web", hex("c")), { size: 300_000 })
    // api's image is gone: it takes nothing. An image the state does not name is not the runner's to count.
    w.docker.image(tagOf("web", hex("e")), { size: 9_000_000 })
    w.docker.script({ du: 1_234_000_000 })

    const from = w.docker.calls().length
    const answer = await ask(w, env, { usage: true })
    expect(answer.usage).toEqual({ images: 321_000, cache: 1_234_000_000 })
    expect(isBuilder(answer)).toBe(true)
    const calls = callsSince(w, from)
    expect(calls.filter((args) => args.startsWith("image "))).toEqual([
      `image inspect --format {{.Size}} ${tagOf("api", hex("d"))} ${tagOf("web", hex("a"))} ${tagOf("web", hex("b"))} ${tagOf("web", hex("c"))}`,
    ])
    expect(calls.filter((args) => args.startsWith("buildx du"))).toEqual([
      "buildx du --builder default",
    ])

    // No image named: no inspect, 0 bytes; an empty cache.
    changeState(w.home, (state) => {
      state.builds = {}
    })
    w.docker.script({ du: 0 })
    const empty = callsSince(w, 0).length
    expect((await ask(w, env, { usage: true })).usage).toEqual({
      images: 0,
      cache: 0,
    })
    expect(
      callsSince(w, empty).filter((args) => args.startsWith("image "))
    ).toEqual([])
  }, 30_000)

  test("stale counts the build refs left whose records could not be removed, not those of the build under way", async () => {
    const w = await deployed(["web"])
    const env = places(w)
    const refs = join(w.home, "buildx", "refs", "default", "default")
    mkdirSync(refs, { recursive: true, mode: 0o700 })
    const old = new Date(Date.now() - 3600_000)
    for (const id of ["k3x9r1", "m2p8q4"]) {
      writeFileSync(join(refs, id), "/tmp/context\n", { mode: 0o600 })
      utimesSync(join(refs, id), old, old)
    }
    expect((await ask(w, env)).stale).toBe(2)

    // A build under way since a minute ago: its own ref, newer, is not left over.
    writeFileSync(join(refs, "z7w5v6"), "/tmp/context\n", { mode: 0o600 })
    changeState(w.home, (state) => {
      state.building = {
        app: "web",
        sequence: state.lastSequence.web,
        keys: [hex("a")],
        since: new Date(Date.now() - 60_000).toISOString(),
        limit: 1800,
        phase: "building",
        run: "cd".repeat(16),
        stopped: null,
      }
    })
    expect((await ask(w, env)).stale).toBe(2)
    // Once the build is no longer under way, every ref left counts.
    changeState(w.home, (state) => {
      state.building = null
    })
    expect((await ask(w, env)).stale).toBe(3)
  }, 30_000)

  test("answers while another request holds both locks, and leaves them as they are", async () => {
    const w = await world()
    const env = places(w)
    writeFileSync(join(w.home, "lock"), LIVE)
    writeFileSync(join(w.home, "state.lock"), LIVE)
    expect((await ask(w, env)).can).toBe("yes")
    expect(readFileSync(join(w.home, "lock"), "utf8")).toBe(LIVE)
    expect(readFileSync(join(w.home, "state.lock"), "utf8")).toBe(LIVE)
  })

  test("an input that is not its own is invalid_request, Docker never asked; a runner not set up is not_set_up", async () => {
    const w = await world()
    const env = places(w)
    const from = w.docker.calls().length
    for (const input of [
      "garbage",
      [],
      null,
      { usage: false },
      { usage: 1 },
      { usage: true, extra: 1 },
      { apps: ["web"] },
    ])
      expect(await ask(w, env, input)).toEqual(refused("invalid_request"))
    expect(w.docker.calls()).toHaveLength(from)
    const s = session(join(w.home, "missing"), w.docker.path, env)
    expect((await s.request({ command: "builder" })).result).toEqual(
      refused("not_set_up")
    )
    await s.close()
  }, 30_000)
})
