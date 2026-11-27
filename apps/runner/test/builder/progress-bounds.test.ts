/**
 * The builder's output: what is kept and the bounds
 * (specs/016-build-from-source, T075; contracts/runner.md RB9; contracts/
 * core.md CO11): whether a step other than FROM came from the cache, the
 * failing step and the last error, kept in memory only; a line read at most
 * 1 MiB, a line handed on at most 4,096 characters, the failing step cut to
 * 1,024; text that is not rawjson handed on as it is. Nothing here runs
 * Docker.
 */
import { describe, expect, test } from "bun:test"

import { MAX_READ_LINE_BYTES, readProgress } from "../../src/builder/progress"
import { at, b64, encoder, rawjson, read, streamOf } from "./progress-samples"

describe("what is kept: a cached step", () => {
  const cachedVertex = (name: string) =>
    rawjson({
      vertexes: [
        {
          digest: "sha256:a",
          name,
          started: at(0),
          completed: at(1),
          cached: true,
        },
      ],
    })

  test("a cached FROM or [internal] vertex does not count as cached", async () => {
    for (const name of [
      "[1/3] FROM docker.io/library/busybox@sha256:73aa",
      "[build 1/7] FROM docker.io/library/node:22-slim",
      "[stage-0 1/2] from docker.io/library/node:22-slim",
      "[internal] load metadata for docker.io/library/node:22-slim",
      "[internal] load build context",
      "[auth] library/node:pull token for registry-1.docker.io",
      "exporting to image",
    ])
      expect((await read(cachedVertex(name))).seen.cached).toBe(false)
  })

  test("a cached step of any stage counts", async () => {
    for (const name of [
      "[2/3] RUN npm ci",
      "[stage-0 3/3] COPY a.txt /a.txt",
      "[build 4/7] RUN npm ci",
      "[linux/amd64 build 2/3] RUN make",
    ])
      expect((await read(cachedVertex(name))).seen.cached).toBe(true)
  })
})

describe("the bounds", () => {
  test("a 5,000-character log line is cut to 4,096", async () => {
    const { lines } = await read(
      rawjson(
        {
          vertexes: [
            { digest: "sha256:a", name: "[2/2] RUN x", started: at(0) },
          ],
        },
        {
          logs: [
            {
              vertex: "sha256:a",
              stream: 1,
              data: b64(`${"x".repeat(5000)}\n`),
              timestamp: at(1),
            },
          ],
        }
      )
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toHaveLength(4096)
    expect(lines[1]).toStartWith("#1 0.001 xxx")
  })

  test("a cut never splits a character in two", async () => {
    const { lines } = await read(`${"a".repeat(4095)}😀b\n`)
    expect(lines).toEqual(["a".repeat(4095)])
  })

  test("a 2 MiB line is dropped whole, and the lines around it are read", async () => {
    const big = rawjson({
      logs: [
        {
          vertex: "sha256:a",
          stream: 1,
          data: b64("y".repeat(2 * 1024 * 1024)),
          timestamp: at(1),
        },
      ],
    })
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024)
    const { lines } = await read(
      rawjson({
        vertexes: [{ digest: "sha256:a", name: "[2/2] RUN x", started: at(0) }],
      }),
      // Cut in pieces, as a pipe gives it.
      ...Array.from({ length: Math.ceil(big.length / 65_536) }, (_, index) =>
        big.slice(index * 65_536, (index + 1) * 65_536)
      ),
      "after\n"
    )
    expect(lines).toEqual(["#1 [2/2] RUN x", "after"])
  })

  test("a text line of 2 MiB with no end is dropped too", async () => {
    const { lines } = await read("before\n", "z".repeat(2 * 1024 * 1024))
    expect(lines).toEqual(["before"])
  })

  test("a line of exactly 1 MiB is read, and cut", async () => {
    expect(MAX_READ_LINE_BYTES).toBe(1024 * 1024)
    const { lines } = await read(`${"w".repeat(MAX_READ_LINE_BYTES)}\nnext\n`)
    expect(lines).toEqual(["w".repeat(4096), "next"])
  })

  test("the failing step is cut to 1,024 characters and its error to 4,096; the last error keeps its end", async () => {
    const name = `[2/2] RUN ${"n".repeat(2000)}`
    const error = `process "${"e".repeat(5000)}" did not complete successfully: exit code: 137`
    const { seen } = await read(
      rawjson({
        vertexes: [
          { digest: "sha256:a", name, started: at(0), completed: at(1), error },
        ],
      })
    )
    expect(seen.failed?.step).toBe(name.slice(0, 1024))
    expect(seen.failed?.error).toBe(error.slice(0, 4096))
    expect(seen.lastError).toHaveLength(4096)
    expect(seen.lastError).toEndWith(
      "did not complete successfully: exit code: 137"
    )
  })

  test("the first step that failed is the one kept, never a cancelled one", async () => {
    const { seen } = await read(
      rawjson(
        {
          vertexes: [
            {
              digest: "sha256:a",
              name: "[a 2/2] RUN x",
              started: at(0),
              completed: at(1),
              error: "context canceled",
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:b",
              name: "[b 2/2] RUN y",
              started: at(0),
              completed: at(2),
              error: "exit code: 2",
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:c",
              name: "[c 2/2] RUN z",
              started: at(0),
              completed: at(3),
              error: "exit code: 3",
            },
          ],
        }
      )
    )
    expect(seen.failed).toEqual({
      step: "[b 2/2] RUN y",
      error: "exit code: 2",
    })
    expect(seen.lastError).toBe("exit code: 3")
  })
})

