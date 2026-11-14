#!/usr/bin/env bun
/**
 * The second build (specs/005-runner-release/contracts/second-build.md):
 *
 *   bun apps/runner/scripts/second-build.ts runner-v<version>
 *
 * Run by the maintainer on their own machine after a release was published.
 * It rebuilds the tagged commit from `git archive` in a temporary folder,
 * downloads the release's files from the address servers use, and compares
 * each binary's SHA-256 three ways: this build, the file downloaded, and the
 * release's SHA256SUMS. Only when all three agree for both binaries does it
 * write the checksums into apps/cli/src/runner-release.json, which is then
 * the only file of the repository it changes. It never commits, pushes or
 * edits the release: it prints the commands for that.
 *
 * Exit status: 0 recorded (or already recorded), 1 did not match, 2 wrong
 * usage or a condition on this machine, 3 could not be completed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { compareRunnerVersions } from "@workspace/core"

import {
  BINARIES,
  BINARY_LIMIT,
  branchOf,
  bunPin,
  cleaned,
  isCommit,
  notesNames,
  NOT_MADE_YET,
  parseRunnerReleaseJson,
  parseSha256sums,
  parseTag,
  recordText,
  releaseNotes,
  RELEASE_FILES,
  rowMatches,
  RUNNER_PACKAGE,
  RUNNER_RELEASE,
  runnerReleaseJson,
  type RecordRow,
} from "./release-lib"

export type GitRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

/** At most `limit + 1` bytes of a release file, so a file over its limit is seen as such without being read whole. */
export type Download = (name: string, limit: number) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>

/** The two binaries built from `commit` in `folder`, or the step that failed and what it said. */
export type Build = (commit: string, folder: string) => Promise<{ ok: true; x64: Uint8Array; arm64: Uint8Array } | { ok: false; step: string; output: string }>

export type SecondBuildDeps = {
  /** The repository's top folder. */
  root: string
  /** git, in `root`. */
  git: GitRun
  download: Download
  build: Build
  /** The Bun this runs on. */
  bunVersion: string
  /** Today, YYYY-MM-DD. */
  date: string
  /** `git config user.name`, or empty. */
  userName: string
  system: { os: string; arch: string }
  /** Where its temporary folders and the files it hands over go. */
  tmp: string
  /** Standard output: the record and the next commands. */
  out: (text: string) => void
  /** Standard error: why it stopped. */
  err: (text: string) => void
}

const USAGE = "Usage: bun apps/runner/scripts/second-build.ts runner-v<version>"

/** Limits on what is downloaded (contracts/second-build.md, step 10). */
const LIMITS: Record<(typeof RELEASE_FILES)[number], { bytes: number; said: string }> = {
  "zekno-runner-linux-x64.gz": { bytes: BINARY_LIMIT, said: "256 MiB" },
  "zekno-runner-linux-arm64.gz": { bytes: BINARY_LIMIT, said: "256 MiB" },
  SHA256SUMS: { bytes: 4 * 1024, said: "4 KiB" },
  "RELEASE-NOTES.md": { bytes: 64 * 1024, said: "64 KiB" },
}

