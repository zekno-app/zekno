/**
 * Looking a domain up from this machine (specs/015-domains-https,
 * contracts/cli.md, CL5; research R26; FR-014): `resolve4` and `resolve6` of
 * the machine's own resolver, 3 seconds a try, two tries. `lookup` is not
 * used: it read the hosts file and dropped IPv6 answers in the probes, and a
 * visitor gets neither. Nothing is sent to any service of zekno's or of
 * anyone zekno chose.
 *
 * `resolveDomain` is one of the three effects: main.ts gives it, and only
 * main.ts. Undefined, as in every test that sets no stand-in, means "cannot
 * tell", with no lookup made (`lookUp`). "No record" is both lists empty;
 * any other failure (no network, a resolver that does not answer) is thrown,
 * and `lookUp` takes it as "cannot tell" too.
 */
import { Resolver } from "node:dns/promises"
import { isIP } from "node:net"

import type { ServerAddresses } from "./address"
import { firstShared } from "./ip"

/** A domain's addresses, by family. Both empty: it has no A and no AAAA record. */
export type DomainAddresses = { v4: string[]; v6: string[] }

/** CL5's `resolveDomain(name)`. */
export type ResolveDomain = (name: string) => Promise<DomainAddresses>

/** How long one try waits for the resolver, and how many tries (CL5). */
export const LOOKUP_MS = 3000
export const LOOKUP_TRIES = 2

/** The most a lookup takes in all, however the resolver behaves: its tries, and a second to spare. */
export const LOOKUP_LIMIT_MS = LOOKUP_MS * LOOKUP_TRIES + 1000

/** The most addresses of a family kept from an answer: far more than a domain has, so a resolver's word stays small. */
const KEPT = 32

/** The two lookups a resolver gives, so a test can stand in for `node:dns`. */
export type Lookups = {
  resolve4(name: string): Promise<string[]>
  resolve6(name: string): Promise<string[]>
  cancel?(): void
}

/** The codes of "no such name" and "no record of that kind" (Bun answers `ENOTFOUND` for both). */
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA"])

/** A family's answer: its addresses that are addresses of that family, or none for "no record"; anything else is thrown. */
function family(asked: Promise<string[]>, kind: 4 | 6): Promise<string[]> {
  return asked.then(
    (found) =>
      (Array.isArray(found) ? found : [])
        .filter((address) => isIP(address) === kind)
        .slice(0, KEPT),
    (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code
      if (typeof code === "string" && NO_RECORD.has(code)) return []
      throw error
    }
  )
}

/**
 * `resolveDomain` over `make`'s resolver: by default `node:dns`'s, with the
 * time and tries of CL5. An address is its own answer. A lookup that takes
 * longer than `limitMs` in all (`LOOKUP_LIMIT_MS`) is given up and thrown.
 */
export function resolverOf(
  make: () => Lookups = () =>
    new Resolver({ timeout: LOOKUP_MS, tries: LOOKUP_TRIES }),
  limitMs = LOOKUP_LIMIT_MS
): ResolveDomain {
  return async (name) => {
    const kind = isIP(name)
    if (kind !== 0)
      return { v4: kind === 4 ? [name] : [], v6: kind === 6 ? [name] : [] }
    const lookups = make()
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        lookups.cancel?.()
        reject(new Error("The lookup took too long."))
      }, limitMs)
    })
    try {
      const [v4, v6] = await Promise.race([
        Promise.all([
          family(lookups.resolve4(name), 4),
          family(lookups.resolve6(name), 6),
        ]),
        late,
      ])
      return { v4, v6 }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The real lookup, through this machine's resolver. Only main.ts hands it on. */
export const resolveDomain: ResolveDomain = resolverOf()

/** What a lookup found: `unknown` when it cannot tell, `none` with no record, else the addresses. */
export type Looked =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "found"; addresses: DomainAddresses }

/** Looks `domain` up with `resolve`. Undefined, or a lookup that fails for another reason than "no record": `unknown`. */
export async function lookUp(
  resolve: ResolveDomain | undefined,
  domain: string
): Promise<Looked> {
  if (resolve === undefined) return { kind: "unknown" }
  let found: DomainAddresses
  try {
    found = await resolve(domain)
  } catch {
    return { kind: "unknown" }
  }
  const v4 = Array.isArray(found?.v4) ? found.v4 : []
  const v6 = Array.isArray(found?.v6) ? found.v6 : []
  if (v4.length === 0 && v6.length === 0) return { kind: "none" }
  return { kind: "found", addresses: { v4, v6 } }
}

/** The first address a domain points to, IPv4 first: the one B8, B13, B15 and D5 name. */
export const firstAddress = (found: DomainAddresses): string =>
  found.v4[0] ?? found.v6[0]!

/** The first of the domain's addresses that is one of the server's, IPv4 first; undefined when none is. */
export const sharedAddress = (
  found: DomainAddresses,
  server: ServerAddresses
): string | undefined =>
  firstShared([...found.v4, ...found.v6], [...server.v4, ...server.v6])
