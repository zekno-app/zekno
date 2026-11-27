/**
 * The request `builder` of protocol 6 (specs/016-build-from-source,
 * contracts/core.md CO12; FR-034a, FR-078, FR-079, item 28): what the server
 * can build with, its Docker versions and driver, its processor, memory and
 * disk, the refs whose Docker record could not be removed, and, only when
 * asked, what images and the build cache take. Versions and numbers only,
 * every field held to a pattern or a list, within a frame of 16 KiB.
 */
import { describe, expect, test } from "bun:test"

import { ARCHES } from "../../src/deploy/build-record"
import {
  RunnerBuilderRequestSchema,
  RunnerBuilderSchema,
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

const GiB = 1024 * 1024 * 1024

/** The answer of a server that can build. */
const answer = (fields: Record<string, unknown> = {}) => ({
  docker: {
    engine: "27.3.1",
    buildx: "0.17.1",
    buildkit: "0.16.0",
    driver: "docker",
  },
  arch: "amd64",
  memory: 4 * GiB,
  disk: { free: 40 * GiB, floor: LIMITS.diskFloorBytes },
  can: "yes",
  stale: 0,
  ...fields,
})

const docker = (fields: Record<string, unknown>) => ({
  docker: { ...answer().docker, ...fields },
})

describe("the command builder", () => {
  test("is a command of a session, with an answer frame of 16 KiB", () => {
    expect(SESSION_COMMANDS).toContain("builder")
    expect(reads(SessionRequestSchema, { command: "builder" })).toBe(true)
    expect(SESSION_FRAME_BYTES.builder).toBe(16 * 1024)
  })
})

describe("the request", () => {
  test("strict: no input, or { usage: true }", () => {
    for (const request of [{}, { usage: true }])
      expect([request, reads(RunnerBuilderRequestSchema, request)]).toEqual([
        request,
        true,
      ])
    for (const request of [
      { usage: false },
      { usage: "true" },
      { usage: 1 },
      { usage: null },
      { usage: true, apps: ["shop"] },
      { cache: true },
      null,
      [],
    ])
      expect([request, reads(RunnerBuilderRequestSchema, request)]).toEqual([
        request,
        false,
      ])
  })
})

describe("the answer", () => {
  test("reads in full, and for a server with no Docker", () => {
    expect(reads(RunnerBuilderSchema, answer())).toBe(true)
    expect(
      reads(
        RunnerBuilderSchema,
        answer({
          docker: { engine: null, buildx: null, buildkit: null, driver: null },
          memory: null,
          disk: { free: null, floor: LIMITS.diskFloorBytes },
          can: "no_docker",
        })
      )
    ).toBe(true)
  })

  test("docker: engine, buildx and BuildKit each a version or null; the driver a name or null", () => {
    for (const field of ["engine", "buildx", "buildkit"]) {
      for (const value of [null, "27.3.1", "0.17.1-desktop.1", "1.2.3+azure-1"])
        expect([
          field,
          value,
          reads(RunnerBuilderSchema, answer(docker({ [field]: value }))),
        ]).toEqual([field, value, true])
      for (const value of ["v27.3.1", "27.3", "", "27.3.1 (build)", 27])
        expect([
          field,
          value,
          reads(RunnerBuilderSchema, answer(docker({ [field]: value }))),
        ]).toEqual([field, value, false])
    }
    for (const driver of [
      null,
      "docker",
      "docker-container",
      "remote",
      `d${"a".repeat(31)}`,
    ])
      expect(reads(RunnerBuilderSchema, answer(docker({ driver })))).toBe(true)
    for (const driver of [
      "",
      "Docker",
      "1docker",
      "-docker",
      "docker_container",
      "docker container",
      `d${"a".repeat(32)}`,
    ])
      expect([
        driver,
        reads(RunnerBuilderSchema, answer(docker({ driver }))),
      ]).toEqual([driver, false])
    const { driver: _driver, ...noDriver } = answer().docker
    for (const wrong of [
      { docker: noDriver },
      docker({ name: "default" }),
      { docker: null },
    ])
      expect(reads(RunnerBuilderSchema, answer(wrong))).toBe(false)
  })

  test("arch from the list, memory in bytes or null", () => {
    for (const arch of ARCHES)
      expect(reads(RunnerBuilderSchema, answer({ arch }))).toBe(true)
    for (const arch of ["x86_64", "aarch64", "", null])
      expect(reads(RunnerBuilderSchema, answer({ arch }))).toBe(false)
    for (const memory of [null, 0, Number.MAX_SAFE_INTEGER])
      expect(reads(RunnerBuilderSchema, answer({ memory }))).toBe(true)
    for (const memory of [-1, 1.5, "4G", Number.MAX_SAFE_INTEGER + 2])
      expect([memory, reads(RunnerBuilderSchema, answer({ memory }))]).toEqual([
        memory,
        false,
      ])
  })

  test("disk: the free bytes or null, and the floor", () => {
    for (const disk of [
      { free: 0, floor: 0 },
      { free: null, floor: LIMITS.diskFloorBytes },
      { free: Number.MAX_SAFE_INTEGER, floor: Number.MAX_SAFE_INTEGER },
    ])
      expect(reads(RunnerBuilderSchema, answer({ disk }))).toBe(true)
    for (const disk of [
      { free: -1, floor: 0 },
      { free: 0, floor: null },
      { free: 0 },
      { free: 0, floor: 0, used: 1 },
      { free: 1.5, floor: 0 },
      null,
    ])
      expect([disk, reads(RunnerBuilderSchema, answer({ disk }))]).toEqual([
        disk,
        false,
      ])
  })

  test("can: yes, no_docker, docker_too_old or no_build_plugin; stale a whole number from 0", () => {
    for (const can of ["yes", "no_docker", "docker_too_old", "no_build_plugin"])
      expect(reads(RunnerBuilderSchema, answer({ can }))).toBe(true)
    for (const can of ["no", "low_disk", "docker_unchecked", true, null])
      expect([can, reads(RunnerBuilderSchema, answer({ can }))]).toEqual([
        can,
        false,
      ])
    for (const stale of [0, 3, Number.MAX_SAFE_INTEGER])
      expect(reads(RunnerBuilderSchema, answer({ stale }))).toBe(true)
    for (const stale of [-1, 1.5, "0", null])
      expect([stale, reads(RunnerBuilderSchema, answer({ stale }))]).toEqual([
        stale,
        false,
      ])
  })

  test("usage only as images and cache in bytes, or null", () => {
    for (const usage of [
      null,
      { images: 0, cache: 0 },
      { images: 3 * GiB, cache: 10 * GiB },
    ])
      expect(reads(RunnerBuilderSchema, answer({ usage }))).toBe(true)
    for (const usage of [
      { images: -1, cache: 0 },
      { images: 0 },
      { images: 0, cache: 0, volumes: 0 },
      { images: "3G", cache: 0 },
      true,
    ])
      expect([usage, reads(RunnerBuilderSchema, answer({ usage }))]).toEqual([
        usage,
        false,
      ])
  })

  test("strict: a field added, or one left out, is refused", () => {
    for (const field of Object.keys(answer())) {
      const without: Record<string, unknown> = { ...answer() }
      delete without[field]
      expect([field, reads(RunnerBuilderSchema, without)]).toEqual([
        field,
        false,
      ])
    }
    for (const wrong of [
      answer({ version: "0.1.2" }),
      answer({ images: [] }),
      answer({ line: "ERROR: no builder" }),
      { outcome: "ok" },
    ])
      expect(reads(RunnerBuilderSchema, wrong)).toBe(false)
  })

  test("the longest answer, times 1.5, fits 16 KiB", () => {
    const version = `9999.9999.999999-${"x".repeat(64)}`
    const longest = {
      docker: {
        engine: version,
        buildx: version,
        buildkit: version,
        driver: `d${"a".repeat(31)}`,
      },
      arch: "amd64",
      memory: Number.MAX_SAFE_INTEGER,
      disk: { free: Number.MAX_SAFE_INTEGER, floor: Number.MAX_SAFE_INTEGER },
      can: "no_build_plugin",
      stale: Number.MAX_SAFE_INTEGER,
      usage: {
        images: Number.MAX_SAFE_INTEGER,
        cache: Number.MAX_SAFE_INTEGER,
      },
    }
    expect(reads(RunnerBuilderSchema, longest)).toBe(true)
    expect(written({ result: longest }) * 1.5).toBeLessThan(
      SESSION_FRAME_BYTES.builder
    )
  })
})
