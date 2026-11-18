# Data Model: Deploy version 2, the first step

Names in `code` are the planned TypeScript names. The rules of each field are in
[contracts/message.md](./contracts/message.md); the stored state's rules in
[contracts/state.md](./contracts/state.md). Nothing here changes a file of the CLI's profile folder.

## The version-2 deploy (signed payload)

Kind `zekno.deploy.v2` (`PAYLOAD_TYPES.deployV2`), signed by `signEnvelope` as every kind is. The
payload is JSON with exactly these fields, every one present (`DeployV2`, `deploy/message.ts`):

| Field | Type | In this step |
|---|---|---|
| `v` | `2` | checked |
| `teamId`, `teamHash`, `serverId`, `app` | as version 1 | checked as version 1 |
| `previous` | whole number, 0 to 2^53 - 2 | equal to the runner's last number for the app |
| `sequence` | `previous + 1` | checked |
| `createdAt` | ISO time | read by nobody, shown by the CLI |
| `expiresAt` | ISO time or `null` | the runner's clock, the 7-day window; the CLI signs `null` |
| `compose` | text, at most 256 KiB as UTF-8 | size only |
| `secrets` | `{ name, hash, version }[]`, at most 256, sorted, unique | completeness, versions, records |
| `removed` | `{ name, version }[]`, at most 256, sorted, unique, no name also in `secrets` | versions |
| `builds` | `Build[]`, at most 8 | its rules checked; not empty is `unsupported_version` |
| `predeploy` | `Predeploy \| null` | its rules checked; not null is `unsupported_version` |
| `health` | `Health \| null` | its rules checked; not null is `unsupported_version` |
| `routes` | `Route[]`, at most 64 | its rules checked; not empty is `unsupported_version` |

`Build`, `Predeploy`, `Health` and `Route` are in `deploy/later-fields.ts`, exactly as the design's
part 5 gives them.

## What travels beside it, unsigned

The `deploy` request (`RunnerDeployRequestSchema`): `rosters` (the team-list chain, as `apply`),
`envelope`, and `records`: whole secret records (`{ envelope, sealed }`, `SecretRecordSchema`), at
most 256, only for listed secrets the runner lacks.

## A verified version-2 deploy (`VerifiedDeployV2`)

What `verifyDeployV2` returns, frozen, and the only thing `openSecrets` opens for version 2:

| Field | What |
|---|---|
| `deploy` | the `DeployV2` read from under the signature |
| `signer` | the member who signed it |
| `nextState` | the stored state to save before anything runs (number used, versions, `formats[app] = 2`) |
| `write` | the supplied records the runner must store, each listed and verified |
| `keep` | the hashes of every live secret of the app after the change: the files to keep |

The sealed values to open (supplied and held) are kept beside it in the module's registry
(`deploy/open.ts`), never on the object.

## The runner's stored state (`StoredRunnerState`)

`state.json`, written whole with `writeAtomic` at every write of a runner of this feature:

```json
{
  "v": 2,
  "serverId": "srv_…",
  "team": { "teamId": "team_…", "version": 2, "hash": "…", "foundingHash": "…", "members": [], "servers": [] },
  "lastSequence": { "demo": 42 },
  "secrets": { "demo/DATABASE_URL": { "version": 3, "hash": "…" }, "demo/OLD": { "version": 2, "hash": null } },
  "formats": { "demo": 2 }
}
```

| Part | Rule |
|---|---|
| `v` | the mark: exactly `2`. Absent: a state from before version 2 (`RunnerState`, read by today's schema, migrated) |
| `serverId`, `team`, `lastSequence`, `secrets` | today's `RunnerState`, the version-1 view (`versionOneView`) |
| `formats` | each app's message format: `1` (held when the state was first read, no version-2 deploy since) or `2`; exactly the apps of `lastSequence` |

## A held record

`records/<app>/<hash>.json` in the runner's folder: the secret record `{ envelope, sealed }` as it
arrived, mode 0600, where `<hash>` is the listed ciphertext hash. For an app at format 2, every
entry of `secrets` with a hash has exactly one file, and no other file exists after a deploy
completes its write (contracts/state.md, ST7). Entries written by a version-1 deploy have no file.

## The `records` answer (`RunnerRecordsSchema`)

`{ "statements": [Envelope, …] }`: the statement of each held record of the app, sorted by name, at
most 256. A statement (`zekno.secret.v1`) says team, server, app, name, version, hash, time, and is
signed: name, version, hash and the signer's key id, never a value.

## What a deploy lists (`secretsForDeploy`'s result)

| Field | What |
|---|---|
| `statements` | the chosen statement of each listed secret (this machine's, or one the runner holds) |
| `removals` | the chosen removal of each removed name |
| `supply` | version 2: this machine's records whose hash no statement the runner holds has; version 1: every chosen record |
| `blocked` | `{ name, why: "former_member" \| "cannot_check" }[]`, in name order: C4 and C5 |
| `ignored` | what was left out and blocks nothing, as `currentSecrets`'s `ignored` (today's warning) |

C5b is not in `blocked`: the CLI works it out from `statements` and this machine's own items
(`listForDeploy` in `apps/cli/src/ops/deploy-secrets.ts`; research R8), so the core result is as
above.

## What this machine remembers of the server (`held/<serverId>/<app>.json`)

A file of the profile folder (`apps/cli/src/profile/profile.ts`, `profileStore().held(serverId,
app)` and `saveHeld(serverId, app, held)`), written by the profile's `write` (mode 0600, folder
0700, a new file then a rename):

