/**
 * Which job of `linux checks` runs which check, on which engines and stores
 * (specs/016-build-from-source, T009), exactly as quickstart.md, "The jobs",
 * gives it with its notes; jobs.test.ts reads that table and holds this file
 * to it, and workflow.test.ts holds .github/workflows/linux-checks.yml to
 * this file.
 *
 * A leg is one stand-in's engine and store. A matrix job is one GitHub job
 * per leg; any other job runs its legs in order in one stand-in, the engine
 * swapped between them (`server.ts engine`). The macOS job has no Docker and
 * no leg. Every leg runs in the stand-in: no check runs against the
 * machine's own engine (map-checks part 3). A row that names no store runs
 * containerd, the store a fresh engine's data folder gets.
 */
import type { CheckId } from "./modes"
import type { EngineName } from "../pins"
import type { Store } from "../stand-in/plan"

export const JOB_NAMES = [
  "checks",
  "older-engine",
  "memory",
  "released",
  "proof",
  "arm64",
  "macos",
] as const
export type JobName = (typeof JOB_NAMES)[number]

/** The GitHub macOS machine of the job `macos`, pinned by its label (never `macos-latest`). */
export const MACOS_LABEL = "macos-15"

/** Checks that run in no job: L11 runs on the Mac only, from a client container (T165). */
export const MAC_ONLY: readonly CheckId[] = ["L11"]

export type Leg = {
  readonly engine: EngineName
  readonly store: Store
  /** The stand-in held to 1 GB (`server.ts up --memory 1g`). */
  readonly memory: boolean
}

export type Run = {
  readonly id: CheckId
  /** The parts of a check with parts that this job runs; all when absent. */
  readonly parts?: readonly string[]
  /** What the table says of the check in this row, word for word. */
  readonly note?: string
}

export type Job = {
  readonly runsOn: string
  readonly minutes: number
  readonly matrix: boolean
  readonly legs: readonly Leg[]
  readonly runs: readonly Run[]
  /** On these engines only the ids given run; elsewhere every run of the job. */
  readonly only?: Readonly<Partial<Record<EngineName, readonly CheckId[]>>>
  /** What the row says beyond its checks, word for word. */
  readonly notes?: readonly string[]
  readonly needs?: JobName
}

const leg = (
  engine: EngineName,
  store: Store = "containerd",
  memory = false
): Leg => ({ engine, store, memory })

const runs = (...ids: CheckId[]): Run[] => ids.map((id) => ({ id }))

export const JOBS: Readonly<Record<JobName, Job>> = {
  checks: {
    runsOn: "ubuntu-24.04",
    minutes: 40,
    matrix: true,
    needs: "macos",
    legs: [
      leg("floor", "containerd"),
      leg("floor", "overlay2"),
      leg("newest", "containerd"),
      leg("newest", "overlay2"),
    ],
    runs: [
      ...runs("L2", "L3", "L4", "L4b", "L5", "L7", "L8", "L9", "L10"),
      ...runs("L12", "L13", "L14", "L15", "L16", "L17", "L18"),
      ...runs("R1", "R4", "R5", "R6", "R7", "R8", "R9", "R10"),
      { id: "R16", note: "Linux side" },
      { id: "B2" },
      { id: "R2", note: "the Linux half" },
      { id: "R3", note: "the Linux half" },
    ],
    only: {
      newest: ["L2", "L8", "L9", "L12", "L13", "L15", "L17", "L18"],
    },
  },
  "older-engine": {
    runsOn: "ubuntu-24.04",
    minutes: 20,
    matrix: false,
    legs: [
      leg("older"),
      leg("distro"),
      leg("distro-no-buildx"),
      leg("floor-no-buildx"),
    ],
    runs: [
      { id: "L2", note: "observed" },
      { id: "L3", note: "observed" },
      { id: "L4", note: "observed" },
      {
        id: "B5",
        note: "on `floor-no-buildx`: `no_build_plugin`, R13, G35",
      },
    ],
  },
  memory: {
    runsOn: "ubuntu-24.04",
    minutes: 15,
    matrix: false,
    legs: [leg("floor", "containerd", true)],
    runs: runs("L6"),
  },
  released: {
    runsOn: "ubuntu-24.04",
    minutes: 15,
    matrix: false,
    legs: [leg("floor")],
    runs: [{ id: "L1", note: "runner 0.1.1 itself" }, { id: "B6" }],
    notes: ["FR-083 for runner 0.1.1"],
  },
  proof: {
    runsOn: "ubuntu-24.04",
    minutes: 30,
    matrix: true,
    legs: [leg("floor"), leg("newest")],
    runs: [{ id: "B4", parts: ["proof"] }],
    notes: ["each step's scenarios"],
  },
  arm64: {
    runsOn: "ubuntu-24.04-arm",
    minutes: 30,
    matrix: false,
    legs: [leg("floor")],
    runs: [{ id: "B1" }, { id: "B4", parts: ["ARM64"] }],
  },
  macos: {
    runsOn: MACOS_LABEL,
    minutes: 15,
    matrix: false,
    legs: [],
    runs: [{ id: "B3" }, { id: "R16", note: "macOS side" }],
    notes: ["the fingerprint and the plan handed to `checks` as job outputs"],
  },
}

/** A job by name; another name throws. */
export function jobNamed(name: string): Job {
  if (!(JOB_NAMES as readonly string[]).includes(name))
    throw new Error(
      `${JSON.stringify(name)} is no job of linux checks: ${JOB_NAMES.join(", ")}`
    )
  return JOBS[name as JobName]
}

/** The checks a job runs on one of its legs (on none, for the macOS job). */
export function idsOf(job: Job, leg: Leg | undefined): CheckId[] {
  const ids = job.runs.map((run) => run.id)
  const only = leg === undefined ? undefined : job.only?.[leg.engine]
  return only === undefined ? ids : ids.filter((id) => only.includes(id))
}

/**
 * Whether the check `id` runs where run-checks.ts started this test file:
 * a file that holds several checks asks it before each. Run by hand, with
 * no `ZEKNO_CHECK_JOB`, every check of the file runs.
 */
export function runsHere(
  id: CheckId,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const name = env.ZEKNO_CHECK_JOB
  if (name === undefined || name === "") return true
  const job = jobNamed(name)
  const leg = job.legs.find(
    (item) =>
      item.engine === env.ZEKNO_CHECK_ENGINE &&
      item.store === env.ZEKNO_CHECK_STORE
  )
  if (job.legs.length > 0 && leg === undefined)
    throw new Error(
      `${name} has no leg on ${env.ZEKNO_CHECK_ENGINE} and ${env.ZEKNO_CHECK_STORE}`
    )
  return idsOf(job, leg).includes(id)
}
