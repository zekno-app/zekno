# Data Model: Core Library

Nothing here is stored by the library. These are the values it creates, checks and returns.

## Keys

| Value | Text form | Bytes | Notes |
|-------|-----------|-------|-------|
| Member public key | `zk_mpk_` + base64url | 32 (Ed25519) | In team lists |
| Member secret key | `zk_msk_` + base64url | 64 (Ed25519) | Stays with the member's client |
| Server public key | `zk_spk_` + base64url | 32 (X25519) | Used to seal secrets |
| Server secret key | `zk_ssk_` + base64url | 32 (X25519) | Never leaves the server |
| Key id | 32 hex characters | 16 | BLAKE2b of a member public key; names the signer of an envelope |
| Server id | `srv_` + 32 hex characters | 16 | BLAKE2b of the server public key |
| Team id | `team_` + 22 base64url characters | 16 random | Created with the founding list |

Validation: the prefix must match the expected kind and the decoded length must be exact.

## Envelope

| Field | Type | Rule |
|-------|------|------|
| `payloadType` | string | `zekno.deploy.v1`, `zekno.roster.v1`, `zekno.secret.v1` or `zekno.secret-removal.v1` |
| `payload` | base64url string | The exact signed bytes (UTF-8 JSON) |
| `signature.keyId` | key id | Signer |
| `signature.sig` | base64url string | 64-byte Ed25519 signature over the prefixed payload |

## Team list (payload of `zekno.roster.v1`)

| Field | Type | Rule |
|-------|------|------|
| `v` | 1 | Format version |
| `teamId` | team id | Same in every list of a team |
| `version` | integer ≥ 1 | Founding list is 1; each update adds 1 |
| `previous` | hash or null | Null only for version 1; otherwise the hash of the list replaced |
| `createdAt` | ISO 8601 UTC | Informational |
| `members[]` | 1 to 64 | `{ name (1–64 chars), publicKey, role: "admin" \| "deployer" }` |
| `servers[]` | 0 to 256 | `{ name (1–64 chars), publicKey }`; the id is derived from the key |

Rules: member keys and names unique; at least one admin; server keys and names unique. Names have
no control, format or line-separator characters and no surrounding space.

**Team trust** (what a server or client remembers): `{ teamId, version, hash, foundingHash,
members, servers }`. `foundingHash` never changes; the team's confirmation code comes from it.

Transitions:

```text
(none) --trustFoundingRoster(envelope, confirmed code)--> trust v1
trust vN --applyRosterUpdate(envelope signed by an admin of vN, version N+1, previous = hash vN)--> trust vN+1
```

## Sealed secret

| Field | Type | Rule |
|-------|------|------|
| `name` | string | `^[A-Za-z_][A-Za-z0-9_]*$`, at most 128 characters |
| `ciphertext` | base64url string | Sealed box of `{ v: 1, serverId, app, name, value }` |

`value`: well-formed text, at most 64 KiB as UTF-8.

## Secret record

`{ envelope, sealed }`, where the envelope is of kind `zekno.secret.v1` and its payload is the
member's statement:

| Field | Type | Rule |
|-------|------|------|
| `v` | 1 | Format version |
| `teamId`, `serverId`, `app`, `name` | as above | Where the secret belongs |
| `version` | integer ≥ 1 | Raised each time the secret is set again |
| `hash` | hash | Of the sealed ciphertext |
| `createdAt` | ISO 8601 UTC | Informational |

## Secret removal

An envelope of kind `zekno.secret-removal.v1` whose payload is `{ v, teamId, serverId, app, name,
version, createdAt }`. `version` is one above the version of the secret being retired. Setting the
name again later uses a higher version still.

## Deploy (payload of `zekno.deploy.v1`)

| Field | Type | Rule |
|-------|------|------|
| `v` | 1 | Format version |
| `teamId` | team id | Must equal the runner's team |
| `teamHash` | hash | The team list the signer worked from; must equal the runner's current list |
| `serverId` | server id | Must equal the runner's own |
| `app` | string | `^[a-z0-9][a-z0-9-]{0,62}$` |
| `sequence` | integer ≥ 1 | Higher than the last accepted for this app, by at most 1,048,576 |
| `createdAt` | ISO 8601 UTC | Informational |
| `compose` | string | Service definition, at most 256 KiB, not interpreted |
| `secrets[]` | 0 to 256 | `{ name, hash, version }`, sorted by name, names unique |
| `removed[]` | 0 to 256 | `{ name, version }` for retired secrets, sorted by name; no name appears in both lists |

## Runner state

`{ serverId, team: TeamTrust, lastSequence: { [app]: number }, secrets: { ["app/NAME"]: { version, hash } } }`

`hash` is null when the latest version of that name is a removal.

Every field is required. `initialRunnerState({ serverId, team })` builds the starting value.

Transition: `verifyDeploy` succeeds → the result carries `nextState` with `lastSequence[app]` set to
the deploy's number and `secrets` updated to the versions and hashes the deploy carries. The runner
persists it before running the deploy.

## Refusal reasons

Deploy: `malformed`, `too_large`, `unsupported_version`, `wrong_payload_type`, `unknown_signer`,
`bad_signature`, `role_not_allowed`, `wrong_team`, `stale_team`, `wrong_server`, `unknown_server`, `replayed`,
`sequence_jump`, `secrets_mismatch`, `stale_secret`.

Secret record: `malformed`, `too_large`, `unsupported_version`, `wrong_payload_type`,
`unknown_signer`, `bad_signature`, `wrong_team`, `wrong_server`, `wrong_app`, `secrets_mismatch`.

Team list: `malformed`, `too_large`, `unsupported_version`, `wrong_payload_type`, `unknown_signer`,
`bad_signature`, `not_admin`, `wrong_team`, `wrong_version`, `wrong_previous`, `invalid_members`,
`code_mismatch`.

Opening secrets: `not_verified`, `wrong_server_key`, `decrypt_failed`, `binding_mismatch`.

## Confirmation code

Twenty Crockford base32 characters (100 bits), shown as `XXXX-XXXX-XXXX-XXXX-XXXX`. Derived from a
server public key or from the founding hash held in team trust, each with its own domain.
