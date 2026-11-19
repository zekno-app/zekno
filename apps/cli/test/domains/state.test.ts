/**
 * The nine states of `zekno domain` (specs/015-domains-https,
 * contracts/cli.md, CL4; lines D1 to D9; tasks T061), as a table: from what
 * the file, the server and this machine say, the first state that holds,
 * its words and, when live, the last day. The example values of lines.md.
 */
import { describe, expect, test } from "bun:test"

import { pointsTo } from "../support/domain-stand-ins"
import {
  domainState,
  RENEWAL_DAYS,
  type DomainFacts,
} from "../../src/domains/state"
import { D1, D2, D3, D4, D5, D6, D7, D8, D9 } from "../../src/domains/words"
import { pointAt } from "../../src/domains/words-extra"

const NOW = new Date("2026-11-19T12:00:00Z")
const LATER = new Date("2027-02-17T12:00:00Z")
const SOON = new Date(NOW.getTime() + (RENEWAL_DAYS - 2) * 86_400_000)
const SERVER = { v4: ["203.0.113.7"], v6: [] }
const HELD: DomainFacts = {
  inFile: true,
  held: true,
  dns: { kind: "found", addresses: pointsTo("203.0.113.7") },
  addresses: SERVER,
  https: { state: "valid", until: LATER },
}

describe("the state of a domain (CL4)", () => {
  test("the first that holds, in the table's order", () => {
    const table: [string, DomainFacts, unknown][] = [
      [
        "another app holds it, whatever else is true",
        { ...HELD, held: false, takenBy: "blog" },
        { state: "taken", words: D9("blog") },
      ],
      [
        "in the file, not held for this app",
        { ...HELD, held: false },
        { state: "not-deployed", words: D7 },
      ],
      [
        "held for this app, not in the file",
        { ...HELD, inFile: false },
        { state: "releasing", words: D8 },
      ],
      [
        "held, no A and no AAAA record",
        { ...HELD, dns: { kind: "none" } },
        { state: "no-dns", words: D4("A", "203.0.113.7") },
      ],
      [
        "held, no record, the server's address not known",
        { ...HELD, dns: { kind: "none" }, addresses: undefined },
        {
          state: "no-dns",
          words: { state: "no DNS record", detail: pointAt("prod-1") },
        },
      ],
      [
        "held, pointing elsewhere",
        {
          ...HELD,
          dns: { kind: "found", addresses: pointsTo("198.51.100.9") },
        },
        { state: "dns-elsewhere", words: D5("198.51.100.9", "prod-1") },
      ],
      [
        "held, pointing elsewhere, the server's address not known: HTTPS decides",
        {
          ...HELD,
          dns: { kind: "found", addresses: pointsTo("198.51.100.9") },
          addresses: undefined,
        },
        { state: "live", words: D1(LATER), until: LATER },
      ],
      [
        "held, the lookup could not tell: HTTPS decides",
        { ...HELD, dns: { kind: "unknown" }, https: { state: "none" } },
        { state: "down", words: D6("prod-1") },
      ],
      [
        "held, nothing answers on 443",
        { ...HELD, https: { state: "none" } },
        { state: "down", words: D6("prod-1") },
      ],
      [
        "held, HTTPS not asked counts as nothing answering",
        { ...HELD, https: undefined },
        { state: "down", words: D6("prod-1") },
      ],
      [
        "held, something answers without a valid certificate",
        { ...HELD, https: { state: "invalid" } },
        { state: "waiting", words: D3("prod-1") },
      ],
      [
        "held, valid, its last day within 14 days",
        { ...HELD, https: { state: "valid", until: SOON } },
        { state: "renewing", words: D2(SOON), until: SOON },
      ],
      [
        "held and valid",
        HELD,
        { state: "live", words: D1(LATER), until: LATER },
      ],
    ]
    expect(
      table.map(([about, facts]) => [about, domainState(facts, "prod-1", NOW)])
    ).toEqual(table.map(([about, , shown]) => [about, shown]) as never)
  })

  test("the words are lines.md's: D2 names the day and month, D1 the date", () => {
    expect(domainState(HELD, "prod-1", NOW).words).toEqual({
      state: "live",
      detail: "certificate until 17 Feb 2027",
    })
    const ends = new Date("2026-11-21T08:00:00Z")
    expect(
      domainState(
        { ...HELD, https: { state: "valid", until: ends } },
        "prod-1",
        NOW
      ).words
    ).toEqual({
      state: "live",
      detail: "certificate ends 21 Nov, renewal is failing",
    })
  })
})
