import { describe, expect, spyOn, test } from "bun:test"
import {
  LIMITS,
  RunnerAppStatesSchema,
  RunnerReportSchema,
  RunnerStatusSchema,
  RunnerVersionSchema,
  type SessionEvent,
} from "@workspace/core"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { isAlive, RUNNER_MAIN, runner, tempDir, waitFor } from "../../runner/test/helpers"
import { RunnerRefused } from "../src/errors"
import { prepareDeploy, sendDeploy } from "../src/ops/deploy"
import { ENDED, openSession, TOO_LARGE, TOO_OLD, UNEXPECTED } from "../src/session"
import { connect, LOCAL_FIRST_ANSWER_MS, type Target, type Transport } from "../src/transport"
import { COMPOSE_V1, COMPOSE_V2, machine, ready } from "./helpers"

const where = ["--app", "web", "--server", "dev"]
const VERSION = { version: "0.2.0", protocol: 2 }

/**
 * A runner command that notes its process id and command word in `log`
 * each time it is started, then becomes the real runner with the stand-in
 * Docker. `before` runs first, for a runner that is slow to start.
 */
function counted(log: string, docker: string, before = ""): string[] {
  return ["sh", "-c", `for word; do :; done; echo "$$ $word" >> "$0"; ${before} exec "$@"`, log, "env", `ZEKNO_DOCKER=${docker}`, process.execPath, RUNNER_MAIN]
}

/** Each start noted by `counted`, in order. */
function starts(log: string): { pid: number; word: string }[] {
  if (!existsSync(log)) return []
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, word] = line.split(" ")
      return { pid: Number(pid), word: word! }
    })
}
const words = (log: string) => starts(log).map((start) => start.word)

/** A shell step that prints one line. */
const say = (line: unknown) => `printf '%s\\n' '${typeof line === "string" ? line : JSON.stringify(line)}'`

/** A stand-in that speaks sessions: before each step it reads one request; at the end it waits for its input to close. */
const scripted = (...steps: string[]) => ["sh", "-c", `${steps.map((step) => `read -r line; ${step}`).join("; ")}; cat >/dev/null`]

const local = (home = tempDir("runner")): Target => ({ kind: "local", home })

/** What the profile says this machine's server is. */
const serverIdOf = (home: string): string => JSON.parse(readFileSync(join(home, "profile.json"), "utf8")).servers[0].serverId

