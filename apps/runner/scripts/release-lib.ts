/**
 * The pure parts of a runner release (specs/005-runner-release/contracts/
 * release.md and second-build.md): tags and environments, the release's
 * files, the second build's record, and apps/cli/src/runner-release.json.
 * Used by release.ts, which the workflow runs, and by second-build.ts, which
 * the maintainer runs. Imports only @workspace/core and nothing that touches
 * a file, a process or the network.
 */
import { isDevVersion, parseRunnerVersion, RUNNER_VERSION_PATTERN } from "@workspace/core"

export type Environment = "dev" | "prod"

/** The two binaries, in the order every file lists them. */
export const BINARIES = { x64: "zekno-runner-linux-x64", arm64: "zekno-runner-linux-arm64" } as const

/** The release's four files, in the order they are published. */
export const RELEASE_FILES = ["zekno-runner-linux-x64.gz", "zekno-runner-linux-arm64.gz", "SHA256SUMS", "RELEASE-NOTES.md"] as const

/** The largest binary a release carries, packed or unpacked: the installer's own limit. */
export const BINARY_LIMIT = 256 * 1024 * 1024

export const RUNNER_PACKAGE = "apps/runner/package.json"
export const RUNNER_RELEASE = "apps/cli/src/runner-release.json"

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

/** `runner-v<version>`: its version and environment, or undefined when it is not a release tag. */
export function parseTag(tag: string): { version: string; environment: Environment } | undefined {
  if (typeof tag !== "string" || !tag.startsWith("runner-v")) return undefined
  const version = tag.slice("runner-v".length)
  if (!RUNNER_VERSION_PATTERN.test(version)) return undefined
  return { version, environment: isDevVersion(version) ? "dev" : "prod" }
}

/** The branch a release of each environment is cut from, and recorded on. */
export function branchOf(environment: Environment): "dev" | "main" {
  return environment === "dev" ? "dev" : "main"
}

/** The Bun version a `packageManager` field pins (`bun@x.y.z`), or undefined. */
export function bunPin(packageManager: unknown): string | undefined {
  if (typeof packageManager !== "string") return undefined
  return /^bun@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(packageManager)?.[1]
}

/** True for a full commit name, 40 lowercase hex. */
export const isCommit = (text: string): boolean => COMMIT.test(text)

/**
 * A value read from a file, fit to be said in a sentence: as it is when it
 * is a version, quoted with its odd characters escaped otherwise, never
 * longer than 80 characters.
 */
