/**
 * `registry.ts` (specs/016-build-from-source, T011; plan item 3 (a)),
 * branch by branch: the registry's configuration and its start and stop
 * scripts, the reading of its log and of `docker push`, and the calls each
 * step makes in the stand-in. A stand-in function answers for the stand-in;
 * nothing here runs Docker. `sh -n` reads the scripts, and runs nothing.
 */
import { describe, expect, test } from "bun:test"

import type { Answer, RunOptions } from "../host/host-docker"
import { loadPins } from "../pins"
import type { InStandIn } from "./rb7"
import {
  byteCount,
  checkName,
  inRegistry,
  pushedDigest,
  REGISTRY,
  REGISTRY_FILES,
  registryConfig,
  requestsFor,
  requestWords,
  smallImage,
  SOURCE_CONTAINER,
  startRegistry,
  startScript,
  STOP_LINES,
  stopRegistry,
} from "./registry"
import { q } from "../stand-in/shell"

const BASE = loadPins().images.fixtures.image
const DIGEST = `sha256:${"ab".repeat(32)}`
const HTPASSWD = `check:$2b$10$${"a".repeat(53)}`

/** Stands in for `open.inStandIn`: records each call and answers as `answer` says. */
function fakeRun(
  answer: (args: readonly string[]) => Partial<Answer> | undefined = () =>
    undefined
) {
  const calls: { args: readonly string[]; options: RunOptions | undefined }[] =
    []
  const run: InStandIn = async (args, options) => {
    calls.push({ args, options })
    return { code: 0, stdout: "", stderr: "", ...answer(args) }
  }
  return { run, calls }
}

/** True when `sh` reads the script without a syntax error; it runs nothing. */
const parses = (script: string) =>
  Bun.spawnSync(["sh", "-n", "-c", script]).exitCode === 0

describe("names in the registry", () => {
  test("are a repository and a tag, under 127.0.0.1:5000", () => {
    expect(REGISTRY).toBe("127.0.0.1:5000")
    expect(checkName("check/frontend:1")).toEqual({
      repository: "check/frontend",
      tag: "1",
    })
    expect(inRegistry("check/base:k-1.2")).toBe(
      "127.0.0.1:5000/check/base:k-1.2"
    )
    for (const name of [
      "check/frontend",
      "Check/frontend:1",
      "check//frontend:1",
      "check/frontend:",
      "check/frontend:-1",
      "127.0.0.1:5000/check/frontend:1",
      "check/frontend@sha256:1",
    ])
      expect(() => checkName(name)).toThrow("not a repository and a tag")
  })
})

