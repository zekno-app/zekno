/**
 * What a deploy checks of its domains before anything is signed
 * (specs/015-domains-https, contracts/cli.md, CL3, "Before signing", steps 2
 * to 6; FR-010 to FR-014, FR-017, FR-019), once `status` was read on the
 * deploy's own connection, with the routes in force when the runner answers
 * them (step 2; ops/status.ts `askStatus`). Step 1, B10, is the format's
 * (deploy-format.ts). Every stop is a `CliError` thrown before the "checked"
 * stage, so nothing is signed or sent, a terminal says the sentence alone,
 * and the app shows `✖ Checked`.
 *
 * 2. B9: a domain of the deploy is another app's on the server.
 * 3. FR-017: each route's service is in the Compose text to be signed, with
 *    the route's port; B11 when not (a settings file's rules refuse it first:
 *    a guard).
 * 4. A rollback signs the routes the server holds for the app (R29), and the
 *    health check of the deploy in force when this machine signed it; B12
 *    when what the old deploy ran cannot be reached by one. No DNS check.
 * 5. Each domain the server does not hold for the app yet, in domain order,
 *    looked up from this machine: B13 (the server's address is not known),
 *    B7 (no record), B8 (elsewhere), else B1, the line before the panel.
 *    With `--skip-dns-check`, B14 for each instead, and nothing looked up.
 * 6. Each domain it holds already: the same lookup; B15 when it moved away.
 *
 * A lookup that fails for another reason than "no record" is said with the
 * "could not look up" warning, and the deploy goes on. When any domain stops
 * the deploy, its sentence stands alone: nothing of the other domains is
 * said. Otherwise the lines are said in that order, new domains first. A
 * deploy with no route and no health check checks nothing, looks nothing up
 * and says nothing (CL7).
 */
import { LIMITS, type Health, type Route } from "@workspace/core"

import type { OpDeps, Team } from "../cli/context"
import { CliError } from "../cli/errors"
import { recordOf, serverAddresses } from "../domains/address"
import {
  firstAddress,
  lookUp,
  sharedAddress,
  type Looked,
} from "../domains/dns"
import { routeFault } from "../domains/routes"
import {
  B11,
  B12,
  B13,
  B14,
  B15,
  B7,
  B8,
  B9,
  LOOKUP_FAILED,
} from "../domains/words"
import type { Server } from "../profile/profile"
import { atMost } from "../shared/at-most"
import { verifiedDeploys } from "../shared/views"
import type { DeployCallbacks, DeployPlan } from "./deploy"
import { routesOfApp, type HeldRoutes } from "./status"

/** How many domains are looked up at the same time (contracts/cli.md, CL4). */
export const LOOKUPS_AT_ONCE = 8

/** What the deploy signs of its domains, once checked, and what the rest of the deploy needs of them. */
export type Domained = {
  /** The routes to sign, sorted by domain: the plan's, or a rollback's, the server's. */
  routes: readonly Route[]
  health: Health | null
  /** The deploy's domains the server did not hold for the app: the wait for HTTPS after the start is for them (B4 to B6). */
  newDomains: readonly string[]
  /** Whether the server would hold more domains than a runner keeps, so `too_large` is said as R10. */
  overDomains: boolean
}

/** One line a domain's check says, or the stop it is. */
type Said =
  | { kind: "stop"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "pointed"; domain: string; address: string }

/**
 * The health check of the deploy in force, numbered `accepted` on the
 * server, as this machine signed and recorded it: none when this machine
 * did not sign that deploy, or recorded no answer to it (research R29).
 */
function healthInForce(
  team: Pick<Team, "store" | "trust">,
  server: Server,
  app: string,
  accepted: number
): Health | null {
  const entry = verifiedDeploys(team, server, app).find(
    (each) => each.deploy.sequence === accepted && each.outcome !== "sent"
  )
  return entry?.deploy.health ?? null
}

/**
 * Whether a rollback asks the runner for the routes in force (step 4): yes,
 * unless the deploy in force, numbered `accepted`, is one this machine
 * signed, the runner answered `started` or `unhealthy` (so its routes were
 * put in force), and it signed no route. Then the app holds none, and
 * `status` is asked as before (CL7). Its health check comes from this
 * machine's history either way (`healthInForce`).
 */
export function rollbackAsksRoutes(
  team: Pick<Team, "store" | "trust">,
  server: Server,
  app: string,
  accepted: number
): boolean {
  const entry = verifiedDeploys(team, server, app).find(
    (each) => each.deploy.sequence === accepted
  )
  if (entry?.outcome !== "started" && entry?.outcome !== "unhealthy")
    return true
  return (entry.deploy.routes?.length ?? 0) > 0
}

/** Step 5's line for a domain the server does not hold for the app yet. */
function newDomainSaid(
  domain: string,
  server: string,
  looked: Looked,
  addresses: Awaited<ReturnType<typeof serverAddresses>>
): Said {
  if (looked.kind === "unknown")
    return { kind: "warning", text: LOOKUP_FAILED(domain) }
  const record = recordOf(addresses)
  if (addresses === undefined || record === undefined)
    return {
      kind: "warning",
      text: B13(
        domain,
        server,
        looked.kind === "found" ? firstAddress(looked.addresses) : undefined
      ),
    }
  if (looked.kind === "none")
    return { kind: "stop", text: B7(domain, record.type, record.address) }
  const shared = sharedAddress(looked.addresses, addresses)
  if (shared === undefined)
    return {
      kind: "stop",
      text: B8(
        domain,
        firstAddress(looked.addresses),
        server,
        record.type,
        record.address
      ),
    }
  return { kind: "pointed", domain, address: shared }
}

