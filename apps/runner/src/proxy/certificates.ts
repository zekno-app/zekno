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
 * The deletion says which domains' certificates are known to be gone. The
 * others stay in the state's list of released domains, and are tried again
 * at every deploy and every `proxy` request until a deletion works
 * (`routes/released.ts`), so a failed `docker exec` or a Docker that did not
 * answer never leaves a key on disk for good.
 *
 * No OCSP staple is deleted any more: Let's Encrypt has stopped OCSP, and the
 * glob `ocsp/<domain>-*` also reached another domain's staple, releasing
 * `a.example.co` deleting `a.example.co-op.example.com`'s (security review
 * S5). RN10's step 1 names the certificate's folder only.
 */
import { isRoutableDomain } from "@workspace/core"

import { volumeExists } from "../docker/objects"
import { NOT_STARTED, runDocker, TIMED_OUT } from "../docker/run"
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
 * Runs the deletion of each domain with `run`, in order, and gives the
 * domains whose deletion exited 0. A call Docker did not finish in its time,
 * or that could not start, ends the round: Docker is not answering, and each
 * call after it would wait out its own limit. What was not tried is not gone.
 */
async function eachDeleted(
  scripts: readonly { domain: string; script: string }[],
  run: (script: string) => Promise<number>
): Promise<string[]> {
  const gone: string[] = []
  for (const { domain, script } of scripts) {
    const code = await run(script)
    if (code === 0) gone.push(domain)
    else if (code === TIMED_OUT || code === NOT_STARTED) break
  }
  return gone
}

/**
 * Deletes the certificate and key of each of `domains`, and gives those known
 * to be gone. Inside the proxy when it runs: gone when the deletion exited 0.
 * Else, when it is this runner's and stopped or gone, through a short-lived
 * container with no network and no capability, only when the volume is
 * there, since mounting one that is not would make it: gone when the deletion
 * exited 0; every one gone when Docker says there is no volume, since there
 * is nothing to delete. None is gone when the proxy is another server's,
 * which is not touched, nor when Docker did not answer, about the proxy or
 * about the volume. A domain that does not match the domain rule is never
 * put in a shell, so it is never gone. Nothing here is reported (RN10).
 */
export async function deleteCertificates(
  dir: string,
  proxy: FoundProxy | undefined,
  domains: readonly string[]
): Promise<string[]> {
  const scripts = domains.flatMap((domain) => {
    const script = deletion(domain)
    return script === undefined ? [] : [{ domain, script }]
  })
  if (scripts.length === 0 || proxy === undefined || proxy.kind === "foreign")
    return []
  if (proxy.kind === "ours" && proxy.running)
    return eachDeleted(
      scripts,
      async (script) =>
        (await runDocker(dir, ["exec", PROXY, "sh", "-c", script])).code
    )
  const volume = await volumeExists(dir, DATA_VOLUME)
  if (volume === false) return scripts.map((each) => each.domain)
  if (volume === undefined) return []
  return eachDeleted(
    scripts,
    async (script) =>
      (
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
      ).code
  )
}
