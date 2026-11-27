/**
 * `server.ts up` (specs/016-build-from-source, T008; quickstart.md, "The
 * Linux stand-in, on the Mac"; research/map-checks.md part 6, steps 1 to 4;
 * LC8). It reads once which engine the host's current context answers at
 * and goes on only for a socket of this machine (`endpoint.ts`); every
 * later call of the run names that engine, and its first line says it. It
 * checks that Docker answers there and that nothing named zekno-check-* is
 * left, takes the lists `down` compares with, and writes them and the
 * engine in the run's folder before it makes anything. It notes which host images are
 * already there before it pulls one, runs `plan.ts`'s lists in order, places
 * the runner compiled from this commit for the stand-in's processor at
 * `/usr/local/bin/zekno-runner` (mode 755), pulls the proxy's image by digest
 * inside the stand-in, and prints `ZEKNO_LINUX_SERVER=...` and the sshd
 * port, with the time each step took. A failed `up` removes what it made, as
 * `down` does. Into a container goes only the compiled runner, on standard
 * input: never a folder of the repository.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { PROXY_IMAGE } from "../../../../src/proxy/image"
import { down, type DownDeps } from "./down"
import type { Answer, HostDocker } from "../host/host-docker"
import {
  buildRecords,
  firstLine,
  hostImages,
  leftovers,
  namesIn,
  removeHint,
  SERVER_SCRIPT,
} from "../host/host-lists"
import type { EngineName, Pins } from "../pins"
import { planStandIn, type Options } from "./plan"
import { makeRunFolder, writeState, type RunState } from "./run-folder"
import { checkPort, knownHostsLine, sshdCommand } from "./sshd"

/** Run on this machine: ssh-keygen and the runner's compile, never Docker. */
export type Local = (
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number }
) => Promise<Answer>

export type Deps = DownDeps & {
  readonly local: Local
  readonly portFree: (port: number) => boolean
  /** `apps/runner`, where the runner is compiled. */
  readonly runnerDir: string
  readonly pins: Pins
  readonly newId: () => string
  readonly choosePort: () => number
  /** Milliseconds, for the times each step took. */
  readonly now: () => number
}

/** Writes the runner whole from standard input, mode 755, in place of the one before. */
export const PLACE_RUNNER = [
  "set -eu",
  "cat > /usr/local/bin/zekno-runner.part",
  "chmod 0755 /usr/local/bin/zekno-runner.part",
  "mv -f /usr/local/bin/zekno-runner.part /usr/local/bin/zekno-runner",
].join("\n")

const PROCESSORS = new Map([
  ["x86_64", "linux-x64"],
  ["aarch64", "linux-arm64"],
])
const NO_SUCH_IMAGE = /no such image/i
const PORT_TRIES = 20
export const MINUTE = 60_000
export const VERSION = ["docker", "version", "--format", "{{.Server.Version}}"]

/** A call that ended with a status other than 0. */
export class Failed extends Error {
  constructor(readonly answer: Answer) {
    super(`exit ${answer.code}`)
  }
}

/** A step already said why it stopped. */
class Stopped extends Error {}

export function must(answer: Answer): Answer {
  if (answer.code !== 0) throw new Failed(answer)
  return answer
}

const lastLines = (answer: Answer, count: number) =>
  `${answer.stdout}\n${answer.stderr}`
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .slice(-count)

export const lastLine = (answer: Answer) =>
  answer.stderr.trim().split("\n").at(-1)?.trim() ||
  lastLines(answer, 1)[0] ||
  ""

export const seconds = (ms: number) => Math.round(ms / 1000)

/** Runs one step of `up`; says how long it took, or why it stopped with the end of what it printed. */
async function step<T>(
  deps: Deps,
  name: string,
  work: () => Promise<T>
): Promise<T> {
  const started = deps.now()
  try {
    const result = await work()
    deps.say(`${name}: ${seconds(deps.now() - started)} s`)
    return result
  } catch (error) {
    if (!(error instanceof Failed)) {
      deps.say(`${name} failed: ${(error as Error).message}`)
      throw new Stopped()
    }
    deps.say(
      `${name} failed (exit ${error.answer.code}): ${lastLine(error.answer)}`
    )
    const tail = lastLines(error.answer, 15)
    if (tail.length > 1) for (const line of tail) deps.say(`  | ${line}`)
    throw new Stopped()
  }
}

/** The stand-in's engine version, which must be the one pins.json names for `engine`. */
export async function checkEngine(
  docker: HostDocker,
  server: string,
  pins: Pins,
  engine: EngineName
): Promise<string> {
  const answer = must(await docker.run(["docker", "exec", server, ...VERSION]))
  const found = answer.stdout.trim()
  const pinned = pins.engines[engine].engine
  if (found !== pinned)
    throw new Error(
      `the stand-in runs Engine ${found}, not pins.json's ${pinned} for ${engine}`
    )
  return found
}

