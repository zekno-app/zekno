/**
 * The wait for HTTPS after a deploy that started with domains new to the app
 * (specs/015-domains-https, contracts/cli.md, CL3, "The answer"; B4 to B6;
 * FR-031), shared by `zekno deploy` (commands/deploy.ts) and the app
 * (app/effects/deploys.ts): each new domain, in domain order, asked from this
 * machine (domains/https.ts) until it answers with a valid certificate or 60
 * seconds have passed since the wait began. Each domain's state is told as it
 * changes; the deploy's outcome and exit status do not depend on it.
 */
import type { OpDeps } from "../cli/context"
import { waitForHttps, type HttpsResult } from "../domains/https"
import type { HttpsShown } from "../shared/deploy"
import type { DeployResult } from "./deploy"

/** A domain's end of the wait, as a view shows it: live with its last day (B5), or not ready (B6). */
export const httpsShownOf = (end: HttpsResult): HttpsShown =>
  end.until === undefined
    ? { domain: end.domain, state: "not_ready" }
    : { domain: end.domain, state: "live", until: end.until }

/**
 * Waits for the new domains of a deploy that started, telling `shown` each
 * domain's state as it changes (B4, then B5 or B6), and gives each one's end
 * of the wait. Undefined, with nothing asked and nothing told, after any
 * other outcome, with no new domain, or when `probeHttps` is not given
 * (CL5, "not looked up").
 */
export async function httpsAfter(
  deps: Pick<OpDeps, "probeHttps">,
  result: Pick<DeployResult, "outcome" | "newDomains">,
  shown: (state: HttpsShown) => void
): Promise<HttpsShown[] | undefined> {
  const probe = deps.probeHttps
  if (
    probe === undefined ||
    result.outcome !== "started" ||
    result.newDomains.length === 0
  )
    return undefined
  const done = await waitForHttps({
    probe,
    domains: result.newDomains,
    began: Date.now(),
    waiting: (domain, since) => shown({ domain, state: "waiting", since }),
    answered: (end) => shown(httpsShownOf(end)),
  })
  return done.map(httpsShownOf)
}
