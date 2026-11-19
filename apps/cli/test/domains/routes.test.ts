/**
 * What a deploy signs of the two settings (specs/015-domains-https,
 * contracts/cli.md, CL3; data-model.md, "Signed"; research R14, R30; tasks
 * T047): the routes, sorted by domain, each to its service's port; the health
 * check, its services sorted, a path on the service's own port, one limit
 * the largest of theirs; the settings a deploy signed, put back for "changed,
 * not deployed"; and a route held against a Compose text (FR-017).
 */
import { describe, expect, test } from "bun:test"

import {
  healthOf,
  isRouted,
  routeFault,
  routesOf,
  servicePorts,
  withRoutes,
} from "../../src/domains/routes"
import { composeText } from "../../src/settings/compose"
import type { ServiceSettings, Settings } from "../../src/settings/types"

const IMAGE = "ghcr.io/acme/web:1.4.2"
const settings = (
  ...services: [string, Partial<ServiceSettings>][]
): Settings => ({
  version: 1,
  services: services.map(([name, service]) => [
    name,
    { image: IMAGE, ...service },
  ]),
})

describe("the routes (CL3)", () => {
  test("a route a domain, to its service and that service's port, sorted by domain", () => {
    expect(
      routesOf(
        settings(
          [
            "web",
            { port: 3000, domains: ["www.example.com", "shop.example.com"] },
          ],
          ["api", { port: 8080, domains: ["api.example.com"] }],
          ["worker", {}]
        )
      )
    ).toEqual([
      { domain: "api.example.com", service: "api", port: 8080 },
      { domain: "shop.example.com", service: "web", port: 3000 },
      { domain: "www.example.com", service: "web", port: 3000 },
    ])
    expect(routesOf(settings(["web", { port: 3000 }]))).toEqual([])
  })
})

describe("the health check (R14)", () => {
  test("none: null", () => {
    expect(healthOf(settings(["web", { port: 3000 }]))).toBeNull()
  })

  test("its services sorted by name; a path on the service's own port; the limit the largest, 60 for one left out", () => {
    expect(
      healthOf(
        settings(
          ["web", { port: 3000, health: { path: "/health" } }],
          ["api", { port: 8080, health: { timeout: 30 } }],
          ["worker", {}]
        )
      )
    ).toEqual({
      timeout: 60,
      services: [
        { service: "api", http: null },
        { service: "web", http: { port: 3000, path: "/health" } },
      ],
    })
    expect(
      healthOf(
        settings(
          ["web", { health: { timeout: 1800 } }],
          ["api", { health: {} }]
        )
      )?.timeout
    ).toBe(1800)
  })

  test("a deploy with either needs protocol 4; with neither, not", () => {
    expect(isRouted([], null)).toBe(false)
    expect(isRouted(undefined, undefined)).toBe(false)
    expect(
      isRouted([{ domain: "a.example.com", service: "web", port: 1 }], null)
    ).toBe(true)
    expect(
      isRouted([], { timeout: 60, services: [{ service: "web", http: null }] })
    ).toBe(true)
  })
})

describe("the settings a deploy signed, put back (R30)", () => {
  test("each service's domains, in domain order, and its health check with the deploy's one limit", () => {
    expect(
      withRoutes(
        settings(["web", { port: 3000 }], ["api", { port: 8080 }]),
        [
          { domain: "a.example.com", service: "web", port: 3000 },
          { domain: "b.example.com", service: "api", port: 8080 },
          { domain: "c.example.com", service: "web", port: 3000 },
        ],
        {
          timeout: 90,
          services: [
            { service: "api", http: null },
            { service: "web", http: { port: 3000, path: "/health" } },
          ],
        }
      )
    ).toEqual(
      settings(
        [
          "web",
          {
            port: 3000,
            domains: ["a.example.com", "c.example.com"],
            health: { path: "/health", timeout: 90 },
          },
        ],
        [
          "api",
          { port: 8080, domains: ["b.example.com"], health: { timeout: 90 } },
        ]
      )
    )
  })

  test("a deploy that signed neither: the settings as they were", () => {
    const plain = settings(["web", { port: 3000 }])
    expect(withRoutes(plain, [], null)).toEqual(plain)
  })
})

describe("a route against a Compose text (FR-017; B11, B12)", () => {
  const text = composeText(
    settings(
      ["web", { port: 3000 }],
      ["api", { port: 8080, publish: 80 }],
      ["worker", {}]
    )
  )

  test("the services and the ports each exposes, from zekno's text", () => {
    expect(servicePorts(text)).toEqual(
      new Map([
        ["web", new Set([3000])],
        ["api", new Set([8080])],
        ["worker", new Set()],
      ])
    )
  })

  test("and from one written by hand, its long and short forms", () => {
    expect(
      servicePorts(
        'services:\n  a:\n    image: x\n    expose: [3000, "3001"]\n  b:\n    image: x\n    ports: ["127.0.0.1:8080:80/tcp", { target: 443 }]\n'
      )
    ).toEqual(
      new Map([
        ["a", new Set([3000, 3001])],
        ["b", new Set([80, 443])],
      ])
    )
    expect(servicePorts("not: [yaml")).toBeUndefined()
    expect(servicePorts("services: 1\n")).toBeUndefined()
  })

  test("every route reaches its service: none; a service missing; a port the service has not", () => {
    const route = (service: string, port: number) => ({
      domain: `${service}.example.com`,
      service,
      port,
    })
    expect(
      routeFault(text, [route("api", 8080), route("web", 3000)])
    ).toBeUndefined()
    expect(routeFault(text, [])).toBeUndefined()
    expect(routeFault(text, [route("web", 3000), route("zzz", 1)])).toEqual({
      route: route("zzz", 1),
      kind: "missing",
    })
    expect(routeFault(text, [route("worker", 3000)])).toEqual({
      route: route("worker", 3000),
      kind: "no_port",
    })
    expect(routeFault("not: [yaml", [route("web", 3000)])).toEqual({
      route: route("web", 3000),
      kind: "missing",
    })
  })
})
