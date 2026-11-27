/**
 * The request `builds` of protocol 6 (specs/016-build-from-source,
 * contracts/core.md CO12; FR-021a, FR-045, FR-064, FR-066, FR-080): with no
 * input, the apps that have builds; with apps, what the runner keeps of each,
 * at most 8 apps a request so the answer fits its 1 MiB frame (CO19). That
 * the answer names exactly the apps asked is the CLI's check.
 */
import { describe, expect, test } from "bun:test"

import { BUILD_REASONS } from "../../src/deploy/build-record"
import {
  AppBuildsAnswerSchema,
  RunnerBuildsRequestSchema,
  RunnerBuildsSchema,
} from "../../src/protocol/build-messages"
import { LIMITS } from "../../src/protocol/limits"
import { parseMessage } from "../../src/protocol/protocol"
import {
  SESSION_COMMANDS,
  SESSION_FRAME_BYTES,
  SessionRequestSchema,
} from "../../src/protocol/session"

const reads = (schema: Parameters<typeof parseMessage>[0], value: unknown) =>
  parseMessage(schema, value).ok

/** Bytes of a value written out as one JSON line. */
const written = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length

const hex = (n: number) => n.toString(16).padStart(64, "0")
const digest = (n: number) => `sha256:${hex(n)}`
const keys = (count: number, from = 1) =>
  Array.from({ length: count }, (_, n) => hex(from + n))
const apps = (count: number) =>
  Array.from({ length: count }, (_, n) => `app-${String(n).padStart(4, "0")}`)

/** A base image by digest of exactly `length` characters, the `n`th in order. */
const base = (n: number, length = 255) => {
  const host = "r.example.com/"
  const tail = `@sha256:${hex(n)}`
  return `${host}${`b${String(n).padStart(2, "0")}`.padEnd(length - host.length - tail.length, "x")}${tail}`
}

/** A build record (CO14) with key `n`. */
const record = (n: number, bases = [base(0)]) => ({
  key: hex(n),
  manifest: digest(n + 100),
  config: digest(n + 200),
  builder: "dockerfile",
  railpack: null,
  docker: { engine: "27.3.1", buildx: "0.17.1", buildkit: "0.16.0" },
  reader: { kind: "dockerfile", version: "1.12.0" },
  cache: false,
  bases,
  arch: "amd64",
  built: "2026-11-27T10:00:00.000Z",
})

const AT = "2026-11-27T10:05:00.000Z"

/** What the runner keeps of one app. */
const answer = (fields: Record<string, unknown> = {}) => ({
  running: 7,
  deploys: [
    { sequence: 7, keys: keys(2) },
    { sequence: 5, keys: keys(1) },
  ],
  fresh: [{ base: hex(50), sequence: 7 }],
  records: [record(1), record(2)],
  last: { sequence: 7, outcome: "built", reason: null, at: AT },
  building: null,
  ...fields,
})

describe("the command builds", () => {
  test(`is a command of a session, with an answer frame of 1 MiB and at most ${LIMITS.buildsAppsPerRequest} apps a request`, () => {
    expect(SESSION_COMMANDS).toContain("builds")
    expect(reads(SessionRequestSchema, { command: "builds" })).toBe(true)
    expect(
      reads(SessionRequestSchema, {
        command: "builds",
        input: { apps: ["shop"] },
      })
    ).toBe(true)
    expect(SESSION_FRAME_BYTES.builds).toBe(1024 * 1024)
    expect(LIMITS.buildsAppsPerRequest).toBe(8)
  })
})

