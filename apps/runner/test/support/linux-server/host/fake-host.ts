/**
 * A stand-in for Docker on the host, for the tests of `server.ts`, `gate.ts`
 * and `host-docker.ts` (specs/016-build-from-source, T008): a model of what
 * exists (containers, volumes, networks with their labels, images, the
 * count of build records, the engine the current context answers at) that
 * answers the calls `host-docker.ts` lets through, records each call with
 * its environment, and fails the calls a test names. No test runs Docker,
 * and `removeFakeWorlds` removes the folders the worlds made.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  hostDocker,
  resolveEndpoint,
  type Answer,
  type Call,
  type HostDocker,
  type Spawn,
} from "./host-docker"
import { loadPins } from "../pins"
import type { Deps } from "../server"

/** The engine the fake host's current context answers at, unless a test says another. */
export const FAKE_ENDPOINT = "unix:///var/run/docker.sock"

/**
 * The shell the fake world's calls start from: it names another engine, as
 * a maintainer's shell might, and no call may follow it.
 */
export const FAKE_SHELL: Readonly<Record<string, string>> = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/maintainer",
  DOCKER_HOST: "ssh://maintainer@server.invalid",
  DOCKER_CONTEXT: "server",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/Users/maintainer/.docker/server",
  DOCKER_CONFIG: "/Users/maintainer/.docker",
}

type Container = {
  readonly image: string
  readonly network: string | undefined
  readonly volume: string | undefined
}

/** What BUILDX_CONFIG was when a call ran. */
export type BuildxSeen = {
  readonly path: string | undefined
  readonly folder: boolean
  readonly empty: boolean
}

/** What DOCKER_CONFIG was when a call ran: its path, and its config.json then. */
export type ConfigSeen = {
  readonly path: string | undefined
  readonly json: string | undefined
}

export type FakeHost = {
  readonly containers: Map<string, Container>
  readonly volumes: Set<string>
  readonly networks: Set<string>
  /** Each container's, volume's and network's label, by its name. */
  readonly labels: Map<string, string>
  /** Each image by the reference it was pulled by, with its `docker image ls` line. */
  readonly images: Map<string, string>
  /** The host's build records, as `docker buildx history ls` counts them. */
  records: number
  /** Whether the host's Docker answers. */
  answers: boolean
  /** What `docker version` answers inside the server; an apt run of an engine changes it. */
  engineVersion: string
  /** What `uname -m` answers inside the server. */
  arch: string
  /** What `docker context inspect` answers: the engine of the current context. */
  endpoint: string
  /** What the stand-in's `OOMKilled` is. */
  oomKilled: boolean
  readonly calls: Call[]
  readonly buildx: BuildxSeen[]
  readonly configs: ConfigSeen[]
  /** A test's failure: the answer for the calls it names, or undefined. */
  failWhen: ((args: readonly string[]) => Answer | undefined) | undefined
  /** Run after each call, as another program on the machine might act meanwhile. */
  after: ((args: readonly string[]) => void) | undefined
  readonly spawn: Spawn
  /** The helper on this fake host, at FAKE_ENDPOINT, from FAKE_SHELL. */
  docker(id?: string): HostDocker
}

export const HOST_KEY_LINE =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHostKeyOfTheStandIn root@zekno-check"

const ok = (stdout = ""): Answer => ({ code: 0, stdout, stderr: "" })
const fail = (stderr: string, code = 1): Answer => ({
  code,
  stdout: "",
  stderr,
})
const lines = (names: Iterable<string>) =>
  [...names]
    .filter((name) => name.includes("zekno-check-"))
    .map((name) => `${name}\n`)
    .join("")

/** The line `docker image ls` would give an image pulled by digest. */
export function imageLine(reference: string): string {
  const [name, digest] = reference.split("@") as [string, string]
  return `sha256:${digest.slice(7, 19)}${"0".repeat(52)} ${name}:<none>@${digest}`
}

export function fakeHost(): FakeHost {
  const host: FakeHost = {
    containers: new Map(),
    volumes: new Set(),
    networks: new Set(),
    labels: new Map(),
    images: new Map(),
    records: 7,
    answers: true,
    engineVersion: "29.5.0",
    arch: "aarch64",
    endpoint: FAKE_ENDPOINT,
    oomKilled: false,
    calls: [],
    buildx: [],
    configs: [],
    failWhen: undefined,
    after: undefined,
    spawn: async (call) => {
      host.calls.push(call)
      const path = call.env.BUILDX_CONFIG
      const folder =
        path !== undefined && existsSync(path) && statSync(path).isDirectory()
      host.buildx.push({
        path,
        folder,
        empty: folder && readdirSync(path).length === 0,
      })
      const config = call.env.DOCKER_CONFIG
      const file =
        config === undefined ? undefined : join(config, "config.json")
      host.configs.push({
        path: config,
        json:
          file !== undefined && existsSync(file)
            ? readFileSync(file, "utf8")
            : undefined,
      })
      const answer = host.failWhen?.(call.args) ?? answerOf(host, call.args)
      host.after?.(call.args)
      return answer
    },
    docker: (id) =>
      hostDocker({
        id,
        endpoint: FAKE_ENDPOINT,
        spawn: host.spawn,
        env: FAKE_SHELL,
      }),
  }
  return host
}

