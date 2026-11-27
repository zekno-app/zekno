/**
 * The pure part of the server stand-in (specs/016-build-from-source,
 * research/map-checks.md part 6, steps 1 to 4; quickstart.md, "Where things
 * run"): from pins.json and the options, the exact argument lists, and
 * nothing run. The shell lines that matter on their own (the key check, the
 * daemon's settings) are run here with `sh`, on files the test makes; no
 * test runs Docker.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DAEMON_JSON,
  engineSwap,
  namesOf,
  newId,
  planStandIn,
  readOptions,
  type Options,
  type StandIn,
} from "./plan"
import {
  ENGINE_NAMES,
  ENGINE_PACKAGES,
  type EngineName,
  loadPins,
} from "../pins"
import { clientKeyCommand, hostKeyCommand, sshdCommand } from "./sshd"

const pins = loadPins()
const KEYS = mkdtempSync(join(tmpdir(), "zekno-stand-in-keys-"))
const RUN = { id: "a1b2c3d4", port: 24680, keyFolder: KEYS }
afterAll(() => rmSync(KEYS, { recursive: true, force: true }))
const CLIENT_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0b1pk zekno-check-a1b2c3d4-client"

const plan = (options: Partial<Options> = {}) =>
  planStandIn(
    pins,
    { engine: "floor", store: "containerd", memory: false, ...options },
    RUN
  )

/** Every argument list a plan gives, with what it is. */
function lists(standIn: StandIn): [string, readonly string[]][] {
  return [
    ["volume", standIn.volume],
    ["network", standIn.network],
    ["server", standIn.server],
    ["install", standIn.install],
    ["daemon", standIn.daemon],
    ["clientKey", standIn.clientKey],
    ["hostKey", standIn.hostKey],
    ["client", standIn.client],
    ["clientInstall", standIn.clientInstall],
    ...standIn.remove.map((list): [string, readonly string[]] => [
      "remove",
      list,
    ]),
    ["sshd", sshdCommand(standIn.names.server, CLIENT_KEY)],
    ...ENGINE_NAMES.map((engine): [string, readonly string[]] => [
      `swap ${engine}`,
      engineSwap(pins, standIn.names, engine),
    ]),
  ]
}

/** The script a `docker exec <server> sh -c <script>` list runs. */
const script = (list: readonly string[]) => list[list.length - 1]!

/** Each `apt-get install` line of `text`, as its package arguments. */
const aptInstalls = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.trimStart().startsWith("apt-get install"))
    .map((line) => line.trim().split(/\s+/).slice(2))

/** Every pinned version of a package, wherever pins.json names it. */
const pinned = (name: string) =>
  new Set([
    ...(name in pins.ubuntu
      ? [pins.ubuntu[name as keyof typeof pins.ubuntu]]
      : []),
    ...ENGINE_NAMES.flatMap(
      (engine) => pins.engines[engine].packages[name] ?? []
    ),
  ])

describe("names", () => {
  test("an id is 8 random lowercase letters and digits, unbiased", () => {
    expect(newId()).toMatch(/^[a-z0-9]{8}$/)
    const draws = [
      new Uint8Array(16).fill(255),
      Uint8Array.from({ length: 16 }, (_, i) => i),
    ]
    expect(newId(() => draws.shift()!)).toBe("abcdefgh")
  })

  test("every name starts zekno-check-, with the four the map gives", () => {
    expect(namesOf("a1b2c3d4")).toEqual({
      server: "zekno-check-a1b2c3d4-server",
      data: "zekno-check-a1b2c3d4-data",
      net: "zekno-check-a1b2c3d4-net",
      client: "zekno-check-a1b2c3d4-client",
    })
    for (const [what, list] of lists(plan())) {
      for (const flag of ["--name", "--network", "--hostname"]) {
        const at = list.indexOf(flag)
        if (at >= 0)
          expect(`${what} ${list[at + 1]}`).toMatch(/ zekno-check-a1b2c3d4-/)
      }
      if (list[1] === "volume" || list[1] === "network")
        expect(list[list.length - 1]).toStartWith("zekno-check-")
      if (list[1] === "rm")
        expect(list[list.length - 1]).toStartWith("zekno-check-")
      if (list[1] === "exec")
        expect(list[2]).toBe(
          what === "clientInstall"
            ? "zekno-check-a1b2c3d4-client"
            : "zekno-check-a1b2c3d4-server"
        )
    }
    expect(plan().server).toContain("zekno-check-a1b2c3d4-data:/var/lib/docker")
  })

  test("an id of another form is refused", () => {
    expect(() => namesOf("A1B2C3D4")).toThrow("8 lowercase letters and digits")
    expect(() => namesOf("a1b2c3d")).toThrow()
    expect(() => namesOf("a1b2c3d4; rm")).toThrow()
  })
})

