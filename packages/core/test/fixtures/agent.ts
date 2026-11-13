/**
 * A minimal agent, run as its own process by the cross-process scenario. It
 * uses only the library's public interface and talks to the relay over HTTP,
 * exactly as a real agent would. Everything it learns arrives as JSON.
 *
 * Environment: RELAY_URL, CONFIRMED_CODE (the code a person typed on the
 * server), EXPECTED (how many deploys to process before exiting).
 */
import {
  applyRosterUpdate,
  generateServerKeyPair,
  initialAgentState,
  openSecrets,
  parseMessage,
  PendingDeploysResponseSchema,
  RosterChainResponseSchema,
  serverConfirmationCode,
  trustFoundingRoster,
  verifyDeploy,
  type AgentState,
  type StatusReport,
} from "../../src/index"

const relay = process.env.RELAY_URL!
const expected = Number(process.env.EXPECTED ?? 1)
const say = (line: unknown) => console.log(JSON.stringify(line))

async function post(path: string, body: unknown) {
  const response = await fetch(`${relay}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`relay answered ${response.status} to ${path}`)
}

// The server's key pair is created here and the secret half never leaves this process.
const server = generateServerKeyPair()
await post("/servers", { serverPublicKey: server.publicKey, serverId: server.serverId })
say({ type: "registered", serverId: server.serverId, code: serverConfirmationCode(server.publicKey) })

// The founding team list comes through the relay; the code comes from a person.
const chain = parseMessage(RosterChainResponseSchema, await (await fetch(`${relay}/rosters`)).text())
if (!chain.ok || chain.value.rosters.length === 0) throw new Error("no team list from the relay")
const trusted = trustFoundingRoster(chain.value.rosters[0], process.env.CONFIRMED_CODE ?? "")
if (!trusted.ok) {
  say({ type: "pairing-refused", reason: trusted.error.code })
  process.exit(2)
}
say({ type: "paired", team: trusted.value.teamId })

let state: AgentState = initialAgentState({ serverId: server.serverId, team: trusted.value })
let processed = 0

/** Applies any newer team lists the relay holds. A refused list changes nothing. */
async function followTeam() {
  const latest = parseMessage(RosterChainResponseSchema, await (await fetch(`${relay}/rosters`)).text())
  if (!latest.ok) return
  for (const envelope of latest.value.rosters.slice(state.team.version)) {
    const applied = applyRosterUpdate(state.team, envelope)
    if (!applied.ok) return
    state = { ...state, team: applied.value }
  }
}

while (processed < expected) {
  await followTeam()
  const pending = parseMessage(PendingDeploysResponseSchema, await (await fetch(`${relay}/deploys`)).text())
  if (!pending.ok) throw new Error(`relay sent a ${pending.error.code} response`)

  for (const delivered of pending.value.deploys) {
    const verified = verifyDeploy({ envelope: delivered.envelope, secrets: delivered.secrets, state })
    const at = new Date().toISOString()
    if (!verified.ok) {
      // Enough to report without trusting the content: the relay knows which deploy it sent.
      say({ type: "deploy", outcome: "refused", reason: verified.error.code })
      await post("/refusals", { reason: verified.error.code })
      processed += 1
      continue
    }
    state = verified.value.nextState // persisted before anything runs
    const opened = openSecrets(verified.value, server.secretKey)
    const { teamId, serverId, app, sequence } = verified.value.deploy
    const report: StatusReport = { v: 1, teamId, serverId, app, sequence, outcome: "accepted", at }
    await post("/status", report)
    say({
      type: "deploy",
      outcome: "accepted",
      sequence,
      signer: verified.value.signer.name,
      compose: verified.value.deploy.compose,
      secrets: opened.ok ? { ...opened.value } : null,
    })
    processed += 1
  }
  if (processed < expected) await new Promise((resolve) => setTimeout(resolve, 25))
}
