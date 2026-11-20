/**
 * B20 of specs/015-domains-https/design/lines.md (proposed on 2026-11-20, not
 * approved yet): what is said when the runner stopped waiting for the app
 * to start at its time limit, exactly, with the limit worded from the
 * report's seconds.
 */
import { describe, expect, test } from "bun:test"

import {
  limitWords,
  stoppedWaiting,
  stoppedWaitingPlain,
} from "../../src/shared/start-limit"

describe("B20: the runner stopped waiting for the start (lead A10)", () => {
  test("at a terminal and in the app, the lead line", () => {
    expect(stoppedWaiting("prod-1", 42, "shop", 1800)).toBe(
      "prod-1 accepted deploy 42, but shop did not start within 30 minutes, so prod-1 stopped waiting."
    )
  })

  test("in plain output", () => {
    expect(stoppedWaitingPlain("prod-1", 42, "shop", 1800)).toBe(
      "Deploy 42 of shop was accepted by prod-1, but the app did not start within 30 minutes, so prod-1 stopped waiting. Check Docker on the server."
    )
  })

  test("the limit: whole minutes in minutes, anything else in seconds", () => {
    expect([1800, 60, 120, 3600, 90, 1, 2, 59, 86_400].map(limitWords)).toEqual(
      [
        "30 minutes",
        "1 minute",
        "2 minutes",
        "60 minutes",
        "90 seconds",
        "1 second",
        "2 seconds",
        "59 seconds",
        "1440 minutes",
      ]
    )
    expect(stoppedWaiting("prod-1", 42, "shop", 90)).toContain(
      "within 90 seconds,"
    )
    expect(stoppedWaitingPlain("prod-1", 42, "shop", 60)).toContain(
      "within 1 minute,"
    )
  })
})
