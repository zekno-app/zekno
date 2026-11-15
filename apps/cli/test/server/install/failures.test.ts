/** What a person is told when the install stops (src/server/install/failures.ts). */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"

import type { InstallRequest } from "../../../src/server/install/checks"
import { installFailure } from "../../../src/server/install/failures"
import { runInstaller } from "../../../src/server/install/install"
import { parseInstallLine } from "../../../src/server/install/lines"
import { RUNNER_RELEASE } from "../../../src/version/runner-release"
import { connect } from "../../../src/server/transport"
import { sshStandIn, standInServer, withSsh } from "../../support/stand-in-server"

const VERSION = RUNNER_RELEASE.version

const release = (files: InstallRequest["source"]): InstallRequest => ({ mode: "add", version: VERSION, source: files })

describe("what a person is told when the install stops", () => {
  const add: InstallRequest = { mode: "add", version: VERSION, source: { kind: "release", files: [] } }
  const update: InstallRequest = { mode: "update", version: VERSION, runnerPath: "~/.local/bin/zekno-runner", source: { kind: "release", files: [] } }
  const where = { destination: "deploy@example.test", server: "prod" }

  test("no checksum tool, and no room: the sentences of contracts/versions.md, and what is left in an update", () => {
    expect(installFailure("tools", add, where)).toBe(
      "The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed."
    )
    expect(installFailure("tools", update, where)).toBe(
      "The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed. The runner that was there is still in place."
    )
    expect(installFailure("space", add, where)).toBe(
      "The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. Nothing was installed."
    )
    expect(installFailure("space", update, where)).toBe(
      "The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. The runner that was there is still in place."
    )
    expect(parseInstallLine("fail space")).toEqual({ kind: "fail", reason: "space" })
    expect(parseInstallLine("fail tools")).toEqual({ kind: "fail", reason: "tools" })
  })

  test("what the server lacks to run the runner: the C library or the processor, in the sentences of contracts/versions.md", () => {
    expect(installFailure("libc", add, where)).toBe(
      "This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. Nothing was installed."
    )
    expect(installFailure("libc", update, where)).toBe(
      "This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. The runner that was there is still in place."
    )
    expect(installFailure("cpu", add, where)).toBe(
      "This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. Nothing was installed."
    )
    expect(installFailure("cpu", update, where)).toBe(
      "This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. The runner that was there is still in place."
    )
    expect(parseInstallLine("fail libc")).toEqual({ kind: "fail", reason: "libc" })
    expect(parseInstallLine("fail cpu")).toEqual({ kind: "fail", reason: "cpu" })
  })

  test("the line a runner that did not start wrote reaches the person cleaned, as any line from the server, then the sentence", async () => {
    const server = standInServer()
    const runner = "#!/bin/sh\nprintf 'zekno-runner: \\033[31mversion GLIBC_2.99 not found\\n' >&2\nexit 1\n"
    const sha = server.release(runner)
    const lines: string[] = []
    await withSsh(sshStandIn(server), async () => {
      const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: (line) => void lines.push(line) })
      await expect(runInstaller(transport, release({ kind: "release", files: [{ arch: "x64", sha256: sha }] }), where)).rejects.toThrow(
        installFailure("libc", add, where)
      )
    })
    expect(lines).toContain("zekno-runner: version GLIBC_2.99 not found")
    expect(existsSync(server.runnerPath)).toBe(false)
  })
})
