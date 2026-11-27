/**
 * `zekno doctor`'s Proxy line (specs/015-domains-https, contracts/cli.md,
 * CL6; lines E3, E4; FR-038), in a file of its own beside ops/doctor.ts.
 * Doctor asks `status` with routes of a runner of protocol 4 on the
 * session it already opens (ops/status.ts `askStatus`), which reads the
 * runner's state and Docker and changes nothing; from that answer:
 *
 * - no app holds a route, or the runner was not asked: no line;
 * - `running`: E3, good, with the number of domains the server holds;
 * - `stopped` or `missing`: E4, a problem;
 * - `other_image`: a warning in E4's pattern, `an older version`, with
 *   `Deploy an app with a domain to replace it` under it.
 *
 * E5, a taken port, is not a line of doctor: the runner cannot know it
 * without starting the proxy, and the deploy that tried says it (B16;
 * research R34).
 */
import { E3, E4, OTHER_IMAGE, PROXY_LABEL } from "../domains/words"
import type { CheckLine } from "./doctor"
import type { HeldRoutes } from "./status"

/** The Proxy line for a server whose runner answered `held`, or undefined when there is none to show. The health checks in force play no part. */
export function proxyLine(
  held: Pick<HeldRoutes, "routes" | "proxy"> | undefined
): CheckLine | undefined {
  if (held === undefined) return undefined
  const domains = Object.values(held.routes).reduce(
    (total, routes) => total + routes.length,
    0
  )
  if (domains === 0) return undefined
  const line = { check: "proxy", label: PROXY_LABEL } as const
  if (held.proxy === "running")
    return { ...line, result: "good", detail: E3(domains) }
  if (held.proxy === "other_image") {
    return {
      ...line,
      result: "warning",
      detail: OTHER_IMAGE.detail,
      next: OTHER_IMAGE.next,
    }
  }
  // `stopped`, `missing`, and `none` though an app holds a route: nothing answers for its domains.
  return { ...line, result: "problem", detail: E4.detail, next: E4.next }
}
