/**
 * `released-run.ts` (specs/016-build-from-source, T021; check L1): the
 * order of its steps in the stand-in, the deploys it signs and sends, the
 * stop with one line on a SHA-256 that is not the recorded one, and the
 * removal of what it made by name, also after a failure. A stand-in
 * function answers for the stand-in and for runner 0.1.1; nothing here runs
 * Docker or reaches the network.
 */
import { type Envelope, generateServerKeyPair } from "@workspace/core"
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { payloadOf } from "../../deploy-v2"
import type { Answer } from "../host/host-docker"
import type { InStandIn } from "../build-runs/rb7"
import {
  cleanUpReleased,
  gitRecorded,
  observeReleased,
  type ReleasedMade,
} from "./released-run"
import { DOCKER_CONFIG, ROOT, RUNNER } from "./released-runner"

const X64 = "717f041499890b387084bb1371ec601a4490e482496c8af23a261f9096191613"
const RECORDED = JSON.stringify({
  version: "0.1.1",
  files: {
    "linux-x64": { sha256: X64 },
    "linux-arm64": { sha256: "9".repeat(64) },
  },
})
const deps = { recorded: () => RECORDED }

type Call = { readonly args: readonly string[]; readonly text?: string }
const ok = (stdout: string): Answer => ({ code: 0, stdout, stderr: "" })

/** Stands in for the stand-in and runner 0.1.1; `answer` takes a call first. */
function fakeStandIn(
  answer: (args: readonly string[]) => Partial<Answer> | undefined = () =>
    undefined
) {
  const server = generateServerKeyPair()
  const calls: Call[] = []
  let images = "busybox:1.36.1\n"
  let containers = ""
  const run: InStandIn = async (args, options) => {
    const text =
      options?.stdin !== undefined && "text" in options.stdin
        ? options.stdin.text
        : undefined
    calls.push({ args, text })
    const extra = answer(args)
    if (extra !== undefined) return { ...ok(""), ...extra }
    const last = args.at(-1)
    if (args[0] === "uname") return ok("x86_64\n")
    if (args[0] === "sh" && args[2]?.includes("curl ")) return ok(`${X64}\n`)
    if (args.includes(RUNNER) && last === "version")
      return ok('{"version":"0.1.1","protocol":3}\n')
    if (args.includes(RUNNER) && last === "setup")
      return ok(
        `${JSON.stringify({ serverPublicKey: server.publicKey, serverId: server.serverId, code: "c" })}\n`
      )
    if (args.includes(RUNNER) && last === "sync")
      return ok('{"outcome":"ok"}\n')
    if (args.includes(RUNNER) && last === "session") {
      const request = JSON.parse(text!) as { input: { envelope: Envelope } }
      const key = /check-released-([a-z]+)/.exec(
        JSON.stringify(payloadOf(request.input.envelope))
      )![1]!
      if (key !== "git") {
        images += `zekno.invalid/check-released-${key}:1\n`
        containers += `zekno-check-released-${key}-web-1 (zekno.invalid/check-released-${key}:1, created)\n`
      }
      return ok(
        [
          JSON.stringify({ event: "progress", line: " web Built" }),
          JSON.stringify({
            event: "progress",
            line:
              key === "git"
                ? "failed to solve: zekno.invalid: no such host"
                : "Error response from daemon: no command specified",
          }),
          JSON.stringify({
            result: {
              outcome: "start_failed",
              app: `check-released-${key}`,
              sequence: 1,
            },
          }),
        ].join("\n")
      )
    }
    if (args.includes(RUNNER) && last === "status")
      return ok(
        JSON.stringify({
          lastSequence: { "check-released-dot": 1, "check-released-parent": 1 },
        })
      )
    if (args[1] === "image" && args[2] === "ls") return ok(images)
    if (args[1] === "ps") return ok(containers)
    if (args[1] === "image" && args[2] === "inspect")
      return images.includes(`${last}\n`)
        ? ok("sha256:1\n")
        : { code: 1, stdout: "", stderr: "Error: No such image\n" }
    return ok("")
  }
  return { run, calls }
}

