import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync, chmodSync } from "node:fs"
import { join } from "node:path"

import { ORDERED_VERSIONS, REFUSED_VERSIONS } from "../../../packages/core/test/fixtures/versions"
import { parseTag } from "../scripts/release-lib"
import { tempDir } from "./helpers"
import { git, gitEnv, releaseRepo } from "./release-helpers"

const RELEASE_TS = join(import.meta.dir, "../scripts/release.ts")

/** Runs `bun apps/runner/scripts/release.ts <args>` in `cwd`, as the workflow does. */
async function release(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, RELEASE_TS, ...args], { cwd, env: gitEnv(), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code: await child.exited, stdout, stderr }
}

const tagRefusal = (tag: string) => `The tag ${tag} is not runner-v<x.y.z> or runner-v<x.y.z>-dev.<n>.\n`

describe("release.ts check: the tag, the branch and the versions", () => {
  test("a tag is runner-v and a version, and nothing else", async () => {
    for (const version of ORDERED_VERSIONS) {
      expect(parseTag(`runner-v${version}`)).toEqual({ version, environment: version.includes("-dev.") ? "dev" : "prod" })
    }
    const refused = [...REFUSED_VERSIONS.map((version) => `runner-v${version}`), "runner-0.1.0", "runner-v", "v0.1.0", "0.1.0", "runner-v0.1.0-dev.1 ", "Runner-v0.1.0", "runner-vv0.1.0"]
    for (const tag of refused) expect({ tag, parsed: parseTag(tag) }).toEqual({ tag, parsed: undefined })

    const repo = releaseRepo()
    const runs = await Promise.all(refused.map((tag) => release(repo.root, "check", "--tag", tag)))
    for (const [at, run] of runs.entries()) {
      const tag = refused[at]!
      // Anything that is not printable is shown as `?`, so a tag cannot write a line of its own.
      expect({ tag, code: run.code, stderr: run.stderr, stdout: run.stdout }).toEqual({
        tag,
        code: 1,
        stderr: tagRefusal(tag.replace(/[^\x20-\x7e]/g, "?")),
        stdout: "",
      })
    }
  })

  test("a dev tag on a commit of dev: the four lines the workflow reads, and nothing else", async () => {
    const repo = releaseRepo()
    repo.checkout("runner-v0.1.0-dev.1", repo.commits.b)
    const run = await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.1")
    expect(run).toEqual({ code: 0, stdout: `environment=dev\nversion=0.1.0-dev.1\ncommit=${repo.commits.b}\nbun=1.4.4\n`, stderr: "" })
  })

  test("a dev tag on a commit of main passes, since main is in dev", async () => {
    const repo = releaseRepo()
    repo.checkout("runner-v0.1.0-dev.1", repo.commits.a)
    const run = await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.1")
    expect(run.code).toBe(0)
    expect(run.stdout).toContain(`commit=${repo.commits.a}\n`)
  })

  test("a dev tag on a commit that is not on dev is refused", async () => {
    const repo = releaseRepo()
    repo.checkout("runner-v0.1.0-dev.1", repo.commits.c)
    const run = await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.1")
    expect(run).toEqual({
      code: 1,
      stdout: "",
      stderr: `runner-v0.1.0-dev.1 is a dev release, so its commit must be on dev. Commit ${repo.commits.c.slice(0, 12)} is not on origin/dev.\n`,
    })
  })

  test("a prod tag only on a commit of main", async () => {
    const prod = { runner: "0.1.0", cli: "0.1.0" }
    const onDev = releaseRepo({ a: prod, b: prod })
    onDev.checkout("runner-v0.1.0", onDev.commits.b)
    expect(await release(onDev.root, "check", "--tag", "runner-v0.1.0")).toEqual({
      code: 1,
      stdout: "",
      stderr: `runner-v0.1.0 is a prod release, so its commit must be on main. Commit ${onDev.commits.b.slice(0, 12)} is not on origin/main.\n`,
    })

    const onMain = releaseRepo({ a: prod, b: prod })
    onMain.checkout("runner-v0.1.0", onMain.commits.a)
    expect(await release(onMain.root, "check", "--tag", "runner-v0.1.0")).toEqual({
      code: 0,
      stdout: `environment=prod\nversion=0.1.0\ncommit=${onMain.commits.a}\nbun=1.4.4\n`,
      stderr: "",
    })
  })

  test("a branch or tag that looks like origin/main does not stand in for it", async () => {
    const prod = { runner: "0.1.0", cli: "0.1.0" }
    const repo = releaseRepo({ a: prod, b: prod })
    // Someone who can push any other tag names one origin/main, on a commit of dev only.
    git(repo.root, "tag", "origin/main", repo.commits.b)
    git(repo.root, "branch", "origin/main", repo.commits.b)
    repo.checkout("runner-v0.1.0", repo.commits.b)
    const run = await release(repo.root, "check", "--tag", "runner-v0.1.0")
    expect(run.code).toBe(1)
    expect(run.stderr).toContain("is not on origin/main.")
  })

  test("the checked-out commit must be the one the tag points to", async () => {
    const repo = releaseRepo()
    git(repo.root, "tag", "runner-v0.1.0-dev.1", repo.commits.b)
    git(repo.root, "switch", "-q", "--detach", repo.commits.a)
    expect(await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.1")).toEqual({
      code: 1,
      stdout: "",
      stderr: `The checked-out commit ${repo.commits.a} is not the commit runner-v0.1.0-dev.1 points to, ${repo.commits.b}.\n`,
    })
    expect(await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.2")).toEqual({
      code: 1,
      stdout: "",
      stderr: "There is no tag runner-v0.1.0-dev.2 in this checkout.\n",
    })
  })

  test("without origin/dev in the checkout it cannot tell, and stops", async () => {
    const repo = releaseRepo()
    repo.checkout("runner-v0.1.0-dev.1", repo.commits.b)
    git(repo.root, "update-ref", "-d", "refs/remotes/origin/dev")
    expect(await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.1")).toEqual({
      code: 1,
      stdout: "",
      stderr: `Could not tell whether commit ${repo.commits.b.slice(0, 12)} is on origin/dev. Is origin/dev in this checkout?\n`,
    })
  })

  test("the tag's version must be the one apps/runner/package.json says", async () => {
    const repo = releaseRepo()
    repo.checkout("runner-v0.1.0-dev.2", repo.commits.b)
    expect(await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.2")).toEqual({
      code: 1,
      stdout: "",
      stderr: "The tag says 0.1.0-dev.2, but apps/runner/package.json says 0.1.0-dev.1.\n",
    })
    // A version that is not one is shown quoted, never as it is.
    const odd = releaseRepo({ b: { runner: "0.1.0-dev.1\u001b[2J", cli: "0.1.0-dev.1" } })
    odd.checkout("runner-v0.1.0-dev.1", odd.commits.b)
    expect((await release(odd.root, "check", "--tag", "runner-v0.1.0-dev.1")).stderr).toBe(
      'The tag says 0.1.0-dev.1, but apps/runner/package.json says "0.1.0-dev.1\\u001b[2J".\n'
    )
  })

  test("the root package.json must pin a Bun version", async () => {
    for (const bun of [null, "1.4", "latest"]) {
      const repo = releaseRepo({ b: { runner: "0.1.0-dev.1", cli: "0.1.0-dev.1", bun } })
      repo.checkout("runner-v0.1.0-dev.1", repo.commits.b)
      expect(await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.1")).toEqual({
        code: 1,
        stdout: "",
        stderr: "The root package.json does not pin a Bun version.\n",
      })
    }
  })

  test("a prod release never comes from a commit whose CLI carries a dev version", async () => {
    const repo = releaseRepo({ a: { runner: "0.1.0", cli: "0.1.0-dev.1" } })
    repo.checkout("runner-v0.1.0", repo.commits.a)
    expect(await release(repo.root, "check", "--tag", "runner-v0.1.0")).toEqual({
      code: 1,
      stdout: "",
      stderr: "apps/cli/src/runner-release.json names 0.1.0-dev.1, a development release. A commit on main must not carry one.\n",
    })
  })

  test("what the tag's commit holds counts, not what the working tree was changed to", async () => {
    const repo = releaseRepo()
    repo.checkout("runner-v0.1.0-dev.2", repo.commits.b)
    writeFileSync(join(repo.root, "apps/runner/package.json"), `${JSON.stringify({ version: "0.1.0-dev.2" })}\n`)
    expect((await release(repo.root, "check", "--tag", "runner-v0.1.0-dev.2")).code).toBe(1)
  })

  test("wrong usage: status 2", async () => {
    const repo = releaseRepo()
    for (const args of [
      [],
      ["publish"],
      ["check"],
      ["check", "--tag"],
      ["check", "--tag", "runner-v0.1.0", "--bogus"],
      ["check", "--tag", "runner-v0.1.0", "extra"],
      ["check", "--tag", "runner-v0.1.0", "--remote", "-x"],
      ["files", "--tag", "runner-v0.1.0"],
      ["files", "--tag", "runner-v0.1.0", "--commit", "abc", "--bun", "1.4.4"],
      ["files", "--tag", "runner-v0.1.0", "--commit", "a".repeat(40), "--bun", "latest"],
      ["check-main", "--tag", "runner-v0.1.0"],
    ]) {
      const run = await release(repo.root, ...args)
      expect({ args, code: run.code, out: run.stdout }).toEqual({ args, code: 2, out: "" })
      expect(run.stderr).toStartWith("Usage: bun apps/runner/scripts/release.ts")
    }
  })
})

