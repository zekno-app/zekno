/**
 * Which Docker engine the stand-in's scripts talk to on the host
 * (specs/016-build-from-source, T008; LC8). `server.ts up` reads it once,
 * from the host's own Docker configuration (its current context), and
 * refuses anything but a socket of this machine: an `ssh://` or `tcp://`
 * context, or a socket of no form, never gets a stand-in. The run's
 * `run.json` keeps it, and every later call of that run (`down`, `engine`,
 * the gate of the checks) names it, whatever the shell they run in says.
 *
 * No call takes the variables that choose an engine from the shell
 * (`ENDPOINT_VARIABLES`), and every call but the one read of the context
 * gets a DOCKER_CONFIG of its own whose `config.json` names only where the
 * CLI's plugins are: no credential helper, no login, no context of the
 * host's is read.
 */
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

/** The variables that choose which Docker answers, or how it is reached. */
export const ENDPOINT_VARIABLES = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
] as const

/** The one read of the host's current context: the engine it answers at. */
export const CONTEXT_ENDPOINT: readonly string[] = [
  "docker",
  "context",
  "inspect",
  "--format",
  "{{.Endpoints.docker.Host}}",
]

const LOCAL_SOCKET = /^unix:\/\/\/[^\s]+$/

/** True for a socket of this machine, `unix:///<path>`. */
export function isLocalSocket(endpoint: string): boolean {
  return LOCAL_SOCKET.test(endpoint)
}

/** `endpoint` when it is a socket of this machine; anything else throws one line. */
export function checkEndpoint(endpoint: string): string {
  if (!isLocalSocket(endpoint))
    throw new Error(
      `Docker's engine at ${JSON.stringify(endpoint)} is not a socket of this machine (unix:///...); the stand-in is made and removed only on this machine's own engine`
    )
  return endpoint
}

/**
 * Where the host's Docker CLI finds its plugins (buildx among them): the
 * `cli-plugins` folder of its configuration and the folders its
 * `config.json` adds (`cliPluginsExtraDirs`, as Docker Desktop writes it).
 * Only that one key of the file is read; nothing else of it is kept.
 */
export function hostPluginDirs(
  base: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir()
): string[] {
  const folder = base.DOCKER_CONFIG || join(home, ".docker")
  const dirs = [join(folder, "cli-plugins")]
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(folder, "config.json"), "utf8")
    )
    const extra =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).cliPluginsExtraDirs
        : undefined
    if (Array.isArray(extra))
      for (const dir of extra)
        if (typeof dir === "string" && isAbsolute(dir) && !dirs.includes(dir))
          dirs.push(dir)
  } catch {
    // No config.json, or one that is not JSON: the CLI's own folders only.
  }
  return dirs
}

/** The `config.json` of a call's own DOCKER_CONFIG: the plugin folders, nothing else. */
export function configJson(plugins: readonly string[]): string {
  return `${JSON.stringify(plugins.length === 0 ? {} : { cliPluginsExtraDirs: plugins })}\n`
}
