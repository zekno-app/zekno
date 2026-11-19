/**
 * The pre-deploy command, the health check and routes (contracts/message.md,
 * F31 to F40), with the path and domain rules, read through
 * `readDeployV2Payload`. The pre-deploy command is still a later field: as in
 * later-fields.test.ts, it "passes" when it keeps every rule and this step
 * refuses it, `unsupported_version`. The health check and routes are carried
 * out since feature 015 (specs/015-domains-https, contracts/core.md): they
 * pass when the deploy reads.
 */
import { describe, expect, test } from "bun:test"

import { readDeployV2Payload } from "../../src/deploy/message"
import {
  domainFault,
  HealthSchema,
  isHealthPath,
  isRoutableDomain,
  RouteSchema,
} from "../../src/index"
import { LIMITS } from "../../src/protocol/limits"
import { KiB, payload } from "../support/payload-v2"

/** A later field that keeps its rules: refused by F7 only. */
const LATER = "unsupported_version"
/** A field this library carries out, keeping its rules: the deploy reads. */
const PASSES = "read"

const code = (json: unknown) => {
  const read = readDeployV2Payload(json)
  return read.ok ? "read" : read.error.code
}

describe("F31 to F34: the pre-deploy command", () => {
  const predeploy = (change: Record<string, unknown> = {}) =>
    code(
      payload({
        predeploy: {
          service: "web",
          command: ["migrate"],
          timeout: 60,
          ...change,
        },
      })
    )

  test("its service and time limit", () => {
    expect(predeploy()).toBe(LATER)
    for (const service of ["", "-web", "we b", "a".repeat(64)])
      expect(predeploy({ service })).toBe("malformed")
    for (const timeout of [1, LIMITS.predeploySeconds])
      expect(predeploy({ timeout })).toBe(LATER)
    for (const timeout of [0, LIMITS.predeploySeconds + 1, 2.5])
      expect(predeploy({ timeout })).toBe("malformed")
    expect(predeploy({ shell: true })).toBe("malformed")
  })

  test("its words: 1 to 64, each at most 4,096 characters, all at most 16 KiB", () => {
    const words = (count: number, length = 1) =>
      Array.from({ length: count }, () => "a".repeat(length))
    expect(predeploy({ command: [] })).toBe("malformed")
    expect(predeploy({ command: words(LIMITS.predeployWords) })).toBe(LATER)
    expect(predeploy({ command: words(LIMITS.predeployWords + 1) })).toBe(
      "malformed"
    )
    expect(predeploy({ command: words(1, LIMITS.predeployWordLength) })).toBe(
      LATER
    )
    expect(
      predeploy({ command: words(1, LIMITS.predeployWordLength + 1) })
    ).toBe("malformed")
    expect(LIMITS.predeployBytes).toBe(16 * KiB)
    expect(predeploy({ command: words(4, 4096) })).toBe(LATER)
    expect(predeploy({ command: [...words(4, 4096), "a"] })).toBe("malformed")
    for (const word of ["a\u0000b", "\udc00"])
      expect(predeploy({ command: ["sh", word] })).toBe("malformed")
  })
})

