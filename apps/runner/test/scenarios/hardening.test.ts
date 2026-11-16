/**
 * The findings of the review of the runner's session, state and logs
 * (specs/004-cli-app/security-review.md, S1 to S8). Each test fails on the
 * runner as it was before its fix. S5 is tested in runner.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  LIMITS,
  parseMessage,
  RunnerAppStatesSchema,
  RunnerStatusSchema,
} from "@workspace/core"
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { appStates } from "../../src/docker/inspect"
import {
  buildDeploy,
  deployed,
  fakeDocker,
  isAlive,
  residentMiB,
  runner,
  RUNNER_MAIN,
  session,
  tempDir,
  waitFor,
  world,
} from "../support/helpers"

/**
 * The most resident memory, in MiB, a runner may reach in these tests. The
 * runner itself needs about 50. Before the fixes, each of these tests took it
 * past this within a few MiB of input.
 */
const MEMORY_BOUND_MIB = 200

const MiB = 1024 * 1024

const LOG_LINES = [
  "web-1     | 2026-11-13T16:56:04.136118801Z started",
  "web-1     | 2026-11-13T16:56:06.500Z GET / 200",
  "",
].join("\n")

type Running = {
  pid: number
  stdin: Bun.FileSink
  exited: Promise<number>
  kill: (signal?: NodeJS.Signals) => void
}

const LATE = "still running"

/** What `promise` gives, or `LATE` after `ms` milliseconds. */
const within = <T>(promise: Promise<T>, ms: number): Promise<T | typeof LATE> =>
  Promise.race([promise, Bun.sleep(ms).then(() => LATE as typeof LATE)])

/**
 * Writes `chunk` to the runner's input up to `times` times, as fast as the
 * runner takes it, and returns the runner's largest resident memory in MiB
 * meanwhile. Stops early once the runner has exited or has stopped taking
 * input, or once its memory is past the bound, so that a runner without the
 * fixes cannot exhaust the machine.
 */
async function flood(
  child: Running,
  chunk: string,
  times: number
): Promise<number> {
  let gone = false
  void child.exited.then(() => (gone = true))
  let peak = residentMiB(child.pid) ?? 0
  let stalled = 0
  for (
    let i = 0;
    i < times && !gone && stalled < 5 && peak < MEMORY_BOUND_MIB;
    i++
  ) {
    try {
      const written = child.stdin.write(chunk)
      if (written instanceof Promise) written.catch(() => {})
      const flushed = child.stdin.flush()
      // A runner that stopped reading leaves this pending; it is not waited for long.
      const taken =
        flushed instanceof Promise
          ? await Promise.race([
              flushed.then(
                () => true,
                () => true
              ),
              Bun.sleep(100).then(() => false),
            ])
          : true
      stalled = taken ? 0 : stalled + 1
    } catch {
      // The runner has gone.
    }
    peak = Math.max(peak, residentMiB(child.pid) ?? 0)
  }
  return peak
}

/** Stops whatever a test left running: the runner and any stand-in Docker process. */
async function cleanUp(
  child: Running,
  pids: (number | undefined)[]
): Promise<void> {
  child.kill("SIGKILL")
  await child.exited
  for (const pid of pids)
    if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL")
}

/** Reads frames until the runner's output ends. */
async function rest(s: ReturnType<typeof session>): Promise<void> {
  while ((await s.next()) !== undefined) {
    // Collected in `s.frames`.
  }
}

