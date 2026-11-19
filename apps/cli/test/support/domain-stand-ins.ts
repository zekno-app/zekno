/**
 * Stand-ins for the three effects of feature 015 (specs/015-domains-https,
 * contracts/cli.md, CL5): `sshHost`, `resolveDomain` and `probeHttps`, set on
 * a machine's `deps` by assignment, as `never-fetches.test.ts` sets `fetch`.
 * Each notes what it was asked, so a test can show what was looked up and
 * what was not (CL7). Nothing here touches the network.
 */
import type { Deps } from "../../src/cli/context"
import type { ServerAddresses } from "../../src/domains/address"
import type { DomainAddresses } from "../../src/domains/dns"
import type { HttpsAnswer } from "../../src/domains/https"

/** What a domain's lookup answers: its addresses, `none` for no record, `fails` for a resolver that cannot tell. */
export type DnsAnswer = DomainAddresses | "none" | "fails"

/** The server's public address in the examples, and another one. */
export const SERVER_ADDRESS = "203.0.113.7"
export const ELSEWHERE = "198.51.100.9"

/** A domain that points to `address`, IPv4. */
export const pointsTo = (address: string): DomainAddresses => ({
  v4: [address],
  v6: [],
})

/** A valid certificate whose last day is `until`. */
export const validUntil = (until: string): HttpsAnswer => ({
  state: "valid",
  until: new Date(until),
})

/** The last day of the certificate a domain left out of `https` answers with. */
export const LAST_DAY = "2027-02-17T12:00:00Z"

/**
 * Sets the three stand-ins on `deps`: the server's addresses (`server`,
 * undefined for not known), each domain's lookup (`dns`, a domain left out
 * points to the server) and each domain's HTTPS answer (`https`, one per
 * call in turn, the last one kept; a domain left out answers with a valid
 * certificate until `LAST_DAY`, so a deploy does not wait for it). Gives what
 * each was asked, in order.
 */
export function standIns(
  deps: Pick<Deps, "sshHost" | "resolveDomain" | "probeHttps">,
  given: {
    server?: ServerAddresses
    dns?: Record<string, DnsAnswer>
    https?: Record<string, HttpsAnswer[]>
  } = {}
) {
  const asked = {
    ssh: [] as string[],
    dns: [] as string[],
    https: [] as string[],
  }
  const server =
    "server" in given ? given.server : { v4: [SERVER_ADDRESS], v6: [] }
  deps.sshHost = async (destination) => {
    asked.ssh.push(destination)
    return server
  }
  deps.resolveDomain = async (name) => {
    asked.dns.push(name)
    const answer = given.dns?.[name] ?? pointsTo(SERVER_ADDRESS)
    if (answer === "fails") throw new Error("the resolver did not answer")
    return answer === "none" ? { v4: [], v6: [] } : answer
  }
  const turns = new Map<string, number>()
  deps.probeHttps = async (domain) => {
    asked.https.push(domain)
    const answers = given.https?.[domain] ?? [validUntil(LAST_DAY)]
    if (answers.length === 0) return { state: "none" }
    const turn = turns.get(domain) ?? 0
    turns.set(domain, turn + 1)
    return answers[Math.min(turn, answers.length - 1)]!
  }
  return asked
}

/** Takes the three stand-ins away again: every effect undefined, as in a test that sets none. */
export function noStandIns(
  deps: Pick<Deps, "sshHost" | "resolveDomain" | "probeHttps">
): void {
  delete deps.sshHost
  delete deps.resolveDomain
  delete deps.probeHttps
}
