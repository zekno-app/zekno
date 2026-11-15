/**
 * User Story 3, the CLI's side: whether each app is running, on Home, on the
 * app screen and in `zekno status`; and an app's logs, on the logs screen
 * and in `zekno logs` (tasks T038 to T042).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { SESSION_FRAME_BYTES } from "@workspace/core"
import { renderToString, Static } from "ink"
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import { filesUnder, isAlive, residentMiB, runner, RUNNER_MAIN, tempDir, waitFor } from "../../../runner/test/support/helpers"
import { AppView, createStore } from "../../src/app/app"
import { LOG_BATCH_MS } from "../../src/app/effects/batcher"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import { acceptedFor, needsAnswer, noAnswer, statesFor, type Timing } from "../../src/app/effects/servers"
import type { Terminal } from "../../src/app/hand-over"
import type { AppKey } from "../../src/app/keys"
import { logRows, logsHints, STRAIGHT, STRAIGHT_HERE } from "../../src/app/screens/logs"
import type { AppEvent } from "../../src/app/state/events"
import { visibleLines } from "../../src/app/state/logs"
import { refreshAllowed, top } from "../../src/app/state/reading"
import { initialState, update } from "../../src/app/state/state"
import { LOG_LINES, LOG_TEXT_KEPT, type LogLine, type State, type TeamView } from "../../src/app/state/types"
import { logClock } from "../../src/shared/time"
import type { DeployRow } from "../../src/shared/views"
import { parseTail } from "../../src/commands/logs"
import { stateCell } from "../../src/commands/status"
import { openTeam, type OpDeps } from "../../src/cli/context"
import { followLogs, logsDropped, logsTooOld, prepareLogs } from "../../src/ops/logs"
import { readStatus, runStateOf, stateOf, type ServiceState } from "../../src/ops/status"
import { TOO_LARGE } from "../../src/server/session"
import { connect } from "../../src/server/transport"
import { inkUi } from "../../src/ui/ink/ink"
import { LogItem } from "../../src/ui/ink/lines"
import { COMPOSE_V1, machine, ready } from "../support/helpers"
import { withSsh } from "../support/stand-in-server"

type Machine = ReturnType<typeof machine>

// ---------------------------------------------------------------------------
// Helpers

const play = (state: State, ...events: AppEvent[]) => events.reduce((current, event) => update(current, event).state, state)
const effectsOf = (state: State, event: AppEvent) => update(state, event).effects
const key = (k: AppKey): AppEvent => ({ type: "key", key: k })
const text = (value: string): AppEvent => key({ kind: "text", text: value })
const K = { up: key({ kind: "up" }), down: key({ kind: "down" }), enter: key({ kind: "enter" }), esc: key({ kind: "escape" }), right: key({ kind: "right" }) }
const typing = (value: string): AppEvent[] => [...value].map(text)

const draw = (state: State, columns = 100, rows = 30) => renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns })
const lastLine = (screen: string) => screen.split("\n").filter((line) => line.trim() !== "").at(-1)!.trim()
/** Nothing is drawn past the window. */
function fits(screen: string, columns: number, rows: number) {
  const lines = screen.split("\n")
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns)
}

/** One row of `docker compose ps --format json`, with the fields the runner reads. */
const psRow = (service: string, state: string, exitCode = 0) => JSON.stringify({ Service: service, State: state, ExitCode: exitCode, Health: "", Labels: "x" })
const service = (name: string, state: ServiceState["state"]): ServiceState => ({ service: name, state, exitCode: 0, health: "" })

const TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [
        { name: "demo", deploy: 4, state: "unknown", outcome: "started", previous: 3 },
        { name: "api", deploy: 12, state: "unknown" },
        { name: "worker", deploy: 3, state: "unknown" },
      ],
    },
    { name: "staging", destination: "staging-box", reachable: true, apps: [{ name: "web", deploy: 7, state: "unknown" }] },
  ],
}
const SIZE = { columns: 100, rows: 30 }
const home = (size = SIZE) => play(initialState({ kind: "team", team: TEAM }, size), K.right)
/** A read of prod: what runs, and the last deploy of each app the runner accepted, as the runner said in the same read. */
const states = {
  type: "app-states",
  server: "prod",
  states: { demo: "running", api: "partly running", worker: "stopped" },
  accepted: { demo: 4, api: 12, worker: 3 },
} as const

const at = (second: number) => `2026-11-14T21:52:${String(second).padStart(2, "0")}Z`
const LINES: LogLine[] = [
  { time: at(3), service: "web", line: "started" },
  { time: at(4), service: "worker", line: "connected to the queue" },
  { time: at(9), service: "web", line: "GET /healthz 200 2ms" },
  { time: at(21), service: "worker", line: "job 1842 failed: connection refused, retry in 5s" },
  { time: at(29), service: "web", line: "GET /healthz 200 1ms" },
]
const onLogs = (lines = LINES) => play(home(), K.enter, text("l"), { type: "log-lines", lines, fresh: true })
const logsOf = (state: State) => {
  const screen = top(state)
  if (screen.name !== "logs") throw new Error(`the logs screen is not showing: ${screen.name}`)
  return screen
}
const shown = (state: State) => visibleLines(logsOf(state)).map((line) => line.line)

/** The effects of every app a test opened: closed after each test, so no runner a test reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/**
 * The app on a test machine, without a terminal unless one is given: the
 * reducer, the effects, and the window drawn on request. `events` holds
 * every event the effects sent, in order.
 */
function openApp(m: Machine, start: Awaited<ReturnType<typeof loadStart>>, terminal?: Terminal, deps: OpDeps = m.deps, timing?: Timing) {
  const failures: unknown[] = []
  const events: AppEvent[] = []
  let effects: Effects | undefined
  const store = createStore(initialState(start, SIZE), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  const dispatch = (event: AppEvent) => {
    events.push(event)
    store.dispatch(event)
  }
  effects = createEffects(deps, dispatch, (error) => failures.push(error), terminal, timing)
  opened.push(effects)
  return {
    store,
    effects,
    failures,
    events,
    get state() {
      return store.get()
    },
    press: (...keys: AppKey[]) => keys.forEach((k) => store.dispatch(key(k))),
    type: (value: string) => [...value].forEach((char) => store.dispatch(text(char))),
    draw: (columns = 100, rows = 30) => draw(store.get(), columns, rows),
    until: (ready: () => boolean, what: string, ms = 15_000) => waitFor(ready, what, ms),
  }
}

/**
 * Counts the runner's starts on a machine: each start is noted in a file.
 * A runner on this machine that is slow to give its first answer is started
 * once more (session.ts); these checks are about reads sharing or not
 * starting a process, so the runner is given as long as it needs.
 */
function counting(m: Machine) {
  const log = join(m.project, "starts.log")
  m.deps.localRunner = ["sh", "-c", 'echo start >> "$0"; exec "$@"', log, ...m.deps.localRunner]
  m.deps.connect = (target, localRunner, options) => ({ ...connect(target, localRunner, options), firstAnswerMs: undefined })
  return () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0)
}

/**
 * A runner that answers each request with the lines prepared for its
 * command, whatever they say: what a runner or server that lies can send.
 * Without lines for a command it ends the session.
 */
function lyingRunner(answers: Partial<Record<"version" | "status" | "state" | "logs", string>>): string[] {
  const dir = tempDir("liar")
  for (const [command, lines] of Object.entries(answers)) writeFileSync(join(dir, command), lines)
  const script = join(dir, "runner")
  writeFileSync(
    script,
    `#!/bin/sh
answer() { [ -f "${dir}/$1" ] || exit 0; cat "${dir}/$1"; }
while IFS= read -r line; do
  case "$line" in
    *'"command":"version"'*) answer version ;;
    *'"command":"status"'*) answer status ;;
    *'"command":"state"'*) answer state ;;
    *'"command":"logs"'*) answer logs; exit 0 ;;
  esac
done
`
  )
  chmodSync(script, 0o755)
  return ["sh", script]
}
const VERSION = `${JSON.stringify({ result: { version: "0.1.0", protocol: 2 } })}\n`
const frame = (value: unknown) => `${JSON.stringify(value)}\n`
const logEvent = (service: string, time: string, line: string) => frame({ event: "log", service, time, line })

/**
 * Makes Docker's log command print without pause, as a container that logs
 * in a loop does, and notes the process id of each runner started and of
 * Docker's log command in the folder it returns.
 */
