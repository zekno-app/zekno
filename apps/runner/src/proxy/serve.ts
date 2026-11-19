/**
 * Makes the proxy serve a set of routes in force (specs/015-domains-https,
 * contracts/runner.md, RN6 to RN8): the configuration built from them, the
 * proxy started when an app would have a route and it is not running, and
 * the configuration loaded when it differs, nonce apart, from the file in
 * place. Used by a deploy, with the app's wanted routes in place of what it
 * held, and by the `proxy` request, with the state as it is (RN13).
 */
import type { AppRoutes } from "@workspace/core"

import { readProxyConfig } from "../home/home"
import { routeNetwork } from "../routes/network"
import { buildConfig, sameApartFromNonce } from "./config"
import { ensureProxy, findProxy, type RoutesFailure } from "./container"
import { placeConfig } from "./file"
import { joinNetworks, loadConfig, type Loaded } from "./load"
import { testSwitch } from "./switch"

/**
 * Whether the proxy serves the routes; when not, why, and whether a load was
 * tried (RN8) that replaced the file in place, which may then not be the
 * state's. A file Caddy refused never replaces it (security review S7).
 */
export type Served =
  { ok: true } | { ok: false; failure: RoutesFailure; tried: boolean }

const notLoaded = (tried: boolean): Served => ({
  ok: false,
  failure: { failure: "not_loaded" },
  tried,
})
const served = (loaded: Loaded): Served =>
  loaded === "loaded" ? { ok: true } : notLoaded(loaded === "replaced")

/** The apps with a route, sorted: the route networks the proxy needs to be on. */
export const routedApps = (routes: Readonly<Record<string, AppRoutes>>) =>
  Object.keys(routes)
    .filter((app) => routes[app]!.routes.length > 0)
    .sort()

/** The configuration for `routes`, or undefined when a value does not match its pattern (RN7). */
export function configFor(routes: Readonly<Record<string, AppRoutes>>) {
  try {
    return buildConfig(routes, { internal: testSwitch() !== undefined })
  } catch {
    return undefined
  }
}

/**
 * Makes the proxy serve `routes`: started if an app has a route and it does
 * not run, and loaded if its file differs. A proxy no app needs is loaded
 * only when it runs, so that what it serves is what the state says until it
 * is removed (RN10). Nothing is done at all with a test switch that is set
 * wrong.
 */
export async function serveRoutes(
  dir: string,
  server: string,
  routes: Readonly<Record<string, AppRoutes>>
): Promise<Served> {
  if (testSwitch() === "invalid") return notLoaded(false)
  const config = configFor(routes)
  if (!config) return notLoaded(false)
  const networks = routedApps(routes).map(routeNetwork)

  if (networks.length > 0) {
    // Before any start, the file is validated with no proxy to run it in.
    const ensured = await ensureProxy(dir, server, () =>
      placeConfig(dir, config.text, "alone")
    )
    // Nothing was loaded: a proxy that did not start serves nothing, and one of another server's is not touched.
    if (!ensured.ok)
      return { ok: false, failure: ensured.failure, tried: false }
    if (ensured.started)
      return served(await loadConfig(dir, config, networks, { started: true }))
  } else {
    const found = await findProxy(dir, server)
    if (found?.kind !== "ours" || !found.running) return { ok: true }
  }
  // Each load drops a few new connections: the same file is not loaded again (research R6).
  if (sameApartFromNonce(config.text, readProxyConfig(dir)))
    return (await joinNetworks(dir, networks)) ? { ok: true } : notLoaded(false)
  return served(await loadConfig(dir, config, networks))
}

/**
 * Loads the configuration of `routes` by RN8 only, into this runner's proxy
 * when it runs: the way back after a configuration was not loaded (RN9).
 * Nothing is started, and nothing more is tried if this fails too.
 */
export async function loadBack(
  dir: string,
  server: string,
  routes: Readonly<Record<string, AppRoutes>>
): Promise<void> {
  const found = await findProxy(dir, server)
  const config = configFor(routes)
  if (found?.kind !== "ours" || !found.running || !config) return
  await loadConfig(dir, config, routedApps(routes).map(routeNetwork))
}
