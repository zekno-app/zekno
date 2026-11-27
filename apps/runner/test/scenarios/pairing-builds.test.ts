/**
 * Runner 0.1.1 beside this runner (specs/016-build-from-source, T101;
 * contracts/runner.md RB18; core.md CO18; FR-083, FR-085), against the real
 * runner programs and the stand-in for Docker. Runner 0.1.1 is taken from
 * this clone's history, as the pairing tests of pairing.test.ts take theirs;
 * every case that runs it is skipped, with the reason printed once, in a
 * clone without that tag. What runner 0.1.1 does with a signed Compose text
 * that builds is shown on Linux by check L1 (job `released`), not here.
 */
import { describe, expect, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  proposeRoster,
  RUNNER_PROTOCOL,
} from "@workspace/core"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  leftAsItWas,
  type BuildRecipeInput,
} from "../support/deploy-v2"
import {
  buildDeploy,
  fakeDocker,
  RUNNER_MAIN,
  session,
  tempDir,
} from "../support/helpers"
import { olderRunner, olderTree, RELEASED } from "../support/older-programs"
import { packRequest, sealedPack, stagedIn } from "../support/pack-staging"
import { API, APP } from "../support/released"
import { configRoutes, stateOf } from "../support/routes"

const released = olderTree(RELEASED)

/** How a runner is started with the stand-in Docker at `docker`: this one, or runner 0.1.1 taken from git. */
type Start = (docker: string) => string[]
const THIS_RUNNER: Start = () => [process.execPath, RUNNER_MAIN]
const OLDER: Start = (docker) => olderRunner(released!, docker)

const INVALID = { outcome: "refused", reason: "invalid_state" }
const UNREAD = { outcome: "refused", reason: "invalid_request" }
const OLDER_VERSION = { version: "0.1.1", protocol: 5 }

/** The runner's folder and the stand-in Docker. */
type Place = { home: string; docker: ReturnType<typeof fakeDocker> }
/** A server set up and synced by one runner, and the pieces to sign deploys for it. */
type Server = Awaited<ReturnType<typeof serverBy>>

const fileOf = (home: string) => readFileSync(join(home, "state.json"), "utf8")

