/**
 * A session: several requests over one connection. It is a way of carrying
 * requests, not a second way in: every request runs the same code, takes the
 * same lock and passes the same checks as its one-shot command. `deploy`,
 * `records` and `proxy` have no one-shot command: they exist only here
 * (contracts/protocol.md, P2; specs/015-domains-https, contracts/runner.md,
 * RN13). Nor does `status` with routes: the one-shot `status` reads no input.
 */
import {
  LIMITS,
  parseMessage,
  RUNNER_PROTOCOL,
  SessionRequestSchema,
  type RunnerVersion,
  type SessionFrame,
  type SessionRequest,
} from "@workspace/core"

import { version as runnerVersion } from "../../package.json"
import { apply, refused, setup, status, sync } from "../commands/commands"
import { deploy } from "../commands/deploy"
import { proxy, statusWithRoutes } from "../commands/proxy"
import { records } from "../commands/records"
import { appStates, followLogs } from "../docker/inspect"

export const version = (): RunnerVersion => ({
  version: runnerVersion,
  protocol: RUNNER_PROTOCOL,
})

/** Lines that are not requests, in a row, before the runner gives up on the session. */
const MAX_BAD_LINES = 3

/** Bytes of requests received but not yet handled. A client further ahead than this ends the session. */
const QUEUE_BYTES = LIMITS.messageBytes
/**
 * What each waiting line counts for on top of its own bytes. Without it an
 * empty line would cost nothing, although holding it costs memory.
 */
const LINE_COST = 1024
/** Lines received but not yet handled. A client further ahead than this ends the session. */
const QUEUE_LINES = 1024

/**
 * Bytes of frames written but not yet taken by the reader, past which a
 * frame that does not wait for the reader (Docker's progress during a deploy)
 * is dropped. Bun holds what standard output cannot take yet, with no limit
 * of its own. Results are never dropped: after each one the session waits
 * until it has left.
 */
const UNSENT_BYTES = 8 * 1024 * 1024

/** Where the frames of a session go. */
export type FrameSink = {
  /** Writes one frame. Never throws: work in progress carries on when nobody reads any more. */
  write: (frame: SessionFrame) => void
  /** Resolves once everything written so far has left, or once nobody reads any more. */
  drained: () => Promise<void>
  /** Signalled once nobody reads any more: a write failed, or the reader closed its end. */
  gone: AbortSignal
}

/**
 * Frames on standard output, one line each. Once the reader has gone, frames
 * are dropped quietly: a deploy in progress still finishes.
 */
export function stdoutSink(): FrameSink {
  const waiting: (() => void)[] = []
  const gone = new AbortController()
  let backedUp = false
  /** Bytes handed to standard output since it last took everything. */
  let unsent = 0
  const release = () => {
    backedUp = false
    unsent = 0
    for (const resolve of waiting.splice(0)) resolve()
  }
  const lost = () => {
    gone.abort()
    release()
  }
  process.stdout.on("drain", release)
  // Without this, a write to a closed connection would end the process in the middle of a deploy.
  // Bun reports a reader that went away (EPIPE) here, and from then on takes every write without a word.
  process.stdout.on("error", lost)
  return {
    write(frame) {
      if (gone.signal.aborted) return
      const line = `${JSON.stringify(frame)}\n`
      if (
        backedUp &&
        !("result" in frame) &&
        unsent + Buffer.byteLength(line) > UNSENT_BYTES
      )
        return
      try {
        if (!process.stdout.write(line)) backedUp = true
        if (backedUp) unsent += Buffer.byteLength(line)
      } catch {
        lost()
      }
    },
    drained: () =>
      backedUp && !gone.signal.aborted
        ? new Promise<void>((resolve) => waiting.push(resolve))
        : Promise.resolve(),
    gone: gone.signal,
  }
}

/**
 * Splits a byte stream into lines. A line longer than `limit` bytes is let go
 * of as it arrives, never held whole, and given as `null` so it can be refused.
 */
export async function* requestLines(
  stream: ReadableStream<Uint8Array>,
  limit: number
): AsyncGenerator<Uint8Array | null> {
  let held: Uint8Array[] = []
  let size = 0
  const take = (): Uint8Array | null => {
    const line = size > limit ? null : Buffer.concat(held)
    held = []
    size = 0
    return line
  }
  for await (const chunk of stream) {
    let start = 0
    for (;;) {
      const end = chunk.indexOf(0x0a, start)
      const piece = chunk.subarray(start, end === -1 ? chunk.length : end)
      size += piece.length
      if (size > limit) held = []
      else if (piece.length > 0) held.push(piece.slice())
      if (end === -1) break
      yield take()
      start = end + 1
    }
  }
  if (size > 0) yield take()
}

const whenAborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener("abort", () => resolve(), { once: true })
  })

/** What a waiting line counts for against `QUEUE_BYTES`. */
const cost = (line: Uint8Array | null) => (line?.length ?? 0) + LINE_COST

