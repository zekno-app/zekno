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
import type { SshHost } from "../domains/address"
import type { KeyStore } from "../profile/keystore"
import type { Fetch } from "../version/newest"
import {
  profileStore,
  type Profile,
  type ProfileStore,
} from "../profile/profile"
import type { RunnerRelease } from "../version/runner-release"
import type { ConnectOptions, Target, Transport } from "../server/transport"
import type { Ui } from "../ui/types"

/** Everything a command needs from the outside world. Tests pass their own. */
export type Deps = {
  /** The profile folder. */
  home: string
  /** The folder commands were run from, for finding the Compose file. */
  cwd: string
  keyStore: KeyStore
  connect(
    target: Target,
    localRunner: string[],
    options?: ConnectOptions
  ): Transport
  /** How results, progress and questions reach the person. */
  ui: Ui
  /** The command that starts a runner on this machine, for `--local`. */
  localRunner: string[]
  /**
   * The runner this CLI installs and checks servers against. Undefined is
   * runner-release.json; tests pass their own, with checksums of their files.
   */
  release?: RunnerRelease
  /**
   * The verified team this run of a command already opened (`teamOnce`), for
   * the operation to take instead of reading the keychain again. Undefined:
   * an operation opens the team itself (`teamOf`), as the app's do.
   */
  team?: () => Promise<Team>
  /**
   * How `zekno version` and `zekno doctor` ask GitHub whether a newer release
   * exists (version/newest.ts, research R14), and nothing else. Only main.ts sets it.
   * Undefined: nothing is ever requested, so no test and no other code path
   * can reach the network by mistake.
   */
  fetch?: Fetch
  /**
   * The server's public addresses, as `ssh -G` names its host
   * (specs/015-domains-https, contracts/cli.md, CL5), for the record
   * `zekno domain add` names (A5). Only main.ts sets it, from a later phase
   * on. Undefined: the address is not known, and nothing is run
   * (domains/address.ts); tests give a stand-in.
   */
  sshHost?: SshHost
}

/**
 * What an operation may use: everything but the interface. Operations report
 * through their callbacks and results, and never draw anything themselves.
 */
export type OpDeps = Omit<Deps, "ui">

export const reach = (
  deps: Pick<Deps, "connect" | "localRunner">,
  target: Target
): Transport => deps.connect(target, deps.localRunner)

/**
 * A single command's way of showing what a runner, Docker or SSH write on
 * standard error: each cleaned line through `ui.remote`, marked as the
 * server's, never straight to the terminal. Reading waits while the interface
 * is busy, so a server that writes without end is slowed down instead of
 * filling memory.
 */
export function remoteThroughUi(deps: Deps): Deps {
  return {
    ...deps,
    connect: (target, localRunner, options) =>
      deps.connect(target, localRunner, {
        ...options,
        errorLines: options?.errorLines ?? ((line) => deps.ui.remote(line)),
      }),
  }
}

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

export const writeIdentity = (
  keyStore: KeyStore,
  keyName: string,
  identity: Omit<Identity, "v">
): Promise<void> =>
  keyStore.set(
    keyName,
    JSON.stringify({ v: 1, ...identity } satisfies Identity)
  )

/**
 * Why the keychain entry could not be read, with the sentence every command
 * says. `reason` lets `zekno doctor` say what to do about each
 * (specs/006-cli-small-features, contracts/doctor.md, D5 to D10).
 */
export class KeyEntryError extends CliError {
  constructor(
    readonly reason: "unreadable" | "missing" | "form",
    message: string
  ) {
    super(message)
  }
}