describe("a client far ahead of its answers ends its session (S1, S2)", () => {
  test("S1: empty lines sent during logs end the session instead of filling memory", async () => {
    const w = await deployed(["web"])
    w.docker.logs("web", LOG_LINES, { follow: true })
    const s = session(w.home, w.docker.path)
    let logsPid: number | undefined
    try {
      s.send({ command: "logs", input: { app: "web", tail: 10 } })
      expect((await s.next())?.line).toBe("started")
      await waitFor(
        () => w.docker.logsPid() !== undefined,
        "docker compose logs to start"
      )
      logsPid = w.docker.logsPid()!

      // Up to 16 MiB of line feeds: each one an empty line, which used to be held for free.
      const peak = await flood(s.child, "\n".repeat(MiB), 16)
      expect(peak).toBeLessThan(MEMORY_BOUND_MIB)

      // The runner ended the session by itself, although its input is still open.
      expect(await within(s.child.exited, 5000)).toBe(1)
      await rest(s)
      expect(s.frames.at(-1)).toEqual({ result: { outcome: "ok" } })
      expect(isAlive(logsPid)).toBe(false)
    } finally {
      await cleanUp(s.child, [logsPid])
    }
  }, 10_000)

  test("S2: requests sent far ahead are not run once the session has ended, and Docker's log command is stopped", async () => {
    const w = await deployed(["web"])
    w.docker.logs("web", LOG_LINES, { follow: true })
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    const s = session(w.home, w.docker.path)
    let logsPid: number | undefined
    try {
      s.send({ command: "logs", input: { app: "web", tail: 10 } })
      await waitFor(
        () => w.docker.logsPid() !== undefined,
        "docker compose logs to start"
      )
      logsPid = w.docker.logsPid()!

      // A genuine deploy, then more requests than a session holds, without waiting for any answer.
      const ahead = [
        { command: "apply", input: { rosters: w.rosters, deploy } },
        ...Array.from({ length: 1100 }, () => ({ command: "state" })),
      ]
      await flood(
        s.child,
        ahead.map((request) => `${JSON.stringify(request)}\n`).join(""),
        1
      )

      expect(await within(s.child.exited, 5000)).toBe(1)
      expect(isAlive(logsPid)).toBe(false)
      await rest(s)
      // Only the logs request was answered.
      expect(s.frames.filter((frame) => "result" in frame)).toEqual([
        { result: { outcome: "ok" } },
      ])
      // Nothing that waited was run: no deploy started, no state asked for, the deploy's number unused.
      expect(w.docker.calls()).toHaveLength(1)
      expect(w.docker.inspections().map((call) => call.args)).toEqual([
        "compose -p zekno-web logs --follow --timestamps --no-color --tail 10",
      ])
      expect(
        JSON.parse(readFileSync(join(w.home, "state.json"), "utf8"))
          .lastSequence
      ).toEqual({ web: 1 })
    } finally {
      await cleanUp(s.child, [logsPid])
    }
  }, 10_000)
})

describe("result frames wait for the reader (S3)", () => {
  test("a reader that never reads does not make the runner hold its answers in memory", async () => {
    // The runner's output goes into a pipe that this test opens and never reads.
    const fifo = join(tempDir("fifo"), "out")
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0)
    const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK)
    const writeEnd = openSync(fifo, constants.O_WRONLY)
    const child = Bun.spawn([process.execPath, RUNNER_MAIN, "session"], {
      env: {
        ...process.env,
        ZEKNO_RUNNER_HOME: tempDir("runner"),
        ZEKNO_DOCKER: fakeDocker().path,
      },
      stdin: "pipe",
      stdout: writeEnd,
      stderr: "ignore",
    })
    closeSync(writeEnd)
    let readerOpen = true
    try {
      // Two lines that are refused and one request, over and over: each answered, none read.
      const peak = await flood(
        child,
        'x\nx\n{"command":"status"}\n'.repeat(2_500),
        160
      )
      expect(peak).toBeLessThan(MEMORY_BOUND_MIB)

      // Once the reader goes, the runner is not left waiting for it.
      closeSync(readEnd)
      readerOpen = false
      expect(await within(child.exited, 5000)).toBe(1)
    } finally {
      if (readerOpen) closeSync(readEnd)
      await cleanUp(child, [])
    }
  }, 10_000)
})

describe("a request whose input cannot be handled (S6)", () => {
  test("input nested 100,000 levels deep is refused once, and the session goes on", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    const deep = `{"command":"sync","input":${"[".repeat(100_000)}${"]".repeat(100_000)}}`
    expect(await s.request(deep)).toEqual({
      events: [],
      result: { outcome: "refused", reason: "invalid_request" },
    })
    expect(
      parseMessage(
        RunnerStatusSchema,
        (await s.request({ command: "status" })).result
      ).ok
    ).toBe(true)
    expect((await s.close()).code).toBe(0)
  })
})