class Stop extends Error {
  constructor(
    message: string,
    readonly status: 1 | 2 | 3
  ) {
    super(message)
  }
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

/** A path as a shell word in the commands it prints: as it is when plain, in single quotes otherwise. */
const word = (path: string) => (/^[A-Za-z0-9_./+-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`)

/** Unpacks gzip, stopping as soon as the output passes `limit`: a small file can stand for a huge one. */
async function gunzipLimited(packed: Uint8Array, limit: number): Promise<Uint8Array | "large" | "not-gzip"> {
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"))
    for await (const chunk of stream) {
      size += chunk.length
      if (size > limit) return "large"
      chunks.push(chunk)
    }
  } catch {
    return "not-gzip"
  }
  return size === 0 ? "not-gzip" : new Uint8Array(Buffer.concat(chunks))
}

/** Runs the second build for `tag`, and gives the exit status. */
export async function secondBuild(tag: string | undefined, deps: SecondBuildDeps): Promise<number> {
  const folders: string[] = []
  let keep: string | undefined
  try {
    return await run(tag, deps, folders, (folder) => (keep = folder))
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    deps.err(`${error.message}\n`)
    return error.status
  } finally {
    for (const folder of folders) if (folder !== keep) rmSync(folder, { recursive: true, force: true })
  }
}

async function run(tag: string | undefined, deps: SecondBuildDeps, folders: string[], keep: (folder: string) => void): Promise<number> {
  const git = async (...args: string[]) => deps.git(args)
  const blob = async (commit: string, path: string): Promise<Record<string, unknown> | undefined> => {
    const result = await git("cat-file", "blob", `${commit}:${path}`)
    try {
      return result.code === 0 ? (JSON.parse(result.stdout) as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }

  // 1, 2. One argument, a release tag.
  if (tag === undefined) throw new Stop(USAGE, 2)
  const parsed = parseTag(tag)
  if (!parsed) throw new Stop(`The tag ${cleaned(tag, 100)} is not runner-v<x.y.z> or runner-v<x.y.z>-dev.<n>.`, 2)
  const { version, environment } = parsed
  const branch = branchOf(environment)

  // 3. The branch this release is recorded on: a dev version never on main, a prod one never on dev.
  const current = await git("symbolic-ref", "--short", "-q", "HEAD")
  const on = current.code === 0 ? current.stdout.trim() : ""
  if (on !== branch) throw new Stop(`A ${environment} release is recorded on ${branch}. This checkout is on ${on === "" ? "no branch" : cleaned(on, 100)}.`, 2)

  // 4. The one file it writes has nothing uncommitted in it.
  const status = await git("status", "--porcelain", "--", RUNNER_RELEASE)
  if (status.code !== 0 || status.stdout.trim() !== "") {
    throw new Stop(`${RUNNER_RELEASE} has changes that are not committed. Commit or undo them first.`, 2)
  }
  const releasePath = join(deps.root, RUNNER_RELEASE)
  const before = readFileSync(releasePath, "utf8")
  const recorded = parseRunnerReleaseJson(before)
  if (!recorded) throw new Stop(`${RUNNER_RELEASE} is not in the expected form.`, 2)

  // 5. Never a step back from a newer release already recorded.
  if ((recorded.x64 !== null || recorded.arm64 !== null) && compareRunnerVersions(recorded.version, version) > 0) {
    throw new Stop(`This branch already records runner ${recorded.version}, newer than ${version}. Nothing was changed.`, 2)
  }

  // 6. The tag here.
  const local = await git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`)
  const commit = local.stdout.trim()
  if (local.code !== 0 || !isCommit(commit)) throw new Stop(`There is no tag ${tag} here. Fetch it with: git fetch origin tag ${tag}`, 2)

  // 7. The tag on GitHub, peeled when it is annotated, is the same commit.
  const remote = await git("ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
  if (remote.code !== 0) throw new Stop(`Could not ask GitHub where ${tag} points.`, 3)
  const refs = new Map(
    remote.stdout
      .split("\n")
      .filter((line) => line.includes("\t"))
      .map((line) => [line.split("\t")[1]!, line.split("\t")[0]!] as const)
  )
  const there = refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`)
  if (there !== commit) throw new Stop(`The tag on GitHub points at ${there && isCommit(there) ? there : "nothing"}, the tag here at ${commit}.`, 1)

  // 8. The same Bun as the release was built with.
  const bun = bunPin((await blob(commit, "package.json"))?.packageManager)
  if (!bun) throw new Stop(`The root package.json of ${tag} does not pin a Bun version.`, 1)
  if (bun !== deps.bunVersion) {
    throw new Stop(`The release was built with Bun ${bun}; this machine runs Bun ${cleaned(deps.bunVersion, 40)}. Install Bun ${bun} and run this again.`, 2)
  }

  // 9. The commit builds the tag's version.
  const builds = (await blob(commit, RUNNER_PACKAGE))?.version
  if (builds !== version) throw new Stop(`The commit of ${tag} builds runner ${typeof builds === "string" ? cleaned(builds, 40) : "with no version"}, not ${version}.`, 1)

  // 10. The release's files, from the address servers use, each within its limit.
  const downloaded = new Map<string, Uint8Array>()
  for (const name of RELEASE_FILES) {
    const result = await deps.download(name, LIMITS[name].bytes)
    if (!result.ok) throw new Stop(`Could not download ${name} (${cleaned(result.reason, 100)}).`, 3)
    if (result.bytes.length > LIMITS[name].bytes) throw new Stop(`${name} is larger than ${LIMITS[name].said}.`, 1)
    downloaded.set(name, result.bytes)
  }
  const unpacked: Record<"x64" | "arm64", Uint8Array> = { x64: new Uint8Array(), arm64: new Uint8Array() }
  for (const arch of ["x64", "arm64"] as const) {
    const name = BINARIES[arch]
    const result = await gunzipLimited(downloaded.get(`${name}.gz`)!, BINARY_LIMIT)
    if (result === "not-gzip") throw new Stop(`${name}.gz is not a gzip file.`, 1)
    if (result === "large") throw new Stop(`${name} is larger than 256 MiB.`, 1)
    unpacked[arch] = result
  }

  // 11. SHA256SUMS in exactly its form.
  const sums = parseSha256sums(new TextDecoder().decode(downloaded.get("SHA256SUMS")))
  if (!sums) throw new Stop("SHA256SUMS is not in the expected form.", 1)

  // 12. The notes name this version and this commit.
  const named = notesNames(new TextDecoder().decode(downloaded.get("RELEASE-NOTES.md")))
  if (named?.version !== version || named.commit !== commit) {
    throw new Stop(`RELEASE-NOTES.md names ${named ? `runner ${named.version} from ${named.commit}` : "something else"}, not runner ${version} from ${commit}.`, 1)
  }

  // 13. This machine's own build of the commit. Nothing was written before this step.
  const work = mkdtempSync(join(deps.tmp, "zekno-second-build-"))
  folders.push(work)
  mkdirSync(join(work, "downloaded"))
  for (const [name, bytes] of downloaded) writeFileSync(join(work, "downloaded", name), bytes)
  writeFileSync(join(work, "downloaded", BINARIES.x64), unpacked.x64)
  writeFileSync(join(work, "downloaded", BINARIES.arm64), unpacked.arm64)
  const build = join(work, "build")
  mkdirSync(build)
  const built = await deps.build(commit, build)
  if (!built.ok) throw new Stop(`The build failed at ${built.step}.\n${built.output.trimEnd()}`, 3)

  // 14. Three checksums for each binary.
  const rows: RecordRow[] = (["x64", "arm64"] as const).map((arch) => ({
    name: BINARIES[arch],
    built: sha256(built[arch]),
    downloaded: sha256(unpacked[arch]),
    sums: sums[arch],
  }))
  const record = recordText({
    tag,
    environment,
    commit,
    bun,
    os: deps.system.os,
    arch: deps.system.arch,
    by: deps.userName,
    date: deps.date,
    rows,
  })
  const notes = releaseNotes({ version, environment, commit, bun, x64: sums.x64, arm64: sums.arm64 }).replace(`${NOT_MADE_YET}\n`, record)
  const handed = () => {
    const folder = mkdtempSync(join(deps.tmp, `zekno-runner-${version}-`))
    return { folder, message: join(folder, "commit-message.txt"), notes: join(folder, "release-notes.md") }
  }

  if (!rows.every(rowMatches)) {
    // The evidence stays: this build, the downloaded files, and the notes with the record. Nothing is recorded.
    const files = handed()
    writeFileSync(files.notes, notes)
    writeFileSync(join(work, "record.md"), record)
    keep(work)
    deps.out(record)
    throw new Stop(`Kept this build and the downloaded files in ${work}. The release notes with this record are in ${files.notes}.`, 1)
  }

  const [x64, arm64] = [rows[0]!.built, rows[1]!.built]
  if (recorded.version === version && recorded.x64 !== null && recorded.arm64 !== null) {
    if (recorded.x64 === x64 && recorded.arm64 === arm64) {
      deps.out("Already recorded. Nothing was changed.\n")
      return 0
    }
    throw new Stop(`${RUNNER_RELEASE} already records runner ${version} with other checksums: ${recorded.x64} and ${recorded.arm64}. Nothing was changed.`, 1)
  }
  if (readFileSync(releasePath, "utf8") !== before) throw new Stop(`${RUNNER_RELEASE} changed while the build ran. Nothing was changed.`, 2)

  const files = handed()
  writeFileSync(files.message, `chore(cli): install runner ${version}\n\n${record}`)
  writeFileSync(files.notes, notes)
  writeFileSync(releasePath, runnerReleaseJson(version, x64, arm64))
  deps.out(record)
  deps.out(
    [
      `Recorded runner ${version} in ${RUNNER_RELEASE}. Next, on ${branch}:`,
      `  git add ${RUNNER_RELEASE}`,
      `  git commit -F ${word(files.message)}`,
      `  git push origin ${branch}`,
      `  gh release edit ${tag} --repo zekno-app/zekno --notes-file ${word(files.notes)}`,
      "",
    ].join("\n")
  )
  return 0
}

// ---------------------------------------------------------------------------
// The real pieces

/** Runs a program with an argument list, never through a shell, and keeps what it said. */
async function spawn(argv: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
  const child = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code: await child.exited, stdout, stderr }
}

/**
 * Downloads a release file from the address servers use, following at most
 * five redirects, each of which must be HTTPS too, and reading at most
 * `limit + 1` bytes.
 */
export function releaseDownload(tag: string): Download {
  return async (name, limit) => {
    let url = `https://github.com/zekno-app/zekno/releases/download/${tag}/${name}`
    for (let hop = 0; hop <= 5; hop++) {
      if (!url.startsWith("https://")) return { ok: false, reason: "a redirect that is not HTTPS" }
      let response: Response
      try {
        response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10 * 60 * 1000) })
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "no answer" }
      }
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location")
        await response.body?.cancel()
        if (!next) return { ok: false, reason: `HTTP ${response.status} with nowhere to go` }
        url = new URL(next, url).toString()
        continue
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        return { ok: false, reason: `HTTP ${response.status}` }
      }
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response.body) {
        chunks.push(chunk)
        size += chunk.length
        if (size > limit) break
      }
      return { ok: true, bytes: new Uint8Array(Buffer.concat(chunks)).subarray(0, limit + 1) }
    }
    return { ok: false, reason: "too many redirects" }
  }
}

