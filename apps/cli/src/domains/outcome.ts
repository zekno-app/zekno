/**
 * What a deploy that was accepted says when its routes are not in force or
 * it was not healthy in time (specs/015-domains-https, contracts/cli.md, CL3,
 * "The answer"): B16 to B19 for `routes_failed` by its failure, C3 or C4 for
 * `unhealthy`. Read from the runner's report, whose fields are fixed words, a
 * service held to its pattern and a port, and from what this machine signed:
 * the routes, for the domain B17 and B18 name, and the health check, for the
 * path and the limit C3 and C4 name.
 */
import type { Health, Route, RunnerReport } from "@workspace/core"

import { B16, B17, B18, B19, C3, C4, HEALTH_SECONDS } from "./words"
import { hostNetworkChecked, noContainerChecked } from "./words-extra"

/** What the deploy signed, as the sentence names it. */
export type Signed = {
  app: string
  server: string
  /** Sorted by domain, as signed. */
  routes: readonly Route[]
  health: Health | null
}

/**
 * The sentence of a `routes_failed` or `unhealthy` report, or undefined for
 * any other. B17 and B18 name the first domain, in domain order, that reaches
 * the service the report names; a service the deploy checks and routes no
 * domain to is named alone, in their pattern (words-extra.ts).
 */
export function problemOf(
  report: RunnerReport,
  signed: Signed
): string | undefined {
  const { app, server } = signed
  if (report.outcome === "routes_failed" && report.routes !== undefined) {
    const { failure, service, port } = report.routes
    if (failure === "port_taken") return B16(app, server, port ?? 80)
    if (failure === "not_loaded" || service === undefined)
      return B19(app, server)
    const domain = signed.routes.find(
      (route) => route.service === service
    )?.domain
    if (failure === "no_container")
      return domain === undefined
        ? noContainerChecked(service)
        : B17(domain, service)
    return domain === undefined
      ? hostNetworkChecked(service)
      : B18(domain, service)
  }
  if (report.outcome === "unhealthy" && report.health !== undefined) {
    const { service, http } = report.health
    const seconds = signed.health?.timeout ?? HEALTH_SECONDS
    const path = signed.health?.services.find(
      (entry) => entry.service === service
    )?.http?.path
    return http && path !== undefined
      ? C3(service, path, seconds, app)
      : C4(service, seconds, app)
  }
  return undefined
}
