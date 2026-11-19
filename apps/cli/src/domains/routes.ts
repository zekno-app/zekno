/**
 * What a deploy signs of the two settings (specs/015-domains-https,
 * contracts/cli.md, CL3; data-model.md, "Signed"; research R14, R30): the
 * routes, a domain each, to its service and that service's port, sorted by
 * domain; the health check, the services that have one sorted by name, each
 * asked on its own port when it has a path, and one limit for the deploy, the
 * largest of theirs. And back: the settings a signed deploy was made from,
 * with its routes and health check put back on its services, for "changed,
 * not deployed". And the check of a route against a Compose text (FR-017,
 * B11, B12), which a deploy makes before signing.
 *
 * A folder with a Compose file written by hand has neither (settings/source.ts).
 */
import type { Health as SignedHealth, Route } from "@workspace/core"

import { aliasesTooMany, COMPOSE_READ_BYTES } from "../project/compose-file"
import type { ServiceSettings, Settings } from "../settings/types"
import { HEALTH_SECONDS } from "./words"

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The routes of the settings: one a domain, to its service and that service's port, sorted by domain. */
export function routesOf(settings: Settings): Route[] {
  return settings.services
    .flatMap(([service, each]) =>
      each.port === undefined
        ? []
        : (each.domains ?? []).map((domain) => ({
            domain,
            service,
            port: each.port!,
          }))
    )
    .sort((a, b) => byText(a.domain, b.domain))
}

/**
 * The health check of the settings (R14), or null when no service has one:
 * each service that has one, by name, asked `GET <path>` on its own port
 * when it has a path; the limit, the largest of theirs, 60 seconds for one
 * the file leaves out. The file's rules make every path's service have a
 * port (SV44).
 */
export function healthOf(settings: Settings): SignedHealth | null {
  const checked = settings.services
    .filter(([, service]) => service.health !== undefined)
    .sort(([a], [b]) => byText(a, b))
  if (checked.length === 0) return null
  return {
    timeout: Math.max(
      ...checked.map(([, service]) => service.health!.timeout ?? HEALTH_SECONDS)
    ),
    services: checked.map(([service, { health, port }]) => ({
      service,
      http:
        health!.path === undefined || port === undefined
          ? null
          : { port, path: health!.path },
    })),
  }
}

/** Whether a deploy of `routes` and `health` asks the runner for either, so needs protocol 4 (CL3, step 1). */
export const isRouted = (
  routes: readonly Route[] | undefined,
  health: SignedHealth | null | undefined
): boolean => (routes?.length ?? 0) > 0 || (health ?? null) !== null

/**
 * The settings a signed deploy was made from, with its routes and its
 * health check put back on its services (research R30): each service's
 * domains, in domain order, and its health check with its path and the
 * deploy's limit, the only one the deploy signs. Only compared, never
 * signed, sent or written.
 */
export function withRoutes(
  settings: Settings,
  routes: readonly Route[],
  health: SignedHealth | null
): Settings {
  return {
    version: 1,
    services: settings.services.map(([name, service]) => {
      const next: {
        -readonly [Key in keyof ServiceSettings]: ServiceSettings[Key]
      } = { ...service }
      const domains = routes
        .filter((route) => route.service === name)
        .map((route) => route.domain)
      if (domains.length > 0) next.domains = domains
      const checked = health?.services.find((entry) => entry.service === name)
      if (checked !== undefined && health !== null)
        next.health = {
          ...(checked.http === null ? {} : { path: checked.http.path }),
          timeout: health.timeout,
        }
      return [name, next] as const
    }),
  }
}

/** Why a route cannot reach its service in a Compose text: the service is not there, or it has not that port. */
export type RouteFault = { route: Route; kind: "missing" | "no_port" }

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A port a Compose service exposes: `3000`, `"3000"`, `"8080:3000"`, `"127.0.0.1:8080:3000/tcp"`, or `{ target: 3000 }`. */
function portOf(entry: unknown): number | undefined {
  if (isMap(entry)) return portOf(entry.target)
  if (typeof entry !== "number" && typeof entry !== "string") return undefined
  const last = String(entry)
    .split(":")
    .at(-1)!
    .replace(/\/[a-z]+$/, "")
  return /^[1-9][0-9]{0,4}$/.test(last) ? Number(last) : undefined
}

/**
 * The services of a Compose text, each with the ports it exposes (`expose`
 * and the container's side of `ports`), or undefined when the text is not
 * a Compose file this can read. Bounded and its aliases counted before it is
 * parsed, as `composeServices` reads one (shared/views.ts).
 */
export function servicePorts(
  compose: string
): Map<string, Set<number>> | undefined {
  if (compose.length > COMPOSE_READ_BYTES || aliasesTooMany(compose))
    return undefined
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(compose)
  } catch {
    return undefined
  }
  const services = isMap(parsed) ? parsed.services : undefined
  if (!isMap(services)) return undefined
  const found = new Map<string, Set<number>>()
  for (const [name, service] of Object.entries(services)) {
    const ports = new Set<number>()
    if (isMap(service))
      for (const field of [service.expose, service.ports])
        if (Array.isArray(field))
          for (const entry of field) {
            const port = portOf(entry)
            if (port !== undefined) ports.add(port)
          }
    found.set(name, ports)
  }
  return found
}

/**
 * The first route, in domain order, whose service is not in the Compose
 * text, or does not have the route's port there (FR-017; B11 and B12 say
 * them); undefined when every route reaches its service. A text this cannot
 * read reaches none.
 */
export function routeFault(
  compose: string,
  routes: readonly Route[]
): RouteFault | undefined {
  if (routes.length === 0) return undefined
  const services = servicePorts(compose)
  for (const route of routes) {
    const ports = services?.get(route.service)
    if (ports === undefined) return { route, kind: "missing" }
    if (!ports.has(route.port)) return { route, kind: "no_port" }
  }
  return undefined
}