describe("the request", () => {
  test("no input, or 1 to 8 apps sorted and each once", () => {
    for (const request of [
      {},
      { apps: ["shop"] },
      { apps: ["blog", "shop"] },
      { apps: apps(8) },
      { apps: ["a".repeat(63)] },
    ])
      expect([request, reads(RunnerBuildsRequestSchema, request)]).toEqual([
        request,
        true,
      ])
    for (const request of [
      { apps: [] },
      { apps: apps(9) },
      { apps: ["shop", "blog"] },
      { apps: ["shop", "shop"] },
      { apps: ["Shop"] },
      { apps: ["../etc"] },
      { apps: "shop" },
      { apps: ["shop"], more: true },
      { app: "shop" },
      { routes: true },
      null,
      [],
    ])
      expect([request, reads(RunnerBuildsRequestSchema, request)]).toEqual([
        request,
        false,
      ])
  })

  test("check: 1 to 8 keys each once, and only with exactly one app", () => {
    for (const check of [keys(1), keys(8), [hex(9), hex(1)]])
      expect(reads(RunnerBuildsRequestSchema, { apps: ["shop"], check })).toBe(
        true
      )
    for (const request of [
      { apps: ["shop"], check: [] },
      { apps: ["shop"], check: keys(9) },
      { apps: ["shop"], check: [hex(1), hex(1)] },
      { apps: ["shop"], check: ["a".repeat(63)] },
      { apps: ["shop"], check: ["A".repeat(64)] },
      { apps: ["shop"], check: hex(1) },
      { apps: ["blog", "shop"], check: keys(1) },
      { check: keys(1) },
    ])
      expect([request, reads(RunnerBuildsRequestSchema, request)]).toEqual([
        request,
        false,
      ])
  })
})

