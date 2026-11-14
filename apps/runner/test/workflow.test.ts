/**
 * The shape of the two workflows (contracts/release.md, "The workflow" and
 * "main-versions.yml"), read from their files. What they check lives in
 * apps/runner/scripts/release.ts and is tested in release.test.ts; this
 * file holds what only the YAML can get wrong: when they run, what they may
 * do, and how values reach a shell.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { ORDERED_VERSIONS, REFUSED_VERSIONS } from "../../../packages/core/test/fixtures/versions"
import { parseTag } from "../scripts/release-lib"
import { tempDir } from "./helpers"

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string>; id?: string; "working-directory"?: string }
type Job = {
  needs?: string | string[]
  if?: string
  environment?: unknown
  permissions?: Record<string, string>
  outputs?: Record<string, string>
  env?: unknown
  steps: Step[]
}
type Workflow = { name: string; on: Record<string, unknown>; permissions: unknown; concurrency?: unknown; jobs: Record<string, Job> }

const WORKFLOWS = join(import.meta.dir, "../../../.github/workflows")
const read = (name: string) => {
  const text = readFileSync(join(WORKFLOWS, name), "utf8")
  return { text, workflow: Bun.YAML.parse(text) as Workflow }
}

const release = read("runner-release.yml")
const versions = read("main-versions.yml")
const steps = (workflow: Workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps)
const runs = (job: Job) => job.steps.map((step) => step.run ?? "").join("\n")

describe("both workflows", () => {
  for (const [name, { text, workflow }] of [
    ["runner-release.yml", release],
    ["main-versions.yml", versions],
  ] as const) {
    test(`${name}: no permission by default, every action pinned to a commit, no credentials kept, no expression inside a shell, no secret`, () => {
      expect(workflow.permissions).toEqual({})
      for (const step of steps(workflow)) {
        if (step.uses !== undefined) expect({ uses: step.uses, pinned: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(step.uses) }).toEqual({ uses: step.uses, pinned: true })
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false)
        if (step.run !== undefined) expect({ run: step.run, expression: step.run.includes("${{") }).toEqual({ run: step.run, expression: false })
      }
      expect(text).not.toContain("secrets.")
      for (const job of Object.values(workflow.jobs)) {
        expect(job.env).toBeUndefined()
        for (const [scope, access] of Object.entries(job.permissions ?? {})) expect({ scope, access }).toEqual({ scope: "contents", access: access === "write" ? "write" : "read" })
      }
      // The pinned commits are the ones the repository already used (feature 004, U5).
      const pins = new Set(steps(workflow).flatMap((step) => (step.uses ? [step.uses] : [])))
      expect([...pins].sort()).toEqual(["actions/checkout@11d5960a326750d5838078e36cf38b85af677262", "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6"])
      // Every checkout is followed by a frozen install before any script of the repository runs.
      for (const job of Object.values(workflow.jobs)) {
        const install = job.steps.findIndex((step) => step.run?.trim() === "bun install --frozen-lockfile --ignore-scripts")
        const script = job.steps.findIndex((step) => step.run?.includes("apps/runner/scripts/release.ts"))
        expect(install).toBeGreaterThan(-1)
        expect(script).toBeGreaterThan(install)
      }
    })

    test(`${name}: every install runs no package's scripts, so the second build installs the same way (security review RV1)`, () => {
      const installs = steps(workflow).filter((step) => /\bbun (install|i|add|ci)\b/.test(step.run ?? ""))
      expect(installs.length).toBe(Object.keys(workflow.jobs).length)
      for (const step of installs) expect(step.run!.trim()).toBe("bun install --frozen-lockfile --ignore-scripts")
      expect(text.match(/bun install/g)).toHaveLength(installs.length)
    })
  }
})

/** Runs a step's script as GitHub runs it on Linux (`bash --noprofile --norc -eo pipefail`), with the step's own environment. */
function runStep(step: Step, env: Record<string, string>): { code: number; output: string; stderr: string } {
  const dir = tempDir("step")
  const script = join(dir, "step.sh")
  const output = join(dir, "output")
  writeFileSync(script, step.run!)
  writeFileSync(output, "")
  const stepEnv = Object.fromEntries(Object.entries(step.env ?? {}).filter(([, value]) => !value.includes("${{")))
  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", script], {
    env: { PATH: "/usr/bin:/bin", ...stepEnv, ...env, GITHUB_OUTPUT: output },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { code: result.exitCode, output: readFileSync(output, "utf8"), stderr: result.stderr.toString() }
}

