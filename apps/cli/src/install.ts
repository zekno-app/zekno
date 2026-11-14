/**
 * Installing the runner over SSH (specs/004-cli-app/contracts/commands.md,
 * "Installing the runner over SSH"). This runs a shell script on someone's
 * server, so it is held to a few strict rules:
 *
 * - The script's text is fixed, below. Nothing is ever put into it.
 * - It is started as `sh -s -- <words>`, its text sent on standard input.
 *   The words are the only values that vary: a mode and a source from fixed
 *   lists, the version, each architecture and its SHA-256, and for an update
 *   the runner's path. `installWords` checks each against its pattern just
 *   before it is placed, and throws before anything is sent when one does not
 *   fit. The script checks them again itself.
 * - Nothing that came from a server is ever put into the script or into an
 *   argument. Where the runner was found or put is reported by the script as
 *   one of a few fixed words, and the CLI turns that word into a path of its
 *   own (`RUNNER_PATHS`).
 * - The script prints one short line per step. Each is read against a fixed
 *   pattern; anything else ends the install. What the server writes on
 *   standard error is cleaned before anyone sees it (transport.ts).
 * - The SHA-256 a runner is checked against comes from this CLI
 *   (runner-release.json), or, with `--runner-file`, from the file this CLI
 *   sends. Never from the download.
 */
import { statSync } from "node:fs"

import { CliError } from "./errors"
import { RUNNER_RELEASE, type RunnerArch } from "./runner-release"
import { sanitize } from "./sanitize"
import { RUNNER_PATH, type RunnerProcess, type Transport } from "./transport"

export const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/
export const ARCH_PATTERN = /^(x64|arm64)$/
export const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** The largest runner file this CLI sends or a server accepts: 256 MiB. */
export const RUNNER_FILE_LIMIT = 256 * 1024 * 1024

/**
 * The script. It is one `{ ... }` block, so the shell has read all of it
 * before it runs any of it: whatever is sent after the script (the runner
 * file, or the requests of the session the script hands over to) is read
 * by the commands meant for it, never by the shell as more script. That
 * holds for shells that read their input ahead, such as dash.
 *
 * Its arguments, as `installWords` builds them:
 *   add <version> release [<arch> <sha256>]...
 *   add <version> file <sha256>
 *   update <version> <runner path> release [<arch> <sha256>]...
 *
 * It never uses `sudo`, never runs a downloaded file before its checksum
 * matched, and works in a private temporary folder that is removed on exit.
 * A runner is put in place only after it answered with its version from that
 * folder, so one that cannot run on this server never replaces one that can.
 * An update replaces only a file named `zekno-runner`, and never a runner
 * newer than the one it carries.
 * Written with no `${` and no backquote, so the template below cannot
 * interpolate anything.
 */
