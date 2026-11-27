/**
 * The bounded reasons (specs/016-build-from-source, T076; contracts/
 * runner.md RB16; data-model.md, "The bounded reasons"): each reason alone,
 * each pair where the earlier wins, and the builder's text only helping to
 * choose. `reserved_image` waits for check L9 (T082); `runner_restarted` is
 * RB15's (T091). Nothing here runs Docker. What a real out-of-memory build
 * prints is check L6's (job `memory`); nothing is claimed about a real 1 GB
 * server.
 */
import { describe, expect, test } from "bun:test"

import { reasonOf, type Seen } from "../../src/builder/reasons"

/** The conditions RB16 names, in its order; a reason with two ways to hold has a line for each. */
const CONDITIONS: readonly (readonly [string, Seen])[] = [
  ["time_limit", { atLimit: true }],
  ["out_of_disk", { belowFloor: true }],
  [
    "out_of_disk",
    {
      error:
        "failed to copy files: write /var/lib/docker/x: no space left on device",
    },
  ],
  ["team_changed", { teamChanged: true }],
  ["cache_used", { fresh: true, cached: true }],
  ["wrong_processor", { wrongArch: true }],
  ["wrong_processor", { lastError: "exec /bin/sh: exec format error" }],
  [
    "out_of_memory",
    {
      error:
        'process "/bin/sh -c npm ci" did not complete successfully: exit code: 137',
    },
  ],
  [
    "out_of_memory",
    {
      lastError:
        'ERROR: failed to build: failed to solve: ResourceExhausted: process "/bin/sh -c dd if=/dev/zero of=/dev/null bs=1600000000 count=1" did not complete successfully: cannot allocate memory',
    },
  ],
]

const ORDER = [
  "time_limit",
  "out_of_disk",
  "team_changed",
  "cache_used",
  "wrong_processor",
  "out_of_memory",
  "step_failed",
]

/** Two things seen at once: each fact of either, and the texts of both. */
function both(a: Seen, b: Seen): Seen {
  const text = (x?: string, y?: string) =>
    x === undefined ? y : y === undefined ? x : `${x}\n${y}`
  return {
    atLimit: a.atLimit || b.atLimit,
    belowFloor: a.belowFloor || b.belowFloor,
    teamChanged: a.teamChanged || b.teamChanged,
    fresh: a.fresh || b.fresh,
    cached: a.cached || b.cached,
    wrongArch: a.wrongArch || b.wrongArch,
    error: text(a.error, b.error),
    lastError: text(a.lastError, b.lastError),
  }
}

describe("reasonOf", () => {
  test("each reason alone", () => {
    for (const [reason, seen] of CONDITIONS)
      expect(reasonOf(seen)).toBe(reason as never)
    expect(reasonOf({})).toBe("step_failed")
  })

  test("each pair: the earlier reason wins", () => {
    let pairs = 0
    for (const [first, a] of CONDITIONS)
      for (const [second, b] of CONDITIONS) {
        if (ORDER.indexOf(first) >= ORDER.indexOf(second)) continue
        expect(reasonOf(both(a, b))).toBe(first as never)
        expect(reasonOf(both(b, a))).toBe(first as never)
        pairs += 1
      }
    expect(pairs).toBe(33)
  })

  test("a stop at the limit whose error says no space is time_limit", () => {
    expect(
      reasonOf({
        atLimit: true,
        error: "write /x: no space left on device",
        lastError: "ERROR: failed to build: no space left on device",
      })
    ).toBe("time_limit")
  })

  test("text the builder printed that names no reason is step_failed", () => {
    for (const error of [
      'process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
      'failed to compute cache key: "/missing" not found',
      "exit code: 1370",
      "a piece no longer matches",
      "",
    ])
      expect(reasonOf({ error, lastError: error })).toBe("step_failed")
  })

  test("a cached step counts only in a build that may reuse none", () => {
    expect(reasonOf({ cached: true })).toBe("step_failed")
    expect(reasonOf({ fresh: true })).toBe("step_failed")
  })

  test("a step's own command never chooses: only what follows it does", () => {
    const command = (cause: string) =>
      `process "/bin/sh -c echo 'no space left on device' 'exec format error' 'cannot allocate memory' 'exit code: 137'" did not complete successfully: ${cause}`
    expect(reasonOf({ error: command("exit code: 1") })).toBe("step_failed")
    expect(
      reasonOf({
        lastError: `ERROR: failed to solve: ${command("exit code: 2")}`,
      })
    ).toBe("step_failed")
    expect(reasonOf({ error: command("exit code: 137") })).toBe("out_of_memory")
  })

  test("never runner_restarted, never reserved_image", () => {
    const every: Seen = {
      atLimit: true,
      belowFloor: true,
      teamChanged: true,
      fresh: true,
      cached: true,
      wrongArch: true,
      error: "no space left on device",
      lastError: "exec format error",
    }
    expect(reasonOf(every)).toBe("time_limit")
    for (const [, seen] of CONDITIONS)
      expect(["runner_restarted", "reserved_image"]).not.toContain(
        reasonOf(seen)
      )
  })
})
