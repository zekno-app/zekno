/**
 * The signed deploy's version 2: signing it, reading it back, and the
 * runner-side gate. The message is `message.ts`'s (contracts/message.md); the
 * gate runs the checks of contracts/runner-checks.md K4 to K14 in their order,
 * with K10b of specs/015-domains-https/contracts/core.md (K4 to K10 in
 * `gate.ts`; K11 to K14, the secrets, in `listed-secrets.ts`), and its result
 * is the only thing `openSecrets` opens (K16). K1 to K3, K15 and K17 are the
 * runner's: they read the request, the disk and Docker.
 */
import { utf8 } from "../crypto/encoding"
import {
  openEnvelope,
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
  type DeployV2Refusal,
  type Result,
} from "../protocol/result"
import {
  verifySecretRemoval,
  type SecretRecord,
} from "../secrets/secret-record"
import { verifySecretStatement } from "../secrets/statement"
import {
  assertTrust,
  memberByKeyId,
  serverKeyOf,
  type Member,
  type TeamTrust,
} from "../team/roster"
import type { Build } from "./builds"
import { gateDeployV2, isTime } from "./gate"
import type { Predeploy } from "./later-fields"
import { checkListedSecrets } from "./listed-secrets"
import {
  freezeDeep,
  readDeployV2Bytes,
  readDeployV2Format,
  type DeployV2,
} from "./message"
import { registerVerified } from "./open"
import { domainHolders } from "./routes"
import type { Health, Route } from "./routes-and-checks"
import { readMarked, type StoredRunnerState } from "./state"

