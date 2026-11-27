/**
 * RB15 where requests come in (specs/016-build-from-source, T094;
 * contracts/runner.md RB1 fifth and sixth bullets, RB2, RB15 last
 * paragraphs, RB17; data-model.md, "The locks"). A runner died during
 * deploy 2's build of `web`: the state's `building` holds its run token, a
 * stand-in build client carrying that token still runs, its build tagged an
 * image no record names, and its pieces and work folder are still there. A
 * request that takes the deploy lock (`apply`, `proxy`, `setup`) runs RB15
 * first; `sync`, `pack`, `builds` and `status` try the deploy lock once and
 * run RB15's bounded part, and are answered within seconds while a record
 * still runs. Every request goes through the real runner program, one-shot
 * where it has a one-shot command and in a session, with the stand-in for
 * Docker.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { builtImageName } from "@workspace/core"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { clients, procEntry, startBuild } from "../support/docker/build-client"
import type { ScriptedBuild } from "../support/docker/model"
import {
  buildDeploy,
  deployed,
  isAlive,
  runner,
  session,
  tempDir,
  waitFor,
} from "../support/helpers"
import { buildingDeploy, packRequest } from "../support/pack-staging"
import { ask, type World } from "../support/routes"

const RUN = "cd".repeat(16)
const KEY = "ab".repeat(32)
const TAG = builtImageName("web", KEY)
const WORK = "0123456789abcdef01234567"
/** A deploy lock held by a live process other than the runner's: this test's own. */
const LIVE = `${process.pid}:held`

const NAMES = ["ZEKNO_DOCKER", "ZEKNO_RUNNER_PROC", "ZEKNO_RUNNER_UNPACKED"]
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]))
afterEach(() => {
  for (const name of NAMES)
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  for (const child of clients.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL")
})

type State = {
  lastSequence: Record<string, number>
  builds: Record<string, { last: unknown }>
  building: Record<string, unknown> | null
}
const stateFile = (home: string) => join(home, "state.json")
const stateOf = (home: string) =>
  JSON.parse(readFileSync(stateFile(home), "utf8")) as State
const refsIn = (home: string) => {
  const folder = join(home, "buildx", "refs", "default", "default")
  return existsSync(folder) ? readdirSync(folder) : []
}
const tags = (w: World) =>
  w.docker
    .model()
    .images.map((image) => image.tag)
    .sort()

/**
 * A server whose runner died during deploy 2's build of `web` (deploy 1
 * still runs): `building` written with the number (CO13), a stand-in client
 * carrying the run's token, the image it tagged, the deploy's pieces and
 * its work folder. `env` points the runner at the stand-in's proc folder
 * and a temporary unpacked folder, never the real ones.
 */
async function interrupted(script: ScriptedBuild = {}) {
  const w = await deployed(["web"])
  const unpacked = tempDir("restart-unpacked")
  const env = {
    ZEKNO_RUNNER_PROC: w.docker.procRoot,
    ZEKNO_RUNNER_UNPACKED: unpacked,
  }
  const state = stateOf(w.home)
  state.lastSequence.web = 2
  state.building = {
    app: "web",
    sequence: 2,
    keys: [KEY],
    since: new Date(Date.now() - 60_000).toISOString(),
    limit: 1800,
    phase: "building",
    run: RUN,
    stopped: null,
  }
  writeFileSync(stateFile(w.home), JSON.stringify(state), { mode: 0o600 })
  w.docker.image(TAG)
  mkdirSync(join(w.home, "building", "web"), { recursive: true })
  writeFileSync(join(w.home, "building", "web", "c".repeat(64)), "piece")
  mkdirSync(join(unpacked, WORK), { mode: 0o700 })
  writeFileSync(join(unpacked, WORK, "meta.json"), "{}")

  w.docker.script({ nextBuilds: [{ hang: true, ...script }] })
  const child = startBuild({
    docker: w.docker,
    home: w.home,
    work: join(unpacked, WORK),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: w.home,
      BUILDX_CONFIG: join(w.home, "buildx"),
      BUILDX_GIT_INFO: "0",
      BUILDX_GIT_LABELS: "0",
      ZEKNO_BUILD_RUN: RUN,
    },
  })
  await waitFor(
    () => Bun.file(procEntry(w.docker, child.pid)).size > 0,
    "the client's proc entry"
  )
  expect(refsIn(w.home)).toHaveLength(1)
  return { w, env, unpacked, child }
}
type Interrupted = Awaited<ReturnType<typeof interrupted>>

/**
 * The one-shot runner program, run as SSH would, with `t.env` too: the
 * helper hands this process's environment on, so `t.env` is put there for
 * the call, and `afterEach` takes it out again.
 */
