/**
 * SSH's keep-alive (src/server/transport.ts, `KEEP_ALIVE`): every connection
 * zekno opens over SSH carries `-o ServerAliveInterval=30` before `--`, so a
 * deploy that is silent for minutes is not ended by a network that closes
 * silent connections (specs/015-domains-https, security review, part 10,
 * "Found by the real-server proof").
 */
import { describe, expect, test } from "bun:test"

import { connect, type Target } from "../../src/server/transport"
import { sshStandIn, standInServer, withSsh } from "../support/stand-in-server"

const TARGET: Target = {
  kind: "ssh",
  destination: "deploy@example.test",
  runnerPath: "zekno-runner",
}

/** Whatever the stand-in server answers: only how ssh was called is looked at here. */
const quietly = async (work: () => unknown) => {
  try {
    await work()
  } catch {
    // The stand-in server has no runner at that path.
  }
}

describe("SSH's keep-alive", () => {
  for (const batch of [false, true]) {
    test(`one command, a session and the installer's script each carry it${batch ? ", in batch mode too" : ""}`, async () => {
      const ssh = sshStandIn(standInServer())
      await withSsh(ssh, async () => {
        const transport = connect(TARGET, [], { errorLines: () => {}, batch })
        await quietly(() => transport.run("status"))
        const session = transport.open()
        session.end()
        await quietly(() => session.exited)
        const script = transport.script!(["check", "zekno-runner"])
        script.end()
        await quietly(() => script.exited)
      })
      const options = batch
        ? "-o ServerAliveInterval=30 -o BatchMode=yes"
        : "-o ServerAliveInterval=30"
      expect(ssh.calls()).toEqual([
        `${options} -- deploy@example.test zekno-runner status`,
        `${options} -- deploy@example.test zekno-runner session`,
        `${options} -- deploy@example.test sh -s -- check zekno-runner`,
      ])
    })
  }

  test("a runner on this machine is started as before: ssh is not involved", async () => {
    const ssh = sshStandIn(standInServer())
    await withSsh(ssh, async () => {
      const transport = connect({ kind: "local", home: "/nowhere" }, ["true"])
      await quietly(() => transport.run("status"))
    })
    expect(ssh.calls()).toEqual([])
  })
})