describe("the registry's configuration", () => {
  test("keeps its data in its own folder, listens on 127.0.0.1:5000 only, logs every request", () => {
    const open = registryConfig(false)
    expect(open.split("\n")).toEqual([
      "version: 0.1",
      "log:",
      "  level: info",
      "  formatter: text",
      "  accesslog:",
      "    disabled: false",
      "storage:",
      "  filesystem:",
      "    rootdirectory: /var/lib/zekno-check-registry",
      "  delete:",
      "    enabled: true",
      "http:",
      "  addr: 127.0.0.1:5000",
    ])
    expect(registryConfig(true)).toBe(
      `${open}\nauth:\n  htpasswd:\n    realm: zekno-check\n    path: /etc/zekno-check-registry/htpasswd`
    )
  })

  test("is started from empty by a script that stops a leftover first and waits for an answer", () => {
    const script = startScript()
    const lines = script.split("\n")
    expect(lines[0]).toBe("set -eu")
    expect(lines.slice(1, 1 + STOP_LINES.length)).toEqual([...STOP_LINES])
    expect(script).toContain(
      `printf '%s\\n' ${q(registryConfig(false))} > ${REGISTRY_FILES.config}`
    )
    expect(script).not.toContain(REGISTRY_FILES.htpasswd)
    expect(script).toContain(
      `setsid docker-registry serve ${REGISTRY_FILES.config} >> ${REGISTRY_FILES.log} 2>&1 < /dev/null &`
    )
    expect(script).toContain(`echo "$pid" > ${REGISTRY_FILES.pid}`)
    expect(script).toContain("http://127.0.0.1:5000/v2/")
    expect(script).toContain('[ "$code" = 200 ] || [ "$code" = 401 ]')
    expect(lines.at(-1)).toContain('"/proc/$pid/comm"')
    expect(parses(script)).toBe(true)

    const locked = startScript(`${HTPASSWD}\n`)
    expect(locked).toContain(
      `printf '%s\\n' ${q(registryConfig(true))} > ${REGISTRY_FILES.config}`
    )
    expect(locked).toContain(
      `printf '%s\\n' ${q(HTPASSWD)} > ${REGISTRY_FILES.htpasswd}`
    )
    expect(locked).toContain(`chmod 0600 ${REGISTRY_FILES.htpasswd}`)
    expect(parses(locked)).toBe(true)
    for (const bad of ["", "check:secret", `check:${HTPASSWD}`, "a b:$2b$10$x"])
      expect(() => startScript(bad)).toThrow("lines of user:<bcrypt hash>")
  })

  test("is stopped by its pid file, only when that process is docker-registry, and its files removed by name", () => {
    const stop = ["set -eu", ...STOP_LINES].join("\n")
    expect(stop).toContain(`pid=$(cat ${REGISTRY_FILES.pid})`)
    expect(stop).toContain(
      '[ "$(cat "/proc/$pid/comm" 2> /dev/null || :)" = docker-registry ]'
    )
    expect(STOP_LINES.at(-1)).toBe(
      "rm -rf /etc/zekno-check-registry /var/lib/zekno-check-registry /var/log/zekno-check-registry.log /run/zekno-check-registry.pid"
    )
    expect(parses(stop)).toBe(true)
  })
})

describe("the registry's log", () => {
  const log = [
    'time="2026-11-27T10:00:00Z" level=info msg="listening on 127.0.0.1:5000"',
    '127.0.0.1 - - [27/Nov/2026:10:00:01 +0000] "GET /v2/ HTTP/1.1" 200 2 "" "docker/29.5.0"',
    '127.0.0.1 - - [27/Nov/2026:10:00:02 +0000] "HEAD /v2/check/frontend/manifests/1 HTTP/1.1" 200 527 "" "buildkit/v0.35"',
    'time="2026-11-27T10:00:02Z" level=info msg="response completed" http.request.method=HEAD http.request.uri=/v2/check/frontend/manifests/1',
    'time="2026-11-27T10:00:03Z" level=info msg="response completed" http.request.method=GET http.request.uri="/v2/check/frontend/blobs/sha256:1"',
    '127.0.0.1 - - [27/Nov/2026:10:00:04 +0000] "GET /v2/check/frontend2/manifests/1 HTTP/1.1" 404 19 "" "buildkit"',
    '127.0.0.1 - - [27/Nov/2026:10:00:05 +0000] "PUT /v2/check/base/manifests/1 HTTP/1.1" 201 0 "" "docker"',
    '127.0.0.1 - - [27/Nov/2026:10:00:06 +0000] "HEAD /v2/check/frontend/manifests/1 HTTP/1.1" 200 527 "" "buildkit/v0.35"',
  ].join("\n")

  test("gives each request for a repository once, in order, from either kind of line", () => {
    expect(requestsFor(log, "check/frontend")).toEqual([
      "HEAD /v2/check/frontend/manifests/1",
      "GET /v2/check/frontend/blobs/sha256:1",
    ])
    expect(requestsFor(log, "check/base")).toEqual([
      "PUT /v2/check/base/manifests/1",
    ])
    expect(requestsFor(log, "check/other")).toEqual([])
    expect(requestsFor("", "check/frontend")).toEqual([])
    expect(() => requestsFor(log, "check/frontend:1")).toThrow(
      "not a repository"
    )
  })

  test("is said in a record line as no request, or the first requests", () => {
    expect(requestWords([], "check/frontend")).toBe(
      "no request for check/frontend"
    )
    expect(
      requestWords(["HEAD /v2/check/frontend/manifests/1"], "check/frontend")
    ).toBe("check/frontend requested (HEAD /v2/check/frontend/manifests/1)")
    expect(requestWords(["a", "b", "c", "d", "e"], "check/frontend")).toBe(
      "check/frontend requested (a, b, c and 2 more)"
    )
  })

  test("is marked by its size, read by stat", () => {
    expect(byteCount("1234\n")).toBe(1234)
    expect(byteCount("0")).toBe(0)
    for (const bad of ["", "12 34", "-1", "stat: cannot stat"])
      expect(() => byteCount(bad)).toThrow("not a size")
  })
})

