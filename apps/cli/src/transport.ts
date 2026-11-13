import { LIMITS, parseMessage, RunnerReportSchema, type RunnerReport } from "@workspace/core"
import type { z } from "zod"

import { CliError, RunnerRefused } from "./errors"
import { sanitize } from "./sanitize"

export const SSH_DESTINATION = /^[A-Za-z0-9][A-Za-z0-9._@:-]*$/
export const RUNNER_PATH = /^[A-Za-z0-9._/~-]+$/

/**
 * How to reach a runner: over SSH, or as a process on this machine. A local
 * target names only the runner's folder. The program that is started is
 * decided by the CLI itself, never read from a file.
 */
export type Target = { kind: "ssh"; destination: string; runnerPath: string } | { kind: "local"; home: string }

export type RunnerCommand = "setup" | "sync" | "apply" | "status"

/** The only words ever put after the runner's path. */
const WORDS: readonly string[] = ["setup", "sync", "apply", "status", "session"]

/**
 * A runner on this machine answers its first request within milliseconds. One
 * that is still silent after this long is not reading requests line by line:
 * like a one-shot command, it waits for its input to close before it answers.
 * Over SSH there is no such limit, because connecting can take seconds and
 * SSH may be asking for a password.
 */
export const LOCAL_FIRST_ANSWER_MS = 500

/** A runner started with `session` and kept running, its input and output as streams. */
export type RunnerProcess = {
  /** What the runner writes on standard output. */
  output: ReadableStream<Uint8Array>
  /** Writes to the runner's input. Never throws: a runner that has gone shows as the end of its output. */
  write(text: string): void
  /** Closes the runner's input. A runner in a session then finishes and exits. */
  end(): void
  /** Stops the runner process, or the SSH connection, at once. */
  kill(): void
  /** The exit status, once the process has exited. */
  exited: Promise<number>
}

/** The ways of reaching one runner. */
export type Transport = {
  /** Runs one runner command with one message on its standard input, and reads its one answer. */
  run(command: RunnerCommand, input?: string): Promise<{ exitCode: number; stdout: string }>
  /** Starts `zekno-runner session` and keeps it running. */
  open(): RunnerProcess
  /**
   * How long a runner reached this way may stay silent before its first
   * answer, after which a session closes its input to see what it is. No
   * limit when undefined.
   */
  firstAnswerMs?: number
}

/** The longest piece of a runner's standard error passed on as one line. */
const ERROR_LINE = 4096
/** How long to wait, once a runner has exited, for the last of its standard error. */
const ERROR_GRACE_MS = 1000

/**
 * Passes what a runner, Docker or SSH writes on standard error on to ours, one
 * cleaned line at a time. It comes from the server and could hold anything a
 * terminal would act on.
 */
async function passOn(stream: ReadableStream<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder()
  const emit = (line: string) => void process.stderr.write(`${sanitize(line)}\n`)
  let rest = ""
  try {
    for await (const chunk of stream) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n")
      rest = lines.pop() ?? ""
      for (const line of lines) emit(line)
      // A line with no end in sight is passed on in pieces, never held whole.
      let start = 0
      while (rest.length - start > ERROR_LINE) {
        emit(rest.slice(start, start + ERROR_LINE))
        start += ERROR_LINE
      }
      rest = rest.slice(start)
    }
  } catch {
    // The process went away.
  }
  rest += decoder.decode()
  if (rest !== "") emit(rest)
}

/** Reads a stream to the end, or returns undefined once it is larger than `limit` bytes. */
async function readUpTo(stream: ReadableStream<Uint8Array>, limit: number): Promise<string | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function spawn(argv: string[], env: Record<string, string | undefined> | undefined) {
  try {
    return Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env })
  } catch {
    throw new CliError(`Could not start \`${argv[0]}\`. Is it installed and on your PATH?`)
  }
}