export const INSTALL_SCRIPT = String.raw`{
set -eu
umask 077
say() { printf '%s\n' "$*"; }
fail() { say "fail $1"; exit 1; }
tmp=
cleanup() { if [ -n "$tmp" ]; then rm -rf "$tmp"; tmp=; fi; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

say connected

is_version() {
  case $1 in ''|*[!0-9.]*|.*|*.|*..*) return 1 ;; esac
  case $1 in *.*.*.*) return 1 ;; *.*.*) return 0 ;; esac
  return 1
}
is_sha() {
  case $1 in ''|*[!0-9a-f]*) return 1 ;; esac
  [ "$(expr "x$1" : '.*')" -eq 65 ]
}
is_path() {
  case $1 in ''|-*) return 1 ;; esac
  return 0
}
is_newer() {
  for part in 1 2 3; do
    ours=$(printf '%s' "$2" | cut -d . -f "$part")
    theirs=$(printf '%s' "$1" | cut -d . -f "$part")
    if [ "$theirs" -gt "$ours" ] 2>/dev/null; then return 0; fi
    if [ "$theirs" -lt "$ours" ] 2>/dev/null; then return 1; fi
  done
  return 1
}
pick() {
  want=$1
  shift
  while [ "$#" -ge 2 ]; do
    if [ "$1" = "$want" ]; then printf '%s' "$2"; return 0; fi
    shift 2
  done
  return 1
}
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl --proto =https --proto-redir =https --tlsv1.2 -fsSL --max-filesize 268435456 -o "$2" "$1" </dev/null >&2
    return
  fi
  command -v wget >/dev/null 2>&1 || return 1
  next=$1
  hops=0
  while :; do
    case $next in https://*) ;; *) return 1 ;; esac
    if wget -q -S --max-redirect=0 -O "$2" "$next" </dev/null 2>"$tmp/headers"; then return 0; fi
    hops=$((hops + 1))
    [ "$hops" -le 5 ] || return 1
    next=$(sed -n 's/^ *[Ll]ocation: *\([^ ]*\).*$/\1/p' "$tmp/headers" | tail -n 1 | tr -d '\r')
    [ -n "$next" ] || return 1
  done
}

[ "$#" -ge 3 ] || fail usage
mode=$1
version=$2
shift 2
is_version "$version" || fail usage
target=
case $mode in
  add) ;;
  update)
    target=$1
    shift
    is_path "$target" || fail usage
    case $target in zekno-runner|*/zekno-runner) ;; *) fail name ;; esac ;;
  *) fail usage ;;
esac
[ "$#" -ge 1 ] || fail usage
source=$1
shift
expected=
case $source in
  file)
    [ "$mode" = add ] && [ "$#" -eq 1 ] && is_sha "$1" || fail usage
    expected=$1 ;;
  release)
    arch_next=1
    for word in "$@"; do
      if [ "$arch_next" = 1 ]; then
        case $word in x64|arm64) ;; *) fail usage ;; esac
        arch_next=0
      else
        is_sha "$word" || fail usage
        arch_next=1
      fi
    done
    [ "$arch_next" = 1 ] || fail usage ;;
  *) fail usage ;;
esac

command -v docker >/dev/null 2>&1 || fail docker
docker compose version </dev/null >/dev/null 2>&1 || fail docker
compose=$(docker compose version --short </dev/null 2>/dev/null | head -n 1 | cut -c 1-32) || compose=
case $compose in ''|*[!0-9A-Za-z.+-]*) compose=unknown ;; esac
say "docker ok $compose"

set +u
home=$HOME
set -u
if [ "$(id -u)" = 0 ]; then
  bin=/usr/local/bin
  folder=/var/lib/zekno
  mine=system
else
  case $home in /*) ;; *) fail home ;; esac
  bin=$home/.local/bin
  folder=$home/.local/state/zekno
  mine=user
fi

runner=
where=
if [ "$mode" = update ]; then
  case $target in
    '~/'*) runner=$home/$(printf '%s' "$target" | cut -c 3-) ;;
    */*) runner=$target ;;
    *) runner=$(command -v "$target" 2>/dev/null) || runner= ;;
  esac
  case $runner in */*) ;; *) runner= ;; esac
  [ -n "$runner" ] && [ -f "$runner" ] && [ -x "$runner" ] || fail missing
  where=target
elif [ -f "$bin/zekno-runner" ] && [ -x "$bin/zekno-runner" ]; then
  runner=$bin/zekno-runner
  where=$mine
elif found=$(command -v zekno-runner 2>/dev/null); then
  case $found in /*) runner=$found; where=path ;; esac
fi

found=none
if [ -n "$runner" ]; then
  answer=$("$runner" version </dev/null 2>/dev/null | head -n 1 | cut -c 1-200) || answer=
  found=$(printf '%s\n' "$answer" | sed -n 's/^{"version":"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)",.*$/\1/p')
  [ -n "$found" ] || found=unknown
  say "runner found $where $found"
else
  say "runner none"
fi
if [ "$mode" = update ] && [ "$found" != unknown ] && is_newer "$found" "$version"; then fail newer; fi

install=yes
if [ -n "$runner" ]; then
  if [ "$mode" = add ] || [ "$found" = "$version" ]; then install=no; fi
fi
if [ "$mode" = add ]; then
  dest=$bin/zekno-runner
  [ -n "$runner" ] || where=$mine
else
  dest=$runner
fi
final=$runner

if [ "$install" = yes ]; then
  platform=$(uname -sm 2>/dev/null) || platform=
  case $platform in
    'Linux x86_64'|'Linux amd64') arch=x64 ;;
    'Linux aarch64'|'Linux arm64') arch=arm64 ;;
    *) fail platform ;;
  esac
  say "platform ok $arch"
  if [ "$source" = release ]; then expected=$(pick "$arch" "$@") || fail release; fi
  dir=$(dirname "$dest")
  mkdir -p "$dir" || fail install
  [ ! -d "$dest" ] || fail install
  tmp=$(mktemp -d "$dir/.zekno-install.XXXXXX") || fail install
  if [ "$source" = file ]; then
    say ready
    head -c 268435457 > "$tmp/zekno-runner" || fail download
  else
    url=https://github.com/zekno-app/zekno/releases/download/runner-v$version/zekno-runner-linux-$arch.gz
    fetch "$url" "$tmp/zekno-runner.gz" || fail download
    gzip -t "$tmp/zekno-runner.gz" </dev/null >&2 || fail download
    gzip -dc "$tmp/zekno-runner.gz" </dev/null | head -c 268435457 > "$tmp/zekno-runner" || fail download
    rm -f "$tmp/zekno-runner.gz"
  fi
  size=$(wc -c < "$tmp/zekno-runner" | tr -d ' ')
  [ "$size" -gt 0 ] && [ "$size" -le 268435456 ] || fail download
  say "download ok $size"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp/zekno-runner" </dev/null | cut -d ' ' -f 1)
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmp/zekno-runner" </dev/null | cut -d ' ' -f 1)
  else
    rm -f "$tmp/zekno-runner"
    fail tools
  fi
  if [ "$actual" != "$expected" ]; then
    rm -f "$tmp/zekno-runner"
    fail checksum
  fi
  say checksum ok
  chmod 755 "$tmp/zekno-runner" || fail install
  answer=$("$tmp/zekno-runner" version </dev/null 2>/dev/null | head -n 1 | cut -c 1-200) || answer=
  case $answer in "{\"version\":\"$version\","*) ;; *) rm -f "$tmp/zekno-runner"; fail version ;; esac
  mv -f "$tmp/zekno-runner" "$dest" || fail install
  cleanup
  final=$dest
  say install ok
fi

if [ "$install" = yes ] || [ "$found" = "$version" ]; then
  answer=$("$final" version </dev/null 2>/dev/null | head -n 1 | cut -c 1-200) || answer=
  case $answer in "{\"version\":\"$version\","*) ;; *) fail version ;; esac
  say version ok
fi

if [ ! -d "$folder" ]; then
  mkdir -p "$(dirname "$folder")" && mkdir -m 700 "$folder" || fail folder
fi
say folder ok
say "done $where"
trap - EXIT HUP INT TERM
if [ "$mode" = add ] && [ "$source" = release ]; then exec "$final" session; fi
exit 0
}
`

