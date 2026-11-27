/**
 * `zekno logs --build [--app <app>] [--server <name>]`
 * (specs/016-build-from-source, contracts/cli.md CL9; FR-071a; tasks T135):
 * the saved output of the app's last build from this machine, as plain
 * lines on standard output (E16), each cleaned as it is printed while the
 * file keeps the raw text; nothing saved: E17 on standard error, exit status
 * 1. No keychain and no server are used; `--server` chooses among the
 * servers that hold an app of that name. Each test has a profile folder of
 * its own, never `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { run } from "../../src/cli/cli"
import type { Deps } from "../../src/cli/context"
import { MISSING_APP } from "../../src/cli/errors"
import { exitStatusOf, lineText } from "../../src/shared/build-lines"
import { lastBuildOutput } from "../../src/ops/logs-build"
import {
  readBuildOutput,
  startBuildOutput,
} from "../../src/profile/build-output"
import { accept, sha256Of } from "../../src/project/accepted"
import { PROJECT_FILE, projectFileIn } from "../../src/project/file"
import { sanitize } from "../../src/server/sanitize"
import { plainUi } from "../../src/ui/plain/plain"
import { signingTeam } from "../support/signing-team"

const OSC52 = "\u001b]52;c;ZXZpbA==\u0007"
const STAGING = `srv_${"b".repeat(32)}`

/** A team of one with servers dev and staging, and nothing that reaches a keychain or a server. */
async function profileOfTwo() {
  const t = await signingTeam()
  const staging = { ...t.server, name: "staging", serverId: STAGING }
  t.team.store.save({
    ...t.team.profile,
    servers: [t.server, staging],
  })
  const cwd = mkdtempSync(join(tmpdir(), "zekno-logs-build-"))
  const out: string[] = []
  const err: string[] = []
  const reached: string[] = []
  const deps: Deps = {
    home: t.home,
    cwd,
    keyStore: {
      get: async () => {
        reached.push("keychain")
        return null
      },
      set: async () => void reached.push("keychain"),
      delete: async () => void reached.push("keychain"),
    } as unknown as Deps["keyStore"],
    connect: () => {
      reached.push("server")
      throw new Error("no server is reached")
    },
    ui: plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ),
    localRunner: ["false"],
  }
  /** Saves the output of one deploy of `app`, as a deploy at a terminal does. */
  const saved = (
    serverId: string,
    app: string,
    deploy: number,
    at: string,
    lines: string[]
  ) => {
    const output = startBuildOutput(t.home, serverId, app, {
      deploy,
      server: serverId === STAGING ? "staging" : "dev",
      at,
    })
    for (const line of lines) output.line(line)
    output.end()
  }
  return {
    t,
    cwd,
    out,
    err,
    reached,
    deps,
    saved,
    zekno: (...args: string[]) => run(args, deps),
  }
}

describe("zekno logs --build", () => {
  test("prints each saved line on standard output, cleaned; the file keeps the raw text; no keychain, no server", async () => {
    const p = await profileOfTwo()
    const raw = `#5 RUN echo ${OSC52}done`
    p.saved(p.t.server.serverId, "shop", 4, "2026-11-28T10:00:00.000Z", [
      "#1 [internal] load build definition",
      raw,
    ])
    expect(await p.zekno("logs", "--build", "--app", "shop")).toBe(0)
    expect(p.out).toEqual([
      "#1 [internal] load build definition",
      sanitize(raw),
    ])
    expect(p.out.join("\n")).not.toContain("\u001b]52")
    expect(p.err).toEqual([])
    expect(p.reached).toEqual([])
    expect(
      readBuildOutput(p.t.home, p.t.server.serverId, "shop")?.lines[1]
    ).toBe(raw)
  })

  test("the same app on two servers: --server chooses; without it, the latest build from this machine", async () => {
    const p = await profileOfTwo()
    p.saved(p.t.server.serverId, "shop", 9, "2026-11-28T10:00:00.000Z", [
      "on dev",
    ])
    p.saved(STAGING, "shop", 2, "2026-11-28T11:00:00.000Z", ["on staging"])
    expect(
      await p.zekno("logs", "--build", "--app", "shop", "--server", "dev")
    ).toBe(0)
    expect(p.out.splice(0)).toEqual(["on dev"])
    expect(
      await p.zekno("logs", "--build", "--app", "shop", "--server", "staging")
    ).toBe(0)
    expect(p.out.splice(0)).toEqual(["on staging"])
    expect(await p.zekno("logs", "--build", "--app", "shop")).toBe(0)
    expect(p.out.splice(0)).toEqual(["on staging"])
    expect(p.reached).toEqual([])
  })

  test("nothing saved: E17 on standard error, exit status 1, nothing on standard output", async () => {
    const p = await profileOfTwo()
    expect(exitStatusOf("E17")).toBe(1)
    const e17 = lineText({ id: "E17", app: "shop" })
    expect(await p.zekno("logs", "--build", "--app", "shop")).toBe(1)
    expect(p.err).toEqual([e17])
    // Saved for another app, or on another server than the one named: still E17 for this one.
    p.saved(STAGING, "shop", 2, "2026-11-28T11:00:00.000Z", ["on staging"])
    p.saved(p.t.server.serverId, "blog", 1, "2026-11-28T11:00:00.000Z", ["x"])
    expect(
      await p.zekno("logs", "--build", "--app", "shop", "--server", "dev")
    ).toBe(1)
    expect(p.err.at(-1)).toBe(e17)
    expect(p.out).toEqual([])
    expect(p.reached).toEqual([])
  })

  test("a server the profile does not hold: today's sentence for it, exit status 1", async () => {
    const p = await profileOfTwo()
    expect(
      await p.zekno("logs", "--build", "--app", "shop", "--server", "prod")
    ).toBe(1)
    expect(() =>
      lastBuildOutput(p.deps, { app: "shop", server: "prod" })
    ).toThrow(p.err[0]!)
  })

  test("the app from the zekno.json here, once this machine accepted it; else today's sentence asking for `--app`, exit status 2", async () => {
    const p = await profileOfTwo()
    p.saved(p.t.server.serverId, "shop", 4, "2026-11-28T10:00:00.000Z", [
      "from the link",
    ])
    expect(await p.zekno("logs", "--build")).toBe(2)
    expect(p.err[0]).toStartWith(MISSING_APP)
    const text = `${JSON.stringify({ app: "shop", server: "dev" })}\n`
    const path = join(p.cwd, PROJECT_FILE)
    writeFileSync(path, text)
    // Not accepted on this machine: not used.
    expect(await p.zekno("logs", "--build")).toBe(2)
    accept(p.t.home, { path: projectFileIn(p.cwd), sha256: sha256Of(text) })
    expect(await p.zekno("logs", "--build")).toBe(0)
    expect(p.out).toEqual(["from the link"])
    expect(p.reached).toEqual([])
  })
})