/** Runs any work that may fail because the other side has gone, and ignores that failure. */
function quietly(work: () => unknown): void {
  try {
    void Promise.resolve(work()).catch(() => {})
  } catch {
    // The other side closed early. Its answer, or the lack of one, says why.
  }
}

async function run(argv: string[], input: string | undefined, env: Record<string, string | undefined> | undefined) {
  const child = spawn(argv, env)
  const errors = passOn(child.stderr)
  try {
    if (input !== undefined) child.stdin.write(input)
    await child.stdin.end()
  } catch {
    // The other side closed early. Its answer, or the lack of one, says why.
  }
  // An answer is one short line. Whatever sends more than a message may hold is not a runner.
  const stdout = await readUpTo(child.stdout, LIMITS.messageBytes)
  if (stdout === undefined) {
    child.kill()
    throw new CliError("The runner sent more than an answer can hold. Check what is installed at that path.")
  }
  const exitCode = await child.exited
  await Promise.race([errors, Bun.sleep(ERROR_GRACE_MS)])
  return { exitCode, stdout }
}

function open(argv: string[], env: Record<string, string | undefined> | undefined): RunnerProcess {
  const child = spawn(argv, env)
  void passOn(child.stderr)
  let writable = true
  return {
    output: child.stdout,
    write(text) {
      if (!writable) return
      quietly(() => {
        child.stdin.write(text)
        return child.stdin.flush()
      })
    },
    end() {
      if (!writable) return
      writable = false
      quietly(() => child.stdin.end())
    },
    kill() {
      writable = false
      quietly(() => child.kill())
    },
    exited: child.exited,
  }
}

/** A transport that starts `argv(word)` for each runner command word. */
function transport(argv: (word: string) => string[], env: () => Record<string, string | undefined> | undefined, firstAnswerMs?: number): Transport {
  const command = (word: string): string[] => {
    // The type already says so; this holds even for a caller that got around it.
    if (!WORDS.includes(word)) throw new CliError(`"${word}" is not a runner command.`)
    return argv(word)
  }
  return {
    run: async (word, input) => run(command(word), input, env()),
    open: () => open(command("session"), env()),
    firstAnswerMs,
  }
}

/**
 * Reaches a runner by running it. `localRunner` is the command that starts a
 * runner on this machine. An SSH destination and path are checked here as
 * well as when the server was added, because they are read back from a file.
 */
export function connect(target: Target, localRunner: string[]): Transport {
  if (target.kind === "local") {
    return transport(
      (word) => [...localRunner, word],
      () => ({ ...process.env, ZEKNO_RUNNER_HOME: target.home }),
      LOCAL_FIRST_ANSWER_MS
    )
  }
  if (!SSH_DESTINATION.test(target.destination) || !RUNNER_PATH.test(target.runnerPath)) {
    throw new CliError("The stored SSH destination or runner path is not valid.")
  }
  // `--` ends ssh's own options, and both values match strict patterns, so
  // neither can be read as an option or carry a shell command. The word after
  // the path is one of a fixed few, so the remote command is built from
  // nothing else.
  return transport(
    (word) => ["ssh", "--", target.destination, `${target.runnerPath} ${word}`],
    () => undefined
  )
}

/**
 * Calls the runner and reads its one JSON line. A refusal becomes an error
 * with a plain explanation; anything else must match the expected message.
 */
export async function ask<Schema extends z.ZodType>(
  transport: Transport,
  command: RunnerCommand,
  schema: Schema,
  message?: unknown
): Promise<z.infer<Schema>> {
  const { stdout } = await transport.run(command, message === undefined ? undefined : JSON.stringify(message))
  const line = stdout.trim().split("\n").at(-1) ?? ""
  const report = parseMessage(RunnerReportSchema, line)
  if (report.ok && report.value.outcome === "refused") throw new RunnerRefused(report.value.reason!)
  const parsed = parseMessage(schema, line)
  if (!parsed.ok) {
    throw new CliError("The runner did not answer as expected. Check that it is installed and reachable.")
  }
  return parsed.value
}

export type { RunnerReport }
