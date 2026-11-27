/**
 * The one way the stand-in's scripts call Docker on the host
 * (`host-docker.ts`; specs/016-build-from-source, T008; tasks.md, "Rules
 * every task keeps"): every call names the run's engine, a socket of this
 * machine, whatever the shell says, and gets a BUILDX_CONFIG and a
 * DOCKER_CONFIG of its own. Which calls get through is `host-calls.ts`'s,
 * tested beside it. No test here runs Docker: the spawn is a stand-in that
 * records what it was given.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { configJson } from "./endpoint"
import { FAKE_ENDPOINT, FAKE_SHELL, fakeHost } from "./fake-host"
import {
  hostDocker,
  hostEnv,
  resolveEndpoint,
  type Call,
  type Spawn,
} from "./host-docker"
import { loadPins } from "../pins"
import { namesOf } from "../stand-in/plan"

const ID = "a1b2c3d4"
const NAMES = namesOf(ID)
const UBUNTU = loadPins().images.ubuntu.image

/** Reads, with or without a run's id. */
const READ_ONLY = [
  ["docker", "version", "--format", "{{.Server.Version}}"],
  [
    "docker",
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    "name=zekno-check-",
    "--format",
    "{{.Names}}",
  ],
  ["docker", "image", "inspect", "--format", "{{.Id}}", UBUNTU],
  ["docker", "buildx", "history", "ls", "--format", "json"],
]

/** Calls that name something of this run. */
const BOUND = [
  ["docker", "pull", "--quiet", UBUNTU],
  ["docker", "exec", NAMES.server, "uname", "-m"],
  ["docker", "rm", "--force", NAMES.client],
  [
    "docker",
    "container",
    "inspect",
    "--format",
    "{{.State.OOMKilled}}",
    NAMES.server,
  ],
]

describe("which engine answers", () => {
  const REMOTE = [
    "ssh://maintainer@server.invalid",
    "tcp://203.0.113.7:2376",
    "tcp://127.0.0.1:2375",
    "npipe:////./pipe/docker_engine",
    "fd://",
    "unix://relative.sock",
    "",
  ]

  test("every call names the engine it was given, never the shell's DOCKER_HOST, context or TLS", async () => {
    const host = fakeHost()
    const docker = host.docker(ID)
    expect(docker.endpoint).toBe(FAKE_ENDPOINT)
    for (const args of [...READ_ONLY, ...BOUND]) await docker.run(args)
    expect(host.calls).toHaveLength(READ_ONLY.length + BOUND.length)
    for (const call of host.calls) {
      expect(call.env.DOCKER_HOST).toBe(FAKE_ENDPOINT)
      for (const name of [
        "DOCKER_CONTEXT",
        "DOCKER_TLS",
        "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH",
      ])
        expect({ name, value: call.env[name] }).toEqual({
          name,
          value: undefined,
        })
      expect(call.env.DOCKER_CONFIG).not.toBe(FAKE_SHELL.DOCKER_CONFIG)
    }
  })

  test("an engine that is not a socket of this machine is refused before any call", () => {
    for (const endpoint of REMOTE)
      expect(() => hostDocker({ endpoint, spawn: fakeHost().spawn })).toThrow(
        "not a socket of this machine"
      )
    expect(() => hostEnv({ buildx: "/tmp/x", endpoint: REMOTE[0]! })).toThrow(
      "not a socket of this machine"
    )
  })

  test("the host's context is read once, without the shell's DOCKER_HOST or context, and only a socket of this machine is taken", async () => {
    const host = fakeHost()
    host.endpoint = "unix:///Users/maintainer/.docker/run/docker.sock"
    expect(await resolveEndpoint(host.spawn, FAKE_SHELL)).toBe(host.endpoint)
    expect(host.calls).toHaveLength(1)
    const call = host.calls[0]!
    expect(call.args).toEqual([
      "docker",
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ])
    expect(call.env.DOCKER_HOST).toBeUndefined()
    expect(call.env.DOCKER_CONTEXT).toBeUndefined()
    // The host's own configuration names its contexts.
    expect(call.env.DOCKER_CONFIG).toBe(FAKE_SHELL.DOCKER_CONFIG)
    expect(existsSync(call.env.BUILDX_CONFIG!)).toBe(false)
    for (const endpoint of REMOTE) {
      host.endpoint = endpoint
      await expect(resolveEndpoint(host.spawn, FAKE_SHELL)).rejects.toThrow(
        /^Docker's current context answers at .*, not at a socket of this machine/
      )
    }
    host.failWhen = () => ({
      code: 1,
      stdout: "",
      stderr: 'context "gone": context not found\n',
    })
    await expect(resolveEndpoint(host.spawn, FAKE_SHELL)).rejects.toThrow(
      'docker context inspect failed (exit 1): context "gone": context not found'
    )
  })
})

