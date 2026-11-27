/**
 * Check L1's parts (specs/016-build-from-source, T021; FR-083, SC-009;
 * contracts/runner.md RB18; research/map-checks.md part 7, L1): runner
 * 0.1.1 itself, downloaded in the stand-in, given signed version-2 deploys
 * whose Compose text asks for a build. Pure; `released-run.ts` runs it in
 * the stand-in, and `apps/runner/test/linux-checks/released-runner.test.ts`
 * is the check.
 *
 * The file is the release's, for the stand-in's processor, over plain HTTPS
 * with no token, inside the stand-in. Its SHA-256 is held to what commit
 * `ee40f7d` recorded in `apps/cli/src/version/runner-release.json`, read
 * with `git show` (the job fetches the whole history). The runner the
 * stand-in had at `/usr/local/bin/zekno-runner` is kept aside under another
 * name and put back after.
 */
import { q } from "../stand-in/shell"

export const CHECK = "L1"
export const VERSION = "0.1.1"
/** The commit that recorded runner 0.1.1's checksums, and the file it recorded them in. */
export const RECORDED_AT = "ee40f7d"
export const RECORDED_FILE = "apps/cli/src/version/runner-release.json"

/** The check's folder in the stand-in: the download, the runner's home, Docker's configuration for its builds. */
export const ROOT = "/tmp/zekno-check-released-runner"
export const RUNNER_HOME = `${ROOT}/home`
export const DOCKER_CONFIG = `${ROOT}/docker`
export const DOWNLOAD = `${ROOT}/zekno-runner`
/** Where the runner is put, as on a server, and where the stand-in's own waits meanwhile. */
export const RUNNER = "/usr/local/bin/zekno-runner"
export const KEPT = "/usr/local/bin/zekno-runner.zekno-check-kept"

const PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
const SHA256 = /^[0-9a-f]{64}$/

export type Arch = "x64" | "arm64"

/** The release's processor for what `uname -m` printed in the stand-in. */
export function archOf(uname: string): Arch {
  const machine = uname.trim()
  if (machine === "x86_64" || machine === "amd64") return "x64"
  if (machine === "aarch64" || machine === "arm64") return "arm64"
  throw new Error(
    `${CHECK} stopped: the stand-in's processor ${JSON.stringify(machine)} has no runner ${VERSION}`
  )
}

/** Where release 0.1.1 publishes the file for `arch`, as `version/runner-release.ts` says. */
export function releaseUrl(arch: Arch): string {
  return `https://github.com/zekno-app/zekno/releases/download/runner-v${VERSION}/zekno-runner-linux-${arch}.gz`
}

/** The SHA-256 the recorded runner-release.json gives for `arch`; anything else stops with one line. */
export function recordedHash(json: string, arch: Arch): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(
      `${CHECK} stopped: ${RECORDED_FILE} at ${RECORDED_AT} is not JSON`
    )
  }
  const release = (parsed ?? {}) as {
    version?: unknown
    files?: Record<string, { sha256?: unknown } | undefined>
  }
  const hash = release.files?.[`linux-${arch}`]?.sha256
  if (
    release.version !== VERSION ||
    typeof hash !== "string" ||
    !SHA256.test(hash)
  )
    throw new Error(
      `${CHECK} stopped: ${RECORDED_FILE} at ${RECORDED_AT} records no SHA-256 of runner ${VERSION} for linux-${arch}`
    )
  return hash
}

/** The most a runner may weigh, downloaded or unpacked, as the CLI's installer holds it (`apps/cli/src/server/install/script.ts`): 256 MiB. */
export const RUNNER_MAX_BYTES = 268_435_456

/**
 * Checks `gz` is gzip and unpacks it to `out`, never more than `max` bytes
 * of it: past that, `out` is removed and the script stops with one line,
 * before any hash is taken.
 */
export function unpackLines(
  gz: string,
  out: string,
  max: number = RUNNER_MAX_BYTES
): string[] {
  if (!Number.isInteger(max) || max <= 0)
    throw new Error("the most a file unpacks to is a whole number of bytes")
  return [
    `gzip -t ${q(gz)}`,
    `gzip -dc ${q(gz)} | head -c ${max + 1} > ${q(out)}`,
    `rm -f ${q(gz)}`,
    `size=$(wc -c < ${q(out)} | tr -d ' ')`,
    `if [ "$size" -gt ${max} ]; then rm -f ${q(out)}; echo "the release file unpacks to more than ${max} bytes" >&2; exit 1; fi`,
  ]
}

