import {
  LIMITS,
  parseMessage,
  RunnerReportSchema,
  type RunnerReport,
} from "@workspace/core"
import type { z } from "zod"

import { CliError, RunnerRefused } from "../cli/errors"
import { sanitize } from "./sanitize"
import { writeStandardError } from "../shared/streams"

export const SSH_DESTINATION = /^[A-Za-z0-9][A-Za-z0-9._@:-]*$/
export const RUNNER_PATH = /^[A-Za-z0-9._/~-]+$/

/**
 * How to reach a runner: over SSH, or as a process on this machine. A local
 * target names only the runner's folder. The program that is started is
 * decided by the CLI itself, never read from a file.
 */
export type Target =
  | { kind: "ssh"; destination: string; runnerPath: string }
  | { kind: "local"; home: string }

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
  /**
   * Writes bytes to the runner's input and resolves once they have left, so
   * a large file is never held in memory twice. Never rejects.
   */
  send(bytes: Uint8Array): Promise<void>
  /** Closes the runner's input. A runner in a session then finishes and exits. */
  end(): void
  /** Stops the runner process, or the SSH connection, at once. */
  kill(): void
  /** The exit status, once the process has exited. */
  exited: Promise<number>
  /** Settles once all the process wrote on standard error has been passed on. */
  errorsRead: Promise<void>
}

/** The ways of reaching one runner. */
export type Transport = {
  /**
   * Runs one runner command with one message on its standard input, and
   * reads its one answer. `signal`, when given, stops the process at once
   * whenever it comes, and the call rejects without waiting for it further.
   */
  run(
    command: RunnerCommand,
    input?: string,
    signal?: AbortSignal
  ): Promise<{ exitCode: number; stdout: string }>
  /** Starts `zekno-runner session` and keeps it running. */
  open(): RunnerProcess
  /**
   * Starts `sh -s -- <words>` on the server, for the runner's installer
   * (install.ts), which sends the script's text on standard input. Only over
   * SSH; undefined for a runner on this machine.
   */
  script?(words: readonly string[]): RunnerProcess
  /**
   * How long a runner reached this way may stay silent before its first
   * answer, after which a session closes its input to see what it is. No
   * limit when undefined.
   */
  firstAnswerMs?: number
  /**
   * The SSH destination, for a runner reached over SSH: said when SSH itself
   * could not connect. Held to `SSH_DESTINATION` by `connect`.
   */
  destination?: string
}

/** The longest piece of a runner's standard error passed on as one line. */
const ERROR_LINE = 4096
/** How long passing standard error on may go on before everything else gets a turn. */
const TURN_MS = 10
/** How long to wait, once a runner has exited, for the last of its standard error. */
const ERROR_GRACE_MS = 1000

/**
 * Where a runner's standard error goes, one cleaned line at a time. What it
 * returns is not used, except a promise: nothing more is read until that
 * promise settles.
 */
export type ErrorLines = (line: string) => unknown

/** Without a callback: straight to this process's standard error, waiting while it is backed up. */
const toStandardError: ErrorLines = (line) => writeStandardError(`${line}\n`)

export type ConnectOptions = {
  /**
   * Receives what the runner, Docker or SSH write on standard error, one
   * cleaned line at a time, instead of this process's standard error. The
   * full-screen app passes one: a write to the terminal behind Ink's back
   * would draw over the screen. Single commands pass one that draws the line
   * as the server's (`Ui.remote`).
   */
  errorLines?: ErrorLines
  /**
   * SSH in batch mode: it never asks a question, and fails where it would
   * have asked for a password, a passphrase or a host key. The full-screen
   * app connects this way first (app/hand-over.ts).
   */
  batch?: boolean
}

/**
 * Passes what a runner, Docker or SSH writes on standard error on to `out`,
 * one cleaned line at a time. It comes from the server and could hold
 * anything a terminal would act on. While `out` is busy with a line, nothing
 * more is read: the pipe fills and the runner, or SSH, has to wait, so a
 * server that writes faster than the lines can be shown is slowed down
 * instead of filling this process's memory.
 */
