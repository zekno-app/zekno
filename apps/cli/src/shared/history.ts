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
  builtImageName,
  PAYLOAD_TYPES,
  readSignedDeploy,
  readSignedDeployV2,
  SERVICE_NAME,
  type Build,
  type Deploy,
  type Envelope,
  type Health,
  type Member,
  type Route,
  type TeamTrust,
} from "@workspace/core"

import { aliasesTooMany, COMPOSE_READ_BYTES } from "../project/compose-file"

/** Whether two envelopes are the same signed bytes: how an entry of the history, or a record, is found again. */
export const sameEnvelope = (a: Envelope, b: Envelope): boolean =>
  a.payloadType === b.payloadType &&
  a.payload === b.payload &&
  a.signature.keyId === b.signature.keyId &&
  a.signature.sig === b.signature.sig

/**
 * One build a version-2 deploy signed (specs/016-build-from-source,
 * data-model.md, "The history"; FR-065): the entry exactly as signed, so a
 * rollback signs it again as it was, and the services of the deploy's
 * Compose text that run its image (`zekno.invalid/<app>:<key>`, CO2), in the
 * text's order. The services are read from the signed text, never kept
 * beside it; each is held to core's `SERVICE_NAME`, and is cleaned before
 * it is drawn.
 */
export type HistoryBuild = { build: Build; services: readonly string[] }

/**
 * What both kinds of deploy say, read from under the signature. `previous`:
 * the deploy a version-2 deploy was made after. `routes` and `health`: what
 * a version-2 deploy signed of them (specs/015-domains-https, research R30),
 * for "changed, not deployed"; a version-1 deploy has neither field.
 * `builds`: those a version-2 deploy signed, sorted by key as signed, and
 * only when it signed one (specs/016-build-from-source, FR-065), so a deploy
 * that built nothing, and every entry written before that feature, reads as
 * it did.
 */
export type HistoryDeploy = Omit<Deploy, "v"> & {
  previous?: number
  routes?: readonly Route[]
  health?: Health | null
  builds?: readonly HistoryBuild[]
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
        ...(deploy.builds.length === 0
          ? {}
          : { builds: buildsOf(deploy.app, deploy.compose, deploy.builds) }),
      },
      signer,
    }
  }
  return undefined
}

/**
 * Each build as signed, a copy of the reader's frozen value, with the
 * services that run its image (`HistoryBuild`). A Compose text that cannot
 * be read within the bounds the app screen holds it to (`composeServices`
 * in views.ts) gives every build no service, never an error.
 */
function buildsOf(
  app: string,
  compose: string,
  builds: readonly Build[]
): HistoryBuild[] {
  const served = servicesByImage(compose)
  return builds.map((build) => ({
    build: structuredClone(build),
    services: served.get(builtImageName(app, build.key)) ?? [],
  }))
}

/**
 * The services of a Compose text by the image each names, in the text's
 * order. Its size and its aliases are held to the bounds every reader of a
 * Compose text keeps (compose-file.ts), since Bun's parser copies what each
 * alias stands for; a name outside `SERVICE_NAME` is not a service zekno
 * wrote, and is left out.
 */
function servicesByImage(compose: string): Map<string, string[]> {
  const byImage = new Map<string, string[]>()
  if (compose.length > COMPOSE_READ_BYTES || aliasesTooMany(compose))
    return byImage
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(compose)
  } catch {
    return byImage
  }
  const services = (parsed as { services?: unknown } | null)?.services
  if (typeof services !== "object" || services === null) return byImage
  if (Array.isArray(services)) return byImage
  for (const [name, service] of Object.entries(services)) {
    const image = (service as { image?: unknown } | null)?.image
    if (typeof image !== "string" || !SERVICE_NAME.test(name)) continue
    byImage.set(image, [...(byImage.get(image) ?? []), name])
  }
  return byImage
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
