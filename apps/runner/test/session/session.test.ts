/**
 * `zekno-runner session`: several requests over one connection, each through
 * the same code, lock and checks as its own command. How request lines are
 * read is in request-lines.test.ts, the session's refusals of `apply` in
 * session-refusals.test.ts, and `deploy` and `records` in
 * session-deploy.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  LIMITS,
  parseMessage,
  RUNNER_PROTOCOL,
  RUNNER_VERSION_PATTERN,
  RunnerStatusSchema,
  RunnerVersionSchema,
  SessionFrameSchema,
} from "@workspace/core"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import pkg from "../../package.json"
import { buildDeployV2, olderState } from "../support/deploy-v2"
import {
  buildDeploy,
  fakeDocker,
  runner,
  session,
  tempDir,
  waitFor,
  world,
  type Frame,
} from "../support/helpers"

const SECRET = "hello from the test"

/**
 * A world whose runner took `web` at deploy 1 before it was updated, and the
 * version-1 deploy that comes next: the one-shot `apply` takes version 1 only
 * for an app held then (contracts/runner-checks.md, "The version-1 path").
 */
async function heldBefore() {
  const w = await world()
  olderState(w.home, { web: 1 })
  const deploy = await buildDeploy({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    sequence: 2,
  })
  return { w, deploy }
}

/** Every frame is a frame of the contract: an event or a result, nothing else. */
function expectValidFrames(frames: Frame[]) {
  for (const frame of frames)
    expect(parseMessage(SessionFrameSchema, frame).ok).toBe(true)
}

describe("zekno-runner version", () => {
  test("names its version and protocol, with or without a session", async () => {
    const home = tempDir("runner")
    const docker = fakeDocker()
    const expected = { version: pkg.version, protocol: RUNNER_PROTOCOL }
    // The version it reports is its package's, in the one grammar every release is checked against.
    expect(pkg.version).toMatch(RUNNER_VERSION_PATTERN)

    const once = await runner(home, docker.path, "version")
    expect(once.code).toBe(0)
    expect(once.json).toEqual(expected)
    expect(parseMessage(RunnerVersionSchema, once.json).ok).toBe(true)

    // A runner that is not set up still says which version it is.
    const s = session(home, docker.path)
    expect(await s.request({ command: "version" })).toEqual({
      events: [],
      result: expected,
    })
    expect((await s.close()).code).toBe(0)
  })
})

