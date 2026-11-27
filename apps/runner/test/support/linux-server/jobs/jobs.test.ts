/**
 * The check harness (specs/016-build-from-source, T009): `jobs.ts` against
 * quickstart.md, "The jobs", read from the file as
 * apps/cli/test/templates/workflow.test.ts reads its contract; `modes.ts`,
 * every check id or part with its file or the task that writes it and a
 * place to run; `run-checks.ts`, the skip line of each id still to write and
 * no check against the machine's own engine (map-checks part 3); and
 * `record.ts`'s line. Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { DEFAULT_STORE, engineNote, jobsSection, readRow } from "./jobs-table"
import {
  JOB_NAMES,
  JOBS,
  MAC_ONLY,
  MACOS_LABEL,
  idsOf,
  runsHere,
  type Job,
} from "./jobs"
import {
  CHECK_IDS,
  FILE_FORM,
  MODES,
  filesOf,
  isTask,
  unitsOf,
  type CheckId,
} from "./modes"
import { ENGINE_NAMES, loadPins } from "../pins"
import { STORES } from "../stand-in/plan"
import { recordLine } from "./record"
import { main, planChecks, type RunDeps } from "../run-checks"

const ROOT = join(import.meta.dir, "../../../../../..")
const QUICKSTART = join(ROOT, "specs/016-build-from-source/quickstart.md")
const section = jobsSection(readFileSync(QUICKSTART, "utf8"))
const pins = loadPins()

const sorted = (ids: readonly CheckId[]) =>
  CHECK_IDS.filter((id) => ids.includes(id))

/** What a job is, in the terms the table gives. */
const view = (job: Job) => ({
  runsOn: job.runsOn === MACOS_LABEL ? "macos" : job.runsOn,
  matrix: job.matrix,
  legs: job.legs,
  ids: sorted(job.runs.map((run) => run.id)),
  only: job.only ?? {},
  minutes: job.minutes,
})

/** The engines a check runs on, over every job. */
const enginesOf = (id: CheckId) =>
  new Set(
    JOB_NAMES.flatMap((name) =>
      JOBS[name].legs
        .filter((leg) => idsOf(JOBS[name], leg).includes(id))
        .map((leg) => leg.engine)
    )
  )