export function shown(value: unknown): string {
  if (typeof value === "string" && RUNNER_VERSION_PATTERN.test(value)) return value
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

/** Text from outside (a tag, a program's output), with anything that is not plain printable ASCII shown as `?`. */
export function cleaned(text: string, limit: number): string {
  return text.replace(/[^\x20-\x7e]/g, "?").slice(0, limit)
}

/** SHA256SUMS: two lines in `sha256sum`'s own form, for the unpacked binaries. */
export function sha256sumsText(x64: string, arm64: string): string {
  return `${x64}  ${BINARIES.x64}\n${arm64}  ${BINARIES.arm64}\n`
}

/** The two checksums of a SHA256SUMS in exactly that form, or undefined. */
export function parseSha256sums(text: string): { x64: string; arm64: string } | undefined {
  const match = /^([0-9a-f]{64}) {2}zekno-runner-linux-x64\n([0-9a-f]{64}) {2}zekno-runner-linux-arm64\n$/.exec(text)
  return match ? { x64: match[1]!, arm64: match[2]! } : undefined
}

/** What the release notes say until the second build was made. */
export const NOT_MADE_YET = "Not made yet."

export type NotesInput = { version: string; environment: Environment; commit: string; bun: string; x64: string; arm64: string }

/** RELEASE-NOTES.md, exactly as contracts/release.md writes it. */
export function releaseNotes(input: NotesInput): string {
  const dev = input.environment === "dev"
  return [
    `zekno-runner ${input.version}, a ${dev ? "development release" : "release"} built from commit ${input.commit} with Bun ${input.bun}.`,
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
    `    ${input.x64}  ${BINARIES.x64}`,
    `    ${input.arm64}  ${BINARIES.arm64}`,
    "",
    "zekno installs this release only once these checksums are recorded in its",
    "`apps/cli/src/runner-release.json`, after a second build on another machine produced the same files.",
    "",
    "## Second build",
    "",
    NOT_MADE_YET,
    "",
  ].join("\n")
}

/**
 * The version and commit the first line of RELEASE-NOTES.md names, read with
 * the version grammar and a full commit name, or undefined when it names
 * neither in that form.
 */
export function notesNames(text: string): { version: string; commit: string } | undefined {
  const first = text.split("\n", 1)[0] ?? ""
  const match = /^zekno-runner (\S+), a (?:development release|release) built from commit ([0-9a-f]{40}) with Bun [0-9]+\.[0-9]+\.[0-9]+\.$/.exec(first)
  if (!match || !parseRunnerVersion(match[1]!)) return undefined
  return { version: match[1]!, commit: match[2]! }
}

/** One binary's three checksums in the second build. */
export type RecordRow = { name: string; built: string; downloaded: string; sums: string }

export type RecordInput = {
  tag: string
  environment: Environment
  commit: string
  bun: string
  os: string
  arch: string
  /** `git config user.name`, or empty. */
  by: string
  /** YYYY-MM-DD. */
  date: string
  rows: RecordRow[]
}

/** True when a binary's three checksums are the same. */
export const rowMatches = (row: RecordRow): boolean => row.built === row.downloaded && row.downloaded === row.sums

/** "The record" of contracts/second-build.md, ending with a line feed. */
export function recordText(input: RecordInput): string {
  const matched = input.rows.every(rowMatches)
  const name = input.by.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").trim().slice(0, 80)
  const by = name === "" ? "" : ` by ${name}`
  return [
    `Second build of ${input.tag} (${input.environment}): ${matched ? "matched" : "did not match"}.`,
    "",
    `Commit ${input.commit}, built from \`git archive\` with Bun ${input.bun} on ${input.os} ${input.arch}${by}, ${input.date}.`,
    "",
    "| File | This build | Downloaded | SHA256SUMS | Result |",
    "|------|------------|------------|------------|--------|",
    ...input.rows.map((row) => `| ${row.name} | ${row.built} | ${row.downloaded} | ${row.sums} | ${rowMatches(row) ? "match" : "differs"} |`),
    "",
    matched
      ? `The checksums are recorded in ${RUNNER_RELEASE} on ${branchOf(input.environment)}.`
      : "Nothing was recorded. No zekno installs this release.",
    "",
  ].join("\n")
}

/** apps/cli/src/runner-release.json with this version and these checksums: two-space JSON and a final line feed. */
export function runnerReleaseJson(version: string, x64: string | null, arm64: string | null): string {
  return `${JSON.stringify({ version, files: { "linux-x64": { sha256: x64 }, "linux-arm64": { sha256: arm64 } } }, null, 2)}\n`
}

/** What apps/cli/src/runner-release.json records, read strictly, or undefined when it is not in that form. */
export function parseRunnerReleaseJson(text: string): { version: string; x64: string | null; arm64: string | null } | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  const object = (item: unknown, keys: string[]): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item) && Object.keys(item).sort().join() === [...keys].sort().join()
  const checksum = (item: unknown) => (item === null || (typeof item === "string" && SHA256.test(item)) ? (item as string | null) : undefined)
  if (!object(value, ["version", "files"]) || !object(value.files, ["linux-x64", "linux-arm64"])) return undefined
  const files = value.files
  if (!object(files["linux-x64"], ["sha256"]) || !object(files["linux-arm64"], ["sha256"])) return undefined
  const x64 = checksum(files["linux-x64"].sha256)
  const arm64 = checksum(files["linux-arm64"].sha256)
  if (typeof value.version !== "string" || !parseRunnerVersion(value.version) || x64 === undefined || arm64 === undefined) return undefined
  return { version: value.version, x64, arm64 }
}

/**
 * Of the files main must hold a prod version in, those that do not: a dev
 * version, or anything that is not a version at all.
 */
export function devVersionFiles(files: { path: string; version: unknown }[]): { path: string; version: unknown; dev: boolean }[] {
  const isProd = (version: unknown) => typeof version === "string" && parseRunnerVersion(version) !== undefined && !isDevVersion(version)
  return files
    .filter((file) => !isProd(file.version))
    .map((file) => ({ ...file, dev: typeof file.version === "string" && isDevVersion(file.version) }))
}
