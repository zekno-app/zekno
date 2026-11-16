/**
 * The CLI's side of a runner session (contracts/session.md): one runner
 * process, or one SSH connection, carries every request of one operation.
 *
 * A session is only a way of carrying requests. Every answer is checked
 * exactly as a one-shot answer is: each line must be a frame of the contract,
 * each result must match the message the caller expects, a refusal becomes
 * `RunnerRefused`, and the caller still checks which server answered and what
 * it says it did. Text in events comes from the server and is cleaned before
 * anyone sees it.
 *
 * A runner from before sessions (feature 003) exits with status 2 when asked
 * for one; something that answers in some other way does not speak sessions
 * either. Both are reached with the one-shot commands instead, and the
 * session says so in `mode`.
 */
import {
  parseMessage,
  RunnerReportSchema,
  RunnerVersionSchema,
  SESSION_FRAME_BYTES,
  SessionFrameSchema,
  type RunnerVersion,
  type SessionCommand,
  type SessionEvent,
} from "@workspace/core"
import type { z } from "zod"

import { CliError, RunnerRefused } from "../cli/errors"
import { sanitize } from "./sanitize"
import { ask, type RunnerProcess, type Transport } from "./transport"

/** `session`: one runner process carries every request. `one-shot`: one process per request, for an older runner. */
export type SessionMode = "session" | "one-shot"

export type RequestOptions = {
  /** The command's own request message. */
  input?: unknown
  /**
   * Each event of this request, its text already cleaned for the terminal.
   * What it returns is not used, except a promise: while that is pending,
   * nothing more is read, so the runner, and Docker behind it, are slowed
   * down instead of this process holding what it cannot show yet.
   */
  onEvent?: (event: SessionEvent) => unknown
}

export type Session = {
  readonly mode: SessionMode
  /** The runner's version and protocol. Undefined for a runner that does not speak sessions. */
  readonly runner: RunnerVersion | undefined
  /**
   * Sends one request and resolves with its result, checked against
   * `schema`. The request has been handed to the runner by the time this
   * returns. A refusal rejects with `RunnerRefused` and the session goes on;
   * any other failure ends the session.
   */
  request<Schema extends z.ZodType>(
    command: SessionCommand,
    schema: Schema,
    options?: RequestOptions
  ): Promise<z.infer<Schema>>
  /**
   * Closes the runner's input and waits for it to exit, for `graceMs` at
   * most (5 seconds unless given), then stops it. Returns its exit status, if
   * there was a process. Closing again waits for the same exit.
   */
  close(graceMs?: number): Promise<number | undefined>
}

export const UNEXPECTED =
  "The runner did not answer as expected. Check that it is installed and reachable."
export const TOO_LARGE =
  "The runner sent more than an answer can hold. Check what is installed at that path."
export const ENDED = "The connection to the runner ended before it answered."
export const TOO_OLD =
  "The runner on that server is too old for this. State and logs need a runner update."

/**
 * Said when SSH itself could not connect, as on the board "Status, lists,
 * errors and piped output": `name` is the server's name where it is known,
 * and the command to check with names its destination.
 */
export const sshUnreachable = (name: string, destination: string): string =>
  `${name} could not be reached over SSH. Check with: \`ssh ${destination} true\``

/**
 * SSH ended with its own status, 255, before the runner said anything: it
 * could not connect or log in. The runner never exits with 255. Whoever
 * knows the server's name says it with `sshUnreachable`.
 */
export class SshUnreachable extends CliError {
  constructor(readonly destination: string) {
    super(sshUnreachable(destination, destination))
  }
}

/** The same failure, named by its server: `prod could not be reached over SSH.` Anything else is passed on as it is. */
export function namedUnreachable(error: unknown, server: string): unknown {
  return error instanceof SshUnreachable
    ? new CliError(sshUnreachable(server, error.destination))
    : error
}

/** The one kind of event each request may send before its result. */
const EVENTS: Partial<Record<SessionCommand, SessionEvent["event"]>> = {
  apply: "progress",
  logs: "log",
}

/** How long a runner has to exit once its session is closed, before it is stopped. */
const CLOSE_GRACE_MS = 5000

/**
 * How long reading a runner's events may go on before everything else gets
 * a turn: keys, the screen, timers, a signal. A runner that sends events as
 * fast as it can keeps its output full, so reading never has to wait, and
 * without a turn nothing else in this process would ever run.
 */
const TURN_MS = 10

/** Lets everything else that is waiting run first. */
const nextTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

type Line =
  { kind: "line"; bytes: Uint8Array } | { kind: "too_long" } | { kind: "end" }

/**
 * Splits a stream into lines and never holds more than `limit` bytes of one:
 * a line that grows past it is reported at once, before its end arrives.
 * Each line may have a limit of its own, the longest its request can bring
 * (`SESSION_FRAME_BYTES`). A last line without a line feed still counts.
 */