describe("state does not wait for Docker forever (S7)", () => {
  test("a hung `ps` is stopped when the input closes, and the runner exits", async () => {
    const w = await deployed(["web"])
    w.docker.psHangs()
    const s = session(w.home, w.docker.path)
    let psPid: number | undefined
    try {
      s.send({ command: "state" })
      await waitFor(
        () => w.docker.psPid() !== undefined,
        "docker compose ps to start"
      )
      psPid = w.docker.psPid()!
      expect(await within(s.close(), 5000)).toMatchObject({ code: 0 })
      expect(isAlive(psPid)).toBe(false)
      // The app Docker did not answer for is left out: its state is not known.
      expect(s.frames).toEqual([{ result: { apps: {} } }])
    } finally {
      await cleanUp(s.child, [psPid])
    }
  }, 10_000)

  test("a hung `ps` is stopped when its time is up, and its app left out", async () => {
    const w = await deployed(["web"])
    w.docker.psHangs()
    const saved = process.env.ZEKNO_DOCKER
    process.env.ZEKNO_DOCKER = w.docker.path
    try {
      const started = Date.now()
      // 300 milliseconds here instead of the 30 seconds a runner gives Docker.
      expect(
        await within(appStates(w.home, new AbortController().signal, 300), 5000)
      ).toEqual({ apps: {} })
      expect(Date.now() - started).toBeLessThan(5000)
      expect(isAlive(w.docker.psPid()!)).toBe(false)
    } finally {
      if (saved === undefined) delete process.env.ZEKNO_DOCKER
      else process.env.ZEKNO_DOCKER = saved
      const pid = w.docker.psPid()
      if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL")
    }
  }, 10_000)
})

describe("Docker runs in the runner's own folder (S8)", () => {
  test("`ps` and `logs` start in the runner's private folder, not where the runner was started", async () => {
    const w = await deployed(["web"])
    w.docker.ps("web", "")
    w.docker.logs("web", LOG_LINES)
    const s = session(w.home, w.docker.path)
    expect((await s.request({ command: "state" })).result).toEqual({
      apps: { web: { services: [] } },
    })
    expect(
      (await s.request({ command: "logs", input: { app: "web", tail: 1 } }))
        .result
    ).toEqual({ outcome: "ok" })
    expect((await s.close()).code).toBe(0)

    const calls = w.docker.inspections()
    expect(calls.map((call) => call.args.split(" ")[3])).toEqual(["ps", "logs"])
    expect(realpathSync(process.cwd())).not.toBe(realpathSync(w.home))
    for (const call of calls) expect(call.cwd).toBe(realpathSync(w.home))
  })
})

/**
 * A Docker whose log command prints without pause, as a container that logs
 * in a loop does. Everything else goes to the stand-in Docker. Its log
 * command notes its process id in the returned folder.
 */