// ---------------------------------------------------------------------------
// What is placed into the script, and how it is checked

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

// ---------------------------------------------------------------------------
// What the script prints

export type InstallFailure =
  | "usage"
  | "name"
  | "newer"
  | "docker"
  | "home"
  | "missing"
  | "platform"
  | "release"
  | "download"
  | "tools"
  | "checksum"
  | "install"
  | "version"
  | "folder"

/** One line of the script, read. */
export type InstallEvent =
  | { kind: "connected" }
  /** Docker with Compose was found. `version` is Compose's, when it fits a version's shape. */
  | { kind: "docker"; version?: string }
  /** A runner is already there. `version` is undefined when it does not say (a runner from before 0.2.0). */
  | { kind: "runner"; place: RunnerPlace; version?: string }
  | { kind: "no-runner" }
  | { kind: "platform"; arch: RunnerArch }
  /** The script is ready for the runner file (`--runner-file` only). */
  | { kind: "ready" }
  /** The file is on the server, this many bytes, not yet checked. */
  | { kind: "download"; bytes: number }
  | { kind: "checksum" }
  | { kind: "install" }
  | { kind: "version" }
  | { kind: "folder" }
  | { kind: "done"; place: RunnerPlace }
  | { kind: "fail"; reason: InstallFailure }

