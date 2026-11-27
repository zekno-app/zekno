/**
 * The builder's output (specs/016-build-from-source, contracts/runner.md
 * RB9; contracts/core.md CO11; FR-031a, FR-070, FR-071). buildx writes its
 * progress on standard error as `--progress=rawjson`: each line one
 * BuildKit `SolveStatus` (`vertexes`, `statuses`, `logs` with base64
 * `data`, `warnings`). The runner turns them into the plain form a person
 * knows from `docker build` (`#9 [build 4/7] RUN npm ci`, the step's own
 * lines, `#9 CACHED`, `#9 ERROR: …`), and hands each on as one `build_line`
 * of at most 4,096 characters. A line that is not JSON is handed on as
 * text, cut, and parsed no further.
 *
 * Kept in memory only, until the build's outcome is decided (RB9, second
 * bullet): whether a step other than `FROM` and `[internal]` was cached
 * (FR-021a), the failing step and its error (`build_error`), and the end of
 * the last error, which only helps choose the reason (RB16). Nothing is
 * written to a file. The text is the builder's and never trusted: zekno
 * sanitizes it before anything is drawn or printed (CL7).
 *
 *   const seen = await readProgress(client.stderr, (line) => send(line))
 *   seen.cached        // a step other than FROM came from the cache
 *   seen.failed        // { step, error }, cut to 1,024 and 4,096
 */
import { LIMITS } from "@workspace/core"

import { nextTurn } from "../docker/compose"

/** The longest line of standard error read, in bytes; a longer line is dropped whole (RB9). */
export const MAX_READ_LINE_BYTES = 1024 * 1024

/** What the runner keeps of a build's output, in memory only (RB9). */
export type BuilderSeen = {
  /** A vertex of a stage step other than `FROM` and `[internal]` was cached (FR-021a; map-runner E06). */
  readonly cached: boolean
  /** The first step that failed (not one cancelled after it), `step` cut to 1,024 characters and `error` to 4,096 (CO11). */
  readonly failed?: { readonly step: string; readonly error: string }
  /** The last 4,096 characters of the last error the builder gave, where Go puts the cause: for the reasons only (RB16), never sent. */
  readonly lastError?: string
}

/**
 * Takes one line for a person; a promise it returns is waited for, so a slow
 * reader slows the builder's reading. Once it throws, no more lines are
 * handed to it, and the output is still read to its end: a dropped
 * connection never stops a build (RB10, last bullet).
 */
export type LineSink = (line: string) => void | Promise<void>

/** Characters of one `build_line` (CO11). */
const LINE = LIMITS.buildLineCharacters
/** Characters of the failing step a `build_error` carries (CO11). */
const STEP = LIMITS.buildStepCharacters
/**
 * Vertexes numbered and followed, far more than a Dockerfile makes; past it
 * a new vertex's lines are not shown, though its cache and its error still
 * count. Each holds a name of at most a line, so the memory stays bounded.
 */
const TRACKED_VERTEXES = 2048
/** Completed statuses said for one vertex; the rest are not shown. */
const STATUSES_PER_VERTEX = 256
/** Characters of a status's id kept to say it only once. */
const STATUS_ID = 512
/** How long reading may go on before everything else gets a turn, as `readLines` does in `docker/compose.ts`. */
const TURN_MS = 10

/**
 * A Dockerfile stage's step as BuildKit names its vertex, `[2/3] RUN …`,
 * `[build 4/7] RUN …`, `[linux/amd64 build 2/3] COPY …`, giving its
 * instruction; never `[internal] …`, `[auth] …` or `exporting to image`.
 */
const STAGE_STEP = /^\[(?:[^\]\s]+ )*\d+\/\d+\] (\S+)/

/** A step that may come from the cache in a fresh build without counting: only `FROM`, whose image is resolved by digest (E06). */
function countsAsCached(name: string): boolean {
  const step = STAGE_STEP.exec(name)
  return step !== null && step[1]!.toUpperCase() !== "FROM"
}

/** BuildKit's word for a step stopped because another failed or the client went away. */
const isCancelled = (error: string) => /context canceled\s*$/.test(error)