/** The label a listing filters on, `zekno-check=<id>`, or undefined. */
function labelFilter(args: readonly string[]): string | undefined {
  const at = args.findIndex(
    (arg, index) => args[index - 1] === "--filter" && arg.startsWith("label=")
  )
  return at < 0 ? undefined : args[at]!.slice("label=".length)
}

/** The names of `names` a listing gives: those with the label it filters on, when it filters on one. */
function listed(
  host: FakeHost,
  args: readonly string[],
  names: Iterable<string>
): string {
  const label = labelFilter(args)
  return lines(
    [...names].filter(
      (name) => label === undefined || host.labels.get(name) === label
    )
  )
}

function exec(host: FakeHost, rest: readonly string[]): Answer {
  const command = rest[0] === "-i" ? rest.slice(1) : rest
  const [container, ...run] = command as [string, ...string[]]
  if (!host.containers.has(container))
    return fail(`Error response from daemon: No such container: ${container}`)
  const [program, first] = run
  if (program === "uname") return ok(`${host.arch}\n`)
  if (program === "cat" && first?.endsWith(".pub"))
    return ok(`${HOST_KEY_LINE}\n`)
  if (program === "docker" && first === "version")
    return ok(`${host.engineVersion}\n`)
  if (program === "docker" && first === "pull") return ok(`${run.at(-1)}\n`)
  if (program === "/usr/local/bin/zekno-runner" && first === "version")
    return ok('{"version":"0.1.1"}\n')
  if (program === "sh" && first === "-c") {
    const engine =
      /(?:^|\s)(?:docker-ce|docker\.io)=(?:[0-9]+:)?([0-9][0-9.]*)-/.exec(
        run[2] ?? ""
      )
    if (engine) host.engineVersion = engine[1]!
    return ok()
  }
  return ok()
}

function answerOf(host: FakeHost, args: readonly string[]): Answer {
  const [, command, sub] = args
  const last = args.at(-1)!
  // The context is read from the CLI's own files, whether the engine answers or not.
  if (`${command} ${sub}` === "context inspect") return ok(`${host.endpoint}\n`)
  if (!host.answers)
    return fail(
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
    )
  const inUse = (test: (container: Container) => boolean) =>
    [...host.containers.values()].some(test)
  switch (`${command} ${sub}`) {
    case "volume ls":
      return ok(listed(host, args, host.volumes))
    case "network ls":
      return ok(listed(host, args, host.networks))
    case "container inspect":
      return host.containers.has(last)
        ? ok(`${host.oomKilled}\n`)
        : fail(`Error response from daemon: No such container: ${last}`)
    case "image ls":
      return ok(
        [...host.images.values()]
          .sort()
          .map((line) => `${line}\n`)
          .join("")
      )
    case "image inspect":
      return host.images.has(last)
        ? ok("sha256:0123\n")
        : fail(`Error response from daemon: No such image: ${last}`)
    case "image rm":
      if (!host.images.has(last))
        return fail(`Error response from daemon: No such image: ${last}`)
      if (inUse((container) => container.image === last))
        return fail(
          `Error response from daemon: conflict: unable to delete ${last} (must be forced) - image is being used by a container`
        )
      host.images.delete(last)
      return ok(`Untagged: ${last}\n`)
    case "buildx history":
      return ok(
        Array.from(
          { length: host.records },
          (_, n) => `{"ref":"r${n}","name":"build ${n}"}\n`
        ).join("")
      )
    case "volume create":
      if (host.volumes.has(last)) return fail("volume exists")
      host.volumes.add(last)
      host.labels.set(last, args[4]!)
      return ok(`${last}\n`)
    case "network create":
      if (host.networks.has(last)) return fail("network exists")
      host.networks.add(last)
      host.labels.set(last, args[4]!)
      return ok("f00d\n")
    case "volume rm":
      if (!host.volumes.has(last))
        return fail(`Error response from daemon: get ${last}: no such volume`)
      if (inUse((container) => container.volume === last))
        return fail(
          `Error response from daemon: remove ${last}: volume is in use`
        )
      host.volumes.delete(last)
      host.labels.delete(last)
      return ok(`${last}\n`)
    case "network rm":
      if (!host.networks.has(last))
        return fail(`Error response from daemon: network ${last} not found`)
      if (inUse((container) => container.network === last))
        return fail(
          `Error response from daemon: error while removing network: network ${last} has active endpoints`
        )
      host.networks.delete(last)
      host.labels.delete(last)
      return ok(`${last}\n`)
  }
  switch (command) {
    case "version":
      return ok("29.6.1\n")
    case "ps":
      return ok(listed(host, args, host.containers.keys()))
    case "pull":
      host.images.set(last, imageLine(last))
      return ok(`${last}\n`)
    case "rm":
      host.containers.delete(last)
      host.labels.delete(last)
      return ok(`${last}\n`)
    case "exec":
      return exec(host, args.slice(2))
    case "run": {
      const value = (flag: string) => {
        const at = args.indexOf(flag)
        return at < 0 ? undefined : args[at + 1]
      }
      const name = value("--name")!
      const network = value("--network")
      const volume = value("--volume")?.split(":")[0]
      const image = args.find((arg) => arg.includes("@sha256:"))!
      if (host.containers.has(name)) return fail("name in use")
      if (network !== undefined && !host.networks.has(network))
        return fail(`network ${network} not found`, 125)
      if (!host.images.has(image))
        return fail(`Unable to find image '${image}' locally`, 125)
      host.containers.set(name, { image, network, volume })
      host.labels.set(name, value("--label")!)
      return ok("c0ffee\n")
    }
  }
  return fail(`the fake host has no answer for ${args.join(" ")}`, 125)
}

