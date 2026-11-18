import { z } from "zod"

import { utf8 } from "../crypto/encoding"
import {
  hasOtherVersion,
  openEnvelope,
  parseJson,
  PAYLOAD_TYPES,
  signEnvelope,
  type Envelope,
} from "../crypto/envelope"
import type { Signer } from "../crypto/keys"
import { LIMITS } from "../protocol/limits"
import {
  CoreError,
  ok,
  refuse,
  type DeployRefusal,
  type Result,
} from "../protocol/result"
import {
  assertTrust,
  isoTime,
  memberByKeyId,
  serverKeyOf,
  TEAM_ID,
  type Member,
  type Role,
  type TeamTrust,
} from "../team/roster"
import {
  secretVersion,
  verifySecret,
  verifySecretRemoval,
  type SecretRecord,
} from "../secrets/secret-record"
import {
  APP_NAME,
  sealedSecretHash,
  SealedSecretSchema,
  secretName,
  SERVER_ID,
  type SealedSecret,
} from "../secrets/secrets"
import { registerVerified } from "./open"
import { readVersionOneState, type RunnerState } from "./state"

const sequence = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

const DeploySchema = z.strictObject({
  v: z.literal(1),
  teamId: z.string().regex(TEAM_ID),
  /** Hash of the team list the signer was working from. */
  teamHash: z.string().regex(/^[0-9a-f]{64}$/),
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  sequence,
  createdAt: isoTime,
  compose: z.string(),
  secrets: z
    .array(
      z.strictObject({
        name: secretName,
        hash: z.string().regex(/^[0-9a-f]{64}$/),
        version: secretVersion,
      })
    )
    .max(LIMITS.secretsPerDeploy),
  /** Secrets the team has retired, so the server remembers not to take them back. */
  removed: z
    .array(z.strictObject({ name: secretName, version: secretVersion }))
    .max(LIMITS.secretsPerDeploy),
})

/** What one server should run for one app, and the secrets that belong to it. */
export type Deploy = z.infer<typeof DeploySchema>

/** A deploy that passed every check. The only thing `openSecrets` accepts. */
export type VerifiedDeploy = {
  readonly deploy: Deploy
  /** The member who signed it. */
  readonly signer: Member
  /** Persist this before running the deploy, so the same deploy cannot be accepted twice. */
  readonly nextState: RunnerState
}

/** The roles that may deploy. A link (link.ts) counts only from a member with one of them. */
export const DEPLOY_ROLES: readonly Role[] = ["admin", "deployer"]

function namesAreSortedAndUnique(names: readonly string[]): boolean {
  return names.every((name, index) => index === 0 || names[index - 1]! < name)
}

/**
 * Builds and signs a deploy. The signed content names the team, the server,
 * the app and a number that must be higher than the last deploy for that app,
 * and carries the hash and version of each sealed secret.
 *
 * Secrets are passed as signed records and verified here against the team
 * list, so a ciphertext the control plane made up, or one meant for another
 * server or app, cannot end up in a deploy a member signs. The deploy also
 * names the team list it was built from; a server on a different list
 * refuses it, so a client that missed a team change cannot deploy with it.
 */