async function passOn(
  stream: ReadableStream<Uint8Array>,
  out: ErrorLines
): Promise<void> {
  const decoder = new TextDecoder()
  const emit = async (line: string) => {
    try {
      const busy = out(sanitize(line))
      if (busy instanceof Promise) await busy
    } catch {
      // A line that could not be shown is lost. Reading goes on, or the runner would be left waiting.
    }
  }
  let rest = ""
  let turn = performance.now()
  try {
    for await (const chunk of stream) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n")
      rest = lines.pop() ?? ""
      for (const line of lines) await emit(line)
      // A line with no end in sight is passed on in pieces, never held whole.
      let start = 0
      while (rest.length - start > ERROR_LINE) {
        await emit(rest.slice(start, start + ERROR_LINE))
        start += ERROR_LINE
      }
      rest = rest.slice(start)
      // A server that writes without pause keeps this stream full, so reading it never waits:
      // everything else in this process (keys, the screen, timers, a signal) still gets its turn.
      if (performance.now() - turn >= TURN_MS) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        turn = performance.now()
      }
    }
  } catch {
    // The process went away.
  }
  rest += decoder.decode()
  if (rest !== "") await emit(rest)
}

/** Reads a stream to the end, or returns undefined once it is larger than `limit` bytes. */
async function readUpTo(
  stream: ReadableStream<Uint8Array>,
  limit: number
): Promise<string | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function spawn(
  argv: string[],
  env: Record<string, string | undefined> | undefined
) {
  try {
    return Bun.spawn(argv, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    })
  } catch {
    throw new CliError(
      `Could not start \`${argv[0]}\`. Is it installed and on your PATH?`
    )
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

async function run(
  argv: string[],
  input: string | undefined,
  env: Record<string, string | undefined> | undefined,
  out: ErrorLines,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw signal.reason
  const child = spawn(argv, env)
  const answer = answerOf(child, input, out)
  if (signal === undefined) return answer
  // The signal stops the process at once, whenever it comes, and nothing more of it is waited for: a runner
  // that never answers cannot keep a command that promised a limit waiting (specs/006-cli-small-features,
  // security review S2). What it might still send is read and thrown away by the answer below.
  let abort = () => {}
  const stopped = new Promise<never>((_, reject) => {
    abort = () => {
      quietly(() => child.kill())
      reject(signal.reason)
    }
  })
  void answer.catch(() => {})
  void stopped.catch(() => {})
  signal.addEventListener("abort", abort, { once: true })
  try {
    return await Promise.race([answer, stopped])
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

/** Hands `input` to a runner command started as `child`, and reads its answer and its exit status. */
async function answerOf(
  child: ReturnType<typeof spawn>,
  input: string | undefined,
  out: ErrorLines
) {
  const errors = passOn(child.stderr, out)
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
    throw new CliError(
      "The runner sent more than an answer can hold. Check what is installed at that path."
    )
  }
  const exitCode = await child.exited
  await Promise.race([errors, Bun.sleep(ERROR_GRACE_MS)])
  return { exitCode, stdout }
}

function open(
  argv: string[],
  env: Record<string, string | undefined> | undefined,
  out: ErrorLines
): RunnerProcess {
  const child = spawn(argv, env)
  const errorsRead = passOn(child.stderr, out)
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
    async send(bytes) {
      if (!writable) return
      try {
        child.stdin.write(bytes)
        await child.stdin.flush()
      } catch {
        // The other side closed early. What it printed, or did not, says why.
      }
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
    errorsRead,
  }
}

/** A transport that starts `argv(word)` for each runner command word. */
function transport(
  argv: (word: string) => string[],
  env: () => Record<string, string | undefined> | undefined,
  out: ErrorLines,
  firstAnswerMs?: number
): Transport {
  const command = (word: string): string[] => {
    // The type already says so; this holds even for a caller that got around it.
    if (!WORDS.includes(word))
      throw new CliError(`"${word}" is not a runner command.`)
    return argv(word)
  }
  return {
    run: async (word, input, signal) =>
      run(command(word), input, env(), out, signal),
    open: () => open(command("session"), env(), out),
    firstAnswerMs,
  }
}

/**
 * A word after `sh -s --`: install/checks.ts checks each value against its own
 * pattern first. This holds even for a caller that got around that: plain
 * characters only, nothing a shell would expand but a leading `~`, and never
 * a leading `-`.
 */
const SCRIPT_WORD = /^[A-Za-z0-9._~/][A-Za-z0-9._/~-]*$/
const SCRIPT_WORDS = 16

/** SSH's options. Each is a fixed string, placed before `--`, never built from input. */
const BATCH = ["-o", "BatchMode=yes"] as const

/** How often SSH sends its keep-alive message, in seconds. */
const KEEP_ALIVE_SECONDS = 30

/**
 * SSH's keep-alive, on every connection zekno opens (specs/015-domains-https,
 * security review, part 10, "Found by the real-server proof"). A deploy can
 * be silent for minutes: a start that waits, a health check, an image being
 * fetched. A network that closes silent connections then ends the session
 * while the runner carries on, and the person is told the connection ended
 * and never how the deploy went. With it, SSH sends a message through the
 * encrypted connection every 30 seconds, so the connection is never silent,
 * and one that is really dead ends after the unanswered messages SSH allows
 * (three by default) instead of hanging. An option on the command line wins
 * over the person's SSH settings, so an interval set there is replaced by
 * this one for zekno's connections; their other settings still apply.
 */
const KEEP_ALIVE = ["-o", `ServerAliveInterval=${KEEP_ALIVE_SECONDS}`] as const

/** `ssh -o ServerAliveInterval=30 [-o BatchMode=yes] -- <destination> <remote command>`. */
function ssh(destination: string, remote: string, batch: boolean): string[] {
  return [
    "ssh",
    ...KEEP_ALIVE,
    ...(batch ? BATCH : []),
    "--",
    destination,
    remote,
  ]
}

/**
 * Reaches a runner by running it. `localRunner` is the command that starts a
 * runner on this machine. An SSH destination and path are checked here as
 * well as when the server was added, because they are read back from a file.
 * What the runner writes on standard error goes to `options.errorLines`, or
 * to this process's standard error when there is none.
 */
export function connect(
  target: Target,
  localRunner: string[],
  options: ConnectOptions = {}
): Transport {
  const out = options.errorLines ?? toStandardError
  if (target.kind === "local") {
    return transport(
      (word) => [...localRunner, word],
      () => ({ ...process.env, ZEKNO_RUNNER_HOME: target.home }),
      out,
      LOCAL_FIRST_ANSWER_MS
    )
  }
  if (
    !SSH_DESTINATION.test(target.destination) ||
    !RUNNER_PATH.test(target.runnerPath)
  ) {
    throw new CliError(
      "The stored SSH destination or runner path is not valid."
    )
  }
  // `--` ends ssh's own options, and both values match strict patterns, so
  // neither can be read as an option or carry a shell command. The word after
  // the path is one of a fixed few, so the remote command is built from
  // nothing else.
  const batch = options.batch === true
  const runner = transport(
    (word) => ssh(target.destination, `${target.runnerPath} ${word}`, batch),
    () => undefined,
    out
  )
  return {
    ...runner,
    destination: target.destination,
    script(words) {
      if (
        words.length === 0 ||
        words.length > SCRIPT_WORDS ||
        !words.every((word) => SCRIPT_WORD.test(word))
      ) {
        throw new CliError(
          "The installer's arguments are not valid, so nothing was sent to the server."
        )
      }
      return open(
        ssh(target.destination, ["sh", "-s", "--", ...words].join(" "), batch),
        undefined,
        out
      )
    },
  }
}

/**
 * Calls the runner and reads its one JSON line. A refusal becomes an error
 * with a plain explanation; anything else must match the expected message.
 * `signal`, when given, stops the call at once (`Transport.run`).
 */
export async function ask<Schema extends z.ZodType>(
  transport: Transport,
  command: RunnerCommand,
  schema: Schema,
  message?: unknown,
  signal?: AbortSignal
): Promise<z.infer<Schema>> {
  const { stdout } = await transport.run(
    command,
    message === undefined ? undefined : JSON.stringify(message),
    signal
  )
  const line = stdout.trim().split("\n").at(-1) ?? ""
  const report = parseMessage(RunnerReportSchema, line)
  if (report.ok && report.value.outcome === "refused")
    throw new RunnerRefused(report.value.reason!)
  const parsed = parseMessage(schema, line)
  if (!parsed.ok) {
    throw new CliError(
      "The runner did not answer as expected. Check that it is installed and reachable."
    )
  }
  return parsed.value
}

export type { RunnerReport }
