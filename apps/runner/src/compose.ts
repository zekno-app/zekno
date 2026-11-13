import { isReservedSecretName } from "@workspace/core"

/** What the Docker command itself needs from the runner's environment. */
const PASSED_THROUGH = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"]

/**
 * Starts an app with Docker Compose. The secrets exist only in the
 * environment of the Docker process: Compose reads them from there, and they
 * are never written to disk by the runner. Returns Docker's exit status.
 */
export async function composeUp(input: {
  app: string
  file: string
  secrets: Record<string, string>
}): Promise<number> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.secrets)) {
    // A reserved name would change how Docker runs, so it never reaches Docker's environment.
    if (!isReservedSecretName(name)) env[name] = value
  }
  for (const name of PASSED_THROUGH) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }

  const docker = process.env.ZEKNO_DOCKER || "docker"
  try {
    const child = Bun.spawn(
      [docker, "compose", "-p", `zekno-${input.app}`, "-f", input.file, "up", "-d", "--remove-orphans"],
      // Standard output is reserved for the runner's one JSON line.
      { env, stdin: "ignore", stdout: "pipe", stderr: "inherit" }
    )
    const output = await new Response(child.stdout).text()
    if (output) process.stderr.write(output)
    return await child.exited
  } catch {
    // Docker is not installed, or could not be started at all.
    return 127
  }
}