function floodingLogs(m: Machine): string {
  const dir = tempDir("flood")
  const docker = join(dir, "docker")
  writeFileSync(
    docker,
    `#!/bin/sh\nif [ "$4" = logs ]; then echo $$ > "${dir}/logs.pid"; exec yes "web-1  | 2026-11-14T00:00:00Z ${"x".repeat(200)}"; fi\nexec "${m.docker.path}" "$@"\n`
  )
  chmodSync(docker, 0o755)
  m.deps.localRunner = ["sh", "-c", 'echo $$ >> "$0"; exec "$@"', join(dir, "runner.pids"), "env", `ZEKNO_DOCKER=${docker}`, process.execPath, RUNNER_MAIN]
  return dir
}

const LATE = "still running"

/** What `promise` gives, or `LATE` after `ms` milliseconds. */
const within = <T,>(promise: Promise<T>, ms: number): Promise<T | typeof LATE> => Promise.race([promise, Bun.sleep(ms).then(() => LATE as typeof LATE)])

/**
 * `zekno logs` as a process of its own, run as `main.ts` runs it when its
 * output is piped (logs-driver.ts), against a runner whose Docker prints
 * without pause. Its standard output is a pipe this test reads.
 */
function logsProcess() {
  const dir = tempDir("logs-process")
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../support/logs-driver.ts"), dir], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const errors = new Response(child.stderr).text()
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0
  const read = async () => {
    const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }))
    if (!chunk.done) bytes += chunk.value.length
    return chunk
  }
  const pidsIn = (file: string) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8").trim().split("\n").map(Number) : [])
  return {
    child,
    /** The first line it printed. */
    async firstLine(): Promise<string> {
      while (!text.includes("\n")) {
        const chunk = await read()
        if (chunk.done) throw new Error(`zekno logs ended before its first line: ${await errors}`)
        text += decoder.decode(chunk.value, { stream: true })
      }
      return text.split("\n")[0]!
    },
    /** Reads everything it prints, until it ends. */
    async drain(): Promise<void> {
      while (!(await read()).done) {
        // Counted in `received`.
      }
    },
    received: () => bytes,
    /** Closes this end of its standard output, as `head -1` does once it has its line. */
    closeOutput: () => reader.cancel(),
    /** The runners and the Docker log command it started that are still running. */
    left: () => [...pidsIn("runner.pids"), ...pidsIn("logs.pid")].filter(isAlive),
  }
}

/** What the real runner of a machine says it holds, as a frame: so a lying runner passes for the right server. */
async function realStatus(m: Machine): Promise<string> {
  const real = await runner(m.runnerHome, m.docker.path, "status")
  return frame({ result: real.json })
}

/** A machine with `apps` deployed to its runner on this machine. */
async function deployed(...apps: string[]) {
  const m = await ready()
  for (const app of apps) expect(await m.zekno("deploy", "--app", app, "--server", "dev")).toBe(0)
  m.out.length = 0
  return m
}

/** Every file under the profile folder (the runner's folder is inside it) and the project folder, with its content. */
const disk = (m: Machine) => [...filesUnder(m.home), ...filesUnder(m.project)]

// ---------------------------------------------------------------------------
// What is running

describe("whether an app is running (data-model.md)", () => {
  test("running when every service is, stopped when none is, partly running otherwise; no services at all is stopped", () => {
    expect(runStateOf([service("web", "running"), service("db", "running")])).toBe("running")
    expect(runStateOf([service("web", "exited"), service("db", "dead")])).toBe("stopped")
    expect(runStateOf([service("web", "running"), service("db", "restarting")])).toBe("partly running")
    expect(runStateOf([])).toBe("stopped")
  })

  test("unknown when the runner was not asked or left the app out; only the runner's own entries count", () => {
    expect(stateOf(undefined, "web")).toBe("unknown")
    expect(stateOf({}, "web")).toBe("unknown")
    expect(stateOf({ web: { services: [service("web", "running")] } }, "web")).toBe("running")
    // A name every object has by default is not an entry of the runner's.
    expect(stateOf({}, "constructor")).toBe("unknown")
    expect(statesFor(undefined)).toEqual({})
    expect(statesFor({ web: { services: [] }, api: { services: [service("api", "running")] } })).toEqual({ web: "stopped", api: "running" })
  })

  test("read with what the server holds, over one session: running, partly running, stopped, and unknown where Docker could not be asked", async () => {
    const m = await deployed("web", "api", "worker", "gone")
    m.docker.ps("web", `${psRow("web", "running")}\n${psRow("db", "running")}\n`)
    m.docker.ps("api", `${psRow("api", "running")}\n${psRow("db", "exited", 137)}\n`)
    m.docker.ps("worker", `${psRow("worker", "exited", 1)}\n`)
    // Docker fails for this one, and the runner leaves it out: not known, which is not stopped.
    m.docker.ps("gone", "", 1)
    const starts = counting(m)
    const team = await openTeam(m.deps)
    const result = await readStatus(m.deps, { team, server: team.profile.servers[0]! })
    expect(starts()).toBe(1)
    expect(Object.keys(result.status.lastSequence).sort()).toEqual(["api", "gone", "web", "worker"])
    expect(stateOf(result.states, "web")).toBe("running")
    expect(stateOf(result.states, "api")).toBe("partly running")
    expect(stateOf(result.states, "worker")).toBe("stopped")
    expect(stateOf(result.states, "gone")).toBe("unknown")
    expect(result.states?.api?.services).toEqual([service("api", "running"), { service: "db", state: "exited", exitCode: 137, health: "" }])
  })

  test("`zekno status` adds the state cell: plain words when piped, the board's ● and colour at a terminal; --json adds `apps`", async () => {
    const m = await deployed("web", "api", "worker")
    m.docker.ps("web", `${psRow("web", "running")}\n`)
    m.docker.ps("api", `${psRow("api", "running")}\n${psRow("db", "exited")}\n`)
    expect(await m.zekno("status", "--server", "dev")).toBe(0)
    // In Home's order: the latest deploy first.
    expect(m.out).toEqual(["dev: team list version 2", "worker\tdeploy 1\tstopped", "api\tdeploy 1\tpartly running", "web\tdeploy 1\trunning"])
    expect(m.err).toEqual([])

    m.out.length = 0
    expect(await m.zekno("status", "--server", "dev", "--json")).toBe(0)
    const json = JSON.parse(m.lastOut())
    expect(json.apps).toEqual({
      web: { state: "running", services: [service("web", "running")] },
      api: { state: "partly running", services: [service("api", "running"), service("db", "exited")] },
      worker: { state: "stopped", services: [] },
    })
    expect(json.lastSequence).toEqual({ web: 1, api: 1, worker: 1 })

    // At a terminal: the cell is drawn with its symbol, as on the board.
    let written = ""
    const stdout = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          written += String(chunk)
          done()
        },
      }),
      { columns: 100, rows: 40 }
    )
    const ui = inkUi({ stdout: stdout as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream })
    ui.table([
      ["web", "deploy 1", stateCell("running")],
      ["worker", "deploy 1", stateCell("stopped")],
    ])
    // A line from the server waits until it is drawn, and so everything before it is too.
    await ui.remote("end")
    await ui.close()
    const plain = written.replace(/\x1b\[[0-9;]*m/g, "")
    expect(plain).toMatch(/web +deploy 1 +● running/)
    expect(plain).toMatch(/worker +deploy 1 +● stopped/)
    // The colour goes with the symbol and the word, never instead of them.
    expect(stateCell("running")).toEqual({ text: "running", mark: "●", tone: "success" })
    expect(stateCell("stopped")).toEqual({ text: "stopped", mark: "●", tone: "danger" })
    expect(stateCell("partly running")).toEqual({ text: "partly running", mark: "●", tone: "warning" })
    expect(stateCell("unknown")).toEqual({ text: "unknown", mark: "●", tone: "quiet" })
  })

  test("a runner from before sessions is never asked: every state is unknown, and status still works", async () => {
    const m = await deployed("web")
    const real = m.deps.localRunner
    m.deps.localRunner = ["sh", "-c", 'for word; do :; done; [ "$word" = session ] && exit 2; exec "$@"', "sh", ...real]
    expect(await m.zekno("status", "--server", "dev")).toBe(0)
    expect(m.out).toEqual(["dev: team list version 2", "web\tdeploy 1\tunknown"])
  })

  test("a runner that lies about what is running: names that are not apps here, impossible exit codes, too many services", async () => {
    const m = await deployed("web")
    const status = await realStatus(m)
    const answer = async (state: unknown) => {
      m.deps.localRunner = lyingRunner({ version: VERSION, status, state: frame({ result: state }) })
      m.out.length = 0
      expect(await m.zekno("status", "--server", "dev")).toBe(0)
      return m.out[1]
    }
    // Apps this server never ran are not shown; the one it did is.
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, n) => [`other-${n}`, { services: [service("x", "running")] }]))
    expect(await answer({ apps: { ...many, web: { services: [service("web", "running")] } } })).toBe("web\tdeploy 1\trunning")
    // Anything outside the message's definition makes the whole answer unknown, never half-believed.
    expect(await answer({ apps: { web: { services: [{ ...service("web", "running"), exitCode: 99999 }] } } })).toBe("web\tdeploy 1\tunknown")
    expect(await answer({ apps: { web: { services: Array.from({ length: 257 }, (_, n) => service(`s${n}`, "running")) } } })).toBe("web\tdeploy 1\tunknown")
    expect(await answer({ apps: { web: { services: [service("\x1b[2Jweb", "running")] } } })).toBe("web\tdeploy 1\tunknown")
    expect(await answer({ apps: { web: { services: [{ ...service("web", "running"), state: "\x1b]52;c;ZXZpbA==\x07" }] } } })).toBe(
      "web\tdeploy 1\tunknown"
    )
    // The most services the definition allows are taken, and the state is still one word.
    expect(await answer({ apps: { web: { services: Array.from({ length: 256 }, (_, n) => service(`s${n}`, "running")) } } })).toBe("web\tdeploy 1\trunning")
    // A refusal for state leaves what the server holds as it was read.
    expect(await answer({ outcome: "refused", reason: "invalid_state" })).toBe("web\tdeploy 1\tunknown")
  })
})