// ---------------------------------------------------------------------------

const X64 = "x64 runner\n".repeat(50)
const ARM64 = "arm64 runner\n".repeat(50)
const sha = (text: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(text).digest("hex")

/** The release notes of contracts/release.md, written out here so the script's text is checked against the contract's. */
function expectedNotes(version: string, dev: boolean, commit: string): string {
  return [
    `zekno-runner ${version}, a ${dev ? "development release" : "release"} built from commit ${commit} with Bun 1.4.4.`,
    "",
    "Pre-alpha and unaudited. Do not use it for anything you could not afford to lose.",
    "",
    ...(dev ? ["This is a development release, for proving a runner on a real server. A zekno built from `main` never installs it.", ""] : []),
    "## Built for",
    "",
    "- Linux on x86-64 (`bun-linux-x64-baseline`): processors with SSE4.2, Intel Nehalem or AMD Bulldozer and newer.",
    "- Linux on 64-bit ARM (`bun-linux-arm64`).",
    "- The GNU C library (glibc) 2.17 or newer: Debian, Ubuntu, RHEL and similar. Not Alpine or other systems with musl.",
    "",
    "These are what Bun documents for its Linux builds. What was tried is added below after the release.",
    "",
    "## Checksums",
    "",
    "SHA-256 of each unpacked file, as in `SHA256SUMS`:",
    "",
    `    ${sha(X64)}  zekno-runner-linux-x64`,
    `    ${sha(ARM64)}  zekno-runner-linux-arm64`,
    "",
    "zekno installs this release only once these checksums are recorded in its",
    "`apps/cli/src/runner-release.json`, after a second build on another machine produced the same files.",
    "",
    "## Second build",
    "",
    "Not made yet.",
    "",
  ].join("\n")
}

/** A dist folder with the two stand-in binaries, and a runner that answers `version` with `answers`. */
function dist(answers: string): { dir: string; runner: string } {
  const dir = tempDir("dist")
  writeFileSync(join(dir, "zekno-runner-linux-x64"), X64)
  writeFileSync(join(dir, "zekno-runner-linux-arm64"), ARM64)
  const runner = join(tempDir("answers"), "runner.sh")
  writeFileSync(runner, `#!/bin/sh\n[ "$1" = version ] || exit 2\nprintf '%s\\n' '${answers}'\n`)
  chmodSync(runner, 0o755)
  return { dir, runner }
}

describe("release.ts files: what the release carries", () => {
  test("a dev release: SHA256SUMS, two .gz files and the notes, exactly", async () => {
    const repo = releaseRepo()
    git(repo.root, "switch", "-q", "--detach", repo.commits.b)
    const { dir, runner } = dist('{"version":"0.1.0-dev.1","protocol":2}')
    const run = await release(repo.root, "files", "--tag", "runner-v0.1.0-dev.1", "--commit", repo.commits.b, "--bun", "1.4.4", "--dir", dir, "--runner", runner)
    const sums = `${sha(X64)}  zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64\n`
    expect(run).toEqual({
      code: 0,
      stdout: `zekno-runner-linux-x64.gz\nzekno-runner-linux-arm64.gz\nSHA256SUMS\nRELEASE-NOTES.md\n${sums}`,
      stderr: "",
    })
    expect(readFileSync(join(dir, "SHA256SUMS"), "utf8")).toBe(sums)
    expect(new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(dir, "zekno-runner-linux-x64.gz"))))).toBe(X64)
    expect(new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(dir, "zekno-runner-linux-arm64.gz"))))).toBe(ARM64)
    expect(readFileSync(join(dir, "RELEASE-NOTES.md"), "utf8")).toBe(expectedNotes("0.1.0-dev.1", true, repo.commits.b))
    // gzip's own tool agrees, as a server's will.
    const gzip = Bun.spawnSync(["gzip", "-t", join(dir, "zekno-runner-linux-x64.gz")])
    expect(gzip.exitCode).toBe(0)
  })

  test("a prod release: the same, without the development paragraph", async () => {
    const prod = { runner: "0.1.0", cli: "0.1.0" }
    const repo = releaseRepo({ a: prod, b: prod })
    git(repo.root, "switch", "-q", "--detach", repo.commits.a)
    const { dir, runner } = dist('{"version":"0.1.0","protocol":2}')
    const run = await release(repo.root, "files", "--tag", "runner-v0.1.0", "--commit", repo.commits.a, "--bun", "1.4.4", "--dir", dir, "--runner", runner)
    expect(run.code).toBe(0)
    expect(readFileSync(join(dir, "RELEASE-NOTES.md"), "utf8")).toBe(expectedNotes("0.1.0", false, repo.commits.a))
  })

  test("refused when the runner built answers another version, nothing written", async () => {
    const repo = releaseRepo()
    git(repo.root, "switch", "-q", "--detach", repo.commits.b)
    for (const [answers, said] of [
      ['{"version":"9.9.9","protocol":2}', '{"version":"9.9.9","protocol":2}'],
      ["Illegal instruction \u001b[2J", "Illegal instruction ?[2J"],
      ["x".repeat(300), "x".repeat(200)],
    ] as const) {
      const { dir, runner } = dist(answers)
      const run = await release(repo.root, "files", "--tag", "runner-v0.1.0-dev.1", "--commit", repo.commits.b, "--bun", "1.4.4", "--dir", dir, "--runner", runner)
      expect(run).toEqual({ code: 1, stdout: "", stderr: `The built runner says ${said}, not version 0.1.0-dev.1.\n` })
      expect(existsSync(join(dir, "SHA256SUMS"))).toBe(false)
    }
    const { dir } = dist("")
    const silent = join(tempDir("answers"), "runner.sh")
    writeFileSync(silent, "#!/bin/sh\nexit 1\n")
    chmodSync(silent, 0o755)
    const run = await release(repo.root, "files", "--tag", "runner-v0.1.0-dev.1", "--commit", repo.commits.b, "--bun", "1.4.4", "--dir", dir, "--runner", silent)
    expect(run).toEqual({ code: 1, stdout: "", stderr: "The built runner says nothing, not version 0.1.0-dev.1.\n" })
  })

  test("refused when a binary is missing or larger than 256 MiB, or the checkout is another commit", async () => {
    const repo = releaseRepo()
    git(repo.root, "switch", "-q", "--detach", repo.commits.b)
    const answers = '{"version":"0.1.0-dev.1","protocol":2}'
    const args = (dir: string, runner: string, commit = repo.commits.b) =>
      ["files", "--tag", "runner-v0.1.0-dev.1", "--commit", commit, "--bun", "1.4.4", "--dir", dir, "--runner", runner] as const

    const missing = dist(answers)
    Bun.spawnSync(["rm", join(missing.dir, "zekno-runner-linux-arm64")])
    expect(await release(repo.root, ...args(missing.dir, missing.runner))).toEqual({ code: 1, stdout: "", stderr: "zekno-runner-linux-arm64 was not built.\n" })

    const folder = dist(answers)
    Bun.spawnSync(["rm", join(folder.dir, "zekno-runner-linux-x64")])
    mkdirSync(join(folder.dir, "zekno-runner-linux-x64"))
    expect(await release(repo.root, ...args(folder.dir, folder.runner))).toEqual({ code: 1, stdout: "", stderr: "zekno-runner-linux-x64 was not built.\n" })

    const big = dist(answers)
    // A sparse file one byte over the limit: its size is read, not its bytes.
    truncateSync(join(big.dir, "zekno-runner-linux-x64"), 256 * 1024 * 1024 + 1)
    expect(await release(repo.root, ...args(big.dir, big.runner))).toEqual({ code: 1, stdout: "", stderr: "zekno-runner-linux-x64 is larger than 256 MiB.\n" })

    const other = dist(answers)
    expect(await release(repo.root, ...args(other.dir, other.runner, repo.commits.a))).toEqual({
      code: 1,
      stdout: "",
      stderr: `The checked-out commit ${repo.commits.b} is not ${repo.commits.a}.\n`,
    })
    expect(existsSync(join(other.dir, "SHA256SUMS"))).toBe(false)
  })
})

