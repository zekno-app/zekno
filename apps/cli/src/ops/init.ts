import {
  createSigner,
  createTeam as startTeam,
  generateMemberKeyPair,
} from "@workspace/core"

import { writeIdentity, type OpDeps } from "../cli/context"
import { CliError } from "../cli/errors"
import { profileStore } from "../profile/profile"

export type TeamCreated = {
  /** The team's code, which a server checks before it agrees to obey the team. */
  teamCode: string
}

/**
 * Creates the signing key in the keychain and starts a team with this
 * person as its admin. The key goes into the keychain and nowhere else: when
 * the keychain cannot take it, no team is created.
 */
export async function createTeam(
  deps: Pick<OpDeps, "home" | "keyStore">,
  name: string | undefined
): Promise<TeamCreated> {
  const store = profileStore(deps.home)
  if (store.exists())
    throw new CliError(
      `A team already exists on this machine, in ${deps.home}.`
    )
  if (!name) throw new CliError("Say who you are with `--name <you>`.")

  const pair = generateMemberKeyPair()
  const signer = createSigner(pair.secretKey)
  try {
    const team = await startTeam({ founderName: name, signer })
    const keyName = `signing-key:${team.trust.teamId}`
    try {
      // The team code goes in with the key. It is what later proves the team lists on disk.
      await writeIdentity(deps.keyStore, keyName, {
        secretKey: pair.secretKey,
        teamCode: team.confirmationCode,
      })
    } catch {
      // No fallback: a signing key is never written to a file.
      throw new CliError(
        "The system keychain is not available, so no signing key was created."
      )
    }
    store.save({
      memberName: name,
      keyName,
      rosters: [team.envelope],
      servers: [],
    })
    return { teamCode: team.confirmationCode }
  } finally {
    signer.destroy()
  }
}
