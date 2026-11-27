/**
 * The stand-in for the Docker calls of feature 016 (specs/016-build-from-
 * source, contracts/runner.md, "Tests" first bullet). The stand-in's shell
 * script (`fake.ts`) records each call, then `exec`s this with its folder,
 * the folder the call was made in, and Docker's arguments for `version`,
 * `info`, `context show` and `buildx version`, `inspect`, `build`,
 * `history`, `prune` and `du`. It answers from the model's `docker` part (`model.ts`,
 * `ScriptedDocker`) the way Docker 29 and its buildx print, as far as the
 * runner reads them to know whether Docker can build (RB5), where Docker
 * keeps its data and how much memory the machine has (RB6, RB17); a build
 * itself is `stand-in-buildx-build.ts`'s, Docker's records and the build
 * cache `stand-in-buildx-records.ts`'s. Each call's argument list goes to
 * `argv.jsonl`, in order with the calls `stand-in.ts` answers.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"

import {
  builderOf,
  changeModel,
  goArch,
  nodeOf,
  scriptedDocker,
  type Model,
  type ScriptedDocker,
} from "./model"
import { build } from "./stand-in-buildx-build"
import { buildHelp, pruneHelp } from "./stand-in-buildx-help"
import { du, history, prune, type Reply } from "./stand-in-buildx-records"
import { formatOf, render } from "./stand-in-format"
import { fail, out, type Answer } from "./stand-in-proxy"

const [dir, cwd, ...args] = process.argv.slice(2) as [
  string,
  string,
  ...string[],
]
appendFileSync(join(dir, "argv.jsonl"), `${JSON.stringify(args)}\n`)

/** What Docker 29 prints when the buildx plugin is not installed. */
const NO_BUILDX =
  "docker: unknown command: docker buildx\n\nRun 'docker --help' for more information\n"

/** What the Docker client prints when no engine answers. */
const NO_ENGINE =
  "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n"

/** The client's own version, which stays when the engine is scripted older or gone. */
const CLIENT_VERSION = "29.6.1"

/** The processor as the kernel names it (`docker info`'s `Architecture`). */
const kernelArch = (arch: string) =>
  arch === "arm64" ? "aarch64" : arch === "amd64" ? "x86_64" : arch

/** The platforms a builder on this processor lists. */
const platforms = (arch: string) =>
  goArch(arch) === "amd64"
    ? "linux/amd64, linux/amd64/v2, linux/amd64/v3, linux/386"
    : goArch(arch) === "arm64"
      ? "linux/arm64, linux/arm/v7, linux/arm/v6"
      : `linux/${arch}`

/** A template filled and ended with a line feed, as Docker prints it; Docker's error and exit 1 for a field it lacks. */
function formatted(template: string, value: unknown): Answer {
  const filled = render(template, value)
  return "error" in filled
    ? fail(`template parsing error: ${filled.error}\n`)
    : out(`${filled.text}\n`)
}

/** `docker version`: the client's half always, the engine's when one answers. */
function version(docker: ScriptedDocker, words: string[]): Answer {
  const client = {
    Platform: { Name: "Docker Engine - Community" },
    Version: CLIENT_VERSION,
    ApiVersion: "1.53",
    DefaultAPIVersion: "1.53",
    GitCommit: "9f2c4e1",
    GoVersion: "go1.25.9",
    Os: "linux",
    Arch: goArch(docker.arch),
    BuildTime: "Tue Nov 17 10:12:41 2026",
    Context: docker.context,
  }
  const server =
    docker.engine === null
      ? null
      : {
          Platform: { Name: "Docker Engine - Community" },
          Components: [
            {
              Name: "Engine",
              Version: docker.engine,
              Details: {
                ApiVersion: "1.53",
                Arch: docker.arch,
                MinAPIVersion: "1.44",
                Os: "linux",
              },
            },
            { Name: "containerd", Version: "v2.4.2", Details: {} },
            { Name: "runc", Version: "1.4.1", Details: {} },
          ],
          Version: docker.engine,
          ApiVersion: "1.53",
          MinAPIVersion: "1.44",
          GitCommit: "3d1e0f7",
          GoVersion: "go1.25.9",
          Os: "linux",
          Arch: docker.arch,
          KernelVersion: "6.8.0-90-generic",
          BuildTime: "2026-11-17T10:12:41.000000000+00:00",
        }
  const template = formatOf(words)
  const shown =
    template === undefined
      ? out(
          [
            "Client: Docker Engine - Community",
            ` Version:           ${CLIENT_VERSION}`,
            ` OS/Arch:           linux/${client.Arch}`,
            ` Context:           ${docker.context}`,
            ...(server === null
              ? []
              : [
                  "",
                  "Server: Docker Engine - Community",
                  " Engine:",
                  `  Version:          ${server.Version}`,
                  `  OS/Arch:          linux/${server.Arch}`,
                ]),
            "",
          ].join("\n")
        )
      : formatted(template, { Client: client, Server: server })
  if (server !== null) return shown
  return { code: 1, stdout: shown.stdout ?? "", stderr: NO_ENGINE }
}

