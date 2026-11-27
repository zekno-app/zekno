/**
 * `build-progress.ts` (specs/016-build-from-source, T012 to T014), branch
 * by branch: rawjson updates merged by vertex, the steps and whether each
 * was cached, what the steps printed, and the lines outside the JSON.
 * Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  cachedWords,
  lastLines,
  logText,
  progressOf,
  progressOfAnswer,
  stepNamed,
  stepRunning,
  stepsOf,
  taggedLine,
} from "./build-progress"

const b64 = (text: string) => btoa(text)
const line = (value: unknown) => JSON.stringify(value)

const T = "2026-11-27T10:00:00.123456789Z"
const OUTPUT = [
  line({
    vertexes: [
      {
        digest: "sha256:a",
        name: "[internal] load build definition from Dockerfile",
        started: T,
      },
    ],
  }),
  line({
    vertexes: [
      {
        digest: "sha256:b",
        name: "[1/3] FROM docker.io/library/busybox@sha256:73aa",
        started: T,
      },
      { digest: "sha256:a", completed: T },
    ],
  }),
  line({ vertexes: [{ digest: "sha256:b", cached: true, completed: T }] }),
  line({
    vertexes: [
      {
        digest: "sha256:c",
        name: "[2/3] RUN --mount=type=cache,target=/cache echo hi",
        started: T,
      },
    ],
  }),
  line({
    logs: [
      {
        vertex: "sha256:c",
        stream: 1,
        data: b64("zekno-check-cache saw: k-a1"),
        timestamp: T,
      },
    ],
  }),
  line({
    logs: [
      {
        vertex: "sha256:c",
        stream: 1,
        data: b64(" k-b1\nnext\n"),
        timestamp: T,
      },
    ],
  }),
  line({ vertexes: [{ digest: "sha256:c", completed: T }] }),
  line({
    vertexes: [
      {
        digest: "sha256:d",
        name: "[stage-0 3/3] COPY a.txt /a.txt",
        cached: true,
        started: T,
        completed: T,
      },
    ],
  }),
  line({
    vertexes: [{ digest: "sha256:e", name: "exporting to image", started: T }],
  }),
  "ERROR: failed to build: something",
  "",
  line([1, 2]),
].join("\n")

describe("rawjson, read", () => {
  test("updates are merged by vertex: the name kept, cached and the times once set, the error kept", () => {
    const progress = progressOf(OUTPUT)
    expect(progress.vertexes.map((vertex) => vertex.digest)).toEqual([
      "sha256:a",
      "sha256:b",
      "sha256:c",
      "sha256:d",
      "sha256:e",
    ])
    expect(progress.vertexes[1]).toEqual({
      digest: "sha256:b",
      name: "[1/3] FROM docker.io/library/busybox@sha256:73aa",
      cached: true,
      started: true,
      completed: true,
    })
    expect(progress.vertexes[4]!.completed).toBe(false)
    expect(progress.plain).toEqual([
      "ERROR: failed to build: something",
      "[1,2]",
    ])
    const failed = progressOf(
      [
        line({
          vertexes: [
            {
              digest: "sha256:x",
              name: "[1/1] RUN x",
              error: "  exit code: 137 ",
            },
          ],
        }),
        line({ vertexes: [{ digest: "sha256:x", error: "" }] }),
        line({
          vertexes: [{ name: "no digest" }, "not a vertex"],
          logs: [{ vertex: 1 }, "x"],
        }),
        line({ vertexes: "not a list" }),
      ].join("\n")
    )
    expect(failed.vertexes).toEqual([
      {
        digest: "sha256:x",
        name: "[1/1] RUN x",
        cached: false,
        started: false,
        completed: false,
        error: "exit code: 137",
      },
    ])
  })

  test("a build's answer is read from both its streams", () => {
    const progress = progressOfAnswer({
      code: 1,
      stdout: "ERROR: out\n",
      stderr: line({ vertexes: [{ digest: "sha256:z", name: "[1/1] RUN z" }] }),
    })
    expect(progress.vertexes.map((vertex) => vertex.name)).toEqual([
      "[1/1] RUN z",
    ])
    expect(progress.plain).toEqual(["ERROR: out"])
  })
})

describe("the steps", () => {
  const progress = progressOf(OUTPUT)

  test("are the vertexes named [n/m] or [stage n/m], never [internal] or the export", () => {
    expect(stepsOf(progress).map((step) => step.digest)).toEqual([
      "sha256:b",
      "sha256:c",
      "sha256:d",
    ])
    expect(stepNamed(progress, "COPY a.txt")?.digest).toBe("sha256:d")
    expect(stepNamed(progress, "exporting")).toBeUndefined()
  })

  test("a step runs once started and until completed", () => {
    const running = progressOf(
      line({
        vertexes: [
          { digest: "sha256:s", name: "[2/2] RUN sleep 90 # m1", started: T },
        ],
      })
    )
    expect(stepRunning(running, "m1")).toBe(true)
    expect(stepRunning(running, "m2")).toBe(false)
    expect(stepRunning(progress, "echo hi")).toBe(false)
    const waiting = progressOf(
      line({
        vertexes: [{ digest: "sha256:s", name: "[2/2] RUN sleep 90 # m1" }],
      })
    )
    expect(stepRunning(waiting, "m1")).toBe(false)
  })

  test("the words say every step cached, or which were not, or that none was read", () => {
    const steps = stepsOf(progress)
    expect(cachedWords(steps)).toBe(
      "2 of 3 steps cached; not cached: [2/3] RUN --mount=type=cache,target=/cache echo hi"
    )
    expect(cachedWords(steps.filter((step) => step.cached))).toBe(
      "every step cached (2 of 2)"
    )
    expect(cachedWords([])).toBe("no step read")
    const long = { ...steps[1]!, name: `[2/3] RUN ${"x".repeat(100)}` }
    expect(cachedWords([long])).toMatch(
      /^0 of 1 steps cached; not cached: \[2\/3\] RUN x+…$/
    )
    expect(cachedWords([long]).length).toBeLessThan(140)
  })
})

describe("what the steps printed", () => {
  const progress = progressOf(OUTPUT)

  test("is joined per vertex, in the vertexes' order", () => {
    expect(logText(progress)).toBe("zekno-check-cache saw: k-a1 k-b1\nnext\n")
    expect(logText(progressOf(""))).toBe("")
  })

  test("a tagged line gives what follows its tag; none when no step printed it", () => {
    expect(taggedLine(progress, "zekno-check-cache saw:")).toBe("k-a1 k-b1")
    expect(taggedLine(progress, "zekno-check-other")).toBeUndefined()
    expect(() => taggedLine(progress, "")).toThrow("a tag names the line")
  })

  test("a log that is not base64 reads as nothing", () => {
    const bad = progressOf(
      line({ logs: [{ vertex: "sha256:q", data: "%%%" }] })
    )
    expect(bad.logs.get("sha256:q")).toBe("")
  })

  test("the last lines: buildx's own, and the steps'", () => {
    expect(lastLines(progress, 2)).toEqual({
      plain: ["ERROR: failed to build: something", "[1,2]"],
      steps: ["zekno-check-cache saw: k-a1 k-b1", "next"],
    })
    expect(lastLines(progressOf(""))).toEqual({ plain: [], steps: [] })
  })
})