function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let held: Uint8Array[] = []
  let size = 0
  let pending: Uint8Array | undefined
  let done = false

  const take = (): Line => {
    const bytes = Buffer.concat(held)
    held = []
    size = 0
    return { kind: "line", bytes }
  }

  async function next(limit: number): Promise<Line> {
    for (;;) {
      if (pending) {
        const end = pending.indexOf(0x0a)
        const piece = end === -1 ? pending : pending.subarray(0, end)
        pending =
          end === -1 || end + 1 === pending.length
            ? undefined
            : pending.subarray(end + 1)
        size += piece.length
        if (size > limit) {
          held = []
          size = 0
          pending = undefined
          return { kind: "too_long" }
        }
        held.push(piece.slice())
        if (end !== -1) return take()
        continue
      }
      if (done) return size > 0 ? take() : { kind: "end" }
      try {
        const chunk = await reader.read()
        if (chunk.done) done = true
        else pending = chunk.value
      } catch {
        done = true
      }
    }
  }

  return {
    next,
    /**
     * Stops reading. Nothing already received is handed out any more, and the
     * runner's further writes fail, which it takes as nobody reading any more.
     */
    cancel() {
      done = true
      pending = undefined
      held = []
      size = 0
      void reader.cancel().catch(() => {})
    },
  }
}
type LineReader = ReturnType<typeof lineReader>

const LATE = Symbol("late")

/** Resolves with what `promise` gives, or with `LATE` after `ms` milliseconds. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<typeof LATE>(
    (resolve) => (timer = setTimeout(() => resolve(LATE), ms))
  )
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

type Started =
  | {
      kind: "session"
      child: RunnerProcess
      lines: LineReader
      runner: RunnerVersion
      late: boolean
    }
  | { kind: "one-shot" }

/** Stops a runner process and its output at once. */
function stop(child: RunnerProcess, lines: LineReader): void {
  child.end()
  lines.cancel()
  child.kill()
}

/**
 * Starts `zekno-runner session` and asks for its version, which tells
 * whether it speaks sessions at all. Only the version is asked before that
 * is known, so a runner that does not speak sessions has been asked nothing
 * that changes anything. `signal` stops the process at once, whenever it
 * comes: while SSH connects or asks, or while the runner has not answered.
 */
async function start(
  transport: Transport,
  patience: number | undefined,
  signal: AbortSignal | undefined
): Promise<Started> {
  if (signal?.aborted) throw new CliError(ENDED)
  const child = transport.open()
  const lines = lineReader(child.output)
  const abort = () => stop(child, lines)
  signal?.addEventListener("abort", abort, { once: true })
  try {
    child.write(`${JSON.stringify({ command: "version" })}\n`)
    const first = lines.next(SESSION_FRAME_BYTES.version)
    let late = false
    if (patience !== undefined && (await within(first, patience)) === LATE) {
      // A runner that waits for its input to close is not reading requests one
      // by one. Closing its input makes it answer, and the answer shows what it is.
      late = true
      child.end()
    }
    const line = await first
    if (signal?.aborted) throw new CliError(ENDED)
    if (line.kind === "too_long") {
      stop(child, lines)
      throw new CliError(TOO_LARGE)
    }
    if (line.kind === "end") {
      // Status 2 is a runner from before sessions saying `session` is not one of its commands.
      const code = await within(child.exited, CLOSE_GRACE_MS)
      if (code === 2) return { kind: "one-shot" }
      stop(child, lines)
      if (code === 255 && transport.destination !== undefined)
        throw new SshUnreachable(transport.destination)
      throw new CliError(UNEXPECTED)
    }
    const frame = parseMessage(SessionFrameSchema, line.bytes)
    if (!frame.ok) {
      // Not a frame at all: whatever answered does not speak sessions.
      stop(child, lines)
      return { kind: "one-shot" }
    }
    const version =
      "result" in frame.value
        ? parseMessage(RunnerVersionSchema, frame.value.result)
        : undefined
    if (!version?.ok) {
      stop(child, lines)
      throw new CliError(UNEXPECTED)
    }
    // Its input is already closed, so this process can carry nothing more.
    if (late) stop(child, lines)
    return { kind: "session", child, lines, runner: version.value, late }
  } finally {
    // A session that goes on listens for the signal itself (`live`).
    signal?.removeEventListener("abort", abort)
  }
}

/** Removes terminal control sequences from the text of an event. Service names and times are held to patterns already. */
function clean(event: SessionEvent): SessionEvent {
  if (event.event === "progress")
    return { event: "progress", line: sanitize(event.line) }
  return {
    event: "log",
    service: sanitize(event.service),
    time: event.time,
    line: sanitize(event.line),
  }
}