export async function createDeploy(input: {
  trust: TeamTrust
  serverId: string
  app: string
  sequence: number
  compose: string
  secrets: readonly SecretRecord[]
  /** Signed removals of retired secrets, as returned by `currentSecrets`. */
  removals?: readonly Envelope[]
  signer: Signer
  now?: Date
}): Promise<{ envelope: Envelope; secrets: SealedSecret[] }> {
  assertTrust(input.trust)
  if (
    !input.trust.members.some(
      (member) => member.publicKey === input.signer.publicKey
    )
  ) {
    throw new CoreError(
      "not_member",
      "The signer is not a member of this team."
    )
  }
  if (!serverKeyOf(input.trust, input.serverId)) {
    throw new CoreError(
      "unknown_server",
      "This server is not in the team list. An admin adds it after confirming its code."
    )
  }
  if (
    typeof input.compose !== "string" ||
    utf8(input.compose).length > LIMITS.composeBytes
  ) {
    throw new CoreError(
      "too_large",
      "The service definition is larger than the limit."
    )
  }
  if (
    !Array.isArray(input.secrets) ||
    input.secrets.length > LIMITS.secretsPerDeploy
  ) {
    throw new CoreError(
      "invalid_argument",
      "The secrets are not a list within the limit."
    )
  }
  const serverId = input.serverId
  const secrets = input.secrets.map((record) => {
    const checked = verifySecret({
      record,
      trust: input.trust,
      serverId,
      app: input.app,
    })
    if (!checked.ok) {
      throw new CoreError(
        "untrusted_secret",
        `A secret was not set by a current team member for this server and app (${checked.error.code}).`
      )
    }
    return checked.value
  })
  secrets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const supplied = input.removals ?? []
  if (!Array.isArray(supplied) || supplied.length > LIMITS.secretsPerDeploy) {
    throw new CoreError(
      "invalid_argument",
      "The removals are not a list within the limit."
    )
  }
  const removed = supplied.map((removal) => {
    const checked = verifySecretRemoval({
      removal,
      trust: input.trust,
      serverId,
      app: input.app,
    })
    if (!checked.ok) {
      throw new CoreError(
        "untrusted_secret",
        `A removal was not signed by a current team member for this server and app (${checked.error.code}).`
      )
    }
    return { name: checked.value.name, version: checked.value.version }
  })
  removed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const names = [
    ...secrets.map((secret) => secret.name),
    ...removed.map((removal) => removal.name),
  ]
  if (
    !namesAreSortedAndUnique(secrets.map((secret) => secret.name)) ||
    !namesAreSortedAndUnique(removed.map((removal) => removal.name)) ||
    new Set(names).size !== names.length
  ) {
    throw new CoreError(
      "invalid_argument",
      "Each secret name can appear only once in a deploy."
    )
  }
  const deploy = {
    v: 1 as const,
    teamId: input.trust.teamId,
    teamHash: input.trust.hash,
    serverId,
    app: input.app,
    sequence: input.sequence,
    createdAt: (input.now ?? new Date()).toISOString(),
    compose: input.compose,
    secrets: secrets.map(({ name, hash, version }) => ({
      name,
      hash,
      version,
    })),
    removed,
  }
  if (!DeploySchema.safeParse(deploy).success) {
    throw new CoreError(
      "invalid_argument",
      "The app name or deploy number is not valid."
    )
  }
  const envelope = await signEnvelope(
    PAYLOAD_TYPES.deploy,
    utf8(JSON.stringify(deploy)),
    input.signer
  )
  return { envelope, secrets: secrets.map((secret) => secret.sealed) }
}

/**
 * Reads a signed deploy without judging whether a server should accept it:
 * the signature must be a current team member's, and the content must be a
 * well-formed deploy. For a client that kept its own signed deploys and wants
 * to use one again, for example to roll back, without trusting the file it
 * was kept in.
 */
