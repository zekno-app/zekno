import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { realBuild, secondBuild, type SecondBuildDeps } from "../scripts/second-build"
import { tempDir } from "./helpers"
import { copied, git, releaseRepo, runnerRelease, type ReleaseRepo } from "./release-helpers"

const TAG = "runner-v0.1.0-dev.1"
const X64 = new TextEncoder().encode("the x64 runner\n".repeat(64))
const ARM64 = new TextEncoder().encode("the arm64 runner\n".repeat(64))
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
const RELEASE_JSON = "apps/cli/src/runner-release.json"

/** The release notes the workflow writes (contracts/release.md), for this stand-in release. */
function notes(commit: string, x64 = sha(X64), arm64 = sha(ARM64)): string {
  return [
    `zekno-runner 0.1.0-dev.1, a development release built from commit ${commit} with Bun 1.4.4.`,
    "",
    "Pre-alpha and unaudited. Do not use it for anything you could not afford to lose.",
    "",
    "This is a development release, for proving a runner on a real server. A zekno built from `main` never installs it.",
    "",
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
    `    ${x64}  zekno-runner-linux-x64`,
    `    ${arm64}  zekno-runner-linux-arm64`,
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

/** "The record" of contracts/second-build.md, written out here. */
function record(commit: string, rows: [string, string, string, string, string][], matched: boolean): string {
  return [
    `Second build of ${TAG} (dev): ${matched ? "matched" : "did not match"}.`,
    "",
    `Commit ${commit}, built from \`git archive\` with Bun 1.4.4 on darwin arm64 by Ada Lovelace, 2026-11-14.`,
    "",
    "| File | This build | Downloaded | SHA256SUMS | Result |",
    "|------|------------|------------|------------|--------|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
    matched ? "The checksums are recorded in apps/cli/src/runner-release.json on dev." : "Nothing was recorded. No zekno installs this release.",
    "",
  ].join("\n")
}

type World = {
  repo: ReleaseRepo
  files: string
  deps: SecondBuildDeps
  out: string[]
  err: string[]
  built: { x64: Uint8Array; arm64: Uint8Array }
  builds: string[]
  before: { json: string; origin: string }
}

/** A repository whose dev branch carries 0.1.0-dev.1 with no checksums, a tag pushed for it, and its release in a folder. */
function world(options: { recorded?: string } = {}): World {
  const repo = copied(`second build, recorded ${options.recorded ?? "nothing"}`, () => {
    const made = releaseRepo()
    git(made.root, "switch", "-q", "dev")
    if (options.recorded !== undefined) {
      writeFileSync(join(made.root, RELEASE_JSON), options.recorded)
      git(made.root, "commit", "-q", "-am", "recorded")
    }
    git(made.root, "tag", TAG, made.commits.b)
    git(made.root, "push", "-q", "origin", TAG)
    return made
  })
  const commit = repo.commits.b
  const files = tempDir("release-files")
  writeFileSync(join(files, "zekno-runner-linux-x64.gz"), Bun.gzipSync(X64))
  writeFileSync(join(files, "zekno-runner-linux-arm64.gz"), Bun.gzipSync(ARM64))
  writeFileSync(join(files, "SHA256SUMS"), `${sha(X64)}  zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64\n`)
  writeFileSync(join(files, "RELEASE-NOTES.md"), notes(commit))
  const out: string[] = []
  const err: string[] = []
  const built = { x64: X64, arm64: ARM64 }
  const builds: string[] = []
  const deps: SecondBuildDeps = {
    root: repo.root,
    git: async (args) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: repo.root, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } })
      return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
    },
    download: async (name, limit) => {
      const path = join(files, name)
      if (!existsSync(path)) return { ok: false, reason: "HTTP 404" }
      return { ok: true, bytes: new Uint8Array(readFileSync(path)).subarray(0, limit + 1) }
    },
    build: async (built_commit, folder) => {
      builds.push(built_commit)
      expect(existsSync(folder)).toBe(true)
      return { ok: true, x64: world.built.x64, arm64: world.built.arm64 }
    },
    bunVersion: "1.4.4",
    date: "2026-11-14",
    userName: "Ada Lovelace",
    system: { os: "darwin", arch: "arm64" },
    tmp: tempDir("second-build-tmp"),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  }
  const world: World = {
    repo,
    files,
    deps,
    out,
    err,
    built,
    builds,
    before: { json: readFileSync(join(repo.root, RELEASE_JSON), "utf8"), origin: git(repo.origin, "for-each-ref") },
  }
  return world
}