const FAILURES: readonly string[] = [
  "usage",
  "name",
  "newer",
  "docker",
  "home",
  "missing",
  "platform",
  "release",
  "download",
  "tools",
  "checksum",
  "install",
  "version",
  "folder",
]

/** The script's lines are short. Anything longer is not one of them. */
export const INSTALL_LINE_LIMIT = 256

/** Reads one line the script printed, or undefined when it is not one of its lines. */
export function parseInstallLine(line: string): InstallEvent | undefined {
  if (line.length > INSTALL_LINE_LIMIT) return undefined
  const fixed: Record<string, InstallEvent> = {
    connected: { kind: "connected" },
    "runner none": { kind: "no-runner" },
    ready: { kind: "ready" },
    "checksum ok": { kind: "checksum" },
    "install ok": { kind: "install" },
    "version ok": { kind: "version" },
    "folder ok": { kind: "folder" },
  }
  if (Object.hasOwn(fixed, line)) return fixed[line]
  let match = /^docker ok ([0-9A-Za-z.+-]{1,32})$/.exec(line)
  if (match) {
    const shape = /^v?([0-9]+(\.[0-9]+){1,3})$/.exec(match[1]!)
    return shape ? { kind: "docker", version: shape[1] } : { kind: "docker" }
  }
  match = /^runner found (system|user|path|target) ([0-9]+\.[0-9]+\.[0-9]+|unknown)$/.exec(line)
  if (match) {
    const version = match[2] === "unknown" ? undefined : match[2]
    return { kind: "runner", place: match[1] as RunnerPlace, ...(version ? { version } : {}) }
  }
  match = /^platform ok (x64|arm64)$/.exec(line)
  if (match) return { kind: "platform", arch: match[1] as RunnerArch }
  match = /^download ok ([1-9][0-9]{0,9})$/.exec(line)
  if (match) return { kind: "download", bytes: Number(match[1]) }
  match = /^done (system|user|path|target)$/.exec(line)
  if (match) return { kind: "done", place: match[1] as RunnerPlace }
  match = /^fail ([a-z]+)$/.exec(line)
  if (match && FAILURES.includes(match[1]!)) return { kind: "fail", reason: match[1] as InstallFailure }
  return undefined
}

/** The order the steps come in. An event may only follow those before it in this list. */
const ORDER: readonly InstallEvent["kind"][] = [
  "connected",
  "docker",
  "runner",
  "no-runner",
  "platform",
  "ready",
  "download",
  "checksum",
  "install",
  "version",
  "folder",
  "done",
]

/**
 * Whether `event` may come next, given what came before: the script's own
 * order, each step once, an install only after a matching checksum, and the
 * end only once the folder is there. A server can still print a believable
 * list without doing anything; what it says here only decides what is shown.
 * What it does is checked by the session that follows.
 */