function oneShot(t: Interrupted, command: string, message?: unknown) {
  Object.assign(process.env, t.env)
  return runner(t.w.home, t.w.docker.path, command, message)
}

/** One request in a session of its own, with `t.env`. */
const inSession = (t: Interrupted, command: string, input?: unknown) =>
  ask(t.w, command, input, t.env)

/** The founding team list and its code, as `zekno server setup` sends them. */
const setupInput = (t: Interrupted) => ({
  founding: t.w.team.envelope,
  teamCode: t.w.team.confirmationCode,
})

/** The fields `status` has always answered with (FR-033). */
const STATUS_FIELDS = [
  "lastSequence",
  "secrets",
  "serverId",
  "serverPublicKey",
  "team",
]

/** RB15 ran in full: the client stopped, its record removed, the image, the pieces and the work folder gone, `runner_restarted` recorded. */
async function expectRestarted(t: Interrupted) {
  expect(await t.child.exited).toBe(130)
  expect(refsIn(t.w.home)).toEqual([])
  expect(tags(t.w)).not.toContain(TAG)
  expect(existsSync(join(t.w.home, "building", "web"))).toBe(false)
  expect(readdirSync(t.unpacked)).toEqual([])
  const state = stateOf(t.w.home)
  expect(state.building).toBeNull()
  // The interrupted deploy's number stays used.
  expect(state.lastSequence).toEqual({ web: 2 })
  expect(state.builds.web!.last).toMatchObject({
    sequence: 2,
    outcome: "build_failed",
    reason: "runner_restarted",
  })
}

/** RB15's bounded part stopped the client and found its record still running: `building` stays with phase `stopping`. */
async function expectStillStopping(t: Interrupted) {
  expect(await t.child.exited).toBe(130)
  expect(refsIn(t.w.home)).toHaveLength(1)
  expect(tags(t.w)).toContain(TAG)
  expect(existsSync(join(t.w.home, "building", "web"))).toBe(true)
  expect(stateOf(t.w.home).building).toMatchObject({
    phase: "stopping",
    run: RUN,
    stopped: expect.any(String),
  })
}

describe("a request that takes the deploy lock runs RB15 first (RB1)", () => {
  test("apply: the restart, then its own answer; the running deploy is never started again", async () => {
    const t = await interrupted()
    const deploy = await buildDeploy({
      trust: t.w.trust,
      serverId: t.w.serverId,
      signer: t.w.signer,
      sequence: 3,
    })
    const from = t.w.docker.calls().length
    const s = session(t.w.home, t.w.docker.path, t.env)
    const { result } = await s.request({
      command: "apply",
      input: { rosters: t.w.rosters, deploy },
    })
    await s.close()
    // `web` is at format 2, so the version-1 deploy is refused after RB15, not `busy`.
    expect(result).toEqual({
      outcome: "refused",
      reason: "unsupported_version",
    })
    await expectRestarted(t)
    expect(
      t.w.docker
        .calls()
        .slice(from)
        .some((call) => call.args.startsWith("compose"))
    ).toBe(false)
  }, 60_000)

  test("proxy: the restart, then its own answer", async () => {
    const t = await interrupted()
    expect(await ask(t.w, "proxy", undefined, t.env)).toEqual({
      proxy: "none",
    })
    await expectRestarted(t)
  }, 60_000)

  test("setup on a server already set up, one-shot and in a session: the restart, then already_set_up", async () => {
    for (const way of ["one-shot", "session"]) {
      const t = await interrupted()
      const answer =
        way === "one-shot"
          ? (await oneShot(t, "setup", setupInput(t))).json
          : await inSession(t, "setup", setupInput(t))
      expect(answer).toEqual({ outcome: "refused", reason: "already_set_up" })
      await expectRestarted(t)
    }
    // Not set up, it sets the server up as before.
    const t = await interrupted()
    const home = tempDir("runner")
    const fresh = await runner(home, t.w.docker.path, "setup", setupInput(t))
    expect(fresh.json).toHaveProperty("serverId")
  }, 60_000)

  test("setup while another process holds the deploy lock, one-shot and in a session: busy, and the build left as it is", async () => {
    const t = await interrupted()
    writeFileSync(join(t.w.home, "lock"), LIVE)
    const busy = { outcome: "refused", reason: "busy" }
    expect((await oneShot(t, "setup", setupInput(t))).json).toEqual(busy)
    expect(await inSession(t, "setup", setupInput(t))).toEqual(busy)
    expect(isAlive(t.child.pid)).toBe(true)
    expect(stateOf(t.w.home).building).toMatchObject({ phase: "building" })
    expect(readFileSync(join(t.w.home, "lock"), "utf8")).toBe(LIVE)
    rmSync(join(t.w.home, "lock"))
  }, 60_000)
})

