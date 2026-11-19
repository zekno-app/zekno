/**
 * Routes and health checks in force in a runner's stored state
 * (specs/015-domains-https, contracts/core.md, "The state"), for the tests of
 * the state, of `deploy/routes.ts` and of check K10b.
 */
import type { Health } from "../../src/deploy/routes-and-checks"
import type { AppRoutes, StoredRunnerState } from "../../src/deploy/state"

/** A route of the service `web` on port 3000, unless `change` says otherwise. */
export const route = (
  domain: string,
  change: { service?: string; port?: number } = {}
) => ({ domain, service: "web", port: 3000, ...change })

/** A distinct name on a route network for each number: `z` and 32 hex characters. */
export const nameOf = (n: number): string =>
  `z${n.toString(16).padStart(32, "0")}`

/** A distinct container id for each number: 64 hex characters. */
export const containerOf = (n: number): string =>
  n.toString(16).padStart(64, "0")

/** One container of a service and the name it was given. */
export const named = (n: number) => ({
  container: containerOf(n),
  name: nameOf(n),
})

/** A health check of `service` (default `web`), with a path on port 3000 when `path` is given. */
export const check = (
  service = "web",
  path?: string,
  timeout = 60
): Health => ({
  timeout,
  services: [
    { service, http: path === undefined ? null : { port: 3000, path } },
  ],
})

/** An app's entry: these domains, each to `web`, one container of `web` named `first`, and `health` (none by default). */
export function appRoutes(
  domains: readonly string[],
  first = 1,
  health: Health | null = null
): AppRoutes {
  return {
    routes: domains.map((domain) => route(domain)),
    health,
    names: { web: [named(first)] },
  }
}

/**
 * `state` with each of `apps` held at format 2 (number 1 unless it had one)
 * and its entry in `routes` set.
 */
export function holding(
  state: StoredRunnerState,
  apps: Record<string, AppRoutes>
): StoredRunnerState {
  const lastSequence = { ...state.lastSequence }
  const formats = { ...state.formats }
  for (const app of Object.keys(apps)) {
    lastSequence[app] ??= 1
    formats[app] = 2
  }
  return {
    ...state,
    lastSequence,
    formats,
    routes: { ...state.routes, ...apps },
  }
}