describe("DOCKER_CONFIG", () => {
  test("every call gets one of its own whose config.json names only the CLI's plugin folders, removed after the call", async () => {
    const host = fakeHost()
    const plugins = ["/Users/maintainer/.docker/cli-plugins"]
    const docker = hostDocker({
      id: ID,
      endpoint: FAKE_ENDPOINT,
      spawn: host.spawn,
      env: FAKE_SHELL,
      pluginDirs: plugins,
    })
    await docker.run(["docker", "pull", "--quiet", UBUNTU])
    await docker.run(READ_ONLY[0]!)
    expect(host.configs).toHaveLength(2)
    for (const seen of host.configs) {
      expect(seen.path!.startsWith(tmpdir())).toBe(true)
      expect(seen.json).toBe(configJson(plugins))
      expect(JSON.parse(seen.json!)).toEqual({ cliPluginsExtraDirs: plugins })
      expect(existsSync(seen.path!)).toBe(false)
    }
    expect(host.configs[0]!.path).not.toBe(host.configs[1]!.path)
    // With an injected spawn and no folders given, no file of the host's is read.
    const bare = fakeHost()
    await bare.docker().run(READ_ONLY[0]!)
    expect(bare.configs[0]!.json).toBe("{}\n")
  })
})

describe("BUILDX_CONFIG", () => {
  test("every call gets a fresh, empty folder of its own, removed after the call", async () => {
    const host = fakeHost()
    const docker = host.docker(ID)
    for (const args of READ_ONLY) await docker.run(args)
    await docker.run(["docker", "pull", "--quiet", UBUNTU])
    await docker.run(["docker", "image", "rm", UBUNTU])
    expect(host.calls).toHaveLength(READ_ONLY.length + 2)
    const folders = host.buildx.map((seen) => seen.path)
    expect(new Set(folders).size).toBe(host.calls.length)
    for (const seen of host.buildx) {
      expect(seen.folder).toBe(true)
      expect(seen.empty).toBe(true)
      expect(seen.path!.startsWith(tmpdir())).toBe(true)
      expect(seen.path!.startsWith(join(homedir(), ".docker"))).toBe(false)
      expect(existsSync(seen.path!)).toBe(false)
    }
  })

  test("the folder is removed when the call throws", async () => {
    const seen: string[] = []
    const spawn: Spawn = async (call) => {
      seen.push(call.env.BUILDX_CONFIG!)
      throw new Error("docker went away")
    }
    await expect(
      hostDocker({ endpoint: FAKE_ENDPOINT, spawn }).run(READ_ONLY[0]!)
    ).rejects.toThrow("docker went away")
    expect(seen).toHaveLength(1)
    expect(existsSync(seen[0]!)).toBe(false)
  })

  test("the environment: the run's engine and folders, no hints or hooks, no builder or engine chosen from outside, the rest kept", () => {
    const shell = {
      PATH: "/usr/bin",
      HOME: "/home/x",
      DOCKER_HOST: "ssh://maintainer@server.invalid",
      DOCKER_CONTEXT: "server",
      DOCKER_TLS: "1",
      DOCKER_TLS_VERIFY: "1",
      DOCKER_CERT_PATH: "/home/x/.docker/server",
      DOCKER_CONFIG: "/home/x/.docker",
      BUILDX_BUILDER: "mine",
      BUILDX_CONFIG: join(homedir(), ".docker", "buildx"),
      EMPTY: undefined,
    }
    expect(
      hostEnv(
        {
          buildx: "/tmp/zekno-host-docker-x/buildx",
          config: "/tmp/zekno-host-docker-x/config",
          endpoint: "unix:///run/docker.sock",
        },
        shell
      )
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      DOCKER_HOST: "unix:///run/docker.sock",
      DOCKER_CONFIG: "/tmp/zekno-host-docker-x/config",
      BUILDX_CONFIG: "/tmp/zekno-host-docker-x/buildx",
      DOCKER_CLI_HINTS: "false",
      DOCKER_CLI_HOOKS: "false",
    })
    // The one read of the context: the host's configuration, and no engine named.
    expect(hostEnv({ buildx: "/tmp/b" }, shell)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      DOCKER_CONFIG: "/home/x/.docker",
      BUILDX_CONFIG: "/tmp/b",
      DOCKER_CLI_HINTS: "false",
      DOCKER_CLI_HOOKS: "false",
    })
  })

  test("standard input and the time limit reach the spawn", async () => {
    const calls: Call[] = []
    const spawn: Spawn = async (call) => {
      calls.push(call)
      return { code: 0, stdout: "", stderr: "" }
    }
    const docker = hostDocker({ id: ID, endpoint: FAKE_ENDPOINT, spawn })
    await docker.run(
      ["docker", "exec", "-i", NAMES.server, "sh", "-c", "cat"],
      {
        stdin: { file: "/tmp/runner" },
        timeoutMs: 5000,
      }
    )
    await docker.run(READ_ONLY[0]!)
    expect(calls[0]!.stdin).toEqual({ file: "/tmp/runner" })
    expect(calls[0]!.timeoutMs).toBe(5000)
    expect(calls[1]!.stdin).toBeUndefined()
    expect(calls[1]!.timeoutMs).toBeGreaterThan(0)
  })
})