export const CLIENT_KEY_LINE =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIClientKeyOfTheRun zekno-check-a1b2c3d4-client"

/** A command `server.ts` ran on this machine (ssh-keygen, the runner's compile). */
export type LocalCall = {
  readonly args: readonly string[]
  readonly cwd: string
}

export type FakeWorld = {
  readonly host: FakeHost
  readonly deps: Deps
  /** What `server.ts` printed, line by line. */
  readonly lines: string[]
  readonly local: LocalCall[]
  /** Where the run folders go, in place of the system's temporary folder. */
  readonly root: string
  /** In place of `apps/runner`: the compile's stand-in writes its file under `dist/`. */
  readonly runnerDir: string
}

/** The folders the fake worlds made, until `removeFakeWorlds`. */
const made: string[] = []

/** Removes every folder a fake world made; a test file runs it after each test. */
export function removeFakeWorlds(): void {
  for (const folder of made.splice(0))
    rmSync(folder, { recursive: true, force: true })
}

/**
 * `server.ts`'s dependencies with Docker, ssh-keygen and the compile stood
 * in for: the run id `a1b2c3d4`, the port 24680, a clock that moves one
 * second at each reading, and a shell that names another engine
 * (`FAKE_SHELL`). Host Docker still goes through `host-docker.ts`, and the
 * engine is read from the fake host's context. Its two folders go with
 * `removeFakeWorlds`.
 */
export function fakeWorld(): FakeWorld {
  const host = fakeHost()
  const root = mkdtempSync(join(tmpdir(), "zekno-server-root-"))
  const runnerDir = mkdtempSync(join(tmpdir(), "zekno-server-runner-"))
  made.push(root, runnerDir)
  const lines: string[] = []
  const local: LocalCall[] = []
  let clock = 0
  const deps: Deps = {
    docker: (endpoint, id) =>
      hostDocker({ id, endpoint, spawn: host.spawn, env: FAKE_SHELL }),
    endpoint: () => resolveEndpoint(host.spawn, FAKE_SHELL),
    local: async (args, options) => {
      local.push({ args: [...args], cwd: options.cwd })
      if (args[0] === "ssh-keygen") {
        const file = args.at(-1)!
        writeFileSync(file, "PRIVATE KEY OF THE TEST\n")
        writeFileSync(`${file}.pub`, `${CLIENT_KEY_LINE}\n`)
      } else {
        const target = args.at(-1)!.replace("compile:", "zekno-runner-")
        mkdirSync(join(options.cwd, "dist"), { recursive: true })
        writeFileSync(join(options.cwd, "dist", target), "ELF\n")
      }
      return { code: 0, stdout: "", stderr: "" }
    },
    portFree: () => true,
    root,
    runnerDir,
    say: (line) => lines.push(line),
    pins: loadPins(),
    newId: () => "a1b2c3d4",
    choosePort: () => 24680,
    now: () => (clock += 1000),
  }
  return { host, deps, lines, local, root, runnerDir }
}
