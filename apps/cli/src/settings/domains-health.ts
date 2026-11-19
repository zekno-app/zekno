/**
 * The two settings feature 015 brings (specs/015-domains-https,
 * contracts/cli.md, CL1; research R14, R31): `networking.domains` and
 * `deploy.healthcheck`. Their rules, their words, and what `zekno settings
 * set` and `unset` do with the keys `<service>.domains`, `<service>.health`
 * and `<service>.health-timeout`. The rest of settings/ calls in here, so
 * that words.ts, over 500 lines already, does not grow.
 *
 * - `domains`: 1 to 64 lowercase names held to the core library's domain
 *   rule, none twice in the file, under a service with a port. Typed, the
 *   whole list, comma-separated and lowered; a name refused is said with
 *   A10 or A11 (design/lines.md), naming it.
 * - `healthcheck`: a strict object, `path` held to the core library's path
 *   rule (and then the service needs a port) and `timeout` a whole number of
 *   seconds from 1 to 1,800, 60 when left out. Typed: a path, or `up` for
 *   none; the limit apart, kept when the path changes.
 *
 * Words not on a board (the rules of the file, and those of a value typed),
 * each with its id, follow the sentences of feature 010 they sit beside, and
 * reuse the approved lines where one says it: A10's and A11's rules, A13's
 * first sentence, SV15's rule.
 */
import { isHealthPath, LIMITS } from "@workspace/core"

import { domainRefusal, lowered } from "../domains/rule"
import {
  A10_RULE,
  A11_RULE,
  A13_FIRST,
  DOMAINS_LABEL,
  domainsShown,
  HEALTH_LABEL,
  HEALTH_NOT_SET,
  HEALTH_SECONDS,
  healthShown,
} from "../domains/words"
import type { Health, ServiceSettings, Settings } from "./types"

/** The most domains a service, and a file, may name: the routes one deploy carries (CL1). */
export const MAX_DOMAINS = LIMITS.routesPerDeploy
/** The most services one deploy's health check looks at. */
export const MAX_HEALTH_CHECKS = LIMITS.healthServices
/** The longest a health check may wait, in seconds (CL1). */
export const MAX_HEALTH_SECONDS = LIMITS.healthSeconds

/** A limit in seconds as the JSON number is written: a whole number with no sign, exponent or fraction. At most 1,800 is checked apart. */
const SECONDS = /^[1-9][0-9]{0,3}$/

/** The settings keys of feature 015. */
export type RouteKey = "domains" | "health" | "health-timeout"

/** A place in the file and the rule it breaks, as settings/words.ts's `PlaceRule`. */
type PlaceRule = { place: string; rule: string }
const at = (place: string, rule: string): PlaceRule => ({ place, rule })

/** A sentence's rule as the rule after a place: its first letter lowered, its full stop before `(line n)`. */
const ruleAt = (sentence: string, n: number): string =>
  `${sentence.charAt(0).toLowerCase()}${sentence.slice(1, -1)} (line ${n}).`

/** The limit of a health check in seconds: as written, or 60. */
export const secondsOf = (health: Health): number =>
  health.timeout ?? HEALTH_SECONDS

/** A health check as its row and the change line read it (C5, C6), or C5's `not set`. */
export const healthWords = (health: Health | undefined): string =>
  health === undefined
    ? HEALTH_NOT_SET
    : healthShown(health.path, secondsOf(health))

/** A limit in seconds, as written in the file: 1 to 1,800. */
export function checkHealthTimeout(text: string): string | undefined {
  return SECONDS.test(text) && Number(text) <= MAX_HEALTH_SECONDS
    ? undefined
    : routeWords("health-timeout").rule
}

// The rules of the file, with ids after feature 010's SV33.

/** SV34: `domains` is not a list of names. */
export const SV34 = (svc: string): PlaceRule =>
  at(
    `${svc}, networking.domains`,
    'use a list of names, such as ["shop.example.com"].'
  )
/** SV35: a name the domain rule refuses, A10's rule; `ascii`: letters outside ASCII, A11's. */
export const SV35 = (svc: string, n: number, ascii: boolean): PlaceRule =>
  at(`${svc}, networking.domains`, ruleAt(ascii ? A11_RULE : A10_RULE, n))
/** SV36: as SV20, for a domain. */
export const SV36 = (svc: string, n: number): PlaceRule =>
  at(`${svc}, networking.domains`, `a name is there twice (line ${n}).`)
