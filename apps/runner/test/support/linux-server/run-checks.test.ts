/**
 * `run-checks.ts` (specs/016-build-from-source, T009), branch by branch:
 * its arguments, the leg it chooses, the files it runs in each package with
 * the variables set, the skip lines of what is still to write, and the
 * stand-in it refuses. No test here starts bun or Docker: `bun test` is a
 * recorded call.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Check, type CheckId } from "./jobs/modes"
import { makeRunFolder, writeState, type RunState } from "./stand-in/run-folder"
import { main, planChecks, readArgs, type RunDeps } from "./run-checks"

const ROOT = join(import.meta.dir, "../../../../..")
const STAND_IN = "zekno-check-a1b2c3d4-server"

/**
 * modes.ts as it stood at the start of phase 0: every check named by the
 * task that writes it. Fixed here, so these tests do not change each time a
 * task puts its file in modes.ts.
 */
const AT_START: Readonly<Record<CheckId, Check>> = {
  L1: { mode: "record", at: "T021" },
  L2: { mode: "record", at: "T011" },
  L3: { mode: "record", at: "T012" },
  L4: { mode: "record", at: "T012" },
  L4b: { mode: "record", at: "T012" },
  L5: { mode: "record", at: "T013" },
  L6: { mode: "record", at: "T014" },
  L7: { mode: "record", at: "T014" },
  L8: { mode: "record", at: "T015" },
  L9: { mode: "record", at: "T016" },
  L10: { mode: "record", at: "T016" },
  L11: { mode: "record", at: "T165" },
  L12: { mode: "record", at: "T018" },
  L13: { mode: "record", at: "T018" },
  L14: { mode: "record", at: "T018" },
  L15: { mode: "record", at: "T017" },
  L16: { mode: "record", at: "T018" },
  L17: { mode: "record", at: "T019" },
  L18: { mode: "assert", at: "T020" },
  R1: { mode: "record", at: "T219" },
  R2: { mode: "record", at: "T217" },
  R3: { mode: "record", at: "T217" },
  R4: { mode: "record", at: "T220" },
  R5: { mode: "record", at: "T219" },
  R6: { mode: "record", at: "T214" },
  R7: { mode: "record", at: "T220" },
  R8: { mode: "record", at: "T220" },
  R9: { mode: "record", at: "T220" },
  R10: { mode: "record", at: "T220" },
  R16: { mode: "record", at: "T218" },
  B1: { mode: "record", parts: { Dockerfile: "T173", Railpack: "T247" } },
  B2: { mode: "record", at: "T166" },
  B3: { mode: "record", parts: { fingerprint: "T166", Railpack: "T247" } },
  B4: { mode: "record", parts: { proof: "T168", ARM64: "T173" } },
  B5: { mode: "record", at: "T171" },
  B6: { mode: "record", at: "T174" },
}

/** That table with some checks written, as later tasks write them. */
const WRITTEN: Readonly<Record<CheckId, Check>> = {
  ...AT_START,
  L2: {
    mode: "record",
    at: "apps/runner/test/linux-checks/syntax-line.test.ts",
  },
  L3: { mode: "record", at: "apps/runner/test/linux-checks/cache.test.ts" },
  L4: { mode: "record", at: "apps/runner/test/linux-checks/cache.test.ts" },
  L17: { mode: "record", at: "apps/cli/test/linux-checks/file-choice.test.ts" },
  B4: {
    mode: "record",
    parts: {
      proof: "T168",
      ARM64: [
        "apps/cli/test/scenarios/linux-proof-dockerfile.test.ts",
        "apps/cli/test/scenarios/linux-proof-failed.test.ts",
      ],
    },
  },
}

function harness(
  env: Record<string, string | undefined> = {},
  options: { stateRoot?: string; codes?: number[]; modes?: typeof WRITTEN } = {}
) {
  const lines: string[] = []
  const calls: {
    args: readonly string[]
    cwd: string
    env: Record<string, string>
  }[] = []
  const codes = [...(options.codes ?? [])]
  const deps: RunDeps = {
    env,
    root: ROOT,
    // No run folder is there unless a test makes one.
    stateRoot: options.stateRoot ?? join(tmpdir(), "zekno-run-checks-none"),
    say: (line) => lines.push(line),
    modes: options.modes,
    test: async (args, given) => {
      calls.push({ args, ...given })
      return codes.shift() ?? 0
    },
  }
  return { deps, lines, calls }
}

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

/** A run folder as server.ts up leaves it, in a temporary root. */
function standInRun(
  leg: Pick<RunState, "engine" | "store" | "memory">
): string {
  const root = mkdtempSync(join(tmpdir(), "zekno-run-checks-state-"))
  roots.push(root)
  writeState(makeRunFolder(root, "a1b2c3d4"), {
    id: "a1b2c3d4",
    endpoint: "unix:///var/run/docker.sock",
    ...leg,
    port: 22022,
    before: {
      containers: [],
      volumes: [],
      networks: [],
      images: [],
      buildRecords: 0,
    },
    images: [],
  })
  return root
}

