/**
 * Docker's record of one build, as a Linux check reads it
 * (specs/016-build-from-source, T013; contracts/runner.md, RB12 and RB15;
 * research/map-runner.md, E01 and E04): `docker buildx history ls --format
 * json` gives each record's `ref` (`<builder>/<node>/<id>`), its `status`
 * (`Running`, `Completed`, `Error`, as buildx words it) and its times;
 * `docker buildx history inspect <id>` gives the rest, of which a record
 * line keeps the duration, the steps and the error.
 *
 *   const state = await recordState(run, HOME, id)   // { status: "Running", createdAt, ... } or undefined
 *   secondsBetween(killedAt, state.completedAt)       // 79.6
 *
 * Every command runs in the stand-in with RB7's environment, so buildx
 * reads only the check's own `BUILDX_CONFIG`.
 */
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "./rb7"
import { newRunToken, rb7Command, rb7Env } from "./rb7-args"

export const HISTORY_LS: readonly string[] = [
  ...["docker", "buildx", "history", "ls"],
  ...["--builder", "default", "--format", "json"],
]

/** A record's id, as buildx names its ref files. */
const RECORD_ID = /^[a-z0-9]{10,64}$/

export function historyInspectArgs(id: string): string[] {
  if (!RECORD_ID.test(id))
    throw new Error(`${JSON.stringify(id)} is not a build record's id`)
  return ["docker", "buildx", "history", "inspect", "--builder", "default", id]
}

export type RecordState = {
  /** `Running`, `Completed` or `Error`, as buildx gives it. */
  readonly status: string
  readonly createdAt?: string
  readonly completedAt?: string
}

type Raw = Record<string, unknown>

const text = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined

const pick = (raw: Raw, ...keys: string[]) =>
  keys.map((key) => text(raw[key])).find((value) => value !== undefined)

/**
 * The record `id` among those `history ls --format json` printed: one JSON
 * object a line, or one array. Its `status` as buildx gave it; from an
 * older shape, `Running` until it has a completion time, then `Error` with
 * an error and `Completed` without.
 */
export function recordStateOf(
  stdout: string,
  id: string
): RecordState | undefined {
  const items: unknown[] = []
  const all = stdout.trim()
  if (all.startsWith("[")) {
    try {
      items.push(...(JSON.parse(all) as unknown[]))
    } catch {
      // Read line by line below.
    }
  }
  if (items.length === 0)
    for (const line of all.split("\n")) {
      try {
        items.push(JSON.parse(line))
      } catch {
        // A line that is not JSON names no record.
      }
    }
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      continue
    const raw = item as Raw
    const ref = pick(raw, "ref", "Ref")
    if (ref === undefined || ref.split("/").at(-1) !== id) continue
    const createdAt = pick(raw, "created_at", "CreatedAt", "createdAt")
    const completedAt = pick(raw, "completed_at", "CompletedAt", "completedAt")
    const failed = raw.error ?? raw.Error
    const status =
      pick(raw, "status", "Status") ??
      (completedAt === undefined
        ? "Running"
        : failed !== undefined && failed !== null
          ? "Error"
          : "Completed")
    return {
      status,
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(completedAt === undefined ? {} : { completedAt }),
    }
  }
  return undefined
}

/** Of `history inspect`'s lines, those of the status, duration, steps and error, joined; else its first line. */
export function inspectWords(stdout: string): string {
  const kept = stdout
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => /^(?:Status|Duration|Build Steps|Error):/i.test(line))
  if (kept.length > 0) return kept.join(", ")
  return stdout.trim().split("\n")[0]?.trim() || "nothing printed"
}

const TIME = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/

/** A time of RFC 3339 with up to nine digits of the second, in milliseconds; undefined for anything else. */
export function timeOf(value: string | undefined): number | undefined {
  const found = value === undefined ? null : TIME.exec(value.trim())
  if (!found) return undefined
  const fraction = (found[2] ?? "").padEnd(3, "0").slice(0, 3)
  const ms = Date.parse(`${found[1]}.${fraction}${found[3]}`)
  return Number.isNaN(ms) ? undefined : ms
}

/** Seconds from `from` to `to`, to a tenth; undefined when either is not a time. */
export function secondsBetween(
  from: string | undefined,
  to: string | undefined
): number | undefined {
  const start = timeOf(from)
  const end = timeOf(to)
  if (start === undefined || end === undefined) return undefined
  return Math.round((end - start) / 100) / 10
}

/** The ids of the records buildx keeps in `<home>/buildx/refs/default/default/`: one per build it started there (map-runner E04). */
export async function refIds(run: InStandIn, home: string): Promise<string[]> {
  const listed = await run([
    "sh",
    "-c",
    'ls -1 "$1" 2> /dev/null || :',
    "sh",
    `${rb7Env({ home, run: newRunToken() }).BUILDX_CONFIG}/refs/default/default`,
  ])
  return listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => RECORD_ID.test(line))
}

/** The record `id` now, or undefined when `history ls` does not list it; a failed listing throws one line. */
export async function recordState(
  run: InStandIn,
  home: string,
  id: string
): Promise<RecordState | undefined> {
  const env = rb7Env({ home, run: newRunToken() })
  const answer = await run(rb7Command(HISTORY_LS, env))
  if (answer.code !== 0)
    throw new Error(`docker buildx history ls failed: ${firstLine(answer)}`)
  return recordStateOf(answer.stdout, id)
}

/** `history inspect` of `id`, in words; why not, when it fails. */
export async function inspectRecord(
  run: InStandIn,
  home: string,
  id: string
): Promise<string> {
  const env = rb7Env({ home, run: newRunToken() })
  const answer = await run(rb7Command(historyInspectArgs(id), env))
  if (answer.code !== 0) return `history inspect failed: ${firstLine(answer)}`
  return inspectWords(answer.stdout)
}