/** The `sh` script that downloads the file over HTTPS only, at most 256 MiB, checks it is gzip, unpacks at most 256 MiB, and prints its SHA-256. */
export function downloadScript(url: string): string {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9/._-]+\.gz$/.test(url))
    throw new Error(
      `${JSON.stringify(url)} is not a release file on github.com`
    )
  return [
    "set -eu",
    `rm -rf ${ROOT}`,
    `mkdir -p ${ROOT} ${DOCKER_CONFIG}`,
    `curl --fail --silent --show-error --location --proto =https --proto-redir =https --tlsv1.2 --max-time 300 --max-filesize ${RUNNER_MAX_BYTES} --output ${DOWNLOAD}.gz ${q(url)}`,
    ...unpackLines(`${DOWNLOAD}.gz`, DOWNLOAD),
    `sha256sum ${DOWNLOAD} | cut -d ' ' -f 1`,
  ].join("\n")
}

/** The SHA-256 `sha256sum` printed. */
export function hashIn(stdout: string): string | undefined {
  const hash = stdout.trim()
  return SHA256.test(hash) ? hash : undefined
}

/** The mismatch line: the check stops with it. */
export function mismatchLine(
  arch: Arch,
  found: string,
  recorded: string
): string {
  return `${CHECK} stopped: the runner ${VERSION} downloaded for linux-${arch} has SHA-256 ${found}, not ${recorded} as ${RECORDED_AT} recorded`
}

/** Where the place and restore scripts work: the stand-in's paths, or a test's. */
export type RunnerPaths = {
  readonly runner: string
  readonly kept: string
  readonly download: string
}
export const STAND_IN_PATHS: RunnerPaths = {
  runner: RUNNER,
  kept: KEPT,
  download: DOWNLOAD,
}

/** Keeps the stand-in's runner aside (never over one kept before) and puts the download in its place, mode 755. */
export function placeScript(paths: RunnerPaths = STAND_IN_PATHS): string {
  const runner = q(paths.runner)
  const part = q(`${paths.runner}.part`)
  const kept = q(paths.kept)
  return [
    "set -eu",
    `if [ -e ${kept} ]; then echo "${paths.kept} is there from an earlier run; put it back at ${paths.runner} first" >&2; exit 3; fi`,
    `if [ -e ${runner} ]; then mv ${runner} ${kept}; fi`,
    `cp ${q(paths.download)} ${part}`,
    `chmod 0755 ${part}`,
    `mv -f ${part} ${runner}`,
  ].join("\n")
}

/** Removes the runner the check put there, by its SHA-256, and puts back the one it kept aside. */
export function restoreScript(
  recorded: string,
  paths: RunnerPaths = STAND_IN_PATHS
): string {
  if (!SHA256.test(recorded)) throw new Error("a SHA-256 is 64 hex")
  const runner = q(paths.runner)
  const kept = q(paths.kept)
  return [
    "set -eu",
    `rm -f ${q(`${paths.runner}.part`)}`,
    `if [ -e ${runner} ] && [ "$(sha256sum ${runner} | cut -d ' ' -f 1)" = ${recorded} ]; then rm -f ${runner}; fi`,
    `if [ -e ${kept} ]; then`,
    `  if [ -e ${runner} ]; then echo "${paths.runner} is not runner ${VERSION}; the runner kept aside is left at ${paths.kept}" >&2; exit 1; fi`,
    `  mv ${kept} ${runner}`,
    "fi",
  ].join("\n")
}

/** `zekno-runner <command>` with exactly its environment: its home and Docker's configuration in the check's folder. */
export function runnerCommand(command: string): string[] {
  if (!["setup", "sync", "status", "version", "session"].includes(command))
    throw new Error(`${command} is not a command runner ${VERSION} takes here`)
  return [
    ...["env", "-i", `PATH=${PATH}`, "HOME=/root"],
    `DOCKER_CONFIG=${DOCKER_CONFIG}`,
    `ZEKNO_RUNNER_HOME=${RUNNER_HOME}`,
    RUNNER,
    command,
  ]
}

/** A Compose text that asks for a build, and the context it names. */
export type BuildCase = {
  readonly key: string
  readonly context: string
  /** What the record line calls it. */
  readonly words: string
}

/** The three contexts of RB18: the app's own folder, a git address that cannot resolve, and two folders up, the runner's home. */
export const BUILD_CASES: readonly BuildCase[] = [
  { key: "dot", context: ".", words: "context ." },
  {
    key: "git",
    context: "https://check.invalid/repo.git",
    words: "context https://check.invalid/repo.git",
  },
  { key: "parent", context: "../..", words: "context ../.." },
]

