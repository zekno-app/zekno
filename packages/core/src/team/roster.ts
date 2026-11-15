import { z } from "zod"

import { rosterCodeFromHash, confirmationCodesMatch } from "../crypto/confirm"
import { fromHex, isWellFormed, toBase64Url, toHex, utf8 } from "../crypto/encoding"
import {
  hasOtherVersion,
  openEnvelope,
  parseJson,
  PAYLOAD_TYPES,
  readEnvelope,
  signEnvelope,
  verifySignature,
  type Envelope,
} from "../crypto/envelope"
import { hash } from "../crypto/hash"
import {
  isKey,
  keyIdOf,
  serverIdOf,
  type MemberPublicKey,
  type ServerPublicKey,
  type Signer,
} from "../crypto/keys"
import { LIMITS } from "../protocol/limits"
import { CoreError, ok, refuse, type Result, type RosterRefusal } from "../protocol/result"
import { sodium } from "../crypto/sodium"

export const ROLES = ["admin", "deployer"] as const
/** An admin can change the team and authorize deploys. A deployer can only authorize deploys. */
export type Role = (typeof ROLES)[number]

export const TEAM_ID = /^team_[A-Za-z0-9_-]{22}$/
const HASH_HEX = /^[0-9a-f]{64}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export const isoTime = z.string().regex(ISO_TIME)

/**
 * A name people read to decide whom or what they are trusting. No control,
 * format or unassigned characters (which covers bidirectional overrides and
 * zero-width characters), no line separators, and no surrounding space.
 */
const displayName = z
  .string()
  .min(1)
  .max(LIMITS.memberNameLength)
  .refine(
    (name) =>
      isWellFormed(name) && !/[\p{C}\u2028\u2029]/u.test(name) && name === name.trim()
  )

const MemberSchema = z.strictObject({
  name: displayName,
  publicKey: z.custom<MemberPublicKey>((value) => isKey("memberPublic", value)),
  role: z.enum(ROLES),
})
export type Member = z.infer<typeof MemberSchema>

/**
 * A server the team deploys to. Its key is in the admin-signed team list so
 * that every member gets it from a teammate's signature, never from the
 * control plane's word.
 */
const ServerEntrySchema = z.strictObject({
  name: displayName,
  publicKey: z.custom<ServerPublicKey>((value) => isKey("serverPublic", value)),
})
export type ServerEntry = z.infer<typeof ServerEntrySchema>

const RosterSchema = z.strictObject({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  previous: z.string().regex(HASH_HEX).nullable(),
  createdAt: isoTime,
  members: z.array(MemberSchema).min(1).max(LIMITS.members),
  servers: z.array(ServerEntrySchema).max(LIMITS.servers),
})
type Roster = z.infer<typeof RosterSchema>

/**
 * What a server or a client remembers about a team: the latest list it has
 * accepted. Every later list must build on this one.
 */
export type TeamTrust = {
  readonly teamId: string
  readonly version: number
  /** Hash of the accepted list's signed bytes, as hex. */
  readonly hash: string
  /** Hash of the founding list. The team's confirmation code is derived from it. */
  readonly foundingHash: string
  readonly members: readonly Member[]
  readonly servers: readonly (ServerEntry & { readonly serverId: string })[]
}

/** The shape of stored trust, for checking what a runner or client reads back from disk. */
export const TeamTrustSchema = z.strictObject({
  teamId: z.string().regex(TEAM_ID),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  hash: z.string().regex(HASH_HEX),
  foundingHash: z.string().regex(HASH_HEX),
  members: z.array(MemberSchema).min(1).max(LIMITS.members),
  servers: z
    .array(
      ServerEntrySchema.extend({ serverId: z.string().regex(/^srv_[0-9a-f]{32}$/) })
        // A stored id must be the one that belongs to the stored key.
        .refine((server) => serverIdOf(server.publicKey) === server.serverId)
    )
    .max(LIMITS.servers),
})

/** Throws when stored trust is not usable, instead of failing somewhere less clear. */
export function assertTrust(trust: TeamTrust): void {
  if (!TeamTrustSchema.safeParse(trust).success) {
    throw new CoreError("invalid_argument", "The stored team trust is not valid.")
  }
}

