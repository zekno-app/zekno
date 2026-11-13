import type { Deps } from "../context"
import { linkFolder, type LinkInput } from "../ops/link"
import { shownPath } from "../project"
import { sanitize } from "../sanitize"

/** Writes zekno.json in this folder, and says what it holds. */
export async function link(deps: Deps, options: LinkInput): Promise<void> {
  const linked = await linkFolder(deps, options)
  deps.ui.success(
    `Wrote ${shownPath(linked.path)}: this folder deploys ${linked.app} to ${linked.server} from ${sanitize(linked.compose)}. It holds no secret and is safe to commit.`
  )
}