/** The app each case deploys. */
export const appOf = (key: string): string => `check-released-${key}`
/**
 * The image each case's service names, so the build is named, and removed,
 * exactly. Never under `zekno.invalid/`: since step 1, core signs that name
 * only for a build the deploy lists (CO2), and these deploys list none.
 */
export const imageOf = (key: string): string =>
  `check.invalid/check-released-${key}:1`
/** The Compose project runner 0.1.1 runs an app as, and the network Compose makes for it. */
export const projectOf = (key: string): string => `zekno-${appOf(key)}`
export const networkOf = (key: string): string => `${projectOf(key)}_default`

/** The one step every case's Dockerfile has: a label, and nothing read from the context. */
export const INLINE_DOCKERFILE = 'FROM scratch\nLABEL zekno.check="L1"\n'

/**
 * The signed Compose text of one case: one service whose image runner 0.1.1
 * never has, never pulled, with a build of `context` and a Dockerfile given
 * in the text, so a build Compose starts can end in an image.
 */
export function composeText(item: BuildCase): string {
  return [
    "services:",
    "  web:",
    `    image: ${JSON.stringify(imageOf(item.key))}`,
    "    pull_policy: never",
    "    build:",
    `      context: ${JSON.stringify(item.context)}`,
    `      dockerfile_inline: ${JSON.stringify(INLINE_DOCKERFILE)}`,
    "",
  ].join("\n")
}

/** One `deploy` request of a session, on one line. */
export function sessionLine(input: unknown): string {
  return `${JSON.stringify({ command: "deploy", input })}\n`
}

/** The result of a session's one request, and the lines Docker printed as `progress` events. */
export function answerOf(stdout: string): {
  result: Record<string, unknown> | undefined
  lines: string[]
} {
  let result: Record<string, unknown> | undefined
  const lines: string[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue
    let frame: unknown
    try {
      frame = JSON.parse(line)
    } catch {
      continue
    }
    const f = (frame ?? {}) as Record<string, unknown>
    if (typeof f.result === "object" && f.result !== null)
      result = f.result as Record<string, unknown>
    else if (f.event === "progress" && typeof f.line === "string")
      lines.push(f.line)
  }
  return { result, lines }
}

/** The lines of `after` that `before` did not have, sorted. */
export function newLines(before: string, after: string): string[] {
  const had = new Set(before.split("\n").map((line) => line.trim()))
  return [
    ...new Set(
      after
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !had.has(line))
    ),
  ].sort()
}

/** A last line of Compose's, one line, at most 300 characters. */
export function lastWords(lines: readonly string[]): string {
  const last = [...lines].reverse().find((line) => line.trim() !== "")
  if (last === undefined) return "nothing"
  const one = last.replace(/\p{Cc}/gu, " ").trim()
  return JSON.stringify(one.length > 300 ? `${one.slice(0, 300)}…` : one)
}

/** The number a deploy of `app` used, in what `zekno-runner status` printed. */
export function sequenceOf(status: string, app: string): string {
  try {
    const parsed = JSON.parse(status.trim().split("\n").at(-1) ?? "") as {
      lastSequence?: Record<string, unknown>
      outcome?: unknown
    }
    if (parsed.lastSequence === undefined)
      return `no state (${String(parsed.outcome ?? "unread")})`
    const found = parsed.lastSequence[app]
    return typeof found === "number" ? `number ${found} used` : "no number used"
  } catch {
    return "the state could not be read"
  }
}

/** What one case's deploy did, for the record line. */
export function caseWords(input: {
  readonly item: BuildCase
  readonly result: Record<string, unknown> | undefined
  readonly code: number
  readonly lines: readonly string[]
  readonly built: boolean
  readonly images: readonly string[]
  readonly containers: readonly string[]
  readonly sequence: string
}): string {
  const outcome =
    input.result === undefined
      ? `no answer (exit ${input.code})`
      : [input.result.outcome, input.result.reason]
          .filter((part) => typeof part === "string")
          .join(" ")
  return [
    `${input.item.words}: ${outcome || "no outcome"}`,
    input.built ? "Compose built the image" : "no image built",
    `Compose's last line ${lastWords(input.lines)}`,
    `images after: ${input.images.join(" ") || "none new"}`,
    `containers after: ${input.containers.join(" ") || "none new"}`,
    `state: ${input.sequence}`,
  ].join(", ")
}