describe("F35 to F38: the health check", () => {
  const health = (change: Record<string, unknown> = {}) =>
    code(
      payload({
        health: {
          timeout: 60,
          services: [{ service: "web", http: null }],
          ...change,
        },
      })
    )
  const checked = (count: number) =>
    Array.from({ length: count }, (_, n) => ({
      service: `s${String(n).padStart(2, "0")}`,
      http: { port: 3000, path: "/" },
    }))

  test("its time limit and services", () => {
    expect(health()).toBe(PASSES)
    for (const timeout of [1, LIMITS.healthSeconds])
      expect(health({ timeout })).toBe(PASSES)
    for (const timeout of [0, LIMITS.healthSeconds + 1])
      expect(health({ timeout })).toBe("malformed")
    expect(health({ services: [] })).toBe("malformed")
    expect(health({ services: checked(LIMITS.healthServices) })).toBe(PASSES)
    expect(health({ services: checked(LIMITS.healthServices + 1) })).toBe(
      "malformed"
    )
    const [a, b] = checked(2)
    expect(health({ services: [b, a] })).toBe("malformed")
    expect(health({ services: [a, a] })).toBe("malformed")
    expect(health({ services: [{ service: "we b", http: null }] })).toBe(
      "malformed"
    )
    expect(health({ services: [{ service: "web" }] })).toBe("malformed")
  })

  test("an HTTP check's port and path", () => {
    const http = (value: unknown) =>
      health({ services: [{ service: "web", http: value }] })
    for (const port of [1, 65535])
      expect(http({ port, path: "/" })).toBe(PASSES)
    for (const port of [0, 65536, 80.5])
      expect(http({ port, path: "/" })).toBe("malformed")
    expect(http({ port: 80, path: "/", method: "GET" })).toBe("malformed")
    expect(http({ port: 80 })).toBe("malformed")
  })

  test("the path rule", () => {
    const path = (value: string) =>
      health({
        services: [{ service: "web", http: { port: 80, path: value } }],
      })
    for (const value of [
      "/health",
      "/a?b=%20",
      "/",
      "/-._~!$&'()*+,;=:@/?",
      `/${"a".repeat(LIMITS.healthPathLength - 1)}`,
      `/${"%2F".repeat(341)}`,
    ])
      expect([value.slice(0, 20), path(value)]).toEqual([
        value.slice(0, 20),
        PASSES,
      ])
    for (const value of [
      "/a b",
      "/a#b",
      "health",
      "",
      "/%zz",
      "/%2",
      "/aé",
      "/a\\b",
      "/a<b",
      `/${"a".repeat(LIMITS.healthPathLength)}`,
      // 1,025 characters that the pattern alone would let through.
      `/${"%2F".repeat(341)}a`,
    ])
      expect([value.slice(0, 20), path(value)]).toEqual([
        value.slice(0, 20),
        "malformed",
      ])
  })
})

describe("F39 and F40: routes", () => {
  const route = (domain: string, change: Record<string, unknown> = {}) => ({
    domain,
    service: "web",
    port: 3000,
    ...change,
  })
  const routes = (list: unknown[]) => code(payload({ routes: list }))

  test("at most 64, sorted by domain, each domain once, each a strict object", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) =>
        route(`d${String(n).padStart(2, "0")}.example.com`)
      )
    expect(routes(many(LIMITS.routesPerDeploy))).toBe(PASSES)
    expect(routes(many(LIMITS.routesPerDeploy + 1))).toBe("malformed")
    expect(routes([route("b.example.com"), route("a.example.com")])).toBe(
      "malformed"
    )
    expect(
      routes([route("a.example.com"), route("a.example.com", { port: 4000 })])
    ).toBe("malformed")
    expect(routes([route("a.example.com", { tls: false })])).toBe("malformed")
    for (const change of [{ port: 0 }, { port: 65536 }, { service: "we b" }])
      expect(routes([route("a.example.com", change)])).toBe("malformed")
    expect(routes([route("a.example.com", { port: 65535 })])).toBe(PASSES)
  })

  const label = (letter: string, length: number) => letter.repeat(length)
  const longest = [
    label("a", 63),
    label("b", 63),
    label("c", 63),
    label("d", 61),
  ].join(".")

  test.each([
    "demo.example.com",
    "example.com",
    "a.b",
    "a-b.c-d.com",
    "1a.com",
    "a.b1",
    "123.com",
    `${label("a", 63)}.com`,
    "localhost.com",
    "invalid.com",
    "xn.com",
    "xn-a.com",
    "a.xn",
    longest,
  ])("%s reads", (domain) => {
    expect(longest).toHaveLength(LIMITS.domainLength)
    expect(routes([route(domain)])).toBe(PASSES)
  })

  test.each([
    // Lowercase ASCII only.
    "Demo.example.com",
    "XN--BCHER-KVA.com",
    "xn--Bcher-kva.com",
    "bücher.example.com",
    // Labels of 1 to 63 of a-z, 0-9 and -, not starting or ending with -.
    "a..com",
    ".a.com",
    "-a.com",
    "a-.com",
    "a_b.com",
    "a b.com",
    `${label("a", 64)}.com`,
    // At least two labels.
    "com",
    "",
    // No label starting xn--: a name outside ASCII, in either spelling, is not
    // in this version (core.md, the domain rule 3). These three were valid
    // A-labels and passed until feature 015.
    "xn--bcher-kva.example.com",
    "xn--d1acpjx3f.xn--p1ai",
    "xn--55qx5d.com",
    // The review's probes (feature 014's review, S7).
    "xn--ls8h.la",
    "xn--fa-hia.de",
    "xn--zz.com",
    "xn--ab.com",
    "xn--a.com",
    "xn--abc-.com",
    "xn--.com",
    "a.xn--zz",
    // The last label not all digits: never an address.
    "1.2.3.4",
    "a.123",
    // No trailing dot, no wildcard.
    "a.com.",
    "*.a.com",
    "a.*",
    // Special-use names, and names under them.
    "localhost",
    "a.localhost",
    "zekno.invalid",
    "demo.invalid",
    "a.test",
    "a.example",
    "a.local",
    "a.internal",
    "a.alt",
    "a.onion",
    "1.0.0.127.in-addr.arpa",
    "invalid",
    "test",
    // At most 253 characters.
    `${longest}d`,
  ])("%p is malformed", (domain) => {
    expect(routes([route(domain)])).toBe("malformed")
  })

  test("a domain that is not text is malformed", () => {
    expect(routes([route(42 as unknown as string)])).toBe("malformed")
  })
})

