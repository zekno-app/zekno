/**
 * Runs one job's Linux checks (specs/016-build-from-source, T009 and T010),
 * in a GitHub job of `linux checks` and on the Mac:
 *
 *   ZEKNO_LINUX_SERVER=zekno-check-<id>-server bun --no-env-file apps/runner/test/support/linux-server/run-checks.ts --job <name> [--engine <e>] [--store <s>]
 *
 * From `jobs.ts`, the checks the job runs on that leg; from `modes.ts`, each
 * one's file, or the task still to write it. It prints one skip line,
 * `<id> skipped: not written yet`, for each id or part with a task, and runs
 * `bun --no-env-file test` on the files, in `apps/runner` and in `apps/cli`,
 * with `ZEKNO_CHECK_JOB`, `ZEKNO_CHECK_ENGINE` and `ZEKNO_CHECK_STORE` set
 * (`none` and `none` in the macOS job, which has no Docker). Everything else
 * of its environment, `ZEKNO_LINUX_SERVER` and GitHub's `GITHUB_OUTPUT` and
 * `GITHUB_STEP_SUMMARY` among it, reaches the tests unchanged.
 *
 * `--engine` and `--store` may be left out where the job has one engine or
 * one store. A leg the job does not run, a switch that names no stand-in of
 * `server.ts up`, and a stand-in whose run.json says another engine, store
 * or memory than the leg are refused with status 2 before any test runs, so
 * a record never names an engine it did not run on.
 */
import { tmpdir } from "node:os"
import { join } from "node:path"

import { STAND_IN, standInOf } from "./gate"
import { idsOf, jobNamed, JOBS, type JobName, type Leg } from "./jobs/jobs"
import {
  filesOf,
  isTask,
  MODES,
  notWritten,
  type CheckId,
  type Check,
  unitsOf,
} from "./jobs/modes"
import type { EngineName } from "./pins"
import type { Store } from "./stand-in/plan"
import { readState } from "./stand-in/run-folder"

export const PACKAGES = ["apps/runner", "apps/cli"] as const
export type Package = (typeof PACKAGES)[number]

export type Plan = {
  readonly job: JobName
  readonly leg: Leg | undefined
  readonly skips: readonly string[]
  /** Each package's check files, as `bun test` takes them there (`./test/...`). */
  readonly files: ReadonlyMap<Package, readonly string[]>
  /** The three variables the tests get. */
  readonly variables: Readonly<Record<string, string>>
}

export type RunDeps = {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The repository's root. */
  readonly root: string
  /** Where server.ts keeps its run folders: the system's temporary folder. */
  readonly stateRoot: string
  readonly say: (line: string) => void
  /** Each check's place; modes.ts's unless a test gives its own. */
  readonly modes?: Readonly<Record<CheckId, Check>>
  /** Runs `bun test`; gives its status. */
  readonly test: (
    args: readonly string[],
    options: { readonly cwd: string; readonly env: Record<string, string> }
  ) => Promise<number>
}

const USAGE =
  "Use: run-checks.ts --job <name> [--engine <engine>] [--store <store>]"

/** `--job`, `--engine` and `--store`, each at most once, `--job` always. */
export function readArgs(argv: readonly string[]): {
  job: string
  engine?: string
  store?: string
} {
  const given = new Map<string, string>()
  if (argv.length % 2 !== 0) throw new Error(USAGE)
  for (let at = 0; at < argv.length; at += 2) {
    const key = argv[at]!
    if (!["--job", "--engine", "--store"].includes(key) || given.has(key))
      throw new Error(USAGE)
    given.set(key, argv[at + 1]!)
  }
  const job = given.get("--job")
  if (job === undefined) throw new Error(USAGE)
  return { job, engine: given.get("--engine"), store: given.get("--store") }
}

const legWords = (leg: Leg) =>
  `${leg.engine} on ${leg.store}${leg.memory ? ", held to 1 GB" : ""}`

/** The one leg of `job` that `engine` and `store` name. */
function chooseLeg(
  name: JobName,
  engine: string | undefined,
  store: string | undefined
): Leg | undefined {
  const job = JOBS[name]
  if (job.legs.length === 0) {
    if (engine !== undefined || store !== undefined)
      throw new Error(`${name} runs no Docker; it takes no --engine or --store`)
    return undefined
  }
  const found = job.legs.filter(
    (leg) =>
      (engine === undefined || leg.engine === engine) &&
      (store === undefined || leg.store === store)
  )
  if (found.length === 1) return found[0]
  const legs = job.legs.map(legWords).join("; ")
  throw new Error(
    found.length === 0
      ? `${name} runs no leg on ${engine ?? "any engine"} and ${store ?? "any store"}; its legs: ${legs}`
      : `${name} has ${found.length} such legs; name one with --engine and --store: ${legs}`
  )
}