export function followsOrder(seen: readonly InstallEvent[], event: InstallEvent, request: InstallRequest): boolean {
  if (event.kind === "fail") return seen.length > 0
  const at = ORDER.indexOf(event.kind)
  const last = seen.at(-1)
  if (last === undefined) return event.kind === "connected"
  if (at <= ORDER.indexOf(last.kind)) return false
  const has = (kind: InstallEvent["kind"]) => seen.some((item) => item.kind === kind)
  const runnerSeen = has("runner") || has("no-runner")
  switch (event.kind) {
    case "docker":
      return last.kind === "connected"
    case "runner":
      return last.kind === "docker" && (request.mode === "update" ? event.place === "target" : event.place !== "target")
    case "no-runner":
      return last.kind === "docker" && request.mode === "add"
    case "platform":
      return runnerSeen
    case "ready":
      return last.kind === "platform" && request.source.kind === "file"
    case "download":
      return request.source.kind === "file" ? last.kind === "ready" : last.kind === "platform"
    case "checksum":
      return last.kind === "download"
    case "install":
      return last.kind === "checksum"
    case "version":
      return runnerSeen && (last.kind === "install" || last.kind === "runner")
    case "folder":
      return runnerSeen && (has("platform") || has("no-runner") ? has("version") : true)
    case "done":
      return last.kind === "folder" && (request.mode === "update" ? event.place === "target" : event.place !== "target")
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// What a person is told

export const INSTALL_UNEXPECTED = "The installer on the server did not answer as expected, so nothing more was done."

/** Said when an install is needed and this build of zekno holds no checksum to check a download against. */
export const NO_RELEASE =
  "This build of zekno has no published runner to install. For development, add `--runner-file <path>`. Or install the runner by hand as the runner's README describes (apps/runner/README.md), then add the server with `--runner-path <path>`."

/** The sentence for each way the install can stop (contracts/commands.md, "Installing the runner over SSH"). */
export function installFailure(reason: InstallFailure, request: InstallRequest, where: { destination: string; server?: string }): string {
  const file = request.source.kind === "file"
  switch (reason) {
    case "docker":
      return "Docker with Compose was not found on the server. Install Docker with its Compose plugin there, then try again."
    case "home":
      return "The user zekno logs in as on the server has no home folder, so there is nowhere to put the runner."
    case "missing":
      return `There is no runner at ${request.mode === "update" ? request.runnerPath : "that path"} on ${where.server ?? where.destination}.`
    case "platform":
      return "This kind of server is not supported yet. The runner is built for Linux on x86-64 and ARM64."
    case "release":
      return NO_RELEASE
    case "download":
      return file
        ? "The runner file did not arrive whole on the server. Nothing was installed."
        : "The server could not download the runner. It needs curl or wget, gzip, and to reach github.com over HTTPS."
    case "tools":
      return "The server has neither sha256sum nor shasum to check the runner with, so nothing was installed."
    case "checksum":
      return file
        ? "The runner file that arrived did not match the one sent. It was deleted and nothing was installed."
        : "The downloaded runner did not match the checksum this zekno holds. It was deleted and nothing was installed."
    case "install":
      return "The runner could not be put in place on the server. Check that the user zekno logs in as can write there."
    case "version":
      return `The runner did not start on the server: it did not answer with version ${request.version}.`
    case "folder":
      return "The runner's folder could not be created on the server."
    case "name":
      return notNamedRunner(request.mode === "update" ? request.runnerPath : "that path", where.server ?? where.destination)
    case "newer":
      return `The runner on ${where.server ?? where.destination} is newer than the ${request.version} this zekno carries, so it was left as it is. Update zekno instead.`
    case "usage":
      return INSTALL_UNEXPECTED
  }
}

/**
 * Whether an update may replace the file at `path`: only one named
 * `zekno-runner`. The path comes from the profile file, which is not signed,
 * so without this an edited profile could point an update at any program on
 * the server and have it replaced.
 */
export const isRunnerFileName = (path: string): boolean => path === "zekno-runner" || path.endsWith("/zekno-runner")

/** Said when the runner an update was asked to replace is not a file named `zekno-runner`. */
export const notNamedRunner = (path: string, server: string): string =>
  `zekno only replaces a runner whose file is named zekno-runner. The runner for ${server} is at ${path}. Replace that one by hand.`

/** Said when SSH itself could not connect: nothing of the script ran. */
export const unreachable = (destination: string): string =>
  `${destination} could not be reached over SSH. Check that \`ssh ${destination}\` works from this machine.`

// ---------------------------------------------------------------------------
// Running it

type Line = { kind: "line"; text: string } | { kind: "too_long" } | { kind: "end" }

/**
 * Reads the script's lines one at a time, never holding more than one line
 * of `INSTALL_LINE_LIMIT` bytes. `release` gives the stream back for the
 * session that follows, and says false when bytes beyond the last line were
 * already read: nothing may arrive before the session's first request.
 */
function scriptLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let held = new Uint8Array(0)
  let done = false
  const decoder = new TextDecoder()

  async function next(): Promise<Line> {
    for (;;) {
      const end = held.indexOf(0x0a)
      if (end !== -1) {
        const line = held.subarray(0, end)
        held = held.slice(end + 1)
        if (line.length > INSTALL_LINE_LIMIT) return { kind: "too_long" }
        return { kind: "line", text: decoder.decode(line) }
      }
      if (held.length > INSTALL_LINE_LIMIT) return { kind: "too_long" }
      if (done) {
        if (held.length === 0) return { kind: "end" }
        const text = decoder.decode(held)
        held = new Uint8Array(0)
        return { kind: "line", text }
      }
      try {
        const chunk = await reader.read()
        if (chunk.done) done = true
        else held = Buffer.concat([held, chunk.value])
      } catch {
        done = true
      }
    }
  }

  return {
    next,
    release(): boolean {
      reader.releaseLock()
      return held.length === 0
    },
    cancel: () => void reader.cancel().catch(() => {}),
  }
}

/** Sends the runner file in pieces, each once the last has left, so a slow connection never piles the file up twice. */
async function sendFile(child: RunnerProcess, bytes: Uint8Array): Promise<void> {
  const PIECE = 64 * 1024
  for (let at = 0; at < bytes.length; at += PIECE) await child.send(bytes.subarray(at, at + PIECE))
}

/** How long the script has to exit after its last line. */
const EXIT_GRACE_MS = 5000

const within = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)))
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

