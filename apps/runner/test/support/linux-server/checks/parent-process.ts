/**
 * The small parent process that stands for the runner in check L5
 * (specs/016-build-from-source, T013; FR-039, plan item 27; contracts/runner.md
 * RB15; research/map-runner.md E04 and E04c). In the stand-in it starts the
 * build client, RB7's list with RB7's environment, on a pack file, and reads
 * the client's output through a FIFO, writing each line to `seen`; nothing
 * else holds the FIFO's reading end, so when the parent is killed, only the
 * client's reader goes. It is started detached (`setsid`), with an entry of
 * its own in its environment, `ZEKNO_CHECK_PARENT=<marker>`, by which the
 * check's removal finds it; the client carries RB7's `ZEKNO_BUILD_RUN`.
 *
 *   await putFile(run, `${dir}/pack.tar`, packOf(files))
 *   await run(launchArgs(marker, dir, rb7Command(rb7Args(options), env, { work })))
 *   // dir/parent.pid, dir/client.pid, dir/seen
 *
 * And the words of L5's record line. Pure but for `putFile`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RecordState } from "../build-runs/build-records"
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "../build-runs/rb7"
import { checkFolder } from "../build-runs/rb7-args"
import { q } from "../stand-in/shell"
import { alive, procWords, type Proc } from "../build-runs/stand-in-processes"

/** The environment entry of the parent: `ZEKNO_CHECK_PARENT=<marker>`. */
export const PARENT_ENTRY = "ZEKNO_CHECK_PARENT"

/** The files the parent keeps in its folder. */
export const PARENT_FILES = {
  pack: "pack.tar",
  parent: "parent.pid",
  client: "client.pid",
  fifo: "out",
  seen: "seen",
} as const

/** A marker of L5: its file name in the cache mount, the parent's entry, and a word of its step. */
export const MARKER = /^zekno-check-stopping-[a-z0-9]{8,32}-[a-z]+$/

function marked(marker: string): string {
  if (!MARKER.test(marker))
    throw new Error(`${JSON.stringify(marker)} is not a marker of L5`)
  return marker
}

/** A step that sleeps 90 seconds, prints nothing, then writes the marker into its cache mount. */
export function stoppingDockerfile(base: string, marker: string): string {
  if (!/^[a-z0-9][a-z0-9._/-]*(?:@sha256:[0-9a-f]{64})?$/.test(base))
    throw new Error(`${JSON.stringify(base)} is not an image`)
  marked(marker)
  return `FROM ${base}\nRUN --mount=type=cache,target=/cache sleep 90 && echo ${marker} > /cache/${marker}\n`
}

/** The parent's script, its folder as `$1`: it starts `client` and reads all it prints. */
export function parentScript(client: readonly string[]): string {
  if (client.length === 0) throw new Error("the parent starts a client")
  const f = PARENT_FILES
  return [
    "dir=$1",
    `echo "$$" > "$dir/${f.parent}"`,
    `mkfifo "$dir/${f.fifo}"`,
    `${client.map(q).join(" ")} < "$dir/${f.pack}" > "$dir/${f.fifo}" 2>&1 &`,
    `echo "$!" > "$dir/${f.client}"`,
    `exec 3< "$dir/${f.fifo}"`,
    `while IFS= read -r line <&3; do printf '%s\\n' "$line" >> "$dir/${f.seen}"; done`,
  ].join("\n")
}

/** Starts the parent detached, with its entry, its output nowhere, so the call returns at once. */
export const LAUNCH = `${PARENT_ENTRY}="$1" setsid sh -c "$2" sh "$3" > /dev/null 2>&1 < /dev/null &`

export function launchArgs(
  marker: string,
  dir: string,
  client: readonly string[]
): string[] {
  return [
    "sh",
    "-c",
    LAUNCH,
    "sh",
    marked(marker),
    parentScript(client),
    checkFolder(dir, "the parent's folder"),
  ]
}

/** SIGKILL to `pid`, then the stand-in's time of it, as Docker writes times. */
export function killNowArgs(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid < 2)
    throw new Error(`${pid} is not a process the check started`)
  return [
    "sh",
    "-c",
    'kill -9 "$1" && date -u +%Y-%m-%dT%H:%M:%S.%NZ',
    "sh",
    String(pid),
  ]
}

/** Docker's root and containerd's, searched for the marker's file. */
export function markerArgs(marker: string): string[] {
  return [
    "sh",
    "-c",
    'find /var/lib/docker /var/lib/containerd -name "$1" -print -quit 2> /dev/null || :',
    "sh",
    marked(marker),
  ]
}

/** A pid file's process id, or undefined. */
export function pidIn(text: string): number | undefined {
  const value = text.trim()
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const pid = Number(value)
  return Number.isSafeInteger(pid) ? pid : undefined
}

/** Writes `bytes` to `path` in the stand-in, through a temporary file on this machine, removed after. */
export async function putFile(
  run: InStandIn,
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), "zekno-check-file-"))
  try {
    const file = join(folder, "file")
    writeFileSync(file, bytes)
    const answer = await run(["sh", "-c", 'cat > "$1"', "sh", path], {
      stdin: { file },
    })
    if (answer.code !== 0)
      throw new Error(`writing ${path} failed: ${firstLine(answer)}`)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

export type Moment = {
  /** Seconds after the kill. */
  readonly after: number
  readonly client: Proc | undefined
  /** The processes that hold the run's `ZEKNO_BUILD_RUN`. */
  readonly carrying: readonly Proc[]
  readonly record: RecordState | undefined
}

/** `after 5 s the client alive (docker, S), the run's token held by docker, docker-buildx, the record Running`. */
export function momentWords(moment: Moment): string {
  const holders = moment.carrying.filter(alive).map((proc) => proc.comm)
  return [
    `after ${moment.after} s the client ${procWords(moment.client)}`,
    holders.length === 0
      ? "no process holds the run's token"
      : `the run's token held by ${holders.join(", ")}`,
    `the record ${moment.record?.status ?? "not listed"}`,
  ].join(", ")
}

export type Scenario = {
  /** `the reader` or `the client itself`. */
  readonly killed: string
  readonly linesRead: number
  readonly moments: readonly Moment[]
  /** The record's first state past `Running`, and its completion's seconds after the kill. */
  readonly ended?: { readonly status: string; readonly seconds?: number }
  /** Seconds after the kill the record was last seen still running, when it never ended. */
  readonly runningAfter?: number
  readonly marker: boolean
  readonly last: Proc | undefined
  /** Whether the metadata file was written, and named the record. */
  readonly metadata: string
  readonly inspect: string
}

/** One kill's part of L5's record line. */
export function scenarioWords(scenario: Scenario): string {
  const ended =
    scenario.ended === undefined
      ? `the record still Running ${scenario.runningAfter ?? "?"} s after the kill`
      : `the record ${scenario.ended.status} ${
          scenario.ended.seconds === undefined
            ? "(no completion time)"
            : `${scenario.ended.seconds} s after the kill`
        }`
  return [
    `${scenario.killed} killed 10 s after the silent step started, ${scenario.linesRead} ${scenario.linesRead === 1 ? "line" : "lines"} read`,
    ...scenario.moments.map(momentWords),
    ended,
    `the marker ${scenario.marker ? "written" : "not written"}`,
    `at the end the client ${procWords(scenario.last)}`,
    scenario.metadata,
    `history inspect: ${scenario.inspect}`,
  ].join("; ")
}
