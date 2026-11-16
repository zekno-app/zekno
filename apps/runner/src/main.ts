#!/usr/bin/env bun
/**
 * zekno-runner: runs on your server. Each run does one thing: it reads one
 * JSON message from standard input (none for `status` and `version`), prints
 * one JSON line and exits. `session` does the same for several requests over
 * one connection. It opens no network port and never prompts.
 *
 * Exit status: 0 when the work was done, 1 when it was refused or the app
 * did not start, 2 for wrong usage. For `session`: 0 when its input closed,
 * 1 when it stopped because lines were not requests it could read, or
 * because requests arrived far faster than they were answered.
 */
import { LIMITS } from "@workspace/core"

import { apply, refused, setup, status, sync } from "./commands/commands"
import { homeDir } from "./home/home"
import { runSession, stdoutSink, version } from "./session/session"

const COMMANDS = ["setup", "sync", "apply", "status", "version", "session"]
const USAGE = `Usage: zekno-runner <${COMMANDS.join("|")}>\nReads one JSON message from standard input and prints one JSON line.\n\`session\` reads one request per line and answers each, until its input closes.`

/** How long the last frames of a session may take to leave once it is over. */
const FLUSH_MS = 5000

async function readInput(): Promise<string | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of Bun.stdin.stream()) {
    size += chunk.length
    if (size > LIMITS.messageBytes) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** Runs a session on standard input and output. */
async function session(dir: string): Promise<number> {
  const sink = stdoutSink()
  let code: number
  try {
    code = await runSession(dir, Bun.stdin.stream(), sink)
  } catch {
    // Details stay out of the output: they could describe the server's files.
    console.error("zekno-runner stopped because of an unexpected error.")
    sink.write({ result: refused("invalid_state") })
    code = 1
  }
  // Answers still on their way are let out first; a reader that stopped reading is not waited for long.
  await Promise.race([sink.drained(), Bun.sleep(FLUSH_MS)])
  return code
}

async function main(): Promise<number> {
  const command = process.argv[2]
  if (!command || !COMMANDS.includes(command) || process.argv.length > 3) {
    console.error(USAGE)
    return 2
  }
  const dir = homeDir()
  if (command === "session") return session(dir)
  let result: object
  if (command === "version") {
    result = version()
  } else if (command === "status") {
    result = status(dir)
  } else {
    const input = await readInput()
    if (input === undefined)
      result = { outcome: "refused", reason: "invalid_request" }
    else if (command === "setup") result = setup(dir, input)
    else if (command === "sync") result = await sync(dir, input)
    else result = await apply(dir, input)
  }
  console.log(JSON.stringify(result))
  const outcome = (result as { outcome?: string }).outcome
  return outcome === "refused" || outcome === "start_failed" ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  () => {
    // Details stay out of the output: they could describe the server's files.
    console.error("zekno-runner stopped because of an unexpected error.")
    console.log(JSON.stringify({ outcome: "refused", reason: "invalid_state" }))
    process.exit(1)
  }
)
