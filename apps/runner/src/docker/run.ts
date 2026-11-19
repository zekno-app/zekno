/**
 * One helper for every Docker call the routes, the proxy and the health
 * check make (specs/015-domains-https, contracts/runner.md, RN1). It runs
 * `ZEKNO_DOCKER || "docker"` with the environment the existing calls use and
 * nothing else of the runner's, in the runner's own folder, with a time
 * limit, and gives back the exit status and both outputs, each capped. The
 * error text matters: a port the proxy cannot take is told on standard error
 * only (research R9, R24).
 *
 * No shell is involved: the arguments are passed as a list, so no domain,
 * name or path can be read as more than the one argument it is.
 */
import { dockerCommand, dockerEnv } from "./compose"
import { stopChild } from "./inspect"

export type DockerResult = {
  /** Docker's exit status; `NOT_STARTED` or `TIMED_OUT` when it did not run to its end. */
  code: number
  stdout: string
  stderr: string
}

/** The status given when Docker could not be started at all, as a shell gives it. */
export const NOT_STARTED = 127
/** The status given when Docker did not finish in its time, as `timeout` gives it. */
export const TIMED_OUT = 124

/** How long a call may take when its caller says nothing. */
const CALL_MS = 60_000
/** The most of each output kept. What comes after is read and dropped, so Docker is never held up writing it. */
const OUTPUT_BYTES = 1024 * 1024
/**
 * How long the outputs may stay open once Docker has exited. They close with
 * it; a process it left behind could keep them open, and is not waited for.
 */
const OUTPUT_GRACE_MS = 1000

/** Reads a stream to its end, keeping at most `limit` bytes of it. */
async function capped(
  stream: ReadableStream<Uint8Array>,
  limit: number
): Promise<string> {
  const chunks: Uint8Array[] = []
  let kept = 0
  try {
    for await (const chunk of stream) {
      if (kept >= limit) continue
      const part = chunk.subarray(0, limit - kept)
      chunks.push(part)
      kept += part.length
    }
  } catch {
    // The stream broke off: what was read is all there is.
  }
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * Runs one Docker command in `dir` and gives its status and outputs. Never
 * throws: a Docker that cannot be started gives `NOT_STARTED`, one that takes
 * longer than `timeoutMs` is stopped and gives `TIMED_OUT`.
 */
export async function runDocker(
  dir: string,
  args: readonly string[],
  options: { timeoutMs?: number; outputBytes?: number } = {}
): Promise<DockerResult> {
  const limit = options.outputBytes ?? OUTPUT_BYTES
  let child
  try {
    // Started in the runner's private folder: Docker Compose reads files from
    // where it runs, and wherever the runner was started is not the runner's to trust.
    child = Bun.spawn([dockerCommand(), ...args], {
      cwd: dir,
      env: dockerEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch {
    return { code: NOT_STARTED, stdout: "", stderr: "" }
  }
  const outputs = Promise.all([
    capped(child.stdout, limit),
    capped(child.stderr, limit),
  ])
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), options.timeoutMs ?? CALL_MS)
  })
  const first = await Promise.race([child.exited, late])
  clearTimeout(timer)
  if (first === "late") {
    await stopChild(child)
    return { code: TIMED_OUT, stdout: "", stderr: "" }
  }
  const read = await Promise.race([
    outputs,
    Bun.sleep(OUTPUT_GRACE_MS).then(() => undefined),
  ])
  return { code: first, stdout: read?.[0] ?? "", stderr: read?.[1] ?? "" }
}
