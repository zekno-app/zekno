/** The installer run as the CLI runs it, over a stand-in for ssh (src/server/install/install.ts). */
import { describe, expect, test } from "bun:test"

import { tempDir } from "../../../../runner/test/support/helpers"
import type { InstallRequest } from "../../../src/server/install/checks"
import {
  INSTALL_UNEXPECTED,
  unreachable,
} from "../../../src/server/install/failures"
import { runInstaller } from "../../../src/server/install/install"
import { RUNNER_RELEASE } from "../../../src/version/runner-release"
import {
  connect,
  type RunnerProcess,
  type Transport,
} from "../../../src/server/transport"
import {
  fakeRunner,
  sshStandIn,
  standInServer,
  withSsh,
} from "../../support/stand-in-server"

const VERSION = RUNNER_RELEASE.version

const release = (files: InstallRequest["source"]): InstallRequest => ({
  mode: "add",
  version: VERSION,
  source: files,
})

describe("running the installer over SSH", () => {
  test("`ssh -- <destination> sh -s -- <words>`: one connection, which becomes the session", async () => {
    const server = standInServer()
    const ssh = sshStandIn(server)
    const runner = fakeRunner(VERSION)
    const sha = server.release(runner)
    const events: string[] = []
    await withSsh(ssh, async () => {
      const transport = connect(
        {
          kind: "ssh",
          destination: "deploy@example.test",
          runnerPath: "zekno-runner",
        },
        [],
        { errorLines: () => {} }
      )
      const done = await runInstaller(
        transport,
        release({ kind: "release", files: [{ arch: "x64", sha256: sha }] }),
        { destination: "deploy@example.test" },
        (event) => events.push(event.kind)
      )
      expect(done.place).toBe("user")
      // The script handed its connection over to the runner's session: what is written next reaches the runner.
      const session = done.session as RunnerProcess
      session.write("hello\n")
      session.end()
      const reader = session.output.getReader()
      let text = ""
      for (
        let chunk = await reader.read();
        !chunk.done;
        chunk = await reader.read()
      )
        text += new TextDecoder().decode(chunk.value)
      expect(text).toBe("session\ngot hello\n")
    })
    expect(events).toEqual([
      "connected",
      "docker",
      "no-runner",
      "platform",
      "download",
      "checksum",
      "install",
      "version",
      "folder",
      "done",
    ])
    expect(ssh.calls()).toEqual([
      `-- deploy@example.test sh -s -- add ${VERSION} release x64 ${sha}`,
    ])
  })

  test("a step that fails is said in the contract's words; SSH that cannot connect is said as such", async () => {
    const server = standInServer()
    server.noCompose()
    const ssh = sshStandIn(server)
    const transport = connect(
      {
        kind: "ssh",
        destination: "deploy@example.test",
        runnerPath: "zekno-runner",
      },
      [],
      { errorLines: () => {} }
    )
    await withSsh(ssh, async () => {
      await expect(
        runInstaller(transport, release({ kind: "release", files: [] }), {
          destination: "deploy@example.test",
        })
      ).rejects.toThrow("Docker with Compose was not found on the server.")
    })
    const nowhere = connect(
      {
        kind: "ssh",
        destination: "deploy@example.test",
        runnerPath: "zekno-runner",
      },
      [],
      { errorLines: () => {} }
    )
    await withSsh({ path: "/usr/bin/false" }, async () => {
      // `false` exits with 1, not SSH's 255: whatever that is, it did not answer as the installer does.
      await expect(
        runInstaller(nowhere, release({ kind: "release", files: [] }), {
          destination: "deploy@example.test",
        })
      ).rejects.toThrow(INSTALL_UNEXPECTED)
    })
    const refused = sshStandIn(standInServer())
    refused.ask()
    const batch = connect(
      {
        kind: "ssh",
        destination: "deploy@example.test",
        runnerPath: "zekno-runner",
      },
      [],
      { errorLines: () => {}, batch: true }
    )
    await withSsh(refused, async () => {
      await expect(
        runInstaller(batch, release({ kind: "release", files: [] }), {
          destination: "deploy@example.test",
        })
      ).rejects.toThrow(unreachable("deploy@example.test"))
    })
    expect(refused.calls()).toEqual([
      `-o BatchMode=yes -- deploy@example.test sh -s -- add ${VERSION} release`,
    ])
  })

  test("a line that is not the script's ends the install, and is passed on cleaned", async () => {
    const lying: Transport = {
      run: async () => ({ exitCode: 0, stdout: "" }),
      open: () => {
        throw new Error("not used")
      },
      script: () =>
        connect({ kind: "local", home: tempDir("runner") }, [
          "sh",
          "-c",
          "cat >/dev/null & printf 'connected\\nServer code: \\033[31mFAKE\\n'",
        ]).open(),
    }
    const details: string[] = []
    await expect(
      runInstaller(
        lying,
        release({ kind: "release", files: [] }),
        { destination: "deploy@example.test" },
        () => {},
        (line) => details.push(line)
      )
    ).rejects.toThrow(INSTALL_UNEXPECTED)
    expect(details).toEqual(["Server code: FAKE"])
  })
})