describe("what the runner keeps of one app", () => {
  test("reads in full, and with nothing kept", () => {
    expect(reads(AppBuildsAnswerSchema, answer())).toBe(true)
    expect(
      reads(AppBuildsAnswerSchema, {
        running: null,
        deploys: [],
        fresh: [],
        records: [],
        last: null,
        building: null,
      })
    ).toBe(true)
    const { last: _last, ...noLast } = answer()
    const { building: _building, ...noBuilding } = answer()
    for (const wrong of [noLast, noBuilding, { ...answer(), extra: 1 }])
      expect(reads(AppBuildsAnswerSchema, wrong)).toBe(false)
  })

  test("running: null or a deploy number from 1", () => {
    for (const running of [null, 1, Number.MAX_SAFE_INTEGER])
      expect(reads(AppBuildsAnswerSchema, answer({ running }))).toBe(true)
    for (const running of [0, -1, 1.5, "7", Number.MAX_SAFE_INTEGER + 2])
      expect([
        running,
        reads(AppBuildsAnswerSchema, answer({ running })),
      ]).toEqual([running, false])
  })

  test(`deploys: at most ${LIMITS.keptDeploysPerApp}, newest first, keys 1 to 8 sorted and each once`, () => {
    const deploy = (sequence: number, keyList = keys(1)) => ({
      sequence,
      keys: keyList,
    })
    for (const deploys of [
      [deploy(9), deploy(7), deploy(3)],
      [deploy(1, keys(8))],
      [deploy(9, keys(2)), deploy(8, keys(2))],
    ])
      expect(reads(AppBuildsAnswerSchema, answer({ deploys }))).toBe(true)
    for (const deploys of [
      [deploy(9), deploy(7), deploy(3), deploy(1)],
      [deploy(3), deploy(7)],
      [deploy(7), deploy(7)],
      [deploy(0)],
      [deploy(1, [])],
      [deploy(1, keys(9))],
      [deploy(1, [hex(2), hex(1)])],
      [deploy(1, [hex(1), hex(1)])],
      [{ ...deploy(1), outcome: "built" }],
    ])
      expect([
        deploys,
        reads(AppBuildsAnswerSchema, answer({ deploys })),
      ]).toEqual([deploys, false])
  })

  test(`fresh: at most ${LIMITS.freshPerApp}, sorted by base, each base once`, () => {
    const fresh = (count: number) =>
      keys(count).map((key, n) => ({ base: key, sequence: n + 1 }))
    expect(reads(AppBuildsAnswerSchema, answer({ fresh: fresh(24) }))).toBe(
      true
    )
    for (const wrong of [
      fresh(25),
      fresh(2).reverse(),
      [...fresh(1), ...fresh(1)],
      [{ base: hex(1), sequence: 0 }],
      [{ base: "x", sequence: 1 }],
      [{ base: hex(1), sequence: 1, key: hex(2) }],
    ])
      expect([
        wrong,
        reads(AppBuildsAnswerSchema, answer({ fresh: wrong })),
      ]).toEqual([wrong, false])
  })

  test("records: at most 8 build records, sorted by key, each once", () => {
    const records = (count: number) =>
      Array.from({ length: count }, (_, n) => record(n + 1))
    expect(reads(AppBuildsAnswerSchema, answer({ records: records(8) }))).toBe(
      true
    )
    for (const wrong of [
      records(9),
      records(2).reverse(),
      [record(1), record(1)],
      [{ ...record(1), builder: "railpack" }],
      [{ ...record(1), line: "#5 DONE" }],
      [{ ...record(1), bases: [base(0, 256)] }],
    ])
      expect(reads(AppBuildsAnswerSchema, answer({ records: wrong }))).toBe(
        false
      )
  })

  test("last: null, or a number, an outcome, a reason from the list or null, and a time", () => {
    const last = (fields: Record<string, unknown>) => ({
      sequence: 7,
      outcome: "build_failed",
      reason: "step_failed",
      at: AT,
      ...fields,
    })
    for (const value of [
      null,
      last({ outcome: "built", reason: null }),
      last({ outcome: "reused", reason: null }),
      ...BUILD_REASONS.map((reason) => last({ reason })),
    ])
      expect([
        value,
        reads(AppBuildsAnswerSchema, answer({ last: value })),
      ]).toEqual([value, true])
    expect(BUILD_REASONS).toContain("runner_restarted")
    for (const value of [
      last({ outcome: "started" }),
      last({ reason: "exit code 1" }),
      last({ sequence: 0 }),
      last({ at: "yesterday" }),
      last({ line: "RUN npm ci" }),
      { sequence: 7, outcome: "built", at: AT },
    ])
      expect([
        value,
        reads(AppBuildsAnswerSchema, answer({ last: value })),
      ]).toEqual([value, false])
  })

  test("building: null, or a number, the seconds, a limit from 1 to 57,600 and a phase", () => {
    const building = (fields: Record<string, unknown>) => ({
      sequence: 8,
      seconds: 75,
      limit: 1800,
      phase: "building",
      ...fields,
    })
    for (const value of [
      null,
      building({}),
      building({ phase: "stopping" }),
      building({ phase: "starting" }),
      building({ seconds: 0, limit: 1 }),
      building({ limit: 57_600 }),
    ])
      expect(reads(AppBuildsAnswerSchema, answer({ building: value }))).toBe(
        true
      )
    for (const value of [
      building({ limit: 57_601 }),
      building({ limit: 0 }),
      building({ seconds: -1 }),
      building({ sequence: 0 }),
      building({ phase: "waiting" }),
      building({ app: "shop" }),
      building({ run: "a".repeat(32) }),
    ])
      expect([
        value,
        reads(AppBuildsAnswerSchema, answer({ building: value })),
      ]).toEqual([value, false])
  })

  test("check: only a record of key to kept, gone or changed, at most 8", () => {
    const check = (count: number) =>
      Object.fromEntries(
        keys(count).map((key, n) => [key, ["kept", "gone", "changed"][n % 3]])
      )
    for (const value of [check(1), check(8)])
      expect(reads(AppBuildsAnswerSchema, answer({ check: value }))).toBe(true)
    for (const value of [
      check(9),
      { [hex(1)]: "missing" },
      { ["a".repeat(63)]: "kept" },
      { ["A".repeat(64)]: "kept" },
      [hex(1)],
      null,
    ])
      expect([
        value,
        reads(AppBuildsAnswerSchema, answer({ check: value })),
      ]).toEqual([value, false])
  })
})

