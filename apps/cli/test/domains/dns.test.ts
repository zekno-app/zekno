/**
 * Looking a domain up from this machine (specs/015-domains-https,
 * contracts/cli.md, CL5; research R26; tasks T053): through a stand-in for
 * `node:dns`'s resolver, with no record, a resolver that cannot tell, and
 * one that does not answer; and the comparison with the server's addresses.
 * Nothing here touches the network.
 */
import { describe, expect, test } from "bun:test"

import {
  firstAddress,
  lookUp,
  resolverOf,
  sharedAddress,
  type Lookups,
} from "../../src/domains/dns"

/** A stand-in for `node:dns`'s resolver: each family's answer, or the error it throws. */
function lookups(
  v4: string[] | { code: string },
  v6: string[] | { code: string } = []
): () => Lookups {
  const answer = (given: string[] | { code: string }) =>
    Array.isArray(given)
      ? Promise.resolve(given)
      : Promise.reject(Object.assign(new Error(given.code), given))
  return () => ({ resolve4: () => answer(v4), resolve6: () => answer(v6) })
}

describe("resolveDomain (CL5, R26)", () => {
  test("both families; an address is its own answer, nothing asked", async () => {
    const resolve = resolverOf(lookups(["203.0.113.7"], ["2001:db8::7"]))
    expect(await resolve("shop.example.com")).toEqual({
      v4: ["203.0.113.7"],
      v6: ["2001:db8::7"],
    })
    let asked = 0
    const counted = resolverOf(() => {
      asked++
      return lookups([])()
    })
    expect(await counted("203.0.113.7")).toEqual({
      v4: ["203.0.113.7"],
      v6: [],
    })
    expect(await counted("2001:db8::7")).toEqual({
      v4: [],
      v6: ["2001:db8::7"],
    })
    expect(asked).toBe(0)
  })

  test("no record is both lists empty, whether ENOTFOUND or ENODATA", async () => {
    expect(
      await resolverOf(lookups({ code: "ENOTFOUND" }, { code: "ENODATA" }))(
        "new.example.com"
      )
    ).toEqual({ v4: [], v6: [] })
    expect(
      await resolverOf(lookups(["203.0.113.7"], { code: "ENOTFOUND" }))(
        "shop.example.com"
      )
    ).toEqual({ v4: ["203.0.113.7"], v6: [] })
  })

  test("any other failure is thrown, and so is a resolver that never answers; what is not an address is dropped", async () => {
    await expect(
      resolverOf(lookups({ code: "ECONNREFUSED" }))("shop.example.com")
    ).rejects.toThrow()
    let cancelled = false
    const never = resolverOf(
      () => ({
        resolve4: () => new Promise<string[]>(() => {}),
        resolve6: () => new Promise<string[]>(() => {}),
        cancel: () => void (cancelled = true),
      }),
      50
    )
    await expect(never("shop.example.com")).rejects.toThrow()
    expect(cancelled).toBe(true)
    expect(
      await resolverOf(lookups(["203.0.113.7", "not an address", "::1"]))(
        "shop.example.com"
      )
    ).toEqual({ v4: ["203.0.113.7"], v6: [] })
  })

  test("lookUp: undefined or failing is unknown, nothing is none; the first address and the one shared", async () => {
    expect(await lookUp(undefined, "shop.example.com")).toEqual({
      kind: "unknown",
    })
    expect(
      await lookUp(async () => {
        throw new Error("no network")
      }, "shop.example.com")
    ).toEqual({ kind: "unknown" })
    expect(
      await lookUp(async () => ({ v4: [], v6: [] }), "shop.example.com")
    ).toEqual({ kind: "none" })
    const found = { v4: ["198.51.100.9"], v6: ["2001:db8::7"] }
    expect(await lookUp(async () => found, "shop.example.com")).toEqual({
      kind: "found",
      addresses: found,
    })
    expect(firstAddress(found)).toBe("198.51.100.9")
    expect(firstAddress({ v4: [], v6: ["2001:db8::7"] })).toBe("2001:db8::7")
    expect(sharedAddress(found, { v4: [], v6: ["2001:db8:0::7"] })).toBe(
      "2001:db8::7"
    )
    expect(
      sharedAddress(found, { v4: ["203.0.113.7"], v6: [] })
    ).toBeUndefined()
  })
})
