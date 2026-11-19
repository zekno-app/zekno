/**
 * After `zekno server update` replaced a runner (specs/015-domains-https,
 * contracts/cli.md, CL6; research R21): when the new runner speaks protocol
 * 4 and holds a route, it is sent `proxy`, which makes the proxy match the
 * routes already in force, such as replacing a proxy of another image. It
 * needs no signature: it puts in force no route a signed deploy did not. Kept
 * out of ops/server.ts, which is past 500 lines.
 *
 * Its failure is said with B16's or B19's words for the server
 * (words-extra.ts); nothing else is said, and the update itself stands.
 */
import { RunnerProxySchema } from "@workspace/core"

import { reach, type OpDeps } from "../cli/context"
import { CliError } from "../cli/errors"
import { proxyNotLoaded, proxyPortTaken } from "../domains/words-extra"
import type { Server } from "../profile/profile"
import { namedUnreachable, withSession } from "../server/session"
import { askStatus } from "./status"

/**
 * Sends `proxy` to the runner of `server` when it holds a route, over a
 * session of its own: undefined when there was nothing to do or it worked,
 * else the sentence that says why the proxy is not as it should be. The
 * runner must answer as the server that was connected: its server id is
 * derived from its key and checked against the profile's.
 */
export async function proxyAfterUpdate(
  deps: OpDeps,
  server: Server
): Promise<string | undefined> {
  try {
    return await withSession(reach(deps, server.target), async (session) => {
      const { status, held } = await askStatus(session, true)
      if (status.serverId !== server.serverId)
        throw new CliError(
          `"${server.name}" answered as a different server than the one that was connected.`
        )
      if (held === undefined || Object.keys(held.routes).length === 0)
        return undefined
      const answer = await session.request("proxy", RunnerProxySchema)
      if ("proxy" in answer) return undefined
      return answer.routes?.failure === "port_taken"
        ? proxyPortTaken(server.name, answer.routes.port ?? 80)
        : proxyNotLoaded(server.name)
    })
  } catch (error) {
    const named = namedUnreachable(error, server.name)
    if (named instanceof CliError) return named.message
    throw error
  }
}
