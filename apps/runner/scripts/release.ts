#!/usr/bin/env bun
/**
 * The release workflow's logic, so it can be tested
 * (specs/005-runner-release/contracts/release.md, "apps/runner/scripts/release.ts").
 *
 *   bun apps/runner/scripts/release.ts check --tag <tag> [--remote <name>]
 *   bun apps/runner/scripts/release.ts files --tag <tag> --commit <40 hex> --bun <x.y.z> [--dir <dir>] [--runner <path>]
 *   bun apps/runner/scripts/release.ts check-main
 *
 * Exit status: 0 passed, 1 refused (nothing to publish), 2 wrong usage. Each
 * refusal is one sentence on standard error. `check` prints four lines on
 * standard output, which the workflow appends to $GITHUB_OUTPUT: they are
 * printed only once every check passed, and each is held to its pattern.
 *
 * These checks are not a boundary against whoever can push a release tag:
 * that person also chooses the workflow that runs (research R5). They stop
 * mistakes. What a CLI installs is decided by the second build.
 */
import { parseMessage, RunnerVersionSchema } from "@workspace/core"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

import {
  BINARIES,
  BINARY_LIMIT,
  branchOf,
  bunPin,
  cleaned,
  devVersionFiles,
  isCommit,
  parseTag,
  releaseNotes,
  RUNNER_PACKAGE,
  RUNNER_RELEASE,
  sha256sumsText,
  shown,
} from "./release-lib"

const USAGE = [
  "Usage: bun apps/runner/scripts/release.ts check --tag <tag> [--remote <name>]",
  "       bun apps/runner/scripts/release.ts files --tag <tag> --commit <40 hex> --bun <x.y.z> [--dir <dir>] [--runner <path>]",
  "       bun apps/runner/scripts/release.ts check-main",
].join("\n")

/** A sentence for the person reading the log, and the status to exit with. */
class Stop extends Error {
  constructor(
    message: string,
    readonly status: 1 | 2
  ) {
    super(message)
  }
}
const refuse = (message: string) => new Stop(message, 1)
const usage = () => new Stop(USAGE, 2)

const tagRefusal = (tag: string) =>
  `The tag ${cleaned(tag, 100)} is not runner-v<x.y.z> or runner-v<x.y.z>-dev.<n>.`

/** A remote's name: letters, digits, `.`, `_` and `-`, never starting with `-`, so git never reads it as an option. */
const REMOTE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/

type GitResult = { code: number; stdout: string; stderr: string }

/** Runs git with an argument list, never through a shell. */
async function git(cwd: string, ...args: string[]): Promise<GitResult> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code: await child.exited, stdout, stderr }
}

/** The repository's top folder, from wherever this is run inside it. */
async function topLevel(): Promise<string> {
  const result = await git(process.cwd(), "rev-parse", "--show-toplevel")
  if (result.code !== 0) throw refuse("This is not inside the repository.")
  return result.stdout.trim()
}

/** The commit HEAD is, as 40 hex. */
async function head(root: string): Promise<string> {
  const result = await git(root, "rev-parse", "--verify", "HEAD^{commit}")
  const commit = result.stdout.trim()
  if (result.code !== 0 || !isCommit(commit))
    throw refuse("This checkout has no commit.")
  return commit
}