/** Compiles the runner for the stand-in's processor and writes it in; gives the version it answers. */
async function placeRunner(
  docker: HostDocker,
  server: string,
  deps: Deps
): Promise<string> {
  const machine = must(
    await docker.run(["docker", "exec", server, "uname", "-m"])
  ).stdout.trim()
  const target = PROCESSORS.get(machine)
  if (target === undefined)
    throw new Error(
      `the stand-in's processor is ${machine}, and the runner is compiled for x86_64 and aarch64 only`
    )
  must(
    await deps.local(
      [process.execPath, "--no-env-file", "run", `compile:${target}`],
      {
        cwd: deps.runnerDir,
        timeoutMs: 10 * MINUTE,
      }
    )
  )
  const file = join(deps.runnerDir, "dist", `zekno-runner-${target}`)
  if (!existsSync(file)) throw new Error(`the compile left no ${file}`)
  must(
    await docker.run(
      ["docker", "exec", "-i", server, "sh", "-c", PLACE_RUNNER],
      {
        stdin: { file },
        timeoutMs: 5 * MINUTE,
      }
    )
  )
  const answer = must(
    await docker.run([
      "docker",
      "exec",
      server,
      "/usr/local/bin/zekno-runner",
      "version",
    ])
  )
  try {
    const { version } = JSON.parse(answer.stdout) as { version?: unknown }
    if (typeof version === "string") return version
  } catch {
    // Said below.
  }
  throw new Error(
    `the placed runner answered ${JSON.stringify(answer.stdout.trim())}, not its version`
  )
}

function freePort(deps: Deps): number | undefined {
  for (let tried = 0; tried < PORT_TRIES; tried++) {
    const port = checkPort(deps.choosePort())
    if (deps.portFree(port)) return port
  }
  return undefined
}

export async function up(options: Options, deps: Deps): Promise<number> {
  const started = deps.now()
  let endpoint: string
  try {
    endpoint = await deps.endpoint()
  } catch (error) {
    deps.say((error as Error).message)
    return 1
  }
  const reader = deps.docker(endpoint)
  const answer = await reader.run(VERSION)
  if (answer.code !== 0) {
    deps.say(`Docker does not answer at ${endpoint}: ${firstLine(answer)}`)
    return 1
  }
  const left = await leftovers(reader)
  if (namesIn(left).length > 0) {
    deps.say(removeHint(left))
    return 1
  }
  const images = await hostImages(reader)
  const records = await buildRecords(reader)
  const port = freePort(deps)
  if (port === undefined) {
    deps.say(`No free port for sshd on 127.0.0.1 after ${PORT_TRIES} tries.`)
    return 1
  }

  const id = deps.newId()
  const folder = makeRunFolder(deps.root, id)
  let state: RunState = {
    id,
    endpoint,
    ...options,
    port,
    before: {
      ...left,
      images,
      buildRecords: typeof records === "number" ? records : null,
    },
    images: [],
  }
  writeState(folder, state)
  deps.say(
    `zekno-check-${id}: remove what this run makes with ${SERVER_SCRIPT} down --id ${id}; it runs on Docker at ${endpoint}`
  )
  if (typeof records === "string")
    deps.say(
      `The host's build records could not be counted, so down cannot compare them: ${records}`
    )

  const docker = deps.docker(endpoint, id)
  const plan = planStandIn(deps.pins, options, { id, port, keyFolder: folder })
  const server = plan.names.server
  try {
    await step(
      deps,
      `${deps.pins.images.ubuntu.tag} on this machine`,
      async () => {
        const image = deps.pins.images.ubuntu.image
        const inspect = await docker.run([
          "docker",
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          image,
        ])
        if (inspect.code !== 0 && !NO_SUCH_IMAGE.test(inspect.stderr))
          throw new Failed(inspect)
        // Written before the pull, so down never removes an image that was here before up.
        state = {
          ...state,
          images: [...state.images, { image, present: inspect.code === 0 }],
        }
        writeState(folder, state)
        if (inspect.code !== 0)
          must(
            await docker.run(["docker", "pull", "--quiet", image], {
              timeoutMs: 15 * MINUTE,
            })
          )
      }
    )
    await step(deps, "volume and network", async () => {
      must(await docker.run(plan.volume))
      must(await docker.run(plan.network))
    })
    await step(deps, "server started", async () =>
      must(await docker.run(plan.server))
    )
    await step(deps, `packages installed (${options.engine})`, async () =>
      must(await docker.run(plan.install, { timeoutMs: 20 * MINUTE }))
    )
    const engineVersion = await step(
      deps,
      `dockerd started (${options.store})`,
      async () => {
        must(await docker.run(plan.daemon, { timeoutMs: 3 * MINUTE }))
        return checkEngine(docker, server, deps.pins, options.engine)
      }
    )
    await step(deps, "sshd started", async () => {
      must(await deps.local(plan.clientKey, { cwd: folder, timeoutMs: MINUTE }))
      const publicKey = readFileSync(join(folder, "client_ed25519.pub"), "utf8")
      must(await docker.run(sshdCommand(server, publicKey)))
      const hostKey = must(await docker.run(plan.hostKey))
      writeFileSync(
        join(folder, "known_hosts"),
        `${knownHostsLine(port, hostKey.stdout)}\n`,
        {
          mode: 0o600,
        }
      )
    })
    const runner = await step(deps, "runner placed", () =>
      placeRunner(docker, server, deps)
    )
    await step(deps, "Caddy pulled in the stand-in", async () =>
      must(
        await docker.run(
          ["docker", "exec", server, "docker", "pull", "--quiet", PROXY_IMAGE],
          {
            timeoutMs: 15 * MINUTE,
          }
        )
      )
    )
    deps.say(`ZEKNO_LINUX_SERVER=${server}`)
    deps.say(
      `sshd on 127.0.0.1:${port}; the client key and known_hosts are in ${folder}`
    )
    deps.say(
      `Up in ${seconds(deps.now() - started)} s: engine ${options.engine} (${engineVersion}), store ${options.store}${options.memory ? ", held to 1 GB" : ""}, runner ${runner}.`
    )
    return 0
  } catch (error) {
    if (!(error instanceof Stopped))
      deps.say(`up stopped: ${(error as Error).message}`)
    await down(id, deps)
    return 1
  }
}
