/**
 * A runner's report in protocol 6 (specs/016-build-from-source,
 * contracts/core.md CO10): the refusals of building from source and the
 * fields that carry their values (`missing`, `disk`, `docker`, `building`),
 * and the outcome `build_failed` with its `build`. Each field comes only with
 * its outcome or reason, and none is free text.
 */
import { describe, expect, test } from "bun:test"

import { ARCHES, BUILD_REASONS } from "../../src/deploy/build-record"
import {
  parseMessage,
  RUNNER_OUTCOMES,
  RUNNER_REFUSALS,
  RunnerReportSchema,
} from "../../src/protocol/protocol"
import { DEPLOY_V2_REFUSALS } from "../../src/protocol/result"

const reads = (report: unknown) => parseMessage(RunnerReportSchema, report).ok

const hex = (index: number) => index.toString(16).padStart(64, "0")
const pieces = (count: number) =>
  Array.from({ length: count }, (_, index) => hex(index + 1))
const images = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    key: hex(index + 1),
    state: index % 2 === 0 ? "gone" : "changed",
  }))

const refused = (reason: string, fields: Record<string, unknown> = {}) => ({
  outcome: "refused",
  reason,
  ...fields,
})

const MISSING = { pieces: pieces(2), images: images(1) }
const DISK = { free: 1_000_000, floor: 2 * 1024 * 1024 * 1024 }
const DOCKER = { engine: "20.10.24", buildx: null }
const BUILDING = { app: "shop", seconds: 75, limit: 1800, phase: "building" }

/** One field and the reason it comes with. */
const FIELDS = [
  ["missing", MISSING, "pack_missing"],
  ["disk", DISK, "low_disk"],
  ["docker", DOCKER, "docker_too_old"],
] as const

const KEY = hex(0xabc)

/** A `build_failed` report, with the fields its reason needs. */
const failed = (reason: string, build: Record<string, unknown> = {}) => ({
  outcome: "build_failed",
  app: "shop",
  sequence: 7,
  build: {
    key: KEY,
    reason,
    ...(reason === "wrong_processor"
      ? { arch: { image: "amd64", server: "arm64" } }
      : {}),
    ...(reason === "team_changed" ? { team: { version: 3 } } : {}),
    ...build,
  },
})

