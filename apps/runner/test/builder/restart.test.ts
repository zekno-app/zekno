/**
 * The restart path (specs/016-build-from-source, T091; contracts/runner.md
 * RB15; FR-031b, FR-039, FR-045, FR-050; plan item 28 (b)): a request that
 * finds the state's `building` set stops every client of the runner's user
 * that carries the run's token, waits for Docker's records and removes
 * them, removes the images no record names and the work folders, and
 * records `runner_restarted`; the bounded part looks once and never waits.
 * Docker is the stand-in (`test/support/docker/`): its build clients are
 * real processes that write their environment to the stand-in's proc folder
 * as Linux keeps it. Real `/proc` and Docker: check L5 in the Linux
 * stand-in.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import {
  builtImageName,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  generateServerKeyPair,
  newRunnerState,
  readRunnerState,
  type AppBuilds,
  type Building,
  type StoredRunnerState,
  type TeamTrust,
} from "@workspace/core"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { refsNow } from "../../src/builder/history"
import { boundedRestart, restart } from "../../src/builder/restart"
import { readState, writeState } from "../../src/home/home"
import { clients, procEntry, startBuild } from "../support/docker/build-client"
import type { ScriptedBuild } from "../support/docker/model"
import { fakeDocker, isAlive, tempDir, waitFor } from "../support/helpers"

const RUN = "cd".repeat(16)
/** A key whose image the state records, and one whose tag holds a leftover. */
const KEPT = "1".repeat(64)
const LEFT = "2".repeat(64)
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const saved = {
  docker: process.env.ZEKNO_DOCKER,
  unpacked: process.env.ZEKNO_RUNNER_UNPACKED,
}
const putBack = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
afterEach(() => {
  putBack("ZEKNO_DOCKER", saved.docker)
  putBack("ZEKNO_RUNNER_UNPACKED", saved.unpacked)
  for (const child of clients.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL")
})

let team: TeamTrust
beforeAll(async () => {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  team = (await createTeam({ founderName: "Ada", signer })).trust
})

/**
 * A runner's home whose deploy 3 of `web` builds `KEPT` and `LEFT`: the
 * state records `KEPT`'s image (deploy 2 runs it), `LEFT`'s tag holds an
 * image no record names, the deploy's pieces are in `building/web/`, and a
 * work folder is in the unpacked folder. Docker is a fresh stand-in.
 */
function place(
  building: Partial<Building> = {},
  last: AppBuilds["last"] = null
) {
  const docker = fakeDocker()
  const dir = tempDir("restart-home")
  const unpacked = tempDir("restart-unpacked")
  process.env.ZEKNO_DOCKER = docker.path
  process.env.ZEKNO_RUNNER_UNPACKED = unpacked
  const kept = docker.image(builtImageName("web", KEPT))
  docker.image(builtImageName("web", LEFT))
  const builds: Record<string, AppBuilds> = {
    web: {
      running: 2,
      images: [{ key: KEPT, manifest: kept.manifest, config: kept.config }],
      deploys: [{ sequence: 2, keys: [KEPT] }],
      drop: [],
      fresh: [],
      last,
    },
  }
  const { serverId } = generateServerKeyPair()
  writeState(
    dir,
    readRunnerState({
      ...newRunnerState({ serverId, team }),
      lastSequence: { web: 3 },
      formats: { web: 2 },
      builds,
      building: {
        app: "web",
        sequence: 3,
        keys: [KEPT, LEFT],
        since: new Date(Date.now() - 60_000).toISOString(),
        limit: 1800,
        phase: "building",
        run: RUN,
        stopped: null,
        ...building,
      },
    })
  )
  mkdirSync(join(dir, "building", "web"), { recursive: true })
  writeFileSync(join(dir, "building", "web", "a".repeat(64)), "piece")
  mkdirSync(join(unpacked, "0123456789abcdef01234567"), { mode: 0o700 })
  writeFileSync(join(unpacked, "0123456789abcdef01234567", "meta.json"), "{}")
  return { docker, dir, unpacked, procRoot: docker.procRoot }
}
type Place = ReturnType<typeof place>

const stateOf = (p: Place): StoredRunnerState =>
  readRunnerState(readState(p.dir))
const tags = (p: Place) =>
  p.docker
    .model()
    .images.map((image) => image.tag)
    .sort()

/** Starts a stand-in build client carrying `token`, as the runner starts one (RB7), once its proc entry is there. */
async function client(p: Place, token = RUN, script: ScriptedBuild = {}) {
  p.docker.script({ nextBuilds: [{ hang: true, ...script }] })
  const child = startBuild({
    docker: p.docker,
    home: p.dir,
    work: tempDir("restart-work"),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: p.dir,
      BUILDX_CONFIG: join(p.dir, "buildx"),
      BUILDX_GIT_INFO: "0",
      BUILDX_GIT_LABELS: "0",
      ZEKNO_BUILD_RUN: token,
    },
  })
  await waitFor(
    () => Bun.file(procEntry(p.docker, child.pid)).size > 0,
    "the client's proc entry"
  )
  return child
}