describe("state on Home and the app screen (boards 'Home' and 'One app')", () => {
  test("each app's state by a word and a symbol, on Home at 100 and at 80 columns", () => {
    const state = play(home(), states)
    const screen = draw(state)
    expect(screen).toMatch(/❯ demo +4 +● running/)
    // The board's state column has no room for `● partly running` at 100 columns: it is cut at a word, never in one.
    expect(screen).toMatch(/ {3}api +12 +● partly +│/)
    expect(screen).not.toContain("● partly r")
    expect(screen).toMatch(/ {3}worker +3 +● stopped/)
    const narrow = draw(play(home({ columns: 80, rows: 24 }), states), 80, 24)
    expect(narrow).toMatch(/❯ demo +4 +● running/)
    expect(narrow).toMatch(/ {3}worker +3 +● stopped/)
    fits(narrow, 80, 24)
    // Another server's apps are not touched; an app the runner did not name is unknown.
    expect(play(home(), states).team?.servers[1]?.apps[0]?.state).toBe("unknown")
    expect(play(home(), { type: "app-states", server: "prod", states: { demo: "running" } }).team?.servers[0]?.apps.map((app) => app.state)).toEqual([
      "running",
      "unknown",
      "unknown",
    ])
  })

  test("a server that cannot be reached has every app's state unknown; its history, read again, keeps the last known state", () => {
    const known = play(home(), states)
    const gone = play(known, { type: "server-reached", server: "prod", reachable: false, problem: "no route" })
    expect(gone.team?.servers[0]?.apps.map((app) => app.state)).toEqual(["unknown", "unknown", "unknown"])
    expect(draw(gone)).toMatch(/❯ demo +4 +● unknown/)
    const reread = play(known, { type: "server-apps", server: "prod", apps: TEAM.servers[0]!.apps })
    expect(reread.team?.servers[0]?.apps.map((app) => app.state)).toEqual(["running", "partly running", "stopped"])
  })

  test("the app screen: the state in its header, and `● running now` on the deploy that runs, only while it runs", () => {
    const opened = play(home(), states, K.enter, {
      type: "app-view",
      server: "prod",
      app: "demo",
      deploys: [
        { sequence: 5, outcome: "sent", at: at(50) },
        { sequence: 4, outcome: "started", at: at(40) },
        { sequence: 3, outcome: "started", at: at(30), rollbackTo: 1 },
      ],
      secrets: [],
    })
    const screen = draw(opened)
    expect(screen.split("\n")[2]!.trimEnd()).toMatch(/● running deploy 4$/)
    expect(screen).toMatch(/4 +● running now/)
    expect(screen).toMatch(/5 +! no answer recorded/)
    expect(screen).toMatch(/3 +✔ started, a rollback to 1/)
    const stopped = draw(play(opened, { type: "app-states", server: "prod", states: { demo: "stopped" }, accepted: { demo: 4 } }))
    expect(stopped.split("\n")[2]!.trimEnd()).toMatch(/● stopped deploy 4$/)
    expect(stopped).not.toContain("running now")
    expect(stopped).toMatch(/4 +✔ started/)
    fits(draw(update(opened, { type: "resize", columns: 80, rows: 24 }).state, 80, 24), 80, 24)
  })

  test("`● running now` and the deploy numbers come from what the runner said: a latest deploy that did not start runs nothing (L5)", () => {
    const appScreen = (deploys: DeployRow[], accepted: Record<string, number> | undefined) =>
      draw(
        play(home(), K.enter, { type: "app-view", server: "prod", app: "demo", deploys, secrets: [] }, {
          type: "app-states",
          server: "prod",
          states: { demo: "running" },
          accepted,
        })
      )
    // `up` for deploy 4 failed; the runner accepted it, so it holds 4, and the containers that run are not deploy 4's.
    const failed = appScreen(
      [
        { sequence: 4, outcome: "start_failed", at: at(40) },
        { sequence: 3, outcome: "started", at: at(30) },
      ],
      { demo: 4 }
    )
    expect(failed).not.toContain("running now")
    expect(failed).toMatch(/4 +✖ did not start/)
    expect(failed).toMatch(/3 +✔ started/)
    expect(failed.split("\n")[2]!.trimEnd()).toMatch(/● running deploy 4$/)
    // Deploy 5 never reached the runner, which still holds 4: 4 is the one running now.
    const unsent = appScreen(
      [
        { sequence: 5, outcome: "sent", at: at(50) },
        { sequence: 4, outcome: "started", at: at(40) },
      ],
      { demo: 4 }
    )
    expect(unsent).toMatch(/4 +● running now/)
    expect(unsent).toMatch(/5 +! no answer recorded/)
    // The runner holds a deploy this machine did not send: none of these is running now, and the header says which it holds.
    const elsewhere = appScreen([{ sequence: 4, outcome: "started", at: at(40) }], { demo: 6 })
    expect(elsewhere).not.toContain("running now")
    expect(elsewhere.split("\n")[2]!.trimEnd()).toMatch(/● running deploy 6$/)
    // Before the runner has said which deploy it holds, nothing is marked.
    expect(appScreen([{ sequence: 4, outcome: "started", at: at(40) }], undefined)).not.toContain("running now")

    // Home: the deploy column is the runner's number once it has said, and this machine's again once the server cannot be reached.
    const read = play(home(), { ...states, accepted: { demo: 6, api: 12, worker: 3 } })
    expect(draw(read)).toMatch(/❯ demo +6 +● running/)
    const lost = play(read, { type: "server-reached", server: "prod", reachable: false, problem: "no route" })
    expect(draw(lost)).toMatch(/❯ demo +4 +● unknown/)
    // A deploy from the app that the runner accepted is its number at once, whether or not the app started.
    const deployedNow = play(
      read,
      { type: "deploy-started", server: "prod", app: "demo", at: 0 },
      { type: "deploy-stage", stage: "checked", sequence: 7, secrets: 0 },
      { type: "deploy-ended", outcome: "start_failed", notice: { tone: "error", text: "x" }, at: 1 }
    )
    expect(deployedNow.team?.servers[0]?.apps[0]?.accepted).toBe(7)
  })

  test("every 5 seconds Home reads every server and the app screen its own; never with a question open, nor on another screen", () => {
    expect(effectsOf(home(), { type: "tick" })).toEqual([{ kind: "refresh" }])
    const onApp = play(home(), K.enter)
    expect(effectsOf(onApp, { type: "tick" })).toEqual([{ kind: "refresh", server: "prod" }])
    // A question on the app screen, the hidden prompt, a text question, and other screens.
    const asking = play(onApp, { type: "app-view", server: "prod", app: "demo", deploys: [], secrets: [{ name: "A", version: 1, removed: false }] }, key({ kind: "tab" }), text("x"))
    expect(asking.question?.kind).toBe("remove-secret")
    const prompting = play(onApp, text("s"), ...typing("API_KEY"), K.enter)
    const naming = play(onApp, text("s"))
    const outdated = play(initialState({ kind: "team", team: { ...TEAM, servers: [{ ...TEAM.servers[0]!, runner: { version: "0.1.0", relation: "older", missing: "nothing" } }] } }, SIZE), text("u"))
    expect(outdated.question?.kind).toBe("update-runner")
    const filtering = play(onLogs(), text("/"))
    const small = update(home(), { type: "resize", columns: 70, rows: 20 }).state
    for (const state of [asking, prompting, naming, outdated, filtering, onLogs(), play(home(), text("?")), play(home(), text("a")), small]) {
      expect(refreshAllowed(state)).toBe(false)
      expect(update(state, { type: "tick" })).toEqual({ state, effects: [] })
    }
  })
})

