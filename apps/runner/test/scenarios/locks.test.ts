/**
 * Who takes which lock (specs/016-build-from-source, T065; contracts/
 * runner.md RB1; data-model.md, "The locks"; FR-044), against the real
 * runner program and the stand-in for Docker. `setup` takes the deploy lock
 * D, then the state lock S; `sync` takes S only, so it is answered during a
 * deploy; `apply` (version 1) holds both for its whole span; `proxy` takes D,
 * and S around its state write; a version-2 `deploy` holds D for its whole
 * span and S for K3 to K14 and around each later state write, each reading
 * the state again and changing only its own part. A `deploy` that finds D
 * held answers `busy` at once, with the build under way when the state has
 * one (CO10). Locks whose holder is gone are taken over.
 */
import { describe, expect, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  parseMessage,
  proposeRoster,
  RunnerReportSchema,
  type TeamTrust,
} from "@workspace/core"
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { sync } from "../../src/commands/commands"
import {
  buildDeployV2,
  deployV2,
  leftAsItWas,
  olderState,
} from "../support/deploy-v2"
import {
  buildDeploy,
  deployed,
  fakeDocker,
  runner,
  session,
  tempDir,
  waitFor,
  world,
} from "../support/helpers"
import { APP, deletions, releasedAlone } from "../support/released"
import { ask, steps, up, type World } from "../support/routes"

const BUSY = { outcome: "refused", reason: "busy" } as const
const KEY = "ab".repeat(32)
const RUN = "cd".repeat(16)
/** A pid no process has here: the highest a pid can be on Linux, and beyond any macOS gives. */
const GONE = 4194304
/** A lock held by a live process other than the runner's: this test's own. */
const LIVE = `${process.pid}:held`

const lockOf = (home: string) => join(home, "lock")
const stateLockOf = (home: string) => join(home, "state.lock")
const stateFile = (home: string) => join(home, "state.json")
const stateOf = (home: string) =>
  JSON.parse(readFileSync(stateFile(home), "utf8")) as Record<string, unknown>
const teamOf = (home: string) => stateOf(home).team as TeamTrust

/** The team lists of `w` with a newer one signed after them, and the trust it gives. */
async function newerTeam(w: { trust: TeamTrust; rosters: unknown[] }) {
  const newer = await proposeRoster({
    trust: w.trust,
    signer: (w as unknown as World).signer,
  })
  return { rosters: [...w.rosters, newer.envelope], trust: newer.trust }
}

/**
 * Writes the state with `building` set for `web` at its last number, in
 * `phase`, started `secondsAgo` seconds ago, as a deploy that builds writes
 * it with its number (CO13).
 */
function setBuilding(
  home: string,
  phase: "building" | "stopping" | "starting",
  secondsAgo: number
) {
  const state = stateOf(home)
  const last = (state.lastSequence as Record<string, number>).web!
  const since = new Date(Date.now() - secondsAgo * 1000).toISOString()
  state.building = {
    app: "web",
    sequence: last,
    keys: [KEY],
    since,
    limit: 1800,
    phase,
    run: RUN,
    stopped: phase === "stopping" ? new Date().toISOString() : null,
  }
  writeFileSync(stateFile(home), JSON.stringify(state), { mode: 0o600 })
}

/** The next deploy of `web`, made against `previous`, as a zekno sends it. */
async function nextDeploy(w: World, previous: number) {
  return {
    rosters: w.rosters,
    ...(await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous,
    })),
  }
}

/** The result frame of a session, skipping its events. */
async function resultOf(s: ReturnType<typeof session>) {
  for (;;) {
    const frame = await s.next()
    if (frame === undefined) throw new Error("the session ended first")
    if ("result" in frame) return frame.result as Record<string, unknown>
  }
}