describe("a session carries several requests over one runner process", () => {
  test("requests are answered in order on one process, which exits cleanly when the session closes", async () => {
    const m = await ready()
    const log = join(m.project, "starts.log")
    const s = await openSession(connect(local(m.runnerHome), counted(log, m.docker.path)))
    expect(s.mode).toBe("session")
    expect(s.runner).toEqual(VERSION)

    expect((await s.request("status", RunnerStatusSchema)).serverId).toBe(serverIdOf(m.home))
    expect(await s.request("state", RunnerAppStatesSchema)).toEqual({ apps: {} })
    expect(await s.request("version", RunnerVersionSchema)).toEqual(VERSION)
    expect((await s.request("status", RunnerStatusSchema)).serverId).toBe(serverIdOf(m.home))
    expect(await s.close()).toBe(0)
    expect(await s.close()).toBe(0)
    expect(words(log)).toEqual(["session"])
    await expect(s.request("status", RunnerStatusSchema)).rejects.toThrow(ENDED)
  })

  test("a refusal is an answer: it becomes RunnerRefused and the session goes on", async () => {
    const m = machine()
    const s = await openSession(connect(local(), m.deps.localRunner))
    const refusal = await s.request("status", RunnerStatusSchema).catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(RunnerRefused)
    expect((refusal as RunnerRefused).reason).toBe("not_set_up")
    expect(await s.request("version", RunnerVersionSchema)).toEqual(VERSION)
    expect(await s.close()).toBe(0)
  })

  test("Docker's lines arrive as progress, cleaned, after `starting` and before the result", async () => {
    const m = await ready()
    m.docker.upPrints({
      stdout: "\x1b[2J\x1b[H\x1b[31mPulling web\x1b[0m\n",
      stderr: " Container zekno-web-web-1  \x1b]52;c;ZXZpbA==\x07Started\n\x1b]8;;https://evil.example/\x1b\\details\x1b]8;;\x1b\\\n",
    })
    const timeline: string[] = []
    const plan = await prepareDeploy(m.deps, { app: "web", server: "dev" })
    const result = await sendDeploy(m.deps, plan, {
      stage: (stage, deploy) => timeline.push(`${stage} ${deploy.sequence}`),
      progress: (line) => timeline.push(`line ${line}`),
    })
    expect(result).toMatchObject({ outcome: "started", app: "web", sequence: 1, server: "dev", secrets: 0, mode: "session" })
    expect(timeline.slice(0, 4)).toEqual(["checked 1", "signed 1", "sent 1", "starting 1"])
    expect(timeline.at(-1)).toBe("started 1")
    expect(timeline.slice(4, -1).sort()).toEqual(["line  Container zekno-web-web-1  Started", "line Pulling web", "line details"])
  })

  test("log events arrive cleaned", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where)).toBe(0) // the runner gives logs only for an app it accepted
    m.docker.logs("web", "web-1     | 2026-11-13T16:56:04.136118801Z \x1b[31mstarted\x1b[0m \x1b]52;c;ZXZpbA==\x07on\t8080\n")
    const s = await openSession(connect(local(m.runnerHome), m.deps.localRunner))
    const events: SessionEvent[] = []
    const done = await s.request("logs", RunnerReportSchema, { input: { app: "web", tail: 10 }, onEvent: (event) => events.push(event) })
    expect(done).toEqual({ outcome: "ok" })
    expect(events).toEqual([{ event: "log", service: "web", time: "2026-11-13T16:56:04.136118801Z", line: "started on      8080" }])
    expect(await s.close()).toBe(0)
  })

  test("closing a session while it follows logs lets the runner stop Docker's log command and exit", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    m.docker.logs("web", "web-1     | 2026-11-13T16:56:04.136118801Z started\n", { follow: true })
    const s = await openSession(connect(local(m.runnerHome), m.deps.localRunner))
    const events: SessionEvent[] = []
    const following = s
      .request("logs", RunnerReportSchema, { input: { app: "web", tail: 10 }, onEvent: (event) => events.push(event) })
      .catch((error: unknown) => error)
    await waitFor(() => events.length === 1 && m.docker.logsPid() !== undefined, "the first log line")
    const docker = m.docker.logsPid()!
    expect(await s.close()).toBe(0)
    expect(String(await following)).toContain(ENDED)
    await waitFor(() => !isAlive(docker), "Docker's log command to stop")
  })
})

