# Quickstart: Core Library

## Checks (repository root)

```bash
bun install
bun run typecheck      # all workspaces pass
bun run test           # core unit tests and end-to-end scenarios pass
```

Only the core package:

```bash
cd packages/core
bun test                    # everything
bun test test/scenarios     # the end-to-end scenarios
```

## The round trip in one file

```ts
import {
  applyRosterUpdate, createDeploy, createSecret, createSigner, createTeam, generateMemberKeyPair,
  generateServerKeyPair, initialAgentState, openSecrets, proposeRoster, serverConfirmationCode,
  trustFoundingRoster, verifyDeploy,
} from "@workspace/core"

// On the developer's machine: a key and a team.
const me = generateMemberKeyPair()
const signer = createSigner(me.secretKey)
const team = await createTeam({ founderName: "Ada", signer })

// On the server: its own key pair, and the team pinned by the code a person typed in.
const server = generateServerKeyPair()
const pinned = trustFoundingRoster(team.envelope, team.confirmationCode)
if (!pinned.ok) throw new Error(pinned.error.code)
let state = initialAgentState({ serverId: server.serverId, team: pinned.value })

// The admin compares the server's code with the one shown on the server, then adds it to the team.
console.log("Compare on both sides:", serverConfirmationCode(server.publicKey))
const added = await proposeRoster({
  trust: team.trust, servers: [{ name: "prod-1", publicKey: server.publicKey }], signer,
})
const trust = added.trust

// The server receives the new team list through the relay and moves forward.
const followed = applyRosterUpdate(state.team, added.envelope)
if (!followed.ok) throw new Error(followed.error.code)
state = { ...state, team: followed.value }

// Back on the developer's machine: set a secret, sign a deploy.
const secret = await createSecret({
  trust, serverId: server.serverId, app: "web",
  name: "DATABASE_URL", value: "postgres://demo@db/app", version: 1, signer,
})
const deploy = await createDeploy({
  trust, serverId: server.serverId, app: "web", sequence: 1,
  compose: "services:\n  web:\n    image: example/web:1\n", secrets: [secret], signer,
})

// On the server, after the relay delivers `deploy`.
const verified = verifyDeploy({ envelope: deploy.envelope, secrets: deploy.secrets, state })
if (!verified.ok) throw new Error(`refused: ${verified.error.code}`)
state = verified.value.nextState                       // persist before running
const opened = openSecrets(verified.value, server.secretKey)
if (opened.ok) console.log(opened.value.DATABASE_URL)  // postgres://demo@db/app
```

## What the scenarios prove

| Scenario file | Shows |
|---------------|-------|
| `round-trip.test.ts` | A deploy is accepted and every secret recovered; the relay's copy contains no readable secret |
| `hostile-relay.test.ts` | Replayed, redirected and value-swapped deploys, a ciphertext planted by the relay and a rolled-back secret are each refused with their own reason |
| `retired-secrets.test.ts` | A retired secret stays retired: removals are signed, honoured by clients and remembered by the server |
| `cross-process.test.ts` | The same guarantees with the agent in its own process behind a real HTTP relay |
| `team.test.ts` | Adding and removing members works only through an admin's signature, in order |
| `pairing.test.ts` | A substituted key or founding list produces a different confirmation code, at any version of the team list |
| `messages.test.ts` | Every message kind round-trips, and malformed ones are rejected |

## Limits to remember

- The design is unaudited. An external review is required before production use.
- A relay can withhold deploys and team changes. It cannot forge, alter, reorder or redirect them.
- The length of an encrypted secret reveals the length of its value.
- A server only accepts deploys built from the team list it currently holds, so clients and servers must both be up to date. This is what stops a removed member's work from being deployed.
- A secret set by a member who has since been removed must be set again by a current member.

## Results

Recorded 2026-11-13 on macOS, Bun 1.4.2.

| Check | Result |
|-------|--------|
| `bun run typecheck` (repository root) | Pass, 3 workspaces |
| `bun run test` (repository root) | Pass: core 85 tests, web 28 tests |
| End-to-end scenarios (`packages/core/test/scenarios`) | Pass: 7 files, including the cross-process run with the agent in its own process behind a real HTTP relay |
| SC-004, verify and open 50 secrets | About 4 ms (limit 100 ms) |
| The example above, run as written | Prints the confirmation code and `postgres://demo@db/app` |
| Security review | See [security-review.md](./security-review.md) |
