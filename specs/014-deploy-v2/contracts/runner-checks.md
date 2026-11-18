# Contract: the runner's checks of a version-2 deploy

FR-006, FR-007, FR-009, FR-013, FR-014, FR-016 to FR-020, FR-024 to FR-026, FR-036, FR-038,
FR-040 to FR-044. The design's part 6, restricted to what this step carries out, with one lock
(decision 5 (b)). The request is handled by `deploy` in `apps/runner/src/commands/deploy.ts`; K4 to
K12 are `verifyDeployV2` in `packages/core/src/deploy/deploy-v2.ts`; the rest is the runner's.

## The order

The first check that fails gives the answer `{"outcome":"refused","reason":"<reason>"}`. Each row has
a test that fails at that check and at no earlier one (T022, T036, T044, T057, T059).

| # | Check | Reason |
|---|---|---|
| K1 | The request line is at most 32 MiB and matches `RunnerDeployRequestSchema` (strict) | `invalid_request` |
| K2 | The runner is set up; take the deploy lock (`acquireLock`); its folder and key are private; the stored state reads (contracts/state.md) | `not_set_up`, `busy`, `invalid_state` |
| K3 | Follow the team lists sent with it (`follow`), and save the whole stored state with its mark if they changed | the team list's own reason (`ROSTER_REFUSALS`) |
| K4 | The envelope's size, shape and kind `zekno.deploy.v2` | `too_large`, `malformed`, `wrong_payload_type` |
| K5 | The signer is a current member; the signature | `unknown_signer`, `bad_signature` |
| K6 | The payload, by `readDeployV2Payload` steps F4 to F6 (contracts/message.md) | `malformed` |
| K7 | A later field that is not empty (F7) | `unsupported_version` |
| K8 | Role in `DEPLOY_ROLES`; team; team list hash; server; server listed | `role_not_allowed`, `wrong_team`, `stale_team`, `wrong_server`, `unknown_server` |
| K9 | `previous` equals `lastSequence[app]` (0 when absent): lower, then higher | `replayed`, `sequence_jump` |
| K10 | `expiresAt` not `null` and not later than the runner's clock; more than 7 days after it (`LIMITS.expiryWindowMs`); `null` when taken from the hosted service (`via`; never on this runner) | `expired` |
| K11 | Every name of the app with a live version (`secrets["<app>/<NAME>"].hash !== null`) is in `secrets` or `removed` | `secrets_mismatch` |
| K12 | For each entry of `secrets` and `removed`, in name order: not below the version held, nor the same version with another hash (version 1's rule) | `stale_secret` |
| K13 | For each entry of `secrets`, in name order: the record (below) | `untrusted_secret`, `secrets_mismatch`, `secret_missing` |
| K14 | Each supplied record names a listed secret, once | `secrets_mismatch` |
| K15 | After the change: at most 1,024 apps, 8,192 secret entries (`withinLimits`), 8,192 live records and 64 MiB of record files (`LIMITS.recordBytesPerServer`) | `too_large` |
| K16 | Open every listed secret's sealed value (`openSecrets`) | `secrets_mismatch` |
| K17 | Write each supplied record (`home/records.ts`), save the state (`nextState`), delete the app's record files no live entry names. **The number is used.** Write the Compose file; run `docker compose up` in the runner's folder | outcome `started` or `start_failed` |

## The record of one listed secret (K13)

- **Supplied** (a record in the request whose sealed `name` is the listed name): it must pass
  `verifySecret` against the team list the runner holds now, for this team, server and app; a
  failure is `untrusted_secret`. Its statement's `version` and `hash` must equal the listing; else
  `secrets_mismatch`. A supplied record is used even when one is held.
- **Held** (none supplied): the file `records/<app>/<listed hash>.json`. Absent, unreadable, or a
  statement whose team, server, app, name, version or hash differs from the listing:
  `secret_missing`. Present and equal, it must pass `verifySecret` again now; a failure is
  `untrusted_secret` (a member since removed, FR-026).
- **Neither**: `secret_missing`.

A removal (`removed`) needs no record: the runner sets the entry's hash to `null`.

## What each check uses

| Uses | Checks |
|---|---|
| Nothing but the request | K1, K4, K6, K7 |
| The team list held (after K3) | K5, K8, K13 |
| The stored state's numbers | K9 |
| The runner's clock | K10 only (FR-016); the order never depends on it |
| The stored state's secret entries | K11, K12 |
| The record files | K13 (held), K15 (sizes) |
| The server's secret key | K16 |

## What a refusal leaves

A refusal at K1 to K16 uses no number and changes nothing but the team lists saved at K3: the bytes
of `state.json` (when K3 changed nothing), every file under `records/`, `apps/<app>/compose.yaml`,
and Docker (no call) are as before (FR-044, SC-001). A refusal is never written to disk. After K17
starts, the deploy finishes even if the input closes; its outcome is `started` when `up` exits 0,
else `start_failed`; both used the number.

## The next state (K17)

`nextState` is the stored state with: `lastSequence[app] = sequence`; for each `secrets` entry
`secrets["<app>/<NAME>"] = { version, hash }`; for each `removed` entry `{ version, hash: null }`;
`formats[app] = 2`; every other part as read after K3. `write` is the supplied records; `keep` is the
hashes of every live entry of the app in `nextState`. Files are written and synced before the
state that names them (FR-044), and deleted after.

## Not in this step

Part 6's two locks, the `up` time limit (decision 5), `domain_taken` (step 9), the one-off container
check (step 11), builds (steps 12, 16), the pre-deploy command (17), routes (18), the health check
(19), `not_allowed_here` (part 4.6). K7 refuses every deploy that would need them.

## The version-1 path on this runner (`apply`)

`apply`'s order is today's (part 2.2) with three changes: it reads the stored state and checks the
deploy with `verifyDeploy` against `versionOneView(state)`; after `verifyDeploy` passes, a deploy
of an app whose `formats[app]` is not 1 is refused `unsupported_version` (a new app has no entry,
and so is refused, FR-031); and it saves `afterVersionOneDeploy(state, nextState)` (contracts/
state.md, ST5). It stores no record (FR-024). `composeUp` runs in the runner's folder here too.
