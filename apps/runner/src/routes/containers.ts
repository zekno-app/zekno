/**
 * The containers of a routed or checked service (specs/015-domains-https,
 * contracts/runner.md, RN4). Docker Compose is asked for the service's
 * containers in the runner's own folder, and each is inspected: it counts
 * only when its labels say it belongs to this app's Compose project and to
 * that service, and it is not a one-off container. A Compose text cannot
 * forge those labels (deploy-v2.md part 4.2, D11), so only the app's own
 * containers are ever named on its route network.
 */
import { SERVICE_NAME } from "@workspace/core"

import { inspectContainer, type ContainerInfo } from "../docker/objects"
import { runDocker } from "../docker/run"

/** At most this many containers of one service are routed or checked; more is outside what this version routes. */
const MOST = 16

const PROJECT = "com.docker.compose.project"
const SERVICE = "com.docker.compose.service"
const ONE_OFF = "com.docker.compose.oneoff"

export type ServiceContainers =
  | { ok: true; containers: ContainerInfo[] }
  | { ok: false; failure: "no_container" | "host_network" }

/**
 * The containers of `service` of `app`, sorted by id. `no_container` when
 * there is none, more than 16, or Docker did not answer; `host_network` when
 * one uses the host's network, which cannot join a route network.
 */
export async function containersOf(
  dir: string,
  app: string,
  service: string
): Promise<ServiceContainers> {
  const none = { ok: false, failure: "no_container" } as const
  if (!SERVICE_NAME.test(service)) return none
  const project = `zekno-${app}`
  const listed = await runDocker(dir, [
    "compose",
    "-p",
    project,
    "ps",
    "-q",
    service,
  ])
  if (listed.code !== 0) return none
  const ids = [
    ...new Set(
      listed.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[0-9a-f]{12,64}$/.test(line))
    ),
  ]
  if (ids.length === 0 || ids.length > MOST) return none

  const containers: ContainerInfo[] = []
  for (const id of ids) {
    const found = await inspectContainer(dir, id)
    if (typeof found !== "object") continue
    const { labels } = found
    if (
      labels[PROJECT] !== project ||
      labels[SERVICE] !== service ||
      labels[ONE_OFF] === "True"
    )
      continue
    if (found.networkMode === "host")
      return { ok: false, failure: "host_network" }
    containers.push(found)
  }
  if (containers.length === 0) return none
  return {
    ok: true,
    containers: containers.sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    ),
  }
}
