import {
  applyRosterUpdate,
  createDeploy,
  createSecret,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  generateServerKeyPair,
  initialAgentState,
  proposeRoster,
  teamConfirmationCode,
  trustFoundingRoster,
  type AgentState,
  type Envelope,
  type SealedSecret,
  type SecretRecord,
  type Signer,
  type TeamTrust,
} from "../src/index"

export const COMPOSE = "services:\n  web:\n    image: example/web:1\n"

/** Obviously fake values. Never a real credential format. */
export const SAMPLE_SECRETS = {
  DATABASE_URL: "postgres://demo:demo-password@db.example/app",
  PAYMENTS_KEY: "demo-key-not-a-secret",
  PUBLIC_URL: "https://app.example",
} as const

export type Person = { name: string; signer: Signer; publicKey: Signer["publicKey"] }

export function person(name: string): Person {
  const pair = generateMemberKeyPair()
  const signer = createSigner(pair.secretKey)
  return { name, signer, publicKey: signer.publicKey }
}

/** A server as its agent sees it: its keys and the state it persists. */
export type Server = ReturnType<typeof generateServerKeyPair> & { name: string; state: AgentState }

/** Everything an attacker who controls the relay holds. Team lists are in version order. */
export type Relay = {
  deploys: { envelope: Envelope; secrets: SealedSecret[] }[]
  records: SecretRecord[]
  rosters: Envelope[]
}

/** A team with one admin and one connected server, both up to date. */
export async function setup(founderName = "Ada") {
  const founder = person(founderName)
  const team = await createTeam({ founderName, signer: founder.signer })
  const relay: Relay = { deploys: [], records: [], rosters: [team.envelope] }
  const { server, trust } = await addServer({ relay, trust: team.trust, admin: founder.signer, name: "prod-1" })
  return { founder, team, relay, server, trust }
}

/**
 * Connects a server. The server pins the founding list using the team's code
 * (typed by a person), the admin adds the server's key to the team list
 * (after comparing the server's code), and the server catches up.
 */
export async function addServer(input: { relay: Relay; trust: TeamTrust; admin: Signer; name: string }) {
  const keys = generateServerKeyPair()
  const pinned = trustFoundingRoster(input.relay.rosters[0], teamConfirmationCode(input.trust))
  if (!pinned.ok) throw new Error(`pairing failed: ${pinned.error.code}`)
  const server: Server = { ...keys, name: input.name, state: initialAgentState({ serverId: keys.serverId, team: pinned.value }) }
  const trust = await changeTeam({
    relay: input.relay,
    trust: input.trust,
    signer: input.admin,
    servers: [...input.trust.servers, { name: input.name, publicKey: keys.publicKey }],
  })
  catchUp(server, input.relay)
  return { server, trust }
}

/** An admin signs the next team list and hands it to the relay. Returns the admin's new trust. */
export async function changeTeam(input: Parameters<typeof proposeRoster>[0] & { relay: Relay }): Promise<TeamTrust> {
  const { relay, ...change } = input
  const next = await proposeRoster(change)
  relay.rosters.push(next.envelope)
  return next.trust
}

/** A server applies every team list the relay holds beyond the one it is on. */
export function catchUp(server: Server, relay: Relay): void {
  for (const envelope of relay.rosters.slice(server.state.team.version)) {
    const applied = applyRosterUpdate(server.state.team, envelope)
    if (!applied.ok) throw new Error(`team list refused: ${applied.error.code}`)
    server.state = { ...server.state, team: applied.value }
  }
}

/** Only the envelope of a proposed team list, for tests that deliver it by hand. */
export async function propose(input: Parameters<typeof proposeRoster>[0]): Promise<Envelope> {
  return (await proposeRoster(input)).envelope
}

/** A member sets one secret: sealed for the server and signed, then stored by the relay. */
export async function setSecret(input: {
  relay: Relay
  trust: TeamTrust
  server: Pick<Server, "serverId">
  signer: Signer
  name: string
  value: string
  app?: string
  version?: number
}): Promise<SecretRecord> {
  const record = await createSecret({
    trust: input.trust,
    serverId: input.server.serverId,
    app: input.app ?? "web",
    name: input.name,
    value: input.value,
    version: input.version ?? 1,
    signer: input.signer,
  })
  input.relay.records.push(record)
  return record
}

/** A member sets the given values and signs a deploy, then hands everything to the relay. */
export async function publish(input: {
  relay: Relay
  trust: TeamTrust
  server: Pick<Server, "serverId">
  signer: Signer
  sequence: number
  app?: string
  values?: Record<string, string>
  compose?: string
  /** Version given to every secret set by this call. */
  secretVersion?: number
}) {
  const app = input.app ?? "web"
  const secrets: SecretRecord[] = []
  for (const [name, value] of Object.entries(input.values ?? SAMPLE_SECRETS)) {
    secrets.push(await setSecret({ ...input, app, name, value, version: input.secretVersion ?? input.sequence }))
  }
  const deploy = await createDeploy({
    trust: input.trust,
    serverId: input.server.serverId,
    app,
    sequence: input.sequence,
    compose: input.compose ?? COMPOSE,
    secrets,
    signer: input.signer,
  })
  input.relay.deploys.push(deploy)
  return deploy
}

/** A deep copy, as if the message had crossed the network as JSON. */
export function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
