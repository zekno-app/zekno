/**
 * A start that does not end in time (specs/015-domains-https, security
 * review, lead A10; contracts/runner.md): a `docker compose up` that never
 * returns is stopped at the runner's limit, the deploy answers
 * `start_failed`, the lock is free again and the deploy's number is used.
 * Only a version-2 deploy says that the limit was hit (`startLimit`); a
 * version-1 deploy answers exactly as before. The commands run in this
 * process, as a session runs them, with a limit of two seconds passed in
 * instead of the runner's 30 minutes.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { parseMessage, RunnerReportSchema } from "@workspace/core"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { apply } from "../../src/commands/commands"
import { deploy } from "../../src/commands/deploy"
import { buildDeployV2, deployV2, olderState } from "../support/deploy-v2"
import {
  buildDeploy,
  isAlive,
  runner,
  waitFor,
  world,
} from "../support/helpers"
import { route, stateOf, type World } from "../support/routes"

/**
 * The limit these tests give `up`: long enough for the stand-in to print its
 * lines first on a busy machine, and said as 2 seconds.
 */
const LIMIT_MS = 2000
/** The limit, the stop, and the second the outputs may take to close, with room to spare. */
const WITHIN_MS = 8000
/** Each test's own limit: a runner set up, a deploy stopped at its limit, and another deploy. */
const TEST_MS = 30_000

const saved = process.env.ZEKNO_DOCKER
/** Processes a test's stand-in left behind, stopped after it whatever happened. */
const leftBehind: (() => number | undefined)[] = []
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
  for (const pid of leftBehind.splice(0).map((of) => of()))
    if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL")
})

/** A world whose stand-in Docker the commands run in this process use. */
async function here(): Promise<World> {
  const w = await world()
  process.env.ZEKNO_DOCKER = w.docker.path
  leftBehind.push(w.docker.upPid, w.docker.upChildPid)
  return w
}

/** A version-2 deploy of `web` against `previous`, as a session hands it to the command. */
async function v2Input(
  w: World,
  previous: number,
  routes: ReturnType<typeof route>[] = []
): Promise<string> {
  const built = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
    routes,
  })
  return JSON.stringify({ rosters: w.rosters, ...built })
}

/** A version-1 deploy of `web` numbered `sequence`, as `apply` reads it. */
async function v1Input(w: World, sequence: number): Promise<string> {
  const deployV1 = await buildDeploy({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    sequence,
  })
  return JSON.stringify({ rosters: w.rosters, deploy: deployV1 })
}

/** What a command gave, and how long it took. */
async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const began = performance.now()
  const value = await work
  return { value, ms: performance.now() - began }
}

const lockOf = (w: World) => join(w.home, "lock")

