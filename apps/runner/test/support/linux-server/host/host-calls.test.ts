/**
 * Which host Docker calls get through (`host-calls.ts`;
 * specs/016-build-from-source, T008; tasks.md, "Rules every task keeps"):
 * every list of the plan and the reads `server.ts` makes, and nothing that
 * builds, prunes, logs in, chooses a builder, a context or another engine,
 * or names what another run or no run made. A refused call never reaches
 * Docker. No test here runs Docker: the spawn is a stand-in that records
 * what it was given.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { PROXY_IMAGE } from "../../../../src/proxy/image"
import { FAKE_ENDPOINT, fakeHost } from "./fake-host"
import { checkCall, hostDocker } from "./host-docker"
import { ENGINE_NAMES, loadPins } from "../pins"
import { engineSwap, namesOf, planStandIn, STORES } from "../stand-in/plan"
import { hostKeyCommand, sshdCommand } from "../stand-in/sshd"

const pins = loadPins()
const ID = "a1b2c3d4"
const NAMES = namesOf(ID)
const UBUNTU = pins.images.ubuntu.image
const CLIENT_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0b1pk zekno-check-a1b2c3d4-client"

/** Every list the stand-in's plan gives, for every engine, store and memory. */
function planLists(): (readonly string[])[] {
  const all: (readonly string[])[] = []
  for (const engine of ENGINE_NAMES)
    for (const store of STORES)
      for (const memory of [false, true]) {
        const plan = planStandIn(
          pins,
          { engine, store, memory },
          { id: ID, port: 24680, keyFolder: tmpdir() }
        )
        all.push(
          plan.volume,
          plan.network,
          plan.server,
          plan.install,
          plan.daemon,
          plan.hostKey,
          plan.client,
          plan.clientInstall,
          ...plan.remove,
          engineSwap(pins, NAMES, engine)
        )
      }
  return [
    ...all,
    sshdCommand(NAMES.server, CLIENT_KEY),
    hostKeyCommand(NAMES.server),
  ]
}

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
  [
    "docker",
    "image",
    "ls",
    "--all",
    "--no-trunc",
    "--digests",
    "--format",
    "{{.ID}} {{.Repository}}:{{.Tag}}@{{.Digest}}",
  ],
  ["docker", "image", "inspect", "--format", "{{.Id}}", UBUNTU],
  ["docker", "buildx", "history", "ls", "--format", "json"],
  ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
  [
    "docker",
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    `label=zekno-check=${ID}`,
    "--format",
    "{{.Names}}",
  ],
]

const BOUND = [
  ["docker", "pull", "--quiet", UBUNTU],
  ["docker", "image", "rm", UBUNTU],
  ["docker", "exec", NAMES.server, "uname", "-m"],
  ["docker", "exec", "-i", NAMES.server, "sh", "-c", "cat > /x"],
  ["docker", "exec", NAMES.client, "true"],
  ["docker", "exec", NAMES.server, "docker", "pull", "--quiet", PROXY_IMAGE],
  [
    "docker",
    "container",
    "inspect",
    "--format",
    "{{.State.OOMKilled}}",
    NAMES.server,
  ],
]

describe("what gets through", () => {
  test("every list of the plan, for every engine, store and memory", () => {
    for (const list of planLists())
      expect(() => checkCall(list, ID)).not.toThrow()
  })

  test("the read-only calls, with or without a run id", () => {
    for (const args of READ_ONLY) {
      expect(() => checkCall(args, undefined)).not.toThrow()
      expect(() => checkCall(args, ID)).not.toThrow()
    }
    for (const args of BOUND) expect(() => checkCall(args, ID)).not.toThrow()
  })

  test("a call that makes, changes or removes needs this run's id", () => {
    for (const args of [...BOUND, ...planLists()])
      expect(() => checkCall(args, undefined)).toThrow("needs this run's id")
  })
})

