/**
 * A team of one, made in memory, with a server `dev` and a profile folder of
 * its own: for the tests of what the CLI reads and writes on this machine
 * without a runner (the history of both kinds of deploy, secrets, what this
 * machine remembers of a server). Its `team` is shaped as `openTeam` gives
 * one, with a signer that never touches a keychain.
 */
import {
  createDeploy,
  createDeployV2,
  createSecret,
  createSecretRemoval,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  generateServerKeyPair,
  keyIdOf,
  proposeRoster,
  type Envelope,
  type Health,
  type Route,
  type SecretRecord,
  type Signer,
} from "@workspace/core"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Team } from "../../src/cli/context"
import {
  profileStore,
  type Profile,
  type Server,
} from "../../src/profile/profile"

/**
 * Signs any bytes as any kind, as `signEnvelope` does (`zekno-sig-v1\n<kind>\n<length>\n`
 * then the bytes), so a test can sign what the core library would refuse to
 * make: a payload with a field no reader knows, or a version it does not take.
 */
export async function signAs(
  kind: string,
  payload: string,
  signer: Signer
): Promise<Envelope> {
  const bytes = Buffer.from(payload, "utf8")
  const input = Buffer.concat([
    Buffer.from(`zekno-sig-v1\n${kind}\n${bytes.length}\n`, "utf8"),
    bytes,
  ])
  const sig = await signer.sign(new Uint8Array(input))
  return {
    payloadType: kind,
    payload: bytes.toString("base64url"),
    signature: {
      keyId: keyIdOf(signer.publicKey),
      sig: Buffer.from(sig).toString("base64url"),
    },
  }
}

/** The JSON of an envelope's payload, read without checking anything. */
export const payloadOf = (envelope: Envelope): Record<string, unknown> =>
  JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"))

/** A team of one, Ada, with a server `dev`, its profile saved in a folder of its own. */
export async function signingTeam(app = "demo") {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const founded = await createTeam({ founderName: "Ada", signer })
  const serverKeys = generateServerKeyPair()
  const added = await proposeRoster({
    trust: founded.trust,
    servers: [{ name: "dev", publicKey: serverKeys.publicKey }],
    signer,
  })
  const trust = added.trust
  const home = mkdtempSync(join(tmpdir(), "zekno-signing-"))
  const store = profileStore(home)
  const server: Server = {
    name: "dev",
    serverId: serverKeys.serverId,
    target: { kind: "local", home: join(home, "runner") },
  }
  const profile: Profile = {
    memberName: "Ada",
    keyName: "zekno-test",
    rosters: [founded.envelope, added.envelope],
    servers: [server],
  }
  store.save(profile)
  const team: Team = {
    store,
    profile,
    trust,
    chain: [founded.trust, trust],
    teamCode: founded.confirmationCode,
    withSigner: (work) => work(signer),
  }
  const serverId = serverKeys.serverId
  return {
    home,
    team,
    server,
    trust,
    signer,
    serverKeys,
    /** A version-1 deploy of `app`, signed as `zekno` signs one. */
    deployV1: async (
      sequence: number,
      compose: string,
      secrets: readonly SecretRecord[] = [],
      removals: readonly Envelope[] = []
    ) =>
      (
        await createDeploy({
          trust,
          serverId,
          app,
          sequence,
          compose,
          secrets,
          removals,
          signer,
        })
      ).envelope,
    /** A version-2 deploy of `app`, made after `previous`. */
    deployV2: (
      previous: number,
      compose: string,
      statements: readonly Envelope[] = [],
      removals: readonly Envelope[] = [],
      // specs/015-domains-https: the routes and the health check, none when left out.
      routed: { routes?: readonly Route[]; health?: Health | null } = {}
    ) =>
      createDeployV2({
        trust,
        serverId,
        app,
        previous,
        compose,
        statements,
        removals,
        expiresAt: null,
        signer,
        ...routed,
      }),
    /** A secret of `app` set by Ada. */
    secret: (name: string, value: string, version: number) =>
      createSecret({ trust, serverId, app, name, value, version, signer }),
    /** The removal of a secret of `app`, signed by Ada. */
    removal: (name: string, version: number) =>
      createSecretRemoval({ trust, serverId, app, name, version, signer }),
  }
}
