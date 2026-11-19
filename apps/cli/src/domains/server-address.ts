/**
 * The server's public addresses, as this machine's SSH would reach it
 * (specs/015-domains-https, contracts/cli.md, CL5; research R27): `ssh -G -T
 * -- <destination>` prints the configuration SSH would use, without
 * connecting. Of its output only the lines `hostname`, `proxyjump` and
 * `proxycommand` are read; the rest (the local user, identity files) is never
 * kept.
 *
 * Not known, so undefined: a jump host or a proxy command other than `none`
 * (the server is reached through something else, whose address the domain
 * would not point to); ssh failing, or taking longer than 5 seconds (it runs
 * the user's `Match exec` lines, as a real connection would); or a host name
 * that gives no address, or only addresses that are not public
 * (domains/ip.ts). A host name that is not an address is looked up with
 * `resolveDomain`, which is "cannot tell" when it is not given. A runner on
 * this machine is never asked here: domains/address.ts answers "not known"
 * for it first.
 *
 * `sshHost` is one of the three effects: main.ts builds it with `sshHostOf`,
 * and only main.ts.
 */
import { isIP } from "node:net"

import type { ServerAddresses, SshHost } from "./address"
import { lookUp, type ResolveDomain } from "./dns"
import { isPublicAddress } from "./ip"

/** How long `ssh -G` may take, and the most of its output read. */
export const SSH_CONFIG_MS = 5000
const SSH_CONFIG_BYTES = 64 * 1024

/** Runs `ssh -G` for a destination: its output, or undefined when ssh failed, took too long or wrote too much. */
export type SshConfig = (destination: string) => Promise<string | undefined>

/** The real `ssh -G -T -- <destination>`: nothing connects, nothing is asked on the terminal. */
export const sshConfig: SshConfig = async (destination) => {
  let child
  try {
    child = Bun.spawn(["ssh", "-G", "-T", "--", destination], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
  } catch {
    return undefined
  }
  const timer = setTimeout(() => child.kill(), SSH_CONFIG_MS)
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of child.stdout) {
      size += chunk.length
      if (size > SSH_CONFIG_BYTES) {
        child.kill()
        return undefined
      }
      chunks.push(chunk)
    }
    const code = await child.exited
    return code === 0 ? Buffer.concat(chunks).toString("utf8") : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The host ssh would connect to, from `ssh -G`'s output, or undefined when
 * a jump host or a proxy command is set, or no host is named. Only the
 * three lines are read; a line's key is the first word.
 */
export function sshHostName(output: string): string | undefined {
  let host: string | undefined
  let through = false
  for (const line of output.split("\n")) {
    const [key, ...rest] = line.trim().split(/\s+/)
    const value = rest.join(" ")
    if (key === "hostname") host ??= value
    else if (key === "proxyjump" || key === "proxycommand")
      through ||= value !== "" && value !== "none"
  }
  if (through || host === undefined || host === "") return undefined
  return host.replace(/^\[(.*)\]$/, "$1")
}

/** The public addresses among `found`, by family, or undefined with none. */
function publicOf(found: {
  v4: readonly string[]
  v6: readonly string[]
}): ServerAddresses | undefined {
  const v4 = found.v4.filter(isPublicAddress)
  const v6 = found.v6.filter(isPublicAddress)
  return v4.length === 0 && v6.length === 0 ? undefined : { v4, v6 }
}

/** `sshHost`, from `ssh -G` (`config`) and the lookup of a host name (`resolveDomain`). */
export function sshHostOf(options: {
  config?: SshConfig
  resolveDomain?: ResolveDomain
}): SshHost {
  const config = options.config ?? sshConfig
  return async (destination) => {
    const output = await config(destination)
    if (output === undefined) return undefined
    const host = sshHostName(output)
    if (host === undefined) return undefined
    // An address with a zone is never public, and its text after `%` is never shown (domains/ip.ts).
    if (host.includes("%")) return undefined
    const kind = isIP(host)
    if (kind !== 0)
      return publicOf({
        v4: kind === 4 ? [host] : [],
        v6: kind === 6 ? [host] : [],
      })
    const looked = await lookUp(options.resolveDomain, host)
    return looked.kind === "found" ? publicOf(looked.addresses) : undefined
  }
}
