/**
 * What the runner reads of `docker inspect` for a container and for a
 * network (specs/015-domains-https, contracts/runner.md, RN4 to RN6, RN11).
 * Only the fields named here are kept; the rest of Docker's answer, such as a
 * container's environment, which holds the app's secrets, is dropped as it
 * is read and goes nowhere.
 */
import { runDocker } from "./run"

/** The labels the runner puts on what it makes, and reads back before it touches anything. */
export const LABEL = {
  server: "app.zekno.server",
  role: "app.zekno.role",
  app: "app.zekno.app",
} as const

export type ContainerInfo = {
  /** 64 hex characters. */
  id: string
  /** The image it was started from, as given to Docker. */
  image: string
  labels: Record<string, string>
  /** `host` when it uses the host's network. */
  networkMode: string
  running: boolean
  /** The status of the container's own health check, when it has one. */
  health: string | undefined
  restarts: number
  /** Each network it is on, with its aliases there. */
  networks: Record<string, string[]>
}

export type NetworkInfo = {
  labels: Record<string, string>
  /** The ids of the containers on it. */
  containers: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A map of strings to strings, with anything else left out. */
function strings(value: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (isObject(value))
    for (const [key, each] of Object.entries(value))
      if (typeof each === "string") result[key] = each
  return result
}

const field = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((at, key) => (isObject(at) ? at[key] : undefined), value)

/** The first object of Docker's JSON array, or undefined. */
function first(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) && isObject(parsed[0]) ? parsed[0] : undefined
  } catch {
    return undefined
  }
}

function toContainer(raw: Record<string, unknown>): ContainerInfo | undefined {
  const id = raw.Id
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) return undefined
  const networks: Record<string, string[]> = {}
  const attached = field(raw, "NetworkSettings", "Networks")
  if (isObject(attached))
    for (const [name, endpoint] of Object.entries(attached)) {
      const aliases = field(endpoint, "Aliases")
      networks[name] = Array.isArray(aliases)
        ? aliases.filter((alias): alias is string => typeof alias === "string")
        : []
    }
  const image = field(raw, "Config", "Image")
  const mode = field(raw, "HostConfig", "NetworkMode")
  const health = field(raw, "State", "Health", "Status")
  const restarts = raw.RestartCount
  return {
    id,
    image: typeof image === "string" ? image : "",
    labels: strings(field(raw, "Config", "Labels")),
    networkMode: typeof mode === "string" ? mode : "",
    running: field(raw, "State", "Running") === true,
    health: typeof health === "string" ? health : undefined,
    restarts:
      typeof restarts === "number" && Number.isInteger(restarts) ? restarts : 0,
    networks,
  }
}

/**
 * One container, by name or id: what the runner reads of it, `missing` when
 * Docker says there is none, or undefined when Docker did not answer.
 */
export async function inspectContainer(
  dir: string,
  ref: string
): Promise<ContainerInfo | "missing" | undefined> {
  const result = await runDocker(dir, ["inspect", "--type", "container", ref])
  if (result.code !== 0)
    return /no such (container|object)/i.test(result.stderr)
      ? "missing"
      : undefined
  const raw = first(result.stdout)
  return raw ? toContainer(raw) : undefined
}

/** One network by name: its labels and containers, `missing` when there is none, or undefined when Docker did not answer. */
export async function inspectNetwork(
  dir: string,
  name: string
): Promise<NetworkInfo | "missing" | undefined> {
  const result = await runDocker(dir, ["network", "inspect", name])
  if (result.code !== 0)
    return /not found/i.test(result.stderr) ? "missing" : undefined
  const raw = first(result.stdout)
  if (!raw) return undefined
  const containers = raw.Containers
  return {
    labels: strings(raw.Labels),
    containers: isObject(containers)
      ? Object.keys(containers).filter((id) => /^[0-9a-f]{64}$/.test(id))
      : [],
  }
}
