/**
 * What the stand-in for Docker remembers between calls (specs/015-domains-
 * https, contracts/runner.md, "Tests"): containers, networks, the proxy's
 * log and what it last loaded, and what a test has asked the next calls to
 * do. Kept as one JSON file in the stand-in's folder, read and written whole
 * by each call; the runner makes its calls one at a time, under its lock.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** One container, with only what the runner reads of `docker inspect`. */
export type FakeContainer = {
  /** 64 hex characters. */
  id: string
  /** Without the leading slash Docker prints. */
  name: string
  image: string
  labels: Record<string, string>
  /** `HostConfig.NetworkMode`: the Compose network's name, or `host`. */
  networkMode: string
  running: boolean
  restartCount: number
  /** `State.Health.Status`, for a container with a health check of its own. */
  health?: "starting" | "healthy" | "unhealthy"
  /** Each network it is on, with its aliases there. */
  networks: Record<string, { aliases: string[] }>
  /** Bind mounts: where the folder is on this machine, and where it shows inside. */
  mounts: { source: string; target: string }[]
}

export type FakeNetwork = { name: string; labels: Record<string, string> }

/** What a signal to the proxy does: loads the file, refuses it, says nothing, or says it loaded without saving it. */
export type Reload = "ok" | "failed" | "silent" | "no_autosave"

/** What a test asks of the calls that follow. Each is used up as it is taken, unless it says otherwise. */
export type Script = {
  /** The next `docker run -d` fails with this status and error text; `leave` keeps a container in state Created, as Docker does. */
  runFails?: { code: number; stderr: string; leave: boolean }
  /** How many `caddy validate` calls fail. */
  validateFails?: number
  /** What each signal does, in order; `ok` once the list is used up. */
  reloads?: Reload[]
  /** A proxy started (`run` or `start`) logs no `serving initial configuration`. */
  startSilent?: boolean
  /** How many `network connect` calls attach the container without its alias. */
  connectWithoutAlias?: number
  /** What a health check's curl prints for a service, `<code>|<exit>`; `200|0` when not said. */
  curl?: Record<string, string>
  /** Calls that fail with exit status 1, each named by its first words, such as `network create`. */
  failing?: string[]
  /** Containers in a restart loop: each `inspect` finds one restart more. */
  restarting?: string[]
}

export type Model = {
  containers: FakeContainer[]
  networks: FakeNetwork[]
  /** The log of each container, by name: one JSON line each, as Caddy writes them. */
  logs: Record<string, string[]>
  /** The proxy's `/config/caddy/autosave.json`: what it last loaded. */
  autosave: string
  script: Script
}

const fileIn = (dir: string) => join(dir, "model.json")

export function readModel(dir: string): Model {
  const path = fileIn(dir)
  if (!existsSync(path))
    return { containers: [], networks: [], logs: {}, autosave: "", script: {} }
  return JSON.parse(readFileSync(path, "utf8")) as Model
}

export function writeModel(dir: string, model: Model): void {
  writeFileSync(fileIn(dir), JSON.stringify(model))
}

/** Changes the model in place on disk. */
export function changeModel<T>(dir: string, change: (model: Model) => T): T {
  const model = readModel(dir)
  const result = change(model)
  writeModel(dir, model)
  return result
}

/** A container by name, full id or an id's first characters, as Docker finds one. */
export function findContainer(
  model: Model,
  ref: string
): FakeContainer | undefined {
  return (
    model.containers.find((c) => c.name === ref || c.id === ref) ??
    (/^[0-9a-f]{12,63}$/.test(ref)
      ? model.containers.find((c) => c.id.startsWith(ref))
      : undefined)
  )
}

/** 64 random hex characters: a container's id. */
export const newId = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")

/** One line of Caddy's log, as it writes it on standard error. */
export const caddyLine = (msg: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ level: "info", ts: Date.now() / 1000, msg, ...extra })

/** The labels Compose writes on a container of a service of `zekno-<app>`. */
export const composeLabels = (app: string, service: string) => ({
  "com.docker.compose.project": `zekno-${app}`,
  "com.docker.compose.service": service,
  "com.docker.compose.oneoff": "False",
  "com.docker.compose.container-number": "1",
})