describe("the arguments", () => {
  test("--job always, --engine and --store at most once each, nothing else", async () => {
    expect(
      readArgs(["--job", "checks", "--engine", "floor", "--store", "overlay2"])
    ).toEqual({
      job: "checks",
      engine: "floor",
      store: "overlay2",
    })
    expect(readArgs(["--job", "memory"])).toEqual({
      job: "memory",
      engine: undefined,
      store: undefined,
    })
    for (const argv of [
      [],
      ["--engine", "floor"],
      ["--job"],
      ["--job", "checks", "--job", "proof"],
      ["--job", "checks", "--memory", "1g"],
    ]) {
      const { deps, lines, calls } = harness()
      expect(await main(argv, deps)).toBe(2)
      expect(lines).toEqual([
        "Use: run-checks.ts --job <name> [--engine <engine>] [--store <store>]",
      ])
      expect(calls).toEqual([])
    }
    const { deps, lines } = harness()
    expect(await main(["--job", "nightly"], deps)).toBe(2)
    expect(lines[0]).toContain('"nightly" is no job of linux checks')
  })

  test("the leg: left out where the job has one engine or store, else named, and only one of the job's", () => {
    expect(planChecks("memory").leg).toEqual({
      engine: "floor",
      store: "containerd",
      memory: true,
    })
    expect(planChecks("older-engine", "distro").leg).toEqual({
      engine: "distro",
      store: "containerd",
      memory: false,
    })
    expect(planChecks("checks", "newest", "overlay2").leg?.engine).toBe(
      "newest"
    )
    expect(() => planChecks("checks")).toThrow("has 4 such legs")
    expect(() => planChecks("checks", "floor")).toThrow("has 2 such legs")
    expect(() => planChecks("older-engine")).toThrow(
      "name one with --engine and --store"
    )
    expect(() => planChecks("checks", "older", "containerd")).toThrow(
      "checks runs no leg on older and containerd; its legs: floor on containerd; floor on overlay2; newest on containerd; newest on overlay2"
    )
    expect(() => planChecks("proof", undefined, "overlay2")).toThrow(
      "runs no leg on any engine and overlay2"
    )
    expect(() => planChecks("macos", "floor")).toThrow(
      "macos runs no Docker; it takes no --engine or --store"
    )
    expect(planChecks("macos").leg).toBeUndefined()
  })
})

describe("the files and the skip lines", () => {
  test("each package's files, each once, and a skip line for each id or part still to write", () => {
    const floor = planChecks("checks", "floor", "containerd", WRITTEN)
    expect([...floor.files]).toEqual([
      [
        "apps/runner",
        [
          "./test/linux-checks/syntax-line.test.ts",
          "./test/linux-checks/cache.test.ts",
        ],
      ],
      ["apps/cli", ["./test/linux-checks/file-choice.test.ts"]],
    ])
    expect(floor.skips).not.toContain("L2 skipped: not written yet")
    expect(floor.skips).toContain("L4b skipped: not written yet")
    expect(floor.skips).toContain("R16 skipped: not written yet")
    // The newest leg runs neither L3 nor L4, so not their file.
    expect([
      ...planChecks("checks", "newest", "containerd", WRITTEN).files.get(
        "apps/runner"
      )!,
    ]).toEqual(["./test/linux-checks/syntax-line.test.ts"])
    // A part with two files runs both; its other part keeps its skip line where it runs.
    const arm64 = planChecks("arm64", undefined, undefined, WRITTEN)
    expect([...arm64.files]).toEqual([
      [
        "apps/cli",
        [
          "./test/scenarios/linux-proof-dockerfile.test.ts",
          "./test/scenarios/linux-proof-failed.test.ts",
        ],
      ],
    ])
    expect(arm64.skips).toEqual([
      "B1 (Dockerfile part) skipped: not written yet",
      "B1 (Railpack part) skipped: not written yet",
    ])
    expect(planChecks("proof", "newest", undefined, WRITTEN).skips).toEqual([
      "B4 (proof part) skipped: not written yet",
    ])
    expect(
      planChecks("checks", "floor", "overlay2", WRITTEN).variables
    ).toEqual({
      ZEKNO_CHECK_JOB: "checks",
      ZEKNO_CHECK_ENGINE: "floor",
      ZEKNO_CHECK_STORE: "overlay2",
    })
    expect(planChecks("macos").variables).toEqual({
      ZEKNO_CHECK_JOB: "macos",
      ZEKNO_CHECK_ENGINE: "none",
      ZEKNO_CHECK_STORE: "none",
    })
    const outside = {
      ...AT_START,
      L6: { mode: "record", at: "packages/core/test/linux.test.ts" },
    } as const
    expect(() => planChecks("memory", undefined, undefined, outside)).toThrow(
      "packages/core/test/linux.test.ts is in neither apps/runner nor apps/cli"
    )
  })

  test("bun --no-env-file test in apps/runner, then apps/cli, with the variables set and the rest of the environment unchanged", async () => {
    const stateRoot = standInRun({
      engine: "floor",
      store: "containerd",
      memory: false,
    })
    const env = {
      ZEKNO_LINUX_SERVER: STAND_IN,
      GITHUB_OUTPUT: "/tmp/out",
      GITHUB_STEP_SUMMARY: "/tmp/summary",
      UNSET: undefined,
    }
    const { deps, lines, calls } = harness(env, {
      stateRoot,
      modes: WRITTEN,
      codes: [1, 0],
    })
    expect(
      await main(
        ["--job", "checks", "--engine", "floor", "--store", "containerd"],
        deps
      )
    ).toBe(1)
    expect(lines[0]).toBe("linux checks, job checks: floor on containerd")
    expect(
      lines.slice(1).every((line) => line.endsWith(" skipped: not written yet"))
    ).toBe(true)
    expect(calls.map((call) => [call.args, call.cwd])).toEqual([
      [
        [
          process.execPath,
          "--no-env-file",
          "test",
          "./test/linux-checks/syntax-line.test.ts",
          "./test/linux-checks/cache.test.ts",
        ],
        join(ROOT, "apps/runner"),
      ],
      [
        [
          process.execPath,
          "--no-env-file",
          "test",
          "./test/linux-checks/file-choice.test.ts",
        ],
        join(ROOT, "apps/cli"),
      ],
    ])
    for (const call of calls) {
      expect(call.env).toEqual({
        ZEKNO_LINUX_SERVER: STAND_IN,
        GITHUB_OUTPUT: "/tmp/out",
        GITHUB_STEP_SUMMARY: "/tmp/summary",
        ZEKNO_CHECK_JOB: "checks",
        ZEKNO_CHECK_ENGINE: "floor",
        ZEKNO_CHECK_STORE: "containerd",
      })
    }
    // With nothing written, nothing runs and the job passes on its skip lines.
    const empty = harness(
      { ZEKNO_LINUX_SERVER: STAND_IN },
      { stateRoot, modes: AT_START }
    )
    expect(await main(["--job", "released"], empty.deps)).toBe(0)
    expect(empty.calls).toEqual([])
    expect(empty.lines).toEqual([
      "linux checks, job released: floor on containerd",
      ...planChecks("released", undefined, undefined, AT_START).skips,
    ])
    expect(empty.lines).toContain("L1 skipped: not written yet")
  })
})