describe("sync takes the state lock only (RB1)", () => {
  test("a sync is answered while a deploy holds the deploy lock, one-shot and in a session; the deploy's later write keeps the newer team list", async () => {
    const w = await world()
    w.docker.app("web", { web: 1 })
    w.docker.holdUp()
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      routes: [APP],
    })
    const s = session(w.home, w.docker.path)
    s.send({ command: "deploy", input: { rosters: w.rosters, ...built } })
    await waitFor(w.docker.upStarted, "docker compose up to start")
    // The deploy holds D through `up`, and S is free.
    expect(existsSync(lockOf(w.home))).toBe(true)
    expect(existsSync(stateLockOf(w.home))).toBe(false)

    const newer = await newerTeam(w)
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters: newer.rosters }))
        .json
    ).toEqual({ outcome: "ok" })
    expect(teamOf(w.home)).toEqual(newer.trust)
    const newest = await newerTeam({ ...w, ...newer })
    const other = session(w.home, w.docker.path)
    expect(
      (
        await other.request({
          command: "sync",
          input: { rosters: newest.rosters },
        })
      ).result
    ).toEqual({ outcome: "ok" })
    expect((await other.close()).code).toBe(0)
    expect(teamOf(w.home)).toEqual(newest.trust)

    w.docker.releaseUp()
    expect(await resultOf(s)).toEqual({
      outcome: "started",
      app: "web",
      sequence: 1,
    })
    expect((await s.close()).code).toBe(0)
    // The routes were saved by reading the state again: the team lists the syncs saved are kept.
    const after = stateOf(w.home)
    expect(after.team).toEqual(newest.trust)
    expect(after.lastSequence).toEqual({ web: 1 })
    expect(Object.keys(after.routes as object)).toEqual(["web"])
    expect(readdirSync(w.home)).not.toContain("lock")
    expect(readdirSync(w.home)).not.toContain("state.lock")
  })

  test("a sync, or a deploy at K3, that finds the state lock held waits, and lands once it is released", async () => {
    const w = await deployed(["web"])
    // A sync of a newer team list.
    writeFileSync(stateLockOf(w.home), LIVE)
    const newer = await newerTeam(w)
    let started = Date.now()
    const syncing = runner(w.home, w.docker.path, "sync", {
      rosters: newer.rosters,
    })
    await Bun.sleep(500)
    expect(teamOf(w.home)).toEqual(w.trust)
    rmSync(stateLockOf(w.home))
    expect((await syncing).json).toEqual({ outcome: "ok" })
    expect(Date.now() - started).toBeGreaterThanOrEqual(500)
    expect(teamOf(w.home)).toEqual(newer.trust)

    // A deploy signed against that team list: it holds D and waits for S at K3, Docker not called meanwhile.
    writeFileSync(stateLockOf(w.home), LIVE)
    started = Date.now()
    const deploying = deployV2(
      w,
      await nextDeploy({ ...w, ...newer } as World, 1)
    )
    await Bun.sleep(500)
    expect(existsSync(lockOf(w.home))).toBe(true)
    expect(stateOf(w.home).lastSequence).toEqual({ web: 1 })
    expect(w.docker.calls()).toHaveLength(1)
    rmSync(stateLockOf(w.home))
    expect((await deploying).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(500)
    expect(stateOf(w.home).lastSequence).toEqual({ web: 2 })
    expect(teamOf(w.home)).toEqual(newer.trust)
  })

  test("a sync that finds the state lock held past its wait, passed in short, answers busy and changes nothing", async () => {
    const w = await world()
    writeFileSync(stateLockOf(w.home), LIVE)
    const before = leftAsItWas(w)
    const newer = await newerTeam(w)
    const started = Date.now()
    expect(
      await sync(w.home, JSON.stringify({ rosters: newer.rosters }), {
        waitMs: 300,
      })
    ).toEqual(BUSY)
    const waited = Date.now() - started
    expect(waited).toBeGreaterThanOrEqual(300)
    expect(waited).toBeLessThan(3000)
    expect(leftAsItWas(w)).toEqual(before)
    expect(readFileSync(stateLockOf(w.home), "utf8")).toBe(LIVE)
    rmSync(stateLockOf(w.home))
    // Free again, the same sync lands.
    expect(
      await sync(w.home, JSON.stringify({ rosters: newer.rosters }), {
        waitMs: 300,
      })
    ).toEqual({ outcome: "ok" })
    expect(teamOf(w.home)).toEqual(newer.trust)
  })

  test("a sync checks the folder before it makes the state lock in it", async () => {
    const home = tempDir("runner")
    expect(
      await sync(home, JSON.stringify({ rosters: [] }), { waitMs: 0 })
    ).toEqual({ outcome: "refused", reason: "not_set_up" })
    expect(readdirSync(home)).toEqual([])
    expect(await sync(home, "garbage", { waitMs: 0 })).toEqual({
      outcome: "refused",
      reason: "invalid_request",
    })
  })
})

