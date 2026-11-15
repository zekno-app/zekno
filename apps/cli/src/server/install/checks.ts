/**
 * What is placed into the installer's script, and how it is checked: what
 * `server add` and `server update` ask for, the runner file read for
 * `--runner-file`, and the words after `sh -s --`, each held to its pattern
 * just before it is placed (the rules: install.ts).
 */
import { RUNNER_VERSION_PATTERN } from "@workspace/core"
import { statSync } from "node:fs"

import { CliError } from "../../cli/errors"
import { RUNNER_RELEASE, type RunnerArch } from "../../version/runner-release"
import { RUNNER_PATH } from "../transport"

/** A runner version: the one grammar of packages/core (contracts/release.md, "Versions and tags"). */
export const VERSION_PATTERN = RUNNER_VERSION_PATTERN
export const ARCH_PATTERN = /^(x64|arm64)$/
export const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** The largest runner file this CLI sends or a server accepts: 256 MiB. */
export const RUNNER_FILE_LIMIT = 256 * 1024 * 1024

/** Where the runner goes or was found, as the script reports it. */
export type RunnerPlace = "system" | "user" | "path" | "target"

/**
 * The path this CLI keeps for each place the script can report. Fixed here,
 * never taken from the server: `~` is expanded by the server's shell when
 * the runner is started, as it is for any SSH command.
 */
export const RUNNER_PATHS = {
  system: "/usr/local/bin/zekno-runner",
  user: "~/.local/bin/zekno-runner",
  path: "zekno-runner",
} as const satisfies Record<Exclude<RunnerPlace, "target">, string>

/** One published file: the architecture and the SHA-256 this CLI holds for it. */
export type ReleaseFile = { arch: RunnerArch; sha256: string }

/** A runner file on this machine, read once: what is sent is exactly what was hashed. */
export type RunnerFile = { bytes: Uint8Array; sha256: string }

export type InstallSource = { kind: "release"; files: readonly ReleaseFile[] } | { kind: "file"; file: RunnerFile }

export type InstallRequest =
  | { mode: "add"; version: string; source: InstallSource }
  | { mode: "update"; version: string; runnerPath: string; source: Extract<InstallSource, { kind: "release" }> }

/** The runner this CLI carries, as release files: only those with a published checksum. */
export function releaseFiles(release: { files: Record<string, { sha256: string | null }> } = RUNNER_RELEASE): ReleaseFile[] {
  const files: ReleaseFile[] = []
  for (const arch of ["x64", "arm64"] as const) {
    const sha256 = release.files[`linux-${arch}`]?.sha256
    if (sha256) files.push({ arch, sha256 })
  }
  return files
}

const placed = (what: string) => new CliError(`The ${what} for the installer is not valid, so nothing was sent to the server.`)

/** A runner path that can be an argument: the profile's pattern, and never something an option could be read from. */
export const isInstallPath = (path: string): boolean => RUNNER_PATH.test(path) && !path.startsWith("-")

/**
 * Whether an update may replace the file at `path`: only one named
 * `zekno-runner`. The path comes from the profile file, which is not signed,
 * so without this an edited profile could point an update at any program on
 * the server and have it replaced.
 */
export const isRunnerFileName = (path: string): boolean => path === "zekno-runner" || path.endsWith("/zekno-runner")

/**
 * The words after `sh -s --`. Every value is checked against its pattern
 * here, immediately before it is placed; one that does not fit throws, and
 * nothing is sent. The mode and the source are words of this function's own.
 */
export function installWords(request: InstallRequest): string[] {
  const words: string[] = [request.mode === "update" ? "update" : "add"]
  if (typeof request.version !== "string" || !VERSION_PATTERN.test(request.version)) throw placed("version")
  words.push(request.version)
  if (request.mode === "update") {
    if (typeof request.runnerPath !== "string" || !isInstallPath(request.runnerPath)) throw placed("runner path")
    if (!isRunnerFileName(request.runnerPath)) throw placed("runner path")
    words.push(request.runnerPath)
  }
  const source = request.source
  if (source.kind === "file") {
    if (request.mode !== "add") throw placed("runner file")
    if (typeof source.file.sha256 !== "string" || !SHA256_PATTERN.test(source.file.sha256)) throw placed("SHA-256")
    words.push("file", source.file.sha256)
    return words
  }
  words.push("release")
  for (const file of source.files) {
    if (typeof file.arch !== "string" || !ARCH_PATTERN.test(file.arch)) throw placed("architecture")
    if (typeof file.sha256 !== "string" || !SHA256_PATTERN.test(file.sha256)) throw placed("SHA-256")
    words.push(file.arch, file.sha256)
  }
  return words
}

/**
 * Reads a runner file for `--runner-file`: a regular file of at most 256 MiB.
 * It is read whole, once, so the SHA-256 is of exactly the bytes sent.
 */
export async function readRunnerFile(path: string): Promise<RunnerFile> {
  let info
  try {
    info = statSync(path)
  } catch {
    throw new CliError("There is no runner file at that path.")
  }
  if (!info.isFile()) throw new CliError("The runner file must be a regular file.")
  if (info.size > RUNNER_FILE_LIMIT) throw new CliError("The runner file is larger than 256 MiB.")
  const bytes = await Bun.file(path).bytes()
  if (bytes.length === 0) throw new CliError("The runner file is empty.")
  if (bytes.length > RUNNER_FILE_LIMIT) throw new CliError("The runner file is larger than 256 MiB.")
  return { bytes, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }
}
