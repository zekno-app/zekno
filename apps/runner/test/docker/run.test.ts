/**
 * The one helper for Docker calls (specs/015-domains-https, contracts/
 * runner.md, RN1): `ZEKNO_DOCKER || "docker"`, the environment the existing
 * calls use, the runner's folder, a time limit, both outputs capped, and no
 * shell.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { NOT_STARTED, runDocker, TIMED_OUT } from "../../src/docker/run"
import { tempDir } from "../support/helpers"

const saved = {
  docker: process.env.ZEKNO_DOCKER,
  secret: process.env.ZEKNO_RUN_TEST_SECRET,
}
afterEach(() => {
  for (const [name, value] of [
    ["ZEKNO_DOCKER", saved.docker],
    ["ZEKNO_RUN_TEST_SECRET", saved.secret],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

/** A stand-in Docker that runs `body` as a shell script, and uses it for the calls that follow. */
function docker(body: string): string {
  const dir = tempDir("run-docker")
  const path = join(dir, "docker")
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  process.env.ZEKNO_DOCKER = path
  return dir
}

describe("runDocker", () => {
  test("gives the exit status and both outputs, in the runner's folder", async () => {
    docker(`echo "out $*"; echo "err $(pwd -P)" >&2; exit 3`)
    const home = tempDir("run-home")
    expect(await runDocker(home, ["network", "inspect", "x"])).toEqual({
      code: 3,
      stdout: "out network inspect x\n",
      stderr: `err ${realpathSync(home)}\n`,
    })
  })

  test("passes each argument as one, with no shell to read it", async () => {
    const dir = docker(`for a in "$@"; do printf '[%s]' "$a"; done`)
    const marker = join(dir, "ran")
    const tricky = `a b; touch ${marker} $(touch ${marker}) "q"`
    const result = await runDocker(tempDir("run-home"), ["exec", tricky, ""])
    expect(result.stdout).toBe(`[exec][${tricky}][]`)
    expect(existsSync(marker)).toBe(false)
  })

  test("Docker gets the environment the existing calls give it, and nothing else of the runner's", async () => {
    docker(`env`)
    process.env.ZEKNO_RUN_TEST_SECRET = "must not reach docker"
    const { stdout } = await runDocker(tempDir("run-home"), ["info"])
    expect(stdout).not.toContain("ZEKNO_RUN_TEST_SECRET")
    const names = stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => line.slice(0, line.indexOf("=")))
    for (const name of names)
      expect([
        "PATH",
        "HOME",
        "DOCKER_HOST",
        "DOCKER_CONFIG",
        "DOCKER_CONTEXT",
        "XDG_RUNTIME_DIR",
        // Set by the shell that runs the stand-in, not passed by the runner.
        "PWD",
        "SHLVL",
        "OLDPWD",
        "_",
      ]).toContain(name)
  })

  test("each output is capped, and Docker is still read to its end", async () => {
    docker(
      `i=0; while [ $i -lt 2000 ]; do echo 0123456789012345678901234567890123456789; echo e >&2; i=$((i+1)); done; exit 0`
    )
    const result = await runDocker(tempDir("run-home"), ["logs"], {
      outputBytes: 100,
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toHaveLength(100)
    expect(result.stderr).toHaveLength(100)
  })

  test("a call past its time is stopped, and says so", async () => {
    docker(`exec sleep 30`)
    const started = Date.now()
    const result = await runDocker(tempDir("run-home"), ["run"], {
      timeoutMs: 300,
    })
    expect(result.code).toBe(TIMED_OUT)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test("a Docker that cannot be started is NOT_STARTED, never a throw", async () => {
    process.env.ZEKNO_DOCKER = join(tempDir("run-none"), "no-docker-here")
    expect(await runDocker(tempDir("run-home"), ["info"])).toEqual({
      code: NOT_STARTED,
      stdout: "",
      stderr: "",
    })
  })
})
