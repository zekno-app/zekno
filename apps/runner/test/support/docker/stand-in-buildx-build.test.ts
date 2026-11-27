/**
 * The stand-in for Docker learns `buildx build` (specs/016-build-from-source,
 * T063; contracts/runner.md, "Tests" first bullet, RB7, RB9 to RB12, RB15,
 * RB16): what it received, Docker's record and its ref file, its own proc
 * entry, its `--progress=rawjson` lines, the metadata file and the tag, and
 * each scripted behaviour. Each build is started here as the runner starts
 * one: the program `exec`ed, a tar on standard input, its own environment
 * and work folder.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { isAlive, waitFor } from "../helpers"
import {
  buildWorld as setUp,
  clients,
  finished,
  logs,
  pack,
  procEntry as proc,
  rb7,
  refsIn,
  startBuild as start,
  statuses,
  TAG,
  TOKEN,
  vertexes,
} from "./build-client"
import type { FakeRecord, ScriptedBuild } from "./model"

afterEach(() => {
  for (const child of clients.splice(0))
    if (child.exitCode === null) child.kill("SIGKILL")
})

describe("buildx build", () => {
  test("a tar on standard input: what it received, Docker's record and ref file, the rawjson lines, the metadata file and the tag", async () => {
    const w = setUp()
    const input = pack()
    const child = start(w, { input })
    const { code, stderr } = await finished(child)
    expect(code).toBe(0)

    const [run] = w.docker.model().builds
    expect(run!.args).toEqual(rb7(w.work))
    expect(run!.env).toEqual(w.env)
    expect(run!.cwd).toBe(realpathSync(w.work))
    expect(run!.pid).toBe(child.pid)
    expect(run!.context).toBe("-")
    expect(run!.input).toEqual({
      bytes: input.length,
      sha256: createHash("sha256").update(input).digest("hex"),
    })
    expect(
      run!.entries.map(({ name, kind, mode, size }) => ({
        name,
        kind,
        mode,
        size,
      }))
    ).toEqual([
      { name: "app/", kind: "folder", mode: 0o755, size: 0 },
      { name: "app/run.sh", kind: "file", mode: 0o755, size: 3 },
      { name: "builder.dockerfile", kind: "file", mode: 0o644, size: 12 },
    ])
    expect(run!.ended).toBe("built")

    // The ref file: named by the record's ref, holding paths only.
    expect(refsIn(w)).toEqual([run!.ref])
    expect(run!.ref).toMatch(/^[a-z0-9]{25}$/)
    const held = JSON.parse(
      readFileSync(
        join(w.env.BUILDX_CONFIG, "refs/default/default", run!.ref),
        "utf8"
      )
    ) as Record<string, string>
    expect(Object.keys(held).sort()).toEqual([
      "DockerfilePath",
      "GroupRef",
      "LocalPath",
      "Target",
    ])
    expect(held.LocalPath).toBe("-")

    // rawjson: vertexes with name, cached, started, completed; logs in base64; statuses.
    const names = vertexes(stderr).map((v) => v.name)
    expect(names).toContain(
      "[internal] load build definition from builder.dockerfile"
    )
    expect(names).toContain("[build 3/3] RUN npm ci")
    const from = vertexes(stderr).find((v) => v.name.includes("FROM"))!
    expect(from.cached).toBe(true)
    const runStep = vertexes(stderr).filter(
      (v) => v.name === "[build 3/3] RUN npm ci"
    )
    // buildx leaves out `cached` when it is false.
    expect(runStep.at(-1)!.cached).toBeUndefined()
    expect(runStep.at(-1)!.started).toBeString()
    expect(runStep.at(-1)!.completed).toBeString()
    expect(vertexes(stderr).some((v) => v.error)).toBe(false)
    expect(logs(stderr)).toContain("added 42 packages")
    expect(statuses(stderr).some((s) => (s.statuses ?? []).length > 0)).toBe(
      true
    )

    // The metadata file, the tag and the record.
    const meta = JSON.parse(
      readFileSync(join(w.work, "meta.json"), "utf8")
    ) as Record<string, unknown>
    const manifest = meta["containerimage.digest"] as string
    const config = meta["containerimage.config.digest"] as string
    expect(manifest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(config).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(manifest).not.toBe(config)
    expect(meta["buildx.build.ref"]).toBe(`default/default/${run!.ref}`)
    expect(meta["buildx.build.provenance"]).toMatchObject({
      materials: [
        {
          uri: expect.stringMatching(/^pkg:docker\//),
          digest: { sha256: expect.any(String) },
        },
      ],
    })
    expect(w.docker.model().images).toEqual([
      expect.objectContaining({
        tag: TAG,
        id: manifest,
        manifest,
        config,
        architecture: "amd64",
      }),
    ])
    expect(w.docker.records()).toEqual([
      expect.objectContaining({
        ref: run!.ref,
        status: "Completed",
        builder: "default",
        node: "default",
      }),
    ])
    // Its proc entry is gone with it.
    expect(existsSync(proc(w.docker, child.pid))).toBe(false)
    // The call is recorded with the others.
    expect(w.docker.argv()).toEqual([rb7(w.work)])
    expect(w.docker.calls().map((c) => c.cwd)).toEqual([realpathSync(w.work)])
  })

  test("the classic store gives .Id the config digest; the image has the server's architecture, or the one scripted", async () => {
    const w = setUp({ id: "config" })
    w.docker.script({ docker: { arch: "aarch64" } })
    expect((await finished(start(w))).code).toBe(0)
    const meta = JSON.parse(readFileSync(join(w.work, "meta.json"), "utf8"))
    expect(w.docker.model().images[0]).toMatchObject({
      id: meta["containerimage.config.digest"],
      architecture: "arm64",
    })
    w.docker.script({
      build: {
        arch: "amd64",
        materials: [
          {
            uri: "pkg:docker/zekno.invalid/other@k1?platform=linux%2Farm64",
            digest: "sha256:" + "b".repeat(64),
          },
        ],
      },
    })
    expect((await finished(start(w))).code).toBe(0)
    const again = JSON.parse(readFileSync(join(w.work, "meta.json"), "utf8"))
    expect(w.docker.model().images).toHaveLength(1)
    expect(w.docker.model().images[0]!.architecture).toBe("amd64")
    expect(again["buildx.build.provenance"].materials).toEqual([
      {
        uri: "pkg:docker/zekno.invalid/other@k1?platform=linux%2Farm64",
        digest: { sha256: "b".repeat(64) },
      },
    ])
  })

  test("a folder context: its files listed with their modes", async () => {
    const w = setUp()
    const plan = join(w.work, "plan")
    mkdirSync(join(plan, "sub"), { recursive: true })
    writeFileSync(join(plan, "plan.json"), "{}")
    writeFileSync(join(plan, "sub", "run"), "x")
    chmodSync(join(plan, "sub", "run"), 0o700)
    const args = [...rb7(w.work).slice(0, -1), plan]
    expect(
      (await finished(start(w, { args, input: new Uint8Array() }))).code
    ).toBe(0)
    const [run] = w.docker.model().builds
    expect(run!.context).toBe(plan)
    expect(
      run!.entries.map(({ name, kind, mode }) => ({ name, kind, mode }))
    ).toEqual([
      { name: "plan.json", kind: "file", mode: 0o644 },
      { name: "sub/", kind: "folder", mode: 0o755 },
      { name: "sub/run", kind: "file", mode: 0o700 },
    ])
  })

  test("the ref file appears at the start, or only after the first vertex, as scripted", async () => {
    for (const refAt of ["start", "first_vertex"] as const) {
      const w = setUp({ refAt })
      const child = start(w, { hold: true })
      await waitFor(
        () => w.docker.model().builds.length === 1,
        "the build to start"
      )
      await Bun.sleep(100)
      expect(refsIn(w)).toHaveLength(refAt === "start" ? 1 : 0)
      void child.stdin.end()
      expect((await finished(child)).code).toBe(0)
      expect(refsIn(w)).toEqual([w.docker.model().builds[0]!.ref])
    }
  }, 20_000)

  test("the proc entry names the run token, NUL-separated, for the process the runner started", async () => {
    const w = setUp({ hang: true })
    const child = start(w)
    const entry = proc(w.docker, child.pid)
    await waitFor(() => existsSync(entry), "the proc entry")
    const names = readFileSync(entry, "utf8").split("\0").filter(Boolean)
    expect(names).toContain(`ZEKNO_BUILD_RUN=${TOKEN}`)
    expect(names).toContain(`BUILDX_CONFIG=${w.env.BUILDX_CONFIG}`)
    child.kill()
    expect((await finished(child)).code).toBe(130)
    expect(existsSync(entry)).toBe(false)
  })

  test("a step fails: an ERROR vertex, exit 1, no metadata file, no tag, the record Error", async () => {
    const texts = {
      step: "exit code: 1",
      killed: "exit code: 137",
      no_space: "no space left on device",
      exec_format: "exec format error",
      no_memory: "cannot allocate memory",
    } as const
    for (const [fail, text] of Object.entries(texts)) {
      const w = setUp({ fail: fail as keyof typeof texts })
      const { code, stderr } = await finished(start(w))
      expect(code).toBe(1)
      const failed = vertexes(stderr).find((v) => v.error)!
      expect(failed.name).toBe("[build 3/3] RUN npm ci")
      expect(failed.error).toContain(text)
      expect(stderr).toContain(
        `ERROR: failed to build: failed to solve: ${failed.error}`
      )
      expect(existsSync(join(w.work, "meta.json"))).toBe(false)
      expect(w.docker.model().images).toEqual([])
      expect(w.docker.records()[0]).toMatchObject({
        status: "Error",
        error: failed.error,
      })
      expect(w.docker.model().builds[0]!.ended).toBe("failed")
    }
  }, 20_000)

  test("exit 137: the killed step's error, and the client's own status as scripted", async () => {
    const w = setUp({ fail: "killed", exit: 137 })
    const { code, stderr } = await finished(start(w))
    expect(code).toBe(137)
    expect(vertexes(stderr).find((v) => v.error)!.error).toContain(
      "exit code: 137"
    )
  })

  test("a cached [stage …] vertex", async () => {
    const w = setUp({ cachedStep: true })
    const { code, stderr } = await finished(start(w))
    expect(code).toBe(0)
    const runStep = vertexes(stderr).filter(
      (v) => v.name === "[build 3/3] RUN npm ci"
    )
    expect(runStep.at(-1)).toMatchObject({ cached: true })
    expect(logs(stderr)).not.toContain("added 42 packages")
  })

  test("it hangs until stopped, and a stop ends it with exit 130 and a canceled step", async () => {
    const w = setUp({ hang: true })
    const child = start(w)
    await waitFor(
      () => existsSync(proc(w.docker, child.pid)),
      "the build to run"
    )
    await Bun.sleep(300)
    expect(child.exitCode).toBeNull()
    child.kill()
    const { code, stderr } = await finished(child)
    expect(code).toBe(130)
    expect(vertexes(stderr).at(-1)).toMatchObject({
      name: "[build 3/3] RUN npm ci",
      error: "context canceled",
    })
    expect(w.docker.model().builds[0]!.ended).toBe("stopped")
    expect(existsSync(join(w.work, "meta.json"))).toBe(false)
  })

  test("it ignores SIGTERM when scripted, and only SIGKILL stops it", async () => {
    const w = setUp({ hang: true, ignoreTerm: true })
    const child = start(w)
    await waitFor(
      () => existsSync(proc(w.docker, child.pid)),
      "the build to run"
    )
    child.kill()
    await Bun.sleep(500)
    expect(isAlive(child.pid)).toBe(true)
    child.kill("SIGKILL")
    await child.exited
    expect(child.signalCode).toBe("SIGKILL")
  })

  test("it prints without pause until stopped", async () => {
    const w = setUp({ flood: true })
    const child = start(w)
    const reader = child.stderr.getReader()
    let bytes = 0
    while (bytes < 2 * 1024 * 1024) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.length
    }
    expect(bytes).toBeGreaterThanOrEqual(2 * 1024 * 1024)
    child.kill()
    reader.releaseLock()
    expect(await child.exited).toBe(130)
  })

  test("a silent step keeps running after its reader goes away (E04c); one that prints ends with its reader", async () => {
    for (const script of [{ outlivesReader: true }, { hang: true }]) {
      const w = setUp(script)
      // The reader takes one byte and leaves, as a runner that died.
      const shell = Bun.spawn(
        [
          "sh",
          "-c",
          '"$@" 2>&1 >/dev/null | head -c 1 >/dev/null',
          "sh",
          w.docker.path,
          ...rb7(w.work),
        ],
        {
          cwd: w.work,
          env: w.env,
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        }
      )
      clients.push(shell)
      void shell.stdin.write(pack())
      void shell.stdin.end()
      await waitFor(
        () => w.docker.model().builds.length === 1,
        "the build to start"
      )
      const pid = w.docker.model().builds[0]!.pid
      await waitFor(() => existsSync(proc(w.docker, pid)), "its proc entry")
      await Bun.sleep(1200)
      if ("outlivesReader" in script) {
        expect(isAlive(pid)).toBe(true)
        expect(w.docker.records()[0]!.status).toBe("Running")
        process.kill(pid, "SIGKILL")
      } else {
        await waitFor(() => !isAlive(pid), "the client to end with its reader")
      }
    }
  }, 20_000)

  test("a killed client leaves its record as scripted: Running for N seconds, or for good, then Canceled or Error", async () => {
    const cases: [ScriptedBuild, FakeRecord["status"][]][] = [
      [{ hang: true }, ["Canceled", "Canceled"]],
      [{ hang: true, recordRuns: 1 }, ["Running", "Canceled"]],
      [{ hang: true, recordRuns: 1, stoppedAs: "Error" }, ["Running", "Error"]],
      [{ hang: true, recordRuns: "forever" }, ["Running", "Running"]],
    ]
    for (const [script, [soon, later]] of cases)
      for (const signal of ["SIGTERM", "SIGKILL"] as const) {
        const w = setUp(script)
        const child = start(w)
        await waitFor(
          () => existsSync(proc(w.docker, child.pid)),
          "the build to run"
        )
        child.kill(signal)
        await child.exited
        expect(w.docker.records()[0]!.status).toBe(soon!)
        if (soon !== later) await Bun.sleep(1100)
        expect(w.docker.records()[0]!.status).toBe(later!)
      }
  }, 60_000)
})
