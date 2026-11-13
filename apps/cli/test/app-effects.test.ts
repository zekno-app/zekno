import { describe, expect, spyOn, test } from "bun:test"
import { RunnerStatusSchema } from "@workspace/core"
import { writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { tempDir } from "../../runner/test/helpers"
import { createEffects, loadStart, NOT_BUILT, routeErrorLines, tilde } from "../src/app/effects"
import type { AppEvent } from "../src/app/state"
import { TAMPERED } from "../src/context"
import { memoryKeyStore } from "../src/keystore"
import { openSession } from "../src/session"
import { connect, type ConnectOptions, type Target } from "../src/transport"
import { machine, ready } from "./helpers"

/** A runner that only writes to standard error, with a colour code and a screen clear in it, then says it does not know `session`. */
const NOISY = ["sh", "-c", "printf 'Usage: zekno-runner \\033[31m<setup|sync|apply|status>\\033[0m\\n\\033[2Jagain' >&2; exit 2", "sh"]

describe("starting the app", () => {
  test("no profile is first run, and nothing is read from the keychain", async () => {
    const keyStore = memoryKeyStore()
    const get = spyOn(keyStore, "get")
    expect(await loadStart({ home: tempDir("empty"), keyStore })).toEqual({ kind: "no-team" })
    expect(get).not.toHaveBeenCalled()
  })

  test("a profile that verifies is the team, with its servers", async () => {
    const m = await ready()
    expect(await loadStart(m.deps)).toEqual({
      kind: "team",
      team: { member: "Ada", version: 2, servers: [{ name: "dev", destination: undefined, apps: [] }] },
    })
  })

  test("names read from the profile folder are cleaned before they are drawn", async () => {
    const m = await ready()
    // The member's name and a server's address are not signed: anything on this machine could change them.
    m.tamper("profile.json", (profile) => ({
      ...profile,
      memberName: "\x1b]52;c;aGVsbG8=\x07Ada\x1b[2J",
      servers: profile.servers.map((server: object) => ({
        ...server,
        target: { kind: "ssh", destination: "x\x1b]8;;https://evil\x07y", runnerPath: "zekno-runner" },
      })),
    }))
    const start = await loadStart(m.deps)
    expect(start).toEqual({ kind: "team", team: { member: "Ada", version: 2, servers: [{ name: "dev", destination: "xy", apps: [] }] } })
  })

  test("a profile changed by something other than zekno is the error screen, with the reason", async () => {
    const m = await ready()
    const other = machine()
    expect(await other.zekno("init", "--name", "Eve")).toBe(0)
    const theirs = JSON.parse(await Bun.file(join(other.home, "profile.json")).text())
    m.tamper("profile.json", (profile) => ({ ...profile, rosters: theirs.rosters }))
    const start = await loadStart(m.deps)
    expect(start).toEqual({
      kind: "profile-error",
      reason: "The team list in the profile is not the one this machine's key belongs to.",
      folder: tilde(m.home),
    })
    // The screen says in its own words that the folder may have been changed.
    expect(start.kind === "profile-error" && start.reason).not.toContain(TAMPERED)
  })

  test("a profile whose key is not in the keychain, or that cannot be read, is the error screen", async () => {
    const m = await ready()
    expect(await loadStart({ home: m.home, keyStore: memoryKeyStore() })).toMatchObject({
      kind: "profile-error",
      reason: "The signing key is not in the system keychain on this machine.",
    })
    writeFileSync(join(m.home, "profile.json"), "{ not json")
    const damaged = await loadStart(m.deps)
    expect(damaged).toMatchObject({ kind: "profile-error" })
    expect(damaged.kind === "profile-error" && damaged.reason).toContain("is not readable")
  })

  test("a keychain that refuses is the error screen with its reason", async () => {
    const m = await ready()
    const keyStore = { ...memoryKeyStore(), get: async () => Promise.reject(new Error("denied")) }
    expect(await loadStart({ home: m.home, keyStore })).toMatchObject({
      kind: "profile-error",
      reason: "The system keychain could not be read. The signing key is kept nowhere else.",
    })
  })

  test("a path under the home folder is shown from ~", () => {
    expect(tilde(join(homedir(), ".zekno"))).toBe("~/.zekno")
    expect(tilde(homedir())).toBe("~")
    expect(tilde("/var/lib/zekno")).toBe("/var/lib/zekno")
    expect(tilde("/home/adam/x", "/home/ada")).toBe("/home/adam/x")
  })
})

describe("what runners write on standard error, while the app is on screen", () => {
  test("goes to the callback, cleaned, and never to the terminal", async () => {
    const lines: string[] = []
    const write = spyOn(process.stderr, "write")
    try {
      const transport = connect({ kind: "local", home: tempDir("runner") }, NOISY, { errorLines: (line) => lines.push(line) })
      expect((await transport.run("status")).exitCode).toBe(2)
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
    expect(lines).toEqual(["Usage: zekno-runner <setup|sync|apply|status>", "again"])
  })

  test("a single command still writes it to standard error, cleaned, as before", async () => {
    const written: string[] = []
    const write = spyOn(process.stderr, "write").mockImplementation((text) => {
      written.push(String(text))
      return true
    })
    try {
      await connect({ kind: "local", home: tempDir("runner") }, NOISY).run("status")
    } finally {
      write.mockRestore()
    }
    expect(written).toEqual(["Usage: zekno-runner <setup|sync|apply|status>\n", "again\n"])
  })

  test("the app's operations send it as events, also from a session", async () => {
    const events: AppEvent[] = []
    const effects = createEffects(machine().deps, (event) => events.push(event), (error) => {
      throw error
    })
    const write = spyOn(process.stderr, "write")
    try {
      const session = await openSession(effects.deps.connect({ kind: "local", home: tempDir("runner") }, NOISY))
      expect(session.mode).toBe("one-shot")
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
    expect(events).toEqual([
      { type: "runner-line", line: "Usage: zekno-runner <setup|sync|apply|status>" },
      { type: "runner-line", line: "again" },
    ])
  })

  test("other options are kept when the callback is added", async () => {
    const seen: unknown[] = []
    const recording = { ...machine().deps, connect: (target: Target, runner: string[], options?: ConnectOptions) => (seen.push(options), connect(target, runner, options)) }
    const deps = routeErrorLines(recording, () => {})
    deps.connect({ kind: "local", home: tempDir("runner") }, NOISY)
    expect(seen).toHaveLength(1)
    expect(typeof (seen[0] as { errorLines?: unknown }).errorLines).toBe("function")
  })

  test("a real runner over the app's operations answers as usual", async () => {
    const m = await ready()
    const effects = createEffects(m.deps, () => {}, (error) => {
      throw error
    })
    const session = await openSession(effects.deps.connect({ kind: "local", home: m.runnerHome }, m.deps.localRunner))
    expect((await session.request("status", RunnerStatusSchema)).team.version).toBe(2)
    expect(await session.close()).toBe(0)
  })
})

describe("effects", () => {
  test("one that a later part builds says so as a line; exit is left to the shell", async () => {
    const events: AppEvent[] = []
    const effects = createEffects(machine().deps, (event) => events.push(event), (error) => {
      throw error
    })
    effects.run({ kind: "exit" })
    effects.run({ kind: "deploy", server: "prod", app: "demo" })
    await Bun.sleep(10)
    expect(events).toEqual([{ type: "notice", notice: { tone: "info", text: NOT_BUILT } }])
  })
})
