/**
 * What a deploy that was accepted says when its routes are not in force or
 * it was not healthy in time (specs/015-domains-https, contracts/cli.md,
 * CL3, "The answer"; tasks T058): B16 to B19 by the report's failure, the
 * first domain in domain order for B17 and B18, C3 with the signed path and
 * the deploy's limit, C4 without a path; nothing for any other outcome.
 */
import { describe, expect, test } from "bun:test"
import type { RunnerReport } from "@workspace/core"

import { problemOf, type Signed } from "../../src/domains/outcome"
import { B16, B17, B18, B19, C3, C4 } from "../../src/domains/words"
import {
  hostNetworkChecked,
  noContainerChecked,
} from "../../src/domains/words-extra"

const SIGNED: Signed = {
  app: "shop",
  server: "prod-1",
  routes: [
    { domain: "api.example.com", service: "api", port: 8080 },
    { domain: "shop.example.com", service: "web", port: 3000 },
    { domain: "www.example.com", service: "web", port: 3000 },
  ],
  health: {
    timeout: 90,
    services: [
      { service: "web", http: { port: 3000, path: "/health" } },
      { service: "worker", http: null },
    ],
  },
}

const failed = (routes: RunnerReport["routes"]): RunnerReport => ({
  outcome: "routes_failed",
  app: "shop",
  sequence: 43,
  routes,
})

describe("the sentence of routes_failed and unhealthy (CL3)", () => {
  test("B16 to B19, the first domain of the service named", () => {
    expect(
      problemOf(failed({ failure: "port_taken", port: 443 }), SIGNED)
    ).toBe(B16("shop", "prod-1", 443))
    expect(
      problemOf(failed({ failure: "no_container", service: "web" }), SIGNED)
    ).toBe(B17("shop.example.com", "web"))
    expect(
      problemOf(failed({ failure: "host_network", service: "api" }), SIGNED)
    ).toBe(B18("api.example.com", "api"))
    expect(problemOf(failed({ failure: "not_loaded" }), SIGNED)).toBe(
      B19("shop", "prod-1")
    )
  })

  test("a checked service no domain reaches is named alone, in B17's and B18's pattern", () => {
    expect(
      problemOf(failed({ failure: "no_container", service: "worker" }), SIGNED)
    ).toBe(noContainerChecked("worker"))
    expect(
      problemOf(failed({ failure: "host_network", service: "worker" }), SIGNED)
    ).toBe(hostNetworkChecked("worker"))
  })

  test("C3 with the signed path and the deploy's limit; C4 without a path", () => {
    const unhealthy = (service: string, http: boolean): RunnerReport => ({
      outcome: "unhealthy",
      app: "shop",
      sequence: 43,
      health: { service, http },
    })
    expect(problemOf(unhealthy("web", true), SIGNED)).toBe(
      C3("web", "/health", 90, "shop")
    )
    expect(problemOf(unhealthy("worker", false), SIGNED)).toBe(
      C4("worker", 90, "shop")
    )
    expect(
      problemOf(unhealthy("web", false), { ...SIGNED, health: null })
    ).toBe(C4("web", 60, "shop"))
  })

  test("nothing for any other outcome", () => {
    for (const outcome of ["started", "start_failed"] as const)
      expect(
        problemOf({ outcome, app: "shop", sequence: 43 }, SIGNED)
      ).toBeUndefined()
  })
})