/** Members: unique keys, unique names, at least one admin. Servers: unique keys and names. */
function rosterIsValid(members: readonly Member[], servers: readonly ServerEntry[]): boolean {
  const unique = (values: readonly string[]) => new Set(values).size === values.length
  return (
    unique(members.map((member) => member.publicKey)) &&
    unique(members.map((member) => member.name)) &&
    members.some((member) => member.role === "admin") &&
    unique(servers.map((server) => server.publicKey)) &&
    unique(servers.map((server) => server.name))
  )
}

function rosterHash(payload: Uint8Array): Uint8Array {
  return hash("zekno/v1/roster", payload)
}

function toTrust(roster: Roster, payload: Uint8Array, foundingHash?: string): TeamTrust {
  const hash = toHex(rosterHash(payload))
  return Object.freeze({
    teamId: roster.teamId,
    version: roster.version,
    hash,
    foundingHash: foundingHash ?? hash,
    members: Object.freeze(roster.members.map((member) => Object.freeze({ ...member }))),
    servers: Object.freeze(
      roster.servers.map((server) =>
        Object.freeze({ ...server, serverId: serverIdOf(server.publicKey) })
      )
    ),
  })
}

/** The key of a server in the team list, or undefined when the team has no such server. */
export function serverKeyOf(trust: TeamTrust, serverId: string): ServerPublicKey | undefined {
  return trust.servers.find((server) => server.serverId === serverId)?.publicKey
}

/**
 * The code a person compares before a new server or teammate trusts this
 * team. It comes from the founding list this trust was built on, so it can
 * be shown at any time without asking the control plane for anything.
 */
export function teamConfirmationCode(trust: TeamTrust): string {
  assertTrust(trust)
  return rosterCodeFromHash(fromHex(trust.foundingHash)!)
}

/** Finds the member a key id refers to. */
export function memberByKeyId(
  members: readonly Member[],
  keyId: string
): Member | undefined {
  return members.find((member) => keyIdOf(member.publicKey) === keyId)
}

function parseRoster(payload: Uint8Array): Result<Roster, RosterRefusal> {
  const json = parseJson(payload)
  if (json === undefined) return refuse("malformed", "The team list is not valid JSON.")
  if (hasOtherVersion(json)) {
    return refuse("unsupported_version", "This team list uses a format version this library does not know.")
  }
  const parsed = RosterSchema.safeParse(json)
  if (!parsed.success) return refuse("malformed", "The team list does not match its definition.")
  if (!rosterIsValid(parsed.data.members, parsed.data.servers)) {
    return refuse("invalid_members", "A team list needs unique keys, unique names and at least one admin.")
  }
  return ok(parsed.data)
}

