/**
 * A runner's report in protocol 4 (specs/015-domains-https, contracts/core.md,
 * "Outcomes"): the outcomes `routes_failed` and `unhealthy`, and the fields
 * `routes` and `health`, each allowed only where the contract allows it.
 */
import { describe, expect, test } from "bun:test"

import {
  parseMessage,
  ROUTE_FAILURES,
  RUNNER_OUTCOMES,
  RunnerReportSchema,
} from "../../src/index"

const reads = (report: unknown) => parseMessage(RunnerReportSchema, report).ok

describe("the outcomes of protocol 4", () => {
  test("routes_failed and unhealthy, after today's", () => {
    expect(RUNNER_OUTCOMES).toEqual([
      "ok",
      "started",
      "start_failed",
      "refused",
      "routes_failed",
      "unhealthy",
      // Protocol 6 (specs/016-build-from-source, CO10): report-builds.test.ts.
      "build_failed",
    ])
    expect(ROUTE_FAILURES).toEqual([
      "port_taken",
      "no_container",
      "host_network",
      "not_loaded",
    ])
  })

  test("the contract's examples read", () => {
    for (const report of [
      {
        outcome: "routes_failed",
        app: "shop",
        sequence: 4,
        routes: { failure: "port_taken", port: 443 },
      },
      { outcome: "routes_failed", routes: { failure: "port_taken", port: 80 } },
      {
        outcome: "routes_failed",
        app: "shop",
        sequence: 4,
        routes: { failure: "no_container", service: "web" },
      },
      {
        outcome: "routes_failed",
        routes: { failure: "host_network", service: "web" },
      },
      { outcome: "routes_failed", routes: { failure: "not_loaded" } },
      {
        outcome: "unhealthy",
        app: "shop",
        sequence: 4,
        health: { service: "web", http: true },
      },
      { outcome: "unhealthy", health: { service: "worker", http: false } },
    ])
      expect([report, reads(report)]).toEqual([report, true])
  })

  test("still no free text, and each field holds only its own shape", () => {
    for (const report of [
      { outcome: "routes_failed" },
      { outcome: "unhealthy" },
      { outcome: "routes_failed", routes: "port_taken" },
      { outcome: "routes_failed", routes: { failure: "dns_missing" } },
      {
        outcome: "routes_failed",
        routes: { failure: "port_taken", port: 8080 },
      },
      {
        outcome: "routes_failed",
        routes: { failure: "port_taken", port: "80" },
      },
      {
        outcome: "routes_failed",
        routes: { failure: "no_container", service: "we b" },
      },
      {
        outcome: "routes_failed",
        routes: { failure: "not_loaded", message: "caddy said no" },
      },
      {
        outcome: "routes_failed",
        routes: { failure: "not_loaded" },
        reason: "busy",
      },
      { outcome: "unhealthy", health: { service: "web" } },
      { outcome: "unhealthy", health: { http: true } },
      { outcome: "unhealthy", health: { service: "web", http: "yes" } },
      { outcome: "unhealthy", health: { service: "we b", http: true } },
      {
        outcome: "unhealthy",
        health: { service: "web", http: true, line: "HTTP 500" },
      },
      {
        outcome: "unhealthy",
        health: { service: "web", http: true },
        log: "x",
      },
    ])
      expect([report, reads(report)]).toEqual([report, false])
  })

  test("every combination: routes exactly with routes_failed, health exactly with unhealthy, service and port exactly where they apply", () => {
    const withService = new Set(["no_container", "host_network"])
    const routesValues: (Record<string, unknown> | undefined)[] = [undefined]
    for (const failure of ROUTE_FAILURES)
      for (const service of [undefined, "web"])
        for (const port of [undefined, 80, 443])
          routesValues.push({
            failure,
            ...(service === undefined ? {} : { service }),
            ...(port === undefined ? {} : { port }),
          })
    const healthValues = [
      undefined,
      { service: "web", http: true },
      { service: "web", http: false },
    ]
    const wrong: unknown[] = []
    let seen = 0
    for (const outcome of RUNNER_OUTCOMES)
      for (const routes of routesValues)
        for (const health of healthValues) {
          const report = {
            outcome,
            ...(outcome === "refused" ? { reason: "busy" } : {}),
            ...(routes === undefined ? {} : { routes }),
            ...(health === undefined ? {} : { health }),
          }
          const failure = routes?.failure as string | undefined
          // `build_failed` always carries a `build` (CO10), which none of these has.
          const allowed =
            outcome !== "build_failed" &&
            (routes !== undefined) === (outcome === "routes_failed") &&
            (health !== undefined) === (outcome === "unhealthy") &&
            (failure === undefined ||
              ((routes!.service !== undefined) === withService.has(failure) &&
                (routes!.port !== undefined) === (failure === "port_taken")))
          seen++
          if (reads(report) !== allowed) wrong.push(report)
        }
    expect(seen).toBe(RUNNER_OUTCOMES.length * 25 * 3)
    expect(wrong).toEqual([])
  })
})