const isHighHalf = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowHalf = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** `text` cut to at most `limit` characters from its start, never between the two halves of one character. */
export function cut(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(
    0,
    isHighHalf(text.charCodeAt(limit - 1)) ? limit - 1 : limit
  )
}

/** The last `limit` characters of `text` at most, never between the two halves of one character. */
function tail(text: string, limit: number): string {
  if (text.length <= limit) return text
  const start = text.length - limit
  return text.slice(isLowHalf(text.charCodeAt(start)) ? start + 1 : start)
}

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []

const TIME =
  /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/

/** A time as BuildKit writes it (RFC 3339, up to nine digits of the second), in milliseconds; undefined for anything else. */
function timeOf(value: unknown): number | undefined {
  const found = typeof value === "string" ? TIME.exec(value) : null
  if (!found) return undefined
  const fraction = (found[2] ?? "").padEnd(3, "0").slice(0, 3)
  const ms = Date.parse(`${found[1]}.${fraction}${found[3]}`)
  return Number.isNaN(ms) ? undefined : ms
}

/** A `[]byte` of Go's JSON: base64, read as UTF-8. */
const decoded = (data: string) => Buffer.from(data, "base64").toString("utf8")

/** Bytes as BuildKit's plain output says them: `120B`, `1.02kB`, `18.04MB`. */
function bytesWords(bytes: number): string {
  if (bytes < 1000) return `${bytes}B`
  let value = bytes
  let unit = 0
  const units = ["B", "kB", "MB", "GB", "TB", "PB"]
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(2)}${units[unit]}`
}

/** Seconds since a step started, as BuildKit stamps a step's lines: 3 digits under 10 s, 2 under 100 s, else 1. */
function stamp(started: number | undefined, at: number | undefined): string {
  if (started === undefined || at === undefined) return ""
  const seconds = Math.max(0, (at - started) / 1000)
  const digits = seconds < 10 ? 3 : seconds < 100 ? 2 : 1
  return `${seconds.toFixed(digits)} `
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

type Vertex = {
  /** Its number in the plain form: the order in which the builder first named it. */
  readonly index: number
  /** Cut to a line until it is shown, then to the step's bound. */
  name: string
  started?: number
  completed?: number
  cached: boolean
  error?: string
  shown: boolean
  ended: boolean
  /** The completed statuses already said. */
  readonly statuses: Set<string>
}

/** A line a step printed whose end has not come yet, after its number and time (`prefix` characters). */
type Partial = {
  readonly vertex: Vertex
  readonly prefix: number
  line: string
  full: boolean
}

/** Reads the builder's lines one at a time, hands on the plain form, and keeps what RB9 keeps. */
function newProgress(onLine: LineSink) {
  const vertexes = new Map<string, Vertex>()
  let numbered = 0
  let cached = false
  let failed: { step: string; error: string } | undefined
  let lastError: string | undefined
  let partial: Partial | undefined
  let sinkBroken = false

  const say = async (line: string) => {
    if (sinkBroken || line.trim() === "") return
    try {
      await onLine(cut(line, LINE))
    } catch {
      sinkBroken = true
    }
  }

  const flushPartial = async () => {
    const held = partial
    partial = undefined
    if (held === undefined) return
    const line = held.line.endsWith("\r") ? held.line.slice(0, -1) : held.line
    // A blank line a step printed says nothing.
    if (line.slice(held.prefix).trim() !== "") await say(line)
  }

  /** Each line of `text` with the vertex's number before it; a line not a step's own ends any step line held. */
  const sayLines = async (prefix: string, text: string) => {
    await flushPartial()
    for (const line of text.split("\n"))
      if (line.trim() !== "") await say(`${prefix}${line}`)
  }

  const showHeader = async (vertex: Vertex) => {
    if (vertex.shown) return
    vertex.shown = true
    if (vertex.name !== "") await sayLines(`#${vertex.index} `, vertex.name)
    vertex.name = cut(vertex.name, STEP)
  }

  const noteError = (name: string, error: string) => {
    if (isCancelled(error)) return
    failed ??= { step: cut(name, STEP), error: cut(error, LINE) }
    lastError = tail(error, LINE)
  }

  const endLine = (vertex: Vertex): string | undefined => {
    if (vertex.error !== undefined)
      return isCancelled(vertex.error) ? "CANCELED" : `ERROR: ${vertex.error}`
    if (vertex.cached) return "CACHED"
    if (vertex.completed === undefined) return undefined
    if (vertex.started === undefined) return "DONE"
    return `DONE ${(Math.max(0, vertex.completed - vertex.started) / 1000).toFixed(1)}s`
  }

  /** One vertex update: merged into what is known of it; its number given on first sight. */
  const vertexUpdate = async (update: Raw): Promise<Vertex | undefined> => {
    if (typeof update.digest !== "string") return undefined
    const name = typeof update.name === "string" ? update.name : ""
    const error =
      typeof update.error === "string" && update.error.trim() !== ""
        ? update.error.trim()
        : undefined
    let vertex = vertexes.get(update.digest)
    if (vertex === undefined) {
      numbered += 1
      if (vertexes.size < TRACKED_VERTEXES) {
        vertex = {
          index: numbered,
          name: cut(name, LINE),
          cached: false,
          shown: false,
          ended: false,
          statuses: new Set(),
        }
        vertexes.set(update.digest, vertex)
      }
    }
    const known = name !== "" ? name : (vertex?.name ?? "")
    if (update.cached === true && countsAsCached(known)) cached = true
    if (error !== undefined && vertex?.error === undefined)
      noteError(known, error)
    if (vertex === undefined) return undefined
    if (name !== "" && !vertex.shown) vertex.name = cut(name, LINE)
    vertex.started ??= timeOf(update.started)
    vertex.completed ??= timeOf(update.completed)
    vertex.cached ||= update.cached === true
    vertex.error ??= error
    if (
      vertex.started !== undefined ||
      vertex.completed !== undefined ||
      vertex.cached ||
      vertex.error !== undefined
    )
      await showHeader(vertex)
    return vertex
  }

  const statusUpdate = async (status: Raw) => {
    if (typeof status.vertex !== "string" || typeof status.id !== "string")
      return
    const vertex = vertexes.get(status.vertex)
    const completed = timeOf(status.completed)
    if (vertex === undefined || completed === undefined) return
    const id = cut(status.id, STATUS_ID)
    if (vertex.statuses.has(id) || vertex.statuses.size >= STATUSES_PER_VERTEX)
      return
    vertex.statuses.add(id)
    await showHeader(vertex)
    const current = count(status.current)
    const total = count(status.total)
    const size =
      total > 0
        ? ` ${bytesWords(current)} / ${bytesWords(total)}`
        : current > 0
          ? ` ${bytesWords(current)}`
          : ""
    const started = timeOf(status.started)
    const seconds = started === undefined ? 0 : (completed - started) / 1000
    const time = seconds >= 0.05 ? ` ${seconds.toFixed(1)}s` : ""
    await sayLines(`#${vertex.index} `, `${status.id}${size}${time} done`)
  }

  /** What a step printed: split at line feeds, each line stamped with the time its first part came. */
  const logUpdate = async (log: Raw) => {
    if (typeof log.vertex !== "string" || typeof log.data !== "string") return
    const vertex = vertexes.get(log.vertex)
    if (vertex === undefined) return
    const text = decoded(log.data)
    if (text === "") return
    await showHeader(vertex)
    if (partial !== undefined && partial.vertex !== vertex) await flushPartial()
    const prefix = `#${vertex.index} ${stamp(vertex.started, timeOf(log.timestamp))}`
    let from = 0
    while (from < text.length) {
      const end = text.indexOf("\n", from)
      const piece = text.slice(from, end === -1 ? text.length : end)
      partial ??= { vertex, prefix: prefix.length, line: prefix, full: false }
      if (!partial.full) {
        const joined = partial.line + piece
        partial.full = joined.length > LINE
        partial.line = cut(joined, LINE)
      }
      if (end === -1) break
      await flushPartial()
      from = end + 1
    }
  }

  const warningUpdate = async (warning: Raw) => {
    if (typeof warning.short !== "string") return
    const short = decoded(warning.short).split("\n")[0]!
    const vertex =
      typeof warning.vertex === "string"
        ? vertexes.get(warning.vertex)
        : undefined
    if (vertex !== undefined) await showHeader(vertex)
    await sayLines(
      vertex === undefined ? "" : `#${vertex.index} `,
      `WARN: ${short}`
    )
  }

  /** One `SolveStatus`, said in BuildKit's order: names, statuses, warnings, lines, then each step's end. */
  const solveStatus = async (status: Raw) => {
    const touched = new Set<Vertex>()
    for (const update of listOf(status.vertexes)) {
      if (!isObject(update)) continue
      const vertex = await vertexUpdate(update)
      if (vertex !== undefined) touched.add(vertex)
    }
    for (const update of listOf(status.statuses))
      if (isObject(update)) await statusUpdate(update)
    for (const warning of listOf(status.warnings))
      if (isObject(warning)) await warningUpdate(warning)
    for (const log of listOf(status.logs))
      if (isObject(log)) await logUpdate(log)
    for (const vertex of touched) {
      const end = vertex.ended ? undefined : endLine(vertex)
      if (end === undefined) continue
      vertex.ended = true
      await sayLines(`#${vertex.index} `, end)
    }
  }

  return {
    /** One line of standard error, without its line feed. */
    async line(raw: string): Promise<void> {
      const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw
      const trimmed = text.trim()
      if (trimmed === "") return
      let parsed: unknown
      if (trimmed.startsWith("{"))
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          // Not JSON: handed on as text below.
        }
      if (isObject(parsed)) return solveStatus(parsed)
      // buildx's own last line, `ERROR: failed to build: …`, holds the cause.
      if (/^error\b/i.test(trimmed)) lastError = tail(trimmed, LINE)
      await flushPartial()
      await say(text)
    },
    /** The end of the output: a step line still held is handed on. */
    async end(): Promise<void> {
      await flushPartial()
    },
    seen(): BuilderSeen {
      return {
        cached,
        ...(failed === undefined ? {} : { failed }),
        ...(lastError === undefined ? {} : { lastError }),
      }
    },
  }
}