describe("sync, pack, builds and status run RB15's bounded part (RB1)", () => {
  test("a sync is answered within seconds while a record still runs: the client stopped, building kept with phase stopping; a later sync finishes the restart once it ends", async () => {
    const t = await interrupted({ recordRuns: 4 })
    const started = Date.now()
    expect(await ask(t.w, "sync", { rosters: t.w.rosters }, t.env)).toEqual({
      outcome: "ok",
    })
    expect(Date.now() - started).toBeLessThan(15_000)
    await expectStillStopping(t)

    // Once Docker's record has ended, the next sync carries out steps 3 to 5.
    await Bun.sleep(4500)
    expect(await ask(t.w, "sync", { rosters: t.w.rosters }, t.env)).toEqual({
      outcome: "ok",
    })
    await expectRestarted(t)
  }, 60_000)

  test("status, one-shot, is answered within seconds while a record still runs, its answer's shape unchanged", async () => {
    const t = await interrupted({ recordRuns: "forever" })
    const started = Date.now()
    const answer = (await oneShot(t, "status")).json!
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(Object.keys(answer).sort()).toEqual(STATUS_FIELDS)
    expect(answer.lastSequence).toEqual({ web: 2 })
    await expectStillStopping(t)
  }, 60_000)

  test("status with no record running, one-shot, in a session and with routes: the restart carried out, then the answer", async () => {
    for (const way of ["one-shot", "session", "routes"]) {
      const t = await interrupted()
      const answer =
        way === "one-shot"
          ? (await oneShot(t, "status")).json!
          : way === "session"
            ? await inSession(t, "status")
            : await inSession(t, "status", { routes: true })
      expect(Object.keys(answer).sort()).toEqual(
        way === "routes"
          ? [...STATUS_FIELDS, "health", "proxy", "routes"].sort()
          : STATUS_FIELDS
      )
      await expectRestarted(t)
    }
  }, 60_000)

  test("a pack is answered within seconds while a record still runs: staged, the client stopped, building kept with phase stopping", async () => {
    const t = await interrupted({ recordRuns: "forever" })
    const { envelope, pieces } = await buildingDeploy(t.w, { previous: 2 })
    const started = Date.now()
    const s = session(t.w.home, t.w.docker.path, t.env)
    const { result } = await s.request(packRequest(envelope, pieces[0]!.sealed))
    await s.close()
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(result).toEqual({ staged: pieces[0]!.fingerprint })
    await expectStillStopping(t)
  }, 60_000)

  test("a pack with no record running: the restart carried out, then the piece staged", async () => {
    const t = await interrupted()
    const { envelope, pieces } = await buildingDeploy(t.w, { previous: 2 })
    const s = session(t.w.home, t.w.docker.path, t.env)
    const { result } = await s.request(packRequest(envelope, pieces[0]!.sealed))
    await s.close()
    expect(result).toEqual({ staged: pieces[0]!.fingerprint })
    await expectRestarted(t)
  }, 60_000)

  test("builds with no input, and with apps: the restart carried out first, so the answer has no build under way", async () => {
    const t = await interrupted()
    expect(await inSession(t, "builds")).toEqual({ built: ["web"] })
    await expectRestarted(t)

    const again = await interrupted()
    const answer = (await inSession(again, "builds", { apps: ["web"] })) as {
      apps: Record<string, { building: unknown; last: unknown }>
    }
    expect(answer.apps.web!.building).toBeNull()
    expect(answer.apps.web!.last).toMatchObject({
      sequence: 2,
      reason: "runner_restarted",
    })
    await expectRestarted(again)
  }, 60_000)

  test("builds while a record still runs: answered within seconds, the build it reports already stopping", async () => {
    const t = await interrupted({ recordRuns: "forever" })
    const started = Date.now()
    const answer = (await inSession(t, "builds", { apps: ["web"] })) as {
      apps: Record<string, { building: unknown }>
    }
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(answer.apps.web!.building).toMatchObject({
      sequence: 2,
      phase: "stopping",
    })
    await expectStillStopping(t)
  }, 60_000)

  test("a sync while another process holds the deploy lock skips the restart and is answered", async () => {
    const t = await interrupted()
    writeFileSync(join(t.w.home, "lock"), LIVE)
    const started = Date.now()
    expect(await ask(t.w, "sync", { rosters: t.w.rosters }, t.env)).toEqual({
      outcome: "ok",
    })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(isAlive(t.child.pid)).toBe(true)
    expect(refsIn(t.w.home)).toHaveLength(1)
    expect(stateOf(t.w.home).building).toMatchObject({
      phase: "building",
      stopped: null,
    })
    expect(readFileSync(join(t.w.home, "lock"), "utf8")).toBe(LIVE)
    rmSync(join(t.w.home, "lock"))
  }, 60_000)
})
