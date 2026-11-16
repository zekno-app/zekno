/**
 * What `zekno doctor` runs on a server to look at it (specs/006-cli-small-features,
 * contracts/doctor.md, "CHECK_SCRIPT"; research R11). It follows the rules of
 * the installer's script (install/script.ts), and adds one: it only reads.
 *
 * - The script's text is fixed, below: one `{ ... }` block, so the shell has
 *   read all of it before it runs any of it, with no `${` and no backquote,
 *   so the template cannot put anything into it. It sets the C locale first.
 * - It is started as `sh -s -- check <runner path>`, its text sent on
 *   standard input, which is then closed. The runner path is the only value
 *   that varies: `checkWords` holds it to `isInstallPath` just before it is
 *   placed, the transport holds every word to its own pattern again, and the
 *   script refuses an empty one or one that starts with `-`.
 * - It runs nothing that writes: no folder is made, no file moved, copied,
 *   downloaded, created or removed, no mode changed, and the runner is not
 *   started. It asks Docker for its Compose version, looks whether a file
 *   that can be run is at the runner's path, and asks `df` how much room is
 *   left where the runner keeps its state, or the nearest folder above it.
 *   The lines it shares with the installer are copied word for word, and a
 *   test runs both against the same stand-in server.
 * - What the server prints is read one line at a time, at most
 *   `INSTALL_LINE_LIMIT` bytes each, against fixed patterns in a fixed order;
 *   anything else ends the reading. No line is ever used as a path, a command
 *   or a file name: a Compose version is held to `[0-9A-Za-z.+-]{1,32}`, a
 *   number to `[0-9]{1,15}`, and what is drawn is cleaned before it is.
 *
 * `doctor` reaches a server in SSH's batch mode only, so this never waits on
 * a person: where SSH would ask, it ends at once, and that is reported.
 */
import { CliError } from "../cli/errors"
import { isInstallPath } from "./install/checks"
import { INSTALL_LINE_LIMIT, scriptLines } from "./install/lines"
import type { Transport } from "./transport"

/** The script, exactly as contracts/doctor.md writes it. */
export const CHECK_SCRIPT = String.raw`{
set -eu
LC_ALL=C
export LC_ALL
say() { printf '%s\n' "$*"; }
fail() { say "fail $1"; exit 1; }
trap 'exit 1' HUP INT TERM

say connected

[ "$#" -eq 2 ] || fail usage
[ "$1" = check ] || fail usage
target=$2
case $target in ''|-*) fail usage ;; esac

if command -v docker >/dev/null 2>&1 && docker compose version </dev/null >/dev/null 2>&1; then
  compose=$(docker compose version --short </dev/null 2>/dev/null | head -n 1 | cut -c 1-32) || compose=
  case $compose in ''|*[!0-9A-Za-z.+-]*) compose=unknown ;; esac
  say "docker ok $compose"
else
  say "docker none"
fi

set +u
home=$HOME
set -u
if [ "$(id -u)" = 0 ]; then
  folder=/var/lib/zekno
else
  case $home in /*) ;; *) fail home ;; esac
  folder=$home/.local/state/zekno
fi

case $target in
  '~/'*) runner=$home/$(printf '%s' "$target" | cut -c 3-) ;;
  */*) runner=$target ;;
  *) runner=$(command -v "$target" 2>/dev/null) || runner= ;;
esac
case $runner in */*) ;; *) runner= ;; esac
if [ -n "$runner" ] && [ -f "$runner" ] && [ -x "$runner" ]; then say "runner here"; else say "runner none"; fi

place=$folder
while [ ! -d "$place" ]; do
  above=$(dirname "$place")
  [ "$above" != "$place" ] || break
  place=$above
done
free=
if command -v df >/dev/null 2>&1; then
  free=$(df -Pk "$place" </dev/null 2>/dev/null | tail -n 1 | tr -s ' ' | cut -d ' ' -f 4) || free=
fi
case $free in ''|*[!0-9]*) say "space unknown" ;; *) say "space $free" ;; esac
say done
exit 0
}
`

/** Said when the runner path from the profile cannot be a word of the check, before anything is sent. */
export const CHECK_PATH_INVALID =
  "The runner path for the check is not valid, so nothing was sent to the server."

/**
 * The words after `sh -s --`: `check` and the runner's path from the
 * profile, held to the installer's rule for a path that can be an argument
 * (`isInstallPath`). One that does not fit throws, and nothing is sent.
 */