/** Runs one request through the code of its one-shot command and returns its answer. */
async function handle(
  dir: string,
  request: SessionRequest,
  sink: FrameSink,
  closed: AbortSignal
): Promise<unknown> {
  const { command, input } = request
  let text: string
  try {
    // The one-shot commands read their request as text and check it themselves.
    text = input === undefined ? "" : JSON.stringify(input)
  } catch {
    // Input nested too deeply to be written out again is not a request either.
    return refused("invalid_request")
  }
  try {
    switch (command) {
      case "version":
        return version()
      case "status":
        // With an input, only `{ "routes": true }`, and the answer has the routes in force.
        return text === "" ? status(dir) : await statusWithRoutes(dir, text)
      case "setup":
        return setup(dir, text)
      case "sync":
        return await sync(dir, text)
      case "apply":
        // Docker's own output, line by line. The deploy does not wait for anyone to read it.
        return await apply(dir, text, (line) =>
          sink.write({ event: "progress", line })
        )
      case "deploy":
        // A deploy of version 2: Docker's lines as `apply` sends them, and
        // each service whose health the deploy waits for as the wait begins.
        return await deploy(
          dir,
          text,
          (line) => sink.write({ event: "progress", line }),
          (service) => sink.write({ event: "health", service })
        )
      case "records":
        return records(dir, text)
      case "proxy":
        return await proxy(dir, text)
      case "state":
        return await appStates(dir, closed)
      case "logs": {
        const gone = whenAborted(closed)
        // A slow reader slows Docker's log command down, until the reader goes away.
        return await followLogs(
          dir,
          text,
          (event) => {
            sink.write(event)
            return Promise.race([sink.drained(), gone])
          },
          closed
        )
      }
    }
  } catch {
    // Details stay out of the answer: they could describe the server's files.
    return refused("invalid_state")
  }
}

/**
 * Reads requests from `input`, one per line, and writes frames to `sink`.
 * Requests are handled one at a time, in order, each answered by its events
 * and then one result. Returns the exit status: 0 when the input closed, 1
 * when the session was ended because lines were not requests, or because the
 * client sent far more than it waited answers for.
 *
 * When the input closes, the request in progress is finished (`apply`) or
 * stopped (`logs`, and Docker's answer for `state`), the requests received
 * before the close are answered, and the session ends.
 *
 * A client that gets more than `QUEUE_LINES` lines or `QUEUE_BYTES` bytes
 * ahead is not waiting for its answers. Its session ends as if the input had
 * closed, except that the requests still waiting are dropped, not run.
 *
 * A reader that has gone (`sink.gone`) is a client that has gone: the session
 * ends at once, as if the input had closed, and the requests still waiting
 * are dropped too, since nobody could read their answers.
 */
export async function runSession(
  dir: string,
  input: ReadableStream<Uint8Array>,
  sink: FrameSink
): Promise<number> {
  const queue: (Uint8Array | null)[] = []
  let queued = 0
  let overrun = false
  let readerGone = false
  let wake: (() => void) | undefined
  const closed = new AbortController()
  const inputClosed = whenAborted(closed.signal)
  const nudge = () => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }
  const leave = () => {
    readerGone = true
    queue.length = 0
    queued = 0
    closed.abort()
    nudge()
  }
  if (sink.gone.aborted) leave()
  else sink.gone.addEventListener("abort", leave, { once: true })

  // Reading goes on while a request is handled, so that a closed input is
  // noticed during a long request such as `logs`.
  void (async () => {
    try {
      for await (const line of requestLines(input, LIMITS.messageBytes)) {
        // Holding lines back would also stop the reading, and with it the
        // noticing of a closed input. A client this far ahead ends its session.
        if (
          queue.length >= QUEUE_LINES ||
          (queue.length > 0 && queued + cost(line) > QUEUE_BYTES)
        ) {
          overrun = true
          queue.length = 0
          queued = 0
          break
        }
        if (readerGone) break
        queue.push(line)
        queued += cost(line)
        nudge()
      }
    } catch {
      // The other side went away.
    }
    closed.abort()
    nudge()
  })()

  /** The next line, or undefined once the input has closed and every line was taken, or the session was ended. */
  const next = async (): Promise<Uint8Array | null | undefined> => {
    for (;;) {
      if (overrun || readerGone) return undefined
      if (queue.length > 0) {
        const line = queue.shift()!
        queued -= cost(line)
        return line
      }
      if (closed.signal.aborted) return undefined
      await new Promise<void>((resolve) => (wake = resolve))
    }
  }

  /**
   * Waits until the reader has taken the frames written so far, has gone, or
   * the input has closed, so that a client that does not read cannot make the
   * runner hold its answers. No lock is held here.
   */
  const delivered = () => Promise.race([sink.drained(), inputClosed])

  let bad = 0
  for (;;) {
    const line = await next()
    if (line === undefined) return overrun ? 1 : 0
    const request =
      line === null ? undefined : parseMessage(SessionRequestSchema, line)
    if (!request?.ok) {
      sink.write({ result: refused("invalid_request") })
      if (++bad >= MAX_BAD_LINES) return 1
      await delivered()
      continue
    }
    bad = 0
    sink.write({
      result: await handle(dir, request.value, sink, closed.signal),
    })
    await delivered()
  }
}