describe("a deploy while the deploy lock is held (RB1, CO10)", () => {
  test("answers busy at once, with the build under way for each phase, and without it when the state has none; nothing changes", async () => {
    const w = await deployed(["web"])
    writeFileSync(lockOf(w.home), LIVE)
    const input = await nextDeploy(w, 1)

    let before = leftAsItWas(w)
    let started = Date.now()
    expect(await deployV2(w, input)).toEqual({ events: [], result: BUSY })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(leftAsItWas(w)).toEqual(before)

    for (const phase of ["building", "stopping", "starting"] as const) {
      setBuilding(w.home, phase, 90)
      before = leftAsItWas(w)
      started = Date.now()
      const { events, result } = await deployV2(w, input)
      expect(Date.now() - started).toBeLessThan(5000)
      expect(events).toEqual([])
      expect(result).toEqual({
        ...BUSY,
        building: {
          app: "web",
          seconds: expect.any(Number),
          limit: 1800,
          phase,
        },
      })
      // Seconds from `since`: 90 when it was written, a few more by the answer.
      const { seconds } = result.building as { seconds: number }
      expect(seconds).toBeGreaterThanOrEqual(90)
      expect(seconds).toBeLessThan(100)
      expect(Number.isInteger(seconds)).toBe(true)
      expect(parseMessage(RunnerReportSchema, result).ok).toBe(true)
      expect(leftAsItWas(w)).toEqual(before)
    }
    // The lock was never touched.
    expect(readFileSync(lockOf(w.home), "utf8")).toBe(LIVE)
  })

  test("a `since` ahead of the runner's clock gives 0 seconds; a state that does not read gives busy alone", async () => {
    const w = await deployed(["web"])
    writeFileSync(lockOf(w.home), LIVE)
    const input = await nextDeploy(w, 1)
    setBuilding(w.home, "building", -60)
    expect((await deployV2(w, input)).result).toEqual({
      ...BUSY,
      building: { app: "web", seconds: 0, limit: 1800, phase: "building" },
    })
    writeFileSync(stateFile(w.home), "{", { mode: 0o600 })
    expect((await deployV2(w, input)).result).toEqual(BUSY)
  })

  test("a version-1 apply, a proxy request and a setup while the deploy lock is held are busy, never with the build", async () => {
    const w = await deployed(["web"])
    setBuilding(w.home, "building", 30)
    writeFileSync(lockOf(w.home), LIVE)
    const v1 = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    expect(
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy: v1,
        })
      ).json
    ).toEqual(BUSY)
    expect(await ask(w, "proxy")).toEqual(BUSY)
    expect(w.docker.calls()).toHaveLength(1)
  })
})

describe("setup takes the deploy lock, then the state lock", () => {
  test("either held by a live process: busy, and no key or state is made", async () => {
    const signer = createSigner(generateMemberKeyPair().secretKey)
    const team = await createTeam({ founderName: "Ada", signer })
    const docker = fakeDocker()
    for (const name of ["lock", "state.lock"]) {
      const home = tempDir("runner")
      writeFileSync(join(home, name), LIVE)
      const result = await runner(home, docker.path, "setup", {
        founding: team.envelope,
        teamCode: team.confirmationCode,
      })
      expect(result.json).toEqual(BUSY)
      expect(readdirSync(home)).toEqual([name])
    }
    // Free, it sets the server up and leaves neither lock.
    const home = tempDir("runner")
    const result = await runner(home, docker.path, "setup", {
      founding: team.envelope,
      teamCode: team.confirmationCode,
    })
    expect(result.json).toHaveProperty("serverId")
    expect(readdirSync(home)).not.toContain("lock")
    expect(readdirSync(home)).not.toContain("state.lock")
  })
})