/** `docker info`: where Docker keeps its data and the machine's memory, among the rest. */
function info(docker: ScriptedDocker, words: string[]): Answer {
  if (docker.engine === null) return fail(NO_ENGINE)
  const facts = {
    ID: "5c0e2a7d-3b1f-4c55-9e0a-7a1f3c2b9d10",
    Containers: 0,
    ContainersRunning: 0,
    Images: 0,
    Driver: "overlayfs",
    DockerRootDir: docker.dockerRootDir,
    MemTotal: docker.memTotal,
    NCPU: 4,
    Architecture: kernelArch(docker.arch),
    OSType: "linux",
    OperatingSystem: "Ubuntu 24.04.3 LTS",
    KernelVersion: "6.8.0-90-generic",
    ServerVersion: docker.engine,
    Name: "server",
  }
  const template = formatOf(words)
  if (template !== undefined) return formatted(template, facts)
  return out(
    [
      "Server:",
      ` Server Version: ${facts.ServerVersion}`,
      ` Storage Driver: ${facts.Driver}`,
      ` Architecture: ${facts.Architecture}`,
      ` CPUs: ${facts.NCPU}`,
      ` Total Memory: ${(facts.MemTotal / 2 ** 30).toFixed(3)}GiB`,
      ` Docker Root Dir: ${facts.DockerRootDir}`,
      "",
    ].join("\n")
  )
}

/** Lines of `key: value`, the values lined up a space after the longest key, as buildx's printer does. */
const aligned = (rows: [string, string][]) => {
  const width = Math.max(...rows.map(([key]) => key.length)) + 1
  return rows.map(([key, value]) => `${key.padEnd(width)}${value}`)
}

/** `docker buildx inspect [--builder <name>]`: the builder's driver, and its node's status and BuildKit version. */
function inspect(docker: ScriptedDocker, words: string[]): Answer {
  const positional = words.find(
    (word, i) => !word.startsWith("-") && words[i - 1] !== "--builder"
  )
  const name = positional ?? builderOf(words, docker)
  if (name !== docker.context)
    return fail(`ERROR: no builder ${JSON.stringify(name)} found\n`)
  if (docker.engine === null) return fail(`ERROR: ${NO_ENGINE}`)
  const endpoint =
    docker.driver === "docker" ? name : "unix:///var/run/docker.sock"
  return out(
    [
      ...aligned([
        ["Name:", name],
        ["Driver:", docker.driver],
        ["Last Activity:", "2026-11-27 10:00:00 +0000 UTC"],
      ]),
      "",
      "Nodes:",
      ...aligned([
        ["Name:", nodeOf(name, docker)],
        ["Endpoint:", endpoint],
        ["Status:", "running"],
        ["BuildKit version:", docker.buildkit],
        ["Platforms:", platforms(docker.arch)],
      ]),
      "Labels:",
      " org.mobyproject.buildkit.worker.moby.host-gateway-ip: 172.17.0.1",
      "GC Policy rule#0:",
      ...aligned([
        [" All:", "false"],
        [
          " Filters:",
          "type==source.local,type==exec.cachemount,type==source.git.checkout",
        ],
        [" Keep Duration:", "48h0m0s"],
        [" Max Used Space:", "3.5GiB"],
      ]),
      "",
    ].join("\n")
  )
}

/** `docker buildx …` with buildx installed: its version, a builder, a help text, its records and its cache. */
function buildx(model: Model, words: string[]): Reply {
  const docker = scriptedDocker(model)
  const [verb, ...rest] = words
  if (rest.includes("--help") && verb === "build")
    return out(buildHelp(docker.policy))
  if (rest.includes("--help") && verb === "prune")
    return out(pruneHelp(docker.maxUsedSpace))
  if (verb === "version")
    return out(`github.com/docker/buildx ${docker.buildx} 8a7c1d2\n`)
  if (verb === "inspect") return inspect(docker, rest)
  if (verb === "history") return history(model, rest)
  if (verb === "prune") return prune(model, rest)
  if (verb === "du") return du(model)
  return fail(`the stand-in does not know docker buildx ${words.join(" ")}\n`)
}

/** A call scripted to fail, or a buildx call without the plugin; undefined for any other. */
function refusal(model: Model): Reply | undefined {
  const failing = model.script.failing?.find((words) =>
    args.join(" ").startsWith(words)
  )
  if (failing) return fail(`Error response from daemon: ${failing} failed\n`)
  if (args[0] === "buildx" && scriptedDocker(model).buildx === null)
    return fail(NO_BUILDX)
  return undefined
}

function answer(model: Model): Reply {
  const refused = refusal(model)
  if (refused) return refused
  const docker = scriptedDocker(model)
  const [verb, ...rest] = args
  if (verb === "version") return version(docker, rest)
  if (verb === "info") return info(docker, rest)
  if (verb === "context" && rest[0] === "show")
    return out(`${docker.context}\n`)
  if (verb === "buildx") return buildx(model, rest)
  return fail(`the stand-in does not know docker ${args.join(" ")}\n`)
}

/** A build runs on, in this process, once nothing refuses it; every other call is answered at once. */
const building =
  args[0] === "buildx" && args[1] === "build" && !args.includes("--help")
const result = changeModel(dir, (model) =>
  building ? refusal(model) : answer(model)
)
if (result === undefined) await build(dir, cwd, args)
else if (result.hang) {
  // A call that never ends by itself, such as a prune scripted to hang.
  setInterval(() => {}, 1 << 30)
} else {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.code ?? 0)
}
