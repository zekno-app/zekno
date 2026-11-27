/**
 * The request `pack` of protocol 6 (specs/016-build-from-source,
 * contracts/core.md CO12; FR-028, FR-029a): one sealed piece of a signed
 * deploy, sent before the deploy, and the runner's answer, the fingerprint it
 * staged or a refusal. Its answer frame is 4 KiB; its request line, the
 * longest of every request, stays within a message.
 */
import { describe, expect, test } from "bun:test"

import { RunnerPackRequestSchema } from "../../src/protocol/build-messages"
import { base64UrlLength, LIMITS } from "../../src/protocol/limits"
import { parseMessage } from "../../src/protocol/protocol"
import {
  RunnerPackSchema,
  SESSION_COMMANDS,
  SESSION_FRAME_BYTES,
  SessionRequestSchema,
} from "../../src/protocol/session"

const reads = (schema: Parameters<typeof parseMessage>[0], value: unknown) =>
  parseMessage(schema, value).ok

/** Bytes of a value written out as one JSON line. */
const written = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length

/** An envelope by its shape, with a payload of `length` base64url characters. */
const envelope = (length = 8) => ({
  payloadType: "zekno.deploy.v2",
  payload: "A".repeat(length),
  signature: { keyId: "0".repeat(32), sig: "s".repeat(86) },
})

const LONGEST_PIECE = base64UrlLength(LIMITS.sealedPieceBytes)
const KEY = "c".repeat(64)

describe("the command pack", () => {
  test("is a command of a session, with an answer frame of 4 KiB", () => {
    expect(SESSION_COMMANDS).toContain("pack")
    expect(reads(SessionRequestSchema, { command: "pack" })).toBe(true)
    expect(SESSION_FRAME_BYTES.pack).toBe(4 * 1024)
  })
})

describe("the request", () => {
  test("a signed deploy and one piece in base64url, at most a sealed piece's length", () => {
    expect(LONGEST_PIECE).toBe(
      Math.ceil(((8 * 1024 * 1024 + 64 * 1024) * 4) / 3)
    )
    for (const piece of ["A", "Az09_-", "x".repeat(LONGEST_PIECE)])
      expect(
        reads(RunnerPackRequestSchema, { envelope: envelope(), piece })
      ).toBe(true)
    expect(
      reads(RunnerPackRequestSchema, {
        envelope: envelope(),
        piece: "x".repeat(LONGEST_PIECE + 1),
      })
    ).toBe(false)
  })

  test("a character outside base64url, or no piece at all, is refused", () => {
    for (const piece of [
      "",
      "abc+",
      "abc/",
      "abc=",
      "ab c",
      "abé",
      "a\nb",
      1,
      null,
    ])
      expect([
        piece,
        reads(RunnerPackRequestSchema, { envelope: envelope(), piece }),
      ]).toEqual([piece, false])
  })

  test("strict: the envelope by its own rules, and no other field", () => {
    for (const wrong of [
      { envelope: envelope() },
      { piece: "abc" },
      { envelope: envelope(), piece: "abc", app: "shop" },
      { envelope: envelope(), piece: "abc", fingerprint: KEY },
      { envelope: { ...envelope(), extra: 1 }, piece: "abc" },
      { envelope: "x", piece: "abc" },
      { envelope: envelope(), pieces: ["abc"] },
      null,
      [],
    ])
      expect([wrong, reads(RunnerPackRequestSchema, wrong)]).toEqual([
        wrong,
        false,
      ])
  })

  test("the longest request line (an envelope at its bound and the longest piece), about 12 MiB, is within a message", () => {
    const longest = {
      envelope: envelope(base64UrlLength(LIMITS.payloadBytes)),
      piece: "x".repeat(LONGEST_PIECE),
    }
    expect(reads(RunnerPackRequestSchema, longest)).toBe(true)
    const line = JSON.stringify({ command: "pack", input: longest })
    expect(new TextEncoder().encode(line).length).toBeGreaterThan(
      12 * 1000 * 1000
    )
    expect(new TextEncoder().encode(line).length).toBeLessThan(
      LIMITS.messageBytes
    )
    expect(reads(SessionRequestSchema, line)).toBe(true)
  })
})

describe("the answer", () => {
  const refused = (reason: string, fields: Record<string, unknown> = {}) => ({
    outcome: "refused",
    reason,
    ...fields,
  })
  const DISK = { free: 1_000_000, floor: LIMITS.diskFloorBytes }

  test("the fingerprint staged, or a report refused with a reason", () => {
    for (const answer of [
      { staged: KEY },
      refused("pack_mismatch"),
      refused("too_large"),
      refused("low_disk", { disk: DISK }),
      refused("busy"),
      refused("bad_signature"),
      refused("expired"),
      refused("wrong_server"),
      refused("not_set_up"),
      refused("invalid_request"),
      refused("invalid_state"),
    ])
      expect([answer, reads(RunnerPackSchema, answer)]).toEqual([answer, true])
  })

  test("nothing else: no other outcome, no field a deploy's report alone carries", () => {
    for (const answer of [
      { staged: "c".repeat(63) },
      { staged: "C".repeat(64) },
      { staged: KEY, app: "shop" },
      { staged: [KEY] },
      {},
      { outcome: "ok" },
      { outcome: "started", app: "shop", sequence: 1 },
      {
        outcome: "build_failed",
        app: "shop",
        sequence: 1,
        build: { key: KEY, reason: "step_failed" },
      },
      refused("low_disk"),
      refused("busy", { disk: DISK }),
      // `missing` and `building` come only in a deploy's answer (CO10).
      refused("pack_missing", { missing: { pieces: [KEY], images: [] } }),
      refused("busy", {
        building: { app: "shop", seconds: 1, limit: 1800, phase: "building" },
      }),
      { ...refused("busy"), staged: KEY },
    ])
      expect([answer, reads(RunnerPackSchema, answer)]).toEqual([answer, false])
  })

  test("the longest answer, times 1.5, fits 4 KiB", () => {
    const most = { app: "a".repeat(63), sequence: Number.MAX_SAFE_INTEGER }
    const version = `9999.9999.999999-${"x".repeat(64)}`
    const answers = [
      { staged: KEY },
      refused("low_disk", {
        ...most,
        disk: { free: Number.MAX_SAFE_INTEGER, floor: Number.MAX_SAFE_INTEGER },
      }),
      refused("docker_too_old", {
        ...most,
        docker: { engine: version, buildx: version },
      }),
      refused("unsupported_version", most),
    ]
    for (const answer of answers)
      expect([answer, reads(RunnerPackSchema, answer)]).toEqual([answer, true])
    const longest = Math.max(...answers.map((result) => written({ result })))
    expect(longest * 1.5).toBeLessThan(SESSION_FRAME_BYTES.pack)
  })
})
