/**
 * The two requests of feature 015 that read or mend the proxy (specs/
 * 015-domains-https, contracts/runner.md, RN13; core.md, "`status` with
 * routes" and "`proxy`"), in a session only.
 *
 * `status` with the input `{ "routes": true }`: today's answer, the routes in
 * force of each app that has any, and the proxy's state. It changes nothing.
 * Without the input, `status` answers as it always did, so every older zekno
 * reads it.
 *
 * `proxy`: under the deploy lock, makes the proxy what the state needs, from
 * the state alone: started, made again from the pinned image, its
 * configuration loaded when it differs, or removed when no app has a route.
 * It names no container and carries out no route a signed deploy did not put
 * in force, so it needs no signature, as a restart by Docker needs none
 * (research R21). `zekno server update` sends it after an update.
 */
import {
  parseMessage,
  RunnerStatusRequestSchema,
  type RunnerReport,
  type RunnerStatusWithRoutes,
} from "@workspace/core"

import { proxyState, removeProxy } from "../proxy/container"
import { routedApps, serveRoutes } from "../proxy/serve"
import { isReport, load, locked, refused, status } from "./commands"

/** `status` with routes: today's fields, the routes in force, and the proxy's state. */
export async function statusWithRoutes(
  dir: string,
  input: string
): Promise<RunnerStatusWithRoutes | RunnerReport> {
  const request = parseMessage(RunnerStatusRequestSchema, input)
  if (!request.ok) return refused("invalid_request")
  const today = status(dir)
  if (isReport(today)) return today
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const { state } = loaded
  const routes = Object.fromEntries(
    routedApps(state.routes).map((app) => [
      app,
      state.routes[app]!.routes.map((route) => ({ ...route })),
    ])
  )
  return {
    ...today,
    routes,
    proxy: await proxyState(
      dir,
      state.serverId,
      Object.keys(routes).length > 0
    ),
  }
}

/** The answer to `proxy`: the proxy's state once it is what the state needs. */
type ProxyAnswer = { proxy: "none" | "running" }

/**
 * `proxy`: no input. `{ proxy: "none" }` when no app has a route and no proxy
 * of this runner's is left; `{ proxy: "running" }` when it serves the routes
 * in force; else `routes_failed` with `port_taken` or `not_loaded`.
 */
export function proxy(
  dir: string,
  input: string
): Promise<ProxyAnswer | RunnerReport> {
  if (input !== "") return Promise.resolve(refused("invalid_request"))
  return locked<ProxyAnswer>(dir, async () => {
    const loaded = load(dir)
    if (isReport(loaded)) return loaded
    const { state } = loaded
    const notLoaded: RunnerReport = {
      outcome: "routes_failed",
      routes: { failure: "not_loaded" },
    }
    // RN10's last step: no app has a route, so no proxy runs.
    if (routedApps(state.routes).length === 0)
      return (await removeProxy(dir, state.serverId))
        ? { proxy: "none" }
        : notLoaded
    // RN6 to RN8, from the state alone.
    const served = await serveRoutes(dir, state.serverId, state.routes)
    if (!served.ok) return { outcome: "routes_failed", routes: served.failure }
    return { proxy: "running" }
  })
}
