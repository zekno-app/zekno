/**
 * Reaching a server with nothing asked on the terminal: SSH in batch mode,
 * which never asks for a password, a passphrase or whether to trust a host
 * key, and stops instead. What SSH wrote on standard error then tells
 * whether it stopped where it would have asked. The app's reads in the
 * background (app/effects/servers.ts), the lists a single command offers
 * (asking/asking.ts) and doctor's connections (ops/doctor.ts) reach servers
 * this way, within `READ_LIMIT_MS`. Handing the terminal over when SSH has to
 * ask is the app's alone (app/hand-over.ts).
 */
import type { Deps } from "../cli/context"
import type { ErrorLines } from "./transport"

/**
 * How long a read of a server made this way may take: 20 seconds, for the
 * app's reads in the background, over a server's kept session or connecting
 * again in batch mode, for the read of a server's apps a single command's
 * list is made of, and for each of doctor's connections. Past it the app
 * closes the session and shows the server as not reached, never with state
 * that looks current when it is not.
 */
export const READ_LIMIT_MS = 20_000

/** Lines of an attempt kept to decide on: the last ones written, since SSH's closing line comes last. */
const KEPT_LINES = 64

/**
 * SSH's closing line when it stopped where it would have asked: whole lines,
 * in the form OpenSSH writes them. `<user@host>: Permission denied (<methods>).`
 * for a password or passphrase, and the host key line for an unknown or
 * changed host key.
 */
const DENIED = /^[^\s:]{1,255}: Permission denied \([a-z0-9,-]{1,128}\)\.$/
const HOST_KEY = "Host key verification failed."

/**
 * Whether the last thing written on standard error is SSH's closing line.
 * Only the last line counts, and only whole: the words alone, anywhere in
 * what a remote command wrote, say nothing about SSH.
 */
function saysWouldAsk(lines: readonly string[]): boolean {
  const written = lines.map((line) => line.trim()).filter((line) => line !== "")
  const last = written.at(-1)
  return last !== undefined && (last === HOST_KEY || DENIED.test(last))
}

/**
 * For what the app reads on its own, every few seconds, with nobody having
 * asked: SSH in batch mode only, and the terminal never handed over. What SSH
 * writes on standard error goes to `lines` (the last few), so that a failure
 * where SSH would have asked can be told from others (`wouldHaveAsked`).
 * A runner on this machine is reached as usual.
 */
export function batchOnly(
  connect: Deps["connect"],
  lines: string[]
): Deps["connect"] {
  return (target, localRunner, options = {}) =>
    connect(target, localRunner, {
      ...options,
      batch: true,
      errorLines: recording(lines, undefined),
    })
}

/** Whether SSH said it stopped where it would have asked for a password, a passphrase or a host key. */
export const wouldHaveAsked = (lines: readonly string[]): boolean =>
  saysWouldAsk(lines)

/** Keeps the last lines an attempt wrote, and passes every line on. */
export function recording(
  lines: string[],
  out: ErrorLines | undefined
): ErrorLines {
  return (line) => {
    lines.push(line)
    if (lines.length > KEPT_LINES) lines.shift()
    return out?.(line)
  }
}