const unchanged = (w: World) => {
  expect(readFileSync(join(w.repo.root, RELEASE_JSON), "utf8")).toBe(w.before.json)
  expect(git(w.repo.origin, "for-each-ref")).toBe(w.before.origin)
  expect(git(w.repo.root, "status", "--porcelain")).toBe("")
}

/** The one sentence it said on standard error. */
const said = (w: World) => w.err.join("")

describe("the second build: all three agree, or nothing is recorded", () => {
  test("all agree: the checksums are written, the record and the next commands printed, nothing committed or pushed", async () => {
    const w = world()
    const commit = w.repo.commits.b
    expect(await secondBuild(TAG, w.deps)).toBe(0)
    expect(w.builds).toEqual([commit])
    expect(readFileSync(join(w.repo.root, RELEASE_JSON), "utf8")).toBe(
      `{\n  "version": "0.1.0-dev.1",\n  "files": {\n    "linux-x64": {\n      "sha256": "${sha(X64)}"\n    },\n    "linux-arm64": {\n      "sha256": "${sha(ARM64)}"\n    }\n  }\n}\n`
    )
    const rows: [string, string, string, string, string][] = [
      ["zekno-runner-linux-x64", sha(X64), sha(X64), sha(X64), "match"],
      ["zekno-runner-linux-arm64", sha(ARM64), sha(ARM64), sha(ARM64), "match"],
    ]
    const text = record(commit, rows, true)
    const printed = w.out.join("")
    expect(printed.startsWith(text)).toBe(true)
    const next = printed.slice(text.length)
    const match = /^Recorded runner 0\.1\.0-dev\.1 in apps\/cli\/src\/runner-release\.json\. Next, on dev:\n {2}git add apps\/cli\/src\/runner-release\.json\n {2}git commit -F (\S+)\n {2}git push origin dev\n {2}gh release edit runner-v0\.1\.0-dev\.1 --repo zekno-app\/zekno --notes-file (\S+)\n$/.exec(next)
    expect(match).not.toBeNull()
    const [, message, notesFile] = match!
    expect(readFileSync(message!, "utf8")).toBe(`chore(cli): install runner 0.1.0-dev.1\n\n${text}`)
    expect(readFileSync(notesFile!, "utf8")).toBe(notes(commit).replace("Not made yet.\n", text))
    expect(message!.startsWith(w.deps.tmp)).toBe(true)
    expect(w.err).toEqual([])
    // Nothing was committed, nothing pushed: only the one file changed, and origin is as it was.
    // (git() trims, so the status letter for a change not yet staged starts the line.)
    expect(git(w.repo.root, "status", "--porcelain")).toBe(`M ${RELEASE_JSON}`)
    expect(git(w.repo.origin, "for-each-ref")).toBe(w.before.origin)
    expect(git(w.repo.root, "rev-parse", "HEAD")).toBe(commit)
  })

  test("the downloaded x64 file one byte different: it is named, the folder kept, nothing recorded", async () => {
    const w = world()
    const changed = X64.slice()
    changed[100] = changed[100]! ^ 1
    writeFileSync(join(w.files, "zekno-runner-linux-x64.gz"), Bun.gzipSync(changed))
    expect(await secondBuild(TAG, w.deps)).toBe(1)
    const rows: [string, string, string, string, string][] = [
      ["zekno-runner-linux-x64", sha(X64), sha(changed), sha(X64), "differs"],
      ["zekno-runner-linux-arm64", sha(ARM64), sha(ARM64), sha(ARM64), "match"],
    ]
    const text = record(w.repo.commits.b, rows, false)
    expect(w.out.join("")).toBe(text)
    const kept = /^Kept this build and the downloaded files in (\S+)\. The release notes with this record are in (\S+)\.\n$/.exec(said(w))
    expect(kept).not.toBeNull()
    expect(existsSync(join(kept![1]!, "downloaded", "zekno-runner-linux-x64"))).toBe(true)
    expect(readFileSync(join(kept![1]!, "downloaded", "zekno-runner-linux-x64"))).toEqual(Buffer.from(changed))
    expect(readFileSync(kept![2]!, "utf8")).toBe(notes(w.repo.commits.b).replace("Not made yet.\n", text))
    unchanged(w)
  })

  test("SHA256SUMS different from both builds, this build different, SHA256SUMS malformed: status 1, nothing recorded", async () => {
    const other = sha(new TextEncoder().encode("another runner"))
    const sums = world()
    writeFileSync(join(sums.files, "SHA256SUMS"), `${other}  zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64\n`)
    expect(await secondBuild(TAG, sums.deps)).toBe(1)
    expect(sums.out.join("")).toContain(`| zekno-runner-linux-x64 | ${sha(X64)} | ${sha(X64)} | ${other} | differs |`)
    unchanged(sums)

    const ours = world()
    ours.built.arm64 = new TextEncoder().encode("built elsewhere")
    expect(await secondBuild(TAG, ours.deps)).toBe(1)
    expect(ours.out.join("")).toContain(`| zekno-runner-linux-arm64 | ${sha(ours.built.arm64)} | ${sha(ARM64)} | ${sha(ARM64)} | differs |`)
    unchanged(ours)

    for (const text of [
      `${sha(X64)} zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64\n`,
      `${sha(ARM64)}  zekno-runner-linux-arm64\n${sha(X64)}  zekno-runner-linux-x64\n`,
      `${sha(X64).toUpperCase()}  zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64\n`,
      `${sha(X64)}  zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64`,
      `${sha(X64)}  zekno-runner-linux-x64\r\n${sha(ARM64)}  zekno-runner-linux-arm64\r\n`,
      `${sha(X64)}  zekno-runner-linux-x64\n${sha(ARM64)}  zekno-runner-linux-arm64\nextra\n`,
      "",
    ]) {
      const malformed = world()
      writeFileSync(join(malformed.files, "SHA256SUMS"), text)
      expect(await secondBuild(TAG, malformed.deps)).toBe(1)
      expect(said(malformed)).toBe("SHA256SUMS is not in the expected form.\n")
      expect(malformed.builds).toEqual([])
      unchanged(malformed)
    }
  })

  test("notes that name another commit or version, a tag on GitHub moved, a commit that builds another version: status 1", async () => {
    const commit = (w: World) => w.repo.commits.b
    const otherCommit = world()
    writeFileSync(join(otherCommit.files, "RELEASE-NOTES.md"), notes(otherCommit.repo.commits.a))
    expect(await secondBuild(TAG, otherCommit.deps)).toBe(1)
    expect(said(otherCommit)).toBe(
      `RELEASE-NOTES.md names runner 0.1.0-dev.1 from ${otherCommit.repo.commits.a}, not runner 0.1.0-dev.1 from ${commit(otherCommit)}.\n`
    )
    unchanged(otherCommit)

    const unreadable = world()
    writeFileSync(join(unreadable.files, "RELEASE-NOTES.md"), "# Hello\u001b[2J\n")
    expect(await secondBuild(TAG, unreadable.deps)).toBe(1)
    expect(said(unreadable)).toBe(`RELEASE-NOTES.md names something else, not runner 0.1.0-dev.1 from ${commit(unreadable)}.\n`)

    const moved = world()
    git(moved.repo.root, "push", "-q", "-f", "origin", `${moved.repo.commits.a}:refs/tags/${TAG}`)
    moved.before.origin = git(moved.repo.origin, "for-each-ref")
    expect(await secondBuild(TAG, moved.deps)).toBe(1)
    expect(said(moved)).toBe(`The tag on GitHub points at ${moved.repo.commits.a}, the tag here at ${commit(moved)}.\n`)
    expect(moved.builds).toEqual([])
    unchanged(moved)

    // The tag, here and on GitHub, on a commit whose runner says another version.
    const w = world()
    writeFileSync(join(w.repo.root, "apps/runner/package.json"), `${JSON.stringify({ version: "0.1.0-dev.2" })}\n`)
    git(w.repo.root, "commit", "-q", "-am", "another version")
    const head = git(w.repo.root, "rev-parse", "HEAD")
    git(w.repo.root, "tag", "-f", TAG, head)
    git(w.repo.root, "push", "-q", "-f", "origin", TAG)
    w.before.origin = git(w.repo.origin, "for-each-ref")
    expect(await secondBuild(TAG, w.deps)).toBe(1)
    expect(said(w)).toBe(`The commit of ${TAG} builds runner 0.1.0-dev.2, not 0.1.0-dev.1.\n`)
    unchanged(w)
  })

  test("conditions on this machine: wrong branch, uncommitted file, another Bun, no local tag, a newer version recorded: status 2", async () => {
    const branch = world()
    git(branch.repo.root, "switch", "-q", "main")
    branch.before.json = readFileSync(join(branch.repo.root, RELEASE_JSON), "utf8")
    expect(await secondBuild(TAG, branch.deps)).toBe(2)
    expect(said(branch)).toBe("A dev release is recorded on dev. This checkout is on main.\n")
    unchanged(branch)

    const detached = world()
    git(detached.repo.root, "switch", "-q", "--detach", "HEAD")
    expect(await secondBuild(TAG, detached.deps)).toBe(2)
    expect(said(detached)).toBe("A dev release is recorded on dev. This checkout is on no branch.\n")

    const dirty = world()
    writeFileSync(join(dirty.repo.root, RELEASE_JSON), runnerRelease("0.1.0-dev.1", "a".repeat(64), "b".repeat(64)))
    const edited = readFileSync(join(dirty.repo.root, RELEASE_JSON), "utf8")
    expect(await secondBuild(TAG, dirty.deps)).toBe(2)
    expect(said(dirty)).toBe("apps/cli/src/runner-release.json has changes that are not committed. Commit or undo them first.\n")
    expect(readFileSync(join(dirty.repo.root, RELEASE_JSON), "utf8")).toBe(edited)

    const bun = world()
    bun.deps.bunVersion = "1.4.5"
    expect(await secondBuild(TAG, bun.deps)).toBe(2)
    expect(said(bun)).toBe("The release was built with Bun 1.4.4; this machine runs Bun 1.4.5. Install Bun 1.4.4 and run this again.\n")
    unchanged(bun)

    const untagged = world()
    git(untagged.repo.root, "tag", "-d", TAG)
    expect(await secondBuild(TAG, untagged.deps)).toBe(2)
    expect(said(untagged)).toBe(`There is no tag ${TAG} here. Fetch it with: git fetch origin tag ${TAG}\n`)
    unchanged(untagged)

    const newer = world({ recorded: runnerRelease("0.1.0-dev.2", "a".repeat(64), "b".repeat(64)) })
    expect(await secondBuild(TAG, newer.deps)).toBe(2)
    expect(said(newer)).toBe("This branch already records runner 0.1.0-dev.2, newer than 0.1.0-dev.1. Nothing was changed.\n")
    expect(newer.builds).toEqual([])
    unchanged(newer)
  })

  test("the same version already recorded: with the same checksums nothing changes; with others it is a mismatch", async () => {
    const same = world({ recorded: runnerRelease("0.1.0-dev.1", sha(X64), sha(ARM64)) })
    expect(await secondBuild(TAG, same.deps)).toBe(0)
    expect(same.out.join("")).toContain("Already recorded. Nothing was changed.\n")
    unchanged(same)

    const others = world({ recorded: runnerRelease("0.1.0-dev.1", "a".repeat(64), "b".repeat(64)) })
    expect(await secondBuild(TAG, others.deps)).toBe(1)
    expect(said(others)).toBe(
      `apps/cli/src/runner-release.json already records runner 0.1.0-dev.1 with other checksums: ${"a".repeat(64)} and ${"b".repeat(64)}. Nothing was changed.\n`
    )
    unchanged(others)

    // An older version recorded with checksums is replaced, as the next release always is.
    const older = world({ recorded: runnerRelease("0.0.9", "a".repeat(64), "b".repeat(64)) })
    expect(await secondBuild(TAG, older.deps)).toBe(0)
    expect(readFileSync(join(older.repo.root, RELEASE_JSON), "utf8")).toBe(runnerRelease("0.1.0-dev.1", sha(X64), sha(ARM64)))
  })

  test("a download that fails or is not what it should be, a build that fails: nothing recorded", async () => {
    const missing = world()
    rmSync(join(missing.files, "SHA256SUMS"))
    expect(await secondBuild(TAG, missing.deps)).toBe(3)
    expect(said(missing)).toBe("Could not download SHA256SUMS (HTTP 404).\n")
    unchanged(missing)

    const notGzip = world()
    writeFileSync(join(notGzip.files, "zekno-runner-linux-arm64.gz"), "not gzip at all")
    expect(await secondBuild(TAG, notGzip.deps)).toBe(1)
    expect(said(notGzip)).toBe("zekno-runner-linux-arm64.gz is not a gzip file.\n")

    const bigSums = world()
    writeFileSync(join(bigSums.files, "SHA256SUMS"), "x".repeat(4097))
    expect(await secondBuild(TAG, bigSums.deps)).toBe(1)
    expect(said(bigSums)).toBe("SHA256SUMS is larger than 4 KiB.\n")

    const bigNotes = world()
    writeFileSync(join(bigNotes.files, "RELEASE-NOTES.md"), "x".repeat(64 * 1024 + 1))
    expect(await secondBuild(TAG, bigNotes.deps)).toBe(1)
    expect(said(bigNotes)).toBe("RELEASE-NOTES.md is larger than 64 KiB.\n")

    // A small file that unpacks to more than 256 MiB: gzip members of zeros, one after another.
    const bomb = world()
    const member = Bun.gzipSync(new Uint8Array(1024 * 1024))
    writeFileSync(join(bomb.files, "zekno-runner-linux-x64.gz"), Buffer.concat(Array.from({ length: 257 }, () => member)))
    expect(await secondBuild(TAG, bomb.deps)).toBe(1)
    expect(said(bomb)).toBe("zekno-runner-linux-x64 is larger than 256 MiB.\n")
    unchanged(bomb)

    const build = world()
    build.deps.build = async () => ({ ok: false, step: "bun install --frozen-lockfile", output: "error: lockfile had changes, but lockfile is frozen" })
    expect(await secondBuild(TAG, build.deps)).toBe(3)
    expect(said(build)).toBe("The build failed at bun install --frozen-lockfile.\nerror: lockfile had changes, but lockfile is frozen\n")
    unchanged(build)
    expect(Bun.spawnSync(["ls", build.deps.tmp]).stdout.toString()).toBe("")
  })

  test("no argument, or a tag that is not one: status 2", async () => {
    const w = world()
    expect(await secondBuild(undefined, w.deps)).toBe(2)
    expect(said(w)).toBe("Usage: bun apps/runner/scripts/second-build.ts runner-v<version>\n")
    for (const tag of ["runner-v0.1.0-dev.0", "v0.1.0", "runner-v0.1", "runner-v0.1.0\n"]) {
      const bad = world()
      expect(await secondBuild(tag, bad.deps)).toBe(2)
      expect(said(bad)).toBe(`The tag ${tag.replace("\n", "?")} is not runner-v<x.y.z> or runner-v<x.y.z>-dev.<n>.\n`)
      unchanged(bad)
    }
  })
})