describe('jobs.ts and quickstart.md, "The jobs"', () => {
  test('jobs.ts equals the table of quickstart.md, "The jobs", read from the file', () => {
    expect(section.intro).toContain(
      "All on `ubuntu-24.04` unless marked, in parallel, each with a time limit, with no repository secret"
    )
    expect(section.rows.map((cells) => readRow(cells, pins).job)).toEqual([
      ...JOB_NAMES,
    ])
    for (const cells of section.rows) {
      const row = readRow(cells, pins)
      const job = JOBS[row.job as keyof typeof JOBS]
      expect({ job: row.job, ...view(job) }).toEqual({
        job: row.job,
        runsOn: row.runsOn,
        matrix: row.matrix,
        legs: row.legs,
        ids: [...row.ids],
        only: row.only,
        minutes: row.minutes,
      })
      // Its notes, word for word: each one the row says, and each aside or item without a check is one.
      const notes = [
        ...(job.notes ?? []),
        ...job.runs.flatMap((run) => (run.note ? [run.note] : [])),
      ]
      for (const note of notes)
        expect({ job: row.job, note, said: row.runs.includes(note) }).toEqual({
          job: row.job,
          note,
          said: true,
        })
      for (const aside of row.asides) expect(notes).toContain(aside)
      for (const item of row.loose) expect(job.notes ?? []).toContain(item)
    }
  })

  test("the notes below the table hold: L8, L17 and L18 at the floor and the newest; L18 joins older-engine only once Ubuntu's docker.io meets the floor", () => {
    const read = section.bullets.flatMap((bullet) => {
      const note = engineNote(bullet)
      return note ? [note] : []
    })
    expect(read.flatMap((note) => note.ids).sort()).toEqual([
      "L17",
      "L18",
      "L8",
    ])
    for (const note of read)
      for (const id of note.ids)
        expect({ id, engines: [...enginesOf(id)].sort() }).toEqual({
          id,
          engines: [...note.engines].sort(),
        })
    expect(
      section.bullets.some((bullet) =>
        bullet.includes(
          "L18 joins `older-engine` for Ubuntu's `docker.io` once its version meets the floor"
        )
      )
    ).toBe(true)
    const meets = Bun.semver.order(
      pins.engines.distro.engine,
      pins.engines.floor.engine
    )
    expect(JOBS["older-engine"].runs.some((run) => run.id === "L18")).toBe(
      meets >= 0
    )
  })

  test("the newest runs only L2, L8, L9, L12, L13, L15, L17 and L18; L11 is the Mac's only, in no job", () => {
    const newest = JOBS.checks.legs.filter((leg) => leg.engine === "newest")
    expect(newest.map((leg) => leg.store)).toEqual(["containerd", "overlay2"])
    for (const leg of newest)
      expect(idsOf(JOBS.checks, leg)).toEqual([
        "L2",
        "L8",
        "L9",
        "L12",
        "L13",
        "L15",
        "L17",
        "L18",
      ])
    expect([...MAC_ONLY]).toEqual(["L11"])
    for (const name of JOB_NAMES)
      expect(JOBS[name].runs.map((run) => run.id)).not.toContain("L11")
    // A row that names no store runs the store a fresh engine gets.
    expect(JOBS.memory.legs).toEqual([
      { engine: "floor", store: DEFAULT_STORE, memory: true },
    ])
  })

  test("the reader refuses a phrase it does not know, so a changed row fails rather than being read wrong", () => {
    const row = ["`memory`", "the floor, held to 2 GB", "L6", "15 min"]
    expect(() => readRow(row, pins)).toThrow('"held to 2 GB"')
    expect(() =>
      readRow(["`memory`", "the floor", "L6, L19", "15 min"], pins)
    ).toThrow("L19 is no check")
    expect(() =>
      readRow(["`memory`", "the floor", "L6", "a while"], pins)
    ).toThrow("is not minutes")
    expect(() => jobsSection("# Nothing\n")).toThrow("the heading is not there")
  })
})

