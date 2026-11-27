/**
 * `memory-use.ts` (specs/016-build-from-source, T014): L6's app and step
 * exactly, and the reading of the stand-in's cgroup and of the app into
 * words. Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  APP,
  APP_STATE_ARGS,
  appArgs,
  appStateWords,
  ASKED_BYTES,
  countIn,
  eventsWords,
  growthWords,
  heldToOneGb,
  HELD_BYTES,
  hogDockerfile,
  linesArgs,
  memoryEventsOf,
  memoryMaxOf,
  oomKilledWords,
} from "./memory-use"

const BASE =
  "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
const APP_FOLDER = "/tmp/zekno-check-memory/app"

describe("L6's app and step", () => {
  test("the app writes a line a second into the check's folder, with no network", () => {
    expect(appArgs(BASE, APP_FOLDER)).toEqual([
      ...["docker", "run", "--detach", "--name", APP, "--network", "none"],
      ...["--volume", `${APP_FOLDER}:/data`],
      BASE,
      ...["sh", "-c", "while :; do date +%s >> /data/lines; sleep 1; done"],
    ])
    expect(APP).toBe("zekno-check-memory-app")
    expect(() => appArgs(BASE, "/var/lib/docker")).toThrow(
      "is not a folder under /tmp/zekno-check-*"
    )
    expect(() => appArgs("busybox; rm -rf /", APP_FOLDER)).toThrow(
      "is not an image"
    )
    expect(linesArgs(APP_FOLDER)).toEqual([
      "sh",
      "-c",
      'wc -l < "$1"',
      "sh",
      `${APP_FOLDER}/lines`,
    ])
    expect(APP_STATE_ARGS).toEqual([
      "docker",
      "inspect",
      "--format",
      "{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}",
      APP,
    ])
  })

  test("the step reads 1.6 GB into one buffer, and the run's token keeps it from any cache", () => {
    expect(ASKED_BYTES).toBe(1_600_000_000)
    expect(hogDockerfile(BASE, "0a1b2c3d4e5f")).toBe(
      `FROM ${BASE}\nRUN dd if=/dev/zero of=/dev/null bs=1600000000 count=1 && echo 0a1b2c3d4e5f\n`
    )
    expect(() => hogDockerfile(BASE, "$(x)")).toThrow("is not a check's token")
  })
})

describe("the stand-in's cgroup", () => {
  test("memory.max: bytes, max, or unreadable; held to 1 GB only with a limit of at most 1 GiB", () => {
    expect(memoryMaxOf("1073741824\n")).toBe(HELD_BYTES)
    expect(memoryMaxOf("max\n")).toBe("max")
    expect(memoryMaxOf("")).toBeUndefined()
    expect(heldToOneGb(HELD_BYTES)).toBe(true)
    expect(heldToOneGb(512 * 1024 ** 2)).toBe(true)
    expect(heldToOneGb(HELD_BYTES + 1)).toBe(false)
    expect(heldToOneGb("max")).toBe(false)
    expect(heldToOneGb(undefined)).toBe(false)
  })

  test("memory.events, and what changed during the build", () => {
    const before = memoryEventsOf(
      "low 0\nhigh 0\nmax 12\noom 0\noom_kill 0\noom_group_kill 0\n"
    )
    const after = memoryEventsOf(
      "low 0\nhigh 0\nmax 40\noom 2\noom_kill 1\noom_group_kill 0\nnoise line\n"
    )
    expect(after).toEqual({
      low: 0,
      high: 0,
      max: 40,
      oom: 2,
      oom_kill: 1,
      oom_group_kill: 0,
    })
    expect(eventsWords(before, after)).toBe(
      "oom_kill +1 (1 in all), oom +2 (2 in all), oom_group_kill +0 (0 in all)"
    )
    expect(eventsWords({}, { oom_kill: 3 })).toBe("oom_kill +3 (3 in all)")
    expect(eventsWords({ oom_kill: 4 }, { oom_kill: 3 })).toBe(
      "oom_kill -1 (3 in all)"
    )
    expect(eventsWords(undefined, after)).toBe("unread")
  })
})

describe("the app, read", () => {
  test("its line counts, and whether they kept growing", () => {
    expect(countIn(" 12\n")).toBe(12)
    expect(countIn("wc: no file")).toBeUndefined()
    expect(growthWords([12, 20, 23])).toBe("12 → 20 → 23 lines, still growing")
    expect(growthWords([12, 20, 20])).toBe("12 → 20 → 20 lines, not growing")
    expect(growthWords([12, undefined, 23])).toBe(
      "12 → ? → 23 lines, not all read"
    )
  })

  test("its state", () => {
    expect(appStateWords("running false 0\n")).toBe("running")
    expect(appStateWords("running true 0\n")).toBe("running, OOMKilled true")
    expect(appStateWords("exited true 137\n")).toBe(
      "exited (exit 137, OOMKilled true)"
    )
    expect(appStateWords("exited\n")).toBe("exited (exit ?, OOMKilled ?)")
    expect(appStateWords("", 0)).toBe("not found")
    expect(appStateWords("", 1)).toBe("not found")
  })
})

describe("the stand-in's own OOMKilled", () => {
  test("true or false as Docker gives it, or why it could not be read", () => {
    expect(oomKilledWords({ code: 0, stdout: "true\n", stderr: "" })).toBe(
      "the stand-in's own OOMKilled: true"
    )
    expect(oomKilledWords({ code: 0, stdout: "false\n", stderr: "" })).toBe(
      "the stand-in's own OOMKilled: false"
    )
    expect(
      oomKilledWords({
        code: 1,
        stdout: "",
        stderr: "Error response from daemon: No such container: x\n",
      })
    ).toBe(
      "the stand-in's own OOMKilled could not be read: Error response from daemon: No such container: x"
    )
    expect(
      oomKilledWords({ code: 0, stdout: "<no value>\n", stderr: "" })
    ).toBe("the stand-in's own OOMKilled could not be read: <no value>")
    expect(oomKilledWords({ code: -1, stdout: "", stderr: "" })).toBe(
      "the stand-in's own OOMKilled could not be read: no answer"
    )
  })
})
