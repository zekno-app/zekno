/**
 * `builder-output.ts` (specs/016-build-from-source, T011), branch by
 * branch: `--policy` in buildx's help, buildx's version, the builder's first
 * error, a build's record id, and the words of a record line. Nothing here
 * runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  buildxVersionOf,
  firstError,
  outcomeWords,
  policyListed,
  refOf,
} from "./builder-output"
import type { Answer } from "../host/host-docker"

describe("what buildx printed", () => {
  test("--policy is read from docker buildx build --help", () => {
    expect(
      policyListed(
        "Options:\n      --platform stringArray   Set target platform\n      --policy stringArray     Policy configuration\n"
      )
    ).toBe(true)
    expect(
      policyListed(
        "Options:\n      --platform stringArray   Set target platform\n      --progress string   Set type of progress output (--policy is not here)\n"
      )
    ).toBe(false)
    expect(policyListed("")).toBe(false)
  })

  test("the version is read from docker buildx version", () => {
    expect(buildxVersionOf("github.com/docker/buildx v0.34.1 8a7c1d2e\n")).toBe(
      "0.34.1"
    )
    expect(
      buildxVersionOf(
        "github.com/docker/buildx 0.30.1 0.30.1-0ubuntu1~24.04.1\n"
      )
    ).toBe("0.30.1")
    expect(buildxVersionOf("buildx\n")).toBeUndefined()
    expect(buildxVersionOf("")).toBeUndefined()
  })
})

describe("the builder's first error", () => {
  const vertex = (name: string, error?: string) =>
    JSON.stringify({
      vertexes: [{ digest: "sha256:1", name, ...(error ? { error } : {}) }],
    })
  const answer = (stderr: string, code = 1): Answer => ({
    code,
    stdout: "",
    stderr,
  })

  test("is the first failed vertex of rawjson, with its name and the error's first line", () => {
    expect(
      firstError(
        answer(
          [
            vertex("[internal] load build definition from Dockerfile"),
            JSON.stringify({ statuses: [{ id: "x" }], logs: [] }),
            "null",
            vertex(
              "resolve image config for docker-image://docker.io/library/dockerfile.v0:latest",
              "pull access denied, repository does not exist\nmore"
            ),
            vertex("later", "context canceled"),
            "ERROR: failed to build: failed to solve: dockerfile.v0: pull access denied",
          ].join("\n")
        )
      )
    ).toBe(
      "resolve image config for docker-image://docker.io/library/dockerfile.v0:latest: pull access denied, repository does not exist"
    )
    expect(
      firstError(answer(JSON.stringify({ vertexes: [{ error: "denied" }] })))
    ).toBe("denied")
  })

  test("else buildx's ERROR line, else the first line that is no warning, else the exit status", () => {
    expect(
      firstError(
        answer(
          'WARNING: x\n{"vertexes":[{"name":"a"}]}\nERROR: failed to build: denied by policy\n'
        )
      )
    ).toBe("failed to build: denied by policy")
    expect(
      firstError(
        answer(
          "Error response from daemon: conflict: unable to remove repository reference\n"
        )
      )
    ).toBe(
      "Error response from daemon: conflict: unable to remove repository reference"
    )
    expect(
      firstError(
        answer(
          "WARNING: something\ndocker: unknown command: docker buildx\n\nRun 'docker --help'\n"
        )
      )
    ).toBe("docker: unknown command: docker buildx")
    expect(firstError(answer("WARNING: only this\n"))).toBe(
      "WARNING: only this"
    )
    expect(firstError(answer("", 7))).toBe("exit 7, nothing printed")
    expect(firstError(answer(`ERROR: ${"x".repeat(2000)}`)).length).toBe(1000)
    expect(
      firstError({ code: 1, stdout: "error: from stdout\n", stderr: "" })
    ).toBe("from stdout")
  })
})

describe("a build's record and outcome", () => {
  test("the record id is the last part of buildx.build.ref", () => {
    expect(
      refOf({ "buildx.build.ref": "default/default/abc123def456ghi" })
    ).toBe("abc123def456ghi")
    expect(refOf({})).toBeUndefined()
    expect(refOf(undefined)).toBeUndefined()
    expect(refOf({ "buildx.build.ref": 3 })).toBeUndefined()
    expect(refOf({ "buildx.build.ref": "" })).toBeUndefined()
  })

  test("the outcome is built, or not built with the first error", () => {
    expect(outcomeWords({ built: true })).toBe("built")
    expect(outcomeWords({ built: false, error: "denied" })).toBe(
      "not built: denied"
    )
    expect(outcomeWords({ built: false })).toBe("not built: no error read")
  })
})