describe("locks whose holder is gone are taken over", () => {
  test("a stale deploy lock and a stale state lock: a deploy and a sync take them over, and leave neither", async () => {
    const w = await deployed(["web"])
    writeFileSync(lockOf(w.home), `${GONE}:old`)
    writeFileSync(stateLockOf(w.home), `${GONE}:old`)
    expect((await deployV2(w, await nextDeploy(w, 1))).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(readdirSync(w.home)).not.toContain("lock")
    expect(readdirSync(w.home)).not.toContain("state.lock")

    writeFileSync(stateLockOf(w.home), String(GONE))
    const newer = await newerTeam(w)
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters: newer.rosters }))
        .json
    ).toEqual({ outcome: "ok" })
    expect(teamOf(w.home)).toEqual(newer.trust)
    expect(readdirSync(w.home)).not.toContain("state.lock")
  })
})

describe("apply (version 1) holds both locks for its whole span", () => {
  test("it answers exactly as before, and a sync sent during its `up` waits for it, then lands", async () => {
    const w = await world()
    olderState(w.home, { web: 1 })
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    w.docker.holdUp()
    const applying = runner(w.home, w.docker.path, "apply", {
      rosters: w.rosters,
      deploy,
    })
    await waitFor(w.docker.upStarted, "docker compose up to start")
    expect(existsSync(lockOf(w.home))).toBe(true)
    expect(existsSync(stateLockOf(w.home))).toBe(true)

    const newer = await newerTeam(w)
    const syncing = runner(w.home, w.docker.path, "sync", {
      rosters: newer.rosters,
    })
    await Bun.sleep(500)
    expect(teamOf(w.home)).toEqual(w.trust)

    w.docker.releaseUp()
    const applied = await applying
    expect(applied.code).toBe(0)
    expect(applied.stdout).toBe(
      `${JSON.stringify({ outcome: "started", app: "web", sequence: 2 })}\n`
    )
    expect((await syncing).json).toEqual({ outcome: "ok" })
    expect(steps(w)).toEqual([up()])
    expect(stateOf(w.home)).toMatchObject({
      lastSequence: { web: 2 },
      formats: { web: 1 },
      team: newer.trust,
    })
    expect(readdirSync(w.home)).not.toContain("lock")
    expect(readdirSync(w.home)).not.toContain("state.lock")
  })
})

describe("proxy takes the deploy lock, and the state lock around its state write", () => {
  test("its write of the released domains waits for the state lock, and reads the state again", async () => {
    const w = await releasedAlone()
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    writeFileSync(stateLockOf(w.home), LIVE)
    const s = session(w.home, w.docker.path)
    s.send({ command: "proxy" })
    // The certificate is deleted under D alone; then the write waits for S.
    await waitFor(
      () => deletions(steps(w)).length === 2,
      "the certificate's deletion"
    )
    await Bun.sleep(500)
    expect(stateOf(w.home).released).toEqual(["app.example.com"])
    // The holder of S saves a newer team list, then releases S: the write reads the state again and keeps it.
    const newer = await newerTeam(w)
    const state = stateOf(w.home)
    writeFileSync(
      stateFile(w.home),
      JSON.stringify({ ...state, team: newer.trust }),
      { mode: 0o600 }
    )
    rmSync(stateLockOf(w.home))
    expect(await resultOf(s)).toEqual({ proxy: "none" })
    expect((await s.close()).code).toBe(0)
    expect(stateOf(w.home).released).toEqual([])
    expect(teamOf(w.home)).toEqual(newer.trust)
  })
})