// ---------------------------------------------------------------------------
// The logs screen

describe("the logs screen (board 'Live logs')", () => {
  test("time, service and text, following, and the line saying the logs do not pass through Zekno", () => {
    const screen = draw(onLogs())
    const lines = screen.split("\n")
    expect(lines[2]).toContain("› prod › demo › logs")
    expect(lines[2]!.trimEnd()).toMatch(/all services {2}● following$/)
    expect(screen).toContain(`${logClock(at(3))}  web     started`)
    expect(screen).toContain(`${logClock(at(21))}  worker  job 1842 failed: connection refused, retry in 5s`)
    expect(screen).toContain(STRAIGHT)
    expect(lastLine(screen)).toBe("f pause following  / filter  1-9 one service  ↑↓ scroll  esc back")
    fits(screen, 100, 30)
    // A runner on this machine is not reached over SSH, and the line says so.
    const local = play(initialState({ kind: "team", team: { ...TEAM, servers: [{ ...TEAM.servers[0]!, destination: undefined }] } }, SIZE), K.right, text("l"))
    expect(draw(local)).toContain(STRAIGHT_HERE)
    expect(draw(local)).toContain("No lines yet.")
  })

  test("a time is shown in this machine's zone, a time it cannot place by its own digits", () => {
    const local = new Date(2026, 10, 14, 9, 5, 7)
    expect(logClock(local.toISOString())).toBe("09:05:07")
    expect(logClock("2026-11-14T21:52:03.123456789Z")).toBe(logClock("2026-11-14T21:52:03Z"))
    expect(logClock("2026-13-45T21:52:03Z")).toBe("21:52:03")
    expect(logClock("yesterday")).toBe("--:--:--")
  })

  test("f pauses where the view is: new lines are kept but do not move it; f again goes back to the newest", () => {
    const paused = play(onLogs(), text("f"))
    expect(logsOf(paused).following).toBe(false)
    expect(draw(paused).split("\n")[2]!.trimEnd()).toMatch(/● paused$/)
    expect(lastLine(draw(paused))).toBe("f resume following  / filter  1-9 one service  ↑↓ scroll  esc back")
    const more = play(paused, { type: "log-lines", lines: [{ time: at(40), service: "web", line: "new while paused" }] })
    expect(logsOf(more).lines).toHaveLength(6)
    expect(logsOf(more).scroll).toBe(1)
    expect(draw(more)).not.toContain("new while paused")
    const resumed = play(more, text("f"))
    expect(logsOf(resumed).scroll).toBe(0)
    expect(draw(resumed)).toContain("new while paused")
  })

  test("while following at the newest line, new lines move the view; scrolled back, the view stays", () => {
    const following = play(onLogs(), { type: "log-lines", lines: [{ time: at(40), service: "web", line: "next" }] })
    expect(logsOf(following).scroll).toBe(0)
    const back = play(onLogs(), K.up, K.up, { type: "log-lines", lines: [{ time: at(40), service: "web", line: "next" }] })
    expect(logsOf(back).scroll).toBe(3)
    expect(logsOf(play(back, K.down, K.down, K.down, K.down)).scroll).toBe(0)
  })

  test("at most 2000 lines are kept, paused or not; past that the oldest go, and a paused view shows the oldest kept", () => {
    const flood = (from: number, count: number): LogLine[] => Array.from({ length: count }, (_, n) => ({ time: at(1), service: "web", line: `line ${from + n}` }))
    const full = play(onLogs([]), { type: "log-lines", lines: flood(0, LOG_LINES + 500) })
    expect(logsOf(full).lines).toHaveLength(LOG_LINES)
    expect(logsOf(full).lines[0]!.line).toBe("line 500")
    const paused = play(full, text("f"), { type: "log-lines", lines: flood(LOG_LINES + 500, LOG_LINES) })
    const screen = logsOf(paused)
    expect(screen.lines).toHaveLength(LOG_LINES)
    expect(screen.lines[0]!.line).toBe(`line ${LOG_LINES + 500}`)
    // The view held its place until the lines it showed were let go; now it is at the oldest kept.
    expect(screen.scroll).toBe(LOG_LINES - 1)
    const drawn = draw(paused)
    expect(drawn).toContain(`line ${LOG_LINES + 500}`)
    expect(drawn).not.toContain(`line ${2 * LOG_LINES + 499}`)
  })

  test("/ filters by plain text, whatever the case, never as a pattern; esc clears it", () => {
    const lines: LogLine[] = [
      ...LINES,
      { time: at(30), service: "web", line: "GET /a.b 200" },
      { time: at(31), service: "web", line: "GET /aXb 200" },
      { time: at(32), service: "web", line: "price $5 (net)" },
    ]
    const filter = (value: string) => shown(play(onLogs(lines), text("/"), ...typing(value), K.enter))
    expect(filter("FAILED")).toEqual(["job 1842 failed: connection refused, retry in 5s"])
    expect(filter("a.b")).toEqual(["GET /a.b 200"])
    expect(filter("$5 (")).toEqual(["price $5 (net)"])
    expect(filter(".*")).toEqual([])
    expect(filter("[")).toEqual([])
    const typed = play(onLogs(lines), text("/"), ...typing("healthz"))
    expect(draw(typed)).toContain("? Filter › healthz")
    expect(lastLine(draw(typed))).toBe("enter keep  esc clear")
    const kept = play(typed, K.enter)
    expect(draw(kept)).toContain("filter › healthz")
    expect(shown(kept)).toEqual(["GET /healthz 200 2ms", "GET /healthz 200 1ms"])
    expect(shown(play(kept, text("/"), K.esc))).toHaveLength(lines.length)
    expect(draw(play(onLogs(lines), text("/"), ...typing("nothing like it"), K.enter))).toContain("No line matches.")
  })

  test("1–9 show one service, in the order they appeared, 0 all of them; the header names the one shown", () => {
    const web = play(onLogs(), text("1"))
    expect(new Set(visibleLines(logsOf(web)).map((line) => line.service))).toEqual(new Set(["web"]))
    expect(draw(web).split("\n")[2]!.trimEnd()).toMatch(/web {2}● following$/)
    expect(draw(web)).not.toContain("connected to the queue")
    expect(shown(play(onLogs(), text("2")))).toEqual(["connected to the queue", "job 1842 failed: connection refused, retry in 5s"])
    expect(shown(play(onLogs(), text("2"), text("0")))).toHaveLength(LINES.length)
  })

  test("a line is one row, cut at the edge of the box; nothing a server sends moves the layout, at 100 or at 80 columns", () => {
    const long: LogLine[] = [
      { time: at(1), service: "a".repeat(63), line: "x".repeat(LOG_TEXT_KEPT) },
      { time: at(2), service: "web", line: "宽".repeat(3000) },
      ...Array.from({ length: 60 }, (_, n) => ({ time: at(3), service: "web", line: `filler ${n}` })),
    ]
    for (const [columns, rows] of [
      [100, 30],
      [80, 24],
    ] as const) {
      const state = update(onLogs(long), { type: "resize", columns, rows }).state
      const screen = draw(state, columns, rows)
      fits(screen, columns, rows)
      expect(lastLine(screen)).toBe("f pause following  / filter  1-9 one service  ↑↓ scroll  esc back")
      // Scrolled back to the oldest, the long lines are drawn on one row each, cut.
      const back = draw(play(state, ...Array.from({ length: 70 }, () => K.up)), columns, rows)
      fits(back, columns, rows)
      expect(back).toContain("aaaaaaaaaaaaaaa…")
      expect(back).toContain("…")
    }
    // The rows for log lines leave room for everything else on the screen.
    expect(logRows(24, 1, false, 1)).toBe(13)
    expect(logRows(24, 2, true, 2)).toBe(9)
  })

  test("when the logs stop coming, the screen says why and enter reconnects; the first lines of the new connection replace the old", () => {
    const dropped = play(onLogs(), { type: "logs-dropped", problem: "The connection to prod ended." })
    const screen = draw(dropped)
    expect(screen.split("\n")[2]!.trimEnd()).toMatch(/✖ disconnected$/)
    expect(screen).toContain("✖ The connection to prod ended.")
    expect(lastLine(screen)).toBe("enter reconnect  f pause following  / filter  1-9 one service  ↑↓ scroll  esc back")
    expect(logsHints(logsOf(dropped))[0]).toEqual(["enter", "reconnect"])
    fits(draw(update(dropped, { type: "resize", columns: 80, rows: 24 }).state, 80, 24), 80, 24)
    const again = update(dropped, K.enter)
    expect(again.effects).toEqual([{ kind: "logs", server: "prod", app: "demo" }])
    expect(logsOf(again.state)).toMatchObject({ dropped: false, problem: undefined, lines: LINES })
    const fresh = play(again.state, { type: "log-lines", lines: [{ time: at(59), service: "web", line: "after" }], fresh: true })
    expect(shown(fresh)).toEqual(["after"])
    // Enter does nothing while connected.
    expect(update(onLogs(), K.enter)).toEqual({ state: onLogs(), effects: [] })
  })
})

