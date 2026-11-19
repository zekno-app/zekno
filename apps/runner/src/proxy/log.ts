/**
 * Reading the proxy's log (specs/015-domains-https, contracts/runner.md,
 * RN6 and RN8). Caddy writes one JSON object a line on standard error; with
 * its admin interface off, the log is where it says that it started and
 * whether a signal loaded the file (research R4, Q10).
 *
 * The time a read starts from is the runner's clock less a second, so that a
 * Docker whose clock runs a little behind still gives the line; the lines of
 * that kind already there are counted before the proxy is asked anything,
 * and only a line past them is taken as the answer.
 */
import { runDocker } from "../docker/run"

/** The proxy's container. */
export const PROXY = "zekno-proxy"

/** How far before now a read starts, for a Docker whose clock differs a little from the runner's. */
const CLOCK_MS = 1000
/** How often the log is read again while waiting. */
const POLL_MS = 200

/** One line of Caddy's log, as its fields. */
export type LogLine = Record<string, unknown>

/** The time to read from, noted before the proxy is asked anything. */
export const noteTime = (): number => Date.now() - CLOCK_MS

/** The lines of the proxy's log since `since` (milliseconds), or undefined when Docker did not answer. */
async function linesSince(
  dir: string,
  since: number
): Promise<LogLine[] | undefined> {
  const result = await runDocker(dir, [
    "logs",
    "--since",
    (since / 1000).toFixed(3),
    PROXY,
  ])
  if (result.code !== 0) return undefined
  const lines: LogLine[] = []
  // Caddy's lines are on standard error; standard output is read too, in case a log driver merges them.
  for (const text of `${result.stderr}\n${result.stdout}`.split("\n")) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === "object" && parsed !== null)
        lines.push(parsed as LogLine)
    } catch {
      // Not a line of Caddy's.
    }
  }
  return lines
}

/** What `pick` gives for each line since `since` that it gives anything for. */
async function picked<T>(
  dir: string,
  since: number,
  pick: (line: LogLine) => T | undefined
): Promise<T[] | undefined> {
  const lines = await linesSince(dir, since)
  return lines?.map(pick).filter((value): value is T => value !== undefined)
}

/** How many lines since `since` `pick` gives something for: the ones to skip once the proxy is asked. */
export async function countLines<T>(
  dir: string,
  since: number,
  pick: (line: LogLine) => T | undefined
): Promise<number | undefined> {
  return (await picked(dir, since, pick))?.length
}

/**
 * What `pick` gives for the first line since `since` past the first `skip`
 * such lines, read again every 200 milliseconds for at most `timeoutMs`; or
 * undefined when no such line came in that time.
 */
export async function waitForLine<T>(
  dir: string,
  since: number,
  pick: (line: LogLine) => T | undefined,
  skip: number,
  timeoutMs: number
): Promise<T | undefined> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const found = await picked(dir, since, pick)
    if (found && found.length > skip) return found[skip]
    if (Date.now() >= until) return undefined
    await Bun.sleep(POLL_MS)
  }
}

/** The line that says Caddy serves the file it started on (RN6). */
export const serving = (line: LogLine): true | undefined =>
  line.msg === "serving initial configuration" ? true : undefined

/** The line that answers a SIGUSR1: the file loaded, or not (RN8, step 5). */
export const reloaded = (line: LogLine): "ok" | "failed" | undefined =>
  line.signal !== "SIGUSR1"
    ? undefined
    : line.msg === "successfully reloaded config from file"
      ? "ok"
      : line.msg === "failed to reload config from file"
        ? "failed"
        : undefined
