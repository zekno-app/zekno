/**
 * The runner on core's protocol 6 and state mark 5, with no build in use
 * (specs/016-build-from-source, T061; contracts/core.md CO13, CO17;
 * contracts/runner.md RB18 last bullet; FR-085): a state of each earlier mark
 * is read forward and written back as 5 with no builds and no build under
 * way, its apps, routes and domains unchanged; a state of a later mark is
 * refused by every request; and a deploy of either version with no build
 * answers, and calls Docker, exactly as before. Runner 0.1.1 itself, taken
 * from this clone's history, is the measure of "before"; those cases are
 * skipped, with the reason printed once, in a clone without it.
 */
import { describe, expect, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  proposeRoster,
  RUNNER_PROTOCOL,
} from "@workspace/core"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildDeployV2, leftAsItWas, olderState } from "../support/deploy-v2"
import {
  buildDeploy,
  deployed,
  fakeDocker,
  RUNNER_MAIN,
  runner,
  session,
  tempDir,
  world,
  type DockerCall,
} from "../support/helpers"
import { olderRunner, olderTree } from "../support/older-programs"
import { releasedButKept, twoApps } from "../support/released"
import { ask, route, steps, up, type World } from "../support/routes"

/** Runner 0.1.1, the release before this feature: protocol 5, state mark 4. */
const RUNNER_0_1_1 = "runner-v0.1.1"
const released = olderTree(RUNNER_0_1_1)

const API = route("api.example.com", "api", 8080)
const INVALID = { outcome: "refused", reason: "invalid_state" }

const stateFile = (home: string) => join(home, "state.json")
const fileOf = (home: string) => readFileSync(stateFile(home), "utf8")
const parsed = (home: string) =>
  JSON.parse(fileOf(home)) as Record<string, unknown>

/** Writes `state` as the runner's state file, mode 600. */
const writeStateFile = (home: string, state: object) =>
  writeFileSync(stateFile(home), JSON.stringify(state), { mode: 0o600 })

/** The state on disk without the parts the marks below 5 do not have, with the mark `v`. */
function asMark(
  home: string,
  v: 2 | 3 | 4,
  dropped: readonly string[]
): Record<string, unknown> {
  const state = parsed(home)
  for (const part of ["builds", "building", ...dropped]) delete state[part]
  return { ...state, v }
}

/** Takes a newer team list with a one-shot `sync`: a write that changes the team alone. */
async function syncNewer(w: World): Promise<unknown> {
  const newer = await proposeRoster({ trust: w.trust, signer: w.signer })
  const rosters = [...w.rosters, newer.envelope]
  expect(
    (await runner(w.home, w.docker.path, "sync", { rosters })).json
  ).toEqual({ outcome: "ok" })
  return newer.trust
}

/**
 * Reads the older state with `status` and `status` with routes, which write
 * nothing; then saves it with a `sync`. The file is then marked 5 with no
 * builds and no build under way, every other part as `expected` says, the
 * team the newer one. The routes in force answer the same before and after.
 */
async function readForward(
  w: World,
  older: Record<string, unknown>,
  expected: Record<string, unknown>
) {
  writeStateFile(w.home, older)
  const bytes = fileOf(w.home)
  const routes = await ask(w, "status", { routes: true })
  expect(routes).not.toHaveProperty("outcome")
  expect((await runner(w.home, w.docker.path, "status")).json).toMatchObject({
    serverId: w.serverId,
    lastSequence: older.lastSequence as object,
  })
  expect(fileOf(w.home)).toBe(bytes)

  const team = await syncNewer(w)
  expect(parsed(w.home)).toEqual({
    ...expected,
    team,
    v: 5,
    builds: {},
    building: null,
  })
  const after = await ask(w, "status", { routes: true })
  expect({ ...after, team: undefined }).toEqual({
    ...routes,
    team: undefined,
  })
}