describe("docker push", () => {
  test("names the digest it pushed on its last line", () => {
    expect(
      pushedDigest(
        `The push refers to repository [127.0.0.1:5000/check/frontend]\nabc: Pushed\n1: digest: ${DIGEST} size: 527\n`
      )
    ).toBe(DIGEST)
    expect(pushedDigest("abc: Pushed\n")).toBeUndefined()
  })
})

describe("the registry in the stand-in", () => {
  test("starts with one script, pushes and untags, reads its log after a mark, and stops", async () => {
    const { run, calls } = fakeRun((args) =>
      args[1] === "push"
        ? { stdout: `1: digest: ${DIGEST} size: 527\n` }
        : args[0] === "stat"
          ? { stdout: "120\n" }
          : args[0] === "tail"
            ? {
                stdout:
                  '127.0.0.1 - - [x] "GET /v2/check/frontend/manifests/1 HTTP/1.1" 200 1 "" "b"\n',
              }
            : undefined
    )
    const registry = await startRegistry(run, { htpasswd: HTPASSWD })
    expect(calls[0]!.args).toEqual(["sh", "-c", startScript(HTPASSWD)])
    expect(calls[0]!.options?.timeoutMs).toBe(120_000)
    expect(await registry.push("zekno-check-x:1", "check/frontend:1")).toEqual({
      reference: "127.0.0.1:5000/check/frontend:1",
      digest: DIGEST,
    })
    expect(await registry.mark()).toBe(120)
    expect(await registry.requestsSince(120, "check/frontend")).toEqual([
      "GET /v2/check/frontend/manifests/1",
    ])
    await registry.stop()
    expect(calls.slice(1).map((call) => call.args)).toEqual([
      ["docker", "tag", "zekno-check-x:1", "127.0.0.1:5000/check/frontend:1"],
      ["docker", "push", "127.0.0.1:5000/check/frontend:1"],
      ["docker", "image", "rm", "127.0.0.1:5000/check/frontend:1"],
      ["stat", "-c", "%s", REGISTRY_FILES.log],
      ["tail", "-c", "+121", REGISTRY_FILES.log],
      ["sh", "-c", ["set -eu", ...STOP_LINES].join("\n")],
    ])
    await expect(registry.requestsSince(-1, "check/frontend")).rejects.toThrow(
      "a mark is a size"
    )
  })

  test("says why it did not start, and untags even when the push failed", async () => {
    const down = fakeRun(() => ({
      code: 1,
      stderr:
        "docker-registry did not answer within 30 seconds; the end of its log:\nbind: address in use",
    }))
    await expect(startRegistry(down.run)).rejects.toThrow(
      "starting the check's registry failed (exit 1): docker-registry did not answer within 30 seconds"
    )
    const refused = fakeRun((args) =>
      args[1] === "push"
        ? { code: 1, stderr: "unauthorized: authentication required" }
        : undefined
    )
    const registry = await startRegistry(refused.run)
    await expect(
      registry.push("zekno-check-x:1", "check/base:1")
    ).rejects.toThrow(
      "docker push 127.0.0.1:5000/check/base:1 failed (exit 1): unauthorized"
    )
    expect(refused.calls.at(-1)!.args).toEqual([
      "docker",
      "image",
      "rm",
      "127.0.0.1:5000/check/base:1",
    ])
    await expect(
      registry.push("zekno-check-x:1", "check/base")
    ).rejects.toThrow("not a repository and a tag")
    const stuck = fakeRun(() => ({
      code: 1,
      stderr: "docker-registry (42) did not stop",
    }))
    await expect(stopRegistry(stuck.run)).rejects.toThrow(
      "stopping the check's registry failed (exit 1): docker-registry (42) did not stop"
    )
  })
})