// ---------------------------------------------------------------------------
// Against a real runner process with the stand-in Docker

describe("logs from the app, against a real runner", () => {
  test("lines arrive as plain text; leaving stops Docker's log command; nothing is written to disk", async () => {
    const m = await deployed("demo")
    m.docker.logs(
      "demo",
      "web-1  | 2026-11-14T21:52:03.000000001Z \x1b[2J\x1b]52;c;ZXZpbA==\x07started\there\x1b[31m red\x1b[0m\n" +
        "worker-1  | 2026-11-14T21:52:04Z \x1b]8;;https://evil.example\x07click\x1b]8;;\x07 ‮eman\n",
      { follow: true }
    )
    const before = disk(m)
    const app = openApp(m, await loadStart(m.deps))
    app.press({ kind: "right" })
    app.type("l")
    await app.until(() => logsOf(app.state).lines.length === 2, "two log lines")
    const lines = logsOf(app.state).lines
    expect(lines.map((line) => [line.service, line.line])).toEqual([
      ["web", "started here red"],
      ["worker", "click eman"],
    ])
    const screen = app.draw()
    expect(screen).not.toContain("\x1b")
    expect(screen).not.toContain("‮")
    expect(screen).toContain("started here red")
    await app.until(() => m.docker.logsPid() !== undefined, "Docker's log command")
    const pid = m.docker.logsPid()!
    expect(isAlive(pid)).toBe(true)

    const pressed = app.events.length
    app.press({ kind: "escape" })
    expect(top(app.state).name).toBe("home")
    await app.until(() => !isAlive(pid), "Docker's log command to stop")
    expect(app.failures).toEqual([])
    // Lines of a session that was let go never reach the screen: no batch of them is handed on after esc.
    await Bun.sleep(LOG_BATCH_MS * 3)
    expect(app.events.slice(pressed).filter((event) => event.type === "log-lines")).toEqual([])
    expect(disk(m)).toEqual(before)
    const tail = m.docker.inspections().find((call) => call.args.includes("logs"))!
    expect(tail.args).toContain("logs --follow --timestamps --no-color --tail 200")
  })

  test("a runner that sends lines without pause: a key is taken at once, esc lets the logs go and q quits (L1)", async () => {
    const m = await deployed("demo")
    const flood = floodingLogs(m)
    const app = openApp(m, await loadStart(m.deps))
    app.press({ kind: "right" })
    app.type("l")
    await app.until(() => logsOf(app.state).lines.length > 0, "the first lines")
    // A key reaches the app as an event on the loop, as a timer does: a timer every 10 ms may not fire late while the lines pour in.
    let last = performance.now()
    let late = 0
    const timer = setInterval(() => {
      const now = performance.now()
      late = Math.max(late, now - last)
      last = now
    }, 10)
    await Bun.sleep(600)
    clearInterval(timer)
    expect(late).toBeLessThan(100)
    const shown = () => app.events.flatMap((event) => (event.type === "log-lines" ? event.lines : [])).length
    expect(shown()).toBeGreaterThan(LOG_LINES)
    expect(logsOf(app.state).lines.length).toBeLessThanOrEqual(LOG_LINES)

    // esc, pressed in the middle of it, is taken at once, and the runner stops Docker's log command and exits.
    const asked = performance.now()
    const taken = await new Promise<number>((resolve) =>
      setTimeout(() => {
        app.press({ kind: "escape" })
        resolve(performance.now())
      }, 20)
    )
    expect(taken - asked).toBeLessThan(120)
    expect(top(app.state).name).toBe("home")
    const pressed = app.events.length
    const docker = Number(readFileSync(join(flood, "logs.pid"), "utf8"))
    const runners = readFileSync(join(flood, "runner.pids"), "utf8").trim().split("\n").map(Number)
    await app.until(() => !isAlive(docker) && runners.every((pid) => !isAlive(pid)), "Docker's log command and the runner to stop", 2000)
    await Bun.sleep(LOG_BATCH_MS * 3)
    expect(app.events.slice(pressed).filter((event) => event.type === "log-lines")).toEqual([])
    app.type("q")
    expect(app.state.exiting).toBe(true)
    expect(app.failures).toEqual([])
  })

  test("leaving the logs before the runner has answered stops the connection at once, whatever it was waiting for (L4)", async () => {
    const m = await deployed("demo")
    const plan = await prepareLogs(m.deps, { app: "demo", server: "dev" })
    const dir = tempDir("silent")
    const version = JSON.stringify({ result: { version: "0.1.0", protocol: 2 } })
    // One that never answers at all, as SSH still connecting or asking; one that answers its version and never `status`.
    for (const [label, script] of [
      ["nothing", 'echo $$ > "$0"; exec sleep 30'],
      ["no status", `echo $$ > "$0"; read -r line; printf '%s\\n' '${version}'; exec sleep 30`],
    ] as const) {
      const pidFile = join(dir, label.replace(" ", "-"))
      m.deps.localRunner = ["sh", "-c", script, pidFile]
      const stop = new AbortController()
      const reading = followLogs(m.deps, plan, { tail: 10, follow: true, stop: stop.signal }, () => {})
      await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", "the runner to start")
      const pid = Number(readFileSync(pidFile, "utf8"))
      // Long enough for the version to have been answered, and before a runner on this machine counts as slow.
      await Bun.sleep(150)
      const left = Date.now()
      stop.abort()
      expect(await reading).toBe("stopped")
      await waitFor(() => !isAlive(pid), `the runner that answered ${label} to be stopped`, 1000)
      expect(Date.now() - left).toBeLessThan(1000)
    }
  })

  test("when Docker stops sending, the screen says so; enter reads them again, and the new lines replace the old", async () => {
    const m = await deployed("demo")
    m.docker.logs("demo", "web-1  | 2026-11-14T21:52:03Z first\n")
    const app = openApp(m, await loadStart(m.deps))
    app.press({ kind: "right" })
    app.type("l")
    await app.until(() => logsOf(app.state).dropped, "the logs to stop")
    expect(logsOf(app.state).problem).toBe("Docker stopped sending the logs of demo.")
    expect(logsOf(app.state).lines.map((line) => line.line)).toEqual(["first"])
    m.docker.logs("demo", "web-1  | 2026-11-14T21:52:03Z first\nweb-1  | 2026-11-14T21:52:05Z second\n")
    app.press({ kind: "enter" })
    await app.until(() => logsOf(app.state).lines.length === 2, "the logs read again")
    expect(logsOf(app.state).lines.map((line) => line.line)).toEqual(["first", "second"])
    expect(app.failures).toEqual([])
  })

  test("a runner that lies in its log events: what breaks the definition ends the logs with a sentence; a dropped connection says so", async () => {
    const m = await deployed("demo")
    const status = await realStatus(m)
    const follow = async (logs: string) => {
      m.deps.localRunner = lyingRunner({ version: VERSION, status, logs })
      const plan = await prepareLogs(m.deps, { app: "demo", server: "dev" })
      const got: string[] = []
      const end = await followLogs(m.deps, plan, { tail: 10, follow: true }, (line) => void got.push(`${line.time}|${line.service}|${line.text}`)).catch(
        (error: Error) => error.message
      )
      return { end, got }
    }
    const good = logEvent("web", at(1), "fine")
    // A service name longer than the pattern, a time that is not one, a line past 16384 characters, another kind of event.
    for (const bad of [
      logEvent("w".repeat(64), at(2), "x"),
      logEvent("we b", at(2), "x"),
      logEvent("web", "\x1b[2J", "x"),
      logEvent("web", `${at(2)}\n`, "x"),
      logEvent("web", at(2), "y".repeat(16385)),
      frame({ event: "progress", line: "not a log" }),
      frame({ event: "log", service: "web", time: at(2), line: "x", extra: true }),
    ]) {
      const { end, got } = await follow(good + bad)
      expect(end).toBe("The runner did not answer as expected. Check that it is installed and reachable.")
      expect(got).toEqual([`${at(1)}|web|fine`])
    }
    // Control characters in the text are made plain, and a tab or line break cannot make a field or line of its own.
    const { end, got } = await follow(logEvent("web", at(3), "a\tb\nc\rd\x1b[2Je\u0007") + frame({ result: { outcome: "ok" } }))
    expect(end).toBe("ended")
    expect(got).toEqual([`${at(3)}|web|a       bcde`])
    // The runner goes away without an answer.
    expect((await follow(good)).end).toBe(logsDropped("dev"))
  })
})

