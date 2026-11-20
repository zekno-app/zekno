/**
 * The time limit on `docker compose up` (specs/015-domains-https, security
 * review, lead A10; contracts/runner.md): an `up` that never returns is
 * stopped once its limit has passed, with the call saying so, and is never
 * waited for again; an `up` that ends in time ends as it always did. Both
 * ways of running it have the limit: with each line given to the caller (a
 * session), and with Docker's output on standard error (one-shot).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { composeUp, START_LIMIT_MS } from "../../src/docker/compose"
import {
  fakeDocker,
  isAlive,
  tempDir,
  waitFor,
  type FakeDocker,
} from "../support/helpers"

/** The limit these tests give `up`: long enough for the stand-in to print its lines first on a busy machine. */
const LIMIT_MS = 2000
/** The limit, the stop, and the second the outputs may take to close, with room to spare. */
const WITHIN_MS = 8000
/** Each test's own limit. */
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

/** The stand-in Docker, used for the calls that follow; what it starts is stopped after the test. */
function setUp(): { docker: FakeDocker; dir: string } {
  const docker = fakeDocker()
  process.env.ZEKNO_DOCKER = docker.path
  leftBehind.push(docker.upPid, docker.upChildPid)
  const dir = tempDir("compose-up")
  return { docker, dir }
}

/** Runs `up` for the app `web` with a short limit, giving each line to `lines` when it is given. */
function up(dir: string, limitMs: number, lines?: string[]) {
  return composeUp(
    {
      dir,
      app: "web",
      file: join(dir, "compose.yaml"),
      secrets: {},
      ...(lines === undefined ? {} : { onLine: (line) => lines.push(line) }),
    },
    limitMs
  )
}

/** What a call gave, and how long it took. */
async function timed<T>(work: Promise<T>): Promise<{ value: T; ms: number }> {
  const began = performance.now()
  const value = await work
  return { value, ms: performance.now() - began }
}

describe("the limit on up (lead A10)", () => {
  test("is 30 minutes", () => {
    expect(START_LIMIT_MS).toBe(30 * 60 * 1000)
  })

  test(
    "an up that ends in time gives Docker's exit status, after every line it printed",
    async () => {
      const { docker, dir } = setUp()
      docker.upPrints({ stderr: " Container zekno-web-web-1  Started\n" })
      docker.holdUp(" Container zekno-web-web-1  Healthy\n")
      const lines: string[] = []
      const answer = up(dir, 10_000, lines)
      await waitFor(docker.upStarted, "up to start")
      await Bun.sleep(200)
      docker.releaseUp()
      expect(await answer).toEqual({ exit: 0 })
      expect(lines).toEqual([
        " Container zekno-web-web-1  Started",
        " Container zekno-web-web-1  Healthy",
      ])

      docker.failWith(1)
      expect(await up(dir, 10_000, [])).toEqual({ exit: 1 })
    },
    TEST_MS
  )

  test(
    "an up that never ends is stopped at its limit, its lines up to then given, none after",
    async () => {
      const { docker, dir } = setUp()
      docker.upPrints({ stderr: " Container zekno-web-db-1  Waiting\n" })
      docker.upNeverEnds()
      const lines: string[] = []
      const { value, ms } = await timed(up(dir, LIMIT_MS, lines))
      expect(value).toEqual({ stoppedAfterMs: LIMIT_MS })
      expect(ms).toBeGreaterThanOrEqual(LIMIT_MS - 50)
      expect(ms).toBeLessThan(WITHIN_MS)
      expect(lines).toEqual([" Container zekno-web-db-1  Waiting"])
      expect(isAlive(docker.upPid()!)).toBe(false)
      expect(docker.upFinished()).toBe(false)
    },
    TEST_MS
  )

  test(
    "an up that prints without pause and never ends is stopped too, and gives no line once the call returned",
    async () => {
      const { docker, dir } = setUp()
      docker.upNeverEnds({ prints: true })
      let count = 0
      let afterwards = 0
      let returned = false
      const answer = composeUp(
        {
          dir,
          app: "web",
          file: join(dir, "compose.yaml"),
          secrets: {},
          onLine: () => {
            count++
            if (returned) afterwards++
          },
        },
        LIMIT_MS
      )
      const { value, ms } = await timed(answer)
      returned = true
      expect(value).toEqual({ stoppedAfterMs: LIMIT_MS })
      expect(ms).toBeLessThan(WITHIN_MS)
      expect(count).toBeGreaterThan(0)
      expect(isAlive(docker.upPid()!)).toBe(false)
      await Bun.sleep(200)
      expect(afterwards).toBe(0)
    },
    TEST_MS
  )

  test(
    "a process Docker left behind that keeps the outputs open holds the call no longer than a short grace",
    async () => {
      const { docker, dir } = setUp()
      docker.upNeverEnds({ leaveChild: true })
      const lines: string[] = []
      const { value, ms } = await timed(up(dir, LIMIT_MS, lines))
      expect(value).toEqual({ stoppedAfterMs: LIMIT_MS })
      expect(ms).toBeLessThan(WITHIN_MS)
      expect(isAlive(docker.upPid()!)).toBe(false)
      // The process Docker left behind is left as Docker left it: nothing else is done to the app.
      expect(isAlive(docker.upChildPid()!)).toBe(true)
    },
    TEST_MS
  )

  test(
    "one-shot, with Docker's output on standard error, has the same limit",
    async () => {
      const { docker, dir } = setUp()
      docker.upNeverEnds()
      const { value, ms } = await timed(up(dir, LIMIT_MS))
      expect(value).toEqual({ stoppedAfterMs: LIMIT_MS })
      expect(ms).toBeLessThan(WITHIN_MS)
      expect(isAlive(docker.upPid()!)).toBe(false)

      docker.upNeverEnds({ leaveChild: true })
      const held = await timed(up(dir, LIMIT_MS))
      expect(held.value).toEqual({ stoppedAfterMs: LIMIT_MS })
      expect(held.ms).toBeLessThan(WITHIN_MS)

      docker.upEndsAgain()
      expect(await up(dir, 10_000)).toEqual({ exit: 0 })
    },
    TEST_MS
  )

  test(
    "a Docker that cannot be started gives 127, as before",
    async () => {
      setUp()
      process.env.ZEKNO_DOCKER = join(tempDir("no-docker"), "docker")
      expect(await up(tempDir("compose-up"), 500, [])).toEqual({ exit: 127 })
      expect(await up(tempDir("compose-up"), 500)).toEqual({ exit: 127 })
    },
    TEST_MS
  )
})
