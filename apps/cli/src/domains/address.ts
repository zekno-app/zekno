/**
 * The server's public address, as a record to create names it
 * (specs/015-domains-https, contracts/cli.md, CL2 and CL5): read through the
 * optional dependency `sshHost`, which runs `ssh -G` and judges the host it
 * names. A later phase gives it, in main.ts only; until then, and in every
 * test that sets no stand-in, it is undefined and the address is "not known",
 * with nothing run. A local runner has no public address. Whatever `sshHost`
 * throws is "not known" too: a record line is advice, never a reason to fail.
 */
import type { Target } from "../server/transport"
import type { RecordType } from "./words"

/** The addresses a server is reached at, by family. Both empty: none. */
export type ServerAddresses = { v4: readonly string[]; v6: readonly string[] }

/** CL5's `sshHost(destination)`: the server's public addresses, or undefined when they are not known. */
export type SshHost = (
  destination: string
) => Promise<ServerAddresses | undefined>

/** The server's public addresses, or undefined when they are not known. */
export async function serverAddresses(
  sshHost: SshHost | undefined,
  target: Target
): Promise<ServerAddresses | undefined> {
  if (sshHost === undefined || target.kind !== "ssh") return undefined
  try {
    return await sshHost(target.destination)
  } catch {
    return undefined
  }
}

/** The record a domain needs to reach the server: `A` for its first IPv4 address, else `AAAA` for its first IPv6 one. */
export function recordOf(
  addresses: ServerAddresses | undefined
): { type: RecordType; address: string } | undefined {
  const v4 = addresses?.v4[0]
  if (v4 !== undefined) return { type: "A", address: v4 }
  const v6 = addresses?.v6[0]
  return v6 === undefined ? undefined : { type: "AAAA", address: v6 }
}
