/**
 * One entry of this machine's deploy history, read from under its signature
 * by its kind (specs/014-deploy-v2, contracts/cli.md, "The history"; research
 * R32). The history file holds deploys of both kinds once a server speaks
 * version 2; each is read by its own reader, so neither kind is ever taken
 * for the other, and a kind this zekno does not know is not read at all.
 *
 * The entry says nothing about whom a deploy is for: every reader still
 * checks the team, the server and the app it names, as before.
 */
import {
  PAYLOAD_TYPES,
  readSignedDeploy,
  readSignedDeployV2,
  type Deploy,
  type Envelope,
  type Health,
  type Member,
  type Route,
  type TeamTrust,
} from "@workspace/core"

/** Whether two envelopes are the same signed bytes: how an entry of the history, or a record, is found again. */
export const sameEnvelope = (a: Envelope, b: Envelope): boolean =>
  a.payloadType === b.payloadType &&
  a.payload === b.payload &&
  a.signature.keyId === b.signature.keyId &&
  a.signature.sig === b.signature.sig

/**
 * What both kinds of deploy say, read from under the signature. `previous`:
 * the deploy a version-2 deploy was made after. `routes` and `health`: what
 * a version-2 deploy signed of them (specs/015-domains-https, research R30),
 * for "changed, not deployed"; a version-1 deploy has neither field.
 */
export type HistoryDeploy = Omit<Deploy, "v"> & {
  previous?: number
  routes?: readonly Route[]
  health?: Health | null
}

/** A deploy of the history that verifies against the team list given. */
export type DeployEntry = {
  format: 1 | 2
  deploy: HistoryDeploy
  /** The member who signed it. */
  signer: Member
}

/**
 * Reads one envelope of the history: a version-1 deploy with
 * `readSignedDeploy`, a version-2 deploy with `readSignedDeployV2`, each
 * signed by a member of `trust`. Undefined for anything else: another kind,
 * a deploy changed after signing, another team's, or one neither reader
 * takes.
 */
export function readDeployEntry(
  envelope: unknown,
  trust: TeamTrust
): DeployEntry | undefined {
  const kind =
    typeof envelope === "object" && envelope !== null
      ? (envelope as { payloadType?: unknown }).payloadType
      : undefined
  if (kind === PAYLOAD_TYPES.deploy) {
    const read = readSignedDeploy({ envelope, trust })
    if (!read.ok) return undefined
    const { deploy, signer } = read.value
    return { format: 1, deploy: shared(deploy), signer }
  }
  if (kind === PAYLOAD_TYPES.deployV2) {
    const read = readSignedDeployV2({ envelope, trust })
    if (!read.ok) return undefined
    const { deploy, signer } = read.value
    return {
      format: 2,
      deploy: {
        ...shared(deploy),
        previous: deploy.previous,
        routes: deploy.routes.map(({ domain, service, port }) => ({
          domain,
          service,
          port,
        })),
        health:
          deploy.health === null
            ? null
            : {
                timeout: deploy.health.timeout,
                services: deploy.health.services.map(({ service, http }) => ({
                  service,
                  http:
                    http === null ? null : { port: http.port, path: http.path },
                })),
              },
      },
      signer,
    }
  }
  return undefined
}

/** The fields both kinds of deploy carry, and nothing else. */
const shared = (deploy: Omit<Deploy, "v">): HistoryDeploy => ({
  teamId: deploy.teamId,
  teamHash: deploy.teamHash,
  serverId: deploy.serverId,
  app: deploy.app,
  sequence: deploy.sequence,
  createdAt: deploy.createdAt,
  compose: deploy.compose,
  secrets: deploy.secrets.map(({ name, hash, version }) => ({
    name,
    hash,
    version,
  })),
  removed: deploy.removed.map(({ name, version }) => ({ name, version })),
})
