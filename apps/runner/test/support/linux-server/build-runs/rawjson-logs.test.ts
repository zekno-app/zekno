/**
 * `rawjson-logs.ts` (specs/016-build-from-source, T015 to T018), branch by
 * branch: the steps' output decoded from `--progress=rawjson`, the lines
 * between two of its lines, and the hiding of values a record must not
 * show. Pure; nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import { HIDDEN, hide, linesBetween, stepOutput } from "./rawjson-logs"

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64")
const status = (value: unknown) => JSON.stringify(value)

describe("stepOutput", () => {
  test("decodes the logs of every status, in order, and nothing else", () => {
    const stderr = [
      status({
        vertexes: [{ digest: "sha256:1", name: "[2/2] RUN echo begin" }],
      }),
      status({
        logs: [
          { vertex: "sha256:1", stream: 1, data: b64("begin\nPATH=/bin\n") },
        ],
      }),
      "#9 a plain line buildx printed",
      "{ not json",
      status(null),
      status({ logs: "not a list" }),
      status({ logs: [{ data: 7 }, null, { data: b64("end\n") }] }),
    ].join("\n")
    expect(stepOutput(stderr)).toBe("begin\nPATH=/bin\nend\n")
  })

  test("joins a line a step printed in two pieces", () => {
    const stderr = [
      status({ logs: [{ data: b64("zekno-") }] }),
      status({ logs: [{ data: b64("check\n") }] }),
    ].join("\r\n")
    expect(stepOutput(stderr)).toBe("zekno-check\n")
  })

  test("is empty when nothing was printed", () => {
    expect(stepOutput("")).toBe("")
    expect(stepOutput(status({ vertexes: [] }))).toBe("")
  })
})

describe("linesBetween", () => {
  test("gives the lines between begin and end, without empty ones", () => {
    expect(
      linesBetween("x\nbegin\r\nA=1\n\nB=\nend\ny\n", "begin", "end")
    ).toEqual(["A=1", "B="])
  })

  test("runs to the end of the output when end never came", () => {
    expect(linesBetween("begin\nA=1\n", "begin", "end")).toEqual(["A=1"])
  })

  test("is undefined when begin was never printed", () => {
    expect(linesBetween("A=1\nend\n", "begin", "end")).toBeUndefined()
    expect(linesBetween("not begin here\n", "begin", "end")).toBeUndefined()
  })
})

describe("hide", () => {
  test("replaces each value, the longest first, and leaves the rest", () => {
    expect(hide("token abc and abcdef", ["abc", "abcdef"])).toBe(
      `token ${HIDDEN} and ${HIDDEN}`
    )
    expect(hide("nothing to hide", ["secret"])).toBe("nothing to hide")
  })

  test("ignores an empty value", () => {
    expect(hide("text", [""])).toBe("text")
  })
})