describe("what is running, read again while the app is open", () => {
  test("Home shows each app's state once its server has answered; reads of one server never overlap", async () => {
    const m = await deployed("demo", "api")
    m.docker.ps("demo", `${psRow("web", "running")}\n`)
    m.docker.ps("api", `${psRow("api", "exited", 1)}\n`)
    const starts = counting(m)
    const app = openApp(m, await loadStart(m.deps))
    await app.effects.checkServers()
    expect(starts()).toBe(1)
    expect(app.state.team?.servers[0]?.apps.map((row) => [row.name, row.state])).toEqual([
      ["api", "stopped"],
      ["demo", "running"],
    ])
    expect(app.draw()).toMatch(/demo +1 +● running/)

    // A slow server: while one read is waiting, ticks start no other. Reads go over the session
    // kept since the app started, so no tick starts a runner at all (L7; each tick used to start one).
    m.docker.psHangs()
    app.store.dispatch({ type: "tick" })
    await waitFor(() => m.docker.psPid() !== undefined, "Docker to be asked")
    for (let tick = 0; tick < 5; tick++) app.store.dispatch({ type: "tick" })
    await Bun.sleep(300)
    expect(starts()).toBe(1)
    // Docker answers again: the read ends, and the next tick reads once more.
    const stateOfApp = (name: string) => app.state.team?.servers[0]?.apps.find((row) => row.name === name)?.state
    rmSync(join(dirname(m.docker.path), "ps-hang"))
    m.docker.ps("api", `${psRow("api", "running")}\n`)
    process.kill(m.docker.psPid()!)
    // Docker was stopped while asked about demo, so the runner left demo out: not known, not stopped.
    await app.until(() => stateOfApp("demo") === "unknown" && stateOfApp("api") === "running", "the slow read to end")
    app.store.dispatch({ type: "tick" })
    await app.until(() => stateOfApp("demo") === "running", "the next read")
    expect(starts()).toBe(1)
    await app.effects.close()
    expect(app.failures).toEqual([])
  }, 20_000)

  test("one session per server: ticks start no runner, the app screen reads its own server, and closing the app leaves no process (L7)", async () => {
    const m = await deployed("demo")
    expect(await m.zekno("server", "add", "other", "--local")).toBe(0)
    m.docker.ps("demo", `${psRow("web", "running")}\n`)
    const log = join(m.project, "runner.pids")
    m.deps.localRunner = ["sh", "-c", 'echo $$ >> "$0"; exec "$@"', log, ...m.deps.localRunner]
    const pids = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(Number) : [])
    const app = openApp(m, await loadStart(m.deps))
    await app.effects.checkServers()
    expect(pids()).toHaveLength(2)
    const reads = (server?: string) => app.events.filter((event) => event.type === "app-states" && (server === undefined || event.server === server)).length
    for (let tick = 0; tick < 10; tick++) {
      const before = reads()
      app.store.dispatch({ type: "tick" })
      await app.until(() => reads() === before + 2, "both servers to be read")
    }
    expect(pids()).toHaveLength(2)
    expect(app.state.team?.servers.map((server) => server.reachable)).toEqual([true, true])
    expect(app.state.team?.servers[0]?.apps[0]).toMatchObject({ name: "demo", state: "running", accepted: 1 })
    // The app screen reads its own server only, also when it opens.
    app.press({ kind: "right" }, { kind: "enter" })
    await app.until(() => reads("dev") === 12, "the app screen's read")
    app.store.dispatch({ type: "tick" })
    await app.until(() => reads("dev") === 13, "a tick on the app screen")
    expect(reads("other")).toBe(11)
    expect(pids()).toHaveLength(2)
    for (const pid of pids()) expect(isAlive(pid)).toBe(true)
    await app.effects.close()
    for (const pid of pids()) expect(isAlive(pid)).toBe(false)
    expect(app.failures).toEqual([])
  })

  test("closed at once, as on a signal, every kept session's process is stopped at once, even one that would not end by itself", async () => {
    const m = await deployed("web")
    const status = await realStatus(m)
    const dir = tempDir("stubborn")
    for (const [command, lines] of Object.entries({ version: VERSION, status, state: frame({ result: { apps: {} } }) })) writeFileSync(join(dir, command), lines)
    // It answers, and once its input closes it stays, as a runner behind a connection that hangs would.
    const script = join(dir, "runner")
    writeFileSync(
      script,
      `#!/bin/sh\necho $$ > "${dir}/pid"\nwhile IFS= read -r line; do\n  case "$line" in\n    *'"command":"version"'*) cat "${dir}/version" ;;\n    *'"command":"status"'*) cat "${dir}/status" ;;\n    *'"command":"state"'*) cat "${dir}/state" ;;\n  esac\ndone\nexec sleep 30\n`
    )
    chmodSync(script, 0o755)
    m.deps.localRunner = ["sh", script]
    const app = openApp(m, await loadStart(m.deps))
    await app.effects.checkServers()
    expect(app.state.team?.servers[0]?.reachable).toBe(true)
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"))
    const closing = Date.now()
    const closed = app.effects.close({ now: true })
    await waitFor(() => !isAlive(pid), "the runner to be stopped", 500)
    await closed
    expect(Date.now() - closing).toBeLessThan(500)
    expect(app.failures).toEqual([])
  })

  test("a lost session is connected to again once 30 seconds have passed, not before; meanwhile the server is shown as not reached (L7)", async () => {
    const m = await deployed("demo")
    m.docker.ps("demo", `${psRow("web", "running")}\n`)
    const log = join(m.project, "runner.pids")
    m.deps.localRunner = ["sh", "-c", 'echo $$ >> "$0"; exec "$@"', log, ...m.deps.localRunner]
    const pids = () => readFileSync(log, "utf8").trim().split("\n").map(Number)
    const clock = { now: 1_000_000 }
    const app = openApp(m, await loadStart(m.deps), undefined, m.deps, { now: () => clock.now })
    await app.effects.checkServers()
    const dev = () => app.state.team!.servers[0]!
    expect(dev().apps[0]?.state).toBe("running")
    process.kill(pids()[0]!)
    app.store.dispatch({ type: "tick" })
    await app.until(() => dev().reachable === false, "the read to fail")
    expect(dev().apps[0]).toMatchObject({ state: "unknown", accepted: undefined })
    expect(app.draw()).toMatch(/❯ demo +1 +● unknown/)
    for (const wait of [1_000, 15_000, 29_999]) {
      clock.now = 1_000_000 + wait
      app.store.dispatch({ type: "tick" })
    }
    await Bun.sleep(300)
    expect(pids()).toHaveLength(1)
    clock.now = 1_000_000 + 30_000
    app.store.dispatch({ type: "tick" })
    await app.until(() => dev().reachable === true && dev().apps[0]?.state === "running", "the server to be read again")
    for (let tick = 0; tick < 3; tick++) app.store.dispatch({ type: "tick" })
    await Bun.sleep(300)
    expect(pids()).toHaveLength(2)
    expect(app.failures).toEqual([])
  })

  test("a read that gets no answer in time is given up: its session is closed, and the server is shown as not reached (L8)", async () => {
    const m = await deployed("demo")
    m.docker.ps("demo", `${psRow("web", "running")}\n`)
    const log = join(m.project, "runner.pids")
    m.deps.localRunner = ["sh", "-c", 'echo $$ >> "$0"; exec "$@"', log, ...m.deps.localRunner]
    // 300 milliseconds here instead of the 20 seconds the app gives a read.
    const app = openApp(m, await loadStart(m.deps), undefined, m.deps, { readLimitMs: 300 })
    await app.effects.checkServers()
    const dev = () => app.state.team!.servers[0]!
    expect(dev().apps[0]?.state).toBe("running")
    m.docker.psHangs()
    const asked = Date.now()
    app.store.dispatch({ type: "tick" })
    await app.until(() => dev().reachable === false, "the read to be given up", 3000)
    expect(Date.now() - asked).toBeLessThan(2000)
    expect(dev().problem).toBe(noAnswer("dev", 300))
    expect(dev().apps[0]?.state).toBe("unknown")
    const [runner] = readFileSync(log, "utf8").trim().split("\n").map(Number)
    await app.until(() => !isAlive(runner!) && !isAlive(m.docker.psPid()!), "the runner and Docker to stop", 2000)
    expect(app.failures).toEqual([])
  })

  test("the read when the app starts, and after u, has the limit too once the connection is up: a runner that says its version and then nothing", async () => {
    const m = await deployed("demo")
    // It answers `version`, then reads every other request and never answers it.
    const dir = tempDir("silent")
    const script = join(dir, "runner")
    writeFileSync(script, `#!/bin/sh\necho $$ > "${dir}/pid"\nwhile IFS= read -r line; do case "$line" in *'"command":"version"'*) printf '%s' '${VERSION.trim()}'; echo ;; esac; done\n`)
    chmodSync(script, 0o755)
    m.deps.localRunner = ["sh", script]
    const app = openApp(m, await loadStart(m.deps), undefined, m.deps, { readLimitMs: 300 })
    const dev = () => app.state.team!.servers[0]!
    const asked = Date.now()
    // The deliberate connection when the app starts: no limit while it connects, the read's limit once it is up.
    await Promise.race([app.effects.checkServers(), Bun.sleep(2500)])
    expect(dev()).toMatchObject({ reachable: false, problem: noAnswer("dev", 300) })
    expect(Date.now() - asked).toBeLessThan(2500)
    const pid = Number(readFileSync(join(dir, "pid"), "utf8"))
    await app.until(() => !isAlive(pid), "the silent runner to be stopped", 2000)
    expect(app.failures).toEqual([])
  })

  test("a runner that answers with more than an answer can hold: the server is not reached, and only apps this machine knows are kept (L3)", async () => {
    const m = await deployed("web")
    const status = await realStatus(m)
    const huge = frame({ result: { apps: Object.fromEntries(Array.from({ length: 50_000 }, (_, n) => [`app-${n}`, { services: [] }])) } })
    expect(huge.length).toBeGreaterThan(SESSION_FRAME_BYTES.state)
    m.deps.localRunner = lyingRunner({ version: VERSION, status, state: huge })
    const app = openApp(m, await loadStart(m.deps))
    await app.effects.checkServers()
    expect(app.state.team?.servers[0]).toMatchObject({ reachable: false, problem: TOO_LARGE })
    // An answer within the limits: only the apps this machine has a history for are kept.
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, n) => [`other-${n}`, { services: [service("x", "running")] }]))
    expect(statesFor({ ...many, web: { services: [service("web", "running")] } }, ["web", "gone"])).toEqual({ web: "running" })
    const answer = JSON.parse(status).result
    expect(acceptedFor({ ...answer, lastSequence: { ...answer.lastSequence, other: 3, zero: 0 } }, ["web", "zero", "gone"])).toEqual({ web: 1 })
    expect(app.failures).toEqual([])
  })

  test("the app opening an app's screen reads its state; nothing is written to disk by the reads", async () => {
    const m = await deployed("demo")
    m.docker.ps("demo", `${psRow("web", "running")}\n${psRow("db", "exited")}\n`)
    const before = disk(m)
    const app = openApp(m, await loadStart(m.deps))
    app.press({ kind: "right" }, { kind: "enter" })
    await app.until(() => app.state.team?.servers[0]?.apps[0]?.state === "partly running", "demo's state")
    expect(app.draw().split("\n")[2]!.trimEnd()).toMatch(/● partly running deploy 1$/)
    expect(disk(m)).toEqual(before)
  })

  test("over SSH, one session per server is kept and read every tick; it is connected to again in batch mode only, after 30 seconds, never where SSH would ask (L7)", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const dir = tempDir("ssh")
    const log = join(dir, "ssh.log")
    const pids = join(dir, "ssh.pids")
    const asks = join(dir, "ask")
    const wrapper = join(dir, "zekno-runner")
    writeFileSync(wrapper, `#!/bin/sh\nexec env ZEKNO_RUNNER_HOME="${join(dir, "runner-home")}" ZEKNO_DOCKER="${m.docker.path}" "${process.execPath}" "${join(import.meta.dir, "../../../runner/src/main.ts")}" "$@"\n`)
    chmodSync(wrapper, 0o755)
    // A stand-in for ssh: notes each call and its process, which becomes the runner's; in batch mode it fails as SSH does where it would ask for a password.
    const ssh = join(dir, "ssh")
    writeFileSync(
      ssh,
      `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
echo $$ >> "${pids}"
batch=
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
  if [ "$1" = -o ] && [ "$2" = BatchMode=yes ]; then batch=1; fi
  shift
done
[ "$1" = -- ] || exit 255
if [ -f "${asks}" ] && [ -n "$batch" ]; then echo "$2: Permission denied (publickey,password)." >&2; exit 255; fi
exec sh -c "exec $3"
`
    )
    chmodSync(ssh, 0o755)
    const calls = () => readFileSync(log, "utf8").trim().split("\n")
    const lastProcess = () => Number(readFileSync(pids, "utf8").trim().split("\n").at(-1))
    const session = `deploy@example.test ${wrapper} session`

    await withSsh({ path: ssh }, async () => {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test", "--runner-path", wrapper)).toBe(0)
      m.compose(COMPOSE_V1)
      expect(await m.zekno("deploy", "--app", "web", "--server", "prod")).toBe(0)
      m.docker.ps("web", `${psRow("web", "running")}\n`)
      const suspended: string[] = []
      const terminal: Terminal = { suspend: async (note) => (suspended.push(note), async () => {}) }
      const clock = { now: 0 }
      const app = openApp(m, await loadStart(m.deps), terminal, m.deps, { now: () => clock.now })
      const prod = () => app.state.team!.servers[0]!
      const reads = () => app.events.filter((event) => event.type === "app-states").length
      const tick = async () => {
        const before = reads()
        app.store.dispatch({ type: "tick" })
        await app.until(() => reads() > before, "a read")
      }
      await app.effects.checkServers()
      expect(prod().apps[0]?.state).toBe("running")
      expect(calls().at(-1)).toBe(`-o BatchMode=yes -- ${session}`)

      // Every tick reads over the session the app kept when it started: no new connection, no new login.
      let made = calls().length
      m.docker.ps("web", `${psRow("web", "exited", 1)}\n`)
      for (let n = 0; n < 3; n++) await tick()
      expect(prod().apps[0]?.state).toBe("stopped")
      expect(calls().length).toBe(made)

      // SSH now needs a password, and the kept session is lost: the server is shown as not reached at once, its state unknown.
      writeFileSync(asks, "")
      process.kill(lastProcess())
      app.store.dispatch({ type: "tick" })
      await app.until(() => prod().reachable === false, "the read to fail")
      expect(prod().apps[0]?.state).toBe("unknown")
      expect(calls().length).toBe(made)
      // It is connected to again 30 seconds later, not sooner: in batch mode, once, and the terminal is never handed over.
      clock.now += 29_000
      app.store.dispatch({ type: "tick" })
      await Bun.sleep(300)
      expect(calls().length).toBe(made)
      clock.now += 1_000
      app.store.dispatch({ type: "tick" })
      await app.until(() => prod().problem === needsAnswer("deploy@example.test", "prod"), "the connection in batch mode to fail")
      // Marked as needing an answer, not as a server that could not be reached.
      expect(prod().asks).toBe(true)
      expect(suspended).toEqual([])
      expect(calls().slice(made)).toEqual([`-o BatchMode=yes -- ${session}`])
      // Where SSH would ask, it is not tried again in the background, however long it has been: no connection at all.
      made = calls().length
      clock.now += 300_000
      for (let n = 0; n < 3; n++) app.store.dispatch({ type: "tick" })
      app.press({ kind: "right" }, { kind: "enter" })
      await Bun.sleep(300)
      expect(calls().length).toBe(made)

      // Connecting on purpose may ask, and is answered; its session is kept, and ticks read over it.
      app.press({ kind: "escape" })
      await app.effects.checkServers()
      expect(suspended).toHaveLength(1)
      expect(prod().reachable).toBe(true)
      rmSync(asks)
      made = calls().length
      m.docker.ps("web", `${psRow("web", "running")}\n`)
      await tick()
      expect(prod().apps[0]?.state).toBe("running")
      expect(calls().length).toBe(made)

      // That session is lost too: after the wait the background connects again, in batch mode, and keeps the new session.
      process.kill(lastProcess())
      app.store.dispatch({ type: "tick" })
      await app.until(() => prod().reachable === false, "the read to fail")
      clock.now += 30_000
      await tick()
      expect(prod()).toMatchObject({ reachable: true, problem: undefined })
      expect(prod().apps[0]?.state).toBe("running")
      expect(calls().slice(made)).toEqual([`-o BatchMode=yes -- ${session}`])
      expect(suspended).toHaveLength(1)
      const kept = lastProcess()
      expect(isAlive(kept)).toBe(true)
      await app.effects.close()
      expect(isAlive(kept)).toBe(false)
      expect(app.failures).toEqual([])
    })
  }, 60_000)
})

