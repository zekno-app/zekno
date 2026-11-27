/**
 * The processes of a deploy's build run (specs/016-build-from-source, T091;
 * contracts/runner.md RB15 step 1; FR-039): found by the run token in
 * their environment, only the runner's own user's and never another
 * token's; asked to stop, killed once the grace has passed, and polled
 * until gone. The clients are the stand-in for Docker's build clients, real
 * processes that write their environment to the stand-in's proc folder as
 * Linux keeps it. Real `/proc`: check L5 in the Linux stand-in.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runProcesses, stopRun } from "../../src/builder/run-processes"
import { clients, procEntry, startBuild } from "../support/docker/build-client"
import type { ScriptedBuild } from "../support/docker/model"
import { fakeDocker, isAlive, tempDir, waitFor } from "../support/helpers"

const RUN = "cd".repeat(16)
const OTHER_RUN = "ef".repeat(16)
/** A pid no process has here: the highest a pid can be on Linux, and beyond any macOS gives. */
const GONE = 4194304

afterEach(() => {
  for (const child of clients.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL")
})

/** A stand-in for Docker and a runner's home for its build clients. */
function place() {
  const docker = fakeDocker()
  return { docker, home: tempDir("run-home"), procRoot: docker.procRoot }
}
type Place = ReturnType<typeof place>

/** Starts a stand-in build client carrying `token`, as the runner starts one (RB7), once its proc entry is there. */
async function client(p: Place, token: string, script: ScriptedBuild = {}) {
  p.docker.script({ nextBuilds: [{ hang: true, ...script }] })
  const child = startBuild({
    docker: p.docker,
    home: p.home,
    work: tempDir("run-work"),
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: p.home,
      BUILDX_CONFIG: join(p.home, "buildx"),
      BUILDX_GIT_INFO: "0",
      BUILDX_GIT_LABELS: "0",
      ZEKNO_BUILD_RUN: token,
    },
  })
  await waitFor(
    () => Bun.file(procEntry(p.docker, child.pid)).size > 0,
    "the client's proc entry"
  )
  return child
}

describe("stopRun (RB15, step 1)", () => {
  test("signals only the live processes of the runner's user that carry the run's token", async () => {
    const p = place()
    const mine = await client(p, RUN)
    const other = await client(p, OTHER_RUN)
    expect(runProcesses(RUN, { procRoot: p.procRoot })).toEqual([mine.pid])
    // As if the runner were another user: this test's processes are not its own.
    const elsewhere = { procRoot: p.procRoot, uid: process.getuid!() + 1 }
    expect(runProcesses(RUN, elsewhere)).toEqual([])
    expect(await stopRun(RUN, elsewhere)).toEqual([])
    expect(isAlive(mine.pid)).toBe(true)
    // An entry left by a process that is gone is never signalled.
    mkdirSync(join(p.procRoot, String(GONE)))
    writeFileSync(
      join(p.procRoot, String(GONE), "environ"),
      `ZEKNO_BUILD_RUN=${RUN}\0`
    )
    // A token that is not one names nothing.
    expect(await stopRun("", { procRoot: p.procRoot })).toEqual([])
    expect(await stopRun(RUN.slice(1), { procRoot: p.procRoot })).toEqual([])

    expect(await stopRun(RUN, { procRoot: p.procRoot })).toEqual([mine.pid])
    // Asked to stop, it stopped as buildx does (the stand-in's 130).
    expect(await mine.exited).toBe(130)
    expect(runProcesses(RUN, { procRoot: p.procRoot })).toEqual([])
    expect(isAlive(other.pid)).toBe(true)
    const runs = p.docker.model().builds
    expect(runs.find((run) => run.pid === other.pid)!.ended).toBeUndefined()
    expect(runs.find((run) => run.pid === mine.pid)!.ended).toBe("stopped")
  }, 30_000)

  test("a process that goes on through SIGTERM is killed once the grace has passed, and polled until gone", async () => {
    const p = place()
    const child = await client(p, RUN, { ignoreTerm: true })
    const started = Date.now()
    expect(
      await stopRun(RUN, { procRoot: p.procRoot, killAfterMs: 300 })
    ).toEqual([child.pid])
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    expect(isAlive(child.pid)).toBe(false)
    await child.exited
    expect(child.signalCode).toBe("SIGKILL")
  }, 30_000)

  test("no process of the run, or no proc folder at all: nothing signalled, no wait", async () => {
    const p = place()
    const started = Date.now()
    expect(await stopRun(RUN, { procRoot: p.procRoot })).toEqual([])
    expect(
      await stopRun(RUN, { procRoot: join(p.home, "no-such-folder") })
    ).toEqual([])
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