describe("runner-release.yml", () => {
  const { workflow, text } = release
  const jobs = workflow.jobs

  test("runs on a runner-v* tag, and on nothing else", () => {
    expect(workflow.on).toEqual({ push: { tags: ["runner-v*"] } })
  })

  test("three jobs: check, then the dev or the prod release, chosen by check", () => {
    expect(Object.keys(jobs)).toEqual(["check", "release-dev", "release-prod"])
    expect(jobs["check"]!.needs).toBeUndefined()
    expect(jobs["check"]!.if).toBeUndefined()
    for (const [name, environment] of [
      ["release-dev", "dev"],
      ["release-prod", "prod"],
    ] as const) {
      expect([jobs[name]!.needs].flat()).toEqual(["check"])
      expect(jobs[name]!.if).toBe(`needs.check.outputs.environment == '${environment}'`)
    }
    expect(jobs["check"]!.outputs).toEqual({
      environment: "${{ steps.check.outputs.environment }}",
      version: "${{ steps.check.outputs.version }}",
      commit: "${{ steps.check.outputs.commit }}",
      bun: "${{ steps.check.outputs.bun }}",
    })
  })

  test("only the prod release waits in the prod environment; only the release jobs may write", () => {
    expect(jobs["check"]!.environment).toBeUndefined()
    expect(jobs["release-dev"]!.environment).toBeUndefined()
    expect(jobs["release-prod"]!.environment).toBe("prod")
    expect(text.match(/environment: prod/g)).toHaveLength(1)
    expect(jobs["check"]!.permissions).toEqual({ contents: "read" })
    expect(jobs["release-dev"]!.permissions).toEqual({ contents: "write" })
    expect(jobs["release-prod"]!.permissions).toEqual({ contents: "write" })
  })

  test("check sees every branch, and its four lines become the job's outputs", () => {
    const checkout = jobs["check"]!.steps.find((step) => step.uses?.startsWith("actions/checkout@"))!
    expect(checkout.with).toEqual({ "fetch-depth": 0, "persist-credentials": false })
    const check = jobs["check"]!.steps.find((step) => step.id === "check")!
    expect(check.run!.trim()).toBe('bun apps/runner/scripts/release.ts check --tag "$TAG" >> "$GITHUB_OUTPUT"')
    expect(check.env).toEqual({ TAG: "${{ github.ref_name }}" })
    // The release jobs check out one commit only.
    for (const name of ["release-dev", "release-prod"]) {
      const theirs = jobs[name]!.steps.find((step) => step.uses?.startsWith("actions/checkout@"))!
      expect(theirs.with).toEqual({ "persist-credentials": false })
    }
  })

  test("both release jobs build, check and publish the same way; only dev is a pre-release, never latest", () => {
    for (const name of ["release-dev", "release-prod"]) {
      const job = jobs[name]!
      const all = runs(job)
      expect(all).toContain("bun run compile:linux-x64")
      expect(all).toContain("bun run compile:linux-arm64")
      expect(all).toContain('bun apps/runner/scripts/release.ts files --tag "$TAG" --commit "$COMMIT" --bun "$BUN"')
      const view = all.indexOf('gh release view "$TAG"')
      const create = all.indexOf('gh release create "$TAG"')
      expect(view).toBeGreaterThan(-1)
      expect(create).toBeGreaterThan(view)
      expect(all).toContain("--verify-tag")
      expect(all).toContain("--notes-file RELEASE-NOTES.md")
      expect(all).toContain("zekno-runner-linux-x64.gz zekno-runner-linux-arm64.gz SHA256SUMS RELEASE-NOTES.md")
      expect(all.includes("--prerelease --latest=false")).toBe(name === "release-dev")
      // The Bun the job sets up is read from the commit in the job itself, as `check` reads it.
      const pin = job.steps.findIndex((step) => step.id === "pin")
      const setup = job.steps.findIndex((step) => step.uses?.startsWith("oven-sh/setup-bun@"))
      expect(pin).toBeGreaterThan(-1)
      expect(setup).toBeGreaterThan(pin)
      expect(job.steps[pin]!.run).toBe(jobs["check"]!.steps.find((step) => step.id === "pin")!.run)
      expect(job.steps[setup]!.with).toEqual({ "bun-version": "${{ steps.pin.outputs.bun }}" })
    }
    expect(text.match(/--prerelease/g)).toHaveLength(1)
  })

  test("each release job's first step works out from the tag itself that it is of its kind, before anything is checked out, set up or installed (security review RV1)", () => {
    for (const [name, environment, refusal] of [
      ["release-dev", "dev", "This tag is not runner-v<x.y.z>-dev.<n>. This job publishes development releases only.\n"],
      ["release-prod", "prod", "This tag is not runner-v<x.y.z>. This job publishes prod releases only.\n"],
    ] as const) {
      const first = jobs[name]!.steps[0]!
      expect(first.uses).toBeUndefined()
      expect(first.id).toBe("tag")
      // The tag comes from GitHub, never from the `check` job; bash compares it in the C locale.
      expect(first.env).toEqual({ TAG: "${{ github.ref_name }}", LC_ALL: "C" })
      // The same grammar as the scripts: every tag the tests know, valid and refused, and some hostile ones.
      const tags = [
        ...ORDERED_VERSIONS.map((version) => `runner-v${version}`),
        ...REFUSED_VERSIONS.map((version) => `runner-v${version}`),
        "runner-v",
        "runner-0.1.0",
        "xrunner-v0.1.0",
        "runner-v0.1.0-dev.1\nrunner-v0.1.0",
        "runner-v0.1.0\n",
        "runner-v٣.1.0",
        "runner-v0.1.0-dev.١",
        "runner-v１.0.0",
      ]
      for (const tag of tags) {
        const parsed = parseTag(tag)
        const run = runStep(first, { TAG: tag })
        const passes = parsed?.environment === environment
        // A refusal is one fixed sentence: it never repeats the tag.
        expect({ name, tag, code: run.code, output: run.output, stderr: run.stderr }).toEqual({
          name,
          tag,
          code: passes ? 0 : 1,
          output: passes ? `version=${parsed!.version}\n` : "",
          stderr: passes ? "" : refusal,
        })
      }
      // Nothing from the repository comes before it.
      expect(jobs[name]!.steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"))).toBe(1)
    }
  })

  test("the release jobs take from `check` only the commit, which `files` checks against the checkout; the version and the Bun version are their own", () => {
    for (const name of ["release-dev", "release-prod"]) {
      const job = jobs[name]!
      const used = new Set(job.steps.flatMap((step) => [...JSON.stringify(step).matchAll(/needs\.check\.outputs\.([a-z]+)/g)].map(([, output]) => output)))
      expect([...used]).toEqual(["commit"])
      const files = job.steps.find((step) => step.run?.includes("release.ts files"))!
      expect(files.env).toEqual({ TAG: "${{ github.ref_name }}", COMMIT: "${{ needs.check.outputs.commit }}", BUN: "${{ steps.pin.outputs.bun }}" })
      const publish = job.steps.find((step) => step.run?.includes("gh release create"))!
      expect(publish.env).toEqual({ GH_TOKEN: "${{ github.token }}", TAG: "${{ github.ref_name }}", VERSION: "${{ steps.tag.outputs.version }}" })
    }
  })

  test("the token is named only in the publishing step's environment; actions/checkout gets it by default, to read, and keeps none of it", () => {
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) {
        const holds = Object.values(step.env ?? {}).some((value) => value.includes("github.token"))
        expect({ step: step.name, holds }).toEqual({ step: step.name, holds: (step.run ?? "").includes("gh release create") })
        // No step is handed the token as an input; checkout's own default is the one it reads with.
        expect(Object.keys(step.with ?? {})).not.toContain("token")
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false)
      }
    }
    expect(text.match(/github\.token/g)).toHaveLength(2)
  })
})

describe("main-versions.yml", () => {
  const { workflow } = versions

  test("runs on pushes to main and pull requests into main, and checks that main carries no dev version", () => {
    expect(workflow.on).toEqual({ push: { branches: ["main"] }, pull_request: { branches: ["main"] } })
    expect(Object.keys(workflow.jobs)).toHaveLength(1)
    const job = Object.values(workflow.jobs)[0]!
    expect(job.permissions).toEqual({ contents: "read" })
    expect(job.environment).toBeUndefined()
    expect(runs(job)).toContain("bun apps/runner/scripts/release.ts check-main")
  })
})
