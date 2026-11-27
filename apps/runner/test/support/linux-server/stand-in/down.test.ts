/**
 * `server.ts down --id <id>` (`down.ts`; specs/016-build-from-source, T008;
 * LC8): on the engine the run's run.json names, it removes by exact name
 * what that id made and labelled, also after a failed or half-finished
 * `up`, and by digest only the images that run pulled; it compares what is
 * left with the lists taken before `up` and says so in one line. Docker is
 * stood in for (`fake-host.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { down } from "./down"
import {
  FAKE_ENDPOINT,
  fakeWorld,
  imageLine,
  removeFakeWorlds,
} from "../host/fake-host"
import { labelledLists } from "../host/host-lists"
import {
  makeRunFolder,
  runFolder,
  writeState,
  type RunState,
} from "./run-folder"

const ID = "a1b2c3d4"
const N = {
  server: `zekno-check-${ID}-server`,
  client: `zekno-check-${ID}-client`,
  net: `zekno-check-${ID}-net`,
  data: `zekno-check-${ID}-data`,
}
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
const LABELLED = Object.values(labelledLists(ID))
const CONTEXT = [
  "docker",
  "context",
  "inspect",
  "--format",
  "{{.Endpoints.docker.Host}}",
]
const AFTER = [
  ...LEFTOVERS,
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
  ["docker", "buildx", "history", "ls", "--format", "json"],
]
const ALL_GOOD =
  "Nothing named zekno-check-* is left, no image was added or removed but its own, and no host build record was added or lost (7 before and after)."
const OTHER_IMAGE =
  "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"

/**
 * A run `up` left half-way: its run.json, the server and client running on
 * their volume and network, and the image it pulled. Nothing ran to clean up.
 */
function halfFinished(pulled = true) {
  const world = fakeWorld()
  const ubuntu = world.deps.pins.images.ubuntu.image
  world.host.images.set(OTHER_IMAGE, imageLine(OTHER_IMAGE))
  const state: RunState = {
    id: ID,
    endpoint: FAKE_ENDPOINT,
    engine: "floor",
    store: "containerd",
    memory: false,
    port: 24680,
    before: {
      containers: [],
      volumes: [],
      networks: [],
      images: [imageLine(OTHER_IMAGE), ...(pulled ? [] : [imageLine(ubuntu)])],
      buildRecords: 7,
    },
    images: [{ image: ubuntu, present: !pulled }],
  }
  const folder = makeRunFolder(world.root, ID)
  writeState(folder, state)
  writeFileSync(join(folder, "client_ed25519"), "PRIVATE KEY OF THE TEST\n")
  world.host.images.set(ubuntu, imageLine(ubuntu))
  world.host.volumes.add(N.data)
  world.host.networks.add(N.net)
  world.host.containers.set(N.server, {
    image: ubuntu,
    network: N.net,
    volume: N.data,
  })
  world.host.containers.set(N.client, {
    image: ubuntu,
    network: N.net,
    volume: undefined,
  })
  for (const name of Object.values(N))
    world.host.labels.set(name, `zekno-check=${ID}`)
  return { world, ubuntu, folder }
}

const argsOf = (world: ReturnType<typeof fakeWorld>) =>
  world.host.calls.map((call) => call.args)

afterEach(removeFakeWorlds)

