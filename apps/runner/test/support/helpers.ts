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
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildDeployV2, deployV2 } from "./deploy-v2"
import { fakeDocker } from "./docker/fake"

export const RUNNER_MAIN = join(import.meta.dir, "../../src/main.ts")
export const COMPOSE =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n"

export function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `zekno-${label}-`))
}

/** The resident memory of a running process, in MiB, or undefined once it has gone. */
export function residentMiB(pid: number): number | undefined {
  const result = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)])
  const kib = Number(result.stdout.toString().trim())
  return result.exitCode === 0 && Number.isFinite(kib) && kib > 0
    ? kib / 1024
    : undefined
}

/** Waits until `ready` is true, checking every few milliseconds. */
export async function waitFor(
  ready: () => boolean,
  what: string,
  timeoutMs = 10_000
): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!ready()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(10)
  }
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

/** The stand-in for Docker: `docker/fake.ts`. */
export { fakeDocker, type DockerCall, type FakeDocker } from "./docker/fake"

/** Runs the runner as its own process, the way SSH would. */
export async function runner(
  home: string,
  docker: string,
  command: string,
  message?: unknown,
  extra: string[] = []
) {
  const child = Bun.spawn([process.execPath, RUNNER_MAIN, command, ...extra], {
    env: { ...process.env, ZEKNO_RUNNER_HOME: home, ZEKNO_DOCKER: docker },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (message !== undefined)
    child.stdin.write(
      typeof message === "string" ? message : JSON.stringify(message)
    )
  child.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const code = await child.exited
  let json: Record<string, unknown> | undefined
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Record<
      string,
      unknown
    >
  } catch {
    json = undefined
  }
  return { code, json, stdout, stderr }
}

export type Frame = Record<string, unknown>

/**
 * Runs `zekno-runner session` as its own process, the way SSH would, and
 * reads its frames as they arrive. A line that is not JSON is kept as
 * `{ unreadable: <line> }` so a test can see it. `command` starts another
 * runner, such as runner 0.1.0 (`olderRunner`).
 */
export function session(
  home: string,
  docker: string,
  env: Record<string, string> = {},
  command: string[] = [process.execPath, RUNNER_MAIN]
) {
  const child = Bun.spawn([...command, "session"], {
    env: {
      ...process.env,
      ZEKNO_RUNNER_HOME: home,
      ZEKNO_DOCKER: docker,
      ...env,
    },
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
    child.stdin.write(
      typeof request === "string"
        ? `${request}\n`
        : `${JSON.stringify(request)}\n`
    )
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
    async request(
      request: unknown
    ): Promise<{ events: Frame[]; result: Record<string, unknown> }> {
      send(request)
      const events: Frame[] = []
      for (;;) {
        const frame = await next()
        if (frame === undefined)
          throw new Error("the session ended before it answered")
        if ("result" in frame)
          return { events, result: frame.result as Record<string, unknown> }
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

  const setup = await runner(home, docker.path, "setup", {
    founding: team.envelope,
    teamCode: team.confirmationCode,
  })
  const serverId = String(setup.json!.serverId)
  const added = await proposeRoster({
    trust: team.trust,
    servers: [
      { name: "prod-1", publicKey: setup.json!.serverPublicKey as never },
    ],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  const synced = await runner(home, docker.path, "sync", { rosters })
  if (synced.json?.outcome !== "ok")
    throw new Error(`sync failed: ${JSON.stringify(synced.json)}`)

  return {
    signer,
    team,
    trust: added.trust,
    rosters,
    home,
    docker,
    serverId,
    setup,
  }
}

/** A world with a deploy accepted for each of `apps`: its first, of version 2, made against 0. */
export async function deployed(
  apps: string[]
): Promise<Awaited<ReturnType<typeof world>>> {
  const w = await world()
  for (const app of apps) {
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      app,
    })
    const { result } = await deployV2(w, { rosters: w.rosters, ...built })
    if (result.outcome !== "started")
      throw new Error(`deploy of ${app} failed: ${JSON.stringify(result)}`)
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
  for (const [name, value] of Object.entries(
    input.values ?? { GREETING: "hello from the test" }
  )) {
    secrets.push(
      await createSecret({
        trust: input.trust,
        serverId: input.serverId,
        app,
        name,
        value,
        version: input.secretVersion ?? input.sequence,
        signer: input.signer,
      })
    )
  }
  return createDeploy({
    trust: input.trust,
    serverId: input.serverId,
    app,
    sequence: input.sequence,
    compose: input.compose ?? COMPOSE,
    secrets,
    signer: input.signer,
  })
}

/** Every file under a folder, with its content, for checking what was written to disk. */
export function filesUnder(
  dir: string
): { path: string; content: string; mode: number }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return [
      {
        path,
        content: readFileSync(path, "utf8"),
        mode: statSync(path).mode & 0o777,
      },
    ]
  })
}

export type { Envelope }
