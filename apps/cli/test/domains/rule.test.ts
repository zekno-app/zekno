/**
 * A domain as a person types it (specs/015-domains-https, contracts/cli.md,
 * CL2; tasks T036): lowered first, then A10 for a name zekno never routes and
 * A11 for one with letters outside ASCII, in either spelling, over the core
 * library's own rule. What was typed is named lowered and cleaned.
 */
import { describe, expect, test } from "bun:test"

import {
  domainRefusal,
  fileFault,
  isDomain,
  lowered,
} from "../../src/domains/rule"
import { A10, A11 } from "../../src/domains/words"

describe("a typed domain (CL2)", () => {
  test("lowered first: a name in capitals is the same name", () => {
    expect(lowered("Shop.Example.COM")).toBe("shop.example.com")
    expect(domainRefusal("Shop.Example.COM")).toBeUndefined()
    expect(domainRefusal("shop.example.com")).toBeUndefined()
    expect(domainRefusal("a-b.c-d.example.co.uk")).toBeUndefined()
  })

  test("A10: a wildcard, an address, localhost, a port, a path, a special-use name, a trailing dot", () => {
    for (const typed of [
      "*.example.com",
      "203.0.113.7",
      "localhost",
      "shop.example.com:443",
      "shop.example.com/x",
      "shop.test",
      "shop.localhost",
      "shop.example.com.",
      "example",
      "",
      "-shop.example.com",
    ])
      expect({ typed, said: domainRefusal(typed) }).toEqual({
        typed,
        said: A10(typed.toLowerCase()),
      })
    expect(domainRefusal("*.EXAMPLE.com")).toBe(A10("*.example.com"))
  })

  test("A11: letters outside ASCII, and a name in its xn-- spelling (decided, point 8)", () => {
    expect(domainRefusal("bücher.example")).toBe(A11("bücher.example"))
    expect(domainRefusal("BÜCHER.example")).toBe(A11("bücher.example"))
    expect(domainRefusal("xn--bcher-kva.example")).toBe(
      A11("xn--bcher-kva.example")
    )
    expect(domainRefusal("xn--ls8h.la")).toBe(A11("xn--ls8h.la"))
  })

  test("what was typed is cleaned before it is named: nothing in it acts on a terminal", () => {
    const said = domainRefusal("shop\u001b[31m.example.com")!
    expect(said).not.toContain("\u001b")
    const hidden = domainRefusal("sh​op.example.com")!
    expect(hidden).not.toContain("​")
  })
})

describe("a domain the settings file holds", () => {
  test("held as it is, never lowered: a capital letter is refused there", () => {
    expect(isDomain("shop.example.com")).toBe(true)
    expect(isDomain("Shop.example.com")).toBe(false)
    expect(fileFault("shop.example.com")).toBeUndefined()
    expect(fileFault("Shop.example.com")).toBe("rule")
    expect(fileFault("*.example.com")).toBe("rule")
    expect(fileFault("bücher.example")).toBe("ascii")
    expect(fileFault("xn--bcher-kva.example")).toBe("ascii")
  })
})