/** Runs one command of the runner `start` as its own process, the way SSH would. */
async function once(
  start: Start,
  w: Place,
  command: string,
  message?: unknown
): Promise<Record<string, unknown>> {
  const child = Bun.spawn([...start(w.docker.path), command], {
    env: {
      ...process.env,
      ZEKNO_RUNNER_HOME: w.home,
      ZEKNO_DOCKER: w.docker.path,
    },
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

/** Sends one request to the runner `start` on a session of its own, and gives its events and its result. */
async function askBy(start: Start, w: Place, request: object) {
  const s = session(w.home, w.docker.path, {}, start(w.docker.path))
  const answer = await s.request(request)
  expect((await s.close()).code).toBe(0)
  return answer
}

/** A team and a server set up and synced by the runner `start`, as a zekno drives it. */
async function serverBy(start: Start) {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const place = { home: tempDir("runner"), docker: fakeDocker() }
  const setup = await once(start, place, "setup", {
    founding: team.envelope,
    teamCode: team.confirmationCode,
  })
  const added = await proposeRoster({
    trust: team.trust,
    servers: [{ name: "prod-1", publicKey: setup.serverPublicKey as never }],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  expect(await once(start, place, "sync", { rosters })).toEqual({
    outcome: "ok",
  })
  return {
    ...place,
    signer,
    team,
    trust: added.trust,
    rosters,
    serverId: String(setup.serverId),
    serverKey: String(setup.serverPublicKey),
  }
}

/** A version-2 deploy against `previous`, `change` for anything else `buildDeployV2` takes. */
const signed = (
  w: Server,
  previous: number,
  change: Partial<Parameters<typeof buildDeployV2>[0]> = {}
) =>
  buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
    ...change,
  })

/** Signs a version-2 deploy and sends it to the runner `start` on a session of its own. */
async function deployBy(
  start: Start,
  w: Server,
  previous: number,
  change: Partial<Parameters<typeof buildDeployV2>[0]> = {}
) {
  const built = await signed(w, previous, change)
  return askBy(start, w, {
    command: "deploy",
    input: { rosters: w.rosters, ...built },
  })
}

/** A Dockerfile build of one small pack sealed for the server, as a zekno of this feature signs it, and its pieces. */
function dockerfileBuild(w: Server) {
  const { pack, pieces } = sealedPack(w.serverKey, "FROM busybox\n")
  const recipe: BuildRecipeInput = {
    pack,
    builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
    args: [],
    secrets: [],
    network: "default",
    timeout: 600,
    fresh: null,
  }
  return { recipe, pieces }
}

/** A server runner 0.1.1 set up, holding `web` at 1 from a deploy of images. */
async function heldByOlder(): Promise<Server> {
  const w = await serverBy(OLDER)
  expect(await once(OLDER, w, "version")).toEqual(OLDER_VERSION)
  w.docker.app("web", { web: 1 })
  expect((await deployBy(OLDER, w, 0)).result).toEqual({
    outcome: "started",
    app: "web",
    sequence: 1,
  })
  return w
}

describe("runner 0.1.1 handed what only this feature sends (RB18, CO18)", () => {
  test.skipIf(released === undefined)(
    "a signed build is malformed: nothing written, Docker not called, and the next deploy takes the number",
    async () => {
      const w = await heldByOlder()
      const before = leftAsItWas(w)
      const { recipe } = dockerfileBuild(w)
      expect(await deployBy(OLDER, w, 1, { builds: [recipe] })).toEqual({
        events: [],
        result: { outcome: "refused", reason: "malformed" },
      })
      expect(leftAsItWas(w)).toEqual(before)
      // No number was used: a deploy of images against 1 is number 2.
      expect((await deployBy(OLDER, w, 1)).result).toEqual({
        outcome: "started",
        app: "web",
        sequence: 2,
      })
      expect(stateOf(w.home)).toMatchObject({ v: 4, lastSequence: { web: 2 } })
    },
    60_000
  )

  test.skipIf(released === undefined)(
    "pack, builds and builder are each invalid_request: nothing staged or written, Docker not called",
    async () => {
      const w = await heldByOlder()
      const { recipe, pieces } = dockerfileBuild(w)
      const { envelope } = await signed(w, 1, { builds: [recipe] })
      const before = leftAsItWas(w)
      const s = session(w.home, w.docker.path, {}, OLDER(w.docker.path))
      for (const request of [
        packRequest(envelope, pieces[0]!.sealed),
        { command: "builds" },
        { command: "builds", input: { apps: ["web"] } },
        { command: "builder" },
        { command: "builder", input: { usage: true } },
      ]) {
        expect(await s.request(request)).toEqual({ events: [], result: UNREAD })
        // Runner 0.1.1 ends a session after three lines in a row it cannot read; a request it reads comes between.
        expect((await s.request({ command: "version" })).result).toEqual(
          OLDER_VERSION
        )
      }
      expect((await s.close()).code).toBe(0)
      expect(leftAsItWas(w)).toEqual(before)
      expect(existsSync(join(w.home, "packs"))).toBe(false)
    },
    60_000
  )
})

describe("runner 0.1.1 put back on a folder this runner wrote as mark 5 (RB18, CO18, FR-085)", () => {
  test.skipIf(released === undefined)(
    "invalid_state for every request that reads the state; setup finds the server set up; nothing written, Docker not called",
    async () => {
      const w = await serverBy(THIS_RUNNER)
      w.docker.app("web", { web: 1 })
      expect(
        (await deployBy(THIS_RUNNER, w, 0, { routes: [APP] })).result
      ).toEqual({ outcome: "started", app: "web", sequence: 1 })
      expect(stateOf(w.home)).toMatchObject({
        v: 5,
        builds: {},
        building: null,
      })
      const before = leftAsItWas(w)

      const v1 = await buildDeploy({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        sequence: 2,
      })
      const setupAgain = {
        founding: w.team.envelope,
        teamCode: w.team.confirmationCode,
      }
      // The one-shot commands.
      expect(await once(OLDER, w, "status")).toEqual(INVALID)
      expect(await once(OLDER, w, "sync", { rosters: w.rosters })).toEqual(
        INVALID
      )
      expect(
        await once(OLDER, w, "apply", { rosters: w.rosters, deploy: v1 })
      ).toEqual(INVALID)
      expect(await once(OLDER, w, "setup", setupAgain)).toEqual({
        outcome: "refused",
        reason: "already_set_up",
      })
      expect(await once(OLDER, w, "version")).toEqual(OLDER_VERSION)

      // Every request of a session.
      const next = await signed(w, 1, { routes: [APP] })
      const building = await signed(w, 1, {
        builds: [dockerfileBuild(w).recipe],
      })
      const s = session(w.home, w.docker.path, {}, OLDER(w.docker.path))
      for (const request of [
        { command: "status" },
        { command: "status", input: { routes: true } },
        { command: "sync", input: { rosters: w.rosters } },
        { command: "apply", input: { rosters: w.rosters, deploy: v1 } },
        { command: "deploy", input: { rosters: w.rosters, ...next } },
        // A deploy that builds too: the state is read before the payload is (K2 before K4).
        { command: "deploy", input: { rosters: w.rosters, ...building } },
        { command: "records", input: { app: "web" } },
        { command: "proxy" },
        { command: "state" },
        { command: "logs", input: { app: "web", tail: 10 } },
      ])
        expect(await s.request(request)).toEqual({
          events: [],
          result: INVALID,
        })
      expect((await s.request({ command: "version" })).result).toEqual(
        OLDER_VERSION
      )
      expect(
        (await s.request({ command: "setup", input: setupAgain })).result
      ).toEqual({ outcome: "refused", reason: "already_set_up" })
      // The commands it never had are not requests to it, whatever the state.
      for (const command of ["pack", "builds", "builder"]) {
        expect((await s.request({ command })).result).toEqual(UNREAD)
        expect((await s.request({ command: "version" })).result).toEqual(
          OLDER_VERSION
        )
      }
      expect((await s.close()).code).toBe(0)
      expect(leftAsItWas(w)).toEqual(before)
    },
    60_000
  )
})

describe("this runner on a folder runner 0.1.1 left (RB18, CO18, FR-085)", () => {
  test.skipIf(released === undefined)(
    "mark 4 with two apps, their routes and a released domain is read forward; the apps, routes and domain keep working",
    async () => {
      // Runner 0.1.1: web holds app.example.com, api holds api.example.com; web gives its domain up while the deletion fails.
      const w = await serverBy(OLDER)
      w.docker.app("web", { web: 1 })
      w.docker.app("api", { api: 1 })
      for (const [app, routes] of [
        ["web", [APP]],
        ["api", [API]],
      ] as const)
        expect(
          (await deployBy(OLDER, w, 0, { app, routes: [...routes] })).result
        ).toEqual({ outcome: "started", app, sequence: 1 })
      w.docker.script({ deletionFails: 1 })
      expect((await deployBy(OLDER, w, 1, { routes: [] })).result).toEqual({
        outcome: "started",
        app: "web",
        sequence: 2,
      })
      const left = stateOf(w.home)
      expect(left).toMatchObject({
        v: 4,
        lastSequence: { web: 2, api: 1 },
        released: ["app.example.com"],
      })
      expect(Object.keys(left.routes)).toEqual(["api"])
      expect(w.docker.model().certificates).toEqual([
        "api.example.com",
        "app.example.com",
      ])
      const olderRoutes = await askBy(OLDER, w, {
        command: "status",
        input: { routes: true },
      })
      const written = fileOf(w.home)

      // This runner reads it, routes and all, as runner 0.1.1 answers, and reading writes nothing.
      expect(await once(THIS_RUNNER, w, "status")).toMatchObject({
        serverId: w.serverId,
        lastSequence: { web: 2, api: 1 },
      })
      expect(
        await askBy(THIS_RUNNER, w, {
          command: "status",
          input: { routes: true },
        })
      ).toEqual(olderRoutes)
      expect(fileOf(w.home)).toBe(written)

      // Its first write: web's next deploy, which deletes the released domain's certificate and marks the state 5.
      expect((await deployBy(THIS_RUNNER, w, 2)).result).toEqual({
        outcome: "started",
        app: "web",
        sequence: 3,
      })
      expect(stateOf(w.home)).toMatchObject({
        v: 5,
        lastSequence: { web: 3, api: 1 },
        released: [],
        builds: {},
        building: null,
      })
      expect(stateOf(w.home).routes).toEqual(left.routes)
      expect(w.docker.model().certificates).toEqual(["api.example.com"])
      expect(Object.keys(configRoutes(w.home))).toEqual(["api.example.com"])

      // api keeps its route through its next deploy, and web takes a domain again.
      expect(
        (await deployBy(THIS_RUNNER, w, 1, { app: "api", routes: [API] }))
          .result
      ).toEqual({ outcome: "started", app: "api", sequence: 2 })
      expect(
        (await deployBy(THIS_RUNNER, w, 3, { routes: [APP] })).result
      ).toEqual({ outcome: "started", app: "web", sequence: 4 })
      expect(Object.keys(configRoutes(w.home)).sort()).toEqual([
        "api.example.com",
        "app.example.com",
      ])
      expect(
        await askBy(THIS_RUNNER, w, {
          command: "status",
          input: { routes: true },
        })
      ).toMatchObject({
        result: { routes: { api: [API], web: [APP] }, proxy: "running" },
      })
    },
    60_000
  )
})

describe("this runner, of step 1, handed what it does not carry out yet (RB18, CO18, FR-083)", () => {
  test("a Railpack build, or a Dockerfile build with secrets, is unsupported_version at pack and at deploy: no number used, nothing staged, Docker not called", async () => {
    const w = await serverBy(THIS_RUNNER)
    expect(RUNNER_PROTOCOL).toBe(6)
    w.docker.app("web", { web: 1 })
    expect((await deployBy(THIS_RUNNER, w, 0)).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 1,
    })
    const { recipe, pieces } = dockerfileBuild(w)
    const railpack: BuildRecipeInput = {
      ...recipe,
      builder: {
        name: "railpack",
        version: "0.9.2",
        frontend: `ghcr.io/railwayapp/railpack-frontend:0.9.2@sha256:${"c".repeat(64)}`,
        images: [
          `ghcr.io/railwayapp/railpack-builder@sha256:${"d".repeat(64)}`,
        ],
        plan: { hash: "e".repeat(64), size: 1, piece: "f".repeat(64) },
      },
    }
    const withSecrets: BuildRecipeInput = { ...recipe, secrets: ["GREETING"] }
    const unsupported = {
      events: [],
      result: { outcome: "refused", reason: "unsupported_version" },
    }
    for (const build of [railpack, withSecrets]) {
      const built = await signed(w, 1, { builds: [build] })
      const before = leftAsItWas(w)
      const s = session(w.home, w.docker.path)
      // As zekno sends them: the deploy's piece first, then the deploy.
      expect(
        await s.request(packRequest(built.envelope, pieces[0]!.sealed))
      ).toEqual(unsupported)
      expect(
        await s.request({
          command: "deploy",
          input: { rosters: w.rosters, ...built },
        })
      ).toEqual(unsupported)
      expect((await s.close()).code).toBe(0)
      expect(leftAsItWas(w)).toEqual(before)
      expect(stagedIn(w.home, "web")).toEqual([])
    }
    // No number was used: a deploy of images against 1 is number 2.
    expect((await deployBy(THIS_RUNNER, w, 1)).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
  }, 60_000)
})
