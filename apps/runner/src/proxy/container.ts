/**
 * The proxy's container (specs/015-domains-https, contracts/runner.md, RN6;
 * research R11): `zekno-proxy`, labelled with this server's id, started from
 * the pinned image at the first deploy that leaves the server with a route,
 * started again when it stopped, made again when its image is not the pinned
 * one, and removed when no app has a route (RN10). It never gets the Docker
 * socket, it runs with no capability but binding low ports, and its two
 * volumes outlive it: without one on `/data`, every certificate would be lost
 * each time it is made again (research R1).
 *
 * One runner a Docker daemon: a proxy labelled for another server is never
 * touched, and no proxy of this runner's is started beside it.
 */
import type { RunnerReport } from "@workspace/core"

import { inspectContainer, inspectNetwork, LABEL } from "../docker/objects"
import { runDocker } from "../docker/run"
import { etcMount } from "./file"
import { PROXY_IMAGE } from "./image"
import { countLines, noteTime, PROXY, serving, waitForLine } from "./log"
import { portNamed, publishArgs, testSwitch } from "./switch"

/** The proxy's own network: it shares no network with other containers but the route networks. */
const PROXY_NETWORK = "zekno-proxy"
/** The proxy's volumes: certificates and keys on `/data`, what Caddy saved on `/config`. */
export const DATA_VOLUME = "zekno-proxy-data"
const CONFIG_VOLUME = "zekno-proxy-config"
/**
 * The proxy's log, kept by Docker's `local` driver in at most three files of
 * 10 MB, so nothing a visitor makes Caddy write can fill the disk; `docker
 * logs` reads it as it reads the default driver's (security review S1). A
 * proxy made before these options keeps its own until it is made again.
 */
const LOG_OPTIONS = [
  "--log-driver",
  "local",
  "--log-opt",
  "max-size=10m",
  "--log-opt",
  "max-file=3",
]
/** How long `docker run` may take: the first one pulls the pinned image. */
const RUN_MS = 10 * 60_000
/** How long a started proxy has to say it serves its file (RN6). */
const START_MS = 15_000

export type RoutesFailure = NonNullable<RunnerReport["routes"]>
const NOT_LOADED: RoutesFailure = { failure: "not_loaded" }

/** What Docker has under the proxy's name. */
export type FoundProxy =
  | { kind: "missing" }
  /** A container of that name without this server's labels: not this runner's to touch. */
  | { kind: "foreign" }
  | { kind: "ours"; image: string; running: boolean; networks: string[] }

/** The proxy as Docker has it, or undefined when Docker did not answer. */
export async function findProxy(
  dir: string,
  server: string
): Promise<FoundProxy | undefined> {
  const found = await inspectContainer(dir, PROXY)
  if (found === undefined) return undefined
  if (found === "missing") return { kind: "missing" }
  if (
    found.labels[LABEL.server] !== server ||
    found.labels[LABEL.role] !== "proxy"
  )
    return { kind: "foreign" }
  return {
    kind: "ours",
    image: found.image,
    running: found.running,
    networks: Object.keys(found.networks),
  }
}

/** Docker's words for a port another container or program holds (research R9). */
const PORT_TAKEN = /port is already allocated|address already in use/

/** `port_taken` with the port Docker names, when the text says a port is taken. */
function portTaken(stderr: string): RoutesFailure | undefined {
  if (!PORT_TAKEN.test(stderr)) return undefined
  const ports = testSwitch()
  return {
    failure: "port_taken",
    port: portNamed(stderr, typeof ports === "object" ? ports : undefined),
  }
}

/** Makes the proxy's own network if it is not there. */
async function ensureProxyNetwork(
  dir: string,
  server: string
): Promise<boolean> {
  const found = await inspectNetwork(dir, PROXY_NETWORK)
  if (typeof found === "object") return true
  const made = await runDocker(dir, [
    "network",
    "create",
    "--label",
    `${LABEL.server}=${server}`,
    "--label",
    `${LABEL.role}=proxy`,
    PROXY_NETWORK,
  ])
  return made.code === 0
}

/**
 * Removes this runner's proxy, never another's. The volumes and the proxy's
 * own network stay (RN10). True when no proxy of this runner's is left.
 */
