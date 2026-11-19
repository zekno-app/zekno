#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { run } from "./cli/cli"
import type { OpDeps } from "./cli/context"
import { CliError } from "./cli/errors"
import { resolveDomain } from "./domains/dns"
import { probeHttps } from "./domains/https"
import { sshHostOf } from "./domains/server-address"
import { osKeychain } from "./profile/keystore"
import { connect } from "./server/transport"
import { processPlainUi, wantsPlain } from "./ui/plain/plain"

const argv = process.argv.slice(2)

// From a source checkout, `--local` uses the runner next door. Installed, it uses the one on PATH.
const sibling = join(import.meta.dir, "../../runner/src/main.ts")
const localRunner = existsSync(sibling)
  ? [process.execPath, sibling]
  : ["zekno-runner"]

const deps: OpDeps = {
  home: process.env.ZEKNO_HOME || join(homedir(), ".zekno"),
  cwd: process.cwd(),
  keyStore: osKeychain(),
  connect,
  localRunner,
  // The one way to the network that zekno itself has: only `zekno version` and `zekno doctor` use it (version/newest.ts).
  fetch: (input, init) => fetch(input, init),
  // The three effects of domains (specs/015-domains-https, contracts/cli.md, CL5): set here and nowhere else.
  resolveDomain,
  probeHttps,
  sshHost: sshHostOf({ resolveDomain }),
}

/**
 * Ink turns on React's developer tooling when DEV=true, which can hand a
 * component's state to a listener on this machine. A hidden prompt has no
 * business near that, so Ink never sees the variable: it is removed before
 * Ink is loaded and put back once Ink has started, because programs started
 * from here inherit the environment.
 */
async function withoutDev<T>(work: () => Promise<T>): Promise<T> {
  const dev = process.env.DEV
  delete process.env.DEV
  try {
    return await work()
  } finally {
    if (dev !== undefined) process.env.DEV = dev
  }
}

/** One command: an operation plus the interface, Ink at a terminal or plain lines. */
async function command(): Promise<number> {
  // Piped either way, in a script or with `--json` it is plain lines, so output stays stable for whatever reads it.
  const plain = wantsPlain(argv, process.stdout, process.stdin)
  const ui = plain
    ? processPlainUi()
    : await withoutDev(async () => (await import("./ui/ink/ink")).inkUi())
  try {
    return await run(argv, { ...deps, ui })
  } finally {
    await ui.close()
  }
}

/**
 * The full-screen app. The profile is verified and the terminal is asked for
 * its background colour before anything is drawn; neither reaches a server.
 *
 * The terminal is asked last, just before the first frame: reading its
 * answer takes whatever was typed before it, such as a `y` typed while the
 * keychain was asking, and throws it away with the answer (background.ts).
 * Such a key never reaches the app, so it can never answer a question the
 * app opens with ("Use it here?").
 */
async function app(): Promise<number> {
  const { detectBackground } = await import("./ui/terminal/background")
  let closed: Promise<number> | undefined
  await withoutDev(async () => {
    const [{ loadStart }, { openApp }] = await Promise.all([
      import("./app/effects/profile"),
      import("./app/app"),
    ])
    const start = await loadStart(deps)
    const background = await detectBackground()
    closed = openApp(deps, { start, background })
  })
  try {
    return await closed!
  } catch (error) {
    // The terminal has been restored by now, so this is read on the normal screen.
    if (!(error instanceof CliError)) throw error
    console.error(error.message)
    return 1
  }
}

// `zekno` alone at a terminal opens the app. Anywhere else, alone, it prints the help as before.
const opensApp =
  argv.length === 0 &&
  Boolean(process.stdin.isTTY) &&
  Boolean(process.stdout.isTTY) &&
  process.env.TERM !== "dumb"
process.exit(opensApp ? await app() : await command())
