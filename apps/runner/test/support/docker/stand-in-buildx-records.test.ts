/**
 * The stand-in for Docker learns Docker's records, images and Compose
 * without a build (specs/016-build-from-source, T064; contracts/runner.md,
 * "Tests" first bullet, RB10 to RB15, RB17, E08): `buildx history ls`,
 * `inspect` and `rm`, `buildx prune` and `du`, `image inspect` and `image
 * rm` of the images builds tagged, `compose … up --no-build`, whether
 * `<home>/state.lock` existed at each call, and `strayTags`. A call it is not
 * told about still behaves as before.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runDocker, TIMED_OUT } from "../../../src/docker/run"
import { waitFor } from "../helpers"
import {
  buildWorld,
  clients,
  finished,
  KEY,
  procEntry,
  startBuild,
  TAG,
  type BuildWorld,
} from "./build-client"
import { strayTags, type ScriptedBuild } from "./model"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
  for (const child of clients.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL")
})

/** A world whose calls go through `runDocker`, in the runner's home, as the runner makes them. */
function setUp(script?: ScriptedBuild) {
  const w = buildWorld(script)
  process.env.ZEKNO_DOCKER = w.docker.path
  const call = (...args: string[]) => runDocker(w.home, args)
  return { ...w, call }
}

/** Runs one build to its end and gives its record's ref. */
async function built(w: BuildWorld, script: ScriptedBuild = {}) {
  w.docker.script({ nextBuilds: [script] })
  await finished(startBuild(w))
  return w.docker.model().builds.at(-1)!.ref
}

/** Starts a build that hangs, and gives it once it runs. */
async function running(w: BuildWorld, script: ScriptedBuild = {}) {
  w.docker.script({ nextBuilds: [{ hang: true, ...script }] })
  const child = startBuild(w)
  await waitFor(
    () => w.docker.model().builds.some((each) => each.pid === child.pid),
    "the build to start"
  )
  await waitFor(
    () => Bun.file(procEntry(w.docker, child.pid)).size > 0,
    "its proc entry"
  )
  return { child, ref: w.docker.model().builds.at(-1)!.ref }
}

const inspect = (w: ReturnType<typeof setUp>, ref: string) =>
  w.call("buildx", "history", "inspect", "--builder", "default", ref)

describe("Docker's records of builds (RB10, RB12, RB15)", () => {
  test("history ls lists the builder's records; history inspect says Running, Completed, Error or Canceled as buildx words them", async () => {
    const w = setUp()
    const done = await built(w)
    const failed = await built(w, { fail: "step" })
    const { child, ref: live } = await running(w)
    const listed = await w.call(
      ...["buildx", "history", "ls", "--builder", "default", "--format", "json"]
    )
    expect(listed.code).toBe(0)
    const rows = listed.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows.map((row) => [row.ref, row.status])).toEqual([
      [`default/default/${live}`, "Running"],
      [`default/default/${failed}`, "Error"],
      [`default/default/${done}`, "Completed"],
    ])
    expect((await w.call("buildx", "history", "ls")).stdout).toContain(done)

    expect((await inspect(w, done)).stdout).toMatch(/^Build Steps: +8\/8/m)
    expect((await inspect(w, done)).stdout).not.toMatch(/^(Status|Error):/m)
    expect((await inspect(w, failed)).stdout).toMatch(
      /^Error: +Unknown process "\/bin\/sh -c npm ci" did not complete successfully: exit code: 1$/m
    )
    expect((await inspect(w, live)).stdout).toMatch(
      /^Duration: +\S+ \(running\)$/m
    )
    child.kill()
    await child.exited
    const canceled = await inspect(w, live)
    expect(canceled.stdout).toMatch(/^Status: +Canceled$/m)
    expect(canceled.stdout).not.toContain("(running)")
    const json = JSON.parse(
      (
        await w.call(
          ...["buildx", "history", "inspect", live, "--format", "json"]
        )
      ).stdout
    ) as { Ref: string; Status: string }
    expect(json).toMatchObject({ Status: "canceled" })
    expect(await inspect(w, "nosuchref0000000000000000")).toEqual({
      code: 1,
      stdout: "",
      stderr: 'ERROR: no record found for ref "nosuchref0000000000000000"\n',
    })
  }, 30_000)

  test("a record stays Running for N seconds after its client stopped, or for good", async () => {
    const w = setUp()
    const first = await running(w, { recordRuns: 1 })
    const second = await running(w, { recordRuns: "forever" })
    first.child.kill("SIGKILL")
    second.child.kill()
    await Promise.all([first.child.exited, second.child.exited])
    for (const each of [first, second])
      expect((await inspect(w, each.ref)).stdout).toContain("(running)")
    await Bun.sleep(1100)
    expect((await inspect(w, first.ref)).stdout).toMatch(/^Status: +Canceled$/m)
    expect((await inspect(w, second.ref)).stdout).toContain("(running)")
  }, 30_000)

  test("history rm removes a record; it can be scripted to fail; a running record is not removed", async () => {
    const w = setUp()
    const ref = await built(w)
    const rm = () =>
      w.call("buildx", "history", "rm", "--builder", "default", ref)
    w.docker.script({ historyRmFails: 1 })
    const refused = await rm()
    expect(refused.code).toBe(1)
    expect(refused.stderr).toStartWith("ERROR: ")
    expect((await inspect(w, ref)).code).toBe(0)
    expect(await rm()).toEqual({ code: 0, stdout: "", stderr: "" })
    expect(await inspect(w, ref)).toEqual({
      code: 1,
      stdout: "",
      stderr: `ERROR: ref ${ref} is deleted\n`,
    })
    expect(
      (await w.call("buildx", "history", "ls", "--format", "json")).stdout
    ).toBe("")
    expect(w.docker.records()[0]!.deleted).toBe(true)

    const { ref: live } = await running(w)
    const busy = await w.call("buildx", "history", "rm", live)
    expect(busy.code).toBe(1)
    expect(w.docker.records().find((r) => r.ref === live)!.deleted).toBe(
      undefined
    )
  }, 30_000)
})

