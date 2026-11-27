/**
 * `build-records.ts` (specs/016-build-from-source, T013): one record found
 * in `docker buildx history ls --format json` by its id, its status in
 * either shape buildx writes, `history inspect` in words, and the seconds
 * between two of Docker's times, with a stand-in function for the stand-in.
 * Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  HISTORY_LS,
  historyInspectArgs,
  inspectRecord,
  inspectWords,
  recordState,
  recordStateOf,
  refIds,
  secondsBetween,
  timeOf,
} from "./build-records"
import type { Answer } from "../host/host-docker"

const ID = "qx8ehbmaqylxwjdbwpwjq2l1y"
const OTHER = "a8k2m4n6p8r0t2v4x6z8b0d2f"
const HOME = "/tmp/zekno-check-stopping/parent/home"

const LS = [
  JSON.stringify({
    ref: `default/default/${OTHER}`,
    name: "other",
    status: "Completed",
    created_at: "2026-11-27T10:00:00Z",
    completed_at: "2026-11-27T10:00:01Z",
  }),
  JSON.stringify({
    ref: `default/default/${ID}`,
    name: "check-stopping",
    status: "Running",
    created_at: "2026-11-27T10:01:00.123456789Z",
    total_steps: 3,
  }),
].join("\n")

describe("a record's state, read from history ls", () => {
  test("the record of the id, its status as buildx gave it, and its times", () => {
    expect(recordStateOf(LS, ID)).toEqual({
      status: "Running",
      createdAt: "2026-11-27T10:01:00.123456789Z",
    })
    expect(recordStateOf(LS, OTHER)).toEqual({
      status: "Completed",
      createdAt: "2026-11-27T10:00:00Z",
      completedAt: "2026-11-27T10:00:01Z",
    })
    expect(recordStateOf(LS, "zzzzzzzzzzzzzzzzzzzzzzzzz")).toBeUndefined()
    expect(recordStateOf("", ID)).toBeUndefined()
    expect(recordStateOf("not json\n[1]\nnull", ID)).toBeUndefined()
  })

  test("one array, and the older shape: Running until completed, then Error or Completed", () => {
    const array = JSON.stringify([
      { Ref: `default/default/${ID}`, CreatedAt: "2026-11-27T10:01:00Z" },
    ])
    expect(recordStateOf(array, ID)).toEqual({
      status: "Running",
      createdAt: "2026-11-27T10:01:00Z",
    })
    const failed = JSON.stringify({
      Ref: ID,
      CompletedAt: "2026-11-27T10:01:30Z",
      Error: { Code: 1, Message: "canceled" },
    })
    expect(recordStateOf(failed, ID)?.status).toBe("Error")
    const done = JSON.stringify({
      Ref: ID,
      CompletedAt: "2026-11-27T10:01:30Z",
      Error: null,
    })
    expect(recordStateOf(done, ID)?.status).toBe("Completed")
    expect(recordStateOf("[not json", ID)).toBeUndefined()
  })
})

describe("history inspect, in words", () => {
  test("keeps the status, duration, steps and error lines; else its first line", () => {
    expect(
      inspectWords(
        [
          "Context:        .",
          "Dockerfile:     Dockerfile",
          "",
          "Started:        2026-11-27 10:01:00",
          "Duration:       1m 30s",
          "Build Steps:    3/3 (33% cached)",
          "Error:          Canceled  context canceled",
        ].join("\n")
      )
    ).toBe(
      "Duration: 1m 30s, Build Steps: 3/3 (33% cached), Error: Canceled context canceled"
    )
    expect(inspectWords("Name: x\nContext: .\n")).toBe("Name: x")
    expect(inspectWords("")).toBe("nothing printed")
  })

  test("names one record by its id only", () => {
    expect(historyInspectArgs(ID)).toEqual([
      ...["docker", "buildx", "history", "inspect", "--builder", "default"],
      ID,
    ])
    for (const bad of ["", "../x", "--all", "a b"])
      expect(() => historyInspectArgs(bad)).toThrow(
        "is not a build record's id"
      )
  })
})

describe("Docker's times", () => {
  test("RFC 3339 with up to nine digits, any offset", () => {
    expect(timeOf("2026-11-27T10:00:00Z")).toBe(Date.UTC(2026, 10, 27, 10))
    expect(timeOf("2026-11-27T10:00:00.123456789Z")).toBe(
      Date.UTC(2026, 10, 27, 10, 0, 0, 123)
    )
    expect(timeOf("2026-11-27T11:00:00.5+01:00")).toBe(
      Date.UTC(2026, 10, 27, 10, 0, 0, 500)
    )
    for (const bad of [undefined, "", "yesterday", "2026-11-27 10:00:00"])
      expect(timeOf(bad)).toBeUndefined()
  })

  test("seconds between two, to a tenth", () => {
    expect(
      secondsBetween(
        "2026-11-27T10:00:10.050000000Z",
        "2026-11-27T10:01:29.700000000Z"
      )
    ).toBe(79.7)
    expect(secondsBetween("2026-11-27T10:00:10Z", undefined)).toBeUndefined()
    expect(secondsBetween("x", "2026-11-27T10:00:10Z")).toBeUndefined()
  })
})

describe("in the stand-in", () => {
  const stand = (answer: Answer) => {
    const calls: string[][] = []
    const run = async (args: readonly string[]) => {
      calls.push([...args])
      return answer
    }
    return { run, calls }
  }

  test("history ls with the check's own BUILDX_CONFIG; a failure throws one line", async () => {
    const ok = stand({ code: 0, stdout: LS, stderr: "" })
    expect((await recordState(ok.run, HOME, ID))?.status).toBe("Running")
    expect(ok.calls[0]!.slice(0, 2)).toEqual(["env", "-i"])
    expect(ok.calls[0]).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
    expect(ok.calls[0]!.slice(-HISTORY_LS.length)).toEqual([...HISTORY_LS])
    const bad = stand({
      code: 1,
      stdout: "",
      stderr: "ERROR: no builder\nmore",
    })
    await expect(recordState(bad.run, HOME, ID)).rejects.toThrow(
      "docker buildx history ls failed: ERROR: no builder"
    )
  })

  test("the ids buildx keeps in the check's own BUILDX_CONFIG, one per build", async () => {
    const some = stand({
      code: 0,
      stdout: `${ID}\n\n${OTHER}\n.lock\n`,
      stderr: "",
    })
    expect(await refIds(some.run, HOME)).toEqual([ID, OTHER])
    expect(some.calls[0]).toEqual([
      "sh",
      "-c",
      'ls -1 "$1" 2> /dev/null || :',
      "sh",
      `${HOME}/buildx/refs/default/default`,
    ])
    expect(
      await refIds(stand({ code: 0, stdout: "", stderr: "" }).run, HOME)
    ).toEqual([])
  })

  test("history inspect, in words, or why it failed", async () => {
    const ok = stand({ code: 0, stdout: "Duration: 2s\n", stderr: "" })
    expect(await inspectRecord(ok.run, HOME, ID)).toBe("Duration: 2s")
    expect(ok.calls[0]!.slice(-7)).toEqual(historyInspectArgs(ID))
    const bad = stand({
      code: 1,
      stdout: "",
      stderr: `ERROR: ref ${ID} is deleted\n`,
    })
    expect(await inspectRecord(bad.run, HOME, ID)).toBe(
      `history inspect failed: ERROR: ref ${ID} is deleted`
    )
  })
})
