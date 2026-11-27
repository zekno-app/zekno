/**
 * The events of `deploy` in protocol 6 (specs/016-build-from-source,
 * contracts/core.md CO11; FR-031a, FR-070, FR-071): `build`, `build_line` and
 * `build_error`, each strict, beside `progress` and `health`. Their text is
 * for a person and never trusted; the bound of each is what keeps the
 * `deploy` frame within its 64 KiB (CO19).
 */
import { describe, expect, test } from "bun:test"

import {
  BuildErrorEventSchema,
  BuildEventSchema,
  BuildLineEventSchema,
} from "../../src/protocol/build-messages"
import { LIMITS } from "../../src/protocol/limits"
import { parseMessage } from "../../src/protocol/protocol"
import {
  SESSION_FRAME_BYTES,
  SessionEventSchema,
  SessionFrameSchema,
} from "../../src/protocol/session"

const reads = (schema: Parameters<typeof parseMessage>[0], value: unknown) =>
  parseMessage(schema, value).ok

/** Bytes of a value written out as one JSON line. */
const written = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length

const KEY = "ab".repeat(32)
/** Keys that are not 64 lowercase hex. */
const NOT_KEYS = [
  "a".repeat(63),
  "a".repeat(65),
  "A".repeat(64),
  `${"a".repeat(63)}g`,
  "",
  64,
  null,
]

/** Each event reads by its own schema, as an event of a session and as a frame. */
function readsEverywhere(
  schema: Parameters<typeof parseMessage>[0],
  event: unknown
) {
  return [
    reads(schema, event),
    reads(SessionEventSchema, event),
    reads(SessionFrameSchema, event),
  ]
}

describe("the event build", () => {
  test("names a build by its key and one of its four states", () => {
    for (const state of ["reused", "building", "built", "failed"]) {
      const event = { event: "build", key: KEY, state }
      expect([event, readsEverywhere(BuildEventSchema, event)]).toEqual([
        event,
        [true, true, true],
      ])
    }
  })

  test("strict: nothing else, and no other state", () => {
    for (const wrong of [
      { event: "build", key: KEY },
      { event: "build", state: "built" },
      { event: "build", key: KEY, state: "stopped" },
      { event: "build", key: KEY, state: "Built" },
      { event: "build", key: KEY, state: "built", line: "done" },
      { event: "build", key: KEY, state: "built", app: "shop" },
      { event: "builds", key: KEY, state: "built" },
      ...NOT_KEYS.map((key) => ({ event: "build", key, state: "built" })),
    ])
      expect([wrong, readsEverywhere(BuildEventSchema, wrong)]).toEqual([
        wrong,
        [false, false, false],
      ])
  })
})

describe("the event build_line", () => {
  test(`a line of at most ${LIMITS.buildLineCharacters} characters`, () => {
    expect(LIMITS.buildLineCharacters).toBe(4096)
    for (const line of ["", "#5 [2/4] RUN npm ci", "x".repeat(4096)]) {
      const event = { event: "build_line", key: KEY, line }
      expect(readsEverywhere(BuildLineEventSchema, event)).toEqual([
        true,
        true,
        true,
      ])
    }
    const over = { event: "build_line", key: KEY, line: "x".repeat(4097) }
    expect(readsEverywhere(BuildLineEventSchema, over)).toEqual([
      false,
      false,
      false,
    ])
  })

  test("strict, with a key of 64 hex", () => {
    for (const wrong of [
      { event: "build_line", key: KEY },
      { event: "build_line", line: "x" },
      { event: "build_line", key: KEY, line: 1 },
      { event: "build_line", key: KEY, line: "x", step: "RUN" },
      { event: "build_line", key: KEY, line: "x", service: "web" },
      ...NOT_KEYS.map((key) => ({ event: "build_line", key, line: "x" })),
    ])
      expect([wrong, readsEverywhere(BuildLineEventSchema, wrong)]).toEqual([
        wrong,
        [false, false, false],
      ])
  })
})

describe("the event build_error", () => {
  const error = (step: string, text: string) => ({
    event: "build_error",
    key: KEY,
    step,
    error: text,
  })

  test(`a step of at most ${LIMITS.buildStepCharacters} characters and an error of at most 4,096`, () => {
    expect(LIMITS.buildStepCharacters).toBe(1024)
    for (const event of [
      error("[2/4] RUN npm ci", "exit code: 1"),
      error("", ""),
      error("s".repeat(1024), "e".repeat(4096)),
    ])
      expect(readsEverywhere(BuildErrorEventSchema, event)).toEqual([
        true,
        true,
        true,
      ])
    for (const event of [
      error("s".repeat(1025), "e"),
      error("s", "e".repeat(4097)),
    ])
      expect(readsEverywhere(BuildErrorEventSchema, event)).toEqual([
        false,
        false,
        false,
      ])
  })

  test("strict, with a key of 64 hex", () => {
    const { step: _step, ...noStep } = error("s", "e")
    const { error: _error, ...noError } = error("s", "e")
    for (const wrong of [
      noStep,
      noError,
      { ...error("s", "e"), step: null },
      { ...error("s", "e"), line: "x" },
      { ...error("s", "e"), reason: "step_failed" },
      { ...error("s", "e"), event: "error" },
      ...NOT_KEYS.map((key) => ({ ...error("s", "e"), key })),
    ])
      expect([wrong, readsEverywhere(BuildErrorEventSchema, wrong)]).toEqual([
        wrong,
        [false, false, false],
      ])
  })
})

describe("progress and health stay", () => {
  test("both still read as events of a session", () => {
    for (const event of [
      { event: "progress", line: "Container shop-web-1 Started" },
      { event: "health", service: "web" },
    ])
      expect([event, reads(SessionEventSchema, event)]).toEqual([event, true])
  })
})

describe("the frame of deploy (CO11, CO19)", () => {
  // A control character takes six bytes written out as JSON (`\u0001`).
  const wide = (length: number) => "\u0001".repeat(length)
  const line = {
    event: "build_line",
    key: KEY,
    line: wide(LIMITS.buildLineCharacters),
  }
  const error = (step: number) => ({
    event: "build_error",
    key: KEY,
    step: wide(step),
    error: wide(4096),
  })

  test("the longest build_line (about 24 KiB) and build_error (about 30 KiB), times 1.5, fit 64 KiB", () => {
    expect(SESSION_FRAME_BYTES.deploy).toBe(64 * 1024)
    expect(SESSION_FRAME_BYTES.deploy).toBe(SESSION_FRAME_BYTES.apply)
    expect(reads(SessionFrameSchema, line)).toBe(true)
    expect(reads(SessionFrameSchema, error(LIMITS.buildStepCharacters))).toBe(
      true
    )
    expect(written(line)).toBeGreaterThan(24 * 1024)
    expect(written(line) * 1.5).toBeLessThan(SESSION_FRAME_BYTES.deploy)
    const longest = written(error(LIMITS.buildStepCharacters))
    expect(longest).toBeGreaterThan(30 * 1024)
    expect(longest * 1.5).toBeLessThan(SESSION_FRAME_BYTES.deploy)
  })

  test("a step of 4,096 would not fit, which is why the runner cuts it to 1,024", () => {
    expect(written(error(4096)) * 1.5).toBeGreaterThan(
      SESSION_FRAME_BYTES.deploy
    )
    expect(reads(SessionFrameSchema, error(4096))).toBe(false)
  })
})