describe("the refusals of building from source (T045)", () => {
  test("pack_missing and pack_mismatch join version 2's; low_disk, docker_too_old and no_build_plugin the runner's", () => {
    expect(DEPLOY_V2_REFUSALS.slice(-2)).toEqual([
      "pack_missing",
      "pack_mismatch",
    ])
    expect(RUNNER_REFUSALS).toEqual([
      "invalid_request",
      "invalid_state",
      "not_set_up",
      "already_set_up",
      "busy",
      "low_disk",
      "docker_too_old",
      "no_build_plugin",
    ])
  })

  test("each field with its reason reads", () => {
    for (const report of [
      refused("pack_missing", { missing: MISSING }),
      refused("pack_missing", {
        missing: { pieces: pieces(1), images: [] },
      }),
      refused("pack_missing", {
        missing: { pieces: [], images: images(2) },
      }),
      refused("low_disk", { disk: DISK }),
      refused("low_disk", { disk: { free: 0, floor: 0 } }),
      refused("docker_too_old", { docker: DOCKER }),
      refused("docker_too_old", {
        docker: { engine: "27.3.1", buildx: "0.10.4-desktop.1" },
      }),
      refused("busy", { building: BUILDING }),
      refused("busy", {
        building: { ...BUILDING, phase: "stopping", seconds: 0 },
      }),
      refused("busy", { building: { ...BUILDING, phase: "starting" } }),
      refused("pack_mismatch"),
      refused("no_build_plugin"),
    ])
      expect([report, reads(report)]).toEqual([report, true])
  })

  test("a busy without building still reads, as today", () => {
    expect(reads(refused("busy"))).toBe(true)
  })

  test("each field's reason without the field is refused", () => {
    for (const reason of ["pack_missing", "low_disk", "docker_too_old"])
      expect([reason, reads(refused(reason))]).toEqual([reason, false])
  })

  test("each field with another reason, or with no refusal, is refused", () => {
    const wrong: unknown[] = []
    const others = [
      "busy",
      "pack_mismatch",
      "no_build_plugin",
      "invalid_request",
      "malformed",
      "expired",
      ...FIELDS.map(([, , reason]) => reason),
    ]
    for (const [name, value, own] of FIELDS) {
      for (const reason of others) {
        if (reason === own) continue
        const report = refused(reason, { [name]: value })
        if (reads(report)) wrong.push(report)
      }
      for (const outcome of RUNNER_OUTCOMES) {
        if (outcome === "refused") continue
        const report = { outcome, app: "shop", sequence: 7, [name]: value }
        if (reads(report)) wrong.push(report)
      }
    }
    for (const reason of others) {
      if (reason === "busy") continue
      const report = refused(reason, { building: BUILDING })
      if (reads(report)) wrong.push(report)
    }
    for (const outcome of RUNNER_OUTCOMES) {
      if (outcome === "refused") continue
      const report = { outcome, building: BUILDING }
      if (reads(report)) wrong.push(report)
    }
    expect(wrong).toEqual([])
  })

  test("missing: 72 pieces read, 73 do not; sorted and each once; 8 images, not 9", () => {
    const missing = (value: Record<string, unknown>) =>
      reads(refused("pack_missing", { missing: { ...MISSING, ...value } }))
    expect(missing({ pieces: pieces(72) })).toBe(true)
    expect(missing({ pieces: pieces(73) })).toBe(false)
    expect(missing({ pieces: pieces(3).reverse() })).toBe(false)
    expect(missing({ pieces: [hex(1), hex(1)] })).toBe(false)
    expect(missing({ pieces: ["A".repeat(64)] })).toBe(false)
    expect(missing({ pieces: ["a".repeat(63)] })).toBe(false)
    expect(missing({ images: images(8) })).toBe(true)
    expect(missing({ images: images(9) })).toBe(false)
    expect(missing({ images: images(3).reverse() })).toBe(false)
    expect(missing({ images: [images(1)[0], images(1)[0]] })).toBe(false)
    expect(missing({ images: [{ key: hex(1), state: "lost" }] })).toBe(false)
    expect(missing({ images: [{ key: hex(1) }] })).toBe(false)
    expect(
      missing({ images: [{ key: hex(1), state: "gone", tag: "x" }] })
    ).toBe(false)
    expect(
      reads(refused("pack_missing", { missing: { pieces: pieces(1) } }))
    ).toBe(false)
    expect(
      reads(
        refused("pack_missing", {
          missing: { ...MISSING, note: "piece 3 lost" },
        })
      )
    ).toBe(false)
  })

  test("disk: whole numbers of bytes from 0", () => {
    for (const disk of [
      { free: -1, floor: 0 },
      { free: 0, floor: -1 },
      { free: 1.5, floor: 0 },
      { free: "10", floor: 0 },
      { free: null, floor: 0 },
      { free: 0 },
      { free: 0, floor: 0, path: "/var" },
    ])
      expect([disk, reads(refused("low_disk", { disk }))]).toEqual([
        disk,
        false,
      ])
  })

  test("docker: the engine by its version pattern, buildx by it or null", () => {
    for (const docker of [
      { engine: "v20.10.24", buildx: null },
      { engine: "20.10", buildx: null },
      { engine: null, buildx: null },
      { engine: "20.10.24", buildx: "latest" },
      { engine: "20.10.24", buildx: "v0.10.0" },
      { engine: "20.10.24" },
      { engine: "20.10.24", buildx: null, buildkit: "0.12.0" },
    ])
      expect([docker, reads(refused("docker_too_old", { docker }))]).toEqual([
        docker,
        false,
      ])
  })

  test("building: an app, seconds from 0, a limit of 1 to 57,600, a phase of the list", () => {
    const building = (value: Record<string, unknown>) =>
      reads(refused("busy", { building: { ...BUILDING, ...value } }))
    expect(building({ limit: 57_600 })).toBe(true)
    expect(building({ limit: 1 })).toBe(true)
    expect(building({ limit: 57_601 })).toBe(false)
    expect(building({ limit: 0 })).toBe(false)
    expect(building({ seconds: -1 })).toBe(false)
    expect(building({ seconds: 1.5 })).toBe(false)
    expect(building({ phase: "waiting" })).toBe(false)
    expect(building({ phase: "Building" })).toBe(false)
    expect(building({ app: "Shop" })).toBe(false)
    expect(building({ sequence: 7 })).toBe(false)
    const { phase: _, ...withoutPhase } = BUILDING
    expect(reads(refused("busy", { building: withoutPhase }))).toBe(false)
  })
})