describe("what is refused", () => {
  const OTHER = namesOf("zzzzzzzz")
  const refused: [string, readonly string[]][] = [
    ["a build", ["docker", "build", "."]],
    ["buildx build", ["docker", "buildx", "build", "."]],
    ["buildx bake", ["docker", "buildx", "bake"]],
    ["a builder made", ["docker", "buildx", "create", "--use"]],
    ["a builder chosen", ["docker", "buildx", "use", "default"]],
    ["a buildx prune", ["docker", "buildx", "prune", "--all", "--force"]],
    [
      "a history record removed",
      ["docker", "buildx", "history", "rm", "--all"],
    ],
    ["a builder prune", ["docker", "builder", "prune", "--force"]],
    ["a system prune", ["docker", "system", "prune", "--force"]],
    ["an image prune", ["docker", "image", "prune", "--all", "--force"]],
    ["a volume prune", ["docker", "volume", "prune", "--force"]],
    ["a container prune", ["docker", "container", "prune", "--force"]],
    ["a network prune", ["docker", "network", "prune", "--force"]],
    ["a login", ["docker", "login", "--username", "x"]],
    ["a logout", ["docker", "logout"]],
    ["a push", ["docker", "push", UBUNTU]],
    ["a tag", ["docker", "tag", UBUNTU, "ubuntu:mine"]],
    ["a context chosen", ["docker", "context", "use", "default"]],
    ["compose", ["docker", "compose", "up"]],
    ["a copy of a folder", ["docker", "cp", ".", `${NAMES.server}:/repo`]],
    ["a global flag", ["docker", "--context", "x", "ps"]],
    ["another program", ["sh", "-c", "docker ps"]],
    ["nothing", ["docker"]],
    ["a stop", ["docker", "stop", NAMES.server]],
    ["a kill", ["docker", "kill", NAMES.server]],
    ["a pull by tag", ["docker", "pull", "--quiet", "ubuntu:24.04"]],
    ["a pull without --quiet", ["docker", "pull", UBUNTU]],
    ["an image removed by tag", ["docker", "image", "rm", "ubuntu:24.04"]],
    [
      "another image pulled by digest",
      ["docker", "pull", "--quiet", pins.images.fixtures.image],
    ],
    [
      "another image removed by digest",
      ["docker", "image", "rm", pins.images.fixtures.image],
    ],
    ["an image removed by force", ["docker", "image", "rm", "--force", UBUNTU]],
    ["an image removed by id", ["docker", "image", "rm", "sha256:0123"]],
    ["rmi", ["docker", "rmi", UBUNTU]],
    [
      "another run's container removed",
      ["docker", "rm", "--force", OTHER.server],
    ],
    [
      "a container of another name removed",
      ["docker", "rm", "--force", "sessora-db"],
    ],
    ["a removal without --force", ["docker", "rm", NAMES.server]],
    [
      "two containers removed at once",
      ["docker", "rm", "--force", NAMES.server, NAMES.client],
    ],
    ["another run's network removed", ["docker", "network", "rm", OTHER.net]],
    ["another run's volume removed", ["docker", "volume", "rm", OTHER.data]],
    [
      "the network removed by the volume's name",
      ["docker", "network", "rm", NAMES.data],
    ],
    [
      "a volume of another name",
      ["docker", "volume", "create", "--label", `zekno-check=${ID}`, "mine"],
    ],
    ["a volume without the label", ["docker", "volume", "create", NAMES.data]],
    [
      "a network of another run",
      [
        "docker",
        "network",
        "create",
        "--label",
        `zekno-check=${ID}`,
        OTHER.net,
      ],
    ],
    ["an exec in another container", ["docker", "exec", "sessora-db", "true"]],
    [
      "an exec in another run's server",
      ["docker", "exec", "-i", OTHER.server, "true"],
    ],
    ["an exec with no command", ["docker", "exec", NAMES.server]],
    [
      "an exec with a flag",
      ["docker", "exec", "--privileged", NAMES.server, "true"],
    ],
    [
      "a read with a flag of its own",
      ["docker", "ps", "--quiet", "--filter", "x"],
    ],
    [
      "an inspect of two images",
      ["docker", "image", "inspect", "--format", "x", UBUNTU, UBUNTU],
    ],
    ["a read missing its flag's value", ["docker", "version", "--format"]],
    [
      "a history ls with a builder",
      ["docker", "buildx", "history", "ls", "--builder", "b"],
    ],
    ["a global --host", ["docker", "--host", "ssh://x", "ps"]],
    ["a global -H", ["docker", "-H", "tcp://x:2375", "ps"]],
    [
      "another context inspected",
      ["docker", "context", "inspect", "--format", "x", "server"],
    ],
    ["a context made", ["docker", "context", "create", "x"]],
    [
      "another container's state",
      [
        "docker",
        "container",
        "inspect",
        "--format",
        "{{.State.OOMKilled}}",
        OTHER.server,
      ],
    ],
    [
      "the client's state",
      [
        "docker",
        "container",
        "inspect",
        "--format",
        "{{.State.OOMKilled}}",
        NAMES.client,
      ],
    ],
    [
      "a container's whole inspect",
      ["docker", "container", "inspect", NAMES.server],
    ],
    [
      "another field of its state",
      [
        "docker",
        "container",
        "inspect",
        "--format",
        "{{.Config.Env}}",
        NAMES.server,
      ],
    ],
  ]

  test.each(refused)("%s", (_, args) => {
    expect(() => checkCall(args, ID)).toThrow("host-docker refuses")
  })

  const run = (...middle: string[]) => [
    "docker",
    "run",
    "--detach",
    ...middle,
    UBUNTU,
    "sleep",
    "infinity",
  ]
  const server = ["--name", NAMES.server, "--label", `zekno-check=${ID}`]
  const client = ["--name", NAMES.client, "--label", `zekno-check=${ID}`]
  const runs: [string, readonly string[]][] = [
    [
      "another run's name",
      run("--name", OTHER.server, "--label", `zekno-check=${ID}`),
    ],
    [
      "a name of no run",
      run("--name", "sessora-db", "--label", `zekno-check=${ID}`),
    ],
    ["no name", run("--label", `zekno-check=${ID}`)],
    [
      "another run's label",
      run("--name", NAMES.server, "--label", "zekno-check=zzzzzzzz"),
    ],
    ["no label", run("--name", NAMES.server)],
    ["no --detach", ["docker", "run", ...server, UBUNTU]],
    [
      "a folder of this machine mounted",
      run(...server, "--volume", "/Users:/repo"),
    ],
    ["the repository mounted", run(...server, "--volume", ".:/repo")],
    [
      "another run's volume",
      run(...server, "--volume", `${OTHER.data}:/var/lib/docker`),
    ],
    ["a mount flag", run(...server, "--mount", "type=bind,src=/,dst=/host")],
    ["the host's network", run(...server, "--network", "host")],
    ["another run's network", run(...server, "--network", OTHER.net)],
    ["a port on every address", run(...server, "--publish", "24680:22")],
    ["a port on 0.0.0.0", run(...server, "--publish", "0.0.0.0:24680:22")],
    ["port 3000", run(...server, "--publish", "127.0.0.1:3000:22")],
    ["port 3100", run(...server, "--publish", "127.0.0.1:3100:22")],
    [
      "a port of another service",
      run(...server, "--publish", "127.0.0.1:24680:80"),
    ],
    ["every port", run(...server, "--publish-all")],
    ["a privileged client", run(...client, "--privileged")],
    ["a client with the server's cgroup", run(...client, "--cgroupns=private")],
    ["a client publishing", run(...client, "--publish", "127.0.0.1:24680:22")],
    ["a capability but NET_ADMIN", run(...client, "--cap-add", "SYS_ADMIN")],
    ["a capability for the server", run(...server, "--cap-add", "NET_ADMIN")],
    ["another memory limit", run(...server, "--memory", "2g")],
    [
      "an image by tag",
      ["docker", "run", "--detach", ...server, "ubuntu:24.04"],
    ],
    ["a host pid namespace", run(...server, "--pid", "host")],
    ["a hostname of another", run(...server, "--hostname", "sessora-db")],
    ["two names", run(...server, "--name", NAMES.client)],
    ["a removal when done", run(...server, "--rm")],
    [
      "another image by digest",
      [
        "docker",
        "run",
        "--detach",
        ...server,
        pins.images.fixtures.image,
        "sh",
      ],
    ],
  ]

  test.each(runs)("a run with %s", (_, args) => {
    expect(() => checkCall(args, ID)).toThrow("host-docker refuses")
  })

  test("an id of another form is refused before any call", () => {
    for (const id of ["A1B2C3D4", "a1b2c3d", "a1b2c3d4-x", "*"])
      expect(() => hostDocker({ id, endpoint: FAKE_ENDPOINT })).toThrow(
        "8 lowercase letters and digits"
      )
  })

  test("a refused call never reaches Docker, and a long one is shortened in the line", async () => {
    const host = fakeHost()
    const docker = host.docker(ID)
    const script = "x".repeat(5000)
    await expect(
      docker.run(["docker", "exec", "sessora-db", "sh", "-c", script])
    ).rejects.toThrow("host-docker refuses")
    await expect(docker.run(["docker", "build", "."])).rejects.toThrow(
      "host-docker refuses `docker build .`"
    )
    const error = await docker
      .run(["docker", "exec", "sessora-db", "sh", "-c", script])
      .catch((e: Error) => e)
    expect((error as Error).message.length).toBeLessThan(300)
    expect(host.calls).toEqual([])
  })
})