/** A session over one runner process. `signal` stops it at once, as `stop` does. */
function live(
  started: Extract<Started, { kind: "session" }>,
  signal: AbortSignal | undefined
): Session {
  const { child, lines } = started
  let busy = false
  let ended = false
  let closing = false
  let exit: Promise<number | undefined> | undefined

  const end = () => {
    ended = true
    stop(child, lines)
  }
  if (signal?.aborted) end()
  else signal?.addEventListener("abort", end, { once: true })

  async function answer<Schema extends z.ZodType>(
    command: SessionCommand,
    schema: Schema,
    onEvent?: RequestOptions["onEvent"]
  ) {
    // Each line is read up to the longest frame this request can bring, and no further.
    const limit = SESSION_FRAME_BYTES[command]
    let turn = performance.now()
    try {
      for (;;) {
        const line = await lines.next(limit)
        if (line.kind === "end") throw new CliError(ENDED)
        if (line.kind === "too_long") throw new CliError(TOO_LARGE)
        const frame = parseMessage(SessionFrameSchema, line.bytes)
        if (!frame.ok) throw new CliError(UNEXPECTED)
        const value = frame.value
        if ("event" in value) {
          if (EVENTS[command] !== value.event) throw new CliError(UNEXPECTED)
          const busy = onEvent?.(clean(value))
          if (busy instanceof Promise) await busy
          // Events can arrive faster than they are read. Keys, the screen, timers and signals still get their turn.
          if (performance.now() - turn >= TURN_MS) {
            await nextTurn()
            turn = performance.now()
          }
          continue
        }
        const report = parseMessage(RunnerReportSchema, value.result)
        if (report.ok && report.value.outcome === "refused")
          throw new RunnerRefused(report.value.reason!)
        const parsed = parseMessage(schema, value.result)
        if (!parsed.ok) throw new CliError(UNEXPECTED)
        return parsed.value as z.infer<Schema>
      }
    } catch (error) {
      // A refusal is an answer, and the session goes on. After anything else
      // the runner's next line cannot be trusted to belong to the next request.
      // A session being closed is left to `close`, which lets the runner stop
      // what it is doing (such as following logs) before it is stopped itself.
      if (!(error instanceof RunnerRefused) && !closing) end()
      throw error
    }
  }

  return {
    mode: "session",
    runner: started.runner,
    request(command, schema, options = {}) {
      if (ended) return Promise.reject(new CliError(ENDED))
      if (busy)
        return Promise.reject(
          new Error("A session carries one request at a time.")
        )
      busy = true
      const request =
        options.input === undefined
          ? { command }
          : { command, input: options.input }
      child.write(`${JSON.stringify(request)}\n`)
      return answer(command, schema, options.onEvent).finally(
        () => (busy = false)
      )
    },
    close(graceMs = CLOSE_GRACE_MS) {
      exit ??= (async () => {
        closing = true
        ended = true
        child.end()
        lines.cancel()
        const code = await within(child.exited, graceMs)
        if (code !== LATE) return code
        child.kill()
        return child.exited
      })()
      return exit
    },
  }
}

/**
 * The one-shot commands of a runner from before sessions, one process each.
 * `signal` stops a request's process at once, as it stops a session: a
 * runner that answered as one from before sessions and then never answers
 * keeps nobody who gave a limit waiting (security review S2). Without a
 * signal, a request waits for its process as it always has.
 */
function oneShot(
  transport: Transport,
  signal: AbortSignal | undefined
): Session {
  return {
    mode: "one-shot",
    runner: undefined,
    request(command, schema, options = {}) {
      if (
        command === "setup" ||
        command === "sync" ||
        command === "apply" ||
        command === "status"
      ) {
        if (signal === undefined)
          return ask(transport, command, schema, options.input)
        if (signal.aborted) return Promise.reject(new CliError(ENDED))
        return ask(transport, command, schema, options.input, signal).catch(
          (error: unknown) => {
            throw signal.aborted ? new CliError(ENDED) : error
          }
        )
      }
      return Promise.reject(new CliError(TOO_OLD))
    },
    close: async () => undefined,
  }
}

export type OpenOptions = {
  /**
   * Stops the session at once, whenever it is signalled: while SSH connects
   * or asks, before the runner has answered, or later. The runner process,
   * or SSH, is stopped outright, and a request in progress rejects. Opening
   * rejects too; whoever signalled knows why. A runner from before sessions
   * has nothing kept open to stop; a request it is carrying stops at once,
   * its process stopped outright.
   */
  signal?: AbortSignal
}

/**
 * Opens a session with the runner `transport` reaches. Resolves once the
 * runner has said which version it is, or once it is known that it does not
 * speak sessions.
 */
export async function openSession(
  transport: Transport,
  options: OpenOptions = {}
): Promise<Session> {
  const { signal } = options
  let started = await start(transport, transport.firstAnswerMs, signal)
  // It speaks sessions but was slow to start, and its input is already
  // closed. It is started once more, this time given as long as it needs.
  if (started.kind === "session" && started.late)
    started = await start(transport, undefined, signal)
  if (started.kind === "session") return live(started, signal)
  if (signal?.aborted) throw new CliError(ENDED)
  return oneShot(transport, signal)
}

/** Runs `work` with one session and closes it afterwards, however the work ends. */
export async function withSession<T>(
  transport: Transport,
  work: (session: Session) => Promise<T>,
  options: OpenOptions = {}
): Promise<T> {
  const session = await openSession(transport, options)
  try {
    return await work(session)
  } finally {
    await session.close()
  }
}
