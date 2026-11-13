import {
  createDeploy,
  createSecret,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  proposeRoster,
  type Envelope,
  type SecretRecord,
  type Signer,
  type TeamTrust,
} from "@workspace/core"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const RUNNER_MAIN = join(import.meta.dir, "../src/main.ts")
export const COMPOSE = "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n"

export function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `zekno-${label}-`))
}

/** One call of the stand-in Docker: its arguments, its environment and the folder it was started in. */
type DockerCall = { args: string; env: Record<string, string>; cwd: string }

function readCalls(log: string): DockerCall[] {
  if (!existsSync(log)) return []
  return readFileSync(log, "utf8")
    .split("END\n")
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.trim().split("\n")
      const env: Record<string, string> = {}
      for (const line of lines.filter((entry) => entry.startsWith("ENV "))) {
        const [name, ...rest] = line.slice(4).split("=")
        env[name!] = rest.join("=")
      }
      const cwd = lines.find((entry) => entry.startsWith("CWD "))?.slice(4) ?? ""
      return { args: lines.find((entry) => entry.startsWith("ARGS "))!.slice(5), env, cwd }
    })
}

/** The resident memory of a running process, in MiB, or undefined once it has gone. */
export function residentMiB(pid: number): number | undefined {
  const result = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)])
  const kib = Number(result.stdout.toString().trim())
  return result.exitCode === 0 && Number.isFinite(kib) && kib > 0 ? kib / 1024 : undefined
}

/** Waits until `ready` is true, checking every few milliseconds. */
export async function waitFor(ready: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!ready()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(10)
  }
}