describe("zekno-runner session", () => {
  test("answers several requests on one process, in order, each through the code of its one-shot command", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)

    expect((await s.request({ command: "version" })).result).toEqual({
      version: pkg.version,
      protocol: RUNNER_PROTOCOL,
    })
    const before = parseMessage(
      RunnerStatusSchema,
      (await s.request({ command: "status" })).result
    )
    expect(before.ok).toBe(true)
    if (before.ok) expect(before.value.lastSequence).toEqual({})
    expect(
      (await s.request({ command: "sync", input: { rosters: w.rosters } }))
        .result
    ).toEqual({ outcome: "ok" })

    const first = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
    })
    expect(
      (
        await s.request({
          command: "deploy",
          input: { rosters: w.rosters, ...first },
        })
      ).result
    ).toEqual({ outcome: "started", app: "web", sequence: 1 })
    const second = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      values: { GREETING: "a newer value" },
    })
    expect(
      (
        await s.request({
          command: "deploy",
          input: { rosters: w.rosters, ...second },
        })
      ).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })

    const after = parseMessage(
      RunnerStatusSchema,
      (await s.request({ command: "status" })).result
    )
    expect(after.ok).toBe(true)
    if (after.ok) {
      expect(after.value.lastSequence).toEqual({ web: 2 })
      expect(after.value.secrets).toEqual({
        "web/GREETING": { version: 2, removed: false },
      })
    }
    // The same deploy a second time is refused, exactly as the one-shot command refuses it.
    expect(
      (
        await s.request({
          command: "deploy",
          input: { rosters: w.rosters, ...second },
        })
      ).result
    ).toEqual({ outcome: "refused", reason: "replayed" })

    const closed = await s.close()
    expect(closed.code).toBe(0)
    expect(s.child.pid).toBeGreaterThan(0)
    expectValidFrames(s.frames)
    expect(s.frames.filter((frame) => "result" in frame)).toHaveLength(7)

    // Docker was started the way the one-shot command starts it, with the secrets in its environment only.
    const calls = w.docker.calls()
    expect(calls.map((call) => call.args)).toEqual([
      `compose -p zekno-web -f ${join(w.home, "apps/web/compose.yaml")} up -d --remove-orphans --no-build`,
      `compose -p zekno-web -f ${join(w.home, "apps/web/compose.yaml")} up -d --remove-orphans --no-build`,
    ])
    expect(calls.map((call) => call.env.GREETING)).toEqual([
      SECRET,
      "a newer value",
    ])
    // No frame carries a decrypted value.
    expect(s.output()).not.toContain(SECRET)
    expect(s.output()).not.toContain("a newer value")
  })

  test("an apply sends Docker's lines as progress events before its result", async () => {
    const { w, deploy } = await heldBefore()
    const long = "x".repeat(5000)
    w.docker.upPrints({
      stdout: "pulling example/web:1\n",
      stderr: ` Container zekno-web-web-1  Recreate\n\n Container zekno-web-web-1  Started\r\n${long}\n`,
    })
    const s = session(w.home, w.docker.path)
    const { events, result } = await s.request({
      command: "apply",
      input: { rosters: w.rosters, deploy },
    })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 2 })

    const lines = events.map((event) => {
      expect(event.event).toBe("progress")
      return String(event.line)
    })
    // Both of Docker's outputs count; each keeps its own order; empty lines are not sent.
    expect([...lines].sort()).toEqual(
      [
        "pulling example/web:1",
        " Container zekno-web-web-1  Recreate",
        " Container zekno-web-web-1  Started",
        "x".repeat(4096),
      ].sort()
    )
    const fromStderr = lines.filter((line) => line !== "pulling example/web:1")
    expect(fromStderr).toEqual([
      " Container zekno-web-web-1  Recreate",
      " Container zekno-web-web-1  Started",
      "x".repeat(4096),
    ])
    expect((await s.close()).code).toBe(0)
    expectValidFrames(s.frames)
  })

  test("a failed start sends what Docker reported, then start_failed", async () => {
    const { w, deploy } = await heldBefore()
    w.docker.failWith(1)
    w.docker.upPrints({
      stderr: "Error response from daemon: port is already allocated\n",
    })
    const s = session(w.home, w.docker.path)
    const { events, result } = await s.request({
      command: "apply",
      input: { rosters: w.rosters, deploy },
    })
    expect(events).toEqual([
      {
        event: "progress",
        line: "Error response from daemon: port is already allocated",
      },
    ])
    expect(result).toEqual({ outcome: "start_failed", app: "web", sequence: 2 })
    expect((await s.close()).code).toBe(0)
  })

  test("the one-shot apply still prints one JSON line, with Docker's output on standard error", async () => {
    const { w, deploy } = await heldBefore()
    w.docker.upPrints({
      stdout: "pulling example/web:1\n",
      stderr: " Container zekno-web-web-1  Started\n",
    })
    const result = await runner(w.home, w.docker.path, "apply", {
      rosters: w.rosters,
      deploy,
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      `${JSON.stringify({ outcome: "started", app: "web", sequence: 2 })}\n`
    )
    expect(result.stderr).toContain("pulling example/web:1")
    expect(result.stderr).toContain(" Container zekno-web-web-1  Started")
  })

  test("a line that is not a request is refused, and three in a row end the session with status 1", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    const refusal = { outcome: "refused", reason: "invalid_request" }

    expect(await s.request("garbage")).toEqual({ events: [], result: refusal })
    expect(await s.request("{}")).toEqual({ events: [], result: refusal })
    // A request that can be read resets the count.
    expect(
      parseMessage(
        RunnerStatusSchema,
        (await s.request({ command: "status" })).result
      ).ok
    ).toBe(true)
    // `deploy` is a command since protocol 3, `pack` since protocol 6; `shutdown` is one no runner knows.
    expect(await s.request({ command: "shutdown" })).toEqual({
      events: [],
      result: refusal,
    })
    expect(await s.request({ command: "status", extra: 1 })).toEqual({
      events: [],
      result: refusal,
    })
    // The third, an empty line, is sent together with a request that is never answered.
    s.send(`\n${JSON.stringify({ command: "version" })}`)
    expect(await s.next()).toEqual({ result: refusal })

    // The session has ended: nothing more is answered, and the runner exits with status 1.
    expect(await s.next()).toBeUndefined()
    expect(await s.child.exited).toBe(1)
    expect(s.frames).toHaveLength(6)
    expectValidFrames(s.frames)
  })

  test("a request whose input does not match its command is refused as the one-shot command refuses it, and the session goes on", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    for (const command of ["setup", "sync", "apply", "logs"]) {
      for (const input of [undefined, "garbage", {}, [], null, 7]) {
        const request = input === undefined ? { command } : { command, input }
        expect(await s.request(request)).toEqual({
          events: [],
          result: { outcome: "refused", reason: "invalid_request" },
        })
      }
    }
    expect(
      parseMessage(
        RunnerStatusSchema,
        (await s.request({ command: "status" })).result
      ).ok
    ).toBe(true)
    expect((await s.close()).code).toBe(0)
    expect(w.docker.calls()).toEqual([])
  })

  test("pack, builds and builder refuse an input that is not their own invalid_request, and the session goes on", async () => {
    // Feature 016 (specs/016-build-from-source, contracts/core.md CO12): `pack`,
    // `builds` and `builder` are commands of protocol 6, carried out since
    // T070, T092 and T093 (test/scenarios/pack.test.ts, builds-command.test.ts,
    // builder-command.test.ts). An input outside their schemas is refused
    // before anything is read or asked of Docker, never left with no result.
    const w = await world()
    const s = session(w.home, w.docker.path)
    const inputs: Record<string, unknown[]> = {
      pack: [undefined, {}, { apps: ["web"] }],
      builds: [[], { apps: [] }, { apps: ["web"], extra: 1 }],
      builder: [[], { usage: false }, { apps: ["web"] }],
    }
    for (const [command, refusedInputs] of Object.entries(inputs))
      for (const input of refusedInputs)
        expect(
          await s.request(
            input === undefined ? { command } : { command, input }
          )
        ).toEqual({
          events: [],
          result: { outcome: "refused", reason: "invalid_request" },
        })
    expect((await s.request({ command: "version" })).result).toEqual({
      version: pkg.version,
      protocol: RUNNER_PROTOCOL,
    })
    expect((await s.close()).code).toBe(0)
    expect(w.docker.calls()).toEqual([])
    expectValidFrames(s.frames)
  })

  test("a line longer than the message limit is refused without ending the session", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    const oversized = `{"command":"status","input":"${"x".repeat(LIMITS.messageBytes)}"}`
    expect(await s.request(oversized)).toEqual({
      events: [],
      result: { outcome: "refused", reason: "invalid_request" },
    })
    expect((await s.request({ command: "version" })).result).toEqual({
      version: pkg.version,
      protocol: RUNNER_PROTOCOL,
    })
    expect((await s.close()).code).toBe(0)
  })

  test("an apply carries on to its end when the input closes and nobody reads any more", async () => {
    const { w, deploy } = await heldBefore()
    w.docker.upPrints({ stderr: " Container zekno-web-web-1  Recreate\n" })
    // Docker prints more after the connection has gone: writing it must not stop the runner.
    w.docker.holdUp(" Container zekno-web-web-1  Started\n".repeat(2000))
    const s = session(w.home, w.docker.path)
    s.send({ command: "apply", input: { rosters: w.rosters, deploy } })
    await waitFor(w.docker.upStarted, "docker compose up to start")

    await s.goAway()
    w.docker.releaseUp()
    expect(await s.exited()).toBe(0)

    // The deploy ran to its end, its number is used, and the lock was let go.
    expect(w.docker.upFinished()).toBe(true)
    expect(
      JSON.parse(readFileSync(join(w.home, "state.json"), "utf8")).lastSequence
    ).toEqual({ web: 2 })
    expect(existsSync(join(w.home, "lock"))).toBe(false)
    expect(
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy,
        })
      ).json
    ).toEqual({ outcome: "refused", reason: "replayed" })
  })

  test("an apply whose input closed while it ran still sends its result to a reader that stayed", async () => {
    const { w, deploy } = await heldBefore()
    w.docker.holdUp(" Container zekno-web-web-1  Started\n")
    const s = session(w.home, w.docker.path)
    s.send({ command: "apply", input: { rosters: w.rosters, deploy } })
    await waitFor(w.docker.upStarted, "docker compose up to start")
    const closing = s.close()
    w.docker.releaseUp()
    expect((await closing).code).toBe(0)
    expect(s.frames.at(-1)).toEqual({
      result: { outcome: "started", app: "web", sequence: 2 },
    })
    expect(s.frames).toContainEqual({
      event: "progress",
      line: " Container zekno-web-web-1  Started",
    })
  })

  test("requests sent just before the input closes are still answered", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    s.send({ command: "version" })
    s.send({ command: "status" })
    const { code } = await s.close()
    expect(code).toBe(0)
    expect(s.frames).toHaveLength(2)
    expect(s.frames[0]).toEqual({
      result: { version: pkg.version, protocol: RUNNER_PROTOCOL },
    })
    expect(parseMessage(RunnerStatusSchema, s.frames[1]!.result).ok).toBe(true)
  })

  test("a session takes the same lock as the one-shot commands, and only while it works", async () => {
    const { w, deploy } = await heldBefore()
    const s = session(w.home, w.docker.path)
    writeFileSync(join(w.home, "lock"), String(process.pid)) // this test process is alive
    expect(
      (
        await s.request({
          command: "apply",
          input: { rosters: w.rosters, deploy },
        })
      ).result
    ).toEqual({ outcome: "refused", reason: "busy" })
    // `sync` takes the state lock only, never the deploy lock: it is answered meanwhile
    // (specs/016-build-from-source, contracts/runner.md RB1).
    expect(
      (await s.request({ command: "sync", input: { rosters: w.rosters } }))
        .result
    ).toEqual({ outcome: "ok" })
    writeFileSync(join(w.home, "lock"), "999999") // no such process
    expect(
      (
        await s.request({
          command: "apply",
          input: { rosters: w.rosters, deploy },
        })
      ).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    // Between requests the session holds no lock: a one-shot command can run.
    expect(existsSync(join(w.home, "lock"))).toBe(false)
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters: w.rosters })).json
    ).toEqual({ outcome: "ok" })
    expect((await s.close()).code).toBe(0)
  })

  test("setup through a session is the same one-time setup", async () => {
    const { team } = await world()
    const home = tempDir("runner")
    const docker = fakeDocker()
    const s = session(home, docker.path)
    const first = await s.request({
      command: "setup",
      input: { founding: team.envelope, teamCode: team.confirmationCode },
    })
    expect(first.result.serverId).toStartWith("srv_")
    expect(
      await s.request({
        command: "setup",
        input: { founding: team.envelope, teamCode: team.confirmationCode },
      })
    ).toEqual({
      events: [],
      result: { outcome: "refused", reason: "already_set_up" },
    })
    expect((await s.close()).code).toBe(0)
    expect(readFileSync(join(home, "server.key"), "utf8")).toStartWith(
      "zk_ssk_"
    )
  })

  test("wrong usage of session exits with status 2 and prints nothing on standard output", async () => {
    const result = await runner(
      tempDir("runner"),
      fakeDocker().path,
      "session",
      undefined,
      ["extra"]
    )
    expect(result.code).toBe(2)
    expect(result.stdout).toBe("")
  })
})
