/**
 * The health check and routes of the signed deploy's version 2 (contracts/
 * message.md, F35 to F40), with the path rule (F38) and the domain rule (F40).
 * A runner carries them out since feature 015 (specs/015-domains-https,
 * contracts/core.md), so they are no longer later fields; their format is
 * unchanged. The rules are exported so the CLI checks what a person types by
 * the same rules a runner reads a deploy by.
 *
 * This module imports nothing of the deploy or of the messages: the stored
 * state (`state.ts`) and the answer to `status` (`protocol/session.ts`) read
 * routes by `RouteSchema` and the health check in force by
 * `HealthInForceSchema` too.
 */
import { z } from "zod"

import { LIMITS } from "../protocol/limits"
import { SERVICE_NAME } from "../protocol/service-name"

const seconds = (max: number) => z.number().int().min(1).max(max)
const port = z.number().int().min(1).max(65535)
const service = z.string().regex(SERVICE_NAME)

/**
 * An HTTP path and query, as RFC 3986 allows them: no space, no `#`, and `%`
 * only before two hex digits.
 */
const PATH = /^\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2}){0,1023}$/

/** The path rule (F38): a path as `PATH` allows it, at most 1,024 characters. */
export function isHealthPath(text: string): boolean {
  return (
    typeof text === "string" &&
    text.length <= LIMITS.healthPathLength &&
    PATH.test(text)
  )
}

/** When the deploy counts as done: each service up, and answering on `http` if given (part 4.3). */
export const HealthSchema = z.strictObject({
  timeout: seconds(LIMITS.healthSeconds),
  services: z
    .array(
      z.strictObject({
        service,
        http: z
          .strictObject({
            port,
            path: z.string().refine(isHealthPath),
          })
          .nullable(),
      })
    )
    .min(1)
    .max(LIMITS.healthServices),
})
export type Health = z.infer<typeof HealthSchema>

/**
 * A health check in force (specs/015-domains-https, contracts/core.md, "The
 * state" and "`status` with routes"): by `HealthSchema`, with its services
 * sorted and each once, as a signed deploy's are once read (F6). The runner
 * keeps each app's by it, and the CLI reads the runner's answer by it before
 * a rollback signs that check again.
 */
export const HealthInForceSchema = HealthSchema.refine((health) =>
  health.services.every(
    (entry, index) =>
      index === 0 || health.services[index - 1]!.service < entry.service
  )
)

/**
 * Bytes the health checks in force take, by app, as the answer to `status`
 * with routes writes them: at most `LIMITS.healthBytesPerServer` on one
 * server, so that answer always fits its frame.
 */
export const healthBytes = (health: Readonly<Record<string, Health>>): number =>
  new TextEncoder().encode(JSON.stringify(health)).length

/** Names that never reach the public internet, or that this program keeps for itself (`zekno.invalid`). */
const SPECIAL_USE = new Set([
  "localhost",
  "invalid",
  "test",
  "example",
  "local",
  "internal",
  "alt",
  "onion",
  "arpa",
])

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The domain rule (F40, as core.md changes it). Lowercase ASCII, at most 253
 * characters, at least two labels of 1 to 63 letters, digits and hyphens,
 * none starting or ending with a hyphen; no label starting `xn--`; a last
 * label that is not all digits (never an address); not a special-use name or
 * under one. So every domain has one spelling, comparing the text compares
 * the domains, and a name a browser shows in other letters is not taken at
 * all: such names are not in this version (research R16). The input is not
 * lowered here: a signed route with an upper-case letter is refused.
 */
export function isRoutableDomain(domain: string): boolean {
  if (typeof domain !== "string" || domain.length > LIMITS.domainLength)
    return false
  const labels = domain.split(".")
  if (labels.length < 2) return false
  for (const label of labels) {
    if (!LABEL.test(label) || label.startsWith("xn--")) return false
  }
  const last = labels.at(-1)!
  return !/^[0-9]+$/.test(last) && !SPECIAL_USE.has(last)
}

/** Why a domain a person typed is not taken: names outside ASCII are not in this version; anything else is never routed. */
export type DomainFault = "not_ascii" | "not_routable"

/**
 * Why `text`, lowered, is not a domain zekno routes, or undefined when it is
 * (core.md, the domain rule). `not_ascii` when it has a character outside
 * printable ASCII (space to `~`) or a label starting `xn--`, in either
 * spelling a name in other letters; `not_routable` for anything else the
 * rule refuses. So the CLI can tell "not a domain zekno can route" from "not
 * yet".
 */
export function domainFault(text: string): DomainFault | undefined {
  if (typeof text !== "string") return "not_routable"
  const lowered = text.toLowerCase()
  if (
    /[^\x20-\x7e]/.test(lowered) ||
    lowered.split(".").some((label) => label.startsWith("xn--"))
  )
    return "not_ascii"
  return isRoutableDomain(lowered) ? undefined : "not_routable"
}

/** Where a domain's traffic goes: a service of the app and a port of its containers (part 4.2). */
export const RouteSchema = z.strictObject({
  domain: z.string().refine(isRoutableDomain),
  service,
  port,
})
export type Route = z.infer<typeof RouteSchema>