export function readSignedDeploy(input: {
  envelope: unknown
  trust: TeamTrust
}): Result<{ deploy: Deploy; signer: Member }, DeployRefusal> {
  assertTrust(input.trust)
  const opened = openEnvelope(
    input.envelope,
    PAYLOAD_TYPES.deploy,
    (keyId) => memberByKeyId(input.trust.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const json = parseJson(opened.value.payload)
  if (json === undefined || hasOtherVersion(json))
    return refuse("malformed", "The deploy is not readable.")
  const parsed = DeploySchema.safeParse(json)
  if (!parsed.success)
    return refuse("malformed", "The deploy does not match its definition.")
  const signer = input.trust.members.find(
    (member) => member.publicKey === opened.value.signerKey
  )!
  return ok({ deploy: parsed.data, signer })
}

/**
 * The runner-side gate. A deploy is accepted only when it is signed by a
 * current team member allowed to deploy, addressed to this team and this
 * server, numbered higher than the last deploy accepted for its app,
 * accompanied by exactly the sealed secrets it lists, and not bringing back
 * an older version of any secret. Nothing is decrypted.
 */
export function verifyDeploy(input: {
  envelope: unknown
  secrets: unknown
  state: RunnerState
}): Result<VerifiedDeploy, DeployRefusal> {
  const state = readVersionOneState(input.state)

  // 1. Signature, against the team list this runner already trusts.
  const opened = openEnvelope(
    input.envelope,
    PAYLOAD_TYPES.deploy,
    (keyId) => memberByKeyId(state.team.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const signer = state.team.members.find(
    (member) => member.publicKey === opened.value.signerKey
  )!

  // 2. Only now is the content parsed.
  const json = parseJson(opened.value.payload)
  if (json === undefined)
    return refuse("malformed", "The deploy is not valid JSON.")
  if (hasOtherVersion(json)) {
    return refuse(
      "unsupported_version",
      "This deploy uses a format version this library does not know."
    )
  }
  const parsed = DeploySchema.safeParse(json)
  if (!parsed.success)
    return refuse("malformed", "The deploy does not match its definition.")
  const deploy = parsed.data
  const listedNames = [...deploy.secrets, ...deploy.removed].map(
    (entry) => entry.name
  )
  if (
    utf8(deploy.compose).length > LIMITS.composeBytes ||
    !namesAreSortedAndUnique(deploy.secrets.map((secret) => secret.name)) ||
    !namesAreSortedAndUnique(deploy.removed.map((removal) => removal.name)) ||
    new Set(listedNames).size !== listedNames.length
  ) {
    return refuse("malformed", "The deploy does not match its definition.")
  }

  // 3. Who signed it, and for whom.
  if (!DEPLOY_ROLES.includes(signer.role)) {
    return refuse(
      "role_not_allowed",
      "The signer's role does not allow deploys."
    )
  }
  if (deploy.teamId !== state.team.teamId) {
    return refuse("wrong_team", "This deploy belongs to another team.")
  }
  if (deploy.teamHash !== state.team.hash) {
    return refuse(
      "stale_team",
      "The signer and this server are on different versions of the team list."
    )
  }
  if (deploy.serverId !== state.serverId) {
    return refuse("wrong_server", "This deploy is addressed to another server.")
  }
  if (!serverKeyOf(state.team, state.serverId)) {
    return refuse("unknown_server", "This server is not in the team list.")
  }

  // 4. Order: an old deploy, however validly signed, is not accepted again,
  //    and a number far ahead of the last one would lock the app for good.
  const last = Object.hasOwn(state.lastSequence, deploy.app)
    ? state.lastSequence[deploy.app]!
    : 0
  if (deploy.sequence <= last) {
    return refuse(
      "replayed",
      "A deploy with this number or a higher one was already accepted."
    )
  }
  if (deploy.sequence - last > LIMITS.sequenceStep) {
    return refuse(
      "sequence_jump",
      "The deploy number is too far above the last one accepted."
    )
  }

  // 5. The sealed secrets supplied are exactly the ones the signer listed.
  const sealed = z
    .array(SealedSecretSchema)
    .max(LIMITS.secretsPerDeploy)
    .safeParse(input.secrets)
  if (!sealed.success || sealed.data.length !== deploy.secrets.length) {
    return refuse(
      "secrets_mismatch",
      "The sealed secrets do not match the deploy."
    )
  }
  const supplied = new Map<string, SealedSecret>()
  for (const secret of sealed.data) {
    if (supplied.has(secret.name)) {
      return refuse(
        "secrets_mismatch",
        "The sealed secrets do not match the deploy."
      )
    }
    supplied.set(secret.name, secret)
  }
  const checked: SealedSecret[] = []
  for (const listed of deploy.secrets) {
    const secret = supplied.get(listed.name)
    if (!secret || sealedSecretHash(secret) !== listed.hash) {
      return refuse(
        "secrets_mismatch",
        "The sealed secrets do not match the deploy."
      )
    }
    checked.push(secret)
  }

  // 6. No secret goes back: not to a lower version, and not to a different
  //    value under the version this runner already accepted.
  //    A removal counts as a version too, so a retired secret stays retired.
  const secrets: Record<string, { version: number; hash: string | null }> = {
    ...state.secrets,
  }
  const entries = [
    ...deploy.secrets.map(({ name, version, hash }) => ({
      name,
      version,
      hash: hash as string | null,
    })),
    ...deploy.removed.map(({ name, version }) => ({
      name,
      version,
      hash: null,
    })),
  ]
  for (const listed of entries) {
    const key = `${deploy.app}/${listed.name}`
    const known = Object.hasOwn(state.secrets, key)
      ? state.secrets[key]
      : undefined
    if (
      known &&
      (listed.version < known.version ||
        (listed.version === known.version && listed.hash !== known.hash))
    ) {
      return refuse(
        "stale_secret",
        "This deploy carries an older version of a secret than one already accepted."
      )
    }
    secrets[key] = Object.freeze({ version: listed.version, hash: listed.hash })
  }

  const result: VerifiedDeploy = Object.freeze({
    deploy: Object.freeze(deploy),
    signer,
    nextState: Object.freeze({
      serverId: state.serverId,
      team: state.team,
      lastSequence: Object.freeze({
        ...state.lastSequence,
        [deploy.app]: deploy.sequence,
      }),
      secrets: Object.freeze(secrets),
    }),
  })
  registerVerified(result, Object.freeze(checked))
  return ok(result)
}
