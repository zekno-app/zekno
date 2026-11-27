/**
 * `server.ts up` (`up.ts`; specs/016-build-from-source, T008;
 * research/map-checks.md part 6; LC8): it reads once which engine the
 * host's context answers at and goes on only for a socket of this machine,
 * whatever the shell's DOCKER_HOST says; it runs the plan's lists in order
 * through `host-docker.ts` on that engine, stops on anything left from an earlier run,
 * notes which host images were there before it pulls, places the runner of
 * this commit and prints the switch and the port; a failed `up` removes what
 * it made. Docker, ssh-keygen and the compile are stood in for
 * (`fake-host.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PROXY_IMAGE } from "../../../../src/proxy/image"
import {
  CLIENT_KEY_LINE,
  FAKE_ENDPOINT,
  FAKE_SHELL,
  fakeWorld,
  HOST_KEY_LINE,
  removeFakeWorlds,
} from "../host/fake-host"
import { labelledLists } from "../host/host-lists"
import { planStandIn, type Options } from "./plan"
import { runFolder } from "./run-folder"
import { knownHostsLine, sshdCommand } from "./sshd"
import { PLACE_RUNNER, up } from "./up"

const ID = "a1b2c3d4"
const SERVER = `zekno-check-${ID}-server`
const FLOOR: Options = { engine: "floor", store: "containerd", memory: false }
const DOWN = `bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id ${ID}`
const LEFTOVERS = [
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
  [
    "docker",
    "volume",
    "ls",
    "--filter",
    "name=zekno-check-",
    "--format",
    "{{.Name}}",
  ],
  [
    "docker",
    "network",
    "ls",
    "--filter",
    "name=zekno-check-",
    "--format",
    "{{.Name}}",
  ],
]
const IMAGES = [
  "docker",
  "image",
  "ls",
  "--all",
  "--no-trunc",
  "--digests",
  "--format",
  "{{.ID}} {{.Repository}}:{{.Tag}}@{{.Digest}}",
]
const RECORDS = ["docker", "buildx", "history", "ls", "--format", "json"]
const CONTEXT = [
  "docker",
  "context",
  "inspect",
  "--format",
  "{{.Endpoints.docker.Host}}",
]
const LABELLED = Object.values(labelledLists(ID))

const argsOf = (world: ReturnType<typeof fakeWorld>) =>
  world.host.calls.map((call) => call.args)

afterEach(removeFakeWorlds)

describe("up", () => {
  test("runs the plan's lists in order, places the runner, and prints the switch and the port", async () => {
    const world = fakeWorld()
    const ubuntu = world.deps.pins.images.ubuntu.image
    expect(await up(FLOOR, world.deps)).toBe(0)
    const folder = runFolder(world.root, ID)
    const plan = planStandIn(world.deps.pins, FLOOR, {
      id: ID,
      port: 24680,
      keyFolder: folder,
    })
    expect(argsOf(world)).toEqual([
      CONTEXT,
      ["docker", "version", "--format", "{{.Server.Version}}"],
      ...LEFTOVERS,
      IMAGES,
      RECORDS,
      ["docker", "image", "inspect", "--format", "{{.Id}}", ubuntu],
      ["docker", "pull", "--quiet", ubuntu],
      plan.volume,
      plan.network,
      plan.server,
      plan.install,
      plan.daemon,
      [
        "docker",
        "exec",
        SERVER,
        "docker",
        "version",
        "--format",
        "{{.Server.Version}}",
      ],
      sshdCommand(SERVER, CLIENT_KEY_LINE),
      plan.hostKey,
      ["docker", "exec", SERVER, "uname", "-m"],
      ["docker", "exec", "-i", SERVER, "sh", "-c", PLACE_RUNNER],
      ["docker", "exec", SERVER, "/usr/local/bin/zekno-runner", "version"],
      ["docker", "exec", SERVER, "docker", "pull", "--quiet", PROXY_IMAGE],
    ])
    expect(world.local).toEqual([
      { args: plan.clientKey, cwd: folder },
      {
        args: [process.execPath, "--no-env-file", "run", "compile:linux-arm64"],
        cwd: world.runnerDir,
      },
    ])
    const place = world.host.calls.find((call) =>
      call.args.includes(PLACE_RUNNER)
    )!
    expect(place.stdin).toEqual({
      file: join(world.runnerDir, "dist", "zekno-runner-linux-arm64"),
    })
    expect(world.lines[0]).toBe(
      `zekno-check-${ID}: remove what this run makes with ${DOWN}; it runs on Docker at ${FAKE_ENDPOINT}`
    )
    expect(
      JSON.parse(readFileSync(join(folder, "run.json"), "utf8")).endpoint
    ).toBe(FAKE_ENDPOINT)
    expect(world.lines).toContain(`ZEKNO_LINUX_SERVER=${SERVER}`)
    expect(world.lines).toContain(
      `sshd on 127.0.0.1:24680; the client key and known_hosts are in ${folder}`
    )
    expect(world.lines.at(-1)).toMatch(
      /^Up in \d+ s: engine floor \(29\.5\.0\), store containerd, runner 0\.1\.1\.$/
    )
    expect(readFileSync(join(folder, "known_hosts"), "utf8")).toBe(
      `${knownHostsLine(24680, HOST_KEY_LINE)}\n`
    )
    expect(statSync(folder).mode & 0o777).toBe(0o700)
    expect(statSync(join(folder, "run.json")).mode & 0o777).toBe(0o600)
  })

  test("every call after the one read of the context names that engine, never the shell's", async () => {
    const world = fakeWorld()
    expect(FAKE_SHELL.DOCKER_HOST).toStartWith("ssh://")
    expect(await up(FLOOR, world.deps)).toBe(0)
    const [context, ...calls] = world.host.calls
    expect(context!.args).toEqual(CONTEXT)
    expect(context!.env.DOCKER_HOST).toBeUndefined()
    expect(calls.length).toBeGreaterThan(15)
    for (const call of calls) {
      expect(call.env.DOCKER_HOST).toBe(FAKE_ENDPOINT)
      expect(call.env.DOCKER_CONTEXT).toBeUndefined()
      expect(call.env.DOCKER_CONFIG).not.toBe(FAKE_SHELL.DOCKER_CONFIG)
    }
  })

  test("a context on another machine stops it with one line, before anything is read or made", async () => {
    for (const endpoint of [
      "ssh://maintainer@server.invalid",
      "tcp://203.0.113.7:2376",
    ]) {
      const world = fakeWorld()
      world.host.endpoint = endpoint
      expect(await up(FLOOR, world.deps)).toBe(1)
      expect(world.lines).toEqual([
        `Docker's current context answers at ${JSON.stringify(endpoint)}, not at a socket of this machine (unix:///...); the stand-in is made only on this machine's own engine`,
      ])
      expect(argsOf(world)).toEqual([CONTEXT])
      expect(world.local).toEqual([])
      expect(existsSync(runFolder(world.root, ID))).toBe(false)
    }
  })

  test("the runner is written whole, with mode 755, and replaces the one before", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-place-"))
    try {
      const target = join(folder, "zekno-runner")
      const source = join(folder, "compiled")
      writeFileSync(source, "ELF runner bytes\n")
      writeFileSync(target, "older")
      const script = PLACE_RUNNER.replaceAll(
        "/usr/local/bin/zekno-runner",
        target
      )
      const run = Bun.spawnSync(["sh", "-c", script], {
        stdin: Bun.file(source),
      })
      expect(run.exitCode).toBe(0)
      expect(readFileSync(target, "utf8")).toBe("ELF runner bytes\n")
      expect(statSync(target).mode & 0o777).toBe(0o755)
      expect(existsSync(`${target}.part`)).toBe(false)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test("with --memory 1g the server is held to 1 GB, and x86-64 gets the x64 runner", async () => {
    const world = fakeWorld()
    world.host.arch = "x86_64"
    expect(await up({ ...FLOOR, memory: true }, world.deps)).toBe(0)
    const run = world.host.calls.find((call) => call.args[1] === "run")!
    expect(run.args.join(" ")).toContain("--memory 1g --memory-swap 1g")
    expect(world.local[1]!.args.at(-1)).toBe("compile:linux-x64")
    expect(world.lines.at(-1)).toContain(", held to 1 GB,")
  })

  test("anything named zekno-check-* stops it with one line on how to remove it, and nothing is made", async () => {
    const world = fakeWorld()
    world.host.containers.set("zekno-check-zzzzzzzz-server", {
      image: "x",
      network: undefined,
      volume: undefined,
    })
    world.host.containers.set("sessora-db", {
      image: "x",
      network: undefined,
      volume: undefined,
    })
    world.host.volumes.add("zekno-check-yyyyyyyy-data")
    world.host.networks.add("zekno-check-odd")
    expect(await up(FLOOR, world.deps)).toBe(1)
    expect(world.lines).toEqual([
      "Something named zekno-check-* is left from an earlier run: zekno-check-zzzzzzzz-server, zekno-check-yyyyyyyy-data, zekno-check-odd. Remove it with: bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id yyyyyyyy; bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id zzzzzzzz; docker network rm zekno-check-odd",
    ])
    expect(argsOf(world)).toEqual([
      CONTEXT,
      ["docker", "version", "--format", "{{.Server.Version}}"],
      ...LEFTOVERS,
    ])
    expect(world.local).toEqual([])
    expect(existsSync(runFolder(world.root, ID))).toBe(false)
  })

  test("Docker not answering stops it with one line", async () => {
    const world = fakeWorld()
    world.host.answers = false
    expect(await up(FLOOR, world.deps)).toBe(1)
    expect(world.lines).toEqual([
      `Docker does not answer at ${FAKE_ENDPOINT}: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?`,
    ])
    expect(world.host.calls).toHaveLength(2)
  })

  test("no free port stops it before anything is made", async () => {
    const world = fakeWorld()
    const tried: number[] = []
    const deps = {
      ...world.deps,
      portFree: (port: number) => (tried.push(port), false),
    }
    expect(await up(FLOOR, deps)).toBe(1)
    expect(tried).toHaveLength(20)
    expect(world.lines).toEqual([
      "No free port for sshd on 127.0.0.1 after 20 tries.",
    ])
    expect(world.host.calls.some((call) => call.args[1] === "pull")).toBe(false)
    expect(existsSync(runFolder(world.root, ID))).toBe(false)
  })

  test("which images were there is written down before anything is pulled", async () => {
    const world = fakeWorld()
    const ubuntu = world.deps.pins.images.ubuntu.image
    let written: unknown
    world.host.failWhen = (args) => {
      if (args[1] !== "pull") return undefined
      written = JSON.parse(
        readFileSync(join(runFolder(world.root, ID), "run.json"), "utf8")
      )
      return {
        code: 1,
        stdout: "",
        stderr: "toomanyrequests: You have reached your pull rate limit\n",
      }
    }
    expect(await up(FLOOR, world.deps)).toBe(1)
    expect(written).toMatchObject({
      images: [{ image: ubuntu, present: false }],
      before: {
        containers: [],
        volumes: [],
        networks: [],
        images: [],
        buildRecords: 7,
      },
    })
    expect(world.lines).toContain(
      "ubuntu:24.04 on this machine failed (exit 1): toomanyrequests: You have reached your pull rate limit"
    )
    // The pull failed, so no image was there to remove.
    expect(argsOf(world)).not.toContainEqual(["docker", "image", "rm", ubuntu])
  })

  const failures: [string, (args: readonly string[]) => boolean, string][] = [
    [
      "the packages",
      (args) => args.at(-1)!.includes("/etc/apt/keyrings/docker.asc"),
      "packages installed (floor) failed (exit 100): E: Version '5:29.5.0-1~ubuntu.24.04~noble' for 'docker-ce' was not found",
    ],
    [
      "sshd",
      (args) => args.at(-1)!.includes("sshd -t -f"),
      "sshd started failed (exit 100): E: Version '5:29.5.0-1~ubuntu.24.04~noble' for 'docker-ce' was not found",
    ],
  ]

  test.each(failures)(
    "a failed step (%s) stops it, and what it made is removed by exact name",
    async (_, when, line) => {
      const world = fakeWorld()
      const ubuntu = world.deps.pins.images.ubuntu.image
      world.host.failWhen = (args) =>
        args[1] === "exec" && when(args)
          ? {
              code: 100,
              stdout: "Reading package lists...\n",
              stderr:
                "E: Version '5:29.5.0-1~ubuntu.24.04~noble' for 'docker-ce' was not found\n",
            }
          : undefined
      expect(await up(FLOOR, world.deps)).toBe(1)
      expect(world.lines).toContain(line)
      const at = argsOf(world).findIndex(
        (args) => args[1] === "exec" && when(args)
      )
      expect(argsOf(world).slice(at + 1)).toEqual([
        ...LEFTOVERS,
        ...LABELLED,
        ["docker", "rm", "--force", SERVER],
        ["docker", "network", "rm", `zekno-check-${ID}-net`],
        ["docker", "volume", "rm", `zekno-check-${ID}-data`],
        ["docker", "image", "inspect", "--format", "{{.Id}}", ubuntu],
        ["docker", "image", "rm", ubuntu],
        ...LEFTOVERS,
        IMAGES,
        RECORDS,
      ])
      expect(
        world.host.containers.size +
          world.host.volumes.size +
          world.host.networks.size
      ).toBe(0)
      expect(world.host.images.size).toBe(0)
      expect(existsSync(runFolder(world.root, ID))).toBe(false)
      expect(world.lines.at(-1)).toBe(
        "Nothing named zekno-check-* is left, no image was added or removed but its own, and no host build record was added or lost (7 before and after)."
      )
    }
  )

  test("an engine other than the pin, an unknown processor and a failed compile each stop it", async () => {
    const versions = fakeWorld()
    versions.host.failWhen = (args) =>
      args[3] === "docker" && args[4] === "version"
        ? { code: 0, stdout: "29.4.3\n", stderr: "" }
        : undefined
    expect(await up(FLOOR, versions.deps)).toBe(1)
    expect(versions.lines).toContain(
      "dockerd started (containerd) failed: the stand-in runs Engine 29.4.3, not pins.json's 29.5.0 for floor"
    )
    const processor = fakeWorld()
    processor.host.arch = "riscv64"
    expect(await up(FLOOR, processor.deps)).toBe(1)
    expect(processor.lines).toContain(
      "runner placed failed: the stand-in's processor is riscv64, and the runner is compiled for x86_64 and aarch64 only"
    )
    const compile = fakeWorld()
    const deps = {
      ...compile.deps,
      local: async (
        args: readonly string[],
        options: { cwd: string; timeoutMs: number }
      ) =>
        args[0] === "ssh-keygen"
          ? compile.deps.local(args, options)
          : { code: 1, stdout: "", stderr: "error: could not resolve\n" },
    }
    expect(await up(FLOOR, deps)).toBe(1)
    expect(compile.lines).toContain(
      "runner placed failed (exit 1): error: could not resolve"
    )
    for (const world of [versions, processor, compile])
      expect(world.host.containers.size + world.host.volumes.size).toBe(0)
  })
})
