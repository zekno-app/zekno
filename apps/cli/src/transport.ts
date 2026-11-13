import { LIMITS, parseMessage, RunnerReportSchema, type RunnerReport } from "@workspace/core"
import type { z } from "zod"

import { CliError, RunnerRefused } from "./errors"

export const SSH_DESTINATION = /^[A-Za-z0-9][A-Za-z0-9._@:-]*$/
export const RUNNER_PATH = /^[A-Za-z0-9._/~-]+$/

/**
 * How to reach a runner: over SSH, or as a process on this machine. A local
 * target names only the runner's folder. The program that is started is
 * decided by the CLI itself, never read from a file.
 */
export type Target = { kind: "ssh"; destination: string; runnerPath: string } | { kind: "local"; home: string }

export type RunnerCommand = "setup" | "sync" | "apply" | "status"

/** Runs one runner command with one message on its standard input. */
export type Transport = (command: RunnerCommand, input?: string) => Promise<{ exitCode: number; stdout: string }>

/** Reads a stream to the end, or returns undefined once it is larger than `limit` bytes. */
async function readUpTo(stream: ReadableStream<Uint8Array>, limit: number): Promise<string | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

async function run(argv: string[], input: string | undefined, env?: Record<string, string | undefined>) {
  let child
  try {
    child = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "inherit", env })
  } catch {
    throw new CliError(`Could not start \`${argv[0]}\`. Is it installed and on your PATH?`)
  }
  try {
    if (input !== undefined) child.stdin.write(input)
    await child.stdin.end()
  } catch {
    // The other side closed early. Its answer, or the lack of one, says why.
  }
  // An answer is one short line. Whatever sends more than a message may hold is not a runner.
  const stdout = await readUpTo(child.stdout, LIMITS.messageBytes)
  if (stdout === undefined) {
    child.kill()
    throw new CliError("The runner sent more than an answer can hold. Check what is installed at that path.")
  }
  return { exitCode: await child.exited, stdout }
}

/**
 * Reaches a runner by running it. `localRunner` is the command that starts a
 * runner on this machine. An SSH destination and path are checked here as
 * well as when the server was added, because they are read back from a file.
 */
export function connect(target: Target, localRunner: string[]): Transport {
  if (target.kind === "local") {
    return (command, input) =>
      run([...localRunner, command], input, { ...process.env, ZEKNO_RUNNER_HOME: target.home })
  }
  if (!SSH_DESTINATION.test(target.destination) || !RUNNER_PATH.test(target.runnerPath)) {
    throw new CliError("The stored SSH destination or runner path is not valid.")
  }
  // `--` ends ssh's own options, and both values match strict patterns, so
  // neither can be read as an option or carry a shell command.
  return (command, input) => run(["ssh", "--", target.destination, `${target.runnerPath} ${command}`], input)
}

/**
 * Calls the runner and reads its one JSON line. A refusal becomes an error
 * with a plain explanation; anything else must match the expected message.
 */
export async function ask<Schema extends z.ZodType>(
  transport: Transport,
  command: RunnerCommand,
  schema: Schema,
  message?: unknown
): Promise<z.infer<Schema>> {
  const { stdout } = await transport(command, message === undefined ? undefined : JSON.stringify(message))
  const line = stdout.trim().split("\n").at(-1) ?? ""
  const report = parseMessage(RunnerReportSchema, line)
  if (report.ok && report.value.outcome === "refused") throw new RunnerRefused(report.value.reason!)
  const parsed = parseMessage(schema, line)
  if (!parsed.ok) {
    throw new CliError("The runner did not answer as expected. Check that it is installed and reachable.")
  }
  return parsed.value
}

export type { RunnerReport }