describe("observeReleased", () => {
  test("downloads, checks and places 0.1.1, sets it up for a team made in the run, sends one deploy per context and records each", async () => {
    const { run, calls } = fakeStandIn()
    const made: ReleasedMade = { started: false, cases: [] }
    const seen = await observeReleased(run, made, deps)
    expect(made).toEqual({
      started: true,
      placed: X64,
      cases: ["dot", "git", "parent"],
    })
    expect(calls[0]!.args).toEqual(["uname", "-m"])
    expect(calls[1]!.args[2]).toContain(
      "https://github.com/zekno-app/zekno/releases/download/runner-v0.1.1/zekno-runner-linux-x64.gz"
    )
    expect(calls[2]!.args[2]).toContain(`mv -f '${RUNNER}.part' '${RUNNER}'`)
    const setup = calls.find((call) => call.args.at(-1) === "setup")!
    expect(Object.keys(JSON.parse(setup.text!))).toEqual([
      "founding",
      "teamCode",
    ])
    const sessions = calls.filter((call) => call.args.at(-1) === "session")
    expect(sessions).toHaveLength(3)
    const composes = sessions.map((call) => {
      const request = JSON.parse(call.text!) as {
        command: string
        input: { rosters: unknown[]; envelope: Envelope; records: unknown[] }
      }
      expect(request.command).toBe("deploy")
      expect(request.input.rosters).toHaveLength(2)
      expect(request.input.records).toEqual([])
      return payloadOf(request.input.envelope).compose as string
    })
    expect(composes.map((text) => /context: "([^"]+)"/.exec(text)![1])).toEqual(
      [".", "https://zekno.invalid/repo.git", "../.."]
    )
    for (const call of calls.filter((item) => item.args.includes(RUNNER)))
      expect(call.args.slice(0, 2)).toEqual(["env", "-i"])
    expect(seen.split("; ")).toEqual([
      `runner 0.1.1 for linux-x64, SHA-256 as ee40f7d recorded, at ${RUNNER}, version {"version":"0.1.1","protocol":3}`,
      "set up for a team made in the run",
      'context .: start_failed, Compose built the image, Compose\'s last line "Error response from daemon: no command specified", images after: zekno.invalid/check-released-dot:1, containers after: zekno-check-released-dot-web-1 (zekno.invalid/check-released-dot:1, created), state: number 1 used',
      'context https://zekno.invalid/repo.git: start_failed, no image built, Compose\'s last line "failed to solve: zekno.invalid: no such host", images after: none new, containers after: none new, state: no number used',
      'context ../..: start_failed, Compose built the image, Compose\'s last line "Error response from daemon: no command specified", images after: zekno.invalid/check-released-parent:1, containers after: zekno-check-released-parent-web-1 (zekno.invalid/check-released-parent:1, created), state: number 1 used',
    ])
  })

  test("a SHA-256 that is not the recorded one stops with one line, before anything is placed", async () => {
    const { run, calls } = fakeStandIn((args) =>
      args[0] === "sh" && args[2]?.includes("curl ")
        ? { stdout: `${"a".repeat(64)}\n` }
        : undefined
    )
    const made: ReleasedMade = { started: false, cases: [] }
    await expect(observeReleased(run, made, deps)).rejects.toThrow(
      `L1 stopped: the runner 0.1.1 downloaded for linux-x64 has SHA-256 ${"a".repeat(64)}, not ${X64} as ee40f7d recorded`
    )
    expect(made).toEqual({ started: true, cases: [] })
    expect(calls).toHaveLength(2)
  })

  test("a failed download, a refused setup, and a recorded file it cannot read each stop with one line", async () => {
    const failed = fakeStandIn((args) =>
      args[0] === "sh" && args[2]?.includes("curl ")
        ? {
            code: 22,
            stderr: "curl: (22) The requested URL returned error: 404\n",
          }
        : undefined
    )
    await expect(
      observeReleased(failed.run, { started: false, cases: [] }, deps)
    ).rejects.toThrow(
      "L1 stopped: the download of https://github.com/zekno-app/zekno/releases/download/runner-v0.1.1/zekno-runner-linux-x64.gz failed: curl: (22) The requested URL returned error: 404"
    )
    const refused = fakeStandIn((args) =>
      args.at(-1) === "setup"
        ? {
            code: 1,
            stdout: '{"outcome":"refused","reason":"invalid_request"}\n',
          }
        : undefined
    )
    const made: ReleasedMade = { started: false, cases: [] }
    await expect(observeReleased(refused.run, made, deps)).rejects.toThrow(
      'L1 stopped: runner 0.1.1 refused setup: {"outcome":"refused","reason":"invalid_request"}'
    )
    expect(made.placed).toBe(X64)
    const unread = fakeStandIn()
    await expect(
      observeReleased(
        unread.run,
        { started: false, cases: [] },
        { recorded: () => "{}" }
      )
    ).rejects.toThrow(
      /^L1 stopped: .* records no SHA-256 of runner 0\.1\.1 for linux-x64$/
    )
    expect(unread.calls).toHaveLength(1)
  })
})

