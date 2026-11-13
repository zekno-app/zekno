#!/usr/bin/env bun
/**
 * zekno-runner: runs on your server. Each run does one thing: it reads one
 * JSON message from standard input (none for `status`), prints one JSON line
 * and exits. It opens no network port and never prompts.
 *
 * Exit status: 0 when the work was done, 1 when it was refused or the app
 * did not start, 2 for wrong usage.
 */
import { LIMITS } from "@workspace/core"

import { apply, setup, status, sync } from "./commands"
import { homeDir } from "./home"

const USAGE = "Usage: zekno-runner <setup|sync|apply|status>\nReads one JSON message from standard input and prints one JSON line."

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

async function main(): Promise<number> {
  const command = process.argv[2]
  if (!command || !["setup", "sync", "apply", "status"].includes(command) || process.argv.length > 3) {
    console.error(USAGE)
    return 2
  }
  const dir = homeDir()
  let result: object
  if (command === "status") {
    result = status(dir)
  } else {
    const input = await readInput()
    if (input === undefined) result = { outcome: "refused", reason: "invalid_request" }
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
