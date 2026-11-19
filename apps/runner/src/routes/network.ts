/**
 * The route network of an app and the names of its containers there
 * (specs/015-domains-https, contracts/runner.md, RN5 and RN10). The network
 * is the runner's own, `zekno-route-<app>`, labelled with the server's id and
 * the app, and never one of the app's Compose project. Each routed or checked
 * container gets a name on it that only the runner hands out: `z` and 32 hex
 * characters from the system's random source. The proxy and the health check
 * reach a container by that name, never by an address another container could
 * take (research R7), and a name never starts with a digit, so no tool reads
 * it as an address.
 */
import { randomBytes } from "node:crypto"

import {
  inspectContainer,
  inspectNetwork,
  LABEL,
  type ContainerInfo,
} from "../docker/objects"
import { runDocker } from "../docker/run"

export const routeNetwork = (app: string): string => `zekno-route-${app}`

/** A new name for a container on a route network. */
export const newName = (): string => `z${randomBytes(16).toString("hex")}`

/** A name and the container it was given to, as the state keeps them. */
export type Named = { container: string; name: string }

const isOurs = (labels: Record<string, string>, server: string, app: string) =>
  labels[LABEL.server] === server && labels[LABEL.app] === app

/**
 * Makes the app's route network if it is not there. False when it could not
 * be made, or when a network of that name is there without the runner's
 * labels for this server and this app: it is then not used (`not_loaded`).
 */
export async function ensureRouteNetwork(
  dir: string,
  server: string,
  app: string
): Promise<boolean> {
  const name = routeNetwork(app)
  const found = await inspectNetwork(dir, name)
  if (typeof found === "object") return isOurs(found.labels, server, app)
  const made = await runDocker(dir, [
    "network",
    "create",
    "--label",
    `${LABEL.server}=${server}`,
    "--label",
    `${LABEL.app}=${app}`,
    name,
  ])
  return made.code === 0
}

/**
 * Gives one container a new name on the route network and checks that Docker
 * shows it. A container already on the network under a name the runner did
 * not keep is taken off it first. A connect can answer an error and still
 * have made the name (D14), so the inspect decides.
 */
async function giveName(
  dir: string,
  network: string,
  container: ContainerInfo
): Promise<string | undefined> {
  let attached = network in container.networks
  // Once, then once more (RN5).
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attached)
      await runDocker(dir, ["network", "disconnect", network, container.id])
    const name = newName()
    await runDocker(dir, [
      "network",
      "connect",
      "--alias",
      name,
      network,
      container.id,
    ])
    const after = await inspectContainer(dir, container.id)
    if (typeof after !== "object") return undefined
    if (after.networks[network]?.includes(name)) return name
    attached = network in after.networks
  }
  return undefined
}

/**
 * The name of each container of a service on the app's route network, sorted
 * by container. A container the state already names keeps its name while
 * Docker still shows it there; any other gets a new one. Undefined when a
 * container could not be given one (`no_container`).
 */
export async function nameContainers(
  dir: string,
  app: string,
  containers: readonly ContainerInfo[],
  held: readonly Named[]
): Promise<Named[] | undefined> {
  const network = routeNetwork(app)
  const named: Named[] = []
  for (const container of containers) {
    const kept = held.find((each) => each.container === container.id)?.name
    if (kept !== undefined && container.networks[network]?.includes(kept)) {
      named.push({ container: container.id, name: kept })
      continue
    }
    const name = await giveName(dir, network, container)
    if (name === undefined) return undefined
    named.push({ container: container.id, name })
  }
  return named.sort((a, b) =>
    a.container < b.container ? -1 : a.container > b.container ? 1 : 0
  )
}

/**
 * Removes the app's route network once every container on it has been taken
 * off (RN10, step 3). A network without the runner's labels for this server
 * and app is left alone. A failure here is not reported: the next deploy
 * puts it right.
 */
export async function removeRouteNetwork(
  dir: string,
  server: string,
  app: string
): Promise<void> {
  const name = routeNetwork(app)
  const found = await inspectNetwork(dir, name)
  if (typeof found !== "object" || !isOurs(found.labels, server, app)) return
  for (const id of found.containers)
    await runDocker(dir, ["network", "disconnect", name, id])
  await runDocker(dir, ["network", "rm", name])
}
