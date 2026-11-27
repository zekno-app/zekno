/**
 * `.github/workflows/linux-checks.yml`, named `linux checks`
 * (specs/016-build-from-source, T010), read as text and with
 * `Bun.YAML.parse` as apps/runner/test/release/workflow.test.ts reads the
 * release workflow, and held to rules LC1 to LC10 (research/map-checks.md
 * part 8, "How it stays free of secrets") and to `jobs.ts`: the same jobs,
 * machines, time limits and legs. The steps with logic of their own are run
 * with bash in workflow-steps.test.ts. Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { JOB_NAMES, JOBS, MACOS_LABEL, type Leg } from "./jobs"
import { isTask, unitsOf, type CheckId } from "./modes"
import { loadPins } from "../pins"
import { type Step, type Workflow, legsOf } from "./workflow-reading"

const ROOT = join(import.meta.dir, "../../../../../..")
const FILE = join(ROOT, ".github/workflows/linux-checks.yml")
const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : ""
const workflow = (text === "" ? { jobs: {} } : Bun.YAML.parse(text)) as Workflow
const jobs = Object.entries(workflow.jobs ?? {})
const steps = jobs.flatMap(([, job]) => job.steps ?? [])
const runs = steps.flatMap((step) => (step.run ? [step.run] : []))

const SERVER = "apps/runner/test/support/linux-server/server.ts"
const RUN_CHECKS = "apps/runner/test/support/linux-server/run-checks.ts"
const UP_LOG = '"$RUNNER_TEMP/linux-server-up.log"'
const FORK_ONLY =
  "github.event_name == 'push' || github.event.pull_request.head.repo.full_name != github.repository"
const INSTALL = "bun install --frozen-lockfile --ignore-scripts"
/** The two actions, at the commits of the task and of the repository's other workflows. */
const PINS = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  setupBun: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
}
const versions = Bun.YAML.parse(
  readFileSync(join(ROOT, ".github/workflows/main-versions.yml"), "utf8")
) as Workflow
const versionsSteps = Object.values(versions.jobs).flatMap(
  (job) => job.steps ?? []
)

describe("linux checks: when it runs and what it may do (LC1, LC2, LC7)", () => {
  test("the file is there, named linux checks", () => {
    expect(existsSync(FILE)).toBe(true)
    expect(workflow.name).toBe("linux checks")
  })

  test("LC1: every push to a branch and pull_request, never pull_request_target, workflow_run or a tag", () => {
    expect(Object.keys(workflow.on ?? {}).sort()).toEqual([
      "pull_request",
      "push",
    ])
    expect(workflow.on.push).toEqual({ branches: ["**"] })
    expect(workflow.on.pull_request).toBeNull()
    for (const word of [
      "pull_request_target",
      "workflow_run",
      "tags",
      "schedule",
      "workflow_dispatch",
    ])
      expect({ word, written: text.includes(word) }).toEqual({
        word,
        written: false,
      })
  })

  test("each job's if lets a pull request run only from a fork; checks waits for macos and runs whatever macos did, but not after a cancel", () => {
    for (const [name, job] of jobs) {
      if (name === "checks") {
        expect(job.needs).toBe("macos")
        // always() would start its four legs even after a newer push cancelled the run.
        expect(job.if).toBe(`\${{ !cancelled() && (${FORK_ONLY}) }}`)
        expect(job.if).not.toContain("always()")
      } else {
        expect(job.needs).toBeUndefined()
        expect(job.if).toBe(FORK_ONLY)
      }
    }
  })

  test("LC2: no permission by default, each job contents: read and nothing else", () => {
    expect(workflow.permissions).toEqual({})
    for (const [, job] of jobs)
      expect(job.permissions).toEqual({ contents: "read" })
  })

  test("LC7: a newer push replaces the older run, and every job has jobs.ts's time limit", () => {
    expect(workflow.concurrency).toEqual({
      group: "linux-checks-${{ github.ref }}",
      "cancel-in-progress": true,
    })
    for (const [name, job] of jobs)
      expect({ name, minutes: job["timeout-minutes"] }).toEqual({
        name,
        minutes: JOBS[name as keyof typeof JOBS].minutes,
      })
  })
})