describe("what the runner sends is checked", () => {
  test("a line that is not a frame ends the session with \"the runner did not answer as expected\"", async () => {
    for (const answer of [
      say("not json"),
      say({ result: { outcome: "ok" }, extra: true }),
      say({ outcome: "ok" }),
      // An event that does not belong to this request.
      say({ event: "log", service: "web", time: "2026-11-13T16:56:04Z", line: "x" }),
      // A result that is not the message asked for.
      say({ result: { version: "0.2.0" } }),
    ]) {
      const s = await openSession(connect(local(), scripted(say({ result: VERSION }), answer)))
      expect(s.mode).toBe("session")
      await expect(s.request("status", RunnerStatusSchema)).rejects.toThrow(UNEXPECTED)
      await expect(s.request("version", RunnerVersionSchema)).rejects.toThrow(ENDED)
      await s.close()
    }
  })

  test("a line is read up to the message size limit and no further", async () => {
    const huge = `head -c ${LIMITS.messageBytes + 1} /dev/zero`
    const s = await openSession(connect(local(), scripted(say({ result: VERSION }), huge)))
    await expect(s.request("status", RunnerStatusSchema)).rejects.toThrow(TOO_LARGE)
    await expect(s.request("status", RunnerStatusSchema)).rejects.toThrow(ENDED)
    await s.close()
    // Also when it is the very first thing the runner sends.
    await expect(openSession(connect(local(), scripted(huge)))).rejects.toThrow(TOO_LARGE)
  })

  test("a runner that dies in the middle of a request is reported, and the deploy stays recorded as sent", async () => {
    const m = await ready()
    const log = join(m.project, "starts.log")
    m.deps.localRunner = counted(log, m.docker.path)
    m.docker.holdUp()
    const pending = sendDeploy(m.deps, await prepareDeploy(m.deps, { app: "web", server: "dev" }))
    await waitFor(() => m.docker.upStarted(), "Docker to start")
    process.kill(starts(log)[0]!.pid, "SIGKILL")
    await expect(pending).rejects.toThrow(ENDED)
    m.docker.releaseUp()
    const history = JSON.parse(readFileSync(join(m.home, `history/${serverIdOf(m.home)}/web.json`), "utf8"))
    expect(history.map((entry: { outcome: string }) => entry.outcome)).toEqual(["sent"])
  })

  test("nothing, or no runner at all, is an error rather than a hang", async () => {
    await expect(openSession(connect(local(), ["/nonexistent/zekno-runner"]))).rejects.toThrow("Could not start")
    await expect(openSession(connect(local(), ["sh", "-c", "exit 0"]))).rejects.toThrow(UNEXPECTED)
    // Only status 2 means "a runner without sessions"; anything else, such as SSH failing, is not tried again.
    await expect(openSession(connect(local(), ["sh", "-c", "exit 255"]))).rejects.toThrow(UNEXPECTED)
  })

  test("what the runner writes on standard error is passed on cleaned", async () => {
    const written: string[] = []
    const spy = spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      written.push(String(chunk))
      return true
    }) as never)
    try {
      const noisy = ["sh", "-c", `printf 'one \\033]52;c;ZXZpbA==\\007two\\033[2J\\n\\033]8;;https://evil\\033\\\\three' >&2; exit 2`]
      const s = await openSession(connect(local(), noisy))
      expect(s.mode).toBe("one-shot")
      await waitFor(() => written.join("").includes("three"), "standard error to be passed on")
    } finally {
      spy.mockRestore()
    }
    expect(written.join("")).toBe("one two\nthree\n")
  })
})

describe("a runner that does not speak sessions gets the one-shot commands", () => {
  /** A feature 003 runner: `session` is not one of its commands, so it exits with status 2. */
  const older = (log: string, docker: string) => [
    "sh",
    "-c",
    `for word; do :; done; echo "$$ $word" >> "$0"; if [ "$word" = session ]; then echo 'Usage: zekno-runner <setup|sync|apply|status>' >&2; exit 2; fi; exec "$@"`,
    log,
    "env",
    `ZEKNO_DOCKER=${docker}`,
    process.execPath,
    RUNNER_MAIN,
  ]

  test("a runner that exits with status 2 for `session` is used one command at a time, and the session says so", async () => {
    const m = await ready()
    const log = join(m.project, "starts.log")
    const s = await openSession(connect(local(m.runnerHome), older(log, m.docker.path)))
    expect(s.mode).toBe("one-shot")
    expect(s.runner).toBeUndefined()
    expect((await s.request("status", RunnerStatusSchema)).serverId).toBe(serverIdOf(m.home))
    // State and logs exist only in a session.
    await expect(s.request("state", RunnerAppStatesSchema)).rejects.toThrow(TOO_OLD)
    await expect(s.request("logs", RunnerReportSchema, { input: { app: "web", tail: 1 } })).rejects.toThrow(TOO_OLD)
    await expect(s.request("version", RunnerVersionSchema)).rejects.toThrow(TOO_OLD)
    expect(await s.close()).toBeUndefined()
    expect(words(log)).toEqual(["session", "status"])

    // Deploys work exactly as they did with that runner, and the operation reports how it got there.
    m.deps.localRunner = older(log, m.docker.path)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with 0 secret(s).")
    const result = await sendDeploy(m.deps, await prepareDeploy(m.deps, { app: "web", server: "dev" }))
    expect(result).toMatchObject({ outcome: "started", sequence: 2, mode: "one-shot" })
    expect(words(log).slice(2)).toEqual(["session", "status", "apply", "session", "status", "apply"])
  })

  test("something that answers only once its input closes is given the one-shot commands", async () => {
    const m = await ready()
    const real = await runner(m.runnerHome, m.docker.path, "status")
    const answering = ["sh", "-c", `cat >/dev/null; printf '%s\\n' '${JSON.stringify(real.json)}'`]
    const s = await openSession({ ...connect(local(m.runnerHome), answering), firstAnswerMs: 50 })
    expect(s.mode).toBe("one-shot")
    expect(await s.request("status", RunnerStatusSchema)).toEqual(real.json as never)
  })

  test("a runner that speaks sessions but is slow to start is started once more and given as long as it needs", async () => {
    const m = await ready()
    const log = join(m.project, "starts.log")
    const s = await openSession({ ...connect(local(m.runnerHome), counted(log, m.docker.path, "sleep 0.3;")), firstAnswerMs: 100 })
    expect(s.mode).toBe("session")
    expect((await s.request("status", RunnerStatusSchema)).serverId).toBe(serverIdOf(m.home))
    expect(await s.close()).toBe(0)
    expect(words(log)).toEqual(["session", "session"])
  })

  test("only a runner on this machine has a limit on its first answer", () => {
    expect(connect(local(), []).firstAnswerMs).toBe(LOCAL_FIRST_ANSWER_MS)
    expect(connect({ kind: "ssh", destination: "me@example.test", runnerPath: "zekno-runner" }, []).firstAnswerMs).toBeUndefined()
  })
})

