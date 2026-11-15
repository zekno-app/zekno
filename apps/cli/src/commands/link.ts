import type { Deps } from "../cli/context"
import { linkFolder, type LinkInput } from "../ops/link"
import { shownPath } from "../project/project"
import { sanitize } from "../server/sanitize"

/**
 * Writes zekno.json in this folder, signed, or records as used here the one
 * signed by the team that applies, once asked (at a terminal; `--yes`
 * without one), and says what it holds.
 */
export async function link(deps: Deps, options: LinkInput): Promise<void> {
  const linked = await linkFolder(deps, options, (question, refusal) => deps.ui.confirm(question, refusal))
  if (linked.done !== "written") {
    const which = linked.here ? "zekno.json" : shownPath(linked.path)
    const names = `${linked.app} on ${linked.server}, file ${sanitize(linked.compose)}`
    return deps.ui.success(linked.done === "in use" ? `Already in use: ${which}, ${names}.` : `Accepted ${which}: ${names}.`)
  }
  // It holds no secret and no key; what its signature vouches for is the names, not what the Compose file says.
  deps.ui.success(`Wrote ${shownPath(linked.path)}: this folder deploys ${linked.app} to ${linked.server} from ${sanitize(linked.compose)}. It holds no secret.`)
}
