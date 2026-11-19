/**
 * Putting a deploy's routes in force (specs/015-domains-https, contracts/
 * runner.md, RN4 to RN10, in that order), after `docker compose up` has
 * returned and under the deploy's lock. The proxy's configuration comes
 * first and the state after: the routes in force are saved only once the
 * proxy has loaded a configuration that has them, so one app's refused route
 * never reaches the state to block every later configuration (RN9).
 *
 * The containers found are the app's own (RN4), each gets a name on the
 * app's route network that only the runner hands out (RN5), the proxy is
 * brought up and onto that network (RN6), the configuration is built from the
 * state with this app's wanted routes and names in place of what it held
 * (RN7), and loaded (RN8). Then the state is saved, or the configuration of
 * the state as it is is loaded again (RN9). Last, what this deploy released
 * goes: certificates, the proxy's place on a network no route uses, the
 * route network of an app with neither a route nor a health check, and the
 * proxy itself when no app has a route (RN10).
 */
import {
  withAppRoutes,
  type AppRoutes,
  type Health,
  type Route,
  type StoredRunnerState,
} from "@workspace/core"

import { isReport, load } from "../commands/commands"
import type { ContainerInfo } from "../docker/objects"
import { runDocker } from "../docker/run"
import { writeState } from "../home/home"
import { deleteCertificates } from "../proxy/certificates"
import { findProxy, removeProxy, type RoutesFailure } from "../proxy/container"
import { PROXY } from "../proxy/log"
import { loadBack, routedApps, serveRoutes } from "../proxy/serve"
import { containersOf } from "./containers"
import {
  ensureRouteNetwork,
  nameContainers,
  removeRouteNetwork,
  routeNetwork,
  type Named,
} from "./network"

/** The routes are in force, with the names of each routed or checked service's containers; or why not. */
export type RoutesInForce =
  | { ok: true; names: Record<string, Named[]> }
  | { ok: false; failure: RoutesFailure }

const NOT_LOADED = { ok: false, failure: { failure: "not_loaded" } } as const

/** Every service a route or the health check names, once each, sorted. */
const servicesOf = (routes: readonly Route[], health: Health | null) =>
  [
    ...new Set([
      ...routes.map((route) => route.service),
      ...(health?.services.map((entry) => entry.service) ?? []),
    ]),
  ].sort()

/**
 * Carries out RN4 to RN10 for the deploy of `app` that wants `routes` and
 * `health`. Never throws: anything unforeseen is `not_loaded`, since the
 * deploy's number is used by now and its outcome must still be reported.
 */
export async function putRoutesInForce(input: {
  dir: string
  app: string
  routes: readonly Route[]
  health: Health | null
}): Promise<RoutesInForce> {
  try {
    return await steps(input)
  } catch {
    return NOT_LOADED
  }
}

async function steps({
  dir,
  app,
  routes,
  health,
}: {
  dir: string
  app: string
  routes: readonly Route[]
  health: Health | null
}): Promise<RoutesInForce> {
  const loaded = load(dir)
  if (isReport(loaded)) return NOT_LOADED
  const { state } = loaded
  const server = state.serverId
  const held = state.routes[app]
  const services = servicesOf(routes, health)

  // RN4. The containers of each service.
  const found = new Map<string, ContainerInfo[]>()
  for (const service of services) {
    const listed = await containersOf(dir, app, service)
    if (!listed.ok)
      return { ok: false, failure: { failure: listed.failure, service } }
    found.set(service, listed.containers)
  }

  // RN5. The route network and the names.
  const names: Record<string, Named[]> = {}
  if (services.length > 0) {
    if (!(await ensureRouteNetwork(dir, server, app))) return NOT_LOADED
    for (const service of services) {
      const named = await nameContainers(
        dir,
        app,
        found.get(service)!,
        held?.names[service] ?? []
      )
      if (!named)
        return { ok: false, failure: { failure: "no_container", service } }
      names[service] = named
    }
  }
  // An app with neither a route nor a health check holds nothing.
  const wanted: AppRoutes | null =
    routes.length === 0 && health === null
      ? null
      : { routes: [...routes], names }

  // RN6 to RN8, from the state with this app's wanted routes and names in place of what it held.
  let next: StoredRunnerState
  try {
    next = withAppRoutes(state, app, wanted)
  } catch {
    return NOT_LOADED
  }
  const served = await serveRoutes(dir, server, next.routes)
  if (!served.ok) {
    // RN9, not loaded: the configuration of the state as it is, loaded again; the state is not written.
    if (served.tried) await loadBack(dir, server, state.routes)
    return { ok: false, failure: served.failure }
  }

  // RN9, loaded: the state read again, then written with this app's routes in force.
  const fresh = load(dir)
  let saved: StoredRunnerState
  try {
    if (isReport(fresh)) throw new Error("The state did not read.")
    saved = withAppRoutes(fresh.state, app, wanted)
    writeState(dir, saved)
  } catch {
    await loadBack(dir, server, state.routes)
    return NOT_LOADED
  }

  await release(dir, server, app, held, wanted, saved)
  return { ok: true, names }
}

/**
 * RN10: what this deploy released, after a load that worked, in order. A
 * failure here is not reported; the next deploy with routes or the `proxy`
 * request puts it right.
 */
async function release(
  dir: string,
  server: string,
  app: string,
  held: AppRoutes | undefined,
  wanted: AppRoutes | null,
  saved: StoredRunnerState
): Promise<void> {
  const found = await findProxy(dir, server)
  const proxy = found?.kind === "ours" ? found : undefined

  // 1. The certificate and key of each domain the app held and no longer has,
  // also when the proxy is stopped or gone (security review S2).
  const kept = new Set(wanted?.routes.map((route) => route.domain) ?? [])
  await deleteCertificates(
    dir,
    found,
    (held?.routes ?? [])
      .map((route) => route.domain)
      .filter((domain) => !kept.has(domain))
  )

  // 2. The proxy leaves each route network no route uses any more: leaving comes after loading (research R8).
  const routed = new Set(routedApps(saved.routes).map(routeNetwork))
  for (const network of proxy?.networks ?? [])
    if (network.startsWith(routeNetwork("")) && !routed.has(network))
      await runDocker(dir, ["network", "disconnect", network, PROXY])

  // 3. The route network of an app with no route and no health check.
  if (wanted === null) await removeRouteNetwork(dir, server, app)

  // 4. No app has a route: the proxy goes; its volumes and its own network stay.
  if (routed.size === 0) await removeProxy(dir, server)
}
