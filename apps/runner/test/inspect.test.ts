import { describe, expect, test } from "bun:test"
import { LogEventSchema, parseMessage, RunnerAppStatesSchema, SessionFrameSchema } from "@workspace/core"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseLogLine, parsePs } from "../src/inspect"
import { deployed, fakeDocker, isAlive, session, tempDir, waitFor, world } from "./helpers"

/** One row of `docker compose ps --format json` as Docker 29 prints it, with everything it carries. */
function psRow(service: string, state: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    Command: `"/docker-entrypoint.sh sh -c 'echo $GREETING > /srv/private/out'"`,
    CreatedAt: "2026-11-13 16:56:03 +0000 UTC",
    ExitCode: 0,
    Health: "",
    ID: "4f1c0de5a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8",
    Image: "example/web:1",
    Labels:
      "com.docker.compose.project=zekno-web,com.docker.compose.project.working_dir=/home/deploy/.local/state/zekno/apps/web,com.docker.compose.project.config_files=/home/deploy/.local/state/zekno/apps/web/compose.yaml,com.docker.compose.service=" +
      service,
    LocalVolumes: "1",
    Mounts: "/srv/private/data",
    Name: `zekno-web-${service}-1`,
    Names: `zekno-web-${service}-1`,
    Networks: "zekno-web_default",
    Ports: "0.0.0.0:8080->80/tcp",
    Project: "zekno-web",
    Publishers: [{ URL: "0.0.0.0", TargetPort: 80, PublishedPort: 8080, Protocol: "tcp" }],
    RunningFor: "2 minutes ago",
    Service: service,
    Size: "0B",
    State: state,
    Status: "Up 2 minutes",
    ...extra,
  })
}

/** What must never leave the server in an answer about state. */
const PRIVATE = ["/home/deploy", "/srv/private", "docker-entrypoint", "com.docker.compose", "0.0.0.0", "4f1c0de5", "zekno-web-web-1", "Up 2 minutes"]

describe("parsePs", () => {
  test("keeps the service, state, exit code and health of each container, and nothing else", () => {
    const output = [
      psRow("web", "running", { Health: "healthy" }),
      psRow("worker", "exited", { ExitCode: 137, Status: "Exited (137) 1 minute ago" }),
    ].join("\n")
    expect(parsePs(output)).toEqual([
      { service: "web", state: "running", exitCode: 0, health: "healthy" },
      { service: "worker", state: "exited", exitCode: 137, health: "" },
    ])
    const answer = JSON.stringify(parsePs(output))
    for (const text of PRIVATE) expect(answer).not.toContain(text)
  })

  test("reads the one array that older Docker versions print", () => {
    const output = `[${psRow("web", "running")},${psRow("db", "restarting", { Health: "starting" })}]\n`
    expect(parsePs(output)).toEqual([
      { service: "web", state: "running", exitCode: 0, health: "" },
      { service: "db", state: "restarting", exitCode: 0, health: "starting" },
    ])
  })

  test("reports a state or health it does not know as unknown or empty, and a strange exit code as 0", () => {
    const rows = [
      psRow("a", "RUNNING", { Health: "Unhealthy" }),
      psRow("b", "hibernating", { Health: "sleepy" }),
      psRow("c", "exited", { ExitCode: 300 }),
      psRow("d", "exited", { ExitCode: -1 }),
      psRow("e", "exited", { ExitCode: "1; rm -rf /" }),
      psRow("f", "dead", { ExitCode: 1.5, State: undefined }),
    ]
    expect(parsePs(rows.join("\n"))).toEqual([
      { service: "a", state: "running", exitCode: 0, health: "unhealthy" },
      { service: "b", state: "unknown", exitCode: 0, health: "" },
      { service: "c", state: "exited", exitCode: 0, health: "" },
      { service: "d", state: "exited", exitCode: 0, health: "" },
      { service: "e", state: "exited", exitCode: 0, health: "" },
      { service: "f", state: "unknown", exitCode: 0, health: "" },
    ])
  })

  test("drops rows without a valid service name and lines that are not JSON", () => {
    const output = [
      "WARN[0000] something Docker wanted to say",
      psRow("\u001b]52;c;aGk=\u0007web", "running"),
      psRow("-web", "running"),
      psRow("a".repeat(64), "running"),
      JSON.stringify({ State: "running" }),
      "null",
      "42",
      psRow("web", "running"),
      "",
    ].join("\n")
    expect(parsePs(output)).toEqual([{ service: "web", state: "running", exitCode: 0, health: "" }])
  })

  test("keeps at most 256 services", () => {
    const output = Array.from({ length: 300 }, (_, i) => psRow(`s${i}`, "running")).join("\n")
    expect(parsePs(output)).toHaveLength(256)
  })

  test("nothing printed is no services", () => {
    expect(parsePs("")).toEqual([])
  })
})