describe("one command, one runner process (FR-034)", () => {
  test("`server add`, `deploy`, `status` and `rollback` each start the runner on this machine once", async () => {
    const m = machine()
    const log = join(m.project, "starts.log")
    m.deps.localRunner = counted(log, m.docker.path)
    // This test is about requests sharing a process. A first answer that is
    // late on a busy machine costs one more process and nothing else, so the
    // runner is given as long as it needs here.
    m.deps.connect = (target, localRunner): Transport => ({ ...connect(target, localRunner), firstAnswerMs: undefined })
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    m.compose(COMPOSE_V1)
    const commands = [["server", "add", "dev", "--local"], ["deploy", ...where], ["status", "--server", "dev"], ["deploy", ...where], ["rollback", ...where]]
    for (const command of commands) {
      const before = words(log).length
      expect(await m.zekno(...command)).toBe(0)
      expect(words(log).slice(before)).toEqual(["session"])
    }
    expect(m.lastOut()).toBe("Deploy 3 of web is running on dev with 0 secret(s).")
  })

  test("over SSH, each command opens one connection: the destination after `--`, and only the runner path and a fixed word as the remote command", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const dir = tempDir("ssh")
    const sshLog = join(dir, "ssh.log")
    const wrapper = join(dir, "zekno-runner")
    writeFileSync(
      wrapper,
      `#!/bin/sh\nexec env ZEKNO_RUNNER_HOME="${join(dir, "runner-home")}" ZEKNO_DOCKER="${m.docker.path}" "${process.execPath}" "${RUNNER_MAIN}" "$@"\n`
    )
    chmodSync(wrapper, 0o755)
    // A stand-in for ssh: notes how it was called, then runs the remote command with a shell, as the server would.
    const fakeSsh = join(dir, "ssh")
    writeFileSync(fakeSsh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${sshLog}"\n[ "$1" = "--" ] || exit 255\nexec sh -c "$3"\n`)
    chmodSync(fakeSsh, 0o755)
    const calls = () => (existsSync(sshLog) ? readFileSync(sshLog, "utf8").trim().split("\n") : [])

    const spawn = Bun.spawn
    const spy = spyOn(Bun, "spawn").mockImplementation(((argv: string[], options: never) =>
      spawn(argv[0] === "ssh" ? [fakeSsh, ...argv.slice(1)] : argv, options)) as never)
    try {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test", "--runner-path", wrapper)).toBe(0)
      expect(calls()).toEqual([`-- deploy@example.test ${wrapper} session`])
      m.compose(COMPOSE_V2)
      expect(await m.zekno("deploy", "--app", "web", "--server", "prod")).toBe(0)
      expect(m.lastOut()).toBe("Deploy 1 of web is running on prod with 0 secret(s).")
      expect(await m.zekno("status", "--server", "prod")).toBe(0)
      expect(calls()).toEqual(Array(3).fill(`-- deploy@example.test ${wrapper} session`))
    } finally {
      spy.mockRestore()
    }
  })
})