describe("a state of an earlier mark is read forward and written back as 5 (CO13, CO17)", () => {
  test("marked 4, as runner 0.1.1 writes it: its apps, routes and released domains unchanged", async () => {
    const w = await releasedButKept()
    const older = asMark(w.home, 4, [])
    expect(older.released).toEqual(["app.example.com"])
    expect(Object.keys(older.routes as object)).toEqual(["api"])
    const { v: _v, ...rest } = older
    await readForward(w, older, rest)
  })

  test("marked 3, as runner 0.1.1-dev.1 writes it: its apps and routes unchanged, no released domain", async () => {
    const w = await twoApps()
    const older = asMark(w.home, 3, ["released"])
    expect(Object.keys(older.routes as object)).toEqual(["api", "web"])
    const { v: _v, ...rest } = older
    await readForward(w, older, { ...rest, released: [] })
  })

  test("marked 2, as a runner of feature 014 writes it: its apps unchanged, no routes and no released domain", async () => {
    const w = await deployed(["web", "api"])
    const older = asMark(w.home, 2, ["routes", "released"])
    expect(older.formats).toEqual({ web: 2, api: 2 })
    const { v: _v, ...rest } = older
    await readForward(w, older, { ...rest, routes: {}, released: [] })
  })

  test("with no mark, as runner 0.1.0 writes it: each app at the format its number gives", async () => {
    const w = await world()
    olderState(w.home, { web: 2, api: 0 })
    const older = parsed(w.home)
    expect(older).not.toHaveProperty("v")
    await readForward(w, older, {
      ...older,
      formats: { web: 1, api: 2 },
      routes: {},
      released: [],
    })
  })
})

describe("a state of a later mark (FR-085)", () => {
  test("marked 6 is invalid_state for every request that reads the state: nothing written, Docker not called", async () => {
    const w = await deployed(["web"])
    writeStateFile(w.home, { ...parsed(w.home), v: 6 })
    const before = leftAsItWas(w)

    expect((await runner(w.home, w.docker.path, "status")).json).toEqual(
      INVALID
    )
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters: w.rosters })).json
    ).toEqual(INVALID)
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
    ).toEqual(INVALID)

    const v2 = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
    })
    const s = session(w.home, w.docker.path)
    for (const request of [
      { command: "status" },
      { command: "status", input: { routes: true } },
      { command: "sync", input: { rosters: w.rosters } },
      { command: "apply", input: { rosters: w.rosters, deploy: v1 } },
      { command: "deploy", input: { rosters: w.rosters, ...v2 } },
      { command: "records", input: { app: "web" } },
      { command: "proxy" },
      { command: "state" },
      { command: "logs", input: { app: "web", tail: 10 } },
    ])
      expect(await s.request(request)).toEqual({ events: [], result: INVALID })
    // `version` reads no state; `setup` finds the server set up.
    expect((await s.request({ command: "version" })).result).toMatchObject({
      protocol: RUNNER_PROTOCOL,
    })
    expect(
      (
        await s.request({
          command: "setup",
          input: {
            founding: w.team.envelope,
            teamCode: w.team.confirmationCode,
          },
        })
      ).result
    ).toEqual({ outcome: "refused", reason: "already_set_up" })
    expect((await s.close()).code).toBe(0)
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("protocol 6 is what the runner says it speaks", async () => {
    expect(RUNNER_PROTOCOL).toBe(6)
    const w = await world()
    const version = await runner(w.home, w.docker.path, "version")
    expect(version.json).toMatchObject({ protocol: 6 })
  })
})

/** How a runner is started with the stand-in Docker at `docker`: this one, or an older one taken from git. */
type Start = (docker: string) => string[]
const THIS_RUNNER: Start = () => [process.execPath, RUNNER_MAIN]

