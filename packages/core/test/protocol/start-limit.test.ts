/**
 * A runner's report in protocol 5 (specs/015-domains-https, contracts/core.md,
 * "The protocol" and "Outcomes"; security review, lead A10): `startLimit`,
 * the time limit in whole seconds of a start the runner stopped waiting for,
 * present only with `start_failed`. A `start_failed` without it failed for
 * another reason, as before.
 */
import { describe, expect, test } from "bun:test"

import * as core from "../../src/index"

const { parseMessage, RUNNER_OUTCOMES, RunnerReportSchema } = core

const reads = (report: unknown) => parseMessage(RunnerReportSchema, report).ok

describe("startLimit (protocol 5)", () => {
  test("this library speaks protocol 5", () => {
    expect(core.RUNNER_PROTOCOL).toBe(5)
  })

  test("start_failed reads with a limit, and without one as before", () => {
    for (const report of [
      { outcome: "start_failed", app: "shop", sequence: 42, startLimit: 1800 },
      { outcome: "start_failed", app: "shop", sequence: 42 },
      { outcome: "start_failed", startLimit: 1 },
      { outcome: "start_failed", startLimit: 86_400 },
    ])
      expect([report, reads(report)]).toEqual([report, true])
  })

  test("only with start_failed", () => {
    for (const outcome of RUNNER_OUTCOMES) {
      if (outcome === "start_failed") continue
      const report = {
        outcome,
        app: "shop",
        sequence: 42,
        startLimit: 1800,
        ...(outcome === "refused" ? { reason: "busy" } : {}),
        ...(outcome === "routes_failed"
          ? { routes: { failure: "not_loaded" } }
          : {}),
        ...(outcome === "unhealthy"
          ? { health: { service: "web", http: true } }
          : {}),
      }
      expect([report, reads(report)]).toEqual([report, false])
      const { startLimit: _, ...without } = report
      expect([without, reads(without)]).toEqual([without, true])
    }
  })

  test("whole seconds from 1 to 86,400, and nothing else", () => {
    for (const startLimit of [
      0,
      -1,
      86_401,
      1.5,
      "1800",
      null,
      true,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const report = { outcome: "start_failed", startLimit }
      expect([report, reads(report)]).toEqual([report, false])
    }
  })

  test("still no free text beside it", () => {
    for (const report of [
      { outcome: "start_failed", startLimit: 1800, message: "stopped" },
      { outcome: "start_failed", startLimit: { seconds: 1800 } },
      { outcome: "start_failed", startLimit: 1800, reason: "busy" },
    ])
      expect([report, reads(report)]).toEqual([report, false])
  })
})
