/**
 * The pre-deploy command, the health check and routes (contracts/message.md,
 * F31 to F40), with the path and domain rules, read through
 * `readDeployV2Payload`. As in later-fields.test.ts, "passes" means
 * `unsupported_version`: the field keeps every rule and this step refuses it.
 */
import { describe, expect, test } from "bun:test"

import { readDeployV2Payload } from "../../src/deploy/message"
import { LIMITS } from "../../src/protocol/limits"
import { KiB, payload } from "../support/payload-v2"

const PASSES = "unsupported_version"

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
    expect(predeploy()).toBe(PASSES)
    for (const service of ["", "-web", "we b", "a".repeat(64)])
      expect(predeploy({ service })).toBe("malformed")
    for (const timeout of [1, LIMITS.predeploySeconds])
      expect(predeploy({ timeout })).toBe(PASSES)
    for (const timeout of [0, LIMITS.predeploySeconds + 1, 2.5])
      expect(predeploy({ timeout })).toBe("malformed")
    expect(predeploy({ shell: true })).toBe("malformed")
  })

  test("its words: 1 to 64, each at most 4,096 characters, all at most 16 KiB", () => {
    const words = (count: number, length = 1) =>
      Array.from({ length: count }, () => "a".repeat(length))
    expect(predeploy({ command: [] })).toBe("malformed")
    expect(predeploy({ command: words(LIMITS.predeployWords) })).toBe(PASSES)
    expect(predeploy({ command: words(LIMITS.predeployWords + 1) })).toBe(
      "malformed"
    )
    expect(predeploy({ command: words(1, LIMITS.predeployWordLength) })).toBe(
      PASSES
    )
    expect(
      predeploy({ command: words(1, LIMITS.predeployWordLength + 1) })
    ).toBe("malformed")
    expect(LIMITS.predeployBytes).toBe(16 * KiB)
    expect(predeploy({ command: words(4, 4096) })).toBe(PASSES)
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
    "xn--bcher-kva.example.com",
    "xn--d1acpjx3f.xn--p1ai",
    "xn--55qx5d.com",
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
    // An xn-- label only when it is a valid A-label.
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