/**
 * Step 6's line for a domain the server holds for the app: B15 when it
 * points elsewhere, the "could not look up" warning when it cannot be told;
 * nothing when it matches, when the server's address is not known, or when
 * it has no record (lines.md has no sentence for a held domain whose record
 * is gone; `zekno domain` shows it as `no DNS record`).
 */
function heldDomainSaid(
  domain: string,
  server: string,
  app: string,
  looked: Looked,
  addresses: Awaited<ReturnType<typeof serverAddresses>>
): Said | undefined {
  if (looked.kind === "unknown")
    return { kind: "warning", text: LOOKUP_FAILED(domain) }
  if (looked.kind === "none" || addresses === undefined) return undefined
  if (sharedAddress(looked.addresses, addresses) !== undefined) return undefined
  return {
    kind: "warning",
    text: B15(domain, firstAddress(looked.addresses), server, app),
  }
}

/**
 * CL3's steps 2 to 6 for a deploy whose `status` was read (`held`: the
 * routes in force, when they were asked; `accepted`: its number for the
 * app; `answersRoutes`: the runner carries routes out, protocol 4). Throws
 * the first stop; says the warnings and B1 through `callbacks`. Gives what
 * the deploy signs of its domains.
 */
export async function checkDomains(input: {
  deps: Pick<OpDeps, "resolveDomain" | "sshHost">
  plan: DeployPlan
  held: HeldRoutes | undefined
  accepted: number
  answersRoutes: boolean
  callbacks: Pick<DeployCallbacks, "warning" | "pointed">
}): Promise<Domained> {
  const { deps, plan, held, accepted, callbacks } = input
  const { team, server, app } = plan
  const inForce = routesOfApp(held, app)
  const rollback = plan.rollback === true
  // Step 4: a rollback keeps the routes and the health check in force now, never the old deploy's (FR-019, User Story 6).
  const routes = rollback ? inForce : (plan.routes ?? [])
  const health = rollback
    ? input.answersRoutes
      ? healthInForce(team, server, app, accepted)
      : null
    : (plan.health ?? null)
  const others = Object.entries(held?.routes ?? {}).filter(
    ([holder]) => holder !== app
  )
  const overDomains =
    others.reduce((total, [, each]) => total + each.length, 0) + routes.length >
    LIMITS.domainsPerServer
  const domained = (newDomains: readonly string[]): Domained => ({
    routes,
    health,
    newDomains,
    overDomains,
  })
  if (routes.length === 0) return domained([])

  // Step 2, B9: the server tells which app holds each domain.
  for (const route of routes) {
    const holder = others.find(([, each]) =>
      each.some((other) => other.domain === route.domain)
    )?.[0]
    if (holder !== undefined)
      throw new CliError(B9(route.domain, holder, server.name))
  }

  // Steps 3 and 4: every route reaches its service in the text to be signed (FR-017). A rollback names the deploy whose
  // text it signs (B12); lines.md has no other sentence for that text holding the service on another port, so B12 says it too.
  const fault = routeFault(plan.compose, routes)
  if (fault !== undefined)
    throw new CliError(
      rollback && plan.rollbackOf !== undefined
        ? B12(plan.rollbackOf, fault.route.service, fault.route.domain)
        : B11(fault.route.service)
    )
  const holding = new Set(inForce.map((route) => route.domain))
  const fresh = routes
    .map((route) => route.domain)
    .filter((domain) => !holding.has(domain))
  if (rollback) return domained(fresh)

  // Step 5 with `--skip-dns-check`: B14 for each new domain, and nothing looked up, a held domain's neither.
  if (plan.skipDnsCheck === true) {
    for (const domain of fresh) callbacks.warning?.(B14(domain))
    return domained(fresh)
  }

  // Steps 5 and 6: the server's addresses once, and every domain looked up, at most eight at a time.
  const addresses = await serverAddresses(deps.sshHost, server.target)
  const domains = routes.map((route) => route.domain)
  const looked = await atMost(LOOKUPS_AT_ONCE, domains, (domain) =>
    lookUp(deps.resolveDomain, domain)
  )
  const found = new Map(
    domains.map((domain, index) => [domain, looked[index]!])
  )
  const said: Said[] = [
    ...fresh.map((domain) =>
      newDomainSaid(domain, server.name, found.get(domain)!, addresses)
    ),
    ...domains
      .filter((domain) => holding.has(domain))
      .flatMap((domain) => {
        const line = heldDomainSaid(
          domain,
          server.name,
          app,
          found.get(domain)!,
          addresses
        )
        return line === undefined ? [] : [line]
      }),
  ]
  const stop = said.find((line) => line.kind === "stop")
  if (stop !== undefined) throw new CliError(stop.text)
  for (const line of said)
    if (line.kind === "warning") callbacks.warning?.(line.text)
    else if (line.kind === "pointed")
      callbacks.pointed?.(line.domain, line.address)
  return domained(fresh)
}
