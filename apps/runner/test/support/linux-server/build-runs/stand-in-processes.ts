/**
 * Processes a Linux check started in the stand-in, found and stopped by an
 * entry of their environment (specs/016-build-from-source, T013 and T014),
 * as RB15's `stopRun` finds a build's clients by `ZEKNO_BUILD_RUN=<run>`
 * (contracts/runner.md, RB15 step 1). A check gives each process it starts
 * such an entry of its own, and its removal stops exactly those.
 *
 *   await tagged(run, ["ZEKNO_BUILD_RUN=<token>"])       // [{ pid, comm, state }]
 *   await stopTagged(run, ["ZEKNO_BUILD_RUN=<token>"])   // those that would not stop
 *   procOf(stat)                                        // one /proc/<pid>/stat line, read
 *
 * Every command runs in the stand-in, through `gate.ts`.
 */
import type { InStandIn } from "./rb7"

export type Proc = {
  readonly pid: number
  readonly comm: string
  /** The state letter of `/proc/<pid>/stat`: R, S, D, T, Z, X, I. */
  readonly state: string
}

/** One line of `/proc/<pid>/stat`: `123 (docker) S 1 ...`; the name may hold `)`. */
export function procOf(stat: string): Proc | undefined {
  const line = stat.trim()
  const open = line.indexOf(" (")
  const close = line.lastIndexOf(") ")
  if (open < 1 || close < open) return undefined
  const pid = Number(line.slice(0, open))
  const state = line.slice(close + 2).split(" ")[0] ?? ""
  if (!Number.isSafeInteger(pid) || pid < 1 || !/^[A-Za-z]$/.test(state))
    return undefined
  return { pid, comm: line.slice(open + 2, close), state }
}

/** Alive: there, and neither a zombie nor dead. */
export function alive(proc: Proc | undefined): proc is Proc {
  return proc !== undefined && proc.state !== "Z" && proc.state !== "X"
}

/** `alive (docker, S)`, `exited, not yet reaped (docker)` or `gone`. */
export function procWords(proc: Proc | undefined): string {
  if (proc === undefined || proc.state === "X") return "gone"
  if (proc.state === "Z") return `exited, not yet reaped (${proc.comm})`
  return `alive (${proc.comm}, ${proc.state})`
}

/** An entry of a process's environment that a check gave it: `NAME=value`, nothing a shell or grep reads otherwise. */
export const ENTRY = /^[A-Z_][A-Z0-9_]*=[A-Za-z0-9._-]+$/

/** Prints the stat line of each process whose environment holds one of the entries `grep` is given. */
export const TAGGED_SCRIPT = [
  "for f in /proc/[0-9]*/environ; do",
  '  if grep -qzxF "$@" -- "$f" 2> /dev/null; then',
  "    p=${f#/proc/}",
  '    cat "/proc/${p%/environ}/stat" 2> /dev/null || :',
  "  fi",
  "done",
].join("\n")

/** The call that lists the processes holding any of `entries`. */
export function taggedArgs(entries: readonly string[]): string[] {
  if (entries.length === 0) throw new Error("a process is found by an entry")
  for (const entry of entries)
    if (!ENTRY.test(entry))
      throw new Error(`${JSON.stringify(entry)} is not an entry a check gives`)
  return [
    "sh",
    "-c",
    TAGGED_SCRIPT,
    "sh",
    ...entries.flatMap((entry) => ["-e", entry]),
  ]
}

/** The processes a listing printed, each once. */
export function taggedOf(stdout: string): Proc[] {
  const found = new Map<number, Proc>()
  for (const line of stdout.split("\n")) {
    const proc = procOf(line)
    if (proc !== undefined) found.set(proc.pid, proc)
  }
  return [...found.values()]
}

/** The processes of the stand-in whose environment holds one of `entries`. */
export async function tagged(
  run: InStandIn,
  entries: readonly string[]
): Promise<Proc[]> {
  return taggedOf((await run(taggedArgs(entries))).stdout)
}

/** One process by its id: undefined when it is gone. */
export async function procAt(
  run: InStandIn,
  pid: number
): Promise<Proc | undefined> {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error(`${pid} is not a process id`)
  const answer = await run(["cat", `/proc/${pid}/stat`])
  return answer.code === 0 ? procOf(answer.stdout) : undefined
}

/** Sends SIGKILL to `pids`; one already gone is no fault. */
export function killArgs(pids: readonly number[]): string[] {
  for (const pid of pids)
    if (!Number.isSafeInteger(pid) || pid < 2)
      throw new Error(`${pid} is not a process a check may stop`)
  return [
    "sh",
    "-c",
    'kill -9 "$@" 2> /dev/null || :',
    "sh",
    ...pids.map(String),
  ]
}

/**
 * Stops every process holding one of `entries` with SIGKILL, and looks
 * again each second, up to ten times. Gives those still alive.
 */
export async function stopTagged(
  run: InStandIn,
  entries: readonly string[],
  wait: (ms: number) => Promise<unknown> = Bun.sleep
): Promise<Proc[]> {
  for (let round = 0; round < 10; round++) {
    const found = (await tagged(run, entries)).filter(alive)
    if (found.length === 0) return []
    await run(killArgs(found.map((proc) => proc.pid)))
    await wait(1000)
  }
  return (await tagged(run, entries)).filter(alive)
}