/**
 * Builds `commit` of the repository at `root` in `folder`: `git archive`
 * unpacked by `tar` (two processes, no shell), then `bun install
 * --frozen-lockfile`, then the runner's own two compile scripts, so the
 * output names, which each binary embeds, are the workflow's.
 */
export async function realBuild(root: string, commit: string, folder: string): ReturnType<Build> {
  const src = join(folder, "src")
  mkdirSync(src, { recursive: true })
  const archive = Bun.spawn(["git", "archive", "--format=tar", commit], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const tar = Bun.spawn(["tar", "-x", "-C", src], { stdin: archive.stdout, stdout: "pipe", stderr: "pipe" })
  const [archived, unpacked, archiveErr, tarErr] = await Promise.all([archive.exited, tar.exited, new Response(archive.stderr).text(), new Response(tar.stderr).text()])
  if (archived !== 0 || unpacked !== 0) return { ok: false, step: "git archive", output: `${archiveErr}${tarErr}` }

  // The same Bun as this process, first on PATH, so the scripts' own `bun` is this one.
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` }
  const steps: [string, string[], string][] = [
    ["bun install --frozen-lockfile", [process.execPath, "install", "--frozen-lockfile"], src],
    ["bun run compile:linux-x64", [process.execPath, "run", "compile:linux-x64"], join(src, "apps/runner")],
    ["bun run compile:linux-arm64", [process.execPath, "run", "compile:linux-arm64"], join(src, "apps/runner")],
  ]
  for (const [step, argv, cwd] of steps) {
    const result = await spawn(argv, cwd, env)
    if (result.code !== 0) return { ok: false, step, output: `${result.stdout}${result.stderr}`.slice(-4000) }
  }
  try {
    return {
      ok: true,
      x64: new Uint8Array(readFileSync(join(src, "apps/runner/dist", BINARIES.x64))),
      arm64: new Uint8Array(readFileSync(join(src, "apps/runner/dist", BINARIES.arm64))),
    }
  } catch {
    return { ok: false, step: "reading the binaries", output: "" }
  }
}

if (import.meta.main) {
  const top = await spawn(["git", "rev-parse", "--show-toplevel"], process.cwd())
  if (top.code !== 0) {
    console.error("Run this inside the repository.")
    process.exit(2)
  }
  const root = top.stdout.trim()
  const args = process.argv.slice(2)
  const tag = args.length === 1 ? args[0] : undefined
  const name = await spawn(["git", "config", "user.name"], root)
  const status = await secondBuild(tag, {
    root,
    git: (gitArgs) => spawn(["git", ...gitArgs], root),
    download: releaseDownload(tag ?? ""),
    build: (commit, folder) => realBuild(root, commit, folder),
    bunVersion: Bun.version,
    date: new Date().toISOString().slice(0, 10),
    userName: name.code === 0 ? name.stdout.trim() : "",
    system: { os: process.platform, arch: process.arch },
    tmp: tmpdir(),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  })
  process.exit(status)
}