describe("a small image made from the fixtures' base", () => {
  test("pulls the base when it is not there, commits a container never started, and removes both afterwards", async () => {
    const { run, calls } = fakeRun((args) =>
      args[2] === "inspect" ? { code: 1, stderr: "No such image" } : undefined
    )
    const image = await smallImage(run, "zekno-check-x-source:1")
    expect(image.name).toBe("zekno-check-x-source:1")
    await image.remove()
    expect(calls.map((call) => call.args)).toEqual([
      ["docker", "image", "inspect", "--format", "{{.Id}}", BASE],
      ["docker", "pull", "--quiet", BASE],
      ["docker", "rm", "--force", SOURCE_CONTAINER],
      ["docker", "create", "--name", SOURCE_CONTAINER, BASE],
      [
        ...["docker", "commit", "--change", "LABEL zekno.check=small-image"],
        ...[SOURCE_CONTAINER, "zekno-check-x-source:1"],
      ],
      ["docker", "rm", "--force", SOURCE_CONTAINER],
      ["docker", "image", "rm", "zekno-check-x-source:1"],
      ["docker", "image", "rm", BASE],
    ])
    expect(calls[1]!.options?.timeoutMs).toBe(600_000)
  })

  test("leaves a base that was already there, and an image already gone is no fault", async () => {
    const { run, calls } = fakeRun((args) =>
      args[2] === "rm"
        ? { code: 1, stderr: "Error response from daemon: No such image: x" }
        : undefined
    )
    const image = await smallImage(run, "zekno-check-x-source:1")
    await image.remove()
    const done = calls.map((call) => call.args)
    expect(done.filter((args) => args[1] === "pull")).toEqual([])
    expect(done.filter((args) => args[2] === "rm")).toEqual([
      ["docker", "image", "rm", "zekno-check-x-source:1"],
    ])
  })

  test("removes the base it pulled when the image cannot be made, and says why", async () => {
    const { run, calls } = fakeRun((args) =>
      args[2] === "inspect"
        ? { code: 1 }
        : args[1] === "commit"
          ? { code: 1, stderr: "Error response from daemon: no space left" }
          : undefined
    )
    await expect(smallImage(run, "zekno-check-x-source:1")).rejects.toThrow(
      "docker commit as zekno-check-x-source:1 failed (exit 1): Error response from daemon: no space left"
    )
    expect(calls.slice(-2).map((call) => call.args)).toEqual([
      ["docker", "rm", "--force", SOURCE_CONTAINER],
      ["docker", "image", "rm", BASE],
    ])
    const held = fakeRun((args) =>
      args[2] === "rm"
        ? { code: 1, stderr: "conflict: image is in use" }
        : undefined
    )
    const image = await smallImage(held.run, "zekno-check-x-source:1")
    await expect(image.remove()).rejects.toThrow(
      "the removal of zekno-check-x-source:1 failed: conflict: image is in use"
    )
    await expect(smallImage(held.run, "Bad Name")).rejects.toThrow(
      "not a repository and a tag"
    )
  })
})