/**
 * Puts a stand-in for Docker in front of `p`'s that hangs at every call
 * beginning with `words` and hands every other call on; gives the calls it
 * saw, each as its words.
 */
function hanging(p: Place, words: string): () => string[] {
  const dir = tempDir("restart-hang")
  const path = join(dir, "docker")
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/calls"\ncase "$*" in "${words}"*) exec sleep 30;; esac\nexec "${p.docker.path}" "$@"\n`
  )
  chmodSync(path, 0o755)
  process.env.ZEKNO_DOCKER = path
  return () =>
    existsSync(join(dir, "calls"))
      ? readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean)
      : []
}

/** The Docker calls made since `from`, each as its words. */
const callsSince = (p: Place, from: number) =>
  p.docker
    .calls()
    .slice(from)
    .map((call) => call.args)

describe("restart (RB15)", () => {
  test("phase building: the client stopped, its record removed, the leftover removed and the recorded image kept, the folders emptied, runner_restarted recorded and building cleared", async () => {
    const p = place()
    const child = await client(p)
    const [ref] = refsNow(p.dir)
    const from = p.docker.calls().length

    expect(await restart(p.dir, stateOf(p), { procRoot: p.procRoot })).toEqual({
      cleared: true,
      stale: 0,
    })
    expect(await child.exited).toBe(130)
    expect(callsSince(p, from)).toEqual([
      `buildx history inspect --builder default ${ref!.id}`,
      `buildx history rm --builder default ${ref!.id}`,
      `image inspect --format {{.Id}} zekno.invalid/web:${KEPT}`,
      `image inspect --format {{.Id}} zekno.invalid/web:${LEFT}`,
      `image rm zekno.invalid/web:${LEFT}`,
    ])
    // No Docker call is made under the state lock (RB1).
    expect(
      p.docker
        .calls()
        .slice(from)
        .every((call) => !call.stateLock)
    ).toBe(true)
    expect(refsNow(p.dir)).toEqual([])
    expect(p.docker.model().records[0]!.deleted).toBe(true)
    expect(tags(p)).toEqual([`zekno.invalid/web:${KEPT}`])
    expect(existsSync(join(p.dir, "building", "web"))).toBe(false)
    expect(readdirSync(p.unpacked)).toEqual([])

    const state = stateOf(p)
    expect(state.building).toBeNull()
    // The number stays used; nothing built is recorded.
    expect(state.lastSequence).toEqual({ web: 3 })
    expect(state.builds.web).toMatchObject({
      running: 2,
      deploys: [{ sequence: 2, keys: [KEPT] }],
      last: {
        sequence: 3,
        outcome: "build_failed",
        reason: "runner_restarted",
        at: expect.stringMatching(ISO),
      },
    })
  }, 30_000)

  test("an unpacked folder that is not there is never made: nothing was unpacked in it", async () => {
    const p = place()
    const absent = join(p.unpacked, "absent")
    process.env.ZEKNO_RUNNER_UNPACKED = absent
    expect(await restart(p.dir, stateOf(p), { procRoot: p.procRoot })).toEqual({
      cleared: true,
      stale: 0,
    })
    expect(existsSync(absent)).toBe(false)
    expect(existsSync(join(p.dir, "building", "web"))).toBe(false)
    expect(stateOf(p).building).toBeNull()
  }, 30_000)

  test("phase stopping, its outcome written by the deploy that stopped it: the same steps, and that `last` stays", async () => {
    const last = {
      sequence: 3,
      outcome: "build_failed" as const,
      reason: "time_limit" as const,
      at: "2026-11-28T10:00:00.000Z",
    }
    const p = place(
      { phase: "stopping", stopped: new Date().toISOString() },
      last
    )
    const child = await client(p)
    expect(await restart(p.dir, stateOf(p), { procRoot: p.procRoot })).toEqual({
      cleared: true,
      stale: 0,
    })
    expect(await child.exited).toBe(130)
    expect(refsNow(p.dir)).toEqual([])
    expect(tags(p)).toEqual([`zekno.invalid/web:${KEPT}`])
    const state = stateOf(p)
    expect(state.building).toBeNull()
    expect(state.builds.web!.last).toEqual(last)
  }, 30_000)

  test("phase starting: building cleared and `last` as B3 wrote it; no process signalled, no Docker call", async () => {
    const last = {
      sequence: 3,
      outcome: "built" as const,
      reason: null,
      at: "2026-11-28T10:00:00.000Z",
    }
    const p = place({ phase: "starting" }, last)
    const child = await client(p)
    const from = p.docker.calls().length
    expect(await restart(p.dir, stateOf(p), { procRoot: p.procRoot })).toEqual({
      cleared: true,
      stale: 0,
    })
    expect(callsSince(p, from)).toEqual([])
    expect(isAlive(child.pid)).toBe(true)
    const state = stateOf(p)
    expect(state.building).toBeNull()
    expect(state.builds.web!.last).toEqual(last)
    expect(state.lastSequence).toEqual({ web: 3 })
  }, 30_000)

  test("a record that still runs after the wait: building stays, phase stopping with its stop time, and the ref file, the images and the folders stay", async () => {
    const p = place()
    const child = await client(p, RUN, { recordRuns: "forever" })
    const started = Date.now()
    expect(
      await restart(p.dir, stateOf(p), {
        procRoot: p.procRoot,
        waitMs: 600,
        everyMs: 100,
      })
    ).toEqual({ cleared: false, stale: 0 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(600)
    expect(await child.exited).toBe(130)
    const state = stateOf(p)
    expect(state.building).toMatchObject({
      phase: "stopping",
      run: RUN,
      stopped: expect.stringMatching(ISO),
    })
    expect(state.builds.web!.last).toBeNull()
    expect(refsNow(p.dir)).toHaveLength(1)
    expect(tags(p)).toHaveLength(2)
    expect(existsSync(join(p.dir, "building", "web"))).toBe(true)
    expect(readdirSync(p.unpacked)).toHaveLength(1)
  }, 30_000)

  test("the 10-minute rule (item 28 (b)): once no process of the run is alive and a record has run that long past `stopped`, the steps run anyway and the ref file stays", async () => {
    const p = place()
    await client(p, RUN, { recordRuns: "forever" })
    const bounds = { procRoot: p.procRoot, waitMs: 200, everyMs: 50 }
    expect(await restart(p.dir, stateOf(p), bounds)).toEqual({
      cleared: false,
      stale: 0,
    })
    const stopped = Date.parse(stateOf(p).building!.stopped!)
    // Not yet that long past the stop: still busy.
    expect(
      await restart(p.dir, stateOf(p), { ...bounds, staleMs: 60_000 })
    ).toEqual({ cleared: false, stale: 0 })
    await Bun.sleep(Math.max(0, stopped + 400 - Date.now()))
    expect(
      await restart(p.dir, stateOf(p), { ...bounds, staleMs: 400 })
    ).toEqual({ cleared: true, stale: 1 })
    // Its ref file is kept for a later removal, and `builder` counts it.
    expect(refsNow(p.dir)).toHaveLength(1)
    expect(p.docker.model().records[0]!.deleted).toBeUndefined()
    expect(tags(p)).toEqual([`zekno.invalid/web:${KEPT}`])
    const state = stateOf(p)
    expect(state.building).toBeNull()
    expect(state.builds.web!.last).toMatchObject({
      sequence: 3,
      reason: "runner_restarted",
    })
  }, 30_000)

  test("the 10 minutes count from the stop the state holds: a stop 11 minutes ago lets the steps run at the first look", async () => {
    const p = place({
      phase: "stopping",
      stopped: new Date(Date.now() - 11 * 60_000).toISOString(),
    })
    await client(p, RUN, { recordRuns: "forever" })
    const started = Date.now()
    expect(await restart(p.dir, stateOf(p), { procRoot: p.procRoot })).toEqual({
      cleared: true,
      stale: 1,
    })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(refsNow(p.dir)).toHaveLength(1)
    expect(stateOf(p).building).toBeNull()
  }, 30_000)
})

describe("boundedRestart (RB15, the bounded part)", () => {
  test("never waits: one look at a record that still runs, then building stays with phase stopping", async () => {
    const p = place()
    const child = await client(p, RUN, { recordRuns: "forever" })
    const from = p.docker.calls().length
    const started = Date.now()
    expect(
      await boundedRestart(p.dir, stateOf(p), { procRoot: p.procRoot })
    ).toEqual({ cleared: false, stale: 0 })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(await child.exited).toBe(130)
    // One look, no removal.
    expect(callsSince(p, from)).toEqual([
      `buildx history inspect --builder default ${refsNow(p.dir)[0]!.id}`,
    ])
    expect(stateOf(p).building).toMatchObject({ phase: "stopping" })
    expect(tags(p)).toHaveLength(2)
  }, 30_000)

  test("when no record runs: the records removed, then steps 3 to 5", async () => {
    const p = place()
    const child = await client(p)
    expect(
      await boundedRestart(p.dir, stateOf(p), { procRoot: p.procRoot })
    ).toEqual({ cleared: true, stale: 0 })
    expect(await child.exited).toBe(130)
    expect(refsNow(p.dir)).toEqual([])
    expect(tags(p)).toEqual([`zekno.invalid/web:${KEPT}`])
    expect(existsSync(join(p.dir, "building", "web"))).toBe(false)
    expect(readdirSync(p.unpacked)).toEqual([])
    const state = stateOf(p)
    expect(state.building).toBeNull()
    expect(state.builds.web!.last).toMatchObject({
      sequence: 3,
      outcome: "build_failed",
      reason: "runner_restarted",
    })
  }, 30_000)

  test("the first Docker call that does not answer ends it: one image inspect, building kept with phase stopping, and a later restart carries on", async () => {
    const p = place()
    const calls = hanging(p, "image inspect")
    const started = Date.now()
    expect(
      await boundedRestart(p.dir, stateOf(p), {
        procRoot: p.procRoot,
        lookMs: 300,
      })
    ).toEqual({ cleared: false, stale: 0 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(calls()).toEqual([
      `image inspect --format {{.Id}} zekno.invalid/web:${KEPT}`,
    ])
    expect(stateOf(p).building).toMatchObject({
      phase: "stopping",
      stopped: expect.stringMatching(ISO),
    })
    expect(existsSync(join(p.dir, "building", "web"))).toBe(true)
    expect(readdirSync(p.unpacked)).toHaveLength(1)

    // Docker answers again: the next request's restart finishes the steps.
    process.env.ZEKNO_DOCKER = p.docker.path
    expect(await restart(p.dir, stateOf(p), { procRoot: p.procRoot })).toEqual({
      cleared: true,
      stale: 0,
    })
    expect(tags(p)).toEqual([`zekno.invalid/web:${KEPT}`])
    expect(stateOf(p).building).toBeNull()
  }, 30_000)

  test("one look at a record that does not answer, and no look at the others: building kept with phase stopping", async () => {
    const p = place()
    const refs = join(p.dir, "buildx", "refs", "default", "default")
    mkdirSync(refs, { recursive: true })
    for (const id of ["aaaaaaaaaaaaaaaaaaaaaaaa1", "bbbbbbbbbbbbbbbbbbbbbbbb2"])
      writeFileSync(join(refs, id), "/nowhere")
    const calls = hanging(p, "buildx history inspect")
    const started = Date.now()
    expect(
      await boundedRestart(p.dir, stateOf(p), {
        procRoot: p.procRoot,
        lookMs: 300,
      })
    ).toEqual({ cleared: false, stale: 0 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(calls()).toEqual([
      "buildx history inspect --builder default aaaaaaaaaaaaaaaaaaaaaaaa1",
    ])
    expect(stateOf(p).building).toMatchObject({ phase: "stopping" })
    expect(tags(p)).toHaveLength(2)
  }, 30_000)
})
