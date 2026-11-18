/**
 * The runner opens no network port and makes no connection of its own
 * (specs/014-deploy-v2, FR-043, SC-010; research R26). Two ways to see it:
 * the code of the runner and of the core library names no way to reach the
 * network, and a running runner, in the middle of a deploy, holds no
 * internet socket.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { buildDeployV2 } from "../support/deploy-v2"
import { session, waitFor, world } from "../support/helpers"

const ROOT = resolve(import.meta.dir, "../../../..")
const FOLDERS = ["apps/runner/src", "packages/core/src"]

/** Names that would listen or connect, looked for in code with its comments and types taken out. */
const NAMES: readonly RegExp[] = [
  /\bBun\.serve\b/,
  /\bBun\.listen\b/,
  /\bBun\.connect\b/,
  /\bBun\.udpSocket\b/,
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
]
/** Modules that reach the network, with or without `node:` before them. */
const MODULES = new Set(["net", "http", "https", "http2", "dgram", "tls"])

/** Every .ts file of the folders, relative to the repository. */
const sources = FOLDERS.flatMap((folder) =>
  readdirSync(join(ROOT, folder), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => join(folder, path))
)

/** What `code` names of `NAMES` and `MODULES`, read without its comments and types. */
function networkNamesIn(code: string): string[] {
  // A first line `#!` (main.ts) is for the shell; the parser does not take it.
  const source = code.replace(/^#!.*/, "")
  const transpiler = new Bun.Transpiler({ loader: "ts" })
  const text = transpiler.transformSync(source)
  const found = NAMES.filter((name) => name.test(text)).map(
    (name) => name.source
  )
  for (const { path } of transpiler.scanImports(source))
    if (MODULES.has(path.replace(/^node:/, ""))) found.push(`imports ${path}`)
  for (const loaded of text.matchAll(
    /\b(?:require|import)\s*\(\s*["']([^"']+)["']/g
  ))
    if (MODULES.has(loaded[1]!.replace(/^node:/, "")))
      found.push(`loads ${loaded[1]}`)
  return found
}

describe("the code names no way to reach the network", () => {
  test("the reading finds each name, and not in a comment", () => {
    const sample = [
      "#!/usr/bin/env bun",
      'import { connect } from "node:net"',
      'import * as http from "http"',
      "// Bun.serve in a comment is not code",
      'export const a = () => [connect, http, Bun.listen, Bun.connect, Bun.udpSocket, fetch("x"), WebSocket]',
      'export const b = () => import("node:tls")',
    ].join("\n")
    expect(networkNamesIn(sample).sort()).toEqual(
      [
        "\\bBun\\.listen\\b",
        "\\bBun\\.connect\\b",
        "\\bBun\\.udpSocket\\b",
        "\\bfetch\\s*\\(",
        "\\bWebSocket\\b",
        "imports node:net",
        "imports http",
        "imports node:tls",
        "loads node:tls",
      ].sort()
    )
  })

  test("there is code to read", () => {
    expect(sources).toContain("apps/runner/src/commands/deploy.ts")
    expect(sources).toContain("packages/core/src/deploy/deploy-v2.ts")
  })

  test("no file of the runner or the core library names a listener, a connection or a network module", () => {
    const found = sources.flatMap((path) =>
      networkNamesIn(readFileSync(join(ROOT, path), "utf8")).map(
        (name) => `${path}: ${name}`
      )
    )
    expect(found).toEqual([])
  })
})

const LSOF = Bun.which("lsof")
if (!LSOF)
  console.log(
    "Skipping the check of open sockets: lsof is not on PATH, so a running runner's sockets cannot be listed."
  )

describe("a running runner holds no internet socket", () => {
  test.skipIf(!LSOF)(
    "while a deploy is held in Docker's `up`, lsof lists no internet socket of the runner",
    async () => {
      const w = await world()
      w.docker.holdUp()
      const s = session(w.home, w.docker.path)
      try {
        const built = await buildDeployV2({
          trust: w.trust,
          serverId: w.serverId,
          signer: w.signer,
          previous: 0,
        })
        s.send({
          command: "deploy",
          input: { rosters: w.rosters, ...built },
        })
        await waitFor(w.docker.upStarted, "docker compose up to start")
        const listed = Bun.spawnSync(
          [LSOF!, "-nP", "-a", "-i", "-p", String(s.child.pid)],
          { stdout: "pipe", stderr: "pipe" }
        )
        expect(listed.stdout.toString()).toBe("")
        // The runner is the process asked about: lsof finds its open files when not limited to sockets.
        const files = Bun.spawnSync(
          [LSOF!, "-nP", "-a", "-p", String(s.child.pid)],
          { stdout: "pipe", stderr: "pipe" }
        )
        expect(files.stdout.toString()).toContain(String(s.child.pid))
      } finally {
        w.docker.releaseUp()
        await s.close()
      }
      expect(s.frames.at(-1)).toEqual({
        result: { outcome: "started", app: "web", sequence: 1 },
      })
    },
    20_000
  )
})