describe("the rules as the library exports them (core.md, the domain rule)", () => {
  test("isRoutableDomain is the rule routes are read by, and does not lower its input", () => {
    for (const domain of ["shop.example.com", "a.b", "xn.com"])
      expect([domain, isRoutableDomain(domain)]).toEqual([domain, true])
    for (const domain of [
      "Shop.example.com",
      "xn--bcher-kva.example.com",
      "bücher.example.com",
      "localhost",
      "1.2.3.4",
      "",
    ])
      expect([domain, isRoutableDomain(domain)]).toEqual([domain, false])
    expect(isRoutableDomain(42 as unknown as string)).toBe(false)
    expect(
      RouteSchema.safeParse({
        domain: "Shop.example.com",
        service: "web",
        port: 80,
      }).success
    ).toBe(false)
  })

  test("domainFault: nothing for a name the rule takes once lowered", () => {
    for (const text of [
      "shop.example.com",
      "Shop.Example.COM",
      "WWW.EXAMPLE.ORG",
      "a-b.c-d.com",
    ])
      expect([text, domainFault(text)]).toEqual([text, undefined])
  })

  test("domainFault: not_ascii for a character outside printable ASCII, or an xn-- label, in either case", () => {
    for (const text of [
      "bücher.example.com",
      "BÜCHER.example.com",
      "例え.jp",
      "shop.example.com\u00a0",
      "shop\u0000.example.com",
      "shop.example.com\n",
      "xn--bcher-kva.example.com",
      "XN--BCHER-KVA.example.com",
      "shop.xn--p1ai",
      "xn--ls8h.la",
      "xn--fa-hia.de",
      "xn--.com",
    ])
      expect([text, domainFault(text)]).toEqual([text, "not_ascii"])
  })

  test("domainFault: not_routable for anything else the rule refuses", () => {
    for (const text of [
      "*.example.com",
      "1.2.3.4",
      "localhost",
      "a.localhost",
      "demo.invalid",
      "shop.example.com:8080",
      "shop.example.com/path",
      "https://shop.example.com",
      "a b.com",
      "a_b.com",
      "-a.com",
      "a..com",
      "a.com.",
      "com",
      "",
      `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
    ])
      expect([text, domainFault(text)]).toEqual([text, "not_routable"])
    expect(domainFault(42 as unknown as string)).toBe("not_routable")
  })

  test("isHealthPath is the path rule of F38, as HealthSchema reads it", () => {
    for (const path of [
      "/health",
      "/",
      "/a?b=%20",
      `/${"a".repeat(LIMITS.healthPathLength - 1)}`,
    ])
      expect([path.slice(0, 20), isHealthPath(path)]).toEqual([
        path.slice(0, 20),
        true,
      ])
    for (const path of [
      "health",
      "",
      "/a b",
      "/a#b",
      "/%zz",
      "/aé",
      `/${"a".repeat(LIMITS.healthPathLength)}`,
      `/${"%2F".repeat(341)}a`,
    ])
      expect([path.slice(0, 20), isHealthPath(path)]).toEqual([
        path.slice(0, 20),
        false,
      ])
    expect(isHealthPath(42 as unknown as string)).toBe(false)
    const check = (path: string) =>
      HealthSchema.safeParse({
        timeout: 60,
        services: [{ service: "web", http: { port: 80, path } }],
      }).success
    expect(check("/health")).toBe(true)
    expect(check("/a b")).toBe(false)
  })
})
