/**
 * A server made in this process, and deploys verified on it by core, for the
 * runner's tests of checking the code before the number (specs/016-build-
 * from-source, contracts/runner.md RB4, RB3 K14d): a team with one admin, a
 * server in its team list with its own key, that server's state as a runner
 * of this feature sets it up, and an empty folder for it. No runner program
 * runs, and no Docker.
 */
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  generateServerKeyPair,
  newRunnerState,
  proposeRoster,
  verifyDeployV2,
} from "@workspace/core"

import { buildDeployV2, type BuildRecipeInput } from "./deploy-v2"
import { tempDir } from "./helpers"

/** A team with one admin, a server in its team list with its own key, and that server's state and folder. */
export async function server() {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const keys = generateServerKeyPair()
  const added = await proposeRoster({
    trust: team.trust,
    servers: [{ name: "prod-1", publicKey: keys.publicKey }],
    signer,
  })
  const state = newRunnerState({ serverId: keys.serverId, team: added.trust })
  return { signer, trust: added.trust, keys, state, home: tempDir("open") }
}
export type Server = Awaited<ReturnType<typeof server>>

/** A deploy of `web` made against 0 with these builds, signed by the admin and verified by core on the server's state. */
export async function deployOf(s: Server, builds: readonly BuildRecipeInput[]) {
  const { envelope } = await buildDeployV2({
    trust: s.trust,
    serverId: s.keys.serverId,
    signer: s.signer,
    previous: 0,
    values: {},
    builds,
  })
  const result = verifyDeployV2({
    envelope,
    records: [],
    held: () => undefined,
    state: s.state,
    now: new Date(),
    via: "session",
  })
  if (!result.ok) throw new Error(`refused: ${result.error.code}`)
  return { envelope, verified: result.value }
}