/** SV37: as SV21, for domains. */
export const SV37 = (svc: string): PlaceRule =>
  at(`${svc}, networking.domains`, `at most ${MAX_DOMAINS} names.`)
/** SV38: a domain needs a port, as SV15 says for `publish`. */
export const SV38 = (svc: string): PlaceRule =>
  at(
    `${svc}, networking.domains`,
    "set networking.port too, the port it reaches."
  )
/** SV39: one domain under one service; `other` is the service that names it first (A13's first sentence). */
export const SV39 = (svc: string, domain: string, other: string): PlaceRule =>
  at(`${svc}, networking.domains`, A13_FIRST(domain, other))
/** SV40: as SV32, for domains. */
export const SV40: PlaceRule = at(
  "services",
  `they name more than ${MAX_DOMAINS} domains, more than one deploy carries.`
)
/** SV41: `healthcheck` is not the object it should be. */
export const SV41 = (svc: string): PlaceRule =>
  at(
    `${svc}, deploy.healthcheck`,
    'use an object such as { "path": "/health", "timeout": 60 }; either may be left out.'
  )
/** SV42: a path the path rule refuses. */
export const SV42 = (svc: string): PlaceRule =>
  at(
    `${svc}, deploy.healthcheck.path`,
    "use a path such as /health: no space and no #, at most 1024 characters."
  )
/** SV43: a limit that is not 1 to 1,800 seconds. */
export const SV43 = (svc: string): PlaceRule =>
  at(
    `${svc}, deploy.healthcheck.timeout`,
    `use a whole number of seconds from 1 to ${MAX_HEALTH_SECONDS}.`
  )
/** SV44: a path needs a port, as SV15 says for `publish`. */
export const SV44 = (svc: string): PlaceRule =>
  at(
    `${svc}, deploy.healthcheck.path`,
    "set networking.port too, the port it reaches."
  )
/** SV45: as SV32, for health checks: one deploy's looks at 16 services at most. */
export const SV45: PlaceRule = at(
  "services",
  `they have more than ${MAX_HEALTH_CHECKS} health checks, more than one deploy carries.`
)

/**
 * The fault of one of this file's ids (SV34 to SV43; `SV35:ascii` for SV35
 * with A11's rule) at its place, with the line where it has one; undefined
 * for any other id. `path` is the issue's path in the file.
 */
export function routeFault(
  id: string,
  svc: string,
  path: readonly (string | number)[],
  lineOf: (path: readonly (string | number)[]) => number
): { said: PlaceRule; line?: number } | undefined {
  switch (id) {
    case "SV34":
      return { said: SV34(svc) }
    case "SV35":
    case "SV35:ascii":
      return {
        said: SV35(svc, lineOf(path), id !== "SV35"),
        line: lineOf(path),
      }
    case "SV36":
      return { said: SV36(svc, lineOf(path)), line: lineOf(path) }
    case "SV37":
      return { said: SV37(svc) }
    case "SV41":
      return { said: SV41(svc) }
    case "SV42":
      return { said: SV42(svc) }
    case "SV43":
      return { said: SV43(svc) }
  }
  return undefined
}

/**
 * The rules across services of CL1, in this order: a domain needs a port
 * (SV38), one domain under one service (SV39), a health path needs a port
 * (SV44), at most 64 domains (SV40), at most 16 health checks (SV45).
 */
export function acrossRoutes(settings: Settings): PlaceRule | undefined {
  const { services } = settings
  for (const [svc, service] of services)
    if (service.domains?.length && service.port === undefined) return SV38(svc)
  const named = new Map<string, string>()
  for (const [svc, service] of services)
    for (const domain of service.domains ?? []) {
      const other = named.get(domain)
      if (other !== undefined) return SV39(svc, domain, other)
      named.set(domain, svc)
    }
  for (const [svc, service] of services)
    if (service.health?.path !== undefined && service.port === undefined)
      return SV44(svc)
  if (named.size > MAX_DOMAINS) return SV40
  const checks = services.filter(([, service]) => service.health !== undefined)
  if (checks.length > MAX_HEALTH_CHECKS) return SV45
  return undefined
}

// `zekno settings set` and `unset` (CL1).