describe("text that is not rawjson", () => {
  test("a line that is not JSON is handed on as it is, cut, and parsed no further", async () => {
    const { lines, seen } = await read(
      '#0 building with "default" instance using docker driver\n',
      '{"vertexes": [ not json\n',
      "[1,2]\n",
      `${"t".repeat(5000)}\n`,
      "\n   \n"
    )
    expect(lines).toEqual([
      '#0 building with "default" instance using docker driver',
      '{"vertexes": [ not json',
      "[1,2]",
      "t".repeat(4096),
    ])
    expect(seen).toEqual({ cached: false })
  })

  test("an OSC 52 sequence is passed on as text, for zekno to sanitize", async () => {
    const osc = "\u001b]52;c;Y3VybCBldmlsLnNoIHwgc2g=\u0007"
    const { lines } = await read(
      `${osc}\n`,
      rawjson(
        {
          vertexes: [
            { digest: "sha256:a", name: "[2/2] RUN x", started: at(0) },
          ],
        },
        {
          logs: [
            {
              vertex: "sha256:a",
              stream: 1,
              data: b64(`say ${osc}\n`),
              timestamp: at(5),
            },
          ],
        }
      )
    )
    expect(lines).toEqual([osc, "#1 [2/2] RUN x", `#1 0.005 say ${osc}`])
  })

  test("buildx's own error line is kept as the last error", async () => {
    const { seen } = await read(
      "WARNING: something\n",
      "ERROR: failed to build: failed to solve: no space left on device\n",
      "trailing words\n"
    )
    expect(seen.lastError).toBe(
      "ERROR: failed to build: failed to solve: no space left on device"
    )
  })

  test("a character cut between two chunks is read whole", async () => {
    const bytes = encoder.encode("héllo\n")
    const { lines } = await read(bytes.subarray(0, 2), bytes.subarray(2))
    expect(lines).toEqual(["héllo"])
  })

  test("a carriage return before the line feed is dropped", async () => {
    const { lines } = await read("plain\r\n")
    expect(lines).toEqual(["plain"])
  })
})

describe("the reader", () => {
  test("waits for each line to be taken before it hands on the next", async () => {
    const taken: string[] = []
    let busy = false
    await readProgress(streamOf("one\ntwo\nthree\n"), async (line) => {
      expect(busy).toBe(false)
      busy = true
      await Bun.sleep(5)
      taken.push(line)
      busy = false
    })
    expect(taken).toEqual(["one", "two", "three"])
  })

  test("a stream that breaks off gives what was read", async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls === 1) controller.enqueue(encoder.encode("first\nhalf"))
        else controller.error(new Error("the pipe broke"))
      },
    })
    const lines: string[] = []
    const seen = await readProgress(stream, (line) => {
      lines.push(line)
    })
    expect(lines).toEqual(["first", "half"])
    expect(seen).toEqual({ cached: false })
  })

  test("a reader that fails gets no more lines, and the output is still read to its end", async () => {
    let pulls = 0
    const parts = [
      "one\n",
      "two\n",
      rawjson({
        vertexes: [
          {
            digest: "sha256:a",
            name: "[2/2] RUN x",
            started: at(0),
            completed: at(1),
            error: "exit code: 1",
          },
        ],
      }),
    ]
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = parts[pulls]
        pulls += 1
        if (part === undefined) controller.close()
        else controller.enqueue(encoder.encode(part))
      },
    })
    const lines: string[] = []
    const seen = await readProgress(stream, (line) => {
      lines.push(line)
      if (line === "two") throw new Error("the session closed")
    })
    expect(lines).toEqual(["one", "two"])
    expect(pulls).toBe(4)
    expect(seen.failed).toEqual({ step: "[2/2] RUN x", error: "exit code: 1" })
  })
})