function floodingDocker(docker: string): {
  path: string
  logsPid: () => number | undefined
} {
  const dir = tempDir("flooding")
  const path = join(dir, "docker")
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "$4" = logs ]; then echo $$ > "${dir}/logs.pid"; exec yes "web-1  | 2026-11-14T00:00:00Z ${"x".repeat(200)}"; fi\nexec "${docker}" "$@"\n`
  )
  chmodSync(path, 0o755)
  const pidFile = join(dir, "logs.pid")
  return {
    path,
    logsPid: () =>
      existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== ""
        ? Number(readFileSync(pidFile, "utf8"))
        : undefined,
  }
}

describe("a container that prints without pause, and a client that goes away (L6)", () => {
  /** A session following the logs of `web`, its frames read and thrown away as fast as they come. */
  async function following(
    home: string,
    docker: { path: string; logsPid: () => number | undefined }
  ) {
    const child = Bun.spawn([process.execPath, RUNNER_MAIN, "session"], {
      env: {
        ...process.env,
        ZEKNO_RUNNER_HOME: home,
        ZEKNO_DOCKER: docker.path,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    })
    child.stdin.write(
      `${JSON.stringify({ command: "logs", input: { app: "web", tail: 10 } })}\n`
    )
    await child.stdin.flush()
    const reader = child.stdout.getReader()
    let bytes = 0
    void (async () => {
      for (;;) {
        const chunk = await reader
          .read()
          .catch(() => ({ done: true as const, value: undefined }))
        if (chunk.done) return
        bytes += chunk.value.length
      }
    })()
    await waitFor(
      () => docker.logsPid() !== undefined && bytes > 1_000_000,
      "the logs to pour in"
    )
    let peak = 0
    for (let n = 0; n < 5; n++) {
      await Bun.sleep(100)
      peak = Math.max(peak, residentMiB(child.pid) ?? 0)
    }
    return { child, reader, peak, logsPid: docker.logsPid()! }
  }

  test("the client closes its input and stops reading: the runner stops Docker's log command and exits, its memory bounded", async () => {
    const w = await deployed(["web"])
    const run = await following(w.home, floodingDocker(w.docker.path))
    try {
      expect(run.peak).toBeLessThan(MEMORY_BOUND_MIB)
      run.child.stdin.end()
      await run.reader.cancel()
      const gone = Date.now()
      expect(await within(run.child.exited, 3000)).toBe(0)
      await waitFor(
        () => !isAlive(run.logsPid),
        "Docker's log command to stop",
        2000
      )
      expect(Date.now() - gone).toBeLessThan(3000)
    } finally {
      await cleanUp(run.child, [run.logsPid])
    }
  }, 10_000)

  test("the client stops reading but leaves its input open: a write that fails is the client gone, and the runner ends at once", async () => {
    const w = await deployed(["web"])
    const run = await following(w.home, floodingDocker(w.docker.path))
    try {
      await run.reader.cancel()
      const gone = Date.now()
      expect(await within(run.child.exited, 3000)).toBe(0)
      await waitFor(
        () => !isAlive(run.logsPid),
        "Docker's log command to stop",
        2000
      )
      expect(Date.now() - gone).toBeLessThan(3000)
    } finally {
      await cleanUp(run.child, [run.logsPid])
    }
  }, 10_000)
})

describe("what a runner holds always fits the answers that report it (L3)", () => {
  const state = (home: string) =>
    JSON.parse(readFileSync(join(home, "state.json"), "utf8"))
  const keep = (home: string, value: unknown) =>
    writeFileSync(join(home, "state.json"), JSON.stringify(value))

  test("a deploy of one app or one secret past the limits is refused as too large; a deploy within them still goes", async () => {
    const w = await deployed(["web"])
    const held = state(w.home)
    // As many apps as a runner holds, `web` among them.
    for (let n = 1; n < LIMITS.appsPerServer; n++)
      held.lastSequence[`app-${n}`] = 1
    // As many secrets as it remembers, `web/GREETING` among them.
    for (
      let n = Object.keys(held.secrets).length;
      n < LIMITS.secretsPerServer;
      n++
    )
      held.secrets[`app-1/S${n}`] = { version: 1, hash: "0".repeat(64) }
    keep(w.home, held)
    const apply = async (deploy: Awaited<ReturnType<typeof buildDeploy>>) =>
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy,
        })
      ).json
    const next = (app: string, values?: Record<string, string>) =>
      buildDeploy({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        sequence: 2,
        app,
        values,
      })
    expect(await apply(await next("one-more"))).toEqual({
      outcome: "refused",
      reason: "too_large",
    })
    expect(
      await apply(await next("web", { GREETING: "hello", ONE_MORE: "x" }))
    ).toEqual({ outcome: "refused", reason: "too_large" })
    expect(state(w.home).lastSequence.web).toBe(1)
    expect(await apply(await next("web"))).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(Object.keys(state(w.home).lastSequence)).toHaveLength(
      LIMITS.appsPerServer
    )
  })

  test("an answer about what is running holds at most 4096 services: an app past them is left out, never cut short", async () => {
    const w = await deployed(["web"])
    const held = state(w.home)
    const apps = [
      "web",
      ...Array.from(
        { length: LIMITS.servicesPerServer / LIMITS.servicesPerApp },
        (_, n) => `app-${n}`
      ),
    ]
    for (const app of apps) {
      held.lastSequence[app] = 1
      w.docker.ps(
        app,
        Array.from({ length: LIMITS.servicesPerApp }, (_, n) =>
          JSON.stringify({
            Service: `s${n}`,
            State: "running",
            ExitCode: 0,
            Health: "",
          })
        ).join("\n")
      )
    }
    keep(w.home, held)
    const saved = process.env.ZEKNO_DOCKER
    process.env.ZEKNO_DOCKER = w.docker.path
    try {
      const answer = (await appStates(
        w.home,
        new AbortController().signal
      )) as { apps: Record<string, { services: unknown[] }> }
      expect(Object.keys(answer.apps)).toEqual(apps.slice(0, -1))
      for (const app of apps.slice(0, -1))
        expect(answer.apps[app]!.services).toHaveLength(LIMITS.servicesPerApp)
      expect(parseMessage(RunnerAppStatesSchema, answer).ok).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.ZEKNO_DOCKER
      else process.env.ZEKNO_DOCKER = saved
    }
  })
})