/** A JSON file as it is in `commit`, never as the working tree has it. */
async function committedJson(
  root: string,
  commit: string,
  path: string
): Promise<Record<string, unknown> | undefined> {
  const result = await git(root, "cat-file", "blob", `${commit}:${path}`)
  if (result.code !== 0) return undefined
  try {
    const value = JSON.parse(result.stdout) as unknown
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** `check`: whether this checkout may be released under `tag`, and if so the four lines the workflow reads. */
async function check(tag: string, remote: string): Promise<string> {
  const parsed = parseTag(tag)
  if (!parsed) throw refuse(tagRefusal(tag))
  const { version, environment } = parsed
  const root = await topLevel()

  // 2. The checked-out commit is the one the tag points to. `refs/tags/` so no branch of that name stands in for it.
  const current = await head(root)
  const tagged = await git(
    root,
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/tags/${tag}^{commit}`
  )
  if (tagged.code !== 0)
    throw refuse(`There is no tag ${tag} in this checkout.`)
  const commit = tagged.stdout.trim()
  if (commit !== current)
    throw refuse(
      `The checked-out commit ${current} is not the commit ${tag} points to, ${commit}.`
    )

  // 3. The commit is on the environment's branch, as the remote has it. `refs/remotes/` so no tag or branch named like it stands in for it.
  const branch = branchOf(environment)
  const ancestor = await git(
    root,
    "merge-base",
    "--is-ancestor",
    commit,
    `refs/remotes/${remote}/${branch}`
  )
  if (ancestor.code === 1) {
    throw refuse(
      `${tag} is a ${environment} release, so its commit must be on ${branch}. Commit ${commit.slice(0, 12)} is not on ${remote}/${branch}.`
    )
  }
  if (ancestor.code !== 0) {
    throw refuse(
      `Could not tell whether commit ${commit.slice(0, 12)} is on ${remote}/${branch}. Is ${remote}/${branch} in this checkout?`
    )
  }

  // 4. The runner the commit builds says the tag's version.
  const runner = (await committedJson(root, commit, RUNNER_PACKAGE))?.version
  if (runner !== version)
    throw refuse(
      `The tag says ${version}, but ${RUNNER_PACKAGE} says ${shown(runner)}.`
    )

  // 5. The Bun the release is built with is pinned.
  const bun = bunPin(
    (await committedJson(root, commit, "package.json"))?.packageManager
  )
  if (!bun) throw refuse("The root package.json does not pin a Bun version.")

  // 6. A commit released for prod carries no dev version in the CLI.
  if (environment === "prod") {
    const carried = (await committedJson(root, commit, RUNNER_RELEASE))?.version
    const odd = devVersionFiles([{ path: RUNNER_RELEASE, version: carried }])[0]
    if (odd) {
      throw refuse(
        `${RUNNER_RELEASE} names ${shown(carried)}, ${odd.dev ? "a development release" : "which is not a runner version"}. A commit on main must not carry one.`
      )
    }
  }

  return `environment=${environment}\nversion=${version}\ncommit=${commit}\nbun=${bun}\n`
}

/** The first line `runner version` prints, with its input closed, within 10 seconds; empty when it says nothing. */
async function askVersion(runner: string): Promise<string> {
  let child
  try {
    child = Bun.spawn([runner, "version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
  } catch {
    return ""
  }
  const timer = setTimeout(() => child.kill(), 10_000)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for await (const chunk of child.stdout) {
      chunks.push(chunk)
      size += chunk.length
      if (size > 64 * 1024 || chunk.includes(0x0a)) break
    }
  } finally {
    clearTimeout(timer)
    child.kill()
  }
  return Buffer.concat(chunks).toString("utf8").split("\n", 1)[0] ?? ""
}

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

/** `files`: checks what was built, then writes the release's four files into `dir`. */
async function files(options: {
  tag: string
  commit: string
  bun: string
  dir?: string
  runner?: string
}): Promise<string> {
  const parsed = parseTag(options.tag)
  if (!parsed) throw refuse(tagRefusal(options.tag))
  const root = await topLevel()
  const current = await head(root)
  // The tag itself is not looked up: a checkout of one commit may not hold it.
  if (current !== options.commit)
    throw refuse(`The checked-out commit ${current} is not ${options.commit}.`)

  const dir = resolve(root, options.dir ?? "apps/runner/dist")
  const binaries: Record<keyof typeof BINARIES, Uint8Array<ArrayBuffer>> = {
    x64: new Uint8Array(),
    arm64: new Uint8Array(),
  }
  for (const arch of ["x64", "arm64"] as const) {
    const name = BINARIES[arch]
    const path = join(dir, name)
    let info
    try {
      info = lstatSync(path)
    } catch {
      throw refuse(`${name} was not built.`)
    }
    if (!info.isFile() || info.size === 0)
      throw refuse(`${name} was not built.`)
    if (info.size > BINARY_LIMIT)
      throw refuse(`${name} is larger than 256 MiB.`)
    const bytes = new Uint8Array(readFileSync(path))
    if (bytes.length === 0 || bytes.length > BINARY_LIMIT)
      throw refuse(`${name} changed while it was read.`)
    binaries[arch] = bytes
  }

  // The runner says the tag's version (FR-011). GitHub's machine is x86-64, so that is the one asked.
  const line = await askVersion(
    resolve(root, options.runner ?? join(dir, BINARIES.x64))
  )
  const answer = (() => {
    try {
      return parseMessage(RunnerVersionSchema, JSON.parse(line) as unknown)
    } catch {
      return undefined
    }
  })()
  if (!answer?.ok || answer.value.version !== parsed.version) {
    throw refuse(
      `The built runner says ${line === "" ? "nothing" : cleaned(line, 200)}, not version ${parsed.version}.`
    )
  }

  const x64 = sha256(binaries.x64)
  const arm64 = sha256(binaries.arm64)
  const sums = sha256sumsText(x64, arm64)
  const written: [string, Uint8Array | string][] = [
    ...(["x64", "arm64"] as const).map((arch): [string, Uint8Array] => {
      const packed = Bun.gzipSync(binaries[arch], { level: 9 })
      if (
        !Buffer.from(Bun.gunzipSync(packed)).equals(Buffer.from(binaries[arch]))
      )
        throw refuse(`Could not write ${BINARIES[arch]}.gz.`)
      return [`${BINARIES[arch]}.gz`, packed]
    }),
    ["SHA256SUMS", sums],
    [
      "RELEASE-NOTES.md",
      releaseNotes({
        version: parsed.version,
        environment: parsed.environment,
        commit: options.commit,
        bun: options.bun,
        x64,
        arm64,
      }),
    ],
  ]
  for (const [name, content] of written) {
    try {
      writeFileSync(join(dir, name), content)
    } catch {
      throw refuse(`Could not write ${name}.`)
    }
  }
  return `${written.map(([name]) => name).join("\n")}\n${sums}`
}

/** `check-main`: the working tree holds prod versions only, as main must. */
async function checkMain(): Promise<string> {
  const root = await topLevel()
  const read = (path: string): unknown => {
    try {
      return (
        JSON.parse(readFileSync(join(root, path), "utf8")) as {
          version?: unknown
        }
      ).version
    } catch {
      return undefined
    }
  }
  const versions = [RUNNER_PACKAGE, RUNNER_RELEASE].map((path) => ({
    path,
    version: read(path),
  }))
  const odd = devVersionFiles(versions)
  if (odd.length > 0) {
    throw refuse(
      odd
        .map((file) =>
          file.dev
            ? `${file.path} holds ${shown(file.version)}, a development version. main must not carry one: before merging into main, commit the prod versions on dev (apps/runner/RELEASING.md).`
            : `${file.path} holds ${shown(file.version)}, which is not a runner version.`
        )
        .join("\n")
    )
  }
  return `No development version: ${versions.map((file) => `${file.path} holds ${file.version}`).join(", ")}.\n`
}

/** Runs one command; gives what to print on standard output, or throws a Stop. */
async function run(argv: string[]): Promise<string> {
  const [command, ...rest] = argv
  const options = {
    check: { tag: { type: "string" }, remote: { type: "string" } },
    files: {
      tag: { type: "string" },
      commit: { type: "string" },
      bun: { type: "string" },
      dir: { type: "string" },
      runner: { type: "string" },
    },
    "check-main": {},
  } as const
  if (command !== "check" && command !== "files" && command !== "check-main")
    throw usage()
  let values: Record<string, string | undefined>
  try {
    const parsed = parseArgs({
      args: rest,
      options: options[command],
      strict: true,
      allowPositionals: false,
    })
    values = parsed.values as Record<string, string | undefined>
  } catch {
    throw usage()
  }
  if (command === "check") {
    const remote = values.remote ?? "origin"
    if (values.tag === undefined || !REMOTE.test(remote)) throw usage()
    return check(values.tag, remote)
  }
  if (command === "files") {
    const { tag, commit, bun, dir, runner } = values
    if (
      tag === undefined ||
      commit === undefined ||
      !isCommit(commit) ||
      bun === undefined ||
      !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(bun)
    )
      throw usage()
    return files({ tag, commit, bun, dir, runner })
  }
  return checkMain()
}

if (import.meta.main) {
  try {
    process.stdout.write(await run(process.argv.slice(2)))
    process.exitCode = 0
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    process.stderr.write(`${error.message}\n`)
    process.exitCode = error.status
  }
}
