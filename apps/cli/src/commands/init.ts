import { createSigner, createTeam, generateMemberKeyPair } from "@workspace/core"

import { writeIdentity, type Deps } from "../context"
import { CliError } from "../errors"
import { profileStore } from "../profile"

/** Creates the signing key in the keychain and starts a team with this person as its admin. */
export async function init(deps: Deps, options: { name?: string }): Promise<void> {
  const store = profileStore(deps.home)
  if (store.exists()) throw new CliError(`A team already exists on this machine, in ${deps.home}.`)
  if (!options.name) throw new CliError("Say who you are with `--name <you>`.")

  const pair = generateMemberKeyPair()
  const signer = createSigner(pair.secretKey)
  try {
    const team = await createTeam({ founderName: options.name, signer })
    const keyName = `signing-key:${team.trust.teamId}`
    try {
      // The team code goes in with the key. It is what later proves the team lists on disk.
      await writeIdentity(deps.keyStore, keyName, { secretKey: pair.secretKey, teamCode: team.confirmationCode })
    } catch {
      // No fallback: a signing key is never written to a file.
      throw new CliError("The system keychain is not available, so no signing key was created.")
    }
    store.save({ memberName: options.name, keyName, rosters: [team.envelope], servers: [] })
    deps.ui.success("Team created. Your signing key is in the system keychain.")
    deps.ui.field("Team code", team.confirmationCode)
  } finally {
    signer.destroy()
  }
}