describe("the build cache (RB14, RB17)", () => {
  test("prune records its flags and brings du's total within the bound; an older buildx refuses --max-used-space", async () => {
    const w = setUp()
    w.docker.script({ du: 14_500_000_000 })
    const du = await w.call("buildx", "du", "--builder", "default")
    expect(du.code).toBe(0)
    expect(du.stdout).toMatch(/^Total:\s+14\.5GB$/m)
    const prune = [
      ...["buildx", "prune", "--builder", "default", "--force"],
      ...["--max-used-space", "10gb"],
    ]
    expect((await w.call(...prune)).code).toBe(0)
    expect(w.docker.model().prunes).toEqual([prune.slice(2)])
    // buildx reads 10gb as 10 GiB, and prints sizes in decimal units.
    expect((await w.call("buildx", "du")).stdout).toMatch(
      /^Total:\s+10\.74GB$/m
    )

    w.docker.script({ docker: { maxUsedSpace: false } })
    const older = await w.call(...prune)
    expect(older.code).toBe(1)
    expect(older.stderr).toContain("unknown flag: --max-used-space")
    const kept = [...prune.slice(0, -2), "--keep-storage", "5gb"]
    expect((await w.call(...kept)).code).toBe(0)
    expect((await w.call("buildx", "du")).stdout).toMatch(
      /^Total:\s+5\.369GB$/m
    )
  })

  test("prune can hang until it is stopped", async () => {
    const w = setUp()
    w.docker.script({ pruneHangs: true })
    const started = Date.now()
    const cut = await runDocker(w.home, ["buildx", "prune", "--force"], {
      timeoutMs: 500,
    })
    expect(cut.code).toBe(TIMED_OUT)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe("images (RB11, RB14, RB17) and Compose (RB13, E08)", () => {
  test("image inspect of a built tag: its .Id, its architecture, its size; No such image once gone", async () => {
    const w = setUp({ size: 123_456 })
    await built(w)
    const image = w.docker.model().images[0]!
    const id = await w.call("image", "inspect", "--format", "{{.Id}}", TAG)
    expect(id).toEqual({ code: 0, stdout: `${image.manifest}\n`, stderr: "" })
    expect(
      (
        await w.call(
          ...["image", "inspect", "--format", "{{.Id}} {{.Architecture}}", TAG]
        )
      ).stdout
    ).toBe(`${image.manifest} amd64\n`)
    const other = `zekno.invalid/web:${"b".repeat(64)}`
    const sizes = await w.call(
      ...["image", "inspect", "--format", "{{.Size}}", TAG, other]
    )
    expect(sizes).toEqual({
      code: 1,
      stdout: "123456\n",
      stderr: `Error response from daemon: No such image: ${other}\n`,
    })
    expect((await w.call("image", "rm", TAG)).code).toBe(0)
    expect(
      await w.call("image", "inspect", "--format", "{{.Id}}", TAG)
    ).toEqual({
      code: 1,
      stdout: "",
      stderr: `Error response from daemon: No such image: ${TAG}\n`,
    })
  })

  test("image rm without -f is refused while a container uses the image, then succeeds once none does", async () => {
    const w = setUp()
    await built(w)
    const [id] = w.docker.app("web", { web: [{ image: TAG }] }).web!
    const refused = await w.call("image", "rm", TAG)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain(
      `conflict: unable to remove repository reference "${TAG}" (must force)`
    )
    expect(w.docker.model().images).toHaveLength(1)
    w.docker.change(id!, { image: "example/web:1" })
    const removed = await w.call("image", "rm", TAG)
    expect(removed.code).toBe(0)
    expect(removed.stdout).toStartWith(`Untagged: ${TAG}\n`)
    expect(w.docker.model().images).toEqual([])
    expect((await w.call("image", "rm", TAG)).stderr).toBe(
      `Error response from daemon: No such image: ${TAG}\n`
    )
  })

  test("compose up --no-build refuses a built image that is not there, and starts as before when it is", async () => {
    const w = setUp()
    const compose = join(w.home, "apps/web/compose.yaml")
    mkdirSync(join(w.home, "apps/web"), { recursive: true })
    writeFileSync(
      compose,
      `services:\n  web:\n    image: "${TAG}"\n  cache:\n    image: redis:7\n`
    )
    const up = (...extra: string[]) =>
      w.call(
        ...["compose", "-p", "zekno-web", "-f", compose, "up", "-d"],
        ...["--remove-orphans", ...extra]
      )
    expect(await up("--no-build")).toEqual({
      code: 1,
      stdout: "",
      stderr: `Error response from daemon: No such image: ${TAG}\n`,
    })
    expect(w.docker.upFinished()).toBe(false)
    // Without --no-build, as today: Compose would build or pull it.
    expect((await up()).code).toBe(0)
    await built(w)
    expect((await up("--no-build")).code).toBe(0)
    expect(
      w.docker.calls().filter((c) => c.args.includes(" up "))
    ).toHaveLength(3)
    expect(w.docker.argv().some((argv) => argv[0] === "compose")).toBe(false)
  }, 20_000)
})

describe("the state lock and stray tags", () => {
  test("each call records whether <home>/state.lock existed while it ran", async () => {
    const w = setUp()
    await w.call("buildx", "du")
    writeFileSync(join(w.home, "state.lock"), "1:x")
    await w.call("image", "inspect", "--format", "{{.Id}}", TAG)
    await w.call("compose", "-p", "zekno-web", "ps", "--format", "json")
    // A build runs in its work folder; its home is BUILDX_CONFIG's parent.
    await finished(startBuild(w))
    expect(w.docker.calls().map((c) => c.stateLock)).toEqual([
      false,
      true,
      true,
    ])
    expect(w.docker.inspections().map((c) => c.stateLock)).toEqual([true])
  }, 20_000)

  test("strayTags names every zekno.invalid tag the state's builds do not name", async () => {
    const w = setUp()
    await built(w)
    w.docker.image(`zekno.invalid/api:${KEY}`)
    w.docker.image(`zekno.invalid/web:${"c".repeat(64)}`)
    const entry = (keys: string[], drop: string[] = []) => ({
      images: keys.map((key) => ({ key })),
      drop: drop.map((key) => ({ key })),
    })
    expect(strayTags(w.docker.model(), { builds: {} })).toEqual([
      `zekno.invalid/api:${KEY}`,
      TAG,
      `zekno.invalid/web:${"c".repeat(64)}`,
    ])
    expect(
      strayTags(w.docker.model(), {
        builds: { web: entry([KEY], ["c".repeat(64)]), api: entry([]) },
      })
    ).toEqual([`zekno.invalid/api:${KEY}`])
  })
})

describe("calls it is not told about", () => {
  test("behave as before", async () => {
    const w = setUp()
    w.docker.failWith(4)
    expect((await w.call("buildx", "history", "logs", "x")).code).toBe(4)
    expect((await w.call("buildx", "imagetools", "inspect", "x")).code).toBe(4)
    expect(w.docker.argv()).toEqual([])
    const pinned = await w.call(
      ...["image", "inspect", "--format", "{{.Id}}", "caddy@sha256:x"]
    )
    expect(pinned.code).toBe(0)
    expect(JSON.parse(pinned.stdout)[0].RepoDigests).toEqual(["caddy@sha256:x"])
    expect((await w.call("image", "rm", "example/web:1")).code).toBe(1)
  })
})