describe("the stand-in", () => {
  test("its run.json must say the leg's engine, store and memory", async () => {
    const memory = standInRun({
      engine: "floor",
      store: "containerd",
      memory: true,
    })
    const ok = harness(
      { ZEKNO_LINUX_SERVER: STAND_IN },
      { stateRoot: memory, modes: WRITTEN }
    )
    expect(await main(["--job", "memory"], ok.deps)).toBe(0)
    const wrong = harness(
      { ZEKNO_LINUX_SERVER: STAND_IN },
      { stateRoot: memory }
    )
    expect(await main(["--job", "released"], wrong.deps)).toBe(2)
    expect(wrong.lines).toEqual([
      `${STAND_IN} runs floor on containerd, held to 1 GB, not floor on containerd, which this leg of released needs`,
    ])
    const swapped = standInRun({
      engine: "distro",
      store: "containerd",
      memory: false,
    })
    const older = harness(
      { ZEKNO_LINUX_SERVER: STAND_IN },
      { stateRoot: swapped }
    )
    expect(
      await main(["--job", "older-engine", "--engine", "older"], older.deps)
    ).toBe(2)
    expect(older.lines[0]).toContain(
      "runs distro on containerd, not older on containerd"
    )
    const missing = harness({ ZEKNO_LINUX_SERVER: STAND_IN })
    expect(await main(["--job", "memory"], missing.deps)).toBe(2)
    expect(missing.lines[0]).toBe(
      `the run.json of ${STAND_IN} is not there here, so its engine and store cannot be checked; make the stand-in with server.ts up on this machine`
    )
  })

  test("without the switch it says so in one line and runs, each check file skipping itself", async () => {
    const { deps, lines, calls } = harness({}, { modes: WRITTEN })
    expect(
      await main(["--job", "older-engine", "--engine", "older"], deps)
    ).toBe(0)
    expect(lines.slice(0, 2)).toEqual([
      "linux checks, job older-engine: older on containerd",
      "No stand-in is named (ZEKNO_LINUX_SERVER is not set): each check file says in one line that it skips.",
    ])
    expect(calls.map((call) => call.args.slice(3))).toEqual([
      [
        "./test/linux-checks/syntax-line.test.ts",
        "./test/linux-checks/cache.test.ts",
      ],
    ])
  })

  test("the macOS job, with no Docker, takes no stand-in", async () => {
    const { deps, lines } = harness({ ZEKNO_LINUX_SERVER: STAND_IN })
    expect(await main(["--job", "macos"], deps)).toBe(2)
    expect(lines).toEqual([
      `macos runs no Docker, and ZEKNO_LINUX_SERVER names ${STAND_IN}`,
    ])
  })
})
