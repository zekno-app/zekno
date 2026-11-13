# Public Interface Contract

Everything is exported from `@workspace/core`. Callers import nothing else.

## Conventions

- **Results**: functions that judge untrusted input return
  `{ ok: true, value } | { ok: false, error: { code, message } }` and never throw for bad input.
- **Errors**: functions given invalid arguments by their own caller (for example sealing a secret
  with an illegal name) throw `CoreError` with a stable `code`.
- No function performs I/O or keeps state. No error message contains a secret value or private key.

## Keys

| Function | Returns |
|----------|---------|
| `generateMemberKeyPair()` | `{ publicKey, secretKey }` |
| `generateServerKeyPair()` | `{ publicKey, secretKey, serverId }` |
| `keyIdOf(memberPublicKey)` | key id |
| `serverIdOf(serverPublicKey)` | server id |
| `createSigner(memberSecretKey)` | `Signer` (`publicKey`, `sign(bytes)`, `destroy()`) |

A client that keeps its key in a keychain or hardware device supplies its own `Signer`.

## Confirmation codes

| Function | Returns |
|----------|---------|
| `serverConfirmationCode(serverPublicKey)` | code |
| `teamConfirmationCode(trust)` | code, from the founding hash in trust; needs nothing from the control plane |
| `confirmationCodesMatch(a, b)` | boolean; ignores case and separators; constant time |

## Team

| Function | Returns |
|----------|---------|
| `createTeam({ founderName, signer, now? })` | `{ envelope, trust, confirmationCode }` |
| `trustFoundingRoster(envelope, confirmedCode)` | `Result<TeamTrust>` |
| `proposeRoster({ trust, members?, servers?, signer, now? })` | `{ envelope, trust }` for version N+1; omitted lists stay as they are |
| `applyRosterUpdate(trust, envelope)` | `Result<TeamTrust>` |

## Secrets and deploys: client side

| Function | Returns |
|----------|---------|
| `createSecret({ trust, serverId, app, name, value, version, signer, now? })` | `SecretRecord` (`{ envelope, sealed }`) |
| `verifySecret({ record, trust, serverId, app })` | `Result<VerifiedSecret>` |
| `createSecretRemoval({ trust, serverId, app, name, version, signer, now? })` | signed removal envelope |
| `verifySecretRemoval({ removal, trust, serverId, app })` | `Result<VerifiedRemoval>` |
| `currentSecrets({ trust, serverId, app, records, removals })` | `{ secrets, removals, ignored }` |
| `createDeploy({ trust, serverId, app, sequence, compose, secrets, removals?, signer, now? })` | `{ envelope, secrets }` |

Both take a server by id and read its key from the admin-signed team list, throwing `CoreError`
`unknown_server` for a server that is not in it. `createDeploy` takes secret records and verifies each one against the team list before signing. It
throws `CoreError` `untrusted_secret` for a record not signed by a current member, or set for
another server or app. There is no public function that seals a secret without signing it.

The normal path for a client: download the app's records and removals from the control plane,
pass them to `currentSecrets`, show `ignored` to the person deploying, and pass `secrets` and
`removals` to `createDeploy`. `ignored` lists each item that failed verification with its
refusal code, and each name where two different items claim the same version (`conflict`).

## Deploys: agent side

| Function | Returns |
|----------|---------|
| `initialAgentState({ serverId, team })` | the state of a server that has accepted nothing yet |
| `verifyDeploy({ envelope, secrets, state })` | `Result<VerifiedDeploy>` |
| `openSecrets(verified, serverSecretKey)` | `Result<Record<name, value>>` |

`VerifiedDeploy` exposes `deploy` (the checked content), `signer` (the member who signed) and
`nextState`. It can only be obtained from `verifyDeploy`; `openSecrets` refuses anything else with
`not_verified`.

Order of checks in `verifyDeploy`, each with its own refusal code: size, envelope shape, payload
type, signer known, signature, payload shape and version, role, team, team-list version, server,
server listed, sequence, sequence step, secrets, secret versions.

An agent processes deploys one at a time: verify, persist `nextState`, open, run, then verify the
next one against the persisted state. Verifying a batch against one state would accept a
duplicate twice.

## Messages

Each has a zod schema (`…Schema`) and a type. Schemas are strict.

| Message | Direction | Content |
|---------|-----------|---------|
| `PublishSecretRequest` | client → control plane | a secret record |
| `PublishSecretRemovalRequest` | client → control plane | `{ envelope }` |
| `SecretsResponse` | control plane → client | `{ secrets: record[], removals: envelope[] }`; the client passes both to `currentSecrets` |
| `PublishDeployRequest` | client → control plane | `{ envelope, secrets[] }` |
| `PendingDeploysResponse` | control plane → agent | `{ deploys: [{ envelope, secrets[] }] }` |
| `StatusReport` | agent → control plane | `{ v, teamId, serverId, app, sequence, outcome, reason?, at }` |
| `PublishRosterRequest` | client → control plane | `{ envelope }` |
| `RosterChainResponse` | control plane → client or agent | `{ rosters: envelope[] }` in version order |
| `RegisterServerRequest` | agent → control plane | `{ serverPublicKey, serverId }` |

`StatusReport.outcome` is `accepted`, `refused`, `started` or `failed`. `reason` is a refusal code.
There is no free-text field.

`parseMessage(schema, input, maxBytes?)` validates any of them and returns a `Result`.
