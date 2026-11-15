/** What is placed into the installer's script, and how each value is checked (src/server/install/checks.ts). */
import { describe, expect, test } from "bun:test"
import { truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { REFUSED_VERSIONS } from "../../../../../packages/core/test/fixtures/versions"
import { tempDir } from "../../../../runner/test/support/helpers"
import { installWords, readRunnerFile, releaseFiles, RUNNER_FILE_LIMIT, type InstallRequest } from "../../../src/server/install/checks"
import { NO_RELEASE } from "../../../src/server/install/failures"
import { runInstaller } from "../../../src/server/install/install"
import { RUNNER_RELEASE } from "../../../src/version/runner-release"
import { connect, type Transport } from "../../../src/server/transport"
import { sha256, sshStandIn, standInServer, withSsh } from "../../support/stand-in-server"

const VERSION = RUNNER_RELEASE.version

const release = (files: InstallRequest["source"]): InstallRequest => ({ mode: "add", version: VERSION, source: files })
const SHA = "a".repeat(64)

/** Inputs that must never reach a script: shell syntax of every kind, a line break, a leading dash. */
const HOSTILE = ["$(touch /tmp/pwned)", "`touch /tmp/pwned`", "'; rm -rf ~; '", '"quoted"', "a b", "x\ny", "-rf", "x;y", "x|y", "x&y", "x>y", "*", "", "\u001b[2J"]

describe("what is placed into the script", () => {
  test("the words for each kind of install", () => {
    expect(installWords(release({ kind: "release", files: [{ arch: "x64", sha256: SHA }] }))).toEqual(["add", VERSION, "release", "x64", SHA])
    expect(installWords(release({ kind: "release", files: [] }))).toEqual(["add", VERSION, "release"])
    expect(installWords(release({ kind: "file", file: { bytes: new Uint8Array(1), sha256: SHA } }))).toEqual(["add", VERSION, "file", SHA])
    expect(
      installWords({ mode: "update", version: VERSION, runnerPath: "~/.local/bin/zekno-runner", source: { kind: "release", files: [{ arch: "arm64", sha256: SHA }] } })
    ).toEqual(["update", VERSION, "~/.local/bin/zekno-runner", "release", "arm64", SHA])
  })

  test("an update names only a file called zekno-runner: any other path throws before anything is placed", () => {
    const update = (runnerPath: string): InstallRequest => ({ mode: "update", version: VERSION, runnerPath, source: { kind: "release", files: [] } })
    for (const path of ["zekno-runner", "/usr/local/bin/zekno-runner", "~/.local/bin/zekno-runner", "/opt/zekno/zekno-runner"]) {
      expect(installWords(update(path))[2]).toBe(path)
    }
    for (const path of ["/usr/sbin/sshd", "/bin/sh", "docker", "/usr/bin/sudo", "~/zekno-runner.sh", "/opt/my-zekno-runner", "/opt/zekno-runner/run"]) {
      expect(() => installWords(update(path))).toThrow("not valid")
    }
  })

  test("a dev version is placed as a word, as a prod version is", () => {
    for (const version of ["0.1.0-dev.1", "0.1.0", "1.0.0-dev.999999999"]) {
      expect(installWords({ mode: "add", version, source: { kind: "release", files: [{ arch: "x64", sha256: SHA }] } })).toEqual(["add", version, "release", "x64", SHA])
    }
  })

  test("each of the four values that does not fit its pattern throws before anything is placed", () => {
    const versions = [...HOSTILE, ...REFUSED_VERSIONS, "1.2", "1.2.3.4", "v1.2.3", "1.2.3-rc1", "01.2.3x"]
    for (const version of versions) {
      expect(() => installWords({ mode: "add", version, source: { kind: "release", files: [] } })).toThrow("The version for the installer is not valid")
    }
    for (const arch of [...HOSTILE, "x86", "X64", "amd64", "x64 "]) {
      expect(() => installWords(release({ kind: "release", files: [{ arch: arch as "x64", sha256: SHA }] }))).toThrow("The architecture for the installer is not valid")
    }
    for (const sha of [...HOSTILE, SHA.toUpperCase(), SHA.slice(1), `${SHA}0`, `${SHA.slice(1)}g`]) {
      expect(() => installWords(release({ kind: "release", files: [{ arch: "x64", sha256: sha }] }))).toThrow("The SHA-256 for the installer is not valid")
      expect(() => installWords(release({ kind: "file", file: { bytes: new Uint8Array(1), sha256: sha } }))).toThrow("The SHA-256 for the installer is not valid")
    }
    for (const runnerPath of [...HOSTILE, "-x", "--help", "~user/$(x)"]) {
      expect(() => installWords({ mode: "update", version: VERSION, runnerPath, source: { kind: "release", files: [] } })).toThrow(
        "The runner path for the installer is not valid"
      )
    }
  })

  test("a value that does not fit never reaches a script: nothing is started", async () => {
    const started: unknown[] = []
    const recording: Transport = {
      run: async () => ({ exitCode: 0, stdout: "" }),
      open: () => {
        throw new Error("not used")
      },
      script(words) {
        started.push(words)
        throw new Error("a script was started")
      },
    }
    const requests: InstallRequest[] = [
      { mode: "add", version: "$(reboot)", source: { kind: "release", files: [] } },
      release({ kind: "release", files: [{ arch: "`id`" as "x64", sha256: SHA }] }),
      release({ kind: "release", files: [{ arch: "x64", sha256: "x\n; reboot" }] }),
      { mode: "update", version: VERSION, runnerPath: "-oProxyCommand=reboot", source: { kind: "release", files: [] } },
    ]
    for (const request of requests) {
      await expect(runInstaller(recording, request, { destination: "deploy@example.test" })).rejects.toThrow("is not valid, so nothing was sent to the server")
    }
    expect(started).toEqual([])
  })

  test("the transport checks the words again, and puts SSH's options before `--`", () => {
    const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [])
    for (const word of HOSTILE) expect(() => transport.script!(["add", word])).toThrow("The installer's arguments are not valid")
    expect(() => transport.script!([])).toThrow()
    expect(connect({ kind: "local", home: tempDir("runner") }, []).script).toBeUndefined()
  })

  test("the transport's own check lets a dev version through as it is", async () => {
    const ssh = sshStandIn(standInServer())
    await withSsh(ssh, async () => {
      const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: () => {} })
      const child = transport.script!(["add", "0.1.0-dev.1", "release"])
      child.end()
      await child.exited
    })
    expect(ssh.calls()).toEqual(["-- deploy@example.test sh -s -- add 0.1.0-dev.1 release"])
  })

  test("the release files are those with a published checksum, and none without one", () => {
    expect(releaseFiles()).toEqual(
      (["x64", "arm64"] as const).flatMap((arch) => {
        const sha = RUNNER_RELEASE.files[`linux-${arch}`].sha256
        return sha ? [{ arch, sha256: sha }] : []
      })
    )
    expect(releaseFiles({ files: { "linux-x64": { sha256: SHA }, "linux-arm64": { sha256: null } } })).toEqual([{ arch: "x64", sha256: SHA }])
    expect(NO_RELEASE).toContain("--runner-file")
    expect(NO_RELEASE).toContain("README")
  })

  test("a runner file must be a regular file of at most 256 MiB, and is hashed as read", async () => {
    const dir = tempDir("file")
    await Bun.write(join(dir, "runner"), "binary")
    expect(await readRunnerFile(join(dir, "runner"))).toEqual({ bytes: new TextEncoder().encode("binary"), sha256: sha256("binary") })
    await expect(readRunnerFile(dir)).rejects.toThrow("must be a regular file")
    await expect(readRunnerFile(join(dir, "missing"))).rejects.toThrow("There is no runner file at that path.")
    await Bun.write(join(dir, "empty"), "")
    await expect(readRunnerFile(join(dir, "empty"))).rejects.toThrow("is empty")
    const big = join(dir, "big")
    writeFileSync(big, "x")
    // A sparse file one byte over the limit: its size is checked before anything is read.
    truncateSync(big, RUNNER_FILE_LIMIT + 1)
    await expect(readRunnerFile(big)).rejects.toThrow("larger than 256 MiB")
  })
})
