import { remoteThroughUi, type Deps } from "../context"
import { UsageError } from "../errors"
import { followLogs, LOG_TAIL, MAX_TAIL, prepareLogs, type QuietRule } from "../ops/logs"

type Options = { app?: string; server?: string; tail?: string; "no-follow"?: boolean }

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
 * `--no-follow` it prints the lines Docker has and ends. Ctrl-C stops the
 * reading, which stops Docker's log command on the server, and is not a
 * failure.
 */
export async function logs(deps: Deps, options: Options, quiet?: QuietRule): Promise<void> {
  const tail = parseTail(options.tail)
  const plan = await prepareLogs(deps, { app: options.app, server: options.server })
  const stop = new AbortController()
  const interrupt = () => stop.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    await followLogs(remoteThroughUi(deps), plan, { tail, follow: !options["no-follow"], stop: stop.signal, quiet }, (line) => deps.ui.logLine(line))
  } finally {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", interrupt)
  }
}
