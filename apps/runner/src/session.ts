/**
 * A session: several requests over one connection. It is a way of carrying
 * requests, not a second way in: every request runs the same code, takes the
 * same lock and passes the same checks as its one-shot command.
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

import { version as runnerVersion } from "../package.json"
import { apply, refused, setup, status, sync } from "./commands"
import { appStates, followLogs } from "./inspect"

export const version = (): RunnerVersion => ({ version: runnerVersion, protocol: RUNNER_PROTOCOL })

/** Lines that are not requests, in a row, before the runner gives up on the session. */
const MAX_BAD_LINES = 3

/** Bytes of requests received but not yet handled. A client further ahead than this waits. */
const QUEUE_LIMIT = LIMITS.messageBytes

/** Where the frames of a session go. */
export type FrameSink = {
  /** Writes one frame. Never throws: work in progress carries on when nobody reads any more. */
  write: (frame: SessionFrame) => void
  /** Resolves once everything written so far has left, or once nobody reads any more. */
  drained: () => Promise<void>
}

/**
 * Frames on standard output, one line each. Once the reader has gone, frames
 * are dropped quietly: a deploy in progress still finishes.
 */
export function stdoutSink(): FrameSink {
  const waiting: (() => void)[] = []
  let backedUp = false
  let gone = false
  const release = () => {
    backedUp = false
    for (const resolve of waiting.splice(0)) resolve()
  }
  process.stdout.on("drain", release)
  // Without this, a write to a closed connection would end the process in the middle of a deploy.
  process.stdout.on("error", () => {
    gone = true
    release()
  })
  return {
    write(frame) {
      if (gone) return
      try {
        if (!process.stdout.write(`${JSON.stringify(frame)}\n`)) backedUp = true
      } catch {
        gone = true
        release()
      }
    },
    drained: () => (backedUp && !gone ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve()),
  }
}

/**
 * Splits a byte stream into lines. A line longer than `limit` bytes is let go
 * of as it arrives, never held whole, and given as `null` so it can be refused.
 */
export async function* requestLines(stream: ReadableStream<Uint8Array>, limit: number): AsyncGenerator<Uint8Array | null> {
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

/** Runs one request through the code of its one-shot command and returns its answer. */
async function handle(dir: string, request: SessionRequest, sink: FrameSink, closed: AbortSignal): Promise<unknown> {
  const { command, input } = request
  // The one-shot commands read their request as text and check it themselves.
  const text = input === undefined ? "" : JSON.stringify(input)
  try {
    switch (command) {
      case "version":
        return version()
      case "status":
        return status(dir)
      case "setup":
        return setup(dir, text)
      case "sync":
        return await sync(dir, text)
      case "apply":
        // Docker's own output, line by line. The deploy does not wait for anyone to read it.
        return await apply(dir, text, (line) => sink.write({ event: "progress", line }))
      case "state":
        return await appStates(dir)
      case "logs": {
        const gone = whenAborted(closed)
        // A slow reader slows Docker's log command down, until the reader goes away.
        return await followLogs(dir, text, (event) => {
          sink.write(event)
          return Promise.race([sink.drained(), gone])
        }, closed)
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
 * when the session was ended because lines were not requests.
 *
 * When the input closes, the request in progress is finished (`apply`) or
 * stopped (`logs`), the requests received before the close are answered, and
 * the session ends.
 */
export async function runSession(dir: string, input: ReadableStream<Uint8Array>, sink: FrameSink): Promise<number> {
  const queue: (Uint8Array | null)[] = []
  let queued = 0
  let wake: (() => void) | undefined
  let room: (() => void) | undefined
  const closed = new AbortController()
  const nudge = () => {
    const resolve = wake
    wake = undefined
    resolve?.()
  }

  // Reading goes on while a request is handled, so that a closed input is
  // noticed during a long request such as `logs`.
  void (async () => {
    try {
      for await (const line of requestLines(input, LIMITS.messageBytes)) {
        while (queued > QUEUE_LIMIT) await new Promise<void>((resolve) => (room = resolve))
        queue.push(line)
        queued += line?.length ?? 0
        nudge()
      }
    } catch {
      // The other side went away.
    }
    closed.abort()
    nudge()
  })()

  /** The next line, or undefined once the input has closed and every line was taken. */
  const next = async (): Promise<Uint8Array | null | undefined> => {
    for (;;) {
      if (queue.length > 0) {
        const line = queue.shift()!
        queued -= line?.length ?? 0
        const resolve = room
        room = undefined
        resolve?.()
        return line
      }
      if (closed.signal.aborted) return undefined
      await new Promise<void>((resolve) => (wake = resolve))
    }
  }

  let bad = 0
  for (;;) {
    const line = await next()
    if (line === undefined) return 0
    const request = line === null ? undefined : parseMessage(SessionRequestSchema, line)
    if (!request?.ok) {
      sink.write({ result: refused("invalid_request") })
      if (++bad >= MAX_BAD_LINES) return 1
      continue
    }
    bad = 0
    sink.write({ result: await handle(dir, request.value, sink, closed.signal) })
  }
}
