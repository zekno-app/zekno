/**
 * A released domain's certificate and key (specs/015-domains-https,
 * contracts/runner.md, RN10; research R10). Caddy keeps them under
 * `/data/caddy/certificates/<issuer>/<domain>/` in the proxy's volume. They
 * are deleted once a configuration without the domain is loaded: deleted
 * before, Caddy would keep serving from memory and ask for a new certificate
 * at its next start.
 */
import { isRoutableDomain } from "@workspace/core"

import { runDocker } from "../docker/run"
import { PROXY } from "./log"

/** A domain as the domain rule allows it, checked here character by character too. */
const DOMAIN = /^[a-z0-9.-]{1,253}$/

/**
 * Deletes the folders the proxy keeps for `domain`, for every issuer, and its
 * OCSP staples. This is the one shell the runner runs, inside the proxy's
 * container: the domain is put in it only once it has matched the domain rule
 * here, so it holds nothing but letters, digits, hyphens and dots, and cannot
 * end the quotes or reach another folder. False when the domain did not
 * match, or Docker failed.
 */
export async function deleteCertificates(
  dir: string,
  domain: string
): Promise<boolean> {
  if (!DOMAIN.test(domain) || !isRoutableDomain(domain)) return false
  const removed = await runDocker(dir, [
    "exec",
    PROXY,
    "sh",
    "-c",
    `rm -rf "/data/caddy/certificates/"*"/${domain}" "/data/caddy/ocsp/${domain}-"*`,
  ])
  return removed.code === 0
}
