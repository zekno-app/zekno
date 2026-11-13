#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { run } from "./cli"
import { osKeychain } from "./keystore"
import { connect } from "./transport"
import { plainUi } from "./ui/plain"

const argv = process.argv.slice(2)

// From a source checkout, `--local` uses the runner next door. Installed, it uses the one on PATH.
const sibling = join(import.meta.dir, "../../runner/src/main.ts")
const localRunner = existsSync(sibling) ? [process.execPath, sibling] : ["zekno-runner"]

// At a terminal the interface is drawn with Ink. Piped, in a script or with
// `--json` it is plain lines, so output stays stable for whatever reads it.
const plain = argv.includes("--json") || !process.stdout.isTTY || process.env.TERM === "dumb"
const ui = plain
  ? plainUi(
      (line) => console.log(line),
      (line) => console.error(line)
    )
  : await terminalUi()

/**
 * Ink turns on React's developer tooling when DEV=true, which can hand a
 * component's state to a listener on this machine. A hidden prompt has no
 * business near that, so Ink never sees the variable. It is put back
 * afterwards, because programs started from here inherit the environment.
 */
async function terminalUi() {
  const dev = process.env.DEV
  delete process.env.DEV
  try {
    return (await import("./ui/ink")).inkUi()
  } finally {
    if (dev !== undefined) process.env.DEV = dev
  }
}

let code: number
try {
  code = await run(argv, {
    home: process.env.ZEKNO_HOME || join(homedir(), ".zekno"),
    cwd: process.cwd(),
    keyStore: osKeychain(),
    connect,
    ui,
    localRunner,
  })
} finally {
  await ui.close()
}
process.exit(code)
