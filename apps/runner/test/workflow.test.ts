/**
 * The shape of the two workflows (contracts/release.md, "The workflow" and
 * "main-versions.yml"), read from their files. What they check lives in
 * apps/runner/scripts/release.ts and is tested in release.test.ts; this
 * file holds what only the YAML can get wrong: when they run, what they may
 * do, and how values reach a shell.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

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
        const install = job.steps.findIndex((step) => step.run?.trim() === "bun install --frozen-lockfile")
        const script = job.steps.findIndex((step) => step.run?.includes("apps/runner/scripts/release.ts"))
        expect(install).toBeGreaterThan(-1)
        expect(script).toBeGreaterThan(install)
      }
    })
  }
})

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
      const setup = job.steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@"))!
      expect(setup.with).toEqual({ "bun-version": "${{ needs.check.outputs.bun }}" })
    }
    expect(text.match(/--prerelease/g)).toHaveLength(1)
  })

  test("the token is given to the publishing step alone", () => {
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) {
        const holds = Object.values(step.env ?? {}).some((value) => value.includes("github.token"))
        expect({ step: step.name, holds }).toEqual({ step: step.name, holds: (step.run ?? "").includes("gh release create") })
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
