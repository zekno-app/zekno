/**
 * The shape of the two workflows (contracts/release.md, "The workflow" and
 * "main-versions.yml"), read from their files. What they check lives in
 * apps/runner/scripts/release.ts and is tested in release.test.ts; this
 * file holds what only the YAML can get wrong: when they run, what they may
 * do, how values reach a shell, and what the job that can write trusts of
 * what the build handed it (security review RV1). The steps that hold logic
 * of their own are run here with bash, as GitHub runs them.
 */
import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { ORDERED_VERSIONS, REFUSED_VERSIONS } from "../../../../packages/core/test/fixtures/versions"
import { parseTag, RELEASE_FILES, releaseNotes, sha256sumsText } from "../../scripts/release-lib"
import { tempDir } from "../support/helpers"

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

const WORKFLOWS = join(import.meta.dir, "../../../../.github/workflows")
const read = (name: string) => {
  const text = readFileSync(join(WORKFLOWS, name), "utf8")
  return { text, workflow: Bun.YAML.parse(text) as Workflow }
}

const release = read("runner-release.yml")
const versions = read("main-versions.yml")
const steps = (workflow: Workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps)
const runs = (job: Job) => job.steps.map((step) => step.run ?? "").join("\n")
const checksOut = (job: Job) => job.steps.some((step) => step.uses?.startsWith("actions/checkout@"))

/** Every action either workflow uses, pinned to the full commit of the release named beside it. */
const PINS = {
  checkout: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  setupBun: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
  upload: "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
  download: "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
}

const ENVIRONMENTS = ["dev", "prod"] as const
const BUILD = { dev: "build-dev", prod: "build-prod" } as const
const PUBLISH = { dev: "publish-dev", prod: "publish-prod" } as const
/** The artifact the build job hands on and the publish job takes: one name, and how long it is kept. */
const ARTIFACT = "runner-release"
const RETENTION = { dev: 1, prod: 30 } as const
const FILES = [...RELEASE_FILES]

describe("both workflows", () => {
  for (const [name, { text, workflow }, pins] of [
    ["runner-release.yml", release, [PINS.checkout, PINS.download, PINS.upload, PINS.setupBun]],
    ["main-versions.yml", versions, [PINS.checkout, PINS.setupBun]],
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
      // The commits of checkout and setup-bun are the ones the repository already used (feature 004, U5);
      // the two artifact actions are v7.0.2 and v8.0.2, read from each repository's tags (research.md, Q11).
      const used = new Set(steps(workflow).flatMap((step) => (step.uses ? [step.uses] : [])))
      expect([...used].sort()).toEqual([...pins].sort())
      // Every job that checks out the repository installs, frozen, before any script of it runs.
      for (const job of Object.values(workflow.jobs).filter(checksOut)) {
        const install = job.steps.findIndex((step) => step.run?.trim() === "bun install --frozen-lockfile --ignore-scripts")
        const script = job.steps.findIndex((step) => step.run?.includes("apps/runner/scripts/release.ts"))
        expect(install).toBeGreaterThan(-1)
        expect(script).toBeGreaterThan(install)
      }
    })

    test(`${name}: every install runs no package's scripts, so the second build installs the same way (security review RV1)`, () => {
      const installs = steps(workflow).filter((step) => /\bbun (install|i|add|ci)\b/.test(step.run ?? ""))
      expect(installs.length).toBe(Object.values(workflow.jobs).filter(checksOut).length)
      for (const step of installs) expect(step.run!.trim()).toBe("bun install --frozen-lockfile --ignore-scripts")
      expect(text.match(/bun install/g)).toHaveLength(installs.length)
    })
  }
})

/** The commands GitHub's machine has that a step here may use, wherever this test runs (macOS keeps `sha256sum` in /sbin). */
const STEP_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"

/**
 * Runs a step's script as GitHub runs it on Linux (`bash --noprofile --norc -eo pipefail`), with
 * the step's own environment and in `cwd`. Values GitHub would fill in are given by `env`.
 */
