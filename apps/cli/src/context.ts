import {
  applyRosterUpdate,
  createSigner,
  isKey,
  trustFoundingRoster,
  type MemberSecretKey,
  type Signer,
  type TeamTrust,
} from "@workspace/core"
import { z } from "zod"

import { CliError } from "./errors"
import type { KeyStore } from "./keystore"
import { profileStore, type Profile, type ProfileStore } from "./profile"
import type { ConnectOptions, Target, Transport } from "./transport"
import type { Ui } from "./ui/types"

/** Everything a command needs from the outside world. Tests pass their own. */
export type Deps = {
  /** The profile folder. */
  home: string
  /** The folder commands were run from, for finding the Compose file. */
  cwd: string
  keyStore: KeyStore
  connect(target: Target, localRunner: string[], options?: ConnectOptions): Transport
  /** How results, progress and questions reach the person. */
  ui: Ui
  /** The command that starts a runner on this machine, for `--local`. */
  localRunner: string[]
}

/**
 * What an operation may use: everything but the interface. Operations report
 * through their callbacks and results, and never draw anything themselves.
 */
export type OpDeps = Omit<Deps, "ui">

export const reach = (deps: Pick<Deps, "connect" | "localRunner">, target: Target): Transport =>
  deps.connect(target, deps.localRunner)

/**
 * What the keychain entry holds: the signing key, and the code of the team's
 * founding list. The code is what makes the team lists in the profile folder
 * checkable: a list that does not lead back to this code is not this team's.
 */
const IdentitySchema = z.strictObject({
  v: z.literal(1),
  secretKey: z.custom<MemberSecretKey>((value) => isKey("memberSecret", value)),
  teamCode: z.string().min(1).max(64),
})
type Identity = z.infer<typeof IdentitySchema>

export const writeIdentity = (keyStore: KeyStore, keyName: string, identity: Omit<Identity, "v">): Promise<void> =>
  keyStore.set(keyName, JSON.stringify({ v: 1, ...identity } satisfies Identity))

async function readIdentity(keyStore: KeyStore, keyName: string): Promise<Identity> {
  let entry: string | null
  try {
    entry = await keyStore.get(keyName)
  } catch {
    throw new CliError("The system keychain could not be read. The signing key is kept nowhere else.")
  }
  if (!entry) throw new CliError("The signing key is not in the system keychain on this machine.")
  let json: unknown
  try {
    json = JSON.parse(entry)
  } catch {
    json = undefined
  }
  const identity = IdentitySchema.safeParse(json)
  if (!identity.success) throw new CliError("The keychain entry for the signing key is not in a form this version reads.")
  return identity.data
}

/** A team whose lists have been verified, and the means to sign as its member. */
export type Team = {
  store: ProfileStore
  profile: Profile
  /** The latest team list, rebuilt from the signed lists. Never read from a file as it stands. */
  trust: TeamTrust
  /** Trust after each list, oldest first. `chain[n - 1]` is version `n`. */
  chain: readonly TeamTrust[]
  teamCode: string
  /** Runs work with the signing key, and wipes the key afterwards. */
  withSigner<T>(work: (signer: Signer) => Promise<T>): Promise<T>
}

export const TAMPERED = "The profile folder may have been changed by something other than zekno."

/**
 * Loads the profile and proves it. The profile folder is ordinary files, so
 * what it says about the team is not taken on trust: the founding list must
 * match the code kept in the keychain, every later list must be signed by an
 * admin of the one before, and every server the profile names must be in the
 * signed list under that name.
 */
export async function openTeam(deps: Pick<Deps, "home" | "keyStore">): Promise<Team> {
  const store = profileStore(deps.home)
  const profile = store.load()
  const identity = await readIdentity(deps.keyStore, profile.keyName)

  const founding = trustFoundingRoster(profile.rosters[0], identity.teamCode)
  if (!founding.ok) throw new CliError(`The team list in the profile is not the one this machine's key belongs to. ${TAMPERED}`)
  const chain = [founding.value]
  for (const envelope of profile.rosters.slice(1)) {
    const next = applyRosterUpdate(chain.at(-1)!, envelope)
    if (!next.ok) throw new CliError(`A team list in the profile could not be verified (${next.error.code}). ${TAMPERED}`)
    chain.push(next.value)
  }
  const trust = chain.at(-1)!

  for (const server of profile.servers) {
    const signed = trust.servers.find((entry) => entry.serverId === server.serverId)
    if (signed?.name !== server.name) {
      throw new CliError(`The profile names a server "${server.name}" that is not in the signed team list. ${TAMPERED}`)
    }
  }

  return {
    store,
    profile,
    trust,
    chain,
    teamCode: identity.teamCode,
    async withSigner(work) {
      const signer = createSigner(identity.secretKey)
      try {
        return await work(signer)
      } finally {
        signer.destroy()
      }
    },
  }
}