describe("the containers", () => {
  test("only the server is privileged, with its own cgroup namespace", () => {
    for (const [what, list] of lists(plan({ memory: true })))
      if (what !== "server") {
        expect(list).not.toContain("--privileged")
        expect(list.join(" ")).not.toContain("--security-opt")
      }
    expect(plan().server).toContain("--privileged")
    expect(plan().server).toContain("--cgroupns=private")
  })

  test("nothing is published but sshd, on 127.0.0.1, at a port above 1024", () => {
    for (const [what, list] of lists(plan())) {
      const publishing = list.filter((arg) =>
        /^(?:-p|-P|--publish|--publish-all)(?:=|$)|^--network=host$|^host$/.test(
          arg
        )
      )
      expect(`${what}: ${publishing.join(" ")}`).toBe(
        what === "server" ? "server: --publish" : `${what}: `
      )
    }
    const server = plan().server
    expect(server[server.indexOf("--publish") + 1]).toBe("127.0.0.1:24680:22")
  })

  test("the memory limit only with --memory", () => {
    expect(plan().server).not.toContain("--memory")
    expect(plan().server.join(" ")).not.toContain("1g")
    const held = plan({ memory: true }).server.join(" ")
    expect(held).toContain("--memory 1g --memory-swap 1g")
  })

  test("the server runs the ubuntu:24.04 digest, on its volume and network", () => {
    const server = plan().server
    expect(server.slice(0, 2)).toEqual(["docker", "run"])
    expect(server).toContain(pins.images.ubuntu.image)
    expect(server.join(" ")).toContain("--network zekno-check-a1b2c3d4-net")
    expect(plan().volume).toEqual([
      "docker",
      "volume",
      "create",
      "--label",
      "zekno-check=a1b2c3d4",
      "zekno-check-a1b2c3d4-data",
    ])
    expect(plan().network).toEqual([
      "docker",
      "network",
      "create",
      "--label",
      "zekno-check=a1b2c3d4",
      "zekno-check-a1b2c3d4-net",
    ])
  })

  test("the client: the same digest and network, NET_ADMIN, never privileged", () => {
    const client = plan().client
    expect(client).toContain(pins.images.ubuntu.image)
    expect(client.join(" ")).toContain("--network zekno-check-a1b2c3d4-net")
    expect(client.join(" ")).toContain("--cap-add NET_ADMIN")
    expect(client.filter((arg) => arg === "--cap-add")).toHaveLength(1)
    expect(client).not.toContain("--privileged")
    expect(client.join(" ")).toContain("--name zekno-check-a1b2c3d4-client")
  })

  test("removal is by exact name, the client and server first", () => {
    expect(plan().remove).toEqual([
      ["docker", "rm", "--force", "zekno-check-a1b2c3d4-client"],
      ["docker", "rm", "--force", "zekno-check-a1b2c3d4-server"],
      ["docker", "network", "rm", "zekno-check-a1b2c3d4-net"],
      ["docker", "volume", "rm", "zekno-check-a1b2c3d4-data"],
    ])
  })
})

describe("sshd's part of the plan (sshd.test.ts holds the rest)", () => {
  const given = (run: Partial<typeof RUN>) => () =>
    planStandIn(
      pins,
      { engine: "floor", store: "containerd", memory: false },
      { ...RUN, ...run }
    )

  test("ports 3000 and 3100 are never published", () => {
    for (const port of [3000, 3100])
      expect(given({ port })).toThrow(`port ${port} is never used`)
  })

  test("the client's key in the run's temporary folder, the host key read from the server", () => {
    expect(plan().clientKey).toEqual(
      clientKeyCommand(KEYS, "zekno-check-a1b2c3d4-client")
    )
    expect(plan().hostKey).toEqual(
      hostKeyCommand("zekno-check-a1b2c3d4-server")
    )
    expect(given({ keyFolder: "keys" })).toThrow("absolute")
  })
})

