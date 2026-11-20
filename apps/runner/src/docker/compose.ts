import { isReservedSecretName } from "@workspace/core"

import { stopChild } from "./inspect"
import { OUTPUT_GRACE_MS } from "./run"

/** What the Docker command itself needs from the runner's environment. */
const PASSED_THROUGH = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "XDG_RUNTIME_DIR",
]

/** The longest progress line a session frame may carry. */
const PROGRESS_LINE = 4096

/** What Docker needs from the runner's environment, and nothing else of it. */
export function dockerEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of PASSED_THROUGH) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

export const dockerCommand = (): string => process.env.ZEKNO_DOCKER || "docker"

/**
 * How long reading may go on before everything else gets a turn. A process
 * that prints without pause keeps its output full, so reading it never has
 * to wait, and without a turn the runner would never notice that its input
 * closed or that nobody reads its frames any more.
 */
const TURN_MS = 10

/** Lets everything else that is waiting run first: input, timers, signals. */
export const nextTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

/**
 * Calls `onLine` for each line of a stream, cut to `limit` characters, and
 * waits for it when it returns a promise, so a slow reader slows the writer
 * instead of filling memory. Only a line feed ends a line: a carriage return
 * is part of the text, and empty lines are skipped.
 */
export async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void | Promise<void>,
  limit: number
): Promise<void> {
  const decoder = new TextDecoder()
  let rest = ""
  const emit = async (line: string) => {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line
    if (text.trim() !== "") await onLine(text.slice(0, limit))
  }
  let turn = performance.now()
  for await (const chunk of stream) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n")
    rest = parts.pop() ?? ""
    // A line with no end in sight is cut, not kept growing.
    if (rest.length > limit * 4) rest = rest.slice(0, limit)
    for (const line of parts) await emit(line)
    if (performance.now() - turn >= TURN_MS) {
      await nextTurn()
      turn = performance.now()
    }
  }
  await emit(rest + decoder.decode())
}

/**
 * How long `docker compose up` may run before the runner stops waiting for it
 * (specs/015-domains-https, security review, lead A10). An `up` that never
 * returns, such as one waiting on a container that never exits, would hold
 * the deploy lock for ever.
 */
export const START_LIMIT_MS = 30 * 60 * 1000

/**
 * How `up` ended: with Docker's exit status (127 when Docker could not be
 * started at all), or stopped once it had run for `stoppedAfterMs`, its limit.
 */
export type UpEnded = { exit: number } | { stoppedAfterMs: number }

/**
 * Waits for Docker's outputs to end (`outputs`), then for its exit, for
 * `limitMs` at most. Past that Docker is stopped (`stopChild`), and its
 * outputs get `OUTPUT_GRACE_MS` more to close, never longer: a process it
 * left behind could keep them open.
 */
async function withinLimit(
  child: Bun.Subprocess,
  outputs: Promise<unknown>,
  limitMs: number
): Promise<UpEnded> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), limitMs)
  })
  const first = await Promise.race([outputs.then(() => child.exited), late])
  clearTimeout(timer)
  if (first !== "late") return { exit: first }
  await stopChild(child)
  await Promise.race([outputs.catch(() => {}), Bun.sleep(OUTPUT_GRACE_MS)])
  return { stoppedAfterMs: limitMs }
}

/**
 * Starts an app with Docker Compose. The secrets exist only in the
 * environment of the Docker process: Compose reads them from there, and they
 * are never written to disk by the runner. Gives Docker's exit status, or,
 * when `up` is still running once `limitMs` has passed, stops it and says so;
 * whatever Docker made by then is left as it is. Never throws, and gives no
 * line to `onLine` once it has returned.
 */
export async function composeUp(
  input: {
    /**
     * The runner's own folder, where Docker runs: Compose reads files from the
     * folder it runs in, and wherever the runner was started is not the
     * runner's to trust (research R14).
     */
    dir: string
    app: string
    file: string
    secrets: Record<string, string>
    /** Given each line Docker prints. Without it, Docker's output goes to standard error. */
    onLine?: (line: string) => void
  },
  limitMs = START_LIMIT_MS
): Promise<UpEnded> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.secrets)) {
    // A reserved name would change how Docker runs, so it never reaches Docker's environment.
    if (!isReservedSecretName(name)) env[name] = value
  }
  // The runner's own values win over any secret of the same name.
  Object.assign(env, dockerEnv())

  const argv = [
    dockerCommand(),
    "compose",
    "-p",
    `zekno-${input.app}`,
    "-f",
    input.file,
    "up",
    "-d",
    "--remove-orphans",
  ]
  try {
    const { onLine } = input
    if (onLine) {
      let returned = false
      // Reporting a line must never stop the deploy: it carries on when nobody is reading.
      const report = (line: string) => {
        // A line read after the answer is not this request's any more.
        if (returned) return
        try {
          onLine(line)
        } catch {
          // Lost, like any line nobody reads.
        }
      }
      const child = Bun.spawn(argv, {
        cwd: input.dir,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      // Docker's exit status decides the outcome, even if its output could not be read.
      const outputs = Promise.all([
        readLines(child.stdout, report, PROGRESS_LINE),
        readLines(child.stderr, report, PROGRESS_LINE),
      ]).catch(() => {})
      try {
        return await withinLimit(child, outputs, limitMs)
      } finally {
        returned = true
      }
    }
    // Standard output is reserved for the runner's one JSON line.
    const child = Bun.spawn(argv, {
      cwd: input.dir,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    })
    const chunks: Uint8Array[] = []
    const reading = (async () => {
      for await (const chunk of child.stdout) chunks.push(chunk)
    })()
    const ended = await withinLimit(child, reading, limitMs)
    // What Docker printed, written once and as a whole, as it always was: up to the stop, when it was stopped.
    const output = new TextDecoder().decode(Buffer.concat(chunks))
    if (output) process.stderr.write(output)
    return ended
  } catch {
    // Docker is not installed, or could not be started at all.
    return { exit: 127 }
  }
}