describe("the outcome build_failed (T046)", () => {
  test("build_failed joins the outcomes, after today's", () => {
    expect(RUNNER_OUTCOMES).toEqual([
      "ok",
      "started",
      "start_failed",
      "refused",
      "routes_failed",
      "unhealthy",
      "build_failed",
    ])
  })

  test("one report for each reason reads", () => {
    for (const reason of BUILD_REASONS) {
      if (reason === "runner_restarted") continue
      const report = failed(reason)
      expect([report, reads(report)]).toEqual([report, true])
    }
  })

  test("runner_restarted is never in a report", () => {
    expect(reads(failed("runner_restarted"))).toBe(false)
    expect(reads(failed("killed"))).toBe(false)
  })

  test("arch exactly with wrong_processor, each from the list", () => {
    expect(reads(failed("wrong_processor", { arch: undefined }))).toBe(false)
    for (const image of ARCHES)
      for (const server of ARCHES)
        expect(
          reads(failed("wrong_processor", { arch: { image, server } }))
        ).toBe(true)
    for (const arch of [
      { image: "x86_64", server: "arm64" },
      { image: "amd64" },
      { image: "amd64", server: "arm64", variant: "v8" },
    ])
      expect(reads(failed("wrong_processor", { arch }))).toBe(false)
    for (const reason of BUILD_REASONS) {
      if (reason === "wrong_processor") continue
      expect([
        reason,
        reads(failed(reason, { arch: { image: "amd64", server: "arm64" } })),
      ]).toEqual([reason, false])
    }
  })

  test("team exactly with team_changed, a version from 1", () => {
    expect(reads(failed("team_changed", { team: undefined }))).toBe(false)
    expect(reads(failed("team_changed", { team: { version: 1 } }))).toBe(true)
    for (const team of [
      { version: 0 },
      { version: 1.5 },
      { version: "3" },
      {},
      { version: 3, member: "ann" },
    ])
      expect(reads(failed("team_changed", { team }))).toBe(false)
    for (const reason of BUILD_REASONS) {
      if (reason === "team_changed") continue
      expect([reason, reads(failed(reason, { team: { version: 3 } }))]).toEqual(
        [reason, false]
      )
    }
  })

  test("build exactly with build_failed, which carries app and sequence", () => {
    const { build } = failed("step_failed")
    for (const outcome of RUNNER_OUTCOMES) {
      if (outcome === "build_failed") continue
      const report = {
        outcome,
        app: "shop",
        sequence: 7,
        build,
        ...(outcome === "refused" ? { reason: "busy" } : {}),
        ...(outcome === "routes_failed"
          ? { routes: { failure: "not_loaded" } }
          : {}),
        ...(outcome === "unhealthy"
          ? { health: { service: "web", http: true } }
          : {}),
      }
      expect([outcome, reads(report)]).toEqual([outcome, false])
      const { build: _, ...without } = report
      expect([outcome, reads(without)]).toEqual([outcome, true])
    }
    const { app: _app, ...withoutApp } = failed("step_failed")
    const { sequence: _sequence, ...withoutSequence } = failed("step_failed")
    const { build: _build, ...withoutBuild } = failed("step_failed")
    expect(reads(withoutApp)).toBe(false)
    expect(reads(withoutSequence)).toBe(false)
    expect(reads(withoutBuild)).toBe(false)
    expect(reads({ ...failed("step_failed"), reason: "busy" })).toBe(false)
  })

  test("refused with a build is refused", () => {
    const { build } = failed("time_limit")
    expect(reads({ ...refused("busy"), build })).toBe(false)
    expect(reads({ ...refused("pack_mismatch"), build })).toBe(false)
  })

  test("still no free text: the build holds a key and a reason, nothing else", () => {
    for (const report of [
      failed("step_failed", { key: "1".repeat(63) }),
      failed("step_failed", { key: KEY.toUpperCase() }),
      failed("step_failed", { step: "RUN npm ci" }),
      failed("step_failed", { error: "exit code 1" }),
      failed("out_of_memory", { reason: "out of memory" }),
      { ...failed("step_failed"), log: "npm ERR!" },
    ])
      expect([report, reads(report)]).toEqual([report, false])
  })
})
