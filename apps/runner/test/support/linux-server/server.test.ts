/**
 * The stand-in's script (`server.ts`; specs/016-build-from-source, T008;
 * research/map-checks.md part 6; LC8): `engine` swaps the engine of a
 * running stand-in, `list` shows what is named zekno-check-* by run, and
 * `main` reads each command's options and refuses anything else. Over a
 * whole run, nothing builds, prunes or logs in. `up` and `down` have their
 * own tests. Docker, ssh-keygen and the compile are stood in for
 * (`fake-host.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  FAKE_ENDPOINT,
  fakeWorld,
  imageLine,
  removeFakeWorlds,
} from "./host/fake-host"
import { labelledLists } from "./host/host-lists"
import type { Options } from "./stand-in/plan"
import { runFolder } from "./stand-in/run-folder"
import { engine, list, main, up } from "./server"

const ID = "a1b2c3d4"
const SERVER = `zekno-check-${ID}-server`
const FLOOR: Options = { engine: "floor", store: "containerd", memory: false }
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

const argsOf = (world: ReturnType<typeof fakeWorld>) =>
  world.host.calls.map((call) => call.args)

afterEach(removeFakeWorlds)

describe("engine", () => {
  test("swaps the engine of a running stand-in and checks its version", async () => {
    const world = fakeWorld()
    expect(await up(FLOOR, world.deps)).toBe(0)
    const before = world.host.calls.length
    // The context now answers elsewhere: the swap still runs where the stand-in is.
    world.host.endpoint = "ssh://maintainer@server.invalid"
    expect(await engine(ID, "newest", world.deps)).toBe(0)
    const calls = argsOf(world).slice(before)
    for (const call of world.host.calls.slice(before))
      expect(call.env.DOCKER_HOST).toBe(FAKE_ENDPOINT)
    expect(calls[0]).toEqual(labelledLists(ID).containers)
    expect(calls[1]!.slice(0, 5)).toEqual([
      "docker",
      "exec",
      SERVER,
      "sh",
      "-c",
    ])
    expect(calls[1]!.at(-1)).toContain("--allow-downgrades")
    expect(calls[2]).toEqual([
      "docker",
      "exec",
      SERVER,
      "docker",
      "version",
      "--format",
      "{{.Server.Version}}",
    ])
    expect(calls).toHaveLength(3)
    expect(world.lines.at(-1)).toMatch(
      new RegExp(
        `^${SERVER} runs newest now: Engine 29\\.10\\.1, in \\d+ s\\.$`
      )
    )
    const state = JSON.parse(
      readFileSync(join(runFolder(world.root, ID), "run.json"), "utf8")
    )
    expect(state.engine).toBe("newest")
  })

  test("with no run of that id, no stand-in of it, or the wrong version after, it stops", async () => {
    const world = fakeWorld()
    expect(await engine(ID, "newest", world.deps)).toBe(1)
    expect(world.lines).toEqual([
      `The run.json of ${ID} is not there, so the engine ${SERVER} is on is not known; make one with server.ts up.`,
    ])
    expect(world.host.calls).toHaveLength(0)
    const gone = fakeWorld()
    expect(await up(FLOOR, gone.deps)).toBe(0)
    gone.host.labels.delete(SERVER)
    expect(await engine(ID, "newest", gone.deps)).toBe(1)
    expect(gone.lines.at(-1)).toBe(
      `${SERVER} is not on this machine; make one with server.ts up.`
    )
    const wrong = fakeWorld()
    expect(await up(FLOOR, wrong.deps)).toBe(0)
    wrong.host.failWhen = (args) =>
      args[4] === "version"
        ? { code: 0, stdout: "29.5.0\n", stderr: "" }
        : undefined
    expect(await engine(ID, "older", wrong.deps)).toBe(1)
    expect(wrong.lines.at(-1)).toBe(
      "The swap failed: the stand-in runs Engine 29.5.0, not pins.json's 29.4.3 for older"
    )
  })
})

describe("list", () => {
  test("shows what is left by run id, with each run's folder", async () => {
    const world = fakeWorld()
    expect(await list(world.deps)).toBe(0)
    expect(world.lines).toEqual([
      "Nothing named zekno-check-* is on this machine.",
    ])
    expect(await up(FLOOR, world.deps)).toBe(0)
    world.host.networks.add("zekno-check-zzzzzzzz-net")
    world.host.networks.add("zekno-check-odd")
    world.lines.length = 0
    expect(await list(world.deps)).toBe(0)
    expect(world.lines).toEqual([
      `${ID}: ${SERVER}, zekno-check-${ID}-data, zekno-check-${ID}-net; its folder ${runFolder(world.root, ID)}`,
      "zzzzzzzz: zekno-check-zzzzzzzz-net",
      "Of no run: zekno-check-odd",
    ])
    const writes = world.host.calls.slice(-3).map((call) => call.args)
    expect(writes).toEqual(LEFTOVERS)
  })
})

describe("main", () => {
  test("reads each command's options, and anything else is refused with status 2", async () => {
    const world = fakeWorld()
    expect(
      await main(["up", "--engine", "floor", "--store", "overlay2"], world.deps)
    ).toBe(0)
    expect(
      await main(["engine", "--engine", "distro", "--id", ID], world.deps)
    ).toBe(0)
    expect(await main(["list"], world.deps)).toBe(0)
    expect(await main(["down", "--id", ID], world.deps)).toBe(0)
    const refused: [string[], string][] = [
      [[], "Use: server.ts up"],
      [["start"], "Use: server.ts up"],
      [["up", "--engine", "nightly", "--store", "overlay2"], "--engine takes"],
      [["down"], "down takes --id <id>"],
      [["down", "--id"], "down takes --id <id>"],
      [["down", "--id", "A1B2C3D4"], "8 lowercase letters and digits"],
      [["down", "--id", ID, "--force"], "down takes --id <id>"],
      [["engine", "--id", ID], "engine takes --id <id> --engine <name>"],
      [["engine", "--id", ID, "--engine", "nightly"], "--engine takes floor"],
      [["list", "--all"], "list takes nothing"],
    ]
    for (const [args, words] of refused) {
      world.lines.length = 0
      expect(await main(args, world.deps)).toBe(2)
      expect(world.lines).toHaveLength(1)
      expect(world.lines[0]).toContain(words)
    }
  })

  test("over a whole run nothing builds, prunes or logs in, and every change names this run", async () => {
    const world = fakeWorld()
    expect(
      await main(
        ["up", "--engine", "distro", "--store", "overlay2", "--memory", "1g"],
        world.deps
      )
    ).toBe(0)
    expect(
      await main(
        ["engine", "--id", ID, "--engine", "floor-no-buildx"],
        world.deps
      )
    ).toBe(0)
    expect(await main(["down", "--id", ID], world.deps)).toBe(0)
    const ubuntu = world.deps.pins.images.ubuntu.image
    for (const args of argsOf(world)) {
      expect([
        "build",
        "builder",
        "system",
        "login",
        "logout",
        "push",
        "tag",
        "cp",
      ]).not.toContain(args[1])
      expect(args.slice(0, 4)).not.toContain("prune")
      if (args[1] === "buildx")
        expect(args.slice(2, 4)).toEqual(["history", "ls"])
      const changes =
        ["run", "rm", "pull", "exec"].includes(args[1]!) ||
        ["create", "rm"].includes(args[2]!)
      if (changes)
        expect(
          args.some(
            (arg) => arg.startsWith(`zekno-check-${ID}-`) || arg === ubuntu
          )
        ).toBe(true)
    }
    expect(imageLine(ubuntu)).toContain(ubuntu.split("@")[1]!)
  })
})
