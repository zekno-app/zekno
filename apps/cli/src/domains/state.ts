/**
 * The state of a domain as `zekno domain` shows it (specs/015-domains-https,
 * contracts/cli.md, CL4; lines D1 to D9; FR-030): the first of nine that
 * holds, from three sources. Whether the server holds the domain, and for
 * which app, is the runner's word (`status` with routes); where its DNS
 * points and what HTTPS answers are found out from this machine, as a
 * visitor would. Data only: the words are lines.md's, the drawing the
 * command's.
 */
import type { ServerAddresses } from "./address"
import { recordOf } from "./address"
import { firstAddress, sharedAddress, type Looked } from "./dns"
import type { HttpsAnswer } from "./https"
import { D1, D2, D3, D4, D5, D6, D7, D8, D9, type DomainState } from "./words"
import { pointAt } from "./words-extra"

/** What is known of one domain of the app, from the file, the server and this machine. */
export type DomainFacts = {
  /** In the folder's settings file. */
  inFile: boolean
  /** In the server's routes in force for this app. */
  held: boolean
  /** The other app on the server that holds it, if one does. */
  takenBy?: string
  /** What looking it up found; undefined when it was not looked up. */
  dns?: Looked
  /** The server's public addresses; undefined when they are not known. */
  addresses?: ServerAddresses
  /** What HTTPS answered; undefined when it was not asked, which counts as nothing answering. */
  https?: HttpsAnswer
}

/** A domain's state, its words (the state after its mark, the detail dim) and, when live, its certificate's last day. */
export type DomainShown = {
  state: DomainState
  words: { state: string; detail: string }
  until?: Date
}

/** A certificate whose last day is this close is a warning: the proxy renews well before, so renewal is failing (D2). */
export const RENEWAL_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The first state of CL4's table that holds: `taken` (D9), `not-deployed`
 * (D7), `releasing` (D8), `no-dns` (D4), `dns-elsewhere` (D5), `down` (D6),
 * `waiting` (D3), `renewing` (D2), `live` (D1). A lookup that could not tell
 * leaves the DNS states out. `server` is the server's name, as D3 to D6 name
 * it; `now`, the time a last day is measured from.
 */
export function domainState(
  facts: DomainFacts,
  server: string,
  now: Date
): DomainShown {
  if (facts.takenBy !== undefined)
    return { state: "taken", words: D9(facts.takenBy) }
  if (!facts.held) return { state: "not-deployed", words: D7 }
  if (!facts.inFile) return { state: "releasing", words: D8 }
  const dns = facts.dns
  if (dns?.kind === "none") {
    const record = recordOf(facts.addresses)
    return {
      state: "no-dns",
      words:
        record === undefined
          ? { state: D4("A", "").state, detail: pointAt(server) }
          : D4(record.type, record.address),
    }
  }
  if (
    dns?.kind === "found" &&
    facts.addresses !== undefined &&
    sharedAddress(dns.addresses, facts.addresses) === undefined
  )
    return {
      state: "dns-elsewhere",
      words: D5(firstAddress(dns.addresses), server),
    }
  const https = facts.https ?? { state: "none" }
  if (https.state === "none") return { state: "down", words: D6(server) }
  if (https.state === "invalid") return { state: "waiting", words: D3(server) }
  const until = https.until
  if (until.getTime() - now.getTime() <= RENEWAL_DAYS * DAY_MS)
    return { state: "renewing", words: D2(until), until }
  return { state: "live", words: D1(until), until }
}
