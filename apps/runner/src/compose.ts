import { isReservedSecretName } from "@workspace/core"

/** What the Docker command itself needs from the runner's environment. */
const PASSED_THROUGH = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"]

/** The longest progress line a session frame may carry. */
const PROGRESS_LINE = 4096

/** What Docker needs from the runner's environment, and nothing else of it. */
export function dockerEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of PASSED_THROUGH) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

export const dockerCommand = (): string => process.env.ZEKNO_DOCKER || "docker"

/**
 * Calls `onLine` for each line of a stream, cut to `limit` characters, and
 * waits for it when it returns a promise, so a slow reader slows the writer
 * instead of filling memory. Only a line feed ends a line: a carriage return
 * is part of the text, and empty lines are skipped.
 */
export async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void | Promise<void>,
  limit: number
): Promise<void> {
  const decoder = new TextDecoder()
  let rest = ""
  const emit = async (line: string) => {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line
    if (text.trim() !== "") await onLine(text.slice(0, limit))
  }
  for await (const chunk of stream) {
    const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n")
    rest = parts.pop() ?? ""
    // A line with no end in sight is cut, not kept growing.
    if (rest.length > limit * 4) rest = rest.slice(0, limit)
    for (const line of parts) await emit(line)
  }
  await emit(rest + decoder.decode())
}

/**
 * Starts an app with Docker Compose. The secrets exist only in the
 * environment of the Docker process: Compose reads them from there, and they
 * are never written to disk by the runner. Returns Docker's exit status.
 */
export async function composeUp(input: {
  app: string
  file: string
  secrets: Record<string, string>
  /** Given each line Docker prints. Without it, Docker's output goes to standard error. */
  onLine?: (line: string) => void
}): Promise<number> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.secrets)) {
    // A reserved name would change how Docker runs, so it never reaches Docker's environment.
    if (!isReservedSecretName(name)) env[name] = value
  }
  // The runner's own values win over any secret of the same name.
  Object.assign(env, dockerEnv())

  const argv = [dockerCommand(), "compose", "-p", `zekno-${input.app}`, "-f", input.file, "up", "-d", "--remove-orphans"]
  try {
    const { onLine } = input
    if (onLine) {
      // Reporting a line must never stop the deploy: it carries on when nobody is reading.
      const report = (line: string) => {
        try {
          onLine(line)
        } catch {
          // Lost, like any line nobody reads.
        }
      }
      const child = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
      // Docker's exit status decides the outcome, even if its output could not be read.
      await Promise.all([readLines(child.stdout, report, PROGRESS_LINE), readLines(child.stderr, report, PROGRESS_LINE)]).catch(() => {})
      return await child.exited
    }
    // Standard output is reserved for the runner's one JSON line.
    const child = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "inherit" })
    const output = await new Response(child.stdout).text()
    if (output) process.stderr.write(output)
    return await child.exited
  } catch {
    // Docker is not installed, or could not be started at all.
    return 127
  }
}
