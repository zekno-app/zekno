/**
 * The gate of the Linux checks (`gate.ts`; specs/016-build-from-source,
 * T008, LC8): the switch names a stand-in of `server.ts up` or nothing,
 * without it a gated test prints one line and skips, and a command in the
 * stand-in goes through `host-docker.ts`, as every host Docker call does,
 * each with a BUILDX_CONFIG of its own, on the engine the run's run.json
 * names. No test here runs Docker.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FAKE_ENDPOINT,
  fakeWorld,
  imageLine,
  removeFakeWorlds,
} from "./host/fake-host"
import {
  gate,
  inStandInArgs,
  skipLine,
  STAND_IN,
  standInDocker,
  standInOf,
  SWITCH,
} from "./gate"
import { runFolder } from "./stand-in/run-folder"
import { down, up } from "./server"

afterEach(removeFakeWorlds)

const STAND_IN_NAME = "zekno-check-a1b2c3d4-server"

describe("the switch", () => {
  test("names ZEKNO_LINUX_SERVER and takes only zekno-check-<8 letters and digits>-server", () => {
    expect(SWITCH).toBe("ZEKNO_LINUX_SERVER")
    for (const name of [STAND_IN_NAME, "zekno-check-00000000-server"])
      expect(STAND_IN.test(name)).toBe(true)
    for (const name of [
      "zekno-check-A1B2C3D4-server",
      "zekno-check-a1b2c3d-server",
      "zekno-check-a1b2c3d45-server",
      "zekno-check-a1b2c3d4-client",
      "zekno-check-a1b2c3d4-server-2",
      `${STAND_IN_NAME}\n`,
      ` ${STAND_IN_NAME}`,
      "zekno-proxy",
      "sessora-db",
    ])
      expect(STAND_IN.test(name)).toBe(false)
  })

  test("without it, the gate gives the one line a gated test prints when it skips", () => {
    for (const env of [{}, { ZEKNO_LINUX_SERVER: "" }]) {
      expect(standInOf(env)).toBeUndefined()
      const closed = gate("L4", env)
      expect(closed).toEqual({ ready: false, skip: skipLine("L4") })
    }
    expect(skipLine("L4")).toBe(
      "L4 skipped: no Linux stand-in (ZEKNO_LINUX_SERVER is not set)"
    )
    expect(skipLine("L4").split("\n")).toHaveLength(1)
    expect(() => skipLine("L4\nL5")).toThrow("one line")
  })

  test("another container's name is refused, never skipped or run", () => {
    for (const value of [
      "sessora-db",
      "zekno-proxy",
      "zekno-check-a1b2c3d4-client",
      "zekno-check-A1B2C3D4-server",
    ]) {
      expect(() => standInOf({ ZEKNO_LINUX_SERVER: value })).toThrow(
        "no check runs in another container"
      )
      expect(() => gate("L4", { ZEKNO_LINUX_SERVER: value })).toThrow(
        `ZEKNO_LINUX_SERVER is ${JSON.stringify(value)}`
      )
    }
    expect(() => inStandInArgs("sessora-db", ["true"])).toThrow(
      "not a stand-in"
    )
  })
})

describe("a command in the stand-in", () => {
  test("is docker exec -i <stand-in> ..., run through host-docker.ts", async () => {
    const world = fakeWorld()
    world.host.containers.set(STAND_IN_NAME, {
      image: "ubuntu@sha256:x",
      network: undefined,
      volume: undefined,
    })
    const open = gate("L4", { ZEKNO_LINUX_SERVER: STAND_IN_NAME }, (id) =>
      world.host.docker(id)
    )
    if (!open.ready) throw new Error("the gate is closed")
    expect(open.standIn).toBe(STAND_IN_NAME)
    expect(open.id).toBe("a1b2c3d4")
    expect(inStandInArgs(STAND_IN_NAME, ["docker", "info"])).toEqual([
      "docker",
      "exec",
      "-i",
      STAND_IN_NAME,
      "docker",
      "info",
    ])
    const answer = await open.inStandIn(["uname", "-m"])
    expect(answer).toEqual({ code: 0, stdout: "aarch64\n", stderr: "" })
    await open.inStandIn(["sh", "-c", "cat"], { stdin: { text: "{}" } })
    expect(world.host.calls.map((call) => call.args)).toEqual([
      ["docker", "exec", "-i", STAND_IN_NAME, "uname", "-m"],
      ["docker", "exec", "-i", STAND_IN_NAME, "sh", "-c", "cat"],
    ])
    expect(world.host.calls[1]!.stdin).toEqual({ text: "{}" })
    expect(() => inStandInArgs(STAND_IN_NAME, [])).toThrow("a command")
  })
})

describe("the engine a gate works on", () => {
  test("is the one the run's run.json names, whatever the shell or the context says now", async () => {
    const world = fakeWorld()
    expect(
      await up(
        { engine: "floor", store: "containerd", memory: false },
        world.deps
      )
    ).toBe(0)
    const docker = standInDocker(world.root)("a1b2c3d4")
    expect(docker.endpoint).toBe(FAKE_ENDPOINT)
    expect(docker.id).toBe("a1b2c3d4")
  })

  test("a stand-in with no readable run.json here is refused, never run on another engine", () => {
    const world = fakeWorld()
    expect(() =>
      gate(
        "L4",
        { ZEKNO_LINUX_SERVER: STAND_IN_NAME },
        standInDocker(world.root)
      )
    ).toThrow(
      `ZEKNO_LINUX_SERVER names ${STAND_IN_NAME}, but its run.json in ${runFolder(world.root, "a1b2c3d4")} is not there, so the engine it runs on is not known`
    )
    expect(world.host.calls).toEqual([])
  })

  test("reads the stand-in's own OOMKilled on the host, and nothing else of it", async () => {
    const world = fakeWorld()
    expect(
      await up(
        { engine: "floor", store: "containerd", memory: true },
        world.deps
      )
    ).toBe(0)
    world.host.oomKilled = true
    const open = gate("L6", { ZEKNO_LINUX_SERVER: STAND_IN_NAME }, (id) =>
      world.host.docker(id)
    )
    if (!open.ready) throw new Error("the gate is closed")
    expect(await open.oomKilled()).toEqual({
      code: 0,
      stdout: "true\n",
      stderr: "",
    })
    expect(world.host.calls.at(-1)!.args).toEqual([
      "docker",
      "container",
      "inspect",
      "--format",
      "{{.State.OOMKilled}}",
      STAND_IN_NAME,
    ])
    writeFileSync(join(runFolder(world.root, "a1b2c3d4"), "run.json"), "{")
    expect(() => standInDocker(world.root)("a1b2c3d4")).toThrow("its run.json")
  })
})

describe("host-docker.ts under server.ts", () => {
  test("sets BUILDX_CONFIG on every call, to a fresh folder removed afterwards", async () => {
    const world = fakeWorld()
    expect(
      await up(
        { engine: "floor", store: "containerd", memory: false },
        world.deps
      )
    ).toBe(0)
    expect(await down("a1b2c3d4", world.deps)).toBe(0)
    expect(world.host.calls.length).toBeGreaterThan(20)
    expect(world.host.buildx).toHaveLength(world.host.calls.length)
    const seen = new Set<string>()
    for (const call of world.host.buildx) {
      expect(call.folder && call.empty).toBe(true)
      expect(call.path!.startsWith(tmpdir())).toBe(true)
      expect(existsSync(call.path!)).toBe(false)
      seen.add(call.path!)
    }
    expect(seen.size).toBe(world.host.calls.length)
  })

  test("down keeps an image that was there before up", async () => {
    const world = fakeWorld()
    const ubuntu = world.deps.pins.images.ubuntu.image
    world.host.images.set(ubuntu, imageLine(ubuntu))
    expect(
      await up(
        { engine: "floor", store: "containerd", memory: false },
        world.deps
      )
    ).toBe(0)
    expect(await down("a1b2c3d4", world.deps)).toBe(0)
    const removedOrPulled = world.host.calls.filter(
      (call) =>
        call.args[1] === "pull" ||
        call.args.slice(1, 3).join(" ") === "image rm"
    )
    expect(removedOrPulled).toEqual([])
    expect(world.host.images.has(ubuntu)).toBe(true)
    expect(world.lines.at(-1)).toContain(
      "no image was added or removed but its own"
    )
  })
})