function joined(parts: readonly Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!
  const all = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }
  return all
}

/**
 * Reads the builder's standard error to its end, by lines of at most
 * `MAX_READ_LINE_BYTES` (a longer line is dropped whole, never cut and
 * parsed), and hands each line of the plain form to `onLine`. Gives what
 * RB9 keeps. Never throws for what the builder printed: a stream that breaks
 * off ends the reading with what came.
 */
export async function readProgress(
  stream: ReadableStream<Uint8Array>,
  onLine: LineSink
): Promise<BuilderSeen> {
  const progress = newProgress(onLine)
  const decoder = new TextDecoder()
  let pending: Uint8Array[] = []
  let size = 0
  let dropping = false
  const take = async () => {
    const line = dropping || size === 0 ? undefined : joined(pending, size)
    pending = []
    size = 0
    dropping = false
    if (line !== undefined) await progress.line(decoder.decode(line))
  }
  let turn = performance.now()
  try {
    for await (const chunk of stream) {
      let from = 0
      while (from < chunk.length) {
        const end = chunk.indexOf(0x0a, from)
        const stop = end === -1 ? chunk.length : end
        if (!dropping && stop > from) {
          if (size + (stop - from) > MAX_READ_LINE_BYTES) {
            dropping = true
            pending = []
            size = 0
          } else {
            pending.push(chunk.slice(from, stop))
            size += stop - from
          }
        }
        if (end === -1) break
        await take()
        from = end + 1
      }
      if (performance.now() - turn >= TURN_MS) {
        await nextTurn()
        turn = performance.now()
      }
    }
  } catch {
    // The stream broke off: what was read is all there is.
  }
  await take()
  await progress.end()
  return progress.seen()
}
