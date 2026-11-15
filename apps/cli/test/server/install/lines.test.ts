/** What the installer's script prints, read strictly (src/server/install/lines.ts). */
import { describe, expect, test } from "bun:test"

import type { InstallRequest } from "../../../src/server/install/checks"
import { followsOrder, parseInstallLine, type InstallEvent } from "../../../src/server/install/lines"
import { RUNNER_RELEASE } from "../../../src/version/runner-release"

const VERSION = RUNNER_RELEASE.version

const release = (files: InstallRequest["source"]): InstallRequest => ({ mode: "add", version: VERSION, source: files })

/** What a fresh install says, step by step. */
const freshInstall = (bytes: number, place = "user") => [
  "connected",
  "docker ok 2.40.3",
  "runner none",
  "platform ok x64",
  `download ok ${bytes}`,
  "checksum ok",
  "install ok",
  "version ok",
  "folder ok",
  `done ${place}`,
]

describe("what the script prints is read strictly", () => {
  test("each of its lines, and nothing else", () => {
    expect(parseInstallLine("connected")).toEqual({ kind: "connected" })
    expect(parseInstallLine("docker ok 2.40.3")).toEqual({ kind: "docker", version: "2.40.3" })
    expect(parseInstallLine("docker ok v5.6.0")).toEqual({ kind: "docker", version: "5.6.0" })
    expect(parseInstallLine("docker ok unknown")).toEqual({ kind: "docker" })
    expect(parseInstallLine("runner found user 0.1.0")).toEqual({ kind: "runner", place: "user", version: "0.1.0" })
    expect(parseInstallLine("runner found path unknown")).toEqual({ kind: "runner", place: "path" })
    expect(parseInstallLine("runner found user 0.1.0-dev.1")).toEqual({ kind: "runner", place: "user", version: "0.1.0-dev.1" })
    expect(parseInstallLine("download ok 27000000")).toEqual({ kind: "download", bytes: 27_000_000 })
    expect(parseInstallLine("done system")).toEqual({ kind: "done", place: "system" })
    expect(parseInstallLine("fail checksum")).toEqual({ kind: "fail", reason: "checksum" })
    for (const line of [
      "",
      "connected ",
      " connected",
      "docker ok $(id)",
      "docker ok \u001b[2J",
      "runner found /usr/bin 0.1.0",
      "runner found user 0.1",
      "runner found user 0.1.0-dev.0",
      "runner found user 01.1.0",
      "runner found user 0.1.0-rc.1",
      "runner found user 0.1.0 ",
      "download ok 0",
      "download ok -1",
      "done /tmp/x",
      "fail nope",
      "fail constructor",
      "constructor",
      "toString",
      "Server code: AAAA-BBBB",
      `docker ok ${"1".repeat(40)}`,
    ]) {
      expect({ line, event: parseInstallLine(line) }).toEqual({ line, event: undefined })
    }
  })

  test("in the script's order, each step once, an install only after a matching checksum", () => {
    const add = release({ kind: "release", files: [] })
    const read = (lines: string[], request: InstallRequest = add) => {
      const seen: InstallEvent[] = []
      for (const line of lines) {
        const event = parseInstallLine(line)
        if (!event || !followsOrder(seen, event, request)) return false
        seen.push(event)
      }
      return true
    }
    expect(read(freshInstall(10))).toBe(true)
    expect(read(["connected", "docker ok 1.0.0", "runner found path 0.1.0", "folder ok", "done path"])).toBe(true)
    expect(read(["connected", "fail docker"])).toBe(true)
    expect(read(["docker ok 1.0.0"])).toBe(false)
    expect(read(["fail docker"])).toBe(false)
    expect(read(["connected", "connected"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner none", "install ok"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner none", "folder ok", "done user"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner none", "platform ok x64", "ready"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner found target 0.1.0"])).toBe(false)
    const update: InstallRequest = { mode: "update", version: VERSION, runnerPath: "zekno-runner", source: { kind: "release", files: [] } }
    expect(read(["connected", "docker ok 1.0.0", "runner found target 0.1.0"], update)).toBe(true)
    expect(read(["connected", "docker ok 1.0.0", "runner none"], update)).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", `runner found target ${VERSION}`, "version ok", "folder ok", "done user"], update)).toBe(false)
  })
})