describe("the apt lines", () => {
  const scripts = (engine: EngineName) => [
    script(plan({ engine }).install),
    script(plan({ engine }).clientInstall),
    script(engineSwap(pins, namesOf(RUN.id), engine)),
  ]

  test("name only versions from pins.json, never a bare package, never recommends", () => {
    for (const engine of ENGINE_NAMES)
      for (const text of scripts(engine))
        for (const args of aptInstalls(text)) {
          expect(args).toContain("--no-install-recommends")
          for (const arg of args.filter((a) => !a.startsWith("--"))) {
            if (arg.endsWith("-") && !arg.includes("=")) {
              expect(ENGINE_PACKAGES).toContain(arg.slice(0, -1))
              continue
            }
            const [name, version] = arg.split("=") as [string, string]
            expect(`${arg} ${pinned(name).has(version)}`).toBe(`${arg} true`)
          }
        }
  })

  test("install each package of the engine and of Ubuntu at its exact version", () => {
    for (const engine of ENGINE_NAMES) {
      const args = aptInstalls(script(plan({ engine }).install)).flat()
      for (const [name, version] of Object.entries(
        pins.engines[engine].packages
      ))
        expect(args).toContain(`${name}=${version}`)
      for (const [name, version] of Object.entries(pins.ubuntu))
        expect(args).toContain(`${name}=${version}`)
    }
  })

  test("floor-no-buildx and distro-no-buildx install no buildx package", () => {
    for (const engine of ["floor-no-buildx", "distro-no-buildx"] as const)
      for (const text of scripts(engine)) {
        const args = aptInstalls(text).flat()
        expect(
          args.filter((arg) => /^docker-buildx(?:-plugin)?=/.test(arg))
        ).toEqual([])
      }
    const swap = aptInstalls(
      script(engineSwap(pins, namesOf(RUN.id), "floor-no-buildx"))
    ).flat()
    expect(swap).toContain("docker-buildx-plugin-")
    expect(swap).toContain("docker-buildx-")
  })

  test("check the key's fingerprint before Docker's repository is added or anything else installed", () => {
    for (const engine of ENGINE_NAMES) {
      const text = script(plan({ engine }).install)
      const check = text.indexOf(`[ "$fpr" = ${pins.dockerKey.compact} ]`)
      const fetched = text.indexOf(
        `--output /etc/apt/keyrings/docker.asc '${pins.dockerKey.url}'`
      )
      const installs = text
        .split("\n")
        .flatMap((line, at) => (line.startsWith("apt-get install") ? [at] : []))
      expect(fetched).toBeGreaterThan(0)
      expect(check).toBeGreaterThan(fetched)
      expect(
        text.indexOf("/etc/apt/sources.list.d/docker.list")
      ).toBeGreaterThan(check)
      // The first install brings only curl and the certificates that fetch the key.
      expect(aptInstalls(text)[0]!.filter((a) => !a.startsWith("--"))).toEqual([
        `ca-certificates=${pins.ubuntu["ca-certificates"]}`,
        `curl=${pins.ubuntu.curl}`,
      ])
      expect(installs).toHaveLength(2)
      expect(text.split("\n").slice(0, installs[1]).join("\n")).toContain(
        `[ "$fpr" = ${pins.dockerKey.compact} ]`
      )
      expect(text).toContain(
        `/etc/apt/keyrings/docker.asc '${pins.dockerRepository.url}' 'noble' 'stable' > /etc/apt/sources.list.d/docker.list`
      )
      expect(text.startsWith("set -eu\n")).toBe(true)
    }
  })

  test("the apt source line writes each value of pins.json as one word, run here with sh", () => {
    const line = script(plan().install)
      .split("\n")
      .find((l) => l.endsWith("> /etc/apt/sources.list.d/docker.list"))!
    const folder = mkdtempSync(join(tmpdir(), "zekno-apt-source-"))
    try {
      const out = join(folder, "docker.list")
      const marker = join(folder, "ran")
      const run = (text: string) =>
        Bun.spawnSync([
          "sh",
          "-c",
          `dpkg() { echo arm64; }\n${text.replace("/etc/apt/sources.list.d/docker.list", out)}`,
        ])
      expect(run(line).exitCode).toBe(0)
      expect(readFileSync(out, "utf8")).toBe(
        `deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.asc] ${pins.dockerRepository.url} noble stable\n`
      )
      // Were a value to hold shell text, it would still be written, never run.
      const hostile = line.replace(
        `'${pins.dockerRepository.url}'`,
        `'https://x/" $(touch ${marker}) \`touch ${marker}\`'`
      )
      expect(run(hostile).exitCode).toBe(0)
      expect(existsSync(marker)).toBe(false)
      expect(readFileSync(out, "utf8")).toContain(`$(touch ${marker})`)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe("the daemon", () => {
  test("overlay2's daemon.json is byte for byte the map's, and containerd's a fresh data folder", () => {
    expect(DAEMON_JSON.overlay2).toBe(
      '{"features":{"containerd-snapshotter":false},"storage-driver":"overlay2"}'
    )
    expect(DAEMON_JSON.containerd).toBe("{}")
    for (const store of ["overlay2", "containerd"] as const) {
      const line = script(plan({ store }).daemon)
        .split("\n")
        .find((l) => l.endsWith("> /etc/docker/daemon.json"))!
      const folder = mkdtempSync(join(tmpdir(), "zekno-daemon-json-"))
      try {
        const out = join(folder, "daemon.json")
        const run = Bun.spawnSync([
          "sh",
          "-c",
          line.replace("/etc/docker/daemon.json", out),
        ])
        expect(run.exitCode).toBe(0)
        expect(readFileSync(out, "utf8")).toBe(DAEMON_JSON[store])
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    }
  })

  test("the processes move into a child cgroup before dockerd starts, as hack/dind does", () => {
    const text = script(plan().daemon)
    const moved = text.indexOf("> /sys/fs/cgroup/init/cgroup.procs")
    const enabled = text.indexOf("> /sys/fs/cgroup/cgroup.subtree_control")
    const started = text.indexOf(
      "dockerd --config-file /etc/docker/daemon.json"
    )
    expect(moved).toBeGreaterThan(0)
    expect(enabled).toBeGreaterThan(moved)
    expect(started).toBeGreaterThan(enabled)
    expect(text).toContain("until docker info > /dev/null 2>&1")
  })

  test("an engine swap stops dockerd, installs the pinned engine with the others removed, and starts it again", () => {
    const swap = engineSwap(pins, namesOf(RUN.id), "distro")
    expect(swap.slice(0, 5)).toEqual([
      "docker",
      "exec",
      "zekno-check-a1b2c3d4-server",
      "sh",
      "-c",
    ])
    const text = script(swap)
    const args = aptInstalls(text).flat()
    expect(args).toContain("--allow-downgrades")
    expect(args).toContain(
      `docker.io=${pins.engines.distro.packages["docker.io"]}`
    )
    for (const name of [
      "containerd.io-",
      "docker-ce-",
      "docker-ce-cli-",
      "docker-compose-plugin-",
    ])
      expect(args).toContain(name)
    expect(text.indexOf('kill "$pid"')).toBeLessThan(
      text.indexOf("apt-get install")
    )
    expect(text.indexOf("apt-get install")).toBeLessThan(
      text.indexOf("dockerd --config-file")
    )
    expect(text).not.toContain("cgroup.subtree_control")
  })
})

describe("the options", () => {
  test("read --engine, --store and --memory 1g", () => {
    expect(readOptions(["--engine", "newest", "--store", "overlay2"])).toEqual({
      engine: "newest",
      store: "overlay2",
      memory: false,
    })
    expect(
      readOptions([
        "--store",
        "containerd",
        "--memory",
        "1g",
        "--engine",
        "distro-no-buildx",
      ])
    ).toEqual({
      engine: "distro-no-buildx",
      store: "containerd",
      memory: true,
    })
  })

  test("an unknown engine throws, and so does anything else unknown or missing", () => {
    expect(() =>
      readOptions(["--engine", "nightly", "--store", "containerd"])
    ).toThrow(
      "--engine takes floor, floor-no-buildx, older, distro, distro-no-buildx or newest"
    )
    expect(() =>
      planStandIn(
        pins,
        { engine: "nightly" as EngineName, store: "containerd", memory: false },
        RUN
      )
    ).toThrow("nightly")
    expect(() =>
      engineSwap(pins, namesOf(RUN.id), "nightly" as EngineName)
    ).toThrow("nightly")
    expect(() =>
      readOptions(["--engine", "floor", "--store", "btrfs"])
    ).toThrow("--store takes containerd or overlay2")
    expect(() =>
      planStandIn(
        pins,
        { engine: "floor", store: "btrfs" as Options["store"], memory: false },
        RUN
      )
    ).toThrow("btrfs")
    expect(() =>
      readOptions([
        "--engine",
        "floor",
        "--store",
        "containerd",
        "--memory",
        "2g",
      ])
    ).toThrow("--memory takes 1g")
    expect(() => readOptions(["--engine", "floor"])).toThrow(
      "--store is missing"
    )
    expect(() => readOptions(["--store", "overlay2"])).toThrow(
      "--engine is missing"
    )
    expect(() =>
      readOptions([
        "--engine",
        "floor",
        "--engine",
        "newest",
        "--store",
        "overlay2",
      ])
    ).toThrow("twice")
    expect(() =>
      readOptions(["--engine", "floor", "--store", "overlay2", "--fast"])
    ).toThrow("--fast is not an option")
    expect(() => readOptions(["--engine"])).toThrow("not nothing")
  })
})