/**
 * The real build of the second build, twice, from the same commit in two
 * separate temporary folders. Needs the network (packages from npm, Bun's
 * Linux runtimes) and a few minutes, so it runs only when asked:
 * `ZEKNO_REAL_BUILD=1 bun test test/second-build.test.ts`. It builds HEAD, or
 * the commit in ZEKNO_REAL_BUILD_COMMIT. Nothing leaves this machine.
 */
test.skipIf(process.env.ZEKNO_REAL_BUILD !== "1")(
  "the real build gives the same bytes twice",
  async () => {
    const root = join(import.meta.dir, "../../..")
    const commit = process.env.ZEKNO_REAL_BUILD_COMMIT || git(root, "rev-parse", "HEAD")
    const results = []
    for (const label of ["first", "second"]) {
      const folder = tempDir(`real-build-${label}`)
      const started = performance.now()
      const result = await realBuild(root, commit, folder)
      const seconds = (performance.now() - started) / 1000
      if (!result.ok) throw new Error(`${result.step}: ${result.output}`)
      results.push({ label, seconds, x64: sha(result.x64), arm64: sha(result.arm64), sizes: [result.x64.length, result.arm64.length] })
      rmSync(folder, { recursive: true, force: true })
    }
    console.log(JSON.stringify({ commit, bun: Bun.version, results }, null, 2))
    expect(results[0]!.x64).toBe(results[1]!.x64)
    expect(results[0]!.arm64).toBe(results[1]!.arm64)
  },
  30 * 60 * 1000
)