describe("linux checks: actions, Bun and secrets (LC3 to LC6)", () => {
  test("LC3: only checkout and setup-bun, each pinned to the full commit the other workflows pin", () => {
    const used = new Set(
      steps.flatMap((step) => (step.uses ? [step.uses] : []))
    )
    expect([...used].sort()).toEqual([PINS.checkout, PINS.setupBun].sort())
    for (const pin of Object.values(PINS))
      expect(versionsSteps.map((step) => step.uses)).toContain(pin)
    expect(text).toContain(`${PINS.checkout} # v4.4.0`)
    expect(text).toContain(`${PINS.setupBun} # v2.2.0`)
  })

  test("LC4: every checkout keeps no credentials; only released fetches the whole history", () => {
    for (const [name, job] of jobs) {
      const checkouts = job.steps.filter((step) => step.uses === PINS.checkout)
      expect(checkouts).toHaveLength(1)
      expect(job.steps[0]).toBe(checkouts[0]!)
      expect(checkouts[0]!.with).toEqual(
        name === "released"
          ? { "persist-credentials": false, "fetch-depth": 0 }
          : { "persist-credentials": false }
      )
    }
  })

  test("Bun is read from the root package.json, as the other workflows read it, and set up before the install", () => {
    const readBun = versionsSteps.find(
      (step) => step.name === "Read the Bun version"
    )!
    for (const [, job] of jobs) {
      const at = (find: (step: Step) => boolean) => job.steps.findIndex(find)
      const pin = at((step) => step.id === "pin")
      const setup = at((step) => step.uses === PINS.setupBun)
      const install = at((step) => step.run?.trim() === INSTALL)
      expect(job.steps[pin]).toEqual({
        name: "Read the Bun version",
        id: "pin",
        run: readBun.run,
      })
      expect(job.steps[setup]!.with).toEqual({
        "bun-version": "${{ steps.pin.outputs.bun }}",
      })
      expect([pin, setup, install]).toEqual([1, 2, 3])
    }
  })

  test("LC6 and every other bun command: the lockfile as committed, no install script, `bun --no-env-file`", () => {
    const commands = runs.flatMap((run) =>
      [...run.matchAll(/(?:^|[\s;&|(])bun\s+([^\n]*)/g)].map(
        (match) => match[1]!
      )
    )
    expect(commands.length).toBeGreaterThan(jobs.length)
    for (const command of commands)
      expect(
        command === "install --frozen-lockfile --ignore-scripts" ||
          command.startsWith("--no-env-file ")
      ).toBe(true)
    expect(text.match(/bun install/g)).toHaveLength(jobs.length)
  })

  test("LC5: no repository secret, no deployment environment, no token handed to a step, no expression inside a shell", () => {
    for (const word of [
      "secrets.",
      "environment:",
      "GITHUB_TOKEN",
      "github.token",
      "token:",
    ])
      expect({ word, written: text.includes(word) }).toEqual({
        word,
        written: false,
      })
    for (const [, job] of jobs) expect(job.environment).toBeUndefined()
    for (const step of steps) {
      if (step.run !== undefined)
        expect({ run: step.run, expression: step.run.includes("${{") }).toEqual(
          { run: step.run, expression: false }
        )
      expect(
        Object.keys(step.with ?? {}).filter((key) => /token/i.test(key))
      ).toEqual([])
    }
  })
})

describe("linux checks: the jobs of jobs.ts", () => {
  test("the file and jobs.ts name the same jobs, on the same machines; macOS by a pinned label", () => {
    expect(jobs.map(([name]) => name).sort()).toEqual([...JOB_NAMES].sort())
    for (const [name, job] of jobs)
      expect({ name, on: job["runs-on"] }).toEqual({
        name,
        on: JOBS[name as keyof typeof JOBS].runsOn,
      })
    expect(MACOS_LABEL).toMatch(/^macos-\d+$/)
    expect(text.includes("-latest")).toBe(false)
  })

  test("each Linux job compiles the runner and starts the stand-in, runs its own checks on each of jobs.ts's legs, and removes the stand-in whatever happened", () => {
    for (const name of JOB_NAMES.filter((job) => job !== "macos")) {
      const job = workflow.jobs[name]!
      const legs: Leg[] = legsOf(job, SERVER, RUN_CHECKS, name)
      expect({ name, legs }).toEqual({ name, legs: [...JOBS[name].legs] })
      const up = job.steps.find((step) => step.id === "up")!
      expect(up.name).toBe("Compile the runner and start the stand-in")
      expect(up.run).toContain(`| tee ${UP_LOG}`)
      const last = job.steps.at(-1)!
      expect(last.name).toBe("Remove the stand-in")
      expect(last.if).toBe("always()")
      expect(last.run).toContain(`bun --no-env-file ${SERVER} down --id "$id"`)
      expect(job.strategy === undefined).toBe(!JOBS[name].matrix)
      if (job.strategy) expect(job.strategy["fail-fast"]).toBe(false)
    }
  })

  test("macos has no Docker and no stand-in: it runs its checks and hands on fingerprint and plan", () => {
    const macos = workflow.jobs.macos!
    expect(macos.outputs).toEqual({
      fingerprint: "${{ steps.checks.outputs.fingerprint }}",
      plan: "${{ steps.checks.outputs.plan }}",
    })
    const checks = macos.steps.find((step) => step.id === "checks")!
    expect(checks.run).toBe(`bun --no-env-file ${RUN_CHECKS} --job macos`)
    expect(macos.steps.some((step) => step.run?.includes(SERVER))).toBe(false)
    const handed = workflow.jobs.checks!.steps.find((step) =>
      step.run?.includes(RUN_CHECKS)
    )!
    expect(handed.env).toMatchObject({
      ZEKNO_MACOS_FINGERPRINT: "${{ needs.macos.outputs.fingerprint }}",
      ZEKNO_MACOS_PLAN: "${{ needs.macos.outputs.plan }}",
    })
  })

  test("a skip line comes from run-checks.ts, never from the workflow; each B and R id or part names T010's task or its file", () => {
    for (const word of [
      "skipped",
      "not written yet",
      'echo "B',
      'echo "R',
      'echo "L',
    ])
      expect({ word, written: text.includes(word) }).toEqual({
        word,
        written: false,
      })
    const tasks: Record<string, string> = {
      "B1 (Dockerfile part)": "T173",
      "B1 (Railpack part)": "T247",
      B2: "T166",
      "B3 (fingerprint part)": "T166",
      "B3 (Railpack part)": "T247",
      "B4 (proof part)": "T168",
      "B4 (ARM64 part)": "T173",
      B5: "T171",
      B6: "T174",
      R1: "T219",
      R2: "T217",
      R3: "T217",
      R4: "T220",
      R5: "T219",
      R6: "T214",
      R7: "T220",
      R8: "T220",
      R9: "T220",
      R10: "T220",
      R16: "T218",
    }
    const units = (
      [
        "B1",
        "B2",
        "B3",
        "B4",
        "B5",
        "B6",
        "R1",
        "R2",
        "R3",
        "R4",
        "R5",
        "R6",
        "R7",
        "R8",
        "R9",
        "R10",
        "R16",
      ] as CheckId[]
    ).flatMap((id) => unitsOf(id))
    expect(units.map((unit) => unit.label).sort()).toEqual(
      Object.keys(tasks).sort()
    )
    for (const unit of units)
      expect({
        unit: unit.label,
        place: isTask(unit.place) ? unit.place : tasks[unit.label],
      }).toEqual({ unit: unit.label, place: tasks[unit.label] })
  })
})

describe("linux checks: names, SSH and pins (LC8 to LC10)", () => {
  test("LC8 and LC9: no Docker or SSH of its own, nothing privileged, no address but the stand-in's", () => {
    for (const run of runs) {
      expect({
        run,
        docker:
          /(?:^|[\s;&|(])(?:docker|ssh|scp|sftp|rsync|ssh-keygen)\s/m.test(run),
      }).toEqual({ run, docker: false })
    }
    expect(text.includes("--privileged")).toBe(false)
    expect(text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).toEqual([])
  })

  test("LC10: no engine version, package version or digest written in the file; all come from pins.json", () => {
    const pins = loadPins()
    const values = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.values(value).flatMap(values)
          : []
    for (const value of values(pins).filter(
      (item) => /\d/.test(item) && item !== pins.lookedUp
    ))
      expect({ value, written: text.includes(value) }).toEqual({
        value,
        written: false,
      })
    for (const engine of Object.values(pins.engines))
      expect({
        engine: engine.engine,
        written: text.includes(engine.engine),
      }).toEqual({ engine: engine.engine, written: false })
    expect(text.includes("sha256")).toBe(false)
    const withoutActionTags = text.replace(/ # v\d+\.\d+\.\d+$/gm, "")
    expect(withoutActionTags.match(/\d+\.\d+\.\d+/g) ?? []).toEqual([])
  })
})
