/**
 * The server's public address, as `ssh -G` names its host
 * (specs/015-domains-https, contracts/cli.md, CL5; research R27; tasks
 * T052): only three lines read, through a stand-in for the spawn, so no ssh
 * is run and no user's configuration is read; a name looked up with the
 * effect given. Nothing here touches the network.
 */
import { describe, expect, test } from "bun:test"

import { sshHostName, sshHostOf } from "../../src/domains/server-address"

/** What `ssh -G` prints, with the lines that do not matter around the three that do. */
const sshG = (lines: string[]) =>
  ["user deploy", ...lines, "identityfile ~/.ssh/id_ed25519", "port 22"].join(
    "\n"
  )

describe("sshHost: the server's public address from ssh -G (CL5, R27)", () => {
  test("only hostname, proxyjump and proxycommand are read; a jump host or a proxy command means not known", () => {
    expect(sshHostName(sshG(["hostname 203.0.113.7"]))).toBe("203.0.113.7")
    expect(
      sshHostName(sshG(["hostname 203.0.113.7", "proxycommand none"]))
    ).toBe("203.0.113.7")
    expect(
      sshHostName(sshG(["hostname 10.0.0.5", "proxyjump bastion"]))
    ).toBeUndefined()
    expect(
      sshHostName(
        sshG(["hostname 203.0.113.7", "proxycommand nc -X 5 -x proxy %h %p"])
      )
    ).toBeUndefined()
    expect(sshHostName(sshG([]))).toBeUndefined()
    expect(sshHostName("hostname [2001:db8::7]")).toBe("2001:db8::7")
  })

  test("an address as it is; a name looked up; only public addresses count; ssh failing is not known", async () => {
    const asked: string[] = []
    const of = (
      output: string | undefined,
      resolve?: Parameters<typeof sshHostOf>[0]["resolveDomain"]
    ) =>
      sshHostOf({
        config: async (destination) => {
          asked.push(destination)
          return output
        },
        resolveDomain: resolve,
      })
    expect(await of(sshG(["hostname 203.0.113.7"]))("deploy@prod")).toEqual({
      v4: ["203.0.113.7"],
      v6: [],
    })
    expect(asked).toEqual(["deploy@prod"])
    expect(await of(sshG(["hostname 10.0.0.5"]))("prod")).toBeUndefined()
    expect(await of(sshG(["hostname 127.0.0.1"]))("prod")).toBeUndefined()
    expect(await of(undefined)("prod")).toBeUndefined()
    // A name: looked up with the effect given; none given is "cannot tell".
    expect(
      await of(sshG(["hostname prod.example.com"]))("prod")
    ).toBeUndefined()
    const resolve = async () => ({
      v4: ["10.0.0.5", "203.0.113.7"],
      v6: ["fd00::1"],
    })
    expect(
      await of(sshG(["hostname prod.example.com"]), resolve)("prod")
    ).toEqual({ v4: ["203.0.113.7"], v6: [] })
    expect(
      await of(sshG(["hostname prod.internal"]), async () => ({
        v4: ["10.0.0.5"],
        v6: [],
      }))("prod")
    ).toBeUndefined()
    expect(
      await of(sshG(["hostname prod.example.com"]), async () => {
        throw new Error("no network")
      })("prod")
    ).toBeUndefined()
  })
})
