/**
 * The processes of a deploy's build run (specs/016-build-from-source,
 * contracts/runner.md RB15 step 1; FR-039, FR-045). Every build client of a
 * deploy carries the run token the state's `building.run` holds, as
 * `ZEKNO_BUILD_RUN` (RB7), and the token is in the state before any client
 * starts. So a runner that restarted, which holds no handle to a client its
 * dead predecessor started (today's `stopChild` takes one), finds each of
 * them by `/proc/<pid>/environ`: only processes of its own user, and never
 * itself. Real `/proc`: check L5 in the Linux stand-in; the tests read the
 * stand-in for Docker's proc folder (`procRoot`, a test seam).
 *
 *   await stopRun(building.run)        // asked, killed after 2 s, polled until gone
 *   runProcesses(building.run)         // [] once none of the run is alive
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs"
import { join } from "node:path"

/** The name every build client of a deploy carries its run token under (RB7). */
const RUN_NAME = "ZEKNO_BUILD_RUN"
/** A run token as the state holds it (CO13): 32 lowercase hex. */
const RUN_TOKEN = /^[0-9a-f]{32}$/
/** A process's folder in `/proc`: its id. */
const PID = /^[1-9][0-9]{0,9}$/
/** The most of a process's environment read: Linux holds far less for a command. */
const ENVIRON_BYTES = 1024 * 1024
/** How long a process asked to stop has before it is killed, as `stopChild` gives a client it started (RB10). */
const KILL_AFTER_MS = 2000
/** How long killed processes are polled for; one that outlives SIGKILL this long is left, and counts as alive. */
const GONE_WITHIN_MS = 10_000
/** How often a stopped process is polled. */
const POLL_MS = 50

/** Where the processes of a run are looked for, and how they are stopped. */
export type StopOptions = {
  /** The folder that stands for `/proc`: a seam for tests, where the stand-in for Docker keeps its clients' entries. */
  readonly procRoot?: string
  /** The runner's user: only its processes are ever signalled. This process's user when not said. */
  readonly uid?: number
  /** How long a process asked to stop (SIGTERM) has before it is killed (SIGKILL). */
  readonly killAfterMs?: number
  /** How long killed processes are polled until gone. */
  readonly goneWithinMs?: number
}

const ownUid = (): number | undefined =>
  typeof process.getuid === "function" ? process.getuid() : undefined

/** True while a process with this id exists and this one may signal it. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Sends a signal; a process gone in between is nothing to stop. */
function signal(pid: number, name: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(pid, name)
  } catch {
    // Gone already.
  }
}

/**
 * A file read to its end, at most `ENVIRON_BYTES`: a file in `/proc` says
 * its size is 0, so it is read until nothing more comes. Undefined when it
 * cannot be read (gone, or another user's).
 */
function readCapped(path: string): Buffer | undefined {
  let handle: number
  try {
    handle = openSync(path, "r")
  } catch {
    return undefined
  }
  try {
    const chunks: Buffer[] = []
    let size = 0
    while (size < ENVIRON_BYTES) {
      const chunk = Buffer.alloc(64 * 1024)
      const read = readSync(handle, chunk, 0, chunk.length, null)
      if (read === 0) break
      chunks.push(chunk.subarray(0, read))
      size += read
    }
    return Buffer.concat(chunks)
  } catch {
    return undefined
  } finally {
    closeSync(handle)
  }
}

/** Whether process `pid`, as `procRoot` shows it, belongs to `uid` and holds `entry` among its environment. */
function carries(
  procRoot: string,
  pid: number,
  uid: number,
  entry: string
): boolean {
  const folder = join(procRoot, String(pid))
  try {
    if (statSync(folder).uid !== uid) return false
  } catch {
    return false
  }
  // As Linux keeps it: each `NAME=value` ends with a NUL.
  const environ = readCapped(join(folder, "environ"))
  return (
    environ !== undefined &&
    environ.toString("latin1").split("\0").includes(entry)
  )
}

/**
 * The live processes of the runner's user that carry the run's token, by
 * `procRoot`, sorted; never this process. None for a token that is not one.
 */
export function runProcesses(
  token: string,
  options: StopOptions = {}
): number[] {
  const { procRoot = "/proc", uid = ownUid() } = options
  if (!RUN_TOKEN.test(token) || uid === undefined) return []
  let names: string[]
  try {
    names = readdirSync(procRoot)
  } catch {
    return []
  }
  const entry = `${RUN_NAME}=${token}`
  return names
    .filter((name) => PID.test(name))
    .map(Number)
    .filter(
      (pid) =>
        pid !== process.pid &&
        isAlive(pid) &&
        carries(procRoot, pid, uid, entry)
    )
    .sort((a, b) => a - b)
}

/** Polls `pids` until each is gone or `withinMs` has passed, and gives those still alive. */
async function stillAlive(
  pids: readonly number[],
  withinMs: number
): Promise<number[]> {
  const until = Date.now() + withinMs
  let left = pids.filter(isAlive)
  while (left.length > 0 && Date.now() < until) {
    await Bun.sleep(Math.min(POLL_MS, Math.max(1, until - Date.now())))
    left = left.filter(isAlive)
  }
  return left
}

/**
 * RB15's stop: every live process of the runner's own user whose
 * `<procRoot>/<pid>/environ` holds `ZEKNO_BUILD_RUN=<token>` is sent
 * SIGTERM, then SIGKILL after 2 seconds, and polled (`process.kill(pid, 0)`)
 * until gone. Each is checked again before it is killed, so a process id
 * used again since is never signalled. Gives the ids of those it found.
 */
export async function stopRun(
  token: string,
  options: StopOptions = {}
): Promise<number[]> {
  const {
    procRoot = "/proc",
    uid = ownUid(),
    killAfterMs = KILL_AFTER_MS,
    goneWithinMs = GONE_WITHIN_MS,
  } = options
  if (uid === undefined) return []
  const found = runProcesses(token, { procRoot, uid })
  for (const pid of found) signal(pid, "SIGTERM")
  const asked = await stillAlive(found, killAfterMs)
  const entry = `${RUN_NAME}=${token}`
  for (const pid of asked)
    if (carries(procRoot, pid, uid, entry)) signal(pid, "SIGKILL")
  await stillAlive(asked, goneWithinMs)
  return found
}
