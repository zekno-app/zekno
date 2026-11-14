import { remoteThroughUi, type Deps } from "../context"
import { UsageError } from "../errors"
import type { Where } from "../ops/deploy"
import { followLogs, LOG_TAIL, MAX_TAIL, prepareLogs } from "../ops/logs"

type Options = Where & { tail?: string; "no-follow"?: boolean }

/** `--tail`: a whole number from 0 to 1000, checked before anything is read or sent. */
export function parseTail(value: string | undefined): number {
  if (value === undefined) return LOG_TAIL
  if (!/^\d{1,4}$/.test(value) || Number(value) > MAX_TAIL) {
    throw new UsageError(`\`--tail\` takes a whole number from 0 to ${MAX_TAIL}.`)
  }
  return Number(value)
}

/**
 * Prints an app's logs, read straight from its server: plain, one
 * `<time>\t<service>\t<text>` line each on standard output. It follows until
 * interrupted, Docker's log command ends or the connection does; with
 * `--no-follow` the runner sends the lines Docker has and the command ends.
 * Ctrl-C stops the reading, which stops Docker's log command on the server,
 * and is not a failure. Nor is a reader that stops reading and closes its
 * end of the pipe (`zekno logs | head -1`): the reading stops the same way
 * and the command ends quietly, with status 0.
 */
export async function logs(deps: Deps, options: Options): Promise<void> {
  const tail = parseTail(options.tail)
  const plan = await prepareLogs(deps, { app: options.app, server: options.server, serverFrom: options.serverFrom })
  const stop = new AbortController()
  const interrupt = () => stop.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  const closed = deps.ui.outputClosed
  if (closed?.aborted) interrupt()
  closed?.addEventListener("abort", interrupt, { once: true })
  try {
    await followLogs(remoteThroughUi(deps), plan, { tail, follow: !options["no-follow"], stop: stop.signal }, (line) => deps.ui.logLine(line))
  } finally {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", interrupt)
    closed?.removeEventListener("abort", interrupt)
  }
}
