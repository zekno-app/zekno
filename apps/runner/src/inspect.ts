/**
 * Read-only views of what Docker is doing for the apps this runner started.
 * Nothing here changes anything or takes the lock, and nothing here touches a
 * secret: the Docker commands are started with the runner's own environment
 * only.
 */
import {
  LIMITS,
  parseMessage,
  RunnerLogsRequestSchema,
  SERVICE_HEALTH,
  SERVICE_NAME,
  SERVICE_STATES,
  type LogEvent,
  type RunnerAppStates,
  type RunnerReport,
  type RunnerState,
} from "@workspace/core"

import { isReport, load, refused } from "./commands"
import { dockerCommand, dockerEnv, readLines } from "./compose"

type Service = RunnerAppStates["apps"][string]["services"][number]

/** The longest log line an event may carry. */
const LOG_LINE = 16384
/** The most services one app may report. */
const MAX_SERVICES = 256
/** How long Docker's log command has to stop before it is killed outright. */
const STOP_GRACE_MS = 2000

/** The apps this runner has accepted a deploy for. Names come from its own state, never from a request. */
const deployedApps = (state: RunnerState): string[] =>
  Object.entries(state.lastSequence)
    .filter(([, sequence]) => sequence > 0)
    .map(([app]) => app)

/** Reduces one row of `docker compose ps --format json` to what the CLI may see. */
function toService(value: unknown): Service | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const row = value as Record<string, unknown>
  const service = typeof row.Service === "string" ? row.Service : ""
  if (!SERVICE_NAME.test(service)) return undefined
  const state = String(row.State ?? "").toLowerCase()
  const health = String(row.Health ?? "").toLowerCase()
  const exitCode = Number(row.ExitCode)
  return {
    service,
    state: (SERVICE_STATES as readonly string[]).includes(state) ? (state as Service["state"]) : "unknown",
    exitCode: Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : 0,
    health: (SERVICE_HEALTH as readonly string[]).includes(health) ? (health as Service["health"]) : "",
  }
}

/**
 * Docker prints one JSON object per line, or in older versions one array.
 * Only the service name, state, exit code and health are kept: labels,
 * commands, container names and host paths are dropped here, on the server.
 */
export function parsePs(output: string): Service[] {
  const services: Service[] = []
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue
    let json: unknown
    try {
      json = JSON.parse(line)
    } catch {
      continue
    }
    for (const row of Array.isArray(json) ? json : [json]) {
      const service = toService(row)
      if (service && services.length < MAX_SERVICES) services.push(service)
    }
  }
  return services
}

/** Runs one Docker command and returns what it printed, or undefined when it failed or printed too much. */
async function dockerOutput(args: string[]): Promise<string | undefined> {
  try {
    const child = Bun.spawn([dockerCommand(), ...args], { env: dockerEnv(), stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of child.stdout) {
      size += chunk.length
      if (size > LIMITS.messageBytes) {
        child.kill()
        return undefined
      }
      chunks.push(chunk)
    }
    return (await child.exited) === 0 ? Buffer.concat(chunks).toString("utf8") : undefined
  } catch {
    return undefined
  }
}

/**
 * What is running for each app this runner has accepted a deploy for. An app
 * Docker could not be asked about is left out of the answer: its state is not
 * known, which is not the same as stopped.
 */
export async function appStates(dir: string): Promise<RunnerAppStates | RunnerReport> {
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const apps: RunnerAppStates["apps"] = {}
  for (const app of deployedApps(loaded.state)) {
    const output = await dockerOutput(["compose", "-p", `zekno-${app}`, "ps", "--all", "--format", "json"])
    if (output !== undefined) apps[app] = { services: parsePs(output) }
  }
  return { apps }
}

const LOG_PREFIX = /^(\S+?)\s*\|\s?(.*)$/s
const LOG_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))\s?(.*)$/s

/** Turns one line of `docker compose logs --timestamps` into an event, or nothing when it is not a log line. */
export function parseLogLine(line: string, now: () => Date = () => new Date()): LogEvent | undefined {
  const prefixed = LOG_PREFIX.exec(line)
  if (!prefixed) return undefined
  // "web-1" is the first container of the service "web".
  const service = prefixed[1]!.replace(/-\d+$/, "")
  if (!SERVICE_NAME.test(service)) return undefined
  const timed = LOG_TIME.exec(prefixed[2]!)
  return {
    event: "log",
    service,
    time: timed ? timed[1]! : now().toISOString(),
    line: (timed ? timed[2]! : prefixed[2]!).slice(0, LOG_LINE),
  }
}

/** Stops a Docker command: asked first, then killed when it does not stop in time. */
async function stopChild(child: Bun.Subprocess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  const stopped = await Promise.race([child.exited.then(() => true), Bun.sleep(STOP_GRACE_MS).then(() => false)])
  if (!stopped) child.kill("SIGKILL")
}

/**
 * Follows the logs of one app until Docker's log command ends or `stop` is
 * signalled, then stops that command. Only an app this runner has accepted
 * a deploy for can be followed, and its name is checked before Docker sees it.
 * `onEvent` may return a promise to slow the reading down.
 */
export async function followLogs(
  dir: string,
  input: string,
  onEvent: (event: LogEvent) => void | Promise<void>,
  stop: AbortSignal
): Promise<RunnerReport> {
  const request = parseMessage(RunnerLogsRequestSchema, input)
  if (!request.ok) return refused("invalid_request")
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const { app, tail } = request.value
  if (!deployedApps(loaded.state).includes(app)) return refused("invalid_request")
  // Nobody is left to read: Docker is not even asked.
  if (stop.aborted) return { outcome: "ok" }

  let child
  try {
    child = Bun.spawn(
      [dockerCommand(), "compose", "-p", `zekno-${app}`, "logs", "--follow", "--timestamps", "--no-color", "--tail", String(tail)],
      { env: dockerEnv(), stdin: "ignore", stdout: "pipe", stderr: "ignore" }
    )
  } catch {
    return { outcome: "ok" }
  }
  const stopped = new Promise<void>((resolve) => {
    if (stop.aborted) resolve()
    else stop.addEventListener("abort", () => resolve(), { once: true })
  })
  const reading = readLines(
    child.stdout,
    (line) => {
      // Nothing is sent once the reader has gone.
      if (stop.aborted) return
      const event = parseLogLine(line)
      if (event) return onEvent(event)
    },
    LOG_LINE + 128
  ).catch(() => {
    // The output broke off: the same as Docker ending.
  })
  // Not waiting for the output to close after a stop: a process Docker left
  // behind could keep it open.
  await Promise.race([reading, stopped])
  await stopChild(child)
  return { outcome: "ok" }
}