function timestamp(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

/**
 * Starts a team. The founding list has one member, the founder, as admin, and
 * is signed by the founder. Its confirmation code is what a person compares
 * before a server or a new teammate trusts this team.
 */
export async function createTeam(input: {
  founderName: string
  signer: Signer
  now?: Date
}): Promise<{ envelope: Envelope; trust: TeamTrust; confirmationCode: string }> {
  const members = [{ name: input.founderName, publicKey: input.signer.publicKey, role: "admin" as const }]
  const roster = {
    v: 1 as const,
    teamId: `team_${toBase64Url(sodium.randombytes_buf(16))}`,
    version: 1,
    previous: null,
    createdAt: timestamp(input.now),
    members,
    servers: [],
  }
  if (!RosterSchema.safeParse(roster).success) {
    throw new CoreError("invalid_members", "The founder's name or key is not valid.")
  }
  const payload = utf8(JSON.stringify(roster))
  const envelope = await signEnvelope(PAYLOAD_TYPES.roster, payload, input.signer)
  const trust = toTrust(roster, payload)
  return { envelope, trust, confirmationCode: teamConfirmationCode(trust) }
}

/**
 * Accepts a founding list as the starting point of trust. `confirmedCode` is
 * the code a person confirmed through a channel the control plane does not
 * control; without a matching code the list is refused.
 */
export function trustFoundingRoster(
  envelope: unknown,
  confirmedCode: string
): Result<TeamTrust, RosterRefusal> {
  const read = readEnvelope(envelope, PAYLOAD_TYPES.roster)
  if (!read.ok) return read

  // Compare the code first: an unconfirmed list is not worth parsing.
  const code = rosterCodeFromHash(rosterHash(read.value.payload))
  if (!confirmationCodesMatch(code, confirmedCode)) {
    return refuse("code_mismatch", "The confirmation code does not match this team list.")
  }

  const roster = parseRoster(read.value.payload)
  if (!roster.ok) return roster
  if (roster.value.version !== 1) {
    return refuse("wrong_version", "A founding team list must be version 1.")
  }
  if (roster.value.previous !== null) {
    return refuse("wrong_previous", "A founding team list cannot refer to an earlier one.")
  }
  const signer = memberByKeyId(roster.value.members, read.value.envelope.signature.keyId)
  if (!signer) return refuse("unknown_signer", "The founding list is not signed by one of its members.")
  if (!verifySignature(read.value, signer.publicKey)) {
    return refuse("bad_signature", "The signature does not match the founding list.")
  }
  if (signer.role !== "admin") {
    return refuse("not_admin", "The founding list must be signed by an admin.")
  }
  return ok(toTrust(roster.value, read.value.payload))
}

/**
 * Creates the next team list. The signer must be an admin of the current
 * list; the new list names the current one by hash, so it can only follow it.
 * Members and servers default to the current ones, so a change states only
 * what it changes. Returns the new trust as well: the author moves forward
 * from their own signature, not from what the control plane sends back.
 *
 * Add a server only after comparing its confirmation code with the one shown
 * on the server itself.
 */
export async function proposeRoster(input: {
  trust: TeamTrust
  members?: readonly Member[]
  servers?: readonly ServerEntry[]
  signer: Signer
  now?: Date
}): Promise<{ envelope: Envelope; trust: TeamTrust }> {
  assertTrust(input.trust)
  const author = input.trust.members.find((member) => member.publicKey === input.signer.publicKey)
  if (author?.role !== "admin") {
    throw new CoreError("not_admin", "Only an admin of the current team list can change the team.")
  }
  const roster = {
    v: 1 as const,
    teamId: input.trust.teamId,
    version: input.trust.version + 1,
    previous: input.trust.hash,
    createdAt: timestamp(input.now),
    members: (input.members ?? input.trust.members).map(({ name, publicKey, role }) => ({ name, publicKey, role })),
    servers: (input.servers ?? input.trust.servers).map(({ name, publicKey }) => ({ name, publicKey })),
  }
  if (!RosterSchema.safeParse(roster).success || !rosterIsValid(roster.members, roster.servers)) {
    throw new CoreError(
      "invalid_members",
      "A team list needs valid members and servers with unique keys, unique names and at least one admin."
    )
  }
  const payload = utf8(JSON.stringify(roster))
  const envelope = await signEnvelope(PAYLOAD_TYPES.roster, payload, input.signer)
  return { envelope, trust: toTrust(roster, payload, input.trust.foundingHash) }
}

/**
 * Moves trust forward by one team list. The list must be signed by an admin
 * of the current list, carry the next version number and name the current
 * list by hash. Anything else leaves trust unchanged.
 */
export function applyRosterUpdate(
  trust: TeamTrust,
  envelope: unknown
): Result<TeamTrust, RosterRefusal> {
  assertTrust(trust)
  const opened = openEnvelope(
    envelope,
    PAYLOAD_TYPES.roster,
    (keyId) => memberByKeyId(trust.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const signer = trust.members.find((member) => member.publicKey === opened.value.signerKey)
  if (signer?.role !== "admin") {
    return refuse("not_admin", "Only an admin can change the team.")
  }

  const roster = parseRoster(opened.value.payload)
  if (!roster.ok) return roster
  if (roster.value.teamId !== trust.teamId) {
    return refuse("wrong_team", "This team list belongs to another team.")
  }
  if (roster.value.version !== trust.version + 1) {
    return refuse("wrong_version", `Expected team list version ${trust.version + 1}.`)
  }
  const previous = roster.value.previous === null ? undefined : fromHex(roster.value.previous)
  const current = fromHex(trust.hash)
  if (!previous || !current || !sodium.memcmp(previous, current)) {
    return refuse("wrong_previous", "This team list does not follow the current one.")
  }
  return ok(toTrust(roster.value, opened.value.payload, trust.foundingHash))
}