describe("version 2: an up that never returns (lead A10)", () => {
  test(
    "answers start_failed with startLimit; up is stopped, the lock is free, the number used",
    async () => {
      const w = await here()
      w.docker.upPrints({ stderr: " Container zekno-web-db-1  Waiting\n" })
      w.docker.upNeverEnds()
      const lines: string[] = []
      const { value, ms } = await timed(
        deploy(
          w.home,
          await v2Input(w, 0),
          (line) => lines.push(line),
          () => {},
          LIMIT_MS
        )
      )
      expect(value).toEqual({
        outcome: "start_failed",
        app: "web",
        sequence: 1,
        startLimit: 2,
      })
      expect(parseMessage(RunnerReportSchema, value).ok).toBe(true)
      expect(ms).toBeLessThan(WITHIN_MS)
      // What Docker said up to then is sent, as for any start that failed.
      expect(lines).toEqual([" Container zekno-web-db-1  Waiting"])
      expect(isAlive(w.docker.upPid()!)).toBe(false)
      expect(existsSync(lockOf(w))).toBe(false)
      expect(stateOf(w.home).lastSequence).toEqual({ web: 1 })

      // The next deploy, through the runner program, is not `busy`, and comes after the number used.
      w.docker.upEndsAgain()
      expect(
        (
          await deployV2(
            w,
            JSON.parse(await v2Input(w, 1)) as Record<string, unknown>
          )
        ).result
      ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    },
    TEST_MS
  )

  test(
    "with a route: the routes are still carried out as far as they go, and the answer is start_failed with startLimit",
    async () => {
      const w = await here()
      w.docker.app("web", { web: 1 })
      w.docker.upNeverEnds()
      const app = route("app.example.com")
      const value = await deploy(
        w.home,
        await v2Input(w, 0, [app]),
        () => {},
        () => {},
        LIMIT_MS
      )
      expect(value).toEqual({
        outcome: "start_failed",
        app: "web",
        sequence: 1,
        startLimit: 2,
      })
      expect(stateOf(w.home).routes.web!.routes).toEqual([app])
      expect(existsSync(lockOf(w))).toBe(false)
    },
    TEST_MS
  )

  test(
    "an up that prints without pause and never ends is stopped too",
    async () => {
      const w = await here()
      w.docker.upNeverEnds({ prints: true })
      let count = 0
      let afterwards = 0
      let returned = false
      const { value, ms } = await timed(
        deploy(
          w.home,
          await v2Input(w, 0),
          () => {
            count++
            if (returned) afterwards++
          },
          () => {},
          LIMIT_MS
        )
      )
      returned = true
      expect(value).toEqual({
        outcome: "start_failed",
        app: "web",
        sequence: 1,
        startLimit: 2,
      })
      expect(ms).toBeLessThan(WITHIN_MS)
      expect(count).toBeGreaterThan(0)
      expect(isAlive(w.docker.upPid()!)).toBe(false)
      expect(existsSync(lockOf(w))).toBe(false)
      // Nothing is sent for this deploy once it has answered.
      await Bun.sleep(200)
      expect(afterwards).toBe(0)
    },
    TEST_MS
  )

  test(
    "a process Docker left behind that keeps the outputs open does not hold the deploy",
    async () => {
      const w = await here()
      w.docker.upNeverEnds({ leaveChild: true })
      const { value, ms } = await timed(
        deploy(
          w.home,
          await v2Input(w, 0),
          () => {},
          () => {},
          LIMIT_MS
        )
      )
      expect(value).toMatchObject({ outcome: "start_failed", startLimit: 2 })
      expect(ms).toBeLessThan(WITHIN_MS)
      expect(existsSync(lockOf(w))).toBe(false)
    },
    TEST_MS
  )
})

describe("version 1: an up that never returns (lead A10)", () => {
  test(
    "is stopped the same way, and answers start_failed exactly as before, with no startLimit",
    async () => {
      const w = await here()
      olderState(w.home, { web: 1 })
      w.docker.upNeverEnds()

      // In a session: Docker's lines as progress.
      const session = await timed(
        apply(w.home, await v1Input(w, 2), () => {}, LIMIT_MS)
      )
      expect(session.value).toEqual({
        outcome: "start_failed",
        app: "web",
        sequence: 2,
      })
      expect(session.ms).toBeLessThan(WITHIN_MS)
      expect(isAlive(w.docker.upPid()!)).toBe(false)
      expect(existsSync(lockOf(w))).toBe(false)

      // One-shot: Docker's output on standard error.
      const oneShot = await timed(
        apply(w.home, await v1Input(w, 3), undefined, LIMIT_MS)
      )
      expect(oneShot.value).toEqual({
        outcome: "start_failed",
        app: "web",
        sequence: 3,
      })
      expect(oneShot.ms).toBeLessThan(WITHIN_MS)
      expect(isAlive(w.docker.upPid()!)).toBe(false)
      expect(existsSync(lockOf(w))).toBe(false)
      expect(stateOf(w.home).lastSequence).toEqual({ web: 3 })

      // The next deploy, through the runner program, is not `busy`.
      w.docker.upEndsAgain()
      expect(
        (
          await runner(
            w.home,
            w.docker.path,
            "apply",
            JSON.parse(await v1Input(w, 4))
          )
        ).json
      ).toEqual({ outcome: "started", app: "web", sequence: 4 })
    },
    TEST_MS
  )
})

describe("an up that ends in time (lead A10)", () => {
  test(
    "is unchanged: started, or start_failed with no startLimit, after every line",
    async () => {
      const w = await here()
      w.docker.upPrints({ stderr: " Container zekno-web-web-1  Started\n" })
      w.docker.holdUp(" Container zekno-web-web-1  Healthy\n")
      const lines: string[] = []
      const answer = deploy(
        w.home,
        await v2Input(w, 0),
        (line) => lines.push(line),
        () => {},
        5000
      )
      await waitFor(w.docker.upStarted, "up to start")
      await Bun.sleep(200)
      w.docker.releaseUp()
      expect(await answer).toEqual({
        outcome: "started",
        app: "web",
        sequence: 1,
      })
      expect(lines).toEqual([
        " Container zekno-web-web-1  Started",
        " Container zekno-web-web-1  Healthy",
      ])

      w.docker.failWith(1)
      expect(
        await deploy(
          w.home,
          await v2Input(w, 1),
          () => {},
          () => {},
          5000
        )
      ).toEqual({ outcome: "start_failed", app: "web", sequence: 2 })
    },
    TEST_MS
  )
})
