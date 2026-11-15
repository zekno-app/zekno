#!/usr/bin/env bun
/**
 * The test build of `zekno`, for the end-to-end tests: what src/main.ts does,
 * with test dependencies. The app opens through the real `loadStart`,
 * `detectBackground` and `openApp`, and a single command through the real
 * `run`. Only the outside world is replaced:
 *
 * - the key store is a file in the test's temporary folder, never the
 *   system keychain;
 * - a runner on this machine uses the stand-in Docker;
 * - SSH reaches only the stand-in server of test/support/stand-in-server.ts. Every
 *   process this build starts goes through `guardSpawn`, which sends `ssh`
 *   to the stand-in and refuses any other `ssh` (and every other network
 *   tool), so nothing typed into "add a server" can start a real one.
 *
 * Everything it needs comes from its environment, which the tests build
 * from an allow-list (world.ts). It refuses to start outside a test folder.
 */
import { appendFileSync } from "node:fs"
import { basename } from "node:path"

import { RUNNER_MAIN } from "../../../runner/test/support/helpers"
import { run } from "../../src/cli/cli"
import type { OpDeps } from "../../src/cli/context"
import { CliError } from "../../src/cli/errors"
import { RUNNER_RELEASE, type RunnerRelease } from "../../src/version/runner-release"
import { connect, type Target } from "../../src/server/transport"
import { processPlainUi, wantsPlain } from "../../src/ui/plain/plain"
import { fileKeyStore } from "./file-keystore"

/** Names of programs that reach the network. Only the stand-in `ssh` is ever started. */
const NETWORK_TOOLS = new Set(["ssh", "scp", "sftp", "slogin", "rsh", "telnet", "nc", "ncat", "curl", "wget"])

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`zekno-test: ${name} is not set. This build runs only inside the end-to-end tests.`)
    process.exit(70)
  }
  return value
}

const home = required("ZEKNO_HOME")
const testHome = required("HOME")
const keys = required("ZEKNO_E2E_KEYS")
const docker = required("ZEKNO_E2E_DOCKER")
const spawns = required("ZEKNO_E2E_SPAWNS")
const standInSsh = process.env.ZEKNO_E2E_SSH
const releaseSha = process.env.ZEKNO_E2E_RELEASE_SHA

// Never a real home or profile: both must be inside a test's temporary folder.
if (!testHome.includes("/zekno-e2e-") || !home.startsWith(`${testHome}/`)) {
  console.error("zekno-test: HOME and ZEKNO_HOME must be a test's temporary folders.")
  process.exit(70)
}

/** Notes each process this build starts, by program name only, for the tests to count. */
const note = (entry: Record<string, string>) => appendFileSync(spawns, `${JSON.stringify(entry)}\n`)

/**
 * Every process this build starts passes through here. `ssh` becomes the
 * stand-in, when the test has one; any other network tool, or `ssh` with no
 * stand-in, is refused before anything starts, which the transport reports
 * as a program that could not be started.
 */
function guardSpawn(): void {
  const spawn = Bun.spawn.bind(Bun) as (...args: unknown[]) => unknown
  const guarded = (...args: unknown[]) => {
    const argv = Array.isArray(args[0]) ? (args[0] as string[]) : ((args[0] as { cmd: string[] }).cmd ?? [])
    const program = argv[0] ?? ""
    const name = basename(program)
    if (standInSsh && program === standInSsh) {
      note({ program: name, ran: "stand-in" })
      return spawn(...args)
    }
    if (NETWORK_TOOLS.has(name)) {
      if (program === "ssh" && standInSsh && Array.isArray(args[0])) {
        note({ program: name, ran: "stand-in" })
        return spawn([standInSsh, ...argv.slice(1)], ...args.slice(1))
      }
      note({ program: name, ran: "refused" })
      throw new Error(`${name} is not started by the test build`)
    }
    note({ program: name, ran: "allowed" })
    return spawn(...args)
  }
  // Both are writable properties of `Bun`, as bun:test's spyOn relies on.
  const writable = Bun as unknown as Record<"spawn" | "spawnSync", unknown>
  writable.spawn = guarded
  writable.spawnSync = () => {
    note({ program: "spawnSync", ran: "refused" })
    throw new Error("the test build starts nothing synchronously")
  }
}

guardSpawn()

/**
 * How the test build reaches a runner: on this machine as the real build
 * does, over SSH only through the stand-in (guardSpawn), and with no stand-in
 * not at all.
 */
function testConnect(target: Target, localRunner: string[], options?: Parameters<typeof connect>[2]) {
  if (target.kind === "ssh" && !standInSsh) {
    note({ program: "ssh", ran: "refused" })
    throw new CliError(`This test has no SSH stand-in, so ${target.destination} cannot be reached.`)
  }
  return connect(target, localRunner, options)
}

/** The stand-in server's runner: the version this zekno carries, with the checksum of the file the stand-in serves. */
const release: RunnerRelease | undefined = releaseSha
  ? { version: RUNNER_RELEASE.version, files: { "linux-x64": { sha256: releaseSha }, "linux-arm64": { sha256: null } } }
  : undefined

const deps: OpDeps = {
  home,
  cwd: process.cwd(),
  keyStore: fileKeyStore(keys),
  connect: testConnect,
  localRunner: ["env", `ZEKNO_DOCKER=${docker}`, process.execPath, RUNNER_MAIN],
  ...(release ? { release } : {}),
}

const argv = process.argv.slice(2)

/** One command, as main.ts runs it: Ink at a terminal, plain lines when piped. */
async function command(): Promise<number> {
  const plain = wantsPlain(argv, process.stdout, process.stdin)
  const ui = plain ? processPlainUi() : (await import("../../src/ui/ink/ink")).inkUi()
  try {
    return await run(argv, { ...deps, ui })
  } finally {
    await ui.close()
  }
}

/** The full-screen app, as main.ts opens it: the profile verified, then the terminal asked, then the first frame. */
async function app(): Promise<number> {
  const { detectBackground } = await import("../../src/ui/terminal/background")
  const [{ loadStart }, { openApp }] = await Promise.all([import("../../src/app/effects/effects"), import("../../src/app/app")])
  const start = await loadStart(deps)
  const background = await detectBackground()
  try {
    return await openApp(deps, { start, background })
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    console.error(error.message)
    return 1
  }
}

const opensApp = argv.length === 0 && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
process.exit(opensApp ? await app() : await command())
