/**
 * The two session commands of protocol 3 on the CLI's side (specs/014-deploy-v2,
 * contracts/protocol.md P9): a `deploy` answer brings Docker's lines as
 * `progress` events, as `apply`'s does; a `records` answer brings none, and
 * one longer than its bound ends the session. Each runner here is a stand-in
 * that reads one request before each step, as in session.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  RUNNER_PROTOCOL,
  RunnerRecordsSchema,
  RunnerReportSchema,
  RunnerVersionSchema,
  SESSION_FRAME_BYTES,
} from "@workspace/core"

import { tempDir } from "../../../runner/test/support/helpers"
import {
  ENDED,
  openSession,
  TOO_LARGE,
  UNEXPECTED,
} from "../../src/server/session"
import { connect } from "../../src/server/transport"

const VERSION = { version: "0.1.0", protocol: RUNNER_PROTOCOL }

/** A shell step that prints one line. */
const say = (line: unknown) => `printf '%s\\n' '${JSON.stringify(line)}'`

/** A stand-in that speaks sessions: before each step it reads one request; at the end it waits for its input to close. */
const scripted = (...steps: string[]) => [
  "sh",
  "-c",
  `${steps.map((step) => `read -r line; ${step}`).join("; ")}; cat >/dev/null`,
]

const opened = (...steps: string[]) =>
  openSession(
    connect(
      { kind: "local", home: tempDir("runner") },
      scripted(say({ result: VERSION }), ...steps)
    )
  )

describe("contracts/protocol.md P9", () => {
  test("a `deploy` answer brings Docker's lines as progress, then its result", async () => {
    const lines: string[] = []
    const s = await opened(
      `${say({ event: "progress", line: "Pulling web" })}; ${say({ result: { outcome: "started", app: "web", sequence: 1 } })}`
    )
    expect(
      await s.request("deploy", RunnerReportSchema, {
        onEvent: (event) => {
          if (event.event === "progress") lines.push(event.line)
        },
      })
    ).toEqual({ outcome: "started", app: "web", sequence: 1 })
    expect(lines).toEqual(["Pulling web"])
    await s.close()
  })

  test("a `records` answer reads; an event is not of the contract", async () => {
    const reads = await opened(say({ result: { statements: [] } }))
    expect(
      await reads.request("records", RunnerRecordsSchema, {
        input: { app: "web" },
      })
    ).toEqual({ statements: [] })
    await reads.close()

    const evented = await opened(say({ event: "progress", line: "x" }))
    await expect(
      evented.request("records", RunnerRecordsSchema, {
        input: { app: "web" },
      })
    ).rejects.toThrow(UNEXPECTED)
    await evented.close()
  })

  test("a `records` answer past 4 MiB is TOO_LARGE, and ends the session", async () => {
    expect(SESSION_FRAME_BYTES.records).toBe(4 * 1024 * 1024)
    const s = await opened(
      `head -c ${SESSION_FRAME_BYTES.records + 1} /dev/zero | tr '\\0' x; echo`
    )
    await expect(
      s.request("records", RunnerRecordsSchema, { input: { app: "web" } })
    ).rejects.toThrow(TOO_LARGE)
    await expect(s.request("version", RunnerVersionSchema)).rejects.toThrow(
      ENDED
    )
    await s.close()
  })
})
