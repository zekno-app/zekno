/**
 * Routes in force in a runner's stored state (specs/015-domains-https,
 * contracts/core.md, "The state"), for the tests of the state, of
 * `deploy/routes.ts` and of check K10b.
 */
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

/** An app's entry: these domains, each to `web`, and one container of `web` named `first`. */
export function appRoutes(domains: readonly string[], first = 1): AppRoutes {
  return {
    routes: domains.map((domain) => route(domain)),
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
