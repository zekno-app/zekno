import type { Deps } from "../cli/context"
import { createTeam } from "../ops/init"

/** Creates the signing key in the keychain and starts a team with this person as its admin. */
export async function init(
  deps: Deps,
  options: { name?: string }
): Promise<void> {
  const created = await createTeam(deps, options.name)
  deps.ui.success("Team created. Your signing key is in the system keychain.")
  deps.ui.field("Team code", created.teamCode)
}