describe("release.ts check-main: main never carries a dev version", () => {
  test("passes with two prod versions, and names each file that holds a dev version", async () => {
    const prod = releaseRepo({ a: { runner: "0.1.0", cli: "0.1.0" } })
    git(prod.root, "switch", "-q", "main")
    const passed = await release(prod.root, "check-main")
    expect(passed.code).toBe(0)
    expect(passed.stderr).toBe("")

    const dev = releaseRepo()
    git(dev.root, "switch", "-q", "main")
    const refused = await release(dev.root, "check-main")
    const sentence = (path: string) =>
      `${path} holds 0.1.0-dev.1, a development version. main must not carry one: before merging into main, commit the prod versions on dev (apps/runner/RELEASING.md).`
    expect(refused).toEqual({ code: 1, stdout: "", stderr: `${sentence("apps/runner/package.json")}\n${sentence("apps/cli/src/runner-release.json")}\n` })

    const one = releaseRepo({ a: { runner: "0.1.0", cli: "0.1.0-dev.3" } })
    git(one.root, "switch", "-q", "main")
    expect((await release(one.root, "check-main")).stderr).toBe(
      "apps/cli/src/runner-release.json holds 0.1.0-dev.3, a development version. main must not carry one: before merging into main, commit the prod versions on dev (apps/runner/RELEASING.md).\n"
    )
  })
})