// ---------------------------------------------------------------------------
// `zekno logs`

describe("`zekno logs`", () => {
  test("prints `<time>\\t<service>\\t<text>`, one line each, cleaned; ends with 0 when Docker's log command ends", async () => {
    const m = await deployed("web")
    m.docker.logs(
      "web",
      "web-1  | 2026-11-14T21:52:03.000000001Z started\there\n" +
        "db-1  | 2026-11-14T21:52:04Z \x1b[2J\x1b]0;title\x07ready\x1b[0m\n" +
        "web-1  | 2026-11-14T21:52:05Z GET / 200\n"
    )
    expect(await m.zekno("logs", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.out).toEqual(["2026-11-14T21:52:03.000000001Z\tweb\tstarted here", "2026-11-14T21:52:04Z\tdb\tready", "2026-11-14T21:52:05Z\tweb\tGET / 200"])
    for (const line of m.out) expect(line.split("\t")).toHaveLength(3)
    expect(m.err).toEqual([])
    expect(m.docker.inspections().at(-1)!.args).toContain("--tail 200")
  })

  test("--no-follow asks the runner not to follow: Docker prints what it has and the command ends; --tail is passed on", async () => {
    const m = await deployed("web")
    // Asked to follow, the stand-in Docker would stay alive.
    m.docker.logs("web", "web-1  | 2026-11-14T21:52:03Z one\nweb-1  | 2026-11-14T21:52:04Z two\n", { follow: true })
    const started = Date.now()
    expect(await m.zekno("logs", "--app", "web", "--server", "dev", "--no-follow", "--tail", "5")).toBe(0)
    // No quiet time is waited for: it ends when Docker's log command does.
    expect(Date.now() - started).toBeLessThan(5000)
    expect(m.out).toEqual(["2026-11-14T21:52:03Z\tweb\tone", "2026-11-14T21:52:04Z\tweb\ttwo"])
    expect(m.docker.inspections().at(-1)!.args).toBe("compose -p zekno-web logs --timestamps --no-color --tail 5")
    expect(m.docker.logsPid()).toBeUndefined()
  }, 20_000)

  test("`zekno logs | head -1`: once the reader closes its end, the reading stops and the command ends quietly with 0, leaving nothing running (L2)", async () => {
    const run = logsProcess()
    const first = await run.firstLine()
    expect(first).toMatch(/^2026-11-14T00:00:00Z\tweb\tx{200}$/)
    // The reader goes, as `head -1` does once it has its line.
    await run.closeOutput()
    const closed = Date.now()
    expect(await within(run.child.exited, 3000)).toBe(0)
    expect(Date.now() - closed).toBeLessThan(2000)
    await waitFor(() => run.left().length === 0, "the runner and Docker's log command to stop", 1000)
  }, 15_000)

  test("`zekno logs` while the runner sends lines without pause: memory stays bounded, and Ctrl-C stops it at once with 0, leaving nothing running (L1)", async () => {
    const run = logsProcess()
    await run.firstLine()
    // Read as fast as it comes, for a moment, as a terminal does.
    const draining = run.drain()
    await Bun.sleep(700)
    expect(residentMiB(run.child.pid)!).toBeLessThan(400)
    expect(run.received()).toBeGreaterThan(1_000_000)
    run.child.kill("SIGINT")
    const interrupted = Date.now()
    expect(await within(run.child.exited, 3000)).toBe(0)
    expect(Date.now() - interrupted).toBeLessThan(1500)
    await draining
    await waitFor(() => run.left().length === 0, "the runner and Docker's log command to stop", 1000)
  }, 15_000)

  test("--tail is a whole number from 0 to 1000, checked before anything is read or sent", async () => {
    expect(parseTail(undefined)).toBe(200)
    expect(parseTail("0")).toBe(0)
    expect(parseTail("1000")).toBe(1000)
    const m = await deployed("web")
    const starts = counting(m)
    for (const tail of ["1001", "-1", "1.5", "abc", "", "1e3", " 5", "99999"]) {
      m.err.length = 0
      expect(await m.zekno("logs", "--app", "web", "--server", "dev", `--tail=${tail}`)).toBe(2)
      expect(m.err[0]).toStartWith("`--tail` takes a whole number from 0 to 1000.")
    }
    // Written apart, a value that starts with a dash is not taken as one: wrong usage too.
    expect(await m.zekno("logs", "--app", "web", "--server", "dev", "--tail", "-1")).toBe(2)
    expect(starts()).toBe(0)
    expect(m.docker.inspections()).toEqual([])
  })

  test("a missing app or server is wrong usage; an app the server never ran, or a runner from before sessions, is said and is exit 1", async () => {
    const m = await deployed("web")
    expect(await m.zekno("logs", "--server", "dev")).toBe(2)
    expect(m.lastErr()).toStartWith("Say which app with `--app <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.")
    expect(await m.zekno("logs", "--app", "web")).toBe(2)
    expect(m.lastErr()).toStartWith("Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.")
    expect(await m.zekno("logs", "--app", "other", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe("dev has no deploy of other, so there are no logs to read.")
    const real = m.deps.localRunner
    m.deps.localRunner = ["sh", "-c", 'for word; do :; done; [ "$word" = session ] && exit 2; exec "$@"', "sh", ...real]
    expect(await m.zekno("logs", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe(logsTooOld("dev"))
    expect(m.out).toEqual([])
    expect(m.docker.inspections().filter((call) => call.args.includes(" logs "))).toEqual([])
  })

  test("at a terminal: the board's time, service and text, and a long line goes on under its own text", () => {
    const lines = renderToString(<LogItem line={{ time: at(3), service: "web", text: "word ".repeat(30).trim() }} serviceWidth={6} />, { columns: 60 }).split("\n")
    expect(lines[0]).toStartWith(`${logClock(at(3))}  web     word`)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) expect(line).toStartWith(" ".repeat(18))
    // As `zekno logs` draws it, among the lines already written: a word longer than the room left is broken by zekno, never by the terminal.
    for (const columns of [80, 100]) {
      const long = { time: at(3), service: "web", text: `GET ${"/a".repeat(80)} 200` }
      const drawn = renderToString(<Static items={[long]}>{(line) => <LogItem key={line.text} line={line} serviceWidth={6} columns={columns} />}</Static>, { columns })
      const rows = drawn.split("\n").filter((line) => line !== "")
      expect(rows.length).toBeGreaterThan(2)
      for (const line of rows.slice(1)) expect(line).toMatch(/^ {18}/)
      for (const line of rows) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns)
    }
  })

  test("`zekno logs` is in the help", async () => {
    const m = machine()
    expect(await m.zekno("--help")).toBe(0)
    expect(m.out.join("\n")).toContain("zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]")
  })
})