/** A version-2 deploy that passed every check of `verifyDeployV2`. The only version-2 deploy `openSecrets` opens. */
export type VerifiedDeployV2 = {
  readonly deploy: DeployV2
  /** The member who signed it. */
  readonly signer: Member
  /**
   * Save this before anything runs: the number is used, the versions and
   * `formats[app] = 2` are kept. The routes in force and the released
   * domains are the state's, as they were: they change only once the runner
   * has put the deploy's routes in force (specs/015-domains-https,
   * contracts/runner.md, RN9, RN10).
   */
  readonly nextState: StoredRunnerState
  /** The records supplied with the deploy, each listed and verified: write them before the state that names them. */
  readonly write: readonly SecretRecord[]
  /** Every record K13 verified, supplied or held, in name order, for `stillAllowed` (specs/016-build-from-source, CO9). */
  readonly used: readonly SecretRecord[]
  /** The hashes of every live secret of the app after the change: every other record file of the app goes. */
  readonly keep: readonly string[]
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

/**
 * `list` sorted by the text `key` gives each item, so the signer need not
 * sort it; throws `CoreError` when it is not a list of objects with that
 * text, or when two items give the same text (`repeated` says which).
 */
function sortedOnce<T>(
  list: unknown,
  key: (item: T) => unknown,
  repeated: string
): T[] {
  const keyOf = (item: unknown) =>
    typeof item === "object" && item !== null ? key(item as T) : undefined
  if (
    !Array.isArray(list) ||
    !list.every((item) => typeof keyOf(item) === "string")
  ) {
    throw new CoreError(
      "invalid_argument",
      "Routes, builds and a health check's services are each a list of objects."
    )
  }
  const sorted = [...(list as T[])].sort((a, b) => {
    const left = keyOf(a) as string
    const right = keyOf(b) as string
    return left < right ? -1 : left > right ? 1 : 0
  })
  if (new Set(sorted.map(keyOf)).size !== sorted.length)
    throw new CoreError("invalid_argument", repeated)
  return sorted
}

/**
 * Builds and signs a version-2 deploy: made against `previous`, the app's last
 * number as the signer read it on the deploy's own connection, so it can run
 * only while nothing else of the app was accepted since.
 *
 * Secrets are given as signed statements (this machine's, or ones the runner
 * holds) and removals, each verified here against the team list, so the
 * listing comes only from statements a member signed (FR-021): never a
 * version or a hash from anyone's word. The payload is read back by the
 * runner's own reader before it is signed, so this never signs what a runner
 * would call `malformed` (FR-005).
 *
 * `routes` and `health` are inputs of their own (specs/015-domains-https,
 * contracts/core.md, "Carried out"): routes are sorted by domain and the
 * health check's services by service, and a domain or a service given twice
 * is refused. `builds` is one too (specs/016-build-from-source, CO8;
 * FR-063): sorted by key, a key given twice refused. A rollback passes the
 * old builds as they were, and the read-back computes each key again against
 * this deploy's listing, so a build secret set again or removed since is
 * refused here, before signing (FR-064a). No F7 here: this library's table
 * is the runner's it ships in, not the target runner's, so a Railpack build
 * is signed, and zekno's protocol checks keep it from a runner that does not
 * carry it out (CO7, CL7). `later` holds the pre-deploy command, which no
 * runner carries out yet: it is for tests only.
 */
export async function createDeployV2(input: {
  trust: TeamTrust
  serverId: string
  app: string
  previous: number
  compose: string
  statements: readonly Envelope[]
  removals: readonly Envelope[]
  expiresAt: Date | null
  routes?: readonly Route[]
  health?: Health | null
  builds?: readonly Build[]
  later?: {
    predeploy?: Predeploy | null
  }
  signer: Signer
  now?: Date
}): Promise<Envelope> {
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
  for (const list of [input.statements, input.removals]) {
    if (!Array.isArray(list) || list.length > LIMITS.secretsPerDeploy) {
      throw new CoreError(
        "invalid_argument",
        "The secrets and removals are each a list within the limit."
      )
    }
  }
  const { trust, serverId, app } = input
  const secrets = input.statements.map((envelope) => {
    const checked = verifySecretStatement({ envelope, trust, serverId, app })
    if (!checked.ok) {
      throw new CoreError(
        "untrusted_secret",
        `A secret was not set by a current team member for this server and app (${checked.error.code}).`
      )
    }
    const { name, hash, version } = checked.value
    return { name, hash, version }
  })
  const removed = input.removals.map((removal) => {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (!checked.ok) {
      throw new CoreError(
        "untrusted_secret",
        `A removal was not signed by a current team member for this server and app (${checked.error.code}).`
      )
    }
    return { name: checked.value.name, version: checked.value.version }
  })
  secrets.sort(byName)
  removed.sort(byName)
  const names = [...secrets, ...removed].map((entry) => entry.name)
  if (new Set(names).size !== names.length) {
    throw new CoreError(
      "invalid_argument",
      "Each secret name can appear only once in a deploy."
    )
  }
  const routes = sortedOnce<Route>(
    input.routes ?? [],
    (route) => route.domain,
    "Each domain can appear only once in a deploy."
  )
  const builds = sortedOnce<Build>(
    input.builds ?? [],
    (build) => build.key,
    "Each build key can appear only once in a deploy."
  )
  const health = input.health ?? null
  const checks =
    health === null
      ? null
      : {
          ...health,
          services: sortedOnce<Health["services"][number]>(
            (health as { services?: unknown }).services,
            (entry) => entry.service,
            "Each service can appear only once in a health check."
          ),
        }
  const now = input.now ?? new Date()
  if (!isTime(now) || !(input.expiresAt === null || isTime(input.expiresAt))) {
    throw new CoreError(
      "invalid_argument",
      "The time of a deploy and its expiry are each a valid time."
    )
  }
  const deploy = {
    v: 2 as const,
    teamId: trust.teamId,
    teamHash: trust.hash,
    serverId,
    app,
    previous: input.previous,
    sequence: input.previous + 1,
    createdAt: now.toISOString(),
    expiresAt: input.expiresAt === null ? null : input.expiresAt.toISOString(),
    compose: input.compose,
    secrets,
    removed,
    builds,
    predeploy: input.later?.predeploy ?? null,
    health: checks,
    routes,
  }
  // What is signed is what the reader gives, and reads again as itself, in the one spelling both readers take (F41).
  const read = readDeployV2Format(deploy)
  const text = read.ok ? JSON.stringify(read.value) : undefined
  if (text === undefined || !readDeployV2Bytes(utf8(text)).ok) {
    throw new CoreError(
      "invalid_argument",
      "The deploy would not be read as it is signed: an app name, a number or a field is not valid."
    )
  }
  return signEnvelope(PAYLOAD_TYPES.deployV2, utf8(text!), input.signer)
}

/**
 * Reads a signed version-2 deploy without judging whether a server should
 * accept it: the signature must be a current team member's, and the payload
 * must be well-formed (F4 to F6). Whether a runner carries out its fields
 * (F7) is not judged: a reader of the history only reads.
 */
export function readSignedDeployV2(input: {
  envelope: unknown
  trust: TeamTrust
}): Result<{ deploy: DeployV2; signer: Member }, DeployRefusal> {
  assertTrust(input.trust)
  const opened = openEnvelope(
    input.envelope,
    PAYLOAD_TYPES.deployV2,
    (keyId) => memberByKeyId(input.trust.members, keyId)?.publicKey
  )
  if (!opened.ok) return opened
  const read = readDeployV2Bytes(opened.value.payload)
  if (!read.ok) return read
  const signer = input.trust.members.find(
    (member) => member.publicKey === opened.value.signerKey
  )!
  return ok({ deploy: read.value, signer })
}

/**
 * The runner-side gate of a version-2 deploy, K4 to K14 of contracts/
 * runner-checks.md in their order; the first that fails is the answer, and
 * nothing is changed or decrypted. A deploy is accepted only when it is
 * signed by a current member allowed to deploy, for this team, team list and
 * server; made against the app's last number here (`previous`), so a deploy
 * that was overtaken can never run; within its expiry by `now`, the runner's
 * clock, the only check that reads a clock; listing every live secret, none
 * going back; and with every listed secret's record supplied, or held under
 * its listed hash with every field equal, and verified now.
 *
 * `held(app, hash)` gives the record the runner keeps as
 * `records/<app>/<hash>.json`, or undefined. `via` says where the deploy came
 * from: one taken from the hosted service must carry an expiry.
 */
export function verifyDeployV2(input: {
  envelope: unknown
  records: unknown
  held: (app: string, hash: string) => unknown
  state: StoredRunnerState
  now: Date
  via: "session" | "hosted service"
}): Result<VerifiedDeployV2, DeployV2Refusal> {
  const state = readMarked(input.state)
  if (
    !isTime(input.now) ||
    (input.via !== "session" && input.via !== "hosted service") ||
    typeof input.held !== "function"
  ) {
    throw new CoreError(
      "invalid_argument",
      "A deploy is checked against a clock, where it came from, and the records held."
    )
  }

  // K4 to K10, in `gate.ts`: the envelope, the signer and the signature, the
  // payload, who signed it and for whom, the order, and the expiry.
  const gated = gateDeployV2({
    envelope: input.envelope,
    state,
    now: input.now,
    via: input.via,
  })
  if (!gated.ok) return gated
  const { deploy, signer } = gated.value
  const app = deploy.app

  // K10b. Who holds a domain (specs/015-domains-https, contracts/core.md):
  // a domain another app holds is not taken over. Nothing is written and no
  // number is used.
  const holders = domainHolders(state)
  for (const route of deploy.routes) {
    const holder = holders.get(route.domain)
    if (holder !== undefined && holder !== app)
      return refuse(
        "domain_taken",
        "Another app on this server holds a domain this deploy names."
      )
  }

  // K11 to K14. The secrets: every live one listed, none going back, each record verified.
  const checked = checkListedSecrets({
    deploy,
    state,
    records: input.records,
    held: input.held,
  })
  if (!checked.ok) return checked
  const { sealed, write, used, secrets, keep } = checked.value

  // The next state: the number used, the versions kept, the app at format 2,
  // and every other part as it was, its mark among them: the routes in force
  // and the released domains (core.md, K10b), and the builds kept and the
  // build under way (specs/016-build-from-source, CO9, CO13).
  const nextState: StoredRunnerState = freezeDeep({
    ...state,
    lastSequence: { ...state.lastSequence, [app]: deploy.sequence },
    secrets,
    formats: { ...state.formats, [app]: 2 as const },
  })
  const result: VerifiedDeployV2 = Object.freeze({
    deploy,
    signer,
    nextState,
    write,
    used,
    keep,
  })
  registerVerified(result, sealed)
  return ok(result)
}
