/**
 * The one way the Linux stand-in's scripts call Docker on the host
 * (specs/016-build-from-source, T008; tasks.md, "Rules every task keeps";
 * LC8): `server.ts`, `gate.ts` and T165's `client.ts` call `docker` through
 * `hostDocker(...).run` and nowhere else.
 *
 * It runs on the maintainer's own Mac, where an earlier test made Docker
 * drop the owner's build history, so it is strict:
 *
 * - every call names one engine, a socket of this machine that `up` read
 *   once from the host's current context and the run keeps (`endpoint.ts`):
 *   DOCKER_HOST is set to it, and DOCKER_CONTEXT, DOCKER_TLS* and
 *   DOCKER_CERT_PATH from the shell are dropped, so neither the shell nor a
 *   context chosen since can send a call to another engine;
 * - every call gets BUILDX_CONFIG and DOCKER_CONFIG set to fresh temporary
 *   folders of its own, removed after the call, so buildx never reads or
 *   writes the host's `~/.docker/buildx`, and no credential helper, login or
 *   context of the host's is read; hints and hooks are off, and no builder
 *   is chosen from outside;
 * - only the calls the stand-in needs get through (`host-calls.ts`): a
 *   change names only this run's four names, and nothing builds, prunes,
 *   logs in, tags, pushes, copies a folder or chooses a builder or a
 *   context;
 * - a refused call throws one line and never reaches Docker.
 *
 * The spawn is injected, so the tests stand in for Docker and assert the
 * exact argument lists.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkEndpoint,
  configJson,
  CONTEXT_ENDPOINT,
  ENDPOINT_VARIABLES,
  hostPluginDirs,
  isLocalSocket,
} from "./endpoint"
import { checkCall } from "./host-calls"
import { namesOf } from "../stand-in/plan"

export { checkCall, HOST_IMAGES } from "./host-calls"

/** What a call reads on its standard input: a file's bytes, or text. */
export type Input = { readonly file: string } | { readonly text: string }

/** One call of `docker`, as the spawn receives it. */
export type Call = {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly stdin: Input | undefined
  readonly timeoutMs: number
}

export type Answer = {
  /** The exit status; -1 when the call was killed at its time limit. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Spawn = (call: Call) => Promise<Answer>

export type RunOptions = { readonly stdin?: Input; readonly timeoutMs?: number }

export type HostDocker = {
  /** The run whose names this helper may make, enter and remove; none for reads only. */
  readonly id: string | undefined
  /** The engine every call names: a socket of this machine. */
  readonly endpoint: string
  run(args: readonly string[], options?: RunOptions): Promise<Answer>
}

const DEFAULT_TIMEOUT_MS = 120_000

/** What one call is given: its own folders, and the engine it names. */
export type CallPlaces = {
  readonly buildx: string
  /** DOCKER_CONFIG; the shell's is kept when absent (the one read of the context). */
  readonly config?: string
  /** DOCKER_HOST, a socket of this machine; none for the one read of the context. */
  readonly endpoint?: string
}

/**
 * The host's environment for one call: BUILDX_CONFIG and DOCKER_CONFIG of
 * its own, DOCKER_HOST the run's engine, nothing from the shell that
 * chooses an engine, no hints or hooks, no builder from outside.
 */
export function hostEnv(
  call: CallPlaces,
  base: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const dropped = new Set<string>([
    "BUILDX_BUILDER",
    ...ENDPOINT_VARIABLES,
    ...(call.config === undefined ? [] : ["DOCKER_CONFIG"]),
  ])
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(base))
    if (value !== undefined && !dropped.has(name)) env[name] = value
  env.BUILDX_CONFIG = call.buildx
  if (call.config !== undefined) env.DOCKER_CONFIG = call.config
  if (call.endpoint !== undefined)
    env.DOCKER_HOST = checkEndpoint(call.endpoint)
  env.DOCKER_CLI_HINTS = "false"
  env.DOCKER_CLI_HOOKS = "false"
  return env
}

