/**
 * The routes in force in a runner's stored state (specs/015-domains-https,
 * contracts/core.md, "The state"): who holds each domain, how many domains a
 * deploy would leave the server holding, and the state with one app's routes
 * replaced. The runner saves that state only once the proxy has loaded a
 * configuration with those routes (runner.md, RN9).
 */
import type { Route } from "./routes-and-checks"
import { readMarked, type AppRoutes, type StoredRunnerState } from "./state"

/** Each domain in force, to the app that holds it. Check K10b reads it. */
export function domainHolders(state: StoredRunnerState): Map<string, string> {
  const holders = new Map<string, string>()
  for (const [app, entry] of Object.entries(state.routes))
    for (const route of entry.routes) holders.set(route.domain, app)
  return holders
}

/**
 * How many domains the server would hold with this app's routes replaced by
 * `routes`: the runner refuses a deploy that would make it more than
 * `LIMITS.domainsPerServer` (`too_large`, runner.md RN2). A domain counts
 * once, even one another app holds, which K10b has refused before.
 */
export function domainsAfter(
  state: StoredRunnerState,
  app: string,
  routes: readonly Route[]
): number {
  const domains = new Set<string>()
  for (const [holder, entry] of Object.entries(state.routes))
    if (holder !== app)
      for (const route of entry.routes) domains.add(route.domain)
  for (const route of routes) domains.add(route.domain)
  return domains.size
}

/**
 * The state with this app's entry replaced by `appRoutes`, or removed when it
 * is null, and every other part as it was. The apps are given in order of
 * their names, so the same routes give the same file. Read back through the
 * strict schema: throws `CoreError` for a state its rules refuse, such as a
 * domain another app holds or an app not at format 2.
 */
export function withAppRoutes(
  state: StoredRunnerState,
  app: string,
  appRoutes: AppRoutes | null
): StoredRunnerState {
  const entries: [string, AppRoutes][] = Object.entries(state.routes).filter(
    ([holder]) => holder !== app
  )
  if (appRoutes !== null) entries.push([app, appRoutes])
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return readMarked({ ...state, routes: Object.fromEntries(entries) })
}