/** Reads the signing key and the team code from the keychain entry `keyName`. Exported for `zekno doctor`'s Key line. */
export async function readIdentity(
  keyStore: KeyStore,
  keyName: string
): Promise<Identity> {
  let entry: string | null
  try {
    entry = await keyStore.get(keyName)
  } catch {
    throw new KeyEntryError(
      "unreadable",
      "The system keychain could not be read. The signing key is kept nowhere else."
    )
  }
  if (!entry)
    throw new KeyEntryError(
      "missing",
      "The signing key is not in the system keychain on this machine."
    )
  let json: unknown
  try {
    json = JSON.parse(entry)
  } catch {
    json = undefined
  }
  const identity = IdentitySchema.safeParse(json)
  if (!identity.success)
    throw new KeyEntryError(
      "form",
      "The keychain entry for the signing key is not in a form this version reads."
    )
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

export const TAMPERED =
  "The profile folder may have been changed by something other than zekno."

/**
 * Loads the profile and proves it. The profile folder is ordinary files, so
 * what it says about the team is not taken on trust: the founding list must
 * match the code kept in the keychain, every later list must be signed by an
 * admin of the one before, and every server the profile names must be in the
 * signed list under that name.
 */
export async function openTeam(
  deps: Pick<Deps, "home" | "keyStore">
): Promise<Team> {
  const store = profileStore(deps.home)
  const profile = store.load()
  const identity = await readIdentity(deps.keyStore, profile.keyName)
  return {
    ...verifiedProfile(store, profile, identity.teamCode),
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

/**
 * Proves a profile against the team code kept in the keychain: the founding
 * list must match it, every later list must be signed by an admin of the one
 * before, and every server the profile names must be in the signed list
 * under that name.
 */
function verifiedProfile(
  store: ProfileStore,
  profile: Profile,
  teamCode: string
): Omit<Team, "withSigner"> {
  const founding = trustFoundingRoster(profile.rosters[0], teamCode)
  if (!founding.ok)
    throw new CliError(
      `The team list in the profile is not the one this machine's key belongs to. ${TAMPERED}`
    )
  const chain = [founding.value]
  for (const envelope of profile.rosters.slice(1)) {
    const next = applyRosterUpdate(chain.at(-1)!, envelope)
    if (!next.ok)
      throw new CliError(
        `A team list in the profile could not be verified (${next.error.code}). ${TAMPERED}`
      )
    chain.push(next.value)
  }
  const trust = chain.at(-1)!

  for (const server of profile.servers) {
    const signed = trust.servers.find(
      (entry) => entry.serverId === server.serverId
    )
    if (signed?.name !== server.name) {
      throw new CliError(
        `The profile names a server "${server.name}" that is not in the signed team list. ${TAMPERED}`
      )
    }
  }
  return { store, profile, trust, chain, teamCode }
}

/**
 * The same team, read again from the profile folder after an operation of
 * this run changed it (the first deploy adds a server, and with it a team
 * list), and proved again as `openTeam` proves it, against the team code
 * read from the keychain when `team` was opened. The keychain is not read a
 * second time: the key stays where it was, inside `team.withSigner`, so one
 * run reads it once (specs/006-cli-small-features, research R7). A profile
 * that now names another key is not this team's.
 */
export function reopenTeam(team: Team): Team {
  const profile = team.store.load()
  if (profile.keyName !== team.profile.keyName)
    throw new CliError(
      `The profile names another signing key than it did a moment ago. ${TAMPERED}`
    )
  return {
    ...verifiedProfile(team.store, profile, team.teamCode),
    withSigner: team.withSigner,
  }
}

/** The verified team an operation works with: the one this run of a command opened already, or opened now. */
export const teamOf = (
  deps: Pick<Deps, "home" | "keyStore" | "team">
): Promise<Team> => deps.team?.() ?? openTeam(deps)

/**
 * The verified team for one run of a command, opened at most once, when it
 * is first needed: judging zekno.json (`trust`), the questions that list its
 * servers (`peek`, specs/006-cli-small-features research R7) and the
 * operation that follows (`take`, handed to it as `Deps.team`) read the
 * keychain once between them. Once the operation has taken it, it is not
 * kept here, so the team, and the key in it, is held only as long as the
 * operation holds it. An open that failed is not kept either: the next one
 * opens again, so a team made since (a first deploy makes one) is found.
 */
export function teamOnce(deps: Pick<Deps, "home" | "keyStore">): {
  trust(): Promise<TeamTrust>
  peek(): Promise<Team>
  take(): Promise<Team>
} {
  let opened: Promise<Team> | undefined
  const open = (): Promise<Team> => {
    if (opened) return opened
    const opening = openTeam(deps)
    opened = opening
    opening.catch(() => {
      if (opened === opening) opened = undefined
    })
    return opening
  }
  return {
    async trust() {
      return (await open()).trust
    },
    peek: open,
    take() {
      const team = opened ?? openTeam(deps)
      opened = undefined
      return team
    },
  }
}