describe("modes.ts", () => {
  test("every id or part has a file, or the task that writes it, and at least one place to run (L11's is the Mac)", () => {
    expect(Object.keys(MODES)).toEqual([...CHECK_IDS])
    const running = new Set(
      JOB_NAMES.flatMap((name) =>
        JOBS[name].runs.flatMap((run) =>
          unitsOf(run.id, run.parts).map((unit) => unit.label)
        )
      )
    )
    for (const id of CHECK_IDS)
      for (const unit of unitsOf(id)) {
        const files = filesOf(unit.place)
        expect({
          unit: unit.label,
          written: isTask(unit.place) || files.length > 0,
        }).toEqual({
          unit: unit.label,
          written: true,
        })
        for (const file of files) {
          expect(file).toMatch(FILE_FORM)
          expect({ file, there: existsSync(join(ROOT, file)) }).toEqual({
            file,
            there: true,
          })
        }
        const mac = (MAC_ONLY as readonly CheckId[]).includes(id)
        expect({
          unit: unit.label,
          runs: running.has(unit.label) || mac,
        }).toEqual({
          unit: unit.label,
          runs: true,
        })
        if (mac) expect(running.has(unit.label)).toBe(false)
      }
  })

  test("a check is run whole or by its parts; a part it does not have is refused", () => {
    expect(unitsOf("B1").map((unit) => unit.label)).toEqual([
      "B1 (Dockerfile part)",
      "B1 (Railpack part)",
    ])
    expect(unitsOf("B4", ["ARM64"]).map((unit) => unit.label)).toEqual([
      "B4 (ARM64 part)",
    ])
    expect(() => unitsOf("B4", ["Railpack"])).toThrow("B4 has no Railpack part")
    expect(() => unitsOf("L2", ["proof"])).toThrow("L2 has no parts")
    expect(filesOf("T011")).toEqual([])
    expect(filesOf("apps/cli/test/linux-checks/a.test.ts")).toEqual([
      "apps/cli/test/linux-checks/a.test.ts",
    ])
    expect(filesOf(["apps/cli/test/scenarios/linux-proof-a.test.ts"])).toEqual([
      "apps/cli/test/scenarios/linux-proof-a.test.ts",
    ])
    for (const file of [
      "apps/runner/test/linux-checks/syntax-line.test.ts",
      "apps/cli/test/scenarios/linux-proof-dockerfile.test.ts",
    ])
      expect(file).toMatch(FILE_FORM)
    for (const file of [
      "apps/cli/test/scenarios/deploy.test.ts",
      "apps/runner/test/scenarios/linux-proof-x.test.ts",
      "apps/runner/test/linux-checks/../../src/x.test.ts",
      "packages/core/test/linux-checks/x.test.ts",
    ])
      expect(file).not.toMatch(FILE_FORM)
  })

  test("all record but L18, which asserts from its first run (quickstart.md, phase 0, item 3)", () => {
    for (const id of CHECK_IDS)
      expect({ id, mode: MODES[id].mode }).toEqual({
        id,
        mode: id === "L18" ? "assert" : "record",
      })
  })

  test("T011 to T021 for the L checks they write, and T165 for L11, until each puts its file in place of its own name", () => {
    const tasks: Record<string, string> = {
      L1: "T021",
      L2: "T011",
      L3: "T012",
      L4: "T012",
      L4b: "T012",
      L5: "T013",
      L6: "T014",
      L7: "T014",
      L8: "T015",
      L9: "T016",
      L10: "T016",
      L11: "T165",
      L12: "T018",
      L13: "T018",
      L14: "T018",
      L15: "T017",
      L16: "T018",
      L17: "T019",
      L18: "T020",
    }
    expect(CHECK_IDS.filter((id) => id.startsWith("L"))).toEqual(
      Object.keys(tasks) as CheckId[]
    )
    for (const [id, task] of Object.entries(tasks)) {
      const [unit] = unitsOf(id as CheckId)
      expect({ id, place: isTask(unit!.place) ? unit!.place : task }).toEqual({
        id,
        place: task,
      })
    }
  })
})

/** run-checks.ts with every call recorded and no process started. */
function harness(env: Record<string, string | undefined> = {}) {
  const lines: string[] = []
  const calls: {
    args: readonly string[]
    cwd: string
    env: Record<string, string>
  }[] = []
  const deps: RunDeps = {
    env,
    root: ROOT,
    stateRoot: "/nonexistent-zekno-state",
    say: (line) => lines.push(line),
    test: async (args, options) => {
      calls.push({ args, ...options })
      return 0
    },
  }
  return { deps, lines, calls }
}

