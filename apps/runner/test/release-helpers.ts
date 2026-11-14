/**
 * Temporary git repositories for the release scripts' tests: a bare `origin`
 * and a clone, with commit A on `main`, commit B on `dev` (branched from
 * `main`) and commit C on `feature` (never merged, never pushed). `main` and
 * `dev` are pushed, so the clone has `origin/main` and `origin/dev`. Nothing
 * reaches the network, and git reads neither this machine's nor this user's
 * configuration.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { tempDir } from "./helpers"

/** git with no configuration from this machine, so a signing key or a hook of the user's never runs. */
export const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada",
  GIT_AUTHOR_EMAIL: "ada@example.test",
  GIT_COMMITTER_NAME: "Ada",
  GIT_COMMITTER_EMAIL: "ada@example.test",
  GIT_TERMINAL_PROMPT: "0",
}

/** The environment for a process that runs git in these repositories. */
export const gitEnv = (): Record<string, string> => ({ ...(process.env as Record<string, string>), ...GIT_ENV })

/** Runs git in `cwd` and gives its standard output, trimmed; throws when it fails. */
export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: gitEnv(), stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

/** What one commit says: the runner's version, the CLI's carried version, and the Bun pin (none when null). */
export type CommitVersions = { runner: string; cli: string; bun?: string | null }

function writeCommit(root: string, label: string, versions: CommitVersions) {
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const bun = versions.bun === undefined ? "1.4.4" : versions.bun
  write("package.json", `${JSON.stringify({ name: "zekno", private: true, ...(bun === null ? {} : { packageManager: `bun@${bun}` }) }, null, 2)}\n`)
  write("apps/runner/package.json", `${JSON.stringify({ name: "@workspace/runner", version: versions.runner }, null, 2)}\n`)
  write("apps/cli/src/runner-release.json", runnerRelease(versions.cli, null, null))
  write(`notes/${label}.txt`, `${label}\n`)
  git(root, "add", "-A")
  git(root, "commit", "-q", "-m", label)
  return git(root, "rev-parse", "HEAD")
}

/** apps/cli/src/runner-release.json as the second build writes it. */
export function runnerRelease(version: string, x64: string | null, arm64: string | null): string {
  return `${JSON.stringify({ version, files: { "linux-x64": { sha256: x64 }, "linux-arm64": { sha256: arm64 } } }, null, 2)}\n`
}

export type ReleaseRepo = {
  /** The clone, where the scripts run. */
  root: string
  /** The bare repository the clone calls `origin`. */
  origin: string
  commits: { a: string; b: string; c: string }
  /** Tags `commit` and checks it out on its own, as the workflow's checkout does. */
  checkout(tag: string, commit: string): void
}

function repoAt(root: string, origin: string, commits: ReleaseRepo["commits"]): ReleaseRepo {
  return {
    root,
    origin,
    commits,
    checkout(tag, commit) {
      git(root, "tag", tag, commit)
      git(root, "switch", "-q", "--detach", commit)
    },
  }
}

const templates = new Map<string, ReleaseRepo>()

/**
 * A fresh copy of the repository `make` builds. Each is built once per key
 * and copied after that, which takes a tenth of the time; every test still
 * gets a repository and an origin of its own.
 */
export function copied(key: string, make: () => ReleaseRepo): ReleaseRepo {
  let template = templates.get(key)
  if (!template) {
    template = make()
    templates.set(key, template)
  }
  const dir = tempDir("release")
  const copy = Bun.spawnSync(["cp", "-R", `${dirname(template.root)}/.`, dir])
  if (copy.exitCode !== 0) throw new Error(`could not copy a repository: ${copy.stderr.toString()}`)
  const root = join(dir, "clone")
  const origin = join(dir, "origin.git")
  git(root, "remote", "set-url", "origin", origin)
  return repoAt(root, origin, template.commits)
}

/** A repository with A on main, B on dev, C on feature; by default all three say 0.1.0-dev.1. */
export function releaseRepo(versions: Partial<Record<"a" | "b" | "c", CommitVersions>> = {}): ReleaseRepo {
  return copied(JSON.stringify(versions), () => {
    const dev: CommitVersions = { runner: "0.1.0-dev.1", cli: "0.1.0-dev.1" }
    const dir = tempDir("release")
    const origin = join(dir, "origin.git")
    const root = join(dir, "clone")
    git(dir, "init", "-q", "--bare", "-b", "main", origin)
    git(dir, "init", "-q", "-b", "main", root)
    git(root, "remote", "add", "origin", origin)
    const a = writeCommit(root, "a", versions.a ?? dev)
    git(root, "push", "-q", "origin", "main")
    git(root, "switch", "-q", "-c", "dev")
    const b = writeCommit(root, "b", versions.b ?? dev)
    git(root, "push", "-q", "origin", "dev")
    git(root, "switch", "-q", "-c", "feature")
    const c = writeCommit(root, "c", versions.c ?? dev)
    return repoAt(root, origin, { a, b, c })
  })
}