/** Runs one command of the runner `start` as its own process, the way SSH would. */
async function once(
  start: Start,
  home: string,
  docker: string,
  command: string,
  message?: unknown
): Promise<Record<string, unknown>> {
  const child = Bun.spawn([...start(docker), command], {
    env: { ...process.env, ZEKNO_RUNNER_HOME: home, ZEKNO_DOCKER: docker },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (message !== undefined) child.stdin.write(JSON.stringify(message))
  child.stdin.end()
  const stdout = await new Response(child.stdout).text()
  await child.exited
  return JSON.parse(stdout) as Record<string, unknown>
}

/** A team and a server set up and synced by the runner `start`, through its own one-shot commands. */
async function worldBy(start: Start) {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const home = tempDir("runner")
  const docker = fakeDocker()
  const setup = await once(start, home, docker.path, "setup", {
    founding: team.envelope,
    teamCode: team.confirmationCode,
  })
  const added = await proposeRoster({
    trust: team.trust,
    servers: [{ name: "prod-1", publicKey: setup.serverPublicKey as never }],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  expect(await once(start, home, docker.path, "sync", { rosters })).toEqual({
    outcome: "ok",
  })
  return {
    signer,
    team,
    trust: added.trust,
    rosters,
    home,
    docker,
    serverId: String(setup.serverId),
  }
}

/** A Docker call with what changes from one folder to another named: the runner's folder and its real path. */
function callOf(w: { home: string }, call: DockerCall) {
  const named = (text: string) =>
    text.split(realpathSync(w.home)).join("<home>").split(w.home).join("<home>")
  return {
    args: named(call.args),
    cwd: named(call.cwd),
    env: Object.fromEntries(
      Object.entries(call.env).map(([name, value]) => [name, named(value)])
    ),
  }
}

/**
 * On a server set up by the runner `start`, that held `web` at 1 before
 * version 2: a version-1 deploy of `web`, a version-2 deploy of `web` with no
 * build, and a version-2 deploy of `api` with a route and no build. Gives
 * each answer, the Docker calls in order (`steps`), each call with its folder
 * and environment, and the state as it was left.
 */
async function noBuildDeploys(start: Start) {
  const w = await worldBy(start)
  olderState(w.home, { web: 1 })
  w.docker.app("web", { web: 1 })
  w.docker.app("api", { api: 1 })
  const v1 = await buildDeploy({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    sequence: 2,
  })
  const answers: unknown[] = [
    await once(start, w.home, w.docker.path, "apply", {
      rosters: w.rosters,
      deploy: v1,
    }),
  ]
  for (const [app, previous, routes] of [
    ["web", 2, []],
    ["api", 0, [API]],
  ] as const) {
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous,
      app,
      routes: [...routes],
    })
    const s = session(w.home, w.docker.path, {}, start(w.docker.path))
    answers.push(
      (
        await s.request({
          command: "deploy",
          input: { rosters: w.rosters, ...built },
        })
      ).result
    )
    await s.close()
  }
  return {
    w,
    answers,
    steps: steps(w as unknown as World),
    calls: w.docker.calls().map((call) => callOf(w, call)),
    state: parsed(w.home),
  }
}

/** The parts of a state two servers can share: everything but the server, its team and the mark's own parts. */
const shared = (state: Record<string, unknown>) => ({
  lastSequence: state.lastSequence,
  formats: state.formats,
  released: state.released,
  routes: Object.fromEntries(
    Object.entries(state.routes as Record<string, { routes: unknown }>).map(
      ([app, entry]) => [app, entry.routes]
    )
  ),
  secrets: Object.keys(state.secrets as object).sort(),
})

describe("a deploy with no build answers exactly as before", () => {
  test("a version-1 deploy and a version-2 deploy, with and without a route: today's answers, today's Docker calls, and the state marked 5", async () => {
    const today = await noBuildDeploys(THIS_RUNNER)
    expect(today.answers).toEqual([
      { outcome: "started", app: "web", sequence: 2 },
      { outcome: "started", app: "web", sequence: 3 },
      { outcome: "started", app: "api", sequence: 1 },
    ])
    // A deploy that builds nothing makes exactly the calls of feature 015: `up` as it was, no build.
    expect(today.steps.slice(0, 2)).toEqual([up("web"), up("web")])
    expect(today.steps[2]).toBe(up("api"))
    for (const step of today.steps) {
      // `up` never builds from Compose text, for every app (RB13, T088); no other call changed.
      expect(step.includes("--no-build")).toBe(step.includes(" up -d "))
      expect(step).not.toContain("buildx")
      expect(step).not.toContain("zekno.invalid")
    }
    expect(today.state).toMatchObject({
      v: 5,
      lastSequence: { web: 3, api: 1 },
      formats: { web: 2, api: 2 },
      builds: {},
      building: null,
    })
  })

  test.skipIf(released === undefined)(
    "the same deploys on a server runner 0.1.1 set up answer the same and make the same Docker calls",
    async () => {
      const before = await noBuildDeploys((docker) =>
        olderRunner(released!, docker)
      )
      const today = await noBuildDeploys(THIS_RUNNER)
      expect(today.answers).toEqual(before.answers)
      // Every call, in order, with what changes from one server to another named (`steps`):
      // runner 0.1.1's, but `up` with `--no-build` (RB13, T088).
      expect(today.steps).toEqual(
        before.steps.map((step) =>
          step.endsWith(" up -d --remove-orphans") ? `${step} --no-build` : step
        )
      )
      // `up` runs in the runner's folder with the same environment: the app's secrets and nothing new.
      const upCalls = (run: typeof today) =>
        run.calls.filter((call) => call.args.includes(" up -d "))
      expect(
        upCalls(today).map((call) => ({ cwd: call.cwd, env: call.env }))
      ).toEqual(
        upCalls(before).map((call) => ({ cwd: call.cwd, env: call.env }))
      )
      expect(before.state.v).toBe(4)
      expect(today.state.v).toBe(5)
      expect(shared(today.state)).toEqual(shared(before.state))
    },
    60_000
  )

  test.skipIf(released === undefined)(
    "runner 0.1.1's folder is read forward by this runner, and runner 0.1.1 put back after mark 5 refuses everything (RB18)",
    async () => {
      const older: Start = (docker) => olderRunner(released!, docker)
      const before = await noBuildDeploys(older)
      const { w } = before
      const written = fileOf(w.home)
      // This runner reads what 0.1.1 wrote, and reading writes nothing.
      expect(
        await once(THIS_RUNNER, w.home, w.docker.path, "status")
      ).toMatchObject({
        serverId: w.serverId,
        lastSequence: { web: 3, api: 1 },
      })
      expect(fileOf(w.home)).toBe(written)
      // Its first write marks the state 5, the apps, routes and domains as they were.
      const team = await syncNewer(w as unknown as World)
      const after = parsed(w.home)
      expect(after).toEqual({
        ...before.state,
        team,
        v: 5,
        builds: {},
        building: null,
      })
      // Runner 0.1.1 put back: invalid_state for every request, nothing written, nothing started.
      const bytes = fileOf(w.home)
      const calls = w.docker.calls().length
      expect(await once(older, w.home, w.docker.path, "status")).toEqual(
        INVALID
      )
      expect(
        await once(older, w.home, w.docker.path, "sync", { rosters: w.rosters })
      ).toEqual(INVALID)
      const s = session(w.home, w.docker.path, {}, older(w.docker.path))
      for (const request of [
        { command: "status", input: { routes: true } },
        { command: "records", input: { app: "web" } },
        { command: "proxy" },
        { command: "state" },
        { command: "logs", input: { app: "web", tail: 10 } },
      ])
        expect((await s.request(request)).result).toEqual(INVALID)
      expect((await s.close()).code).toBe(0)
      expect(fileOf(w.home)).toBe(bytes)
      expect(w.docker.calls()).toHaveLength(calls)
    },
    60_000
  )
})