function runStep(step: Step, env: Record<string, string>, cwd?: string): { code: number; output: string; stdout: string; stderr: string } {
  const dir = tempDir("step")
  const script = join(dir, "step.sh")
  const output = join(dir, "output")
  writeFileSync(script, step.run!)
  writeFileSync(output, "")
  const stepEnv = Object.fromEntries(Object.entries(step.env ?? {}).filter(([, value]) => !value.includes("${{")))
  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", script], {
    cwd,
    env: { PATH: STEP_PATH, TMPDIR: dir, ...stepEnv, ...env, GITHUB_OUTPUT: output },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { code: result.exitCode, output: readFileSync(output, "utf8"), stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

describe("runner-release.yml", () => {
  const { workflow, text } = release
  const jobs = workflow.jobs

  test("runs on a runner-v* tag, and on nothing else", () => {
    expect(workflow.on).toEqual({ push: { tags: ["runner-v*"] } })
  })

  test("five jobs: check, then for the kind check found a build job, then a publish job that needs it", () => {
    expect(Object.keys(jobs)).toEqual(["check", "build-dev", "publish-dev", "build-prod", "publish-prod"])
    expect(jobs["check"]!.needs).toBeUndefined()
    expect(jobs["check"]!.if).toBeUndefined()
    for (const environment of ENVIRONMENTS) {
      expect([jobs[BUILD[environment]]!.needs].flat()).toEqual(["check"])
      expect(jobs[BUILD[environment]]!.if).toBe(`needs.check.outputs.environment == '${environment}'`)
      // A job whose needs were skipped is skipped too ("Workflow syntax", jobs.<job_id>.needs): a publish job never runs without its build.
      expect([jobs[PUBLISH[environment]]!.needs].flat()).toEqual([BUILD[environment]])
      expect(jobs[PUBLISH[environment]]!.if).toBeUndefined()
    }
    expect(jobs["check"]!.outputs).toEqual({
      environment: "${{ steps.check.outputs.environment }}",
      version: "${{ steps.check.outputs.version }}",
      commit: "${{ steps.check.outputs.commit }}",
      bun: "${{ steps.check.outputs.bun }}",
    })
  })

  test("only the two publish jobs may write; only publish-prod waits in the prod environment, so the approval guards the token", () => {
    const writers = Object.entries(jobs).flatMap(([name, job]) => (job.permissions?.["contents"] === "write" ? [name] : []))
    expect(writers).toEqual(["publish-dev", "publish-prod"])
    for (const name of ["check", "build-dev", "build-prod"]) expect(jobs[name]!.permissions).toEqual({ contents: "read" })
    for (const name of ["publish-dev", "publish-prod"]) expect(jobs[name]!.permissions).toEqual({ contents: "write" })
    const waiting = Object.entries(jobs).flatMap(([name, job]) => (job.environment === undefined ? [] : [name]))
    expect(waiting).toEqual(["publish-prod"])
    expect(jobs["publish-prod"]!.environment).toBe("prod")
    expect(text.match(/environment: prod/g)).toHaveLength(1)
  })

  test("check sees every branch, and its four lines become the job's outputs; each build job checks out one commit", () => {
    const checkout = jobs["check"]!.steps.find((step) => step.uses?.startsWith("actions/checkout@"))!
    expect(checkout.with).toEqual({ "fetch-depth": 0, "persist-credentials": false })
    const check = jobs["check"]!.steps.find((step) => step.id === "check")!
    expect(check.run!.trim()).toBe('bun apps/runner/scripts/release.ts check --tag "$TAG" >> "$GITHUB_OUTPUT"')
    expect(check.env).toEqual({ TAG: "${{ github.ref_name }}" })
    for (const environment of ENVIRONMENTS) {
      const theirs = jobs[BUILD[environment]]!.steps.find((step) => step.uses?.startsWith("actions/checkout@"))!
      expect(theirs.with).toEqual({ "persist-credentials": false })
    }
  })

  test("both build jobs build and check the same way, and hand on exactly the four files as one artifact, last", () => {
    for (const environment of ENVIRONMENTS) {
      const job = jobs[BUILD[environment]]!
      const all = runs(job)
      expect(all).toContain("bun run compile:linux-x64")
      expect(all).toContain("bun run compile:linux-arm64")
      expect(all).toContain('bun apps/runner/scripts/release.ts files --tag "$TAG" --commit "$COMMIT" --bun "$BUN"')
      expect(all).not.toContain("gh ")
      // The Bun the job sets up is read from the commit in the job itself, as `check` reads it.
      const pin = job.steps.findIndex((step) => step.id === "pin")
      const setup = job.steps.findIndex((step) => step.uses?.startsWith("oven-sh/setup-bun@"))
      expect(pin).toBeGreaterThan(-1)
      expect(setup).toBeGreaterThan(pin)
      expect(job.steps[pin]!.run).toBe(jobs["check"]!.steps.find((step) => step.id === "pin")!.run)
      expect(job.steps[setup]!.with).toEqual({ "bun-version": "${{ steps.pin.outputs.bun }}" })
      // The upload: the four files by name, from where `release.ts files` wrote them, at the artifact's top
      // level (the least common ancestor of the paths, actions/upload-artifact's README); none found is an error.
      const upload = job.steps.at(-1)!
      expect(upload.uses).toBe(PINS.upload)
      expect(upload.with).toEqual({
        name: ARTIFACT,
        path: `${FILES.map((file) => `apps/runner/dist/${file}`).join("\n")}\n`,
        "if-no-files-found": "error",
        "retention-days": RETENTION[environment],
        "compression-level": 0,
      })
      expect(job.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"))).toHaveLength(1)
      expect(job.steps.findIndex((step) => step.run?.includes("release.ts files"))).toBe(job.steps.length - 2)
    }
  })

  test("each publish job checks out nothing, sets up nothing, installs nothing and runs no bun: it takes the artifact, checks it, and runs gh", () => {
    for (const environment of ENVIRONMENTS) {
      const job = jobs[PUBLISH[environment]]!
      expect(job.steps.map((step) => step.uses ?? step.name)).toEqual([
        `Check that the tag is a ${environment} release's`,
        PINS.download,
        "Check the four files",
        environment === "dev" ? "Publish the pre-release" : "Publish the release",
      ])
      expect(job.steps[1]!.with).toEqual({ name: ARTIFACT, path: "release" })
      expect(JSON.stringify(job)).not.toMatch(/actions\/checkout|setup-bun|\bbun\b|\bnpm\b|\bnpx\b|node /)
      // The two steps that read the files work in the folder the artifact went to, and nowhere else.
      for (const step of job.steps.slice(2)) expect(step["working-directory"]).toBe("release")
      // Nothing it was handed is run, sourced, evaluated, made executable or handed to another shell.
      for (const step of job.steps) {
        const script = step.run ?? ""
        expect({ step: step.name, runs: /(^|[\s;|&(])(\.\/|\.\s|source\s|eval\s|exec\s|bash\s|sh\s|chmod\s|xargs\s|env\s)|`|\$\(\s*(cat|<)|sha256sum\s+-c/m.test(script) }).toEqual({
          step: step.name,
          runs: false,
        })
      }
      // The same checks and the same publishing for both kinds; only dev is a pre-release, never latest.
      const check = job.steps[2]!
      expect(check.run).toBe(jobs[PUBLISH.dev]!.steps[2]!.run)
      expect(check.env).toEqual({ LC_ALL: "C" })
      const publish = job.steps[3]!.run!
      const view = publish.indexOf('gh release view "$TAG"')
      const create = publish.indexOf('gh release create "$TAG"')
      expect(view).toBeGreaterThan(-1)
      expect(create).toBeGreaterThan(view)
      expect(publish).toContain("--verify-tag")
      expect(publish).toContain("--notes-file RELEASE-NOTES.md")
      expect(publish).toContain(FILES.join(" "))
      expect(publish.includes("--prerelease --latest=false")).toBe(environment === "dev")
      expect(publish.replace(" \\\n  --prerelease --latest=false", "")).toBe(jobs[PUBLISH.prod]!.steps[3]!.run!)
    }
    expect(text.match(/--prerelease/g)).toHaveLength(1)
  })

  test("each job after check works out from the tag itself, in its first step, that it is of its kind, before anything is checked out, set up, installed or downloaded (security review RV1)", () => {
    for (const [name, environment, refusal] of [
      ["build-dev", "dev", "This tag is not runner-v<x.y.z>-dev.<n>. This job publishes development releases only.\n"],
      ["publish-dev", "dev", "This tag is not runner-v<x.y.z>-dev.<n>. This job publishes development releases only.\n"],
      ["build-prod", "prod", "This tag is not runner-v<x.y.z>. This job publishes prod releases only.\n"],
      ["publish-prod", "prod", "This tag is not runner-v<x.y.z>. This job publishes prod releases only.\n"],
    ] as const) {
      const first = jobs[name]!.steps[0]!
      expect(first.uses).toBeUndefined()
      expect(first.id).toBe("tag")
      expect(first.run).toBe(jobs[BUILD[environment]]!.steps[0]!.run)
      // The tag comes from GitHub, never from another job; bash compares it in the C locale.
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
    }
  })

  test("a build job takes from `check` only the commit, which `files` checks against the checkout; a publish job takes nothing from another job", () => {
    for (const environment of ENVIRONMENTS) {
      const build = jobs[BUILD[environment]]!
      const used = new Set(build.steps.flatMap((step) => [...JSON.stringify(step).matchAll(/needs\.check\.outputs\.([a-z]+)/g)].map(([, output]) => output)))
      expect([...used]).toEqual(["commit"])
      const files = build.steps.find((step) => step.run?.includes("release.ts files"))!
      expect(files.env).toEqual({ TAG: "${{ github.ref_name }}", COMMIT: "${{ needs.check.outputs.commit }}", BUN: "${{ steps.pin.outputs.bun }}" })
      expect(build.outputs).toBeUndefined()
      const publish = jobs[PUBLISH[environment]]!
      expect(JSON.stringify(publish.steps)).not.toContain("needs.")
      expect(publish.steps.at(-1)!.env).toEqual({ GH_TOKEN: "${{ github.token }}", TAG: "${{ github.ref_name }}", VERSION: "${{ steps.tag.outputs.version }}" })
    }
  })

  test("the token is named only in the publishing step's environment; actions/checkout gets it by default, to read, and keeps none of it", () => {
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) {
        const holds = Object.values(step.env ?? {}).some((value) => value.includes("github.token"))
        expect({ step: step.name, holds }).toEqual({ step: step.name, holds: (step.run ?? "").includes("gh release create") })
        // No step is handed the token as an input; checkout's own default is the one it reads with.
        expect(Object.keys(step.with ?? {})).not.toContain("token")
        expect(Object.keys(step.with ?? {})).not.toContain("github-token")
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false)
      }
    }
    expect(text.match(/github\.token/g)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// What the publish job does with what it was handed, run as GitHub runs it.

const ZEKNO_X64 = "zekno-runner-linux-x64"
const ZEKNO_ARM64 = "zekno-runner-linux-arm64"
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex")
const gzip = (text: string) => Bun.gzipSync(new TextEncoder().encode(text), { level: 9 })

/** A runner that, if anything ever ran it, would leave a mark. */
const hostile = (mark: string) => `#!/bin/sh\ntouch '${mark}'\n`

/**
 * The folder the artifact was downloaded to, as a good build hands it on: the four files
 * `release.ts files` writes. `mark` is a file that exists only if something ran what is in it.
 */
function handedOn(mark: string, notes?: string): string {
  const dir = join(tempDir("artifact"), "release")
  mkdirSync(dir)
  const x64 = hostile(mark)
  const arm64 = `${hostile(mark)}# arm64\n`
  writeFileSync(join(dir, `${ZEKNO_X64}.gz`), gzip(x64))
  writeFileSync(join(dir, `${ZEKNO_ARM64}.gz`), gzip(arm64))
  writeFileSync(join(dir, "SHA256SUMS"), sha256sumsText(sha256(x64), sha256(arm64)))
  writeFileSync(
    join(dir, "RELEASE-NOTES.md"),
    notes ?? releaseNotes({ version: "0.1.0-dev.1", environment: "dev", commit: "a".repeat(40), bun: "1.4.4", x64: sha256(x64), arm64: sha256(arm64) })
  )
  for (const file of FILES) chmodSync(join(dir, file), 0o755)
  return dir
}

describe("the publish job's check of the four files", () => {
  const step = release.workflow.jobs["publish-dev"]!.steps[2]!
  const REFUSED = "The build did not hand on exactly the four release files.\n"
  const mark = () => join(tempDir("mark"), "ran")
  const check = (dir: string) => runStep(step, {}, dir)

  test("passes the four files a good build hands on, and says what the runners unpack to", () => {
    const ran = mark()
    const dir = handedOn(ran)
    const result = check(dir)
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
    expect(result.stdout).toBe(`The four release files are there, and the runners unpack to what SHA256SUMS says:\n${readFileSync(join(dir, "SHA256SUMS"), "utf8")}`)
    expect(existsSync(ran)).toBe(false)
  })

  test("refuses anything but exactly the four files, as regular files: one missing, one more, a hidden one, a folder, a link", () => {
    const cases: [string, (dir: string) => void][] = [
      ["one missing", (dir) => Bun.spawnSync(["rm", join(dir, "SHA256SUMS")])],
      ["a fifth file", (dir) => writeFileSync(join(dir, "zekno-runner"), "x")],
      ["a hidden file", (dir) => writeFileSync(join(dir, ".gitconfig"), "[alias]\n")],
      ["a hidden folder", (dir) => mkdirSync(join(dir, ".git"))],
      ["a folder in place of one", (dir) => (Bun.spawnSync(["rm", join(dir, "RELEASE-NOTES.md")]), mkdirSync(join(dir, "RELEASE-NOTES.md")))],
      ["a link in place of one", (dir) => (Bun.spawnSync(["rm", join(dir, "RELEASE-NOTES.md")]), symlinkSync("/etc/hosts", join(dir, "RELEASE-NOTES.md")))],
      ["a name that is not one of them", (dir) => (Bun.spawnSync(["mv", join(dir, "SHA256SUMS"), join(dir, "SHA256SUMS.txt")]))],
    ]
    for (const [what, change] of cases) {
      const dir = handedOn(mark())
      change(dir)
      expect({ what, ...pick(check(dir)) }).toEqual({ what, code: 1, stderr: REFUSED })
    }
  })

  test("refuses SHA256SUMS that does not name the runners exactly as they unpack, in exactly its form", () => {
    const SUMS = "SHA256SUMS does not name the two runners as they unpack.\n"
    const cases: [string, (sums: string) => string][] = [
      ["one checksum another", (sums) => sums.replace(/^./, (first) => (first === "0" ? "1" : "0"))],
      ["the lines swapped", (sums) => sums.split("\n").slice(0, 2).reverse().join("\n") + "\n"],
      ["one space", (sums) => sums.replaceAll("  ", " ")],
      ["CRLF", (sums) => sums.replaceAll("\n", "\r\n")],
      ["no last line feed", (sums) => sums.slice(0, -1)],
      ["a third line", (sums) => `${sums}${"0".repeat(64)}  zekno-runner\n`],
      ["upper-case hex", (sums) => sums.toUpperCase().replaceAll("ZEKNO-RUNNER-LINUX", "zekno-runner-linux")],
    ]
    for (const [what, change] of cases) {
      const dir = handedOn(mark())
      writeFileSync(join(dir, "SHA256SUMS"), change(readFileSync(join(dir, "SHA256SUMS"), "utf8")))
      expect({ what, ...pick(check(dir)) }).toEqual({ what, code: 1, stderr: SUMS })
    }
    // A runner one byte different from the one SHA256SUMS names.
    const dir = handedOn(mark())
    writeFileSync(join(dir, `${ZEKNO_ARM64}.gz`), gzip(`${hostile("elsewhere")}# arm65\n`))
    expect(pick(check(dir))).toEqual({ code: 1, stderr: SUMS })
  })

  test("refuses a runner that is not gzip, has data after it, or unpacks to nothing or to more than 256 MiB", () => {
    const UNPACK = `${ZEKNO_X64}.gz does not unpack to one runner of at most 256 MiB.\n`
    const cases: [string, (path: string) => void][] = [
      ["not gzip", (path) => writeFileSync(path, "#!/bin/sh\n")],
      ["cut off", (path) => writeFileSync(path, readFileSync(path).subarray(0, 20))],
      ["data after it", (path) => writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("more")]))],
      ["unpacks to nothing", (path) => writeFileSync(path, gzip(""))],
      // 256 MiB and one byte of zeros, packed by gzip as a stream.
      ["unpacks to more than 256 MiB", (path) => Bun.spawnSync(["sh", "-c", 'head -c 268435457 /dev/zero | gzip -1 > "$0"', path])],
    ]
    for (const [what, change] of cases) {
      const dir = handedOn(mark())
      change(join(dir, `${ZEKNO_X64}.gz`))
      const result = check(dir)
      // gzip may say what it found first, on a line of its own.
      const said = result.stderr.split("\n").slice(0, -2)
      expect({ what, code: result.code, last: result.stderr.slice(-UNPACK.length), gzip: said.every((line) => line.startsWith("gzip: ")) }).toEqual({ what, code: 1, last: UNPACK, gzip: true })
    }
    // Nothing unpacked is left behind, whichever way it ended.
    const tmp = tempDir("unpacked")
    const dir = handedOn(mark())
    writeFileSync(join(dir, `${ZEKNO_X64}.gz`), "not gzip")
    expect(runStep(step, { TMPDIR: tmp }, dir).code).toBe(1)
    expect(Bun.spawnSync(["ls", "-A", tmp]).stdout.toString()).toBe("")
    expect(runStep(step, { TMPDIR: tmp }, handedOn(mark())).code).toBe(0)
    expect(Bun.spawnSync(["ls", "-A", tmp]).stdout.toString()).toBe("")
  })

  test("bounds every file's size: the notes are public text of at most 64 KiB", () => {
    const at = (bytes: number) => {
      const dir = handedOn(mark(), "n".repeat(bytes))
      return pick(check(dir))
    }
    expect(at(65536)).toEqual({ code: 0, stderr: "" })
    expect(at(65537)).toEqual({ code: 1, stderr: "RELEASE-NOTES.md is empty or larger than 64 KiB.\n" })
    expect(at(0)).toEqual({ code: 1, stderr: "RELEASE-NOTES.md is empty or larger than 64 KiB.\n" })
    const dir = handedOn(mark())
    writeFileSync(join(dir, "SHA256SUMS"), "0".repeat(4097))
    expect(pick(check(dir))).toEqual({ code: 1, stderr: "SHA256SUMS is empty or larger than 4 KiB.\n" })
    const empty = handedOn(mark())
    writeFileSync(join(empty, `${ZEKNO_ARM64}.gz`), "")
    expect(pick(check(empty))).toEqual({ code: 1, stderr: `${ZEKNO_ARM64}.gz is empty or larger than 256 MiB.\n` })
  })
})

function pick(run: { code: number; stderr: string }) {
  return { code: run.code, stderr: run.stderr }
}

describe("the publish job's publishing step", () => {
  /** A stand-in gh first on PATH: it writes each call's arguments, one per line, and finds no release unless told. */
  function standInGh(exists = false) {
    const dir = tempDir("gh")
    const log = join(dir, "calls")
    const gh = join(dir, "gh")
    writeFileSync(
      gh,
      `#!/bin/sh\nprintf 'call\\n' >> '${log}'\nprintf '%s\\n' "$@" >> '${log}'\nprintf 'GH_TOKEN=%s\\n' "$GH_TOKEN" >> '${log}'\ncase "$1 $2" in\n  "release view") exit ${exists ? 0 : 1} ;;\nesac\nexit 0\n`
    )
    chmodSync(gh, 0o755)
    const calls = () => (existsSync(log) ? readFileSync(log, "utf8").split("call\n").filter((call) => call !== "").map((call) => call.trimEnd().split("\n")) : [])
    return { path: `${dir}:${STEP_PATH}`, calls }
  }

  for (const environment of ENVIRONMENTS) {
    const step = release.workflow.jobs[PUBLISH[environment]]!.steps[3]!
    const version = environment === "dev" ? "0.1.0-dev.1" : "0.1.0"
    const env = (path: string) => ({ PATH: path, GH_TOKEN: "token-of-the-run", TAG: `runner-v${version}`, VERSION: version, GITHUB_REPOSITORY: "zekno-app/zekno" })

    test(`${environment}: the files go to gh by their fixed names, the notes as a file, whatever the files hold; nothing in them runs`, () => {
      const ran = join(tempDir("mark"), "ran")
      // Notes and checksums that would run something if a shell ever read them as commands or expanded them.
      const dir = handedOn(ran, `$(touch '${ran}')\n\`touch '${ran}'\`\n--repo other/repository\n`)
      const gh = standInGh()
      const result = runStep(step, env(gh.path), dir)
      expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
      expect(gh.calls()).toEqual([
        ["--version", "GH_TOKEN=token-of-the-run"],
        ["release", "view", `runner-v${version}`, "--repo", "zekno-app/zekno", "GH_TOKEN=token-of-the-run"],
        [
          "release",
          "create",
          `runner-v${version}`,
          "--repo",
          "zekno-app/zekno",
          "--verify-tag",
          "--title",
          `zekno-runner ${version}`,
          "--notes-file",
          "RELEASE-NOTES.md",
          ...(environment === "dev" ? ["--prerelease", "--latest=false"] : []),
          ...FILES,
          "GH_TOKEN=token-of-the-run",
        ],
      ])
      expect(existsSync(ran)).toBe(false)
    })

    test(`${environment}: a tag that already has a release gets no second one`, () => {
      const gh = standInGh(true)
      const result = runStep(step, env(gh.path), handedOn(join(tempDir("mark"), "ran")))
      expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 1, stderr: `A release for runner-v${version} already exists. A version is released once.\n` })
      expect(gh.calls().map((call) => call.slice(0, 2).join(" "))).toEqual(["--version GH_TOKEN=token-of-the-run", "release view"])
    })
  }
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
