/**
 * A released domain's certificate and key (specs/015-domains-https,
 * contracts/runner.md, RN10; research R10). Caddy keeps them under
 * `/data/caddy/certificates/<issuer>/<domain>/` in the proxy's volume. They
 * are deleted once a configuration without the domain is loaded: deleted
 * before, Caddy would keep serving from memory and ask for a new certificate
 * at its next start. A proxy that does not run serves nothing from memory, so
 * then they are deleted through a short-lived container of the pinned image
 * that mounts the volume, and a released domain's key never stays on disk
 * because the proxy was stopped or gone (security review S2).
 *
 * No OCSP staple is deleted any more: Let's Encrypt has stopped OCSP, and the
 * glob `ocsp/<domain>-*` also reached another domain's staple, releasing
 * `a.example.co` deleting `a.example.co-op.example.com`'s (security review
 * S5). RN10's step 1 names the certificate's folder only.
 */
import { isRoutableDomain } from "@workspace/core"

import { volumeExists } from "../docker/objects"
import { runDocker } from "../docker/run"
import { DATA_VOLUME, type FoundProxy } from "./container"
import { PROXY_IMAGE } from "./image"
import { PROXY } from "./log"

/** A domain as the domain rule allows it, checked here character by character too. */
const DOMAIN = /^[a-z0-9.-]{1,253}$/

/**
 * The one shell the runner runs, inside the proxy's container or a
 * short-lived one of the same image: it deletes the folders the proxy keeps
 * for `domain`, for every issuer. The domain is put in it only once it has
 * matched the domain rule here, so it holds nothing but letters, digits,
 * hyphens and dots, and cannot end the quotes or reach another folder.
 * Undefined when the domain does not match.
 */
function deletion(domain: string): string | undefined {
  if (!DOMAIN.test(domain) || !isRoutableDomain(domain)) return undefined
  return `rm -rf "/data/caddy/certificates/"*"/${domain}"`
}

/**
 * Deletes the certificate and key of each of `domains`: inside the proxy
 * when it runs; else, when it is this runner's and stopped or gone, through a
 * short-lived container with no network and no capability, and only when
 * the volume is there, since mounting one that is not would make it. A proxy
 * of another server's, or a Docker that did not answer, is not touched. A
 * failure is not reported (RN10).
 */
export async function deleteCertificates(
  dir: string,
  proxy: FoundProxy | undefined,
  domains: readonly string[]
): Promise<void> {
  const scripts = domains
    .map(deletion)
    .filter((script): script is string => script !== undefined)
  if (scripts.length === 0 || proxy === undefined || proxy.kind === "foreign")
    return
  if (proxy.kind === "ours" && proxy.running) {
    for (const script of scripts)
      await runDocker(dir, ["exec", PROXY, "sh", "-c", script])
    return
  }
  if (!(await volumeExists(dir, DATA_VOLUME))) return
  for (const script of scripts)
    await runDocker(dir, [
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${DATA_VOLUME}:/data`,
      PROXY_IMAGE,
      "sh",
      "-c",
      script,
    ])
}