export async function removeProxy(
  dir: string,
  server: string
): Promise<boolean> {
  const found = await findProxy(dir, server)
  if (found === undefined) return false
  if (found.kind !== "ours") return true
  await runDocker(dir, ["rm", "-f", PROXY])
  return (await findProxy(dir, server))?.kind === "missing"
}

export type Ensured =
  { ok: true; started: boolean } | { ok: false; failure: RoutesFailure }

/**
 * Makes sure this runner's proxy runs from the pinned image (RN6). `prepare`
 * puts the configuration of RN7 in place once Caddy has validated it, and is
 * called before any start, so the proxy never starts on an old file nor on
 * one that was not validated (security review S7). `started` says the proxy
 * was started on that file now, and so needs no signal to load it (RN8).
 */
export async function ensureProxy(
  dir: string,
  server: string,
  prepare: () => Promise<boolean>
): Promise<Ensured> {
  const ports = testSwitch()
  if (ports === "invalid") return { ok: false, failure: NOT_LOADED }
  let found = await findProxy(dir, server)
  if (found === undefined || found.kind === "foreign")
    return { ok: false, failure: NOT_LOADED }
  if (found.kind === "ours" && found.image !== PROXY_IMAGE) {
    // Another image: made again from the pinned one.
    if (!(await removeProxy(dir, server)))
      return { ok: false, failure: NOT_LOADED }
    found = { kind: "missing" }
  }

  if (found.kind === "ours") {
    if (found.running) return { ok: true, started: false }
    if (!(await prepare())) return { ok: false, failure: NOT_LOADED }
    const since = noteTime()
    const before = await countLines(dir, since, serving)
    const start = await runDocker(dir, ["start", PROXY])
    if (start.code !== 0)
      return { ok: false, failure: portTaken(start.stderr) ?? NOT_LOADED }
    return (await waitForLine(dir, since, serving, before ?? 0, START_MS))
      ? { ok: true, started: true }
      : { ok: false, failure: NOT_LOADED }
  }

  const mount = etcMount(dir)
  if (mount === undefined || !(await ensureProxyNetwork(dir, server)))
    return { ok: false, failure: NOT_LOADED }
  if (!(await prepare())) return { ok: false, failure: NOT_LOADED }
  const since = noteTime()
  const run = await runDocker(
    dir,
    [
      "run",
      "-d",
      "--name",
      PROXY,
      "--label",
      `${LABEL.server}=${server}`,
      "--label",
      `${LABEL.role}=proxy`,
      "--restart",
      "unless-stopped",
      ...LOG_OPTIONS,
      "--network",
      PROXY_NETWORK,
      // No search domain of the host's: a name of a container that is down is never completed into one outside.
      "--dns-search",
      ".",
      ...publishArgs(ports),
      "-v",
      `${DATA_VOLUME}:/data`,
      "-v",
      `${CONFIG_VOLUME}:/config`,
      "--mount",
      mount,
      "--cap-drop",
      "ALL",
      "--cap-add",
      "NET_BIND_SERVICE",
      "--security-opt",
      "no-new-privileges",
      PROXY_IMAGE,
      "caddy",
      "run",
      "--config",
      "/etc/zekno-proxy/caddy.json",
    ],
    { timeoutMs: RUN_MS }
  )
  if (run.code !== 0) {
    // With -d, Docker leaves a container in state Created when it cannot take a port.
    await removeProxy(dir, server)
    return {
      ok: false,
      failure: (run.code === 125 && portTaken(run.stderr)) || NOT_LOADED,
    }
  }
  return (await waitForLine(dir, since, serving, 0, START_MS))
    ? { ok: true, started: true }
    : { ok: false, failure: NOT_LOADED }
}

/** The proxy's state as `status` with routes says it (RN13; core.md, `PROXY_STATES`). */
export async function proxyState(
  dir: string,
  server: string,
  routed: boolean
): Promise<"none" | "running" | "stopped" | "missing" | "other_image"> {
  const found = await findProxy(dir, server)
  if (found?.kind !== "ours") return routed ? "missing" : "none"
  if (found.image !== PROXY_IMAGE) return "other_image"
  if (found.running) return "running"
  return routed ? "stopped" : "none"
}