describe("parseLogLine", () => {
  const now = () => new Date("2026-11-14T10:00:00.000Z")

  test("reads the service, the time and the text of a line", () => {
    const event = parseLogLine("web-1     | 2026-11-13T16:56:04.136118801Z started on port 80", now)
    expect(event).toEqual({ event: "log", service: "web", time: "2026-11-13T16:56:04.136118801Z", line: "started on port 80" })
    expect(parseMessage(LogEventSchema, event).ok).toBe(true)
  })

  test("keeps a service name that ends in digits of its own, and a time with an offset", () => {
    expect(parseLogLine("api-worker-2-1  | 2026-11-13T16:56:04+02:00 ready", now)).toEqual({
      event: "log",
      service: "api-worker-2",
      time: "2026-11-13T16:56:04+02:00",
      line: "ready",
    })
  })

  test("uses the time it was read when Docker gave none", () => {
    expect(parseLogLine("web-1  | no time here", now)).toEqual({ event: "log", service: "web", time: "2026-11-14T10:00:00.000Z", line: "no time here" })
  })

  test("passes the text on as Docker gave it, for the CLI to clean", () => {
    const text = "a | b \u001b[31mred\u001b[0m\r \u001b]52;c;aGk=\u0007"
    const event = parseLogLine(`web-1  | 2026-11-13T16:56:04Z ${text}`, now)
    expect(event?.line).toBe(text)
    expect(parseMessage(LogEventSchema, event).ok).toBe(true)
  })

  test("cuts a very long line", () => {
    const event = parseLogLine(`web-1  | 2026-11-13T16:56:04Z ${"x".repeat(20000)}`, now)
    expect(event?.line).toHaveLength(16384)
    expect(parseMessage(LogEventSchema, event).ok).toBe(true)
  })

  test("is nothing for a line that is not a log line", () => {
    for (const line of ["", "Attaching to web-1", "| no service", "\u001b[31mweb-1\u001b[0m | coloured", "we b-1 | spaced"]) {
      expect(parseLogLine(line, now)).toBeUndefined()
    }
  })
})

describe("state, through a session", () => {
  test("running, stopped and partly running apps, each service by name only", async () => {
    const w = await deployed(["web", "api", "worker"])
    w.docker.ps("web", [psRow("web", "running", { Health: "healthy" }), psRow("cache", "running")].join("\n"))
    w.docker.ps("api", [psRow("api", "exited", { ExitCode: 0 }), psRow("migrate", "exited", { ExitCode: 137 })].join("\n"))
    w.docker.ps("worker", [psRow("worker", "running"), psRow("cron", "exited", { ExitCode: 1 }), psRow("queue", "restarting")].join("\n"))

    const s = session(w.home, w.docker.path)
    const { events, result } = await s.request({ command: "state" })
    expect(events).toEqual([])
    expect(parseMessage(RunnerAppStatesSchema, result).ok).toBe(true)
    expect(result).toEqual({
      apps: {
        web: {
          services: [
            { service: "web", state: "running", exitCode: 0, health: "healthy" },
            { service: "cache", state: "running", exitCode: 0, health: "" },
          ],
        },
        api: {
          services: [
            { service: "api", state: "exited", exitCode: 0, health: "" },
            { service: "migrate", state: "exited", exitCode: 137, health: "" },
          ],
        },
        worker: {
          services: [
            { service: "worker", state: "running", exitCode: 0, health: "" },
            { service: "cron", state: "exited", exitCode: 1, health: "" },
            { service: "queue", state: "restarting", exitCode: 0, health: "" },
          ],
        },
      },
    })
    expect((await s.close()).code).toBe(0)

    // Docker was asked about each app by its project name, and never given a secret.
    const calls = w.docker.inspections()
    expect(calls.map((call) => call.args).sort()).toEqual(
      ["web", "api", "worker"].map((app) => `compose -p zekno-${app} ps --all --format json`).sort()
    )
    for (const call of calls) {
      expect(call.env.GREETING).toBeUndefined()
      expect(call.env.ZEKNO_RUNNER_HOME).toBeUndefined()
    }
    // Asking changed nothing: no deploy was started.
    expect(w.docker.calls()).toHaveLength(3)
  })

  test("labels, commands and host paths never reach the answer", async () => {
    const w = await deployed(["web"])
    w.docker.ps("web", [psRow("web", "running"), psRow("worker", "exited", { ExitCode: 2 })].join("\n"))
    const s = session(w.home, w.docker.path)
    const { result } = await s.request({ command: "state" })
    expect(result).toEqual({
      apps: {
        web: {
          services: [
            { service: "web", state: "running", exitCode: 0, health: "" },
            { service: "worker", state: "exited", exitCode: 2, health: "" },
          ],
        },
      },
    })
    expect((await s.close()).code).toBe(0)
    for (const text of PRIVATE) expect(s.output()).not.toContain(text)
  })

  test("an app with no containers has no services; an app Docker could not be asked about is left out", async () => {
    const w = await deployed(["web", "api"])
    w.docker.ps("web", "")
    w.docker.ps("api", psRow("api", "running"), 1)
    const s = session(w.home, w.docker.path)
    expect((await s.request({ command: "state" })).result).toEqual({ apps: { web: { services: [] } } })
    expect((await s.close()).code).toBe(0)
  })

  test("asks only about apps the runner accepted a deploy for", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    // Input given with `state` names nothing: the apps come from the runner's own state.
    expect((await s.request({ command: "state", input: { app: "other" } })).result).toEqual({ apps: {} })
    expect((await s.close()).code).toBe(0)
    expect(w.docker.inspections()).toEqual([])
  })

  test("needs a runner that is set up with a private folder, and takes no lock", async () => {
    const fresh = session(tempDir("runner"), fakeDocker().path)
    expect((await fresh.request({ command: "state" })).result).toEqual({ outcome: "refused", reason: "not_set_up" })
    expect((await fresh.close()).code).toBe(0)

    const w = await deployed(["web"])
    w.docker.ps("web", psRow("web", "running"))
    const s = session(w.home, w.docker.path)
    chmodSync(w.home, 0o755)
    expect((await s.request({ command: "state" })).result).toEqual({ outcome: "refused", reason: "invalid_state" })
    chmodSync(w.home, 0o700)
    // A deploy in progress elsewhere holds the lock; reading state does not wait for it.
    writeFileSync(join(w.home, "lock"), String(process.pid))
    expect((await s.request({ command: "state" })).result).toEqual({ apps: { web: { services: [{ service: "web", state: "running", exitCode: 0, health: "" }] } } })
    expect((await s.close()).code).toBe(0)
  })
})

