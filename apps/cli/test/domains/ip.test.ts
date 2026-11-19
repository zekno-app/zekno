/**
 * Which addresses are public, and two spellings of one address
 * (specs/015-domains-https, contracts/cli.md, CL5; research R27; tasks
 * T052, T053): plain arithmetic on the text of an address.
 */
import { describe, expect, test } from "bun:test"

import { addressKey, firstShared, isPublicAddress } from "../../src/domains/ip"

describe("which addresses are public (CL5)", () => {
  test("private, loopback, link-local, carrier-grade NAT and unique-local are not; the documentation ranges are", () => {
    const table: [string, boolean][] = [
      ["203.0.113.7", true],
      ["198.51.100.9", true],
      ["192.0.2.1", true],
      ["8.8.8.8", true],
      ["10.0.0.5", false],
      ["172.16.0.1", false],
      ["172.31.255.255", false],
      ["172.32.0.1", true],
      ["192.168.1.10", false],
      ["127.0.0.1", false],
      ["169.254.1.1", false],
      ["100.64.0.1", false],
      ["100.127.255.255", false],
      ["100.128.0.1", true],
      ["2001:db8::1", true],
      ["2606:4700::6810:84e5", true],
      ["::1", false],
      ["fe80::1", false],
      ["fe80::1%en0", false],
      ["fc00::1", false],
      ["fd12:3456::1", false],
      ["::ffff:10.0.0.1", false],
      ["::ffff:203.0.113.7", true],
      // What no server is reached at from the internet (security-review.md, S8).
      ["0.0.0.0", false],
      ["0.1.2.3", false],
      ["192.0.0.8", false],
      ["198.18.0.1", false],
      ["198.19.255.255", false],
      ["198.20.0.1", true],
      ["224.0.0.1", false],
      ["239.255.255.250", false],
      ["240.0.0.1", false],
      ["255.255.255.255", false],
      ["::", false],
      ["ff02::1", false],
      ["64:ff9b::cb00:7107", false],
      ["2002:cb00:7107::1", false],
      ["2001:db8::1%en0", false],
      ["prod.example.com", false],
      ["", false],
    ]
    expect(
      table.map(([address]) => [address, isPublicAddress(address)])
    ).toEqual(table)
  })

  test("two spellings of one address are one; an IPv4 address in IPv6 is the IPv4 address", () => {
    expect(addressKey("2001:db8::1")).toBe(addressKey("2001:0db8:0:0:0:0:0:1"))
    expect(addressKey("::ffff:203.0.113.7")).toBe("203.0.113.7")
    expect(addressKey("not an address")).toBeUndefined()
    expect(firstShared(["198.51.100.9", "203.0.113.7"], ["203.0.113.7"])).toBe(
      "203.0.113.7"
    )
    expect(firstShared(["2001:DB8::1"], ["2001:db8:0::1"])).toBe("2001:DB8::1")
    expect(firstShared(["198.51.100.9"], ["203.0.113.7"])).toBeUndefined()
  })
})