describe("run-checks.ts", () => {
  test("an id with a task prints its skip line, `<id> skipped: not written yet`, once for each id or part of the job", async () => {
    for (const name of JOB_NAMES) {
      const legs = JOBS[name].legs.length > 0 ? JOBS[name].legs : [undefined]
      for (const leg of legs) {
        const plan = planChecks(name, leg?.engine, leg?.store)
        const units = idsOf(JOBS[name], leg).flatMap((id) => {
          const run = JOBS[name].runs.find((item) => item.id === id)!
          return unitsOf(id, run.parts)
        })
        expect(plan.skips).toEqual(
          units
            .filter((unit) => isTask(unit.place))
            .map((unit) => `${unit.label} skipped: not written yet`)
        )
        const files = [...plan.files.values()].flat()
        expect(files.length).toBe(new Set(files).size)
      }
    }
    // A part prints its own line: in the job proof, B4's proof part only.
    const proofPart = unitsOf("B4", ["proof"])[0]!
    expect(planChecks("proof", "floor", "containerd").skips).toEqual(
      isTask(proofPart.place)
        ? ["B4 (proof part) skipped: not written yet"]
        : []
    )
    // run-checks prints them, each once, before any test runs.
    const { deps, lines } = harness()
    expect(await main(["--job", "macos"], deps)).toBe(0)
    expect(
      lines.filter((line) => line.endsWith(" skipped: not written yet"))
    ).toEqual([...planChecks("macos").skips])
  })

  test("no check runs against the machine's own engine (map-checks part 3)", async () => {
    // Every job with Docker runs in the stand-in, at an engine and store of pins.json and plan.ts.
    for (const name of JOB_NAMES) {
      const job = JOBS[name]
      if (name === "macos") expect(job.legs).toEqual([])
      else expect(job.legs.length).toBeGreaterThan(0)
      for (const leg of job.legs) {
        expect(ENGINE_NAMES).toContain(leg.engine)
        expect(STORES).toContain(leg.store)
      }
    }
    // A switch naming anything but a stand-in of server.ts up is refused before any test runs.
    for (const value of [
      "sessora-db",
      "zekno-proxy",
      "zekno-check-a1b2c3d4-client",
    ]) {
      const { deps, lines, calls } = harness({ ZEKNO_LINUX_SERVER: value })
      expect(await main(["--job", "memory"], deps)).toBe(2)
      expect(lines.join("\n")).toContain("no check runs in another container")
      expect(calls).toEqual([])
    }
    // A stand-in this machine has no run of, or whose engine or store is another leg's, is refused too.
    const { deps, lines, calls } = harness({
      ZEKNO_LINUX_SERVER: "zekno-check-a1b2c3d4-server",
    })
    expect(await main(["--job", "memory"], deps)).toBe(2)
    expect(lines.join("\n")).toContain("run.json")
    expect(calls).toEqual([])
    // The macOS job has no Docker, and takes no stand-in, engine or store.
    for (const argv of [
      ["--job", "macos", "--engine", "floor"],
      ["--job", "macos", "--store", "containerd"],
    ])
      expect(await main(argv, harness().deps)).toBe(2)
    expect(
      await main(
        ["--job", "macos"],
        harness({ ZEKNO_LINUX_SERVER: "zekno-check-a1b2c3d4-server" }).deps
      )
    ).toBe(2)
    // Every check file reaches Docker through gate.ts, or the proof's helper that uses it.
    for (const id of CHECK_IDS)
      for (const unit of unitsOf(id))
        for (const file of filesOf(unit.place))
          expect({
            file,
            gated: /linux-server\/gate|support\/linux-proof/.test(
              readFileSync(join(ROOT, file), "utf8")
            ),
          }).toEqual({ file, gated: true })
  })
})

describe("jobs.ts, asked by a check file", () => {
  test("runsHere: what run-checks named for this leg, or everything when run by hand", () => {
    const leg = (engine: string, store: string) => ({
      ZEKNO_CHECK_JOB: "checks",
      ZEKNO_CHECK_ENGINE: engine,
      ZEKNO_CHECK_STORE: store,
    })
    expect(runsHere("L14", {})).toBe(true)
    expect(runsHere("L14", leg("floor", "overlay2"))).toBe(true)
    expect(runsHere("L14", leg("newest", "overlay2"))).toBe(false)
    expect(runsHere("L12", leg("newest", "containerd"))).toBe(true)
    expect(runsHere("L6", leg("floor", "containerd"))).toBe(false)
    expect(
      runsHere("R16", {
        ZEKNO_CHECK_JOB: "macos",
        ZEKNO_CHECK_ENGINE: "none",
        ZEKNO_CHECK_STORE: "none",
      })
    ).toBe(true)
    expect(() => runsHere("L2", leg("older", "containerd"))).toThrow(
      "checks has no leg on older and containerd"
    )
    expect(() => runsHere("L2", { ZEKNO_CHECK_JOB: "nightly" })).toThrow(
      "is no job of linux checks"
    )
  })
})

describe("record.ts", () => {
  test("a record line holds the id, the engine and the store", () => {
    expect(
      recordLine("L2", "built; no request for the frontend", {
        ZEKNO_CHECK_ENGINE: "floor",
        ZEKNO_CHECK_STORE: "overlay2",
      })
    ).toBe("L2 floor overlay2: built; no request for the frontend")
    expect(
      recordLine("B3 (fingerprint part)", "a1b2", {
        ZEKNO_CHECK_ENGINE: "none",
        ZEKNO_CHECK_STORE: "none",
      })
    ).toBe("B3 (fingerprint part) none none: a1b2")
  })
})
