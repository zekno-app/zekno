/**
 * The builder's output in the plain form (specs/016-build-from-source,
 * T075; contracts/runner.md RB9; contracts/core.md CO11): buildx's
 * `--progress=rawjson` lines, shaped as E06 recorded them, turned into the
 * lines `docker build` prints and handed on one at a time. The bounds, what
 * is kept and text that is not rawjson are in `progress-bounds.test.ts`.
 * Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import { at, b64, DIGEST64, rawjson, read } from "./progress-samples"

describe("the plain form", () => {
  test("a run: each step named by its number, its statuses, its lines and DONE", async () => {
    const { lines, seen } = await read(
      rawjson(
        {
          vertexes: [
            {
              digest: "sha256:a",
              name: "[internal] load build definition from Dockerfile",
              started: at(0),
            },
          ],
        },
        {
          statuses: [
            {
              id: "transferring dockerfile:",
              vertex: "sha256:a",
              current: 1020,
              timestamp: at(20),
              started: at(0),
              completed: at(20),
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:a",
              name: "[internal] load build definition from Dockerfile",
              started: at(0),
              completed: at(30),
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:b",
              name: `[build 1/3] FROM docker.io/library/node:22@sha256:${DIGEST64}`,
              started: at(40),
            },
          ],
          statuses: [
            {
              id: `resolve docker.io/library/node:22@sha256:${DIGEST64}`,
              vertex: "sha256:b",
              timestamp: at(140),
              started: at(40),
              completed: at(140),
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:b",
              name: `[build 1/3] FROM docker.io/library/node:22@sha256:${DIGEST64}`,
              started: at(40),
              completed: at(150),
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:c",
              inputs: ["sha256:b"],
              name: "[build 2/3] RUN npm ci",
              started: at(1000),
            },
          ],
        },
        {
          logs: [
            {
              vertex: "sha256:c",
              stream: 1,
              data: b64("added 1 package\nfound 0 vulnerabilities\n"),
              timestamp: at(1512),
            },
          ],
        },
        {
          logs: [
            {
              vertex: "sha256:c",
              stream: 2,
              data: b64("npm notice New version\n"),
              timestamp: at(13_250),
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:c",
              inputs: ["sha256:b"],
              name: "[build 2/3] RUN npm ci",
              started: at(1000),
              completed: at(39_100),
            },
          ],
        }
      )
    )
    expect(lines).toEqual([
      "#1 [internal] load build definition from Dockerfile",
      "#1 transferring dockerfile: 1.02kB done",
      "#1 DONE 0.0s",
      `#2 [build 1/3] FROM docker.io/library/node:22@sha256:${DIGEST64}`,
      `#2 resolve docker.io/library/node:22@sha256:${DIGEST64} 0.1s done`,
      "#2 DONE 0.1s",
      "#3 [build 2/3] RUN npm ci",
      "#3 0.512 added 1 package",
      "#3 0.512 found 0 vulnerabilities",
      "#3 12.25 npm notice New version",
      "#3 DONE 38.1s",
    ])
    expect(seen).toEqual({ cached: false })
  })

  test("a cached step: CACHED in place of DONE, and kept as cached", async () => {
    const { lines, seen } = await read(
      rawjson(
        {
          vertexes: [
            {
              digest: "sha256:a",
              name: "[2/3] RUN npm ci",
              started: at(0),
              completed: at(10),
              cached: true,
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:b",
              name: "[3/3] COPY . /app",
              started: at(20),
              completed: at(900),
            },
          ],
        }
      )
    )
    expect(lines).toEqual([
      "#1 [2/3] RUN npm ci",
      "#1 CACHED",
      "#2 [3/3] COPY . /app",
      "#2 DONE 0.9s",
    ])
    expect(seen.cached).toBe(true)
  })

  test("an error: ERROR with the vertex's error, a cancelled step CANCELED, and buildx's own last line as text", async () => {
    const error =
      'process "/bin/sh -c npm run build" did not complete successfully: exit code: 1'
    const { lines, seen } = await read(
      rawjson(
        {
          vertexes: [
            {
              digest: "sha256:d",
              name: "[build 3/3] RUN npm run build",
              started: at(0),
            },
            {
              digest: "sha256:e",
              name: "[runtime 2/2] RUN apt-get update",
              started: at(0),
            },
          ],
        },
        {
          logs: [
            {
              vertex: "sha256:d",
              stream: 2,
              data: b64("npm error code E404\n"),
              timestamp: at(3904),
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:d",
              name: "[build 3/3] RUN npm run build",
              started: at(0),
              completed: at(3950),
              error,
            },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:e",
              name: "[runtime 2/2] RUN apt-get update",
              started: at(0),
              completed: at(3960),
              error: "context canceled",
            },
          ],
        }
      ),
      `ERROR: failed to build: failed to solve: ${error}\n`
    )
    expect(lines).toEqual([
      "#1 [build 3/3] RUN npm run build",
      "#2 [runtime 2/2] RUN apt-get update",
      "#1 3.904 npm error code E404",
      `#1 ERROR: ${error}`,
      "#2 CANCELED",
      `ERROR: failed to build: failed to solve: ${error}`,
    ])
    expect(seen).toEqual({
      cached: false,
      failed: { step: "[build 3/3] RUN npm run build", error },
      lastError: `ERROR: failed to build: failed to solve: ${error}`,
    })
  })

  test("a warning is said under its step", async () => {
    const { lines } = await read(
      rawjson(
        {
          vertexes: [
            { digest: "sha256:a", name: "[1/2] FROM x", started: at(0) },
          ],
        },
        {
          warnings: [
            {
              vertex: "sha256:a",
              level: 1,
              short: b64(
                "FromAsCasing: 'as' and 'FROM' keywords' casing do not match (line 1)"
              ),
              detail: [b64("more")],
              url: "https://docs.docker.com/go/dockerfile/rule/from-as-casing/",
            },
          ],
        }
      )
    )
    expect(lines).toEqual([
      "#1 [1/2] FROM x",
      "#1 WARN: FromAsCasing: 'as' and 'FROM' keywords' casing do not match (line 1)",
    ])
  })

  test("a line a step prints over two chunks is one line, and a line with no end is still handed on", async () => {
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
              data: b64("hel"),
              timestamp: at(100),
            },
          ],
        },
        {
          logs: [
            {
              vertex: "sha256:a",
              stream: 1,
              data: b64("lo\nno end"),
              timestamp: at(200),
            },
          ],
        }
      )
    )
    expect(lines).toEqual([
      "#1 [2/2] RUN x",
      "#1 0.100 hello",
      "#1 0.200 no end",
    ])
  })

  test("a status is said once, when it completes, with its size; a blank line a step printed is not handed on", async () => {
    const { lines } = await read(
      rawjson(
        {
          vertexes: [
            { digest: "sha256:a", name: "[1/2] FROM x", started: at(0) },
          ],
        },
        {
          statuses: [
            {
              id: "sha256:1f",
              vertex: "sha256:a",
              current: 500,
              total: 3_150_000,
              timestamp: at(10),
              started: at(0),
            },
          ],
        },
        {
          statuses: [
            {
              id: "sha256:1f",
              vertex: "sha256:a",
              current: 3_150_000,
              total: 3_150_000,
              timestamp: at(400),
              started: at(0),
              completed: at(400),
            },
          ],
        },
        {
          statuses: [
            {
              id: "sha256:1f",
              vertex: "sha256:a",
              current: 3_150_000,
              total: 3_150_000,
              timestamp: at(400),
              started: at(0),
              completed: at(400),
            },
          ],
          logs: [
            {
              vertex: "sha256:a",
              stream: 1,
              data: b64("\n  \r\nshown\n"),
              timestamp: at(500),
            },
          ],
        },
        {
          vertexes: [
            { digest: "sha256:a", name: "[1/2] FROM x", completed: at(600) },
          ],
        }
      )
    )
    expect(lines).toEqual([
      "#1 [1/2] FROM x",
      "#1 sha256:1f 3.15MB / 3.15MB 0.4s done",
      "#1 0.500 shown",
      "#1 DONE 0.6s",
    ])
  })

  test("an error over several lines is said line by line; a step with no start time is DONE alone", async () => {
    const { lines } = await read(
      rawjson(
        {
          vertexes: [
            { digest: "sha256:a", name: "[2/3] RUN a", completed: at(5) },
          ],
        },
        {
          vertexes: [
            {
              digest: "sha256:b",
              name: "[3/3] RUN b",
              started: at(0),
              completed: at(5),
              error: "first\nsecond",
            },
          ],
        }
      )
    )
    expect(lines).toEqual([
      "#1 [2/3] RUN a",
      "#1 DONE",
      "#2 [3/3] RUN b",
      "#2 ERROR: first",
      "#2 second",
    ])
  })

  test("past 2,048 vertexes a new one is not shown, but its cache and its error still count", async () => {
    const many = Array.from({ length: 2048 }, (_, index) => ({
      digest: `sha256:${index}`,
      name: "[internal] load",
    }))
    const { lines, seen } = await read(
      rawjson(
        { vertexes: many },
        {
          vertexes: [
            {
              digest: "sha256:late",
              name: "[2/3] RUN late",
              started: at(0),
              completed: at(1),
              cached: true,
            },
            {
              digest: "sha256:later",
              name: "[3/3] RUN later",
              started: at(0),
              completed: at(1),
              error: "exit code: 1",
            },
          ],
        }
      )
    )
    expect(lines).toEqual([])
    expect(seen).toEqual({
      cached: true,
      failed: { step: "[3/3] RUN later", error: "exit code: 1" },
      lastError: "exit code: 1",
    })
  })

  test("a vertex not yet started, and logs of a vertex never named, print nothing", async () => {
    const { lines } = await read(
      rawjson(
        { vertexes: [{ digest: "sha256:a", name: "[2/2] RUN x" }] },
        {
          logs: [
            {
              vertex: "sha256:z",
              stream: 1,
              data: b64("lost\n"),
              timestamp: at(1),
            },
          ],
        },
        {
          vertexes: [
            { digest: "sha256:b", name: "[1/2] FROM y", started: at(2) },
          ],
        }
      )
    )
    expect(lines).toEqual(["#2 [1/2] FROM y"])
  })
})
