/**
 * `stand-in-processes.ts` (specs/016-build-from-source, T013 and T014):
 * reading `/proc/<pid>/stat`, the listing by environment entry, and the
 * stop that kills only what holds a check's entry, with a stand-in function
 * for the stand-in. Nothing here runs Docker or starts a process.
 */
import { describe, expect, test } from "bun:test"

import type { Answer } from "../host/host-docker"
import {
  alive,
  ENTRY,
  killArgs,
  procAt,
  procOf,
  procWords,
  stopTagged,
  TAGGED_SCRIPT,
  tagged,
  taggedArgs,
  taggedOf,
} from "./stand-in-processes"

const TOKEN = "0123456789abcdef0123456789abcdef"

describe("/proc/<pid>/stat, read", () => {
  test("the id, the name, even one holding ') ', and the state", () => {
    expect(procOf("4242 (docker) S 1 4242 4242 0 -1\n")).toEqual({
      pid: 4242,
      comm: "docker",
      state: "S",
    })
    expect(procOf("7 (a) b) Z 1 7")).toEqual({
      pid: 7,
      comm: "a) b",
      state: "Z",
    })
    for (const bad of [
      "",
      "x (docker) S 1",
      "0 (docker) S",
      "12 docker S",
      "12 (docker) 5 1",
    ])
      expect(procOf(bad)).toBeUndefined()
  })

  test("alive is there and neither a zombie nor dead, and the words say which", () => {
    const at = (state: string) => ({ pid: 9, comm: "docker", state })
    expect(alive(at("S"))).toBe(true)
    expect(alive(at("R"))).toBe(true)
    expect(alive(at("Z"))).toBe(false)
    expect(alive(at("X"))).toBe(false)
    expect(alive(undefined)).toBe(false)
    expect(procWords(at("S"))).toBe("alive (docker, S)")
    expect(procWords(at("Z"))).toBe("exited, not yet reaped (docker)")
    expect(procWords(at("X"))).toBe("gone")
    expect(procWords(undefined)).toBe("gone")
  })
})

describe("processes found by an entry of their environment", () => {
  test("the listing gives grep each entry as a fixed whole record, and refuses anything else", () => {
    expect(
      taggedArgs([`ZEKNO_BUILD_RUN=${TOKEN}`, "ZEKNO_CHECK_PARENT=p-1"])
    ).toEqual([
      "sh",
      "-c",
      TAGGED_SCRIPT,
      "sh",
      ...["-e", `ZEKNO_BUILD_RUN=${TOKEN}`, "-e", "ZEKNO_CHECK_PARENT=p-1"],
    ])
    expect(TAGGED_SCRIPT).toContain('grep -qzxF "$@" -- "$f"')
    expect(() => taggedArgs([])).toThrow("a process is found by an entry")
    for (const bad of ["ZEKNO_BUILD_RUN=", "x=1", "A=b c", "A=$(x)", "A=.*"])
      expect(() => taggedArgs([bad])).toThrow("is not an entry a check gives")
    expect(ENTRY.test("A_1=x.y-z")).toBe(true)
    expect(
      taggedOf(
        "10 (docker) S 1\n11 (docker-buildx) S 10\n10 (docker) S 1\nnoise\n"
      )
    ).toEqual([
      { pid: 10, comm: "docker", state: "S" },
      { pid: 11, comm: "docker-buildx", state: "S" },
    ])
  })

  test("SIGKILL to the ids given, each checked", () => {
    expect(killArgs([10, 11])).toEqual([
      "sh",
      "-c",
      'kill -9 "$@" 2> /dev/null || :',
      "sh",
      "10",
      "11",
    ])
    for (const pid of [1, 0, -5, 1.5]) expect(() => killArgs([pid])).toThrow()
  })
})

/** A stand-in holding `procs`; a kill takes them away unless they `resist`. */
function stand(procs: Map<number, string>, resist = new Set<number>()) {
  const calls: string[][] = []
  const run = async (args: readonly string[]): Promise<Answer> => {
    calls.push([...args])
    if (args[0] === "cat") {
      const pid = Number(/^\/proc\/(\d+)\/stat$/.exec(args[1]!)?.[1])
      const comm = procs.get(pid)
      return comm === undefined
        ? { code: 1, stdout: "", stderr: "No such file or directory" }
        : { code: 0, stdout: `${pid} (${comm}) S 1\n`, stderr: "" }
    }
    if (args[2] === TAGGED_SCRIPT)
      return {
        code: 0,
        stdout: [...procs]
          .map(([pid, comm]) => `${pid} (${comm}) S 1`)
          .join("\n"),
        stderr: "",
      }
    for (const pid of args.slice(4).map(Number))
      if (!resist.has(pid)) procs.delete(pid)
    return { code: 0, stdout: "", stderr: "" }
  }
  return { run, calls }
}

describe("the stop", () => {
  const entries = [`ZEKNO_BUILD_RUN=${TOKEN}`]
  const noWait = async () => undefined

  test("kills what holds the entry and looks again until none is left", async () => {
    const { run, calls } = stand(
      new Map([
        [10, "docker"],
        [11, "docker-buildx"],
      ])
    )
    expect(await tagged(run, entries)).toHaveLength(2)
    expect(await stopTagged(run, entries, noWait)).toEqual([])
    expect(calls.filter((call) => call[2]?.startsWith("kill"))).toEqual([
      killArgs([10, 11]),
    ])
  })

  test("nothing found, nothing killed; one that will not stop is given back after ten rounds", async () => {
    const none = stand(new Map())
    expect(await stopTagged(none.run, entries, noWait)).toEqual([])
    expect(none.calls).toHaveLength(1)
    const held = stand(new Map([[12, "docker"]]), new Set([12]))
    expect(await stopTagged(held.run, entries, noWait)).toEqual([
      { pid: 12, comm: "docker", state: "S" },
    ])
    expect(
      held.calls.filter((call) => call[2]?.startsWith("kill"))
    ).toHaveLength(10)
  })

  test("one process by its id: its stat, or undefined once it is gone", async () => {
    const { run } = stand(new Map([[10, "docker"]]))
    expect(await procAt(run, 10)).toEqual({
      pid: 10,
      comm: "docker",
      state: "S",
    })
    expect(await procAt(run, 99)).toBeUndefined()
    await expect(procAt(run, 0)).rejects.toThrow("is not a process id")
  })
})
