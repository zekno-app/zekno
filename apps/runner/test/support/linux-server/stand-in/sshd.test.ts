/**
 * sshd in the server stand-in (`sshd.ts`; research/map-checks.md part 6,
 * step 3): the published port, the keys and the configuration. Nothing
 * here runs Docker or `ssh-keygen`.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  checkPort,
  choosePort,
  clientKeyCommand,
  hostKeyCommand,
  knownHostsLine,
  sshdCommand,
} from "./sshd"

const SERVER = "zekno-check-a1b2c3d4-server"
const CLIENT_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0b1pk zekno-check-a1b2c3d4-client"
const script = (list: readonly string[]) => list[list.length - 1]!

describe("the port", () => {
  test("ports 3000 and 3100 are never chosen, and every choice is above 1024", () => {
    const steps = [0, 1e-9, 0.25, 0.5, 0.75, 0.999999999]
    for (let n = 0; n < 2000; n++) steps.push(Math.random())
    for (const step of steps) {
      const port = choosePort(() => step)
      expect(port).toBeGreaterThan(1024)
      expect(port).toBeLessThan(65536)
      expect([3000, 3100]).not.toContain(port)
    }
    expect(choosePort()).toBeGreaterThan(1024)
  })

  test("a port given is checked", () => {
    expect(checkPort(24680)).toBe(24680)
    for (const port of [3000, 3100])
      expect(() => checkPort(port)).toThrow(`port ${port} is never used`)
    for (const port of [1024, 22, 65536, 2.5])
      expect(() => checkPort(port)).toThrow("above 1024")
  })
})

describe("the keys", () => {
  test("the client's key is made on this machine, in the run's temporary folder", () => {
    expect(
      clientKeyCommand("/tmp/zekno-keys-x", "zekno-check-a1b2c3d4-client")
    ).toEqual([
      "ssh-keygen",
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      "zekno-check-a1b2c3d4-client",
      "-f",
      join("/tmp/zekno-keys-x", "client_ed25519"),
    ])
  })

  test("the host key is made in the stand-in, and only its public half is read out", () => {
    const text = script(sshdCommand(SERVER, CLIENT_KEY))
    expect(text).toContain(
      `ssh-keygen -q -t ed25519 -N '' -C '${SERVER}' -f /etc/ssh/ssh_host_ed25519_key`
    )
    expect(text).toContain(
      `printf '%s\\n' '${CLIENT_KEY}' > /root/.ssh/authorized_keys`
    )
    expect(hostKeyCommand(SERVER)).toEqual([
      "docker",
      "exec",
      SERVER,
      "cat",
      "/etc/ssh/ssh_host_ed25519_key.pub",
    ])
  })

  test("a client key of another form is refused", () => {
    for (const key of [
      "ssh-rsa AAAAB3Nza",
      "ssh-ed25519 AAAA'; rm -rf /",
      `${CLIENT_KEY}\nssh-ed25519 AAAA`,
    ])
      expect(() => sshdCommand(SERVER, key)).toThrow(
        "not one ssh-ed25519 public key"
      )
  })

  test("the known host is 127.0.0.1 at the published port", () => {
    expect(knownHostsLine(24680, `${CLIENT_KEY}\n`)).toBe(
      "[127.0.0.1]:24680 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0b1pk"
    )
    expect(() => knownHostsLine(3000, CLIENT_KEY)).toThrow("never used")
  })
})

describe("the configuration", () => {
  test("root logs in by key only, and the configuration is checked before sshd starts", () => {
    const list = sshdCommand(SERVER, CLIENT_KEY)
    expect(list.slice(0, 5)).toEqual(["docker", "exec", SERVER, "sh", "-c"])
    const text = script(list)
    for (const line of [
      "PermitRootLogin prohibit-password",
      "AuthenticationMethods publickey",
      "PasswordAuthentication no",
      "KbdInteractiveAuthentication no",
      "AllowUsers root",
    ])
      expect(text).toContain(`'${line}'`)
    expect(text.indexOf("sshd -t -f")).toBeLessThan(text.indexOf("sshd -f"))
    expect(text.startsWith("set -eu\n")).toBe(true)
  })
})
