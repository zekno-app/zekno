/**
 * A domain as a person types it (specs/015-domains-https, contracts/cli.md,
 * CL2; research R16): lowered first, then held to the core library's domain
 * rule, the one the runner reads a signed route by (`domainFault`), so the
 * CLI can tell "not a domain zekno can route" (A10) from "not yet" (A11).
 *
 * Both refusals name what was typed, lowered and cleaned (`sanitize`): it has
 * not passed its rule, so nothing in it may act on a terminal.
 */
import { domainFault, isRoutableDomain } from "@workspace/core"

import { sanitize } from "../server/sanitize"
import { A10, A11 } from "./words"

/** A typed domain lowered, as it is written to the settings file: every domain has one spelling. */
export const lowered = (typed: string): string => typed.toLowerCase()

/** A10 or A11 for a typed domain the rule refuses once lowered; undefined for one zekno routes. */
export function domainRefusal(typed: string): string | undefined {
  const fault = domainFault(typed)
  if (fault === undefined) return undefined
  const shown = sanitize(lowered(typed))
  return fault === "not_ascii" ? A11(shown) : A10(shown)
}

/** Whether a domain, as the settings file holds it, is one zekno routes: lowercase already, and the rule's. */
export const isDomain = (domain: string): boolean => isRoutableDomain(domain)

/** Why a domain the settings file holds is refused: `ascii` for letters outside ASCII (A11's rule), else A10's rule. */
export const fileFault = (domain: string): "ascii" | "rule" | undefined =>
  isRoutableDomain(domain)
    ? undefined
    : domainFault(domain) === "not_ascii"
      ? "ascii"
      : "rule"