describe("cleanUpReleased", () => {
  test("removes each app's containers by project, its network and image, the records, the runner it placed, and its folder", async () => {
    const { run, calls } = fakeStandIn((args) => {
      if (args[1] === "ps" && args.includes("--filter"))
        return {
          stdout: args.some((arg) => arg.endsWith("released-dot"))
            ? "zekno-check-released-dot-web-1\n"
            : "",
        }
      if (
        args[1] === "network" &&
        args.at(-1) === "zekno-check-released-git_default"
      )
        return {
          code: 1,
          stderr:
            "Error response from daemon: network zekno-check-released-git_default not found\n",
        }
      if (args[0] === "sh" && args[2]?.startsWith("ls -1"))
        return { stdout: "abcdefghij123\n" }
      return undefined
    })
    const made: ReleasedMade = {
      started: true,
      placed: X64,
      cases: ["dot", "git"],
    }
    const said: string[] = []
    expect(await cleanUpReleased(run, made, (line) => said.push(line))).toEqual(
      []
    )
    const changes = calls
      .map((call) => call.args)
      .filter(
        (args) =>
          ["rm", "network", "image"].includes(args[1] ?? "") || args[0] === "rm"
      )
    expect(changes).toEqual([
      ["docker", "rm", "--force", "zekno-check-released-dot-web-1"],
      ["docker", "network", "rm", "zekno-check-released-dot_default"],
      ["docker", "network", "rm", "zekno-check-released-git_default"],
      ["docker", "image", "rm", "zekno.invalid/check-released-dot:1"],
      ["docker", "image", "rm", "zekno.invalid/check-released-git:1"],
      ["rm", "-rf", ROOT],
    ])
    expect(calls.find((call) => call.args.includes("history"))!.args).toContain(
      `BUILDX_CONFIG=${DOCKER_CONFIG}/buildx`
    )
    const restore = calls.find(
      (call) => call.args[0] === "sh" && call.args[2]?.includes("sha256sum")
    )!
    expect(restore.args[2]).toContain(`= ${X64} ]; then rm -f '${RUNNER}'`)
    expect(said).toEqual([])
  })

  test("after a stop before anything was placed: only the folder; what it cannot remove is said", async () => {
    const { run, calls } = fakeStandIn((args) =>
      args[0] === "rm" ? { code: 1, stderr: "rm: busy\n" } : undefined
    )
    expect(
      await cleanUpReleased(run, { started: true, cases: [] }, () => {})
    ).toEqual([`${ROOT} (rm: busy)`])
    expect(
      calls.some(
        (call) => call.args[0] === "sh" && call.args[2]?.includes("sha256sum")
      )
    ).toBe(false)
    const stuck = fakeStandIn((args) =>
      args[0] === "sh" && args[2]?.includes("sha256sum")
        ? {
            code: 1,
            stderr: `${RUNNER} is not runner 0.1.1; the runner kept aside is left\n`,
          }
        : undefined
    )
    expect(
      await cleanUpReleased(
        stuck.run,
        { started: false, placed: X64, cases: [] },
        () => {}
      )
    ).toEqual([
      `${RUNNER} (${RUNNER} is not runner 0.1.1; the runner kept aside is left)`,
    ])
  })
})

describe("gitRecorded", () => {
  test("outside a repository, stops with one line", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-no-repo-"))
    try {
      expect(() => gitRecorded(folder)).toThrow(
        /^L1 stopped: git show ee40f7d:apps\/cli\/src\/version\/runner-release\.json failed: [^\n]+$/
      )
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