/** Where a check file is run: its package, and its path there. */
function inPackage(file: string): { pkg: Package; path: string } {
  const pkg = PACKAGES.find((name) => file.startsWith(`${name}/`))
  if (pkg === undefined)
    throw new Error(`${file} is in neither apps/runner nor apps/cli`)
  return { pkg, path: `./${file.slice(pkg.length + 1)}` }
}

/** What run-checks does for one leg of one job, without running anything. */
export function planChecks(
  name: string,
  engine?: string,
  store?: string,
  modes: Readonly<Record<CheckId, Check>> = MODES
): Plan {
  const job = jobNamed(name)
  const jobName = name as JobName
  const leg = chooseLeg(jobName, engine, store)
  const skips: string[] = []
  const files = new Map<Package, string[]>()
  for (const id of idsOf(job, leg)) {
    const run = job.runs.find((item) => item.id === id)!
    for (const unit of unitsOf(id, run.parts, modes)) {
      if (isTask(unit.place)) {
        skips.push(notWritten(unit.label))
        continue
      }
      for (const file of filesOf(unit.place)) {
        const { pkg, path } = inPackage(file)
        const list = files.get(pkg) ?? []
        if (!list.includes(path)) list.push(path)
        files.set(pkg, list)
      }
    }
  }
  return {
    job: jobName,
    leg,
    skips,
    files: new Map(
      PACKAGES.filter((pkg) => files.has(pkg)).map((pkg) => [
        pkg,
        files.get(pkg)!,
      ])
    ),
    variables: {
      ZEKNO_CHECK_JOB: jobName,
      ZEKNO_CHECK_ENGINE: leg?.engine ?? "none",
      ZEKNO_CHECK_STORE: leg?.store ?? "none",
    },
  }
}

/** Refuses a stand-in that is not the leg's; gives a line to say when a leg has none. */
function checkStandIn(plan: Plan, deps: RunDeps): string | undefined {
  const standIn = standInOf(deps.env)
  if (plan.leg === undefined) {
    if (standIn !== undefined)
      throw new Error(
        `${plan.job} runs no Docker, and ZEKNO_LINUX_SERVER names ${standIn}`
      )
    return undefined
  }
  if (standIn === undefined)
    return "No stand-in is named (ZEKNO_LINUX_SERVER is not set): each check file says in one line that it skips."
  const state = readState(deps.stateRoot, STAND_IN.exec(standIn)![1]!)
  if ("reason" in state)
    throw new Error(
      `the run.json of ${standIn} ${state.reason} here, so its engine and store cannot be checked; make the stand-in with server.ts up on this machine`
    )
  const ran: Leg = {
    engine: state.engine as EngineName,
    store: state.store as Store,
    memory: state.memory,
  }
  if (legWords(ran) !== legWords(plan.leg))
    throw new Error(
      `${standIn} runs ${legWords(ran)}, not ${legWords(plan.leg)}, which this leg of ${plan.job} needs`
    )
  return undefined
}

export async function main(
  argv: readonly string[],
  deps: RunDeps = hostRunDeps()
): Promise<number> {
  let plan: Plan
  let note: string | undefined
  try {
    const args = readArgs(argv)
    plan = planChecks(args.job, args.engine, args.store, deps.modes)
    note = checkStandIn(plan, deps)
  } catch (error) {
    deps.say((error as Error).message)
    return 2
  }
  deps.say(
    `linux checks, job ${plan.job}: ${plan.leg ? legWords(plan.leg) : "no Docker"}`
  )
  if (note !== undefined) deps.say(note)
  for (const line of plan.skips) deps.say(line)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(deps.env))
    if (value !== undefined) env[key] = value
  Object.assign(env, plan.variables)
  let status = 0
  for (const [pkg, paths] of plan.files) {
    const code = await deps.test(
      [process.execPath, "--no-env-file", "test", ...paths],
      { cwd: join(deps.root, pkg), env }
    )
    if (code !== 0 && status === 0) status = code
  }
  return status
}

/** This machine: `bun test` started with its output on this one's. */
export function hostRunDeps(): RunDeps {
  return {
    env: process.env,
    root: join(import.meta.dir, "..", "..", "..", "..", ".."),
    stateRoot: tmpdir(),
    say: (line) => console.log(line),
    test: async (args, options) => {
      const child = Bun.spawn([...args], {
        cwd: options.cwd,
        env: options.env,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      })
      const code = await child.exited
      return child.signalCode === null ? code : 1
    },
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
