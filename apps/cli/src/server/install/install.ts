/**
 * Installing the runner over SSH (specs/004-cli-app/contracts/commands.md,
 * "Installing the runner over SSH"). This runs a shell script on someone's
 * server, so it is held to a few strict rules:
 *
 * - The script's text is fixed (script.ts). Nothing is ever put into it.
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
 *
 * One subject per file in this folder: the script (script.ts); what is
 * placed into it and how each value is checked (checks.ts); what it prints
 * and how that is read (lines.ts); what a person is told when it stops
 * (failures.ts). This file runs it: it is what `server add` and
 * `server update` call.
 */
import { CliError } from "../../cli/errors"
import { sanitize } from "../sanitize"
import type { RunnerProcess, Transport } from "../transport"
import { installWords, type InstallRequest, type RunnerPlace } from "./checks"
import { INSTALL_UNEXPECTED, installFailure, unreachable } from "./failures"
import {
  followsOrder,
  parseInstallLine,
  scriptLines,
  type InstallEvent,
} from "./lines"
import { INSTALL_SCRIPT } from "./script"

/** Sends the runner file in pieces, each once the last has left, so a slow connection never piles the file up twice. */
async function sendFile(
  child: RunnerProcess,
  bytes: Uint8Array
): Promise<void> {
  const PIECE = 64 * 1024
  for (let at = 0; at < bytes.length; at += PIECE)
    await child.send(bytes.subarray(at, at + PIECE))
}

/** How long the script has to exit after its last line. */
const EXIT_GRACE_MS = 5000

const within = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>(
    (resolve) => (timer = setTimeout(() => resolve(undefined), ms))
  )
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
  if (!transport.script)
    throw new CliError("The runner is installed only over SSH.")
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
      if (event.kind === "fail")
        throw new CliError(installFailure(event.reason, request, where))
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
    if (events.length === 0 && code === 255)
      throw new CliError(unreachable(where.destination))
    throw new CliError(INSTALL_UNEXPECTED)
  } catch (error) {
    stop()
    throw error
  }
}
