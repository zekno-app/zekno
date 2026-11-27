/**
 * The events of a runner session (specs/016-build-from-source,
 * contracts/cli.md CL7 step 13 and CL14, "Every text from the server"; tasks
 * T104, with the part of T132 it takes first): `EVENTS` names protocol 6's
 * three commands, with no event yet, and `clean()` passes every text an
 * event carries through `sanitize`, the `line` of `build_line` and the
 * `step` and `error` of `build_error` among them. A `build` event carries no
 * free text: its key is 64 hex digits and its state one of four words.
 */
import { describe, expect, test } from "bun:test"
import {
  BuildEventSchema,
  SessionEventSchema,
  type SessionEvent,
} from "@workspace/core"

import { sanitize } from "../../src/server/sanitize"
import { clean, EVENTS } from "../../src/server/session-events"

const ESC = "\x1b"
/** OSC 52: writes "hello" to the clipboard of the terminal that draws it. */
const CLIPBOARD = `${ESC}]52;c;aGVsbG8=\x07`
/** OSC 8: a link drawn over other text. */
const LINK = `${ESC}]8;;https://example.com${ESC}\\here${ESC}]8;;${ESC}\\`
/** Moves the cursor up and clears the line. */
const CURSOR = `${ESC}[1A${ESC}[2K`
const KEY = "3f9a1c2b7d4e".padEnd(64, "0")

/** True when nothing a terminal acts on is left: no control character and no invisible formatting. */
const isSafe = (text: string) =>
  !/[\x00-\x1f\x7f-\x9f\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(text)

/** A text as a step could print it, with each sequence a terminal acts on. */
const hostile = (text: string) => `${CLIPBOARD}${text}${LINK}${CURSOR}`

/** The event read as a runner's frame is read, so a test never hands `clean` what the schema refuses. */
const frame = (event: Record<string, unknown>): SessionEvent =>
  SessionEventSchema.parse(event)

describe("EVENTS (contracts/session.md; CO12)", () => {
  test("pack, builds and builder are listed, with no event yet", () => {
    expect(EVENTS.pack).toEqual([])
    expect(EVENTS.builds).toEqual([])
    expect(EVENTS.builder).toEqual([])
  })

  test("the events of today's commands are as before, and a deploy takes the three build events (T132; CO11)", () => {
    expect(EVENTS.apply).toEqual(["progress"])
    expect(EVENTS.deploy).toEqual([
      "progress",
      "health",
      "build",
      "build_line",
      "build_error",
    ])
    expect(EVENTS.logs).toEqual(["log"])
  })
})

describe("clean(): every text of an event passes through sanitize (CL14)", () => {
  test("build_line: its line, the key as it came", () => {
    const line = hostile("#9 [build 4/7] RUN npm ci")
    const cleaned = clean(frame({ event: "build_line", key: KEY, line }))
    expect(cleaned).toEqual({
      event: "build_line",
      key: KEY,
      line: sanitize(line),
    })
    const text = (cleaned as { line: string }).line
    expect(isSafe(text)).toBe(true)
    expect(text).not.toContain("52;")
    expect(text).toContain("RUN npm ci")
  })

  test("build_error: its step and its error, the key as it came", () => {
    const step = hostile("RUN npm ci")
    const error = hostile("exit code: 1")
    const cleaned = clean(
      frame({ event: "build_error", key: KEY, step, error })
    )
    expect(cleaned).toEqual({
      event: "build_error",
      key: KEY,
      step: sanitize(step),
      error: sanitize(error),
    })
    const texts = cleaned as { step: string; error: string }
    for (const text of [texts.step, texts.error]) {
      expect(isSafe(text)).toBe(true)
      expect(text).not.toContain("52;")
    }
  })

  test("build: each state passes as it came, with no text to clean", () => {
    for (const state of BuildEventSchema.shape.state.options)
      expect(clean(frame({ event: "build", key: KEY, state }))).toEqual({
        event: "build",
        key: KEY,
        state,
      })
  })

  test("progress, health and log, as before", () => {
    const line = hostile("Container web Started")
    expect(clean(frame({ event: "progress", line }))).toEqual({
      event: "progress",
      line: sanitize(line),
    })
    expect(clean(frame({ event: "health", service: "web" }))).toEqual({
      event: "health",
      service: "web",
    })
    const time = "2026-11-26T10:28:00.000000000Z"
    expect(clean(frame({ event: "log", service: "web", time, line }))).toEqual({
      event: "log",
      service: "web",
      time,
      line: sanitize(line),
    })
  })

  test("a build_line of the longest length, every character a control one, comes out safe", () => {
    const line = "\x07".repeat(4096)
    const cleaned = clean(frame({ event: "build_line", key: KEY, line }))
    expect((cleaned as { line: string }).line).toBe("")
  })
})
