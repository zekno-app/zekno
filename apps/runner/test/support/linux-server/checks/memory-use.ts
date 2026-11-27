/**
 * The parts of check L6 that need no Docker (specs/016-build-from-source,
 * T014; FR-043a, FR-089b; research/map-checks.md, T6): the app that writes
 * a line each second beside the build, the step that asks for 1.6 GB, and
 * the reading of the stand-in's cgroup (`memory.max`, `memory.events`), of
 * the app's lines and state, into the words of L6's record line. Pure.
 *
 * With `--cgroupns=private`, the stand-in's `/sys/fs/cgroup` is its own
 * cgroup: `memory.max` is the 1 GB `server.ts up --memory 1g` set, and
 * `memory.events` counts the kills in it and everything under it, dockerd,
 * the builder's steps and the app among them. Docker's `OOMKilled` of the
 * stand-in is read on the machine, through `gate.ts` (`oomKilledWords`).
 */
import type { Answer } from "../host/host-docker"
import { firstLine } from "../host/host-lists"
import { checkFolder } from "../build-runs/rb7-args"

/** The app's container in the stand-in's Docker. */
export const APP = "zekno-check-memory-app"
/** `--memory 1g`. */
export const HELD_BYTES = 1024 ** 3
/** What the step asks for: 1.6 GB. */
export const ASKED_BYTES = 1_600_000_000

export const MEMORY_MAX = "/sys/fs/cgroup/memory.max"
export const MEMORY_EVENTS = "/sys/fs/cgroup/memory.events"

const IMAGE = /^[a-z0-9][a-z0-9._/-]*(?:@sha256:[0-9a-f]{64})?$/

function image(base: string): string {
  if (!IMAGE.test(base))
    throw new Error(`${JSON.stringify(base)} is not an image`)
  return base
}

/** The app: a line a second into `<folder>/lines`, from the fixtures' base, with no network. */
export function appArgs(base: string, folder: string): string[] {
  return [
    ...["docker", "run", "--detach", "--name", APP, "--network", "none"],
    ...["--volume", `${checkFolder(folder, "the app's folder")}:/data`],
    image(base),
    ...["sh", "-c", "while :; do date +%s >> /data/lines; sleep 1; done"],
  ]
}

/** The app's line count: `wc -l` of its file. */
export function linesArgs(folder: string): string[] {
  return ["sh", "-c", 'wc -l < "$1"', "sh", `${checkFolder(folder)}/lines`]
}

/** The app's state, in the stand-in's Docker. */
export const APP_STATE_ARGS: readonly string[] = [
  ...["docker", "inspect", "--format"],
  "{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}",
  APP,
]

/** One step that reads 1.6 GB into one buffer; the token keeps it from any cache. */
export function hogDockerfile(base: string, token: string): string {
  if (!/^[a-z0-9]{8,32}$/.test(token))
    throw new Error(`${JSON.stringify(token)} is not a check's token`)
  return `FROM ${image(base)}\nRUN dd if=/dev/zero of=/dev/null bs=${ASKED_BYTES} count=1 && echo ${token}\n`
}

/** `memory.max`: its bytes, `max` when unlimited, undefined when unreadable. */
export function memoryMaxOf(text: string): number | "max" | undefined {
  const value = text.trim()
  if (value === "max") return "max"
  return /^[0-9]+$/.test(value) ? Number(value) : undefined
}

/** Held to 1 GB: a limit, and no more than `--memory 1g`. */
export function heldToOneGb(max: number | "max" | undefined): boolean {
  return typeof max === "number" && max <= HELD_BYTES
}

/** `memory.events`: each name and its count. */
export function memoryEventsOf(text: string): Record<string, number> {
  const events: Record<string, number> = {}
  for (const line of text.split("\n")) {
    const found = /^([a-z_]+) ([0-9]+)$/.exec(line.trim())
    if (found) events[found[1]!] = Number(found[2])
  }
  return events
}

/** `oom_kill +1 (1 in all), oom +2 (2 in all)`; `unread` without both. */
export function eventsWords(
  before: Readonly<Record<string, number>> | undefined,
  after: Readonly<Record<string, number>> | undefined
): string {
  if (before === undefined || after === undefined) return "unread"
  return ["oom_kill", "oom", "oom_group_kill"]
    .filter((name) => name in after)
    .map((name) => {
      const delta = after[name]! - (before[name] ?? 0)
      return `${name} ${delta >= 0 ? "+" : ""}${delta} (${after[name]} in all)`
    })
    .join(", ")
}

/** A count `wc -l` printed, or undefined. */
export function countIn(text: string): number | undefined {
  const value = text.trim()
  return /^[0-9]+$/.test(value) ? Number(value) : undefined
}

/** `12 → 20 → 23 lines, still growing`, or where it stopped. */
export function growthWords(counts: readonly (number | undefined)[]): string {
  const shown = counts.map((count) =>
    count === undefined ? "?" : String(count)
  )
  const known = counts.every((count) => count !== undefined)
  const growing =
    known && counts.every((count, at) => at === 0 || count! > counts[at - 1]!)
  return `${shown.join(" → ")} lines, ${
    !known ? "not all read" : growing ? "still growing" : "not growing"
  }`
}

/** The app's state from `APP_STATE_ARGS`: `running`, or `exited (exit 137, OOMKilled true)`. */
export function appStateWords(stdout: string, code = 0): string {
  if (code !== 0) return "not found"
  const [status, oom, exit] = stdout.trim().split(/\s+/)
  if (status === undefined || status === "") return "not found"
  if (status === "running")
    return oom === "true" ? "running, OOMKilled true" : "running"
  return `${status} (exit ${exit ?? "?"}, OOMKilled ${oom ?? "?"})`
}

/** What Docker's `OOMKilled` of the stand-in said, for L6's record: `true`, `false`, or why it could not be read. */
export function oomKilledWords(answer: Answer): string {
  const flag = answer.stdout.trim()
  return answer.code === 0 && (flag === "true" || flag === "false")
    ? `the stand-in's own OOMKilled: ${flag}`
    : `the stand-in's own OOMKilled could not be read: ${firstLine(answer) || "no answer"}`
}