describe("logs, through a session", () => {
  const LINES = [
    "web-1     | 2026-11-13T16:56:04.136118801Z started",
    "worker-1  | 2026-11-13T16:56:05.000000000Z waiting for jobs",
    "not a log line",
    "web-1     | 2026-11-13T16:56:06.500Z GET / 200",
    "",
  ].join("\n")

  test("sends each log line as an event and answers ok when Docker's log command ends", async () => {
    const w = await deployed(["web"])
    w.docker.logs("web", LINES)
    const s = session(w.home, w.docker.path)
    const { events, result } = await s.request({ command: "logs", input: { app: "web", tail: 2 } })
    expect(events).toEqual([
      { event: "log", service: "web", time: "2026-11-13T16:56:04.136118801Z", line: "started" },
      { event: "log", service: "worker", time: "2026-11-13T16:56:05.000000000Z", line: "waiting for jobs" },
      { event: "log", service: "web", time: "2026-11-13T16:56:06.500Z", line: "GET / 200" },
    ])
    expect(result).toEqual({ outcome: "ok" })
    // The session goes on after the logs.
    expect((await s.request({ command: "state" })).result).toEqual({ apps: { web: { services: [] } } })
    expect((await s.close()).code).toBe(0)
    for (const frame of s.frames) expect(parseMessage(SessionFrameSchema, frame).ok).toBe(true)

    const [call] = w.docker.inspections()
    expect(call!.args).toBe("compose -p zekno-web logs --follow --timestamps --no-color --tail 2")
    expect(call!.env.GREETING).toBeUndefined()
    expect(w.docker.calls()).toHaveLength(1)
  })

  test("an app the runner has not accepted a deploy for is refused, and Docker is not asked", async () => {
    const w = await deployed(["web"])
    const s = session(w.home, w.docker.path)
    for (const app of ["api", "zekno-web", "constructor", "__proto__"]) {
      expect(await s.request({ command: "logs", input: { app, tail: 10 } })).toEqual({ events: [], result: { outcome: "refused", reason: "invalid_request" } })
      expect(await s.request({ command: "logs", input: { app, tail: 10, follow: false } })).toEqual({
        events: [],
        result: { outcome: "refused", reason: "invalid_request" },
      })
    }
    expect((await s.close()).code).toBe(0)
    expect(w.docker.inspections()).toEqual([])
  })

  test("without following, the lines Docker has are sent and the request ends by itself, though Docker would follow", async () => {
    const w = await deployed(["web"])
    // Asked to follow, the stand-in would stay alive; without `--follow` it ends, as Docker's does.
    w.docker.logs("web", LINES, { follow: true })
    const s = session(w.home, w.docker.path)
    const { events, result } = await s.request({ command: "logs", input: { app: "web", tail: 5, follow: false } })
    expect(events.map((event) => event.line)).toEqual(["started", "waiting for jobs", "GET / 200"])
    expect(result).toEqual({ outcome: "ok" })
    // The session goes on, with the input still open.
    expect((await s.request({ command: "state" })).result).toEqual({ apps: { web: { services: [] } } })
    expect((await s.close()).code).toBe(0)
    const [call] = w.docker.inspections()
    expect(call!.args).toBe("compose -p zekno-web logs --timestamps --no-color --tail 5")
    expect(w.docker.logsPid()).toBeUndefined()
  })

  test("follow: true is the same as leaving it out: Docker is asked to follow until the reader goes", async () => {
    const w = await deployed(["web"])
    w.docker.logs("web", LINES, { follow: true })
    const s = session(w.home, w.docker.path)
    s.send({ command: "logs", input: { app: "web", tail: 3, follow: true } })
    expect((await s.next())?.line).toBe("started")
    await waitFor(() => w.docker.logsPid() !== undefined, "docker compose logs to start")
    expect(w.docker.inspections()[0]!.args).toBe("compose -p zekno-web logs --follow --timestamps --no-color --tail 3")
    expect((await s.close()).code).toBe(0)
    expect(isAlive(w.docker.logsPid()!)).toBe(false)
    expect(s.frames.at(-1)).toEqual({ result: { outcome: "ok" } })
  })

  test("an app name outside the pattern, or a tail out of range, never reaches Docker", async () => {
    const w = await deployed(["web"])
    const s = session(w.home, w.docker.path)
    const inputs = [
      ...["../web", "Web", "web;rm -rf /", "web web", "-p", "web\n", "web/../x", "", "a".repeat(64), "$(id)"].map((app) => ({ app, tail: 10 })),
      { app: "web", tail: -1 },
      { app: "web", tail: 1001 },
      { app: "web", tail: 1.5 },
      { app: "web", tail: "10" },
      { app: "web" },
      { app: "web", tail: 10, follow: "false" },
      { app: "web", tail: 10, follow: 0 },
      { app: "web", tail: 10, follow: null },
      { app: "web", tail: 10, since: "1h" },
      { app: ["web"], tail: 10 },
    ]
    for (const input of inputs) {
      expect(await s.request({ command: "logs", input })).toEqual({ events: [], result: { outcome: "refused", reason: "invalid_request" } })
    }
    expect((await s.close()).code).toBe(0)
    expect(w.docker.inspections()).toEqual([])
  })

  test("needs a runner that is set up", async () => {
    const s = session(tempDir("runner"), fakeDocker().path)
    expect((await s.request({ command: "logs", input: { app: "web", tail: 10 } })).result).toEqual({ outcome: "refused", reason: "not_set_up" })
    expect((await s.close()).code).toBe(0)
  })

  test("logs end when the reader closes the session: Docker's log command is stopped and the runner exits", async () => {
    const w = await deployed(["web"])
    w.docker.logs("web", LINES, { follow: true })
    const s = session(w.home, w.docker.path)
    s.send({ command: "logs", input: { app: "web", tail: 200 } })
    const lines = [await s.next(), await s.next(), await s.next()].map((frame) => frame?.line)
    expect(lines).toEqual(["started", "waiting for jobs", "GET / 200"])
    await waitFor(() => w.docker.logsPid() !== undefined, "docker compose logs to start")
    const pid = w.docker.logsPid()!
    // Docker's log command is still following; the request has no result yet.
    await Bun.sleep(200)
    expect(isAlive(pid)).toBe(true)
    expect(s.frames).toHaveLength(3)

    const { code } = await s.close()
    expect(code).toBe(0)
    expect(isAlive(pid)).toBe(false)
    // The request ended with its result.
    expect(s.frames).toHaveLength(4)
    expect(s.frames.at(-1)).toEqual({ result: { outcome: "ok" } })
  })

  test("logs end when the connection drops, even when Docker leaves a process holding its output", async () => {
    const w = await deployed(["web"])
    w.docker.logs("web", LINES, { follow: true, leaveChild: true })
    const s = session(w.home, w.docker.path)
    s.send({ command: "logs", input: { app: "web", tail: 200 } })
    expect((await s.next())?.line).toBe("started")
    await waitFor(() => w.docker.logsPid() !== undefined && w.docker.leftChildPid() !== undefined, "docker compose logs to start")
    const pid = w.docker.logsPid()!
    const left = w.docker.leftChildPid()!
    try {
      await s.goAway()
      expect(await s.exited()).toBe(0)
      expect(isAlive(pid)).toBe(false)
    } finally {
      if (isAlive(left)) process.kill(left)
    }
  })
})