/** A fresh folder for one call: an empty BUILDX_CONFIG, and a DOCKER_CONFIG whose config.json names only the plugin folders. */
function callFolder(plugins: readonly string[] | undefined): {
  folder: string
  buildx: string
  config: string | undefined
} {
  const folder = mkdtempSync(join(tmpdir(), "zekno-host-docker-"))
  const buildx = join(folder, "buildx")
  mkdirSync(buildx)
  if (plugins === undefined) return { folder, buildx, config: undefined }
  const config = join(folder, "config")
  mkdirSync(config)
  writeFileSync(join(config, "config.json"), configJson(plugins), {
    mode: 0o600,
  })
  return { folder, buildx, config }
}

/** Runs `docker` with `Bun.spawn`, its output read whole, killed at its time limit. */
export const spawnDocker: Spawn = async (call) => {
  const stdin =
    call.stdin === undefined
      ? "ignore"
      : "file" in call.stdin
        ? Bun.file(call.stdin.file)
        : new TextEncoder().encode(call.stdin.text)
  const child = Bun.spawn([...call.args], {
    env: { ...call.env },
    stdin,
    stdout: "pipe",
    stderr: "pipe",
    timeout: call.timeoutMs,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code: child.signalCode === null ? code : -1, stdout, stderr }
}

/** The first line of what a call printed, on standard error or else standard output. */
const firstLineOf = (answer: Answer) =>
  (answer.stderr.trim() || answer.stdout.trim()).split("\n")[0]?.trim() ?? ""

/**
 * The engine the host's current context answers at, read once, with the
 * shell's DOCKER_HOST and DOCKER_CONTEXT left out. Anything but a socket of
 * this machine throws one line, so no stand-in is made on another engine.
 */
export async function resolveEndpoint(
  spawn: Spawn = spawnDocker,
  base: Readonly<Record<string, string | undefined>> = process.env
): Promise<string> {
  checkCall(CONTEXT_ENDPOINT, undefined)
  const call = callFolder(undefined)
  try {
    const answer = await spawn({
      args: [...CONTEXT_ENDPOINT],
      env: hostEnv({ buildx: call.buildx }, base),
      stdin: undefined,
      timeoutMs: 30_000,
    })
    if (answer.code !== 0)
      throw new Error(
        `docker context inspect failed (exit ${answer.code}): ${firstLineOf(answer)}`
      )
    const endpoint = answer.stdout.trim()
    if (!isLocalSocket(endpoint))
      throw new Error(
        `Docker's current context answers at ${JSON.stringify(endpoint)}, not at a socket of this machine (unix:///...); the stand-in is made only on this machine's own engine`
      )
    return endpoint
  } finally {
    rmSync(call.folder, { recursive: true, force: true })
  }
}

/**
 * The helper every host Docker call goes through, each call naming
 * `endpoint`. With `id`, it may make, enter and remove that run's names;
 * without, it reads only. With an injected spawn no file of the host's
 * Docker configuration is read, unless `pluginDirs` is given.
 */
export function hostDocker(options: {
  id?: string
  endpoint: string
  spawn?: Spawn
  pluginDirs?: readonly string[]
  /** The shell's environment; process.env when absent. */
  env?: Readonly<Record<string, string | undefined>>
}): HostDocker {
  const { id, spawn = spawnDocker } = options
  if (id !== undefined) namesOf(id)
  const endpoint = checkEndpoint(options.endpoint)
  let plugins = options.pluginDirs
  return {
    id,
    endpoint,
    async run(args, more = {}) {
      checkCall(args, id)
      plugins ??= options.spawn === undefined ? hostPluginDirs(options.env) : []
      const call = callFolder(plugins)
      try {
        return await spawn({
          args: [...args],
          env: hostEnv(
            { buildx: call.buildx, config: call.config, endpoint },
            options.env
          ),
          stdin: more.stdin,
          timeoutMs: more.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        })
      } finally {
        rmSync(call.folder, { recursive: true, force: true })
      }
    },
  }
}
