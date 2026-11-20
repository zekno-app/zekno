/**
 * What the runner reads of Docker's objects (specs/015-domains-https,
 * contracts/runner.md, RN10): a volume Docker says it has not is told apart
 * from a Docker that did not answer, so a released domain's certificate is
 * counted as gone only when there is truly nothing to delete.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { volumeExists } from "../../src/docker/objects"
import { tempDir } from "../support/helpers"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

/** A stand-in Docker that runs `body` as a shell script, used for the calls that follow; gives the runner's folder. */
function docker(body: string): string {
  const dir = tempDir("objects-docker")
  const path = join(dir, "docker")
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  process.env.ZEKNO_DOCKER = path
  return tempDir("objects-home")
}

describe("volumeExists", () => {
  test("true when Docker shows the volume", async () => {
    const home = docker(
      `echo '[{"Name":"zekno-proxy-data","Driver":"local"}]'; exit 0`
    )
    expect(await volumeExists(home, "zekno-proxy-data")).toBe(true)
  })

  test("false only when Docker says there is no such volume, as Docker 29 says it", async () => {
    const home = docker(
      `echo '[]'; echo "Error response from daemon: get $3: no such volume" >&2; exit 1`
    )
    expect(await volumeExists(home, "zekno-proxy-data")).toBe(false)
  })

  test("undefined when Docker did not answer: another error, or no Docker at all", async () => {
    let home = docker(
      `echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1`
    )
    expect(await volumeExists(home, "zekno-proxy-data")).toBeUndefined()
    home = tempDir("objects-home")
    process.env.ZEKNO_DOCKER = join(home, "no-docker-here")
    expect(await volumeExists(home, "zekno-proxy-data")).toBeUndefined()
  })
})