```json
{
  "statements": [{ "payloadType": "zekno.secret.v1", "payload": "…", "signature": { "keyId": "…", "sig": "…" } }],
  "versions": [{ "name": "DATABASE_URL", "version": 3, "removed": false }]
}
```

| Part | Rule |
|---|---|
| `statements` | the envelopes of the runner's `records` answer that `peekSecretStatement` reads, each `payload` at most 4,096 characters; at most 256 (`HeldSchema`, strict) |
| `versions` | the app's entries of the runner's `status` answer: `name` (`SECRET_NAME`, at most 128), `version` (1 to 2^53 - 1), `removed`; at most 8,192 |

- Written by every version-2 deploy right after its `records` read (CL3b), before anything can stop
  it, and replaced whole each time. Not written by a version-1 deploy, `status`, or any other
  command.
- Read by `zekno secret set` and `zekno secret rm` only, as a floor for the next version and to know
  a name the server holds (research R9). Missing, unreadable or not matching: read as empty.
- Never holds a value or a sealed value; never gives a hash or a listing (FR-021).

## History entries

Unchanged schema (`HistorySchema`, `apps/cli/src/profile/profile.ts`): `{ envelope, at, outcome }`,
outcome `sent`, `started` or `start_failed`, at most 50 per app. The envelope is of either kind.
`readDeployEntry` (`shared/history.ts`) gives:

| Field | Version 1 | Version 2 |
|---|---|---|
| `format` | `1` | `2` |
| `deploy` | `sequence`, `compose`, `createdAt`, `teamId`, `teamHash`, `serverId`, `app`, `secrets`, `removed` | the same, and `previous` |
| `signer` | the member, from the team list given | the same |

A refused version-2 deploy's entry is taken out again; an entry whose answer never came stays
`sent` (research R6).

## Refusal reasons

| Set | Reasons | Where they can appear |
|---|---|---|
| `DEPLOY_REFUSALS` (unchanged) | `malformed`, `too_large`, `unsupported_version`, `wrong_payload_type`, `unknown_signer`, `bad_signature`, `role_not_allowed`, `wrong_team`, `stale_team`, `wrong_server`, `unknown_server`, `replayed`, `sequence_jump`, `secrets_mismatch`, `stale_secret` | `apply` and `deploy`; the hosted service's report |
| `DEPLOY_V2_REFUSALS` (new) | `secret_missing`, `untrusted_secret`, `expired` | answers to `deploy` only |
| `RUNNER_REFUSALS` (unchanged) | `invalid_request`, `invalid_state`, `not_set_up`, `already_set_up`, `busy` | every request |
| `ROSTER_REFUSALS` (unchanged) | from following team lists | `sync`, `apply`, `deploy` |

`DeployV2Refusal` = `DeployRefusal | (typeof DEPLOY_V2_REFUSALS)[number]`.

## An app's states on a runner of this feature

```text
                 (state read without a mark, app held)
  version 1 only ───────────────────────────────────────┐
    formats[app] = 1                                     │ a version-2 deploy accepted
    apply: accepted (as today)                           ▼
    deploy: accepted, every live secret supplied ──► version 2
                                                        formats[app] = 2
  (app the runner never held) ─── first deploy ───►    apply: unsupported_version
    no entry; apply: unsupported_version                deploy: accepted (order rule, completeness)
    deploy previous 0: accepted
```

- **Version 1 only**: the runner first read a state without a mark that held the app (number 1 or
  more). `apply` from any zekno is checked as today and writes back the whole stored state with
  only `lastSequence` and `secrets` changed; the app stays at 1. Its live secrets have no record
  file.
- **First version-2 deploy**: names `previous` = the app's last number, whatever version made it;
  must list every live secret and supply each record the runner lacks (all of them, since version 1
  stored none), or remove it. Accepted: `formats[app]` becomes 2, for good.
- **Version 2**: `apply` is `unsupported_version`, which every older zekno reads. Every later
  deploy names `previous`; every refusal uses no number.
- **Never held**: a new app is version 2 from its first deploy, so `apply` of a new app is
  `unsupported_version` on every runner of this feature (V2).
