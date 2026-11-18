/**
 * The check every pull request runs, `.github/workflows/pull-request-checks.yml`
 * (specs/012-templates, contracts/contributing.md, "The check", CW1 to CW8;
 * research R13; plan.md, D29; tasks T038): read as text and with
 * `Bun.YAML.parse`, and held to each property the maintainer approved, so a
 * change that loosens one fails here. It is the contract's file, byte for
 * byte, with the one addition of specs/014-deploy-v2 (N2, decided yes; tasks
 * T082): the checkout fetches the whole history, which the pairing tests
 * read. The contract stays as that feature's record.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")
const FILE = join(ROOT, ".github/workflows/pull-request-checks.yml")
const CONTRACT = join(ROOT, "specs/012-templates/contracts/contributing.md")

type Step = {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  "working-directory"?: string
  env?: Record<string, unknown>
}
type Job = {
  "runs-on"?: string
  "timeout-minutes"?: number
  permissions?: unknown
  env?: Record<string, unknown>
  steps: Step[]
}
type Workflow = {
  name?: string
  on: Record<string, unknown>
  permissions: unknown
  concurrency?: { group?: string; "cancel-in-progress"?: boolean }
  jobs: Record<string, Job>
}

/** The line of the contract's file that feature 014's addition follows. */
const CREDENTIALS = "          persist-credentials: false\n"
/** Feature 014's addition (N2): the whole history, for the pairing tests. Nothing else of the file changes. */
const WHOLE_HISTORY = [
  "          # The whole history, which is the repository's own and public: the pairing tests\n",
  "          # (specs/014-deploy-v2) read runner-v0.1.0 and e7b0146 from it.\n",
  "          fetch-depth: 0\n",
].join("")

const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : ""
const workflow = (text === "" ? { jobs: {} } : Bun.YAML.parse(text)) as Workflow
const jobs = Object.values(workflow.jobs ?? {})
const steps = jobs.flatMap((job) => job.steps ?? [])

/** The actions `main-versions.yml` pins, by `owner/repo`: the commit each `uses:` names there. */
const PINNED = new Map(
  [
    ...readFileSync(
      join(ROOT, ".github/workflows/main-versions.yml"),
      "utf8"
    ).matchAll(/uses:\s*([^@\s]+)@([0-9a-f]{40})/g),
  ].map((match) => [match[1]!, match[2]!])
)

describe("the check on GitHub (contracts/contributing.md, CW1 to CW8)", () => {
  test("the file is there, and is the contract's file byte for byte, with feature 014's addition only", () => {
    expect(existsSync(FILE)).toBe(true)
    const contract = readFileSync(CONTRACT, "utf8")
    const block = /## The check[^\n]*\n[\s\S]*?```yaml\n([\s\S]*?)```/.exec(
      contract
    )?.[1]
    expect(block).toBeDefined()
    expect(block!.split(CREDENTIALS)).toHaveLength(2)
    expect(text).toBe(block!.replace(CREDENTIALS, CREDENTIALS + WHOLE_HISTORY))
  })

  test("CW1: it runs on pull_request only, never pull_request_target", () => {
    expect(Object.keys(workflow.on ?? {})).toEqual(["pull_request"])
    // The comment at the top names it to say it is never used; no line of the workflow itself does.
    const lines = text
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n")
    expect(lines).not.toContain("pull_request_target")
    expect(lines).not.toMatch(/workflow_run|issue_comment|push:/)
  })

  test("CW2: no permission at the top; the one job reads the code and nothing else", () => {
    expect(workflow.permissions).toEqual({})
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.permissions).toEqual({ contents: "read" })
  })

  test("CW3: every action pinned to a full commit, the one main-versions.yml pins for it", () => {
    const used = steps.flatMap((step) =>
      step.uses === undefined ? [] : [step.uses]
    )
    expect(used.length).toBeGreaterThan(0)
    for (const uses of used) {
      const [action, commit] = uses.split("@")
      expect({
        uses,
        pinned: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(uses),
      }).toEqual({ uses, pinned: true })
      expect({ action, commit }).toEqual({
        action,
        commit: PINNED.get(action!),
      })
    }
    expect([...new Set(used.map((uses) => uses.split("@")[0]))].sort()).toEqual(
      ["actions/checkout", "oven-sh/setup-bun"]
    )
  })

  test("CW4: the checkout keeps no credentials, and fetches the whole history (specs/014-deploy-v2, N2)", () => {
    const checkout = steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@")
    )
    expect(checkout).toHaveLength(1)
    expect(checkout[0]!.with).toEqual({
      "persist-credentials": false,
      "fetch-depth": 0,
    })
  })

  test("CW5: no secret, and nothing of the event but the pull request's number, which no shell reads", () => {
    expect(text).not.toContain("secrets.")
    expect(text).not.toContain("secrets[")
    const event = [...text.matchAll(/github\.event\.[A-Za-z0-9_.]+/g)].map(
      (match) => match[0]
    )
    expect(event).toEqual(["github.event.pull_request.number"])
    expect(workflow.concurrency?.group).toBe(
      "pull-request-checks-${{ github.event.pull_request.number }}"
    )
    for (const step of steps) {
      expect({
        step: step.name,
        expression: (step.run ?? "").includes("${{"),
      }).toEqual({ step: step.name, expression: false })
      expect(step.env).toBeUndefined()
    }
    expect(jobs[0]!.env).toEqual({
      TURBO_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    })
  })

  test("CW6: the lockfile as committed, and no package's install script", () => {
    const install = steps.filter((step) => step.name === "Install")
    expect(install.map((step) => step.run)).toEqual([
      "bun install --frozen-lockfile --ignore-scripts",
    ])
    expect(
      steps.filter((step) => /\bbun (install|i|add)\b/.test(step.run ?? ""))
    ).toEqual(install)
  })

  test("CW7: the types, the lint rules, every test, then the template tests in apps/cli, in that order, after the install", () => {
    const commands = steps
      .filter((step) => step.run !== undefined && !step.run.includes("\n"))
      .map((step) => [step.run, step["working-directory"]])
    expect(commands).toEqual([
      ["bun install --frozen-lockfile --ignore-scripts", undefined],
      ["bun run typecheck", undefined],
      ["bun run lint", undefined],
      ["bun run test", undefined],
      ["bun run test:templates", "apps/cli"],
    ])
    expect(text).not.toContain("bun run build")
  })

  test("CW8: a run that hangs ends; a newer push replaces an older run", () => {
    expect(jobs[0]!["timeout-minutes"]).toBe(30)
    expect(jobs[0]!["runs-on"]).toBe("ubuntu-24.04")
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(true)
  })

  test("the template tests are the script CW7 names", () => {
    const scripts = (
      JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as {
        scripts: Record<string, string>
      }
    ).scripts
    expect(scripts["test:templates"]).toBe(
      "ZEKNO_TEMPLATES_DOCKER=1 bun test test/templates"
    )
  })
})
