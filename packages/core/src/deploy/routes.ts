/**
 * The routes and health checks in force in a runner's stored state
 * (specs/015-domains-https, contracts/core.md, "The state"): who holds each
 * domain, how many domains a deploy would leave the state counting, the
 * health checks in force and how much they would take, the state with one
 * app's entry replaced, and the state with released domains taken off once
 * their certificate is gone. The runner saves the state with an app's entry
 * replaced only once the proxy has loaded a configuration with those routes
 * (runner.md, RN9).
 */
import { healthBytes, type Health, type Route } from "./routes-and-checks"
import { readMarked, type AppRoutes, type StoredRunnerState } from "./state"

/** Each domain in force, to the app that holds it. Check K10b reads it. */
export function domainHolders(state: StoredRunnerState): Map<string, string> {
  const holders = new Map<string, string>()
  for (const [app, entry] of Object.entries(state.routes))
    for (const route of entry.routes) holders.set(route.domain, app)
  return holders
}

/**
 * The released domains still to delete once `app` holds `routes`: those on
 * the list, with each domain the app held and no longer has added, and each
 * domain the app now holds taken off, so a domain routed again keeps its
 * certificate. Sorted, each once.
 */
function releasedAfter(
  state: StoredRunnerState,
  app: string,
  routes: readonly Route[]
): string[] {
  const kept = new Set(routes.map((route) => route.domain))
  const released = new Set(state.released)
  if (Object.hasOwn(state.routes, app))
    for (const route of state.routes[app]!.routes) released.add(route.domain)
  return [...released].filter((domain) => !kept.has(domain)).sort()
}

/**
 * How many domains the state would count with this app's routes replaced by
 * `routes`: those in force, and those released whose certificate is still to
 * delete, with the ones this app gives up now among them. So a domain given
 * up counts until its deletion has worked, and one on the list that is routed
 * again counts once. The runner refuses a deploy that would make it more than
 * `LIMITS.domainsPerServer` (`too_large`, runner.md RN2), so the state it
 * would write always fits. A domain counts once, even one another app holds,
 * which K10b has refused before.
 */
export function domainsAfter(
  state: StoredRunnerState,
  app: string,
  routes: readonly Route[]
): number {
  const domains = new Set(releasedAfter(state, app, routes))
  for (const [holder, entry] of Object.entries(state.routes))
    if (holder !== app)
      for (const route of entry.routes) domains.add(route.domain)
  for (const route of routes) domains.add(route.domain)
  return domains.size
}

/**
 * The health check in force of each app that has one, in order of the apps'
 * names: what `status` with routes answers as `health` (core.md, "`status`
 * with routes").
 */
export function healthInForce(
  state: Pick<StoredRunnerState, "routes">
): Record<string, Health> {
  const health: Record<string, Health> = {}
  for (const app of Object.keys(state.routes).sort()) {
    const checked = state.routes[app]!.health
    if (checked !== null) health[app] = checked
  }
  return health
}

/**
 * How many bytes the health checks in force would take, as `status` with
 * routes writes them, with this app's replaced by `health`: the runner
 * refuses a deploy that would make it more than `LIMITS.healthBytesPerServer`
 * (`too_large`, runner.md RN2).
 */
export function healthBytesAfter(
  state: StoredRunnerState,
  app: string,
  health: Health | null
): number {
  const after = healthInForce(state)
  delete after[app]
  if (health !== null) after[app] = health
  return healthBytes(after)
}

/**
 * The state with this app's entry replaced by `appRoutes`, or removed when it
 * is null, and every other part as it was but the released domains, kept
 * right in the same write: each domain the app held and no longer has is
 * added, so its certificate is deleted until a deletion works (runner.md,
 * RN10), and each domain the app now holds is taken off. The apps are given
 * in order of their names, so the same routes give the same file. Read back
 * through the strict schema: throws `CoreError` for a state its rules refuse,
 * such as a domain another app holds or an app not at format 2.
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
  return readMarked({
    ...state,
    routes: Object.fromEntries(entries),
    released: releasedAfter(state, app, appRoutes?.routes ?? []),
  })
}

/**
 * The state with each of `deleted` taken off the released domains, once its
 * certificate and key are known to be gone (runner.md, RN10), and every
 * other part as it was. A domain that is not on the list is ignored. Read
 * back through the strict schema.
 */
export function withoutReleased(
  state: StoredRunnerState,
  deleted: readonly string[]
): StoredRunnerState {
  const gone = new Set(deleted)
  return readMarked({
    ...state,
    released: state.released.filter((domain) => !gone.has(domain)),
  })
}
