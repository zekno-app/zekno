/**
 * `deploy` and `records` in a session (specs/014-deploy-v2, contracts/
 * protocol.md P2 to P6): commands of a session only, carried the way `apply`
 * is, with Docker's lines as progress events and one result. The rest of the
 * session is tested in session.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  parseMessage,
  RunnerReportSchema,
  RunnerStatusSchema,
  SessionFrameSchema,
} from "@workspace/core"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { buildDeployV2, GREETING } from "../support/deploy-v2"
import {
  runner,
  session,
  tempDir,
  fakeDocker,
  waitFor,
  world,
  type Frame,
} from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

/** A request to deploy `web` against `previous`, with a new record of GREETING. */
async function deployRequest(w: World, previous: number) {
  const { envelope, records } = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
  })
  return {
    command: "deploy",
    input: { rosters: w.rosters, envelope, records },
  }
}

function expectValidFrames(frames: Frame[]) {
  for (const frame of frames)
    expect(parseMessage(SessionFrameSchema, frame).ok).toBe(true)
}

describe("deploy in a session", () => {
  test("sends Docker's lines as progress events, then its result", async () => {
    const w = await world()
    w.docker.upPrints({
      stdout: "pulling example/web:1\n",
      stderr:
        " Container zekno-web-web-1  Recreate\n\n Container zekno-web-web-1  Started\n",
    })
    const s = session(w.home, w.docker.path)
    const { events, result } = await s.request(await deployRequest(w, 0))
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 1 })
    expect(events.map((event) => event.event)).toEqual([
      "progress",
      "progress",
      "progress",
    ])
    expect(events.map((event) => String(event.line)).sort()).toEqual(
      [
        "pulling example/web:1",
        " Container zekno-web-web-1  Recreate",
        " Container zekno-web-web-1  Started",
      ].sort()
    )
    expect((await s.close()).code).toBe(0)
    expectValidFrames(s.frames)
    // No frame carries a decrypted value; Docker had it in its environment.
    expect(s.output()).not.toContain(GREETING)
    expect(w.docker.calls()[0]!.env.GREETING).toBe(GREETING)
  })

  test("a failed start sends what Docker said, then start_failed, and the number is used", async () => {
    const w = await world()
    w.docker.failWith(1)
    w.docker.upPrints({
      stderr: "Error response from daemon: port is already allocated\n",
    })
    const s = session(w.home, w.docker.path)
    expect(await s.request(await deployRequest(w, 0))).toEqual({
      events: [
        {
          event: "progress",
          line: "Error response from daemon: port is already allocated",
        },
      ],
      result: { outcome: "start_failed", app: "web", sequence: 1 },
    })
    expect((await s.close()).code).toBe(0)
    expect(
      JSON.parse(readFileSync(join(w.home, "state.json"), "utf8")).lastSequence
    ).toEqual({ web: 1 })
  })

  test("a refusal is answered, and the next request on the same session is answered", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    const first = await deployRequest(w, 0)
    expect((await s.request(first)).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 1,
    })
    const again = await s.request(first)
    expect(again).toEqual({
      events: [],
      result: { outcome: "refused", reason: "replayed" },
    })
    expect(parseMessage(RunnerReportSchema, again.result).ok).toBe(true)
    expect(
      parseMessage(
        RunnerStatusSchema,
        (await s.request({ command: "status" })).result
      ).ok
    ).toBe(true)
    expect((await s.request(await deployRequest(w, 1))).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect((await s.close()).code).toBe(0)
    expect(w.docker.calls()).toHaveLength(2)
    expectValidFrames(s.frames)
  })

  test("a deploy whose input closes while it runs, with nobody reading, carries on to its end", async () => {
    const w = await world()
    w.docker.upPrints({ stderr: " Container zekno-web-web-1  Recreate\n" })
    // Docker prints more after the connection has gone: writing it must not stop the runner.
    w.docker.holdUp(" Container zekno-web-web-1  Started\n".repeat(2000))
    const s = session(w.home, w.docker.path)
    const request = await deployRequest(w, 0)
    s.send(request)
    await waitFor(w.docker.upStarted, "docker compose up to start")

    await s.goAway()
    w.docker.releaseUp()
    expect(await s.exited()).toBe(0)

    // The deploy ran to its end, its number is used, and the lock was let go.
    expect(w.docker.upFinished()).toBe(true)
    expect(
      JSON.parse(readFileSync(join(w.home, "state.json"), "utf8")).lastSequence
    ).toEqual({ web: 1 })
    expect(existsSync(join(w.home, "lock"))).toBe(false)
    const later = session(w.home, w.docker.path)
    expect((await later.request(request)).result).toEqual({
      outcome: "refused",
      reason: "replayed",
    })
    expect((await later.close()).code).toBe(0)
  })

  test("a deploy or records request whose input is not its request is invalid_request, and the session goes on", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    for (const command of ["deploy", "records"]) {
      for (const input of [undefined, "garbage", {}, [], null, 7]) {
        const request = input === undefined ? { command } : { command, input }
        expect(await s.request(request)).toEqual({
          events: [],
          result: { outcome: "refused", reason: "invalid_request" },
        })
      }
    }
    expect(
      await s.request({ command: "records", input: { app: "Web" } })
    ).toEqual({
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
    expect(w.docker.calls()).toEqual([])
  })
})

describe("deploy and records are not one-shot commands", () => {
  test("`zekno-runner deploy` and `zekno-runner records` print the usage and exit with status 2, with nothing on standard output", async () => {
    const home = tempDir("runner")
    const docker = fakeDocker()
    for (const command of ["deploy", "records"]) {
      for (const message of [undefined, { app: "web" }]) {
        const result = await runner(home, docker.path, command, message)
        expect(result.code).toBe(2)
        expect(result.stdout).toBe("")
        expect(result.stderr).toContain("Usage: zekno-runner")
      }
    }
    expect(docker.calls()).toEqual([])
  })
})