export function checkWords(runnerPath: string): string[] {
  if (typeof runnerPath !== "string" || !isInstallPath(runnerPath))
    throw new CliError(CHECK_PATH_INVALID)
  return ["check", runnerPath]
}

/**
 * What the check found. `reached`: the script said `connected`, so SSH
 * logged in and the script started. `docker`: Compose's version when it has a
 * version's shape, or none at all. `runner`: whether a file that can be run is
 * at the runner's path. `space`: the KiB free where the runner keeps its
 * state. `home: false`: the user has no home folder. `unread`: the server
 * answered, but not with the script's lines in the script's order. `exitCode`:
 * how the connection ended, when it did.
 */
export type CheckRead = {
  reached: boolean
  docker?: { version?: string } | "none"
  runner?: "here" | "none"
  space?: number | "unknown"
  home?: false
  unread?: true
  exitCode?: number
}

/** How long the script has to exit once it said `done`, or once its reading ended. */
const EXIT_GRACE_MS = 5000

/** How long to wait, once the connection has ended, for the last of what SSH wrote on standard error. */
const ERRORS_GRACE_MS = 1000

/** Resolves with what `promise` gives, or with undefined after `ms` milliseconds. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>(
    (resolve) => (timer = setTimeout(() => resolve(undefined), ms))
  )
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** A Compose version as `zekno doctor` names it: one of a version's shape, its `v` dropped. */
const VERSION_SHAPE = /^v?([0-9]+(\.[0-9]+){1,3})$/

/**
 * Runs `CHECK_SCRIPT` on the server `transport` reaches, and reads its lines
 * (contracts/doctor.md, "The lines it prints"). `signal` stops it at once:
 * the connection is ended and what was read so far is returned. Nothing a
 * line says is used but the result above.
 */
export async function runCheck(
  transport: Transport,
  runnerPath: string,
  signal: AbortSignal
): Promise<CheckRead> {
  if (!transport.script) throw new CliError("The check runs only over SSH.")
  const words = checkWords(runnerPath)
  const child = transport.script(words)
  const lines = scriptLines(child.output)
  const stop = () => {
    lines.cancel()
    child.end()
    child.kill()
  }
  if (signal.aborted) stop()
  else signal.addEventListener("abort", stop, { once: true })
  const read: CheckRead = { reached: false }
  // The script reads nothing after itself: its input is closed as soon as it has been sent.
  child.write(CHECK_SCRIPT)
  child.end()
  try {
    let step = 0
    let finished = false
    for (;;) {
      const line = await lines.next()
      if (line.kind === "end") break
      if (line.kind === "too_long" || line.text.length > INSTALL_LINE_LIMIT) {
        read.unread = true
        break
      }
      const text = line.text
      if (step === 0) {
        if (text !== "connected") {
          read.unread = true
          break
        }
        read.reached = true
        step = 1
        continue
      }
      const fail = /^fail (usage|home)$/.exec(text)
      if (fail) {
        if (fail[1] === "home") read.home = false
        else read.unread = true
        finished = true
        break
      }
      let fits = true
      if (step === 1) {
        const docker = /^docker ok ([0-9A-Za-z.+-]{1,32})$/.exec(text)
        if (text === "docker none") read.docker = "none"
        else if (docker) {
          const version = VERSION_SHAPE.exec(docker[1]!)?.[1]
          read.docker = version === undefined ? {} : { version }
        } else fits = false
      } else if (step === 2) {
        const runner = /^runner (here|none)$/.exec(text)
        if (runner) read.runner = runner[1] as "here" | "none"
        else fits = false
      } else if (step === 3) {
        const space = /^space ([0-9]{1,15}|unknown)$/.exec(text)
        if (space)
          read.space = space[1] === "unknown" ? "unknown" : Number(space[1])
        else fits = false
      } else if (text === "done") {
        finished = true
        break
      } else fits = false
      if (!fits) {
        read.unread = true
        break
      }
      step++
    }
    // An end before `done`, once the script had started, is not the script's.
    if (read.reached && !finished) read.unread = true
  } finally {
    lines.cancel()
    child.end()
  }
  const code = await within(child.exited, EXIT_GRACE_MS)
  if (code === undefined) child.kill()
  else read.exitCode = code
  // What SSH said on standard error (why it stopped) may still be on its way once it has exited: the caller decides on it.
  await within(child.errorsRead, ERRORS_GRACE_MS)
  signal.removeEventListener("abort", stop)
  return read
}