/** The words of each key: its label after `<svc> · `, its question, `That is not <a label>.`, and its rule. */
export function routeWords(key: RouteKey): {
  label: string
  question: string
  notA: string
  rule: string
} {
  switch (key) {
    case "domains":
      return {
        label: DOMAINS_LABEL,
        question: "Domains",
        notA: "That is not a list of domains zekno can route.",
        rule: A10_RULE,
      }
    case "health":
      return {
        label: HEALTH_LABEL,
        question: "Health check",
        notA: "That is not a health check.",
        rule: "Use a path such as /health, or up to wait until the service stays up.",
      }
    case "health-timeout":
      return {
        label: HEALTH_LABEL,
        question: "Health check limit",
        notA: "That is not a time limit.",
        rule: `Use a whole number of seconds from 1 to ${MAX_HEALTH_SECONDS}.`,
      }
  }
}

/** The words of each key when it is not set (C5, E1). */
export const ROUTE_NOT_SET: Record<RouteKey, string> = {
  domains: domainsShown([]),
  health: HEALTH_NOT_SET,
  "health-timeout": HEALTH_NOT_SET,
}

/**
 * A value typed for one of the keys, read as the setting holds it: domains
 * split on `,`, spaces around each dropped, each lowered; a health check's
 * path, or `up`; a limit as a number. Refused: the sentence to say. A domain
 * refused is A10 or A11, naming it, as `zekno domain add` says it; a list
 * with an empty name is the key's own words.
 */
export function readRouteValue(
  key: RouteKey,
  text: string
): { value: string | number | readonly string[] } | { refused: string } {
  const words = routeWords(key)
  switch (key) {
    case "domains": {
      const names = text.split(",").map((name) => name.replace(/^ +| +$/g, ""))
      for (const name of names) {
        if (name === "") return { refused: `${words.notA} ${words.rule}` }
        const refused = domainRefusal(name)
        if (refused !== undefined) return { refused }
      }
      return { value: names.map(lowered) }
    }
    case "health":
      return text === "up" || isHealthPath(text)
        ? { value: text }
        : { refused: words.rule }
    case "health-timeout":
      return checkHealthTimeout(text) === undefined
        ? { value: Number(text) }
        : { refused: words.rule }
  }
}

/** How one of the keys reads in a service, or undefined when it is not set. */
export function routeShown(
  service: ServiceSettings,
  key: RouteKey
): string | undefined {
  if (key === "domains")
    return service.domains === undefined
      ? undefined
      : domainsShown(service.domains)
  return service.health === undefined ? undefined : healthWords(service.health)
}

/** Whether `value` is what the key holds now: the same list, the same path (or none for `up`), the same limit. */
export function routeIsNow(
  service: ServiceSettings,
  key: RouteKey,
  value: string | number | readonly string[]
): boolean {
  const { health } = service
  switch (key) {
    case "domains": {
      const now = service.domains ?? []
      const next = value as readonly string[]
      return (
        now.length === next.length &&
        now.every((name, index) => name === next[index])
      )
    }
    case "health":
      return health !== undefined && (health.path ?? "up") === value
    case "health-timeout":
      return health !== undefined && secondsOf(health) === value
  }
}

/** Whether the key is set: the limit only when the file writes it. */
export function routeIsSet(service: ServiceSettings, key: RouteKey): boolean {
  if (key === "domains") return service.domains !== undefined
  if (key === "health") return service.health !== undefined
  return service.health?.timeout !== undefined
}

/** A health check of `path` and `timeout`, each only when given, in the order the file writes them. */
const healthOf = (path?: string, timeout?: number): Health => ({
  ...(path === undefined ? {} : { path }),
  ...(timeout === undefined ? {} : { timeout }),
})

/**
 * A service with the key set to `value`, or left out (`value` undefined): an
 * empty list of domains is left out; a new path keeps the limit; unset of
 * the health check removes it with its limit; unset of the limit keeps the
 * path.
 */
export function routeChanged(
  service: ServiceSettings,
  key: RouteKey,
  value: string | number | readonly string[] | undefined
): ServiceSettings {
  const next: {
    -readonly [Key in keyof ServiceSettings]: ServiceSettings[Key]
  } = { ...service }
  const { health } = service
  switch (key) {
    case "domains": {
      const domains = (value ?? []) as readonly string[]
      if (domains.length === 0) delete next.domains
      else next.domains = domains
      break
    }
    case "health":
      if (value === undefined) delete next.health
      else
        next.health = healthOf(
          value === "up" ? undefined : String(value),
          health?.timeout
        )
      break
    case "health-timeout":
      next.health = healthOf(
        health?.path,
        value === undefined ? undefined : Number(value)
      )
      break
  }
  return next
}