describe("the answer", () => {
  test(`with no input: the apps that have builds, sorted, each once, at most ${LIMITS.appsPerServer}`, () => {
    for (const built of [[], ["shop"], ["blog", "shop"], apps(1024)])
      expect(reads(RunnerBuildsSchema, { built })).toBe(true)
    for (const built of [
      apps(1025),
      ["shop", "blog"],
      ["shop", "shop"],
      ["Shop"],
      "shop",
    ])
      expect([built, reads(RunnerBuildsSchema, { built })]).toEqual([
        built,
        false,
      ])
  })

  test("with apps: 1 to 8 apps by name, each what the runner keeps", () => {
    const by = (names: string[]) =>
      Object.fromEntries(names.map((name) => [name, answer()]))
    for (const value of [by(["shop"]), by(apps(8))])
      expect(reads(RunnerBuildsSchema, { apps: value })).toBe(true)
    for (const wrong of [
      { apps: {} },
      { apps: by(apps(9)) },
      { apps: { Shop: answer() } },
      { apps: { shop: { ...answer(), extra: 1 } } },
      { apps: by(["shop"]), built: ["shop"] },
      { built: ["shop"], extra: 1 },
      {},
      { outcome: "ok" },
    ])
      expect([wrong, reads(RunnerBuildsSchema, wrong)]).toEqual([wrong, false])
  })

  test("the longest answer for 8 apps, and the longest with no input, times 1.5, fit 1 MiB (CO12, CO19)", () => {
    // Each app: 8 records of 16 bases of 255 characters, 3 deploys of 8
    // keys, 24 fresh entries, a check of 8 keys, and the longest last and
    // building.
    const version = `9999.9999.999999-${"x".repeat(64)}`
    const fullest = {
      running: Number.MAX_SAFE_INTEGER,
      deploys: [3, 2, 1].map((n) => ({
        sequence: Number.MAX_SAFE_INTEGER - (3 - n),
        keys: keys(8, n * 100),
      })),
      fresh: keys(24, 1000).map((key) => ({
        base: key,
        sequence: Number.MAX_SAFE_INTEGER,
      })),
      records: Array.from({ length: 8 }, (_, n) => ({
        ...record(
          n + 1,
          Array.from({ length: LIMITS.baseDigestsPerBuild }, (_, b) => base(b))
        ),
        docker: { engine: version, buildx: version, buildkit: version },
        reader: { kind: "dockerfile", version },
        cache: true,
        built: "2026-11-27T10:00:00.000Z",
      })),
      last: {
        sequence: Number.MAX_SAFE_INTEGER,
        outcome: "build_failed",
        reason: "runner_restarted",
        at: "2026-11-27T10:00:00.000Z",
      },
      building: {
        sequence: Number.MAX_SAFE_INTEGER,
        seconds: Number.MAX_SAFE_INTEGER,
        limit: 57_600,
        phase: "starting",
      },
      check: Object.fromEntries(keys(8).map((key) => [key, "changed"])),
    }
    expect(base(0)).toHaveLength(255)
    expect(reads(AppBuildsAnswerSchema, fullest)).toBe(true)
    const names = Array.from({ length: 8 }, (_, n) => `a${n}`.padEnd(63, "x"))
    const most = {
      apps: Object.fromEntries(names.map((name) => [name, fullest])),
    }
    expect(reads(RunnerBuildsSchema, most)).toBe(true)
    // About 42 KB an app, about 0.34 MB for 8.
    expect(written(fullest)).toBeGreaterThan(40 * 1000)
    expect(written({ result: most }) * 1.5).toBeLessThan(
      SESSION_FRAME_BYTES.builds
    )
    const built = {
      built: Array.from({ length: LIMITS.appsPerServer }, (_, n) =>
        `a${String(n).padStart(4, "0")}`.padEnd(63, "x")
      ),
    }
    expect(reads(RunnerBuildsSchema, built)).toBe(true)
    expect(written({ result: built }) * 1.5).toBeLessThan(
      SESSION_FRAME_BYTES.builds
    )
  })
})
