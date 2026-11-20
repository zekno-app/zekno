/**
 * The released domains whose certificate is still to delete (specs/
 * 015-domains-https, contracts/runner.md, RN3, RN10, RN13; core.md, "The
 * state"). The state that releases a domain lists it in the same write
 * (`withAppRoutes`); each deletion is tried after a load that worked, at
 * every deploy and every `proxy` request, and a domain whose certificate is
 * known to be gone is then taken off the list. A deletion that fails keeps
 * its domain on the list for the next try. Nothing here is reported, and
 * nothing here throws: the deploy or the request it follows keeps its own
 * outcome.
 */
import { withoutReleased, type StoredRunnerState } from "@workspace/core"

import { isReport, load } from "../commands/commands"
import { writeState } from "../home/home"
import { deleteCertificates } from "../proxy/certificates"
import { findProxy, type FoundProxy } from "../proxy/container"

/**
 * Deletes the certificate of each of `released`, the list as the state has
 * it, with the proxy as `found` says, then saves the state with those known
 * to be gone taken off. The state is read again before it is written, and
 * written only when the list changed.
 */
export async function deleteReleased(
  dir: string,
  found: FoundProxy | undefined,
  released: readonly string[]
): Promise<void> {
  try {
    const gone = await deleteCertificates(dir, found, released)
    if (gone.length === 0) return
    const fresh = load(dir)
    if (isReport(fresh)) return
    const next = withoutReleased(fresh.state, gone)
    if (next.released.length !== fresh.state.released.length)
      writeState(dir, next)
  } catch {
    // Not saved: the domains stay on the list, and the next try deletes them again.
  }
}

/**
 * Tries the list of `state` again, as a deploy with no route and no health
 * check that held none does after `up` (RN3), and the `proxy` request once
 * the proxy is what the state needs (RN13): the proxy found, the deletions,
 * the state saved. With an empty list, no Docker call is made.
 */
export async function retryReleased(
  dir: string,
  state: StoredRunnerState
): Promise<void> {
  if (state.released.length === 0) return
  const found = await findProxy(dir, state.serverId)
  await deleteReleased(dir, found, state.released)
}