describe("down", () => {
  test("after a half-finished up: by exact name, the client and server first, then the image the run pulled", async () => {
    const { world, ubuntu, folder } = halfFinished()
    expect(await down(ID, world.deps)).toBe(0)
    expect(argsOf(world)).toEqual([
      ...LEFTOVERS,
      ...LABELLED,
      ["docker", "rm", "--force", N.client],
      ["docker", "rm", "--force", N.server],
      ["docker", "network", "rm", N.net],
      ["docker", "volume", "rm", N.data],
      ["docker", "image", "inspect", "--format", "{{.Id}}", ubuntu],
      ["docker", "image", "rm", ubuntu],
      ...AFTER,
    ])
    expect(world.lines).toEqual([ALL_GOOD])
    expect(world.host.images.has(OTHER_IMAGE)).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })

  test("works on the engine run.json names, whatever the shell or the context says now", async () => {
    const { world } = halfFinished()
    world.host.endpoint = "ssh://maintainer@server.invalid"
    expect(await down(ID, world.deps)).toBe(0)
    expect(world.lines).toEqual([ALL_GOOD])
    expect(argsOf(world)).not.toContainEqual(CONTEXT)
    for (const call of world.host.calls) {
      expect(call.env.DOCKER_HOST).toBe(FAKE_ENDPOINT)
      expect(call.env.DOCKER_CONTEXT).toBeUndefined()
    }
  })

  test("a name of the run without its label was not made by up: it is left, and named", async () => {
    const { world, folder } = halfFinished()
    world.host.labels.delete(N.server)
    world.host.labels.set(N.data, "zekno-check=zzzzzzzz")
    expect(await down(ID, world.deps)).toBe(1)
    expect(argsOf(world)).not.toContainEqual([
      "docker",
      "rm",
      "--force",
      N.server,
    ])
    expect(argsOf(world)).not.toContainEqual(["docker", "volume", "rm", N.data])
    expect(world.host.containers.has(N.server)).toBe(true)
    expect(world.host.volumes.has(N.data)).toBe(true)
    expect(world.lines).toHaveLength(1)
    for (const name of [N.server, N.data])
      expect(world.lines[0]).toContain(
        `${name} does not carry the label zekno-check=${ID}, so up did not make it and down left it;`
      )
    // The client, which carries the label, is removed.
    expect(world.host.containers.has(N.client)).toBe(false)
    expect(existsSync(folder)).toBe(true)
  })

  test("keeps an image that was there before up", async () => {
    const { world, ubuntu } = halfFinished(false)
    expect(await down(ID, world.deps)).toBe(0)
    expect(
      argsOf(world).filter((args) => args[1] === "image" && args[2] !== "ls")
    ).toEqual([])
    expect(world.host.images.has(ubuntu)).toBe(true)
    expect(world.lines).toEqual([ALL_GOOD])
  })

  test("keeps an image the before list names, whatever run.json says", async () => {
    const { world, ubuntu, folder } = halfFinished()
    writeState(folder, {
      id: ID,
      endpoint: FAKE_ENDPOINT,
      engine: "floor",
      store: "containerd",
      memory: false,
      port: 24680,
      before: {
        containers: [],
        volumes: [],
        networks: [],
        images: [imageLine(OTHER_IMAGE), imageLine(ubuntu)],
        buildRecords: 7,
      },
      images: [{ image: ubuntu, present: false }],
    })
    expect(await down(ID, world.deps)).toBe(0)
    expect(world.host.images.has(ubuntu)).toBe(true)
    expect(world.lines).toEqual([ALL_GOOD])
  })

  test("an image pins.json does not give the host is never removed, whatever run.json says", async () => {
    const { world, ubuntu, folder } = halfFinished()
    world.host.images.delete(OTHER_IMAGE)
    writeState(folder, {
      id: ID,
      endpoint: FAKE_ENDPOINT,
      engine: "floor",
      store: "containerd",
      memory: false,
      port: 24680,
      before: {
        containers: [],
        volumes: [],
        networks: [],
        images: [],
        buildRecords: 7,
      },
      images: [
        { image: OTHER_IMAGE, present: false },
        { image: ubuntu, present: false },
      ],
    })
    world.host.images.set(OTHER_IMAGE, imageLine(OTHER_IMAGE))
    expect(await down(ID, world.deps)).toBe(1)
    expect(world.host.images.has(OTHER_IMAGE)).toBe(true)
    expect(world.host.images.has(ubuntu)).toBe(false)
    expect(argsOf(world).filter((args) => args.includes(OTHER_IMAGE))).toEqual(
      []
    )
    expect(world.lines).toEqual([`Images added: ${imageLine(OTHER_IMAGE)}.`])
  })

  test("an image the run never got to pull is not asked to be removed", async () => {
    const { world, ubuntu } = halfFinished()
    world.host.images.delete(ubuntu)
    world.host.containers.clear()
    expect(await down(ID, world.deps)).toBe(0)
    expect(argsOf(world)).not.toContainEqual(["docker", "image", "rm", ubuntu])
    expect(world.lines).toEqual([ALL_GOOD])
  })

  test("without run.json: the id's names removed, and nothing else compared", async () => {
    const { world, ubuntu, folder } = halfFinished()
    writeFileSync(join(folder, "run.json"), "{")
    expect(await down(ID, world.deps)).toBe(0)
    expect(argsOf(world)).toEqual([
      CONTEXT,
      ...LEFTOVERS,
      ...LABELLED,
      ["docker", "rm", "--force", N.client],
      ["docker", "rm", "--force", N.server],
      ["docker", "network", "rm", N.net],
      ["docker", "volume", "rm", N.data],
      ...LEFTOVERS,
    ])
    expect(world.host.images.has(ubuntu)).toBe(true)
    expect(world.lines).toEqual([
      `Nothing named zekno-check-${ID}-* is left on ${FAKE_ENDPOINT}, this shell's engine; its run.json is not JSON, so no image was removed and the host's images and build records were not compared.`,
    ])
    expect(existsSync(folder)).toBe(false)

    const bare = fakeWorld()
    expect(await down(ID, bare.deps)).toBe(0)
    expect(bare.lines[0]).toContain("its run.json is not there")
  })

  test("without run.json and with a context of another machine, nothing is removed", async () => {
    const { world, folder } = halfFinished()
    writeFileSync(join(folder, "run.json"), "{")
    world.host.endpoint = "ssh://maintainer@server.invalid"
    expect(await down(ID, world.deps)).toBe(1)
    expect(argsOf(world)).toEqual([CONTEXT])
    expect(world.lines).toEqual([
      `Docker's current context answers at "ssh://maintainer@server.invalid", not at a socket of this machine (unix:///...); the stand-in is made only on this machine's own engine. The run.json of ${ID} is not JSON, so down removed nothing.`,
    ])
    expect(world.host.containers.size).toBe(2)
  })

  test("never touches another name, and says what is left", async () => {
    const { world } = halfFinished()
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
    world.host.volumes.add("zekno-check-zzzzzzzz-data")
    world.host.volumes.add("vata-data")
    world.host.networks.add("zekno-check-odd")
    expect(await down(ID, world.deps)).toBe(1)
    for (const args of argsOf(world))
      if (args.includes("rm"))
        expect(
          args.at(-1)!.startsWith(`zekno-check-${ID}-`) ||
            args.at(-1)!.includes("@sha256:")
        ).toBe(true)
    expect([...world.host.containers.keys()].sort()).toEqual([
      "sessora-db",
      "zekno-check-zzzzzzzz-server",
    ])
    expect([...world.host.volumes].sort()).toEqual([
      "vata-data",
      "zekno-check-zzzzzzzz-data",
    ])
    expect([...world.host.networks]).toEqual(["zekno-check-odd"])
    expect(world.lines).toEqual([
      "Left named zekno-check-*: zekno-check-zzzzzzzz-server, zekno-check-zzzzzzzz-data, zekno-check-odd.",
    ])
  })

  test("says when a host build record or an image was added or lost", async () => {
    const { world, ubuntu } = halfFinished()
    world.host.records = 6
    world.host.images.delete(OTHER_IMAGE)
    const added =
      "ubuntu@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    world.host.images.set(added, imageLine(added))
    expect(await down(ID, world.deps)).toBe(1)
    expect(world.lines).toEqual([
      `Images added: ${imageLine(added)}; images removed: ${imageLine(OTHER_IMAGE)}; host build records: 7 before up, 6 now.`,
    ])
    expect(world.host.images.has(ubuntu)).toBe(false)
  })

  test("says when a name could not be removed or the records could not be counted", async () => {
    const { world } = halfFinished()
    world.host.failWhen = (args) =>
      args[1] === "volume" && args[2] === "rm"
        ? {
            code: 1,
            stdout: "",
            stderr: "Error response from daemon: remove: volume is in use\n",
          }
        : args[1] === "buildx"
          ? {
              code: 1,
              stdout: "",
              stderr: "unknown command: docker buildx history\n",
            }
          : undefined
    expect(await down(ID, world.deps)).toBe(1)
    expect(world.lines).toEqual([
      `${N.data} could not be removed: Error response from daemon: remove: volume is in use; left named zekno-check-*: ${N.data}; the host's build records could not be counted: unknown command: docker buildx history.`,
    ])
    // Its folder stays while something of the run is left, so down can be run again.
    expect(existsSync(runFolder(world.root, ID))).toBe(true)
    world.host.failWhen = undefined
    world.host.calls.length = 0
    expect(await down(ID, world.deps)).toBe(0)
    expect(argsOf(world)).toContainEqual(["docker", "volume", "rm", N.data])
    expect(world.lines.at(-1)).toBe(ALL_GOOD)
    expect(existsSync(runFolder(world.root, ID))).toBe(false)
  })

  test("an id of another form is refused before any call", async () => {
    const world = fakeWorld()
    for (const id of ["A1B2C3D4", "*", "a1b2c3d4/../x", ""])
      await expect(down(id, world.deps)).rejects.toThrow(
        "8 lowercase letters and digits"
      )
    expect(world.host.calls).toEqual([])
  })
})