export type Installed = {
  /** Where the runner is. */
  place: RunnerPlace
  /** What the script said, in order. */
  events: InstallEvent[]
  /**
   * After `add` from a release, the script has become `zekno-runner session`
   * on the same connection: the session runs over this process.
   */
  session?: RunnerProcess
}

/**
 * Runs the script on the server `transport` reaches, reports each line as an
 * event, and resolves once it is done. A step that fails throws its
 * sentence; a line that is not one of the script's, or an end before the
 * script said it was done, throws `INSTALL_UNEXPECTED`.
 */
export async function runInstaller(
  transport: Transport,
  request: InstallRequest,
  where: { destination: string; server?: string },
  onEvent: (event: InstallEvent) => void = () => {},
  onDetail: (line: string) => void = () => {}
): Promise<Installed> {
  if (!transport.script) throw new CliError("The runner is installed only over SSH.")
  const words = installWords(request)
  const child = transport.script(words)
  const lines = scriptLines(child.output)
  const continues = request.mode === "add" && request.source.kind === "release"
  const events: InstallEvent[] = []
  const stop = () => {
    lines.cancel()
    child.end()
    child.kill()
  }
  child.write(INSTALL_SCRIPT)
  // Nothing follows the script but the runner file or the session, and an update has neither.
  if (request.mode === "update") child.end()
  try {
    for (;;) {
      const line = await lines.next()
      if (line.kind === "end") break
      if (line.kind === "too_long") throw new CliError(INSTALL_UNEXPECTED)
      const event = parseInstallLine(line.text)
      if (!event || !followsOrder(events, event, request)) {
        onDetail(sanitize(line.text))
        throw new CliError(INSTALL_UNEXPECTED)
      }
      events.push(event)
      onEvent(event)
      if (event.kind === "fail") throw new CliError(installFailure(event.reason, request, where))
      if (event.kind === "ready" && request.source.kind === "file") {
        await sendFile(child, request.source.file.bytes)
        child.end()
      }
      if (event.kind === "done") {
        if (continues) {
          if (!lines.release()) throw new CliError(INSTALL_UNEXPECTED)
          return { place: event.place, events, session: child }
        }
        child.end()
        await within(child.exited, EXIT_GRACE_MS)
        return { place: event.place, events }
      }
    }
    const code = await within(child.exited, EXIT_GRACE_MS)
    // SSH exits with 255 when it could not connect; then nothing of the script ran.
    if (events.length === 0 && code === 255) throw new CliError(unreachable(where.destination))
    throw new CliError(INSTALL_UNEXPECTED)
  } catch (error) {
    stop()
    throw error
  }
}
