/**
 * The steps of `.github/workflows/linux-checks.yml` that hold logic of their
 * own (specs/016-build-from-source, T010), run with bash as GitHub runs them
 * on Linux, with a stand-in `bun` on PATH that prints what server.ts would:
 * `up` keeps its output and hands the stand-in's name on, the last step
 * removes the run the log names even after a failed `up`, and an engine swap
 * names the run of `ZEKNO_LINUX_SERVER`. Nothing here runs Docker or bun.
 */
import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Step, type Workflow, scriptArgs } from "./workflow-reading"

const ROOT = join(import.meta.dir, "../../../../../..")
const FILE = join(ROOT, ".github/workflows/linux-checks.yml")
const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : ""
const workflow = (text === "" ? { jobs: {} } : Bun.YAML.parse(text)) as Workflow
const SERVER = "apps/runner/test/support/linux-server/server.ts"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Runs a step's script with bash, as GitHub runs it on Linux, with a stand-in `bun` printing `out`. */
function runStep(
  step: Step,
  options: {
    out?: string
    code?: number
    log?: string
    env?: Record<string, string>
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), "zekno-linux-checks-step-"))
  dirs.push(dir)
  const bin = join(dir, "bin")
  const temp = join(dir, "temp")
  mkdirSync(bin)
  mkdirSync(temp)
  writeFileSync(join(dir, "out"), options.out ?? "")
  writeFileSync(
    join(bin, "bun"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${dir}/calls'\ncat '${dir}/out'\nexit ${options.code ?? 0}\n`
  )
  chmodSync(join(bin, "bun"), 0o755)
  if (options.log !== undefined)
    writeFileSync(join(temp, "linux-server-up.log"), options.log)
  writeFileSync(join(dir, "env"), "")
  writeFileSync(join(dir, "step.sh"), step.run!)
  const result = Bun.spawnSync(
    ["bash", "--noprofile", "--norc", "-eo", "pipefail", join(dir, "step.sh")],
    {
      cwd: dir,
      env: {
        PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
        RUNNER_TEMP: temp,
        GITHUB_ENV: join(dir, "env"),
        ...options.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  )
  const read = (path: string) =>
    existsSync(path) ? readFileSync(path, "utf8") : ""
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    calls: read(join(dir, "calls"))
      .split("\n")
      .filter((line) => line !== ""),
    githubEnv: read(join(dir, "env")),
    log: read(join(temp, "linux-server-up.log")),
  }
}

const UP_OUT = [
  "zekno-check-a1b2c3d4: remove what this run makes with bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id a1b2c3d4; it runs on Docker at unix:///var/run/docker.sock",
  "server started: 3 s",
  "ZEKNO_LINUX_SERVER=zekno-check-a1b2c3d4-server",
  "sshd on 127.0.0.1:22022; the client key and known_hosts are in /tmp/zekno-check-a1b2c3d4",
  "",
].join("\n")

describe("linux checks: the steps, run with bash", () => {
  const memory = workflow.jobs.memory?.steps ?? []
  const up = memory.find((step) => step.id === "up") ?? { run: "exit 9" }
  const remove = memory.at(-1) ?? { run: "exit 9" }

  test("up: its output kept in the log, and ZEKNO_LINUX_SERVER handed to the next steps", () => {
    const ran = runStep(up, { out: UP_OUT })
    expect(ran.code).toBe(0)
    expect(ran.calls).toEqual([
      `--no-env-file ${SERVER} up --engine floor --store containerd --memory 1g`,
    ])
    expect(ran.log).toBe(UP_OUT)
    expect(ran.githubEnv).toBe(
      "ZEKNO_LINUX_SERVER=zekno-check-a1b2c3d4-server\n"
    )
  })

  test("a failed up fails its step and hands nothing on, and its log still names the run for the last step", () => {
    const ran = runStep(up, {
      out: UP_OUT.split("\n")[0]! + "\nserver started failed (exit 125): no\n",
      code: 1,
    })
    expect(ran.code).not.toBe(0)
    expect(ran.githubEnv).toBe("")
    expect(runStep(remove, { log: ran.log }).calls).toEqual([
      `--no-env-file ${SERVER} down --id a1b2c3d4`,
    ])
  })

  test("the last step removes the run the log names, or says there is none", () => {
    const ran = runStep(remove, { log: UP_OUT })
    expect(ran.code).toBe(0)
    expect(ran.calls).toEqual([`--no-env-file ${SERVER} down --id a1b2c3d4`])
    for (const log of [
      undefined,
      "",
      "Docker does not answer: no\n",
      "zekno-check-A1B2C3D4: remove what this run makes with x\n",
    ]) {
      const none = runStep(remove, { log })
      expect({ log, code: none.code, calls: none.calls }).toEqual({
        log,
        code: 0,
        calls: [],
      })
      expect(none.stdout).toBe(
        "server.ts up made no stand-in in this job, so there is nothing to remove.\n"
      )
    }
    expect(runStep(remove, { log: UP_OUT, code: 1 }).code).toBe(1)
  })

  test("an engine swap names the run of ZEKNO_LINUX_SERVER", () => {
    const swaps = (workflow.jobs["older-engine"]?.steps ?? []).filter((step) =>
      step.run?.includes(`${SERVER} engine`)
    )
    expect(swaps.map((step) => scriptArgs(step.run!, SERVER)?.at(-1))).toEqual([
      "distro",
      "distro-no-buildx",
      "floor-no-buildx",
    ])
    for (const swap of swaps) {
      const ran = runStep(swap, {
        env: { ZEKNO_LINUX_SERVER: "zekno-check-a1b2c3d4-server" },
      })
      expect(ran.code).toBe(0)
      expect(ran.calls).toEqual([
        `--no-env-file ${SERVER} engine --id a1b2c3d4 --engine ${scriptArgs(swap.run!, SERVER)!.at(-1)}`,
      ])
    }
  })
})