function pidIn(file: string): number | undefined {
  if (!existsSync(file)) return undefined
  const pid = Number(readFileSync(file, "utf8").trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** True while a process with this id exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A stand-in for the `docker` command. It records how it was called and with
 * what environment, and exits with the status written in its `exit` file.
 *
 * `compose ... up` prints prepared lines and can be held in the middle until
 * the test lets it go. `compose -p <project> ps` prints a prepared file, or
 * hangs when asked to. `compose -p <project> logs` prints a prepared file
 * and, when asked, stays alive afterwards the way `--follow` does.
 */
export function fakeDocker() {
  const dir = tempDir("docker")
  const path = join(dir, "docker")
  const log = join(dir, "calls.log")
  const inspectLog = join(dir, "inspect.log")
  const at = (name: string) => join(dir, name)
  writeFileSync(
    path,
    `#!/bin/sh
d="${dir}"
if [ "$4" = "ps" ] || [ "$4" = "logs" ]; then
  { echo "ARGS $*"; echo "CWD $(pwd -P)"; env | sed 's/^/ENV /'; echo END; } >> "${inspectLog}"
else
  { echo "ARGS $*"; echo "CWD $(pwd -P)"; env | sed 's/^/ENV /'; echo END; } >> "${log}"
fi
if [ "$4" = "ps" ]; then
  if [ -f "$d/ps-hang" ]; then echo $$ > "$d/ps.pid"; exec sleep 60; fi
  if [ -f "$d/ps-$3" ]; then cat "$d/ps-$3"; fi
  if [ -f "$d/ps-$3.exit" ]; then exit "$(cat "$d/ps-$3.exit")"; fi
  exit 0
fi
if [ "$4" = "logs" ]; then
  if [ -f "$d/logs-$3" ]; then cat "$d/logs-$3"; fi
  if [ -f "$d/logs-leave-child" ]; then
    # A process left behind that keeps the output open after this one is stopped.
    sleep 60 &
    echo $! > "$d/logs-child.pid"
    echo $$ > "$d/logs.pid"
    wait
  fi
  if [ -f "$d/logs-follow" ]; then echo $$ > "$d/logs.pid"; exec sleep 60; fi
  exit 0
fi
if [ -f "$d/up-stdout" ]; then cat "$d/up-stdout"; fi
if [ -f "$d/up-stderr" ]; then cat "$d/up-stderr" >&2; fi
if [ -f "$d/up-hold" ]; then
  touch "$d/up-started"
  while [ ! -f "$d/up-go" ]; do sleep 0.05; done
  if [ -f "$d/up-after" ]; then cat "$d/up-after" >&2; fi
fi
touch "$d/up-done"
if [ -f "$d/exit" ]; then exit "$(cat "$d/exit")"; fi
exit 0
`
  )
  chmodSync(path, 0o755)
  return {
    path,
    failWith: (status: number) => writeFileSync(at("exit"), String(status)),
    /** The `up` calls, in order. */
    calls: (): DockerCall[] => readCalls(log),
    /** The `ps` and `logs` calls, in order. */
    inspections: (): DockerCall[] => readCalls(inspectLog),
    /** What `up` prints on standard output and standard error. */
    upPrints(output: { stdout?: string; stderr?: string }) {
      if (output.stdout !== undefined) writeFileSync(at("up-stdout"), output.stdout)
      if (output.stderr !== undefined) writeFileSync(at("up-stderr"), output.stderr)
    },
    /** Makes `up` stop after its first lines until `releaseUp`, then print `after` on standard error. */
    holdUp: (after = "") => {
      writeFileSync(at("up-after"), after)
      writeFileSync(at("up-hold"), "")
    },
    upStarted: () => existsSync(at("up-started")),
    releaseUp: () => writeFileSync(at("up-go"), ""),
    /** True once an `up` ran to its end. */
    upFinished: () => existsSync(at("up-done")),
    /** What `ps` prints for an app, and the status it exits with. */
    ps: (app: string, output: string, status = 0) => {
      writeFileSync(at(`ps-zekno-${app}`), output)
      writeFileSync(at(`ps-zekno-${app}.exit`), String(status))
    },
    /** Makes every `ps` hang, printing nothing, until it is stopped. */
    psHangs: () => writeFileSync(at("ps-hang"), ""),
    /** The process id of the last `ps` that hung, once it has started. */
    psPid: (): number | undefined => pidIn(at("ps.pid")),
    /**
     * What `logs` prints for an app. With `follow`, it then stays alive until
     * stopped. With `leaveChild`, it starts a process that keeps the output
     * open even after `logs` itself is stopped.
     */
    logs: (app: string, output: string, options: { follow?: boolean; leaveChild?: boolean } = {}) => {
      writeFileSync(at(`logs-zekno-${app}`), output)
      if (options.follow) writeFileSync(at("logs-follow"), "")
      if (options.leaveChild) writeFileSync(at("logs-leave-child"), "")
    },
    /** The process id of the last `logs` that stayed alive, once it has started. */
    logsPid: (): number | undefined => pidIn(at("logs.pid")),
    /** The process id of what `logs` left behind with `leaveChild`. */
    leftChildPid: (): number | undefined => pidIn(at("logs-child.pid")),
  }
}

/** Runs the runner as its own process, the way SSH would. */
export async function runner(home: string, docker: string, command: string, message?: unknown, extra: string[] = []) {
  const child = Bun.spawn([process.execPath, RUNNER_MAIN, command, ...extra], {
    env: { ...process.env, ZEKNO_RUNNER_HOME: home, ZEKNO_DOCKER: docker },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (message !== undefined) child.stdin.write(typeof message === "string" ? message : JSON.stringify(message))
  child.stdin.end()
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  const code = await child.exited
  let json: Record<string, unknown> | undefined
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Record<string, unknown>
  } catch {
    json = undefined
  }
  return { code, json, stdout, stderr }
}

export type Frame = Record<string, unknown>

/**
 * Runs `zekno-runner session` as its own process, the way SSH would, and
 * reads its frames as they arrive. A line that is not JSON is kept as
 * `{ unreadable: <line> }` so a test can see it.
 */
export function session(home: string, docker: string, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, RUNNER_MAIN, "session"], {
    env: { ...process.env, ZEKNO_RUNNER_HOME: home, ZEKNO_DOCKER: docker, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const frames: Frame[] = []
  let output = ""
  let ended = false
  let waiting: (() => void)[] = []
  const wake = () => {
    for (const resolve of waiting) resolve()
    waiting = []
  }
  const reader = child.stdout.getReader()
  const reading = (async () => {
    const decoder = new TextDecoder()
    let rest = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        output += text
        const lines = (rest + text).split("\n")
        rest = lines.pop() ?? ""
        for (const line of lines) {
          try {
            frames.push(JSON.parse(line) as Frame)
          } catch {
            frames.push({ unreadable: line })
          }
        }
        wake()
      }
    } catch {
      // The test stopped reading.
    }
    ended = true
    wake()
  })()
  const stderr = new Response(child.stderr).text()
  let taken = 0

  /** The next frame, or undefined once the runner's output has ended. */
  async function next(): Promise<Frame | undefined> {
    while (taken >= frames.length) {
      if (ended) return undefined
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    return frames[taken++]
  }

  /** Writes one line: a value as JSON, or a string exactly as given. */
  function send(request: unknown) {
    child.stdin.write(typeof request === "string" ? `${request}\n` : `${JSON.stringify(request)}\n`)
    child.stdin.flush()
  }

  return {
    child,
    /** Every frame received so far. */
    frames,
    /** Everything the runner wrote on standard output so far. */
    output: () => output,
    send,
    next,
    /** Sends one request and reads its events and its result. */
    async request(request: unknown): Promise<{ events: Frame[]; result: Record<string, unknown> }> {
      send(request)
      const events: Frame[] = []
      for (;;) {
        const frame = await next()
        if (frame === undefined) throw new Error("the session ended before it answered")
        if ("result" in frame) return { events, result: frame.result as Record<string, unknown> }
        events.push(frame)
      }
    },
    /** Closes the runner's input and waits for it to exit. */
    async close(): Promise<{ code: number; stderr: string }> {
      child.stdin.end()
      const code = await child.exited
      await reading
      return { code, stderr: await stderr }
    },
    /** Closes the input and stops reading, as when the connection drops. Does not wait for the exit. */
    async goAway(): Promise<void> {
      child.stdin.end()
      await reader.cancel()
    },
    /** Waits for the runner to exit after `goAway`. */
    exited: async (): Promise<number> => child.exited,
  }
}

/** A team, a runner that is set up and in the team list, and the pieces to build deploys for it. */
export async function world() {
  const pair = generateMemberKeyPair()
  const signer = createSigner(pair.secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const home = tempDir("runner")
  const docker = fakeDocker()

  const setup = await runner(home, docker.path, "setup", { founding: team.envelope, teamCode: team.confirmationCode })
  const serverId = String(setup.json!.serverId)
  const added = await proposeRoster({
    trust: team.trust,
    servers: [{ name: "prod-1", publicKey: setup.json!.serverPublicKey as never }],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  const synced = await runner(home, docker.path, "sync", { rosters })
  if (synced.json?.outcome !== "ok") throw new Error(`sync failed: ${JSON.stringify(synced.json)}`)

  return { signer, team, trust: added.trust, rosters, home, docker, serverId, setup }
}

/** A world with a deploy accepted for each of `apps`. */
export async function deployed(apps: string[]): Promise<Awaited<ReturnType<typeof world>>> {
  const w = await world()
  for (const app of apps) {
    const deploy = await buildDeploy({ trust: w.trust, serverId: w.serverId, signer: w.signer, sequence: 1, app })
    const result = await runner(w.home, w.docker.path, "apply", { rosters: w.rosters, deploy })
    if (result.json?.outcome !== "started") throw new Error(`deploy of ${app} failed: ${JSON.stringify(result.json)}`)
  }
  return w
}

export async function buildDeploy(input: {
  trust: TeamTrust
  serverId: string
  signer: Signer
  sequence: number
  values?: Record<string, string>
  app?: string
  compose?: string
  secretVersion?: number
}) {
  const app = input.app ?? "web"
  const secrets: SecretRecord[] = []
  for (const [name, value] of Object.entries(input.values ?? { GREETING: "hello from the test" })) {
    secrets.push(await createSecret({ trust: input.trust, serverId: input.serverId, app, name, value, version: input.secretVersion ?? input.sequence, signer: input.signer }))
  }
  return createDeploy({ trust: input.trust, serverId: input.serverId, app, sequence: input.sequence, compose: input.compose ?? COMPOSE, secrets, signer: input.signer })
}

/** Every file under a folder, with its content, for checking what was written to disk. */
export function filesUnder(dir: string): { path: string; content: string; mode: number }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return [{ path, content: readFileSync(path, "utf8"), mode: statSync(path).mode & 0o777 }]
  })
}

export type { Envelope }
