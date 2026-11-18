# Security Review: Deploy version 2, the first step

Everything in [`specs/012-templates/security-review.md`](../012-templates/security-review.md),
[`specs/010-app-settings/security-review.md`](../010-app-settings/security-review.md) and the reviews
of features 003 to 006 still applies, except where part 5 below says otherwise.

This is not an external audit. One independent reviewer, who wrote none of this feature's code, read
the source and ran its own probes on 2026-11-18. Nothing was fixed as part of this review (T070:
record; T071 fixes). An external audit is still required before production use.

## 1. Scope and method

**Commit.** `204ecab` on `014-deploy-v2`. Base `e7b0146`: 16 commits, the code in `6973653`
(core), `c3ab520` and `6b4fbb4` (runner), `85c9d92` and `204ecab` (CLI); 74 files of
`packages/core`, `apps/runner` and `apps/cli/src` changed (10,416 lines added, 976 removed). The working tree held
another engineer's uncommitted changes under `apps/cli/src/ui/**`, `apps/cli/src/app/**` and their
tests; those were neither reviewed nor touched.

**Attackers considered.**

| Attacker | Can do |
|----------|--------|
| The hosted service (not built) | Carry, hold back, reorder and replay every message; answer for a runner. Holds no key. |
| A lying or compromised server | Answer anything to `version`, `status`, `records` and `deploy`. Already holds every value sealed for it. |
| An impostor at the SSH destination (T18) | The same as a lying server, for a server it is not: it cannot open what was sealed for the real one. |
| Another user on the server | Read and write what file modes let them. Cannot start the runner as its user. |
| A removed team member | Holds a key the current team list no longer has; may have deployed before removal. |
| Attacker B | Change files in the profile folder (`~/.zekno`), or any process of the person's user on the developer's machine. Cannot read the keychain. |
| Someone who can write the project folder | Owns `compose.yaml` and `zekno.app.json`. Holds no key. Nothing new of 014 reads the project folder. |

**Read in full**: `packages/core/src/deploy/message.ts`, `later-fields.ts`, `deploy-v2.ts`,
`listed-secrets.ts`, `state.ts`, `open.ts`; `secrets/statement.ts`, `for-deploy.ts`,
`secret-record.ts`, `secrets.ts`; `crypto/envelope.ts`; the new parts of `protocol/protocol.ts`,
`limits.ts`, `result.ts`; `apps/runner/src/commands/commands.ts`, `deploy.ts`, `records.ts`,
`home/home.ts`, `home/records.ts`, `session/session.ts`, `docker/compose.ts`, `main.ts`;
`apps/cli/src/ops/deploy.ts`, `deploy-send.ts`, `deploy-answer.ts`, `deploy-format.ts`,
`deploy-secrets.ts`, `secret-versions.ts`; `shared/history.ts`, `deploy-words.ts`; `cli/errors.ts`.

**Read as diffs, with the code around them**: `packages/core/src/deploy/deploy.ts` (version 1, only
moved), `crypto/hash.ts`, `deploy/link.ts`, `index.ts` (what is exported: `registerVerified` is not);
`apps/cli/src/ops/secret.ts`, `profile/profile.ts` (`held/`), `server/session.ts`, `shared/deploy.ts`,
`shared/views.ts`; `.github/workflows/pull-request-checks.yml`.

**Read because the new code leans on it**: `team/roster.ts` (roles, `isoTime`),
`protocol/version.ts`, `apps/cli/src/cli/context.ts` (`openTeam`), runner 0.1.0's `load` and state
schema (`git show runner-v0.1.0:...`), the CLI and runner test support (`wire.ts`, `deploys.ts`,
`helpers.ts`, `deploy-v2.ts`), and the test files named in part 4.

**Specs read**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, the five contracts,
`quickstart.md`, `tasks.md` (T070); `specs/010-app-settings/deploy-v2.md` parts 3, 3.1, 4.5, 4.7, 5
to 9, 11 to 13; `deploy-v2-review.md` parts 2, 7 and 8.

**Run** (Bun 1.4.4, macOS, stand-in Docker only):

- `packages/core`: `bun test`, 283 pass.
- `apps/runner`: `bun test`, 217 pass, 1 skip (`ZEKNO_REAL_BUILD`), including the pairing tests with
  runner 0.1.0 and the zekno of `e7b0146` taken from git, and `no-network.test.ts`.
- `apps/cli`: `test/ops`, `test/shared`, `test/server`, `test/profile`, `test/plain`, `test/cli` and
  every `test/scenarios` file except the two real-Docker ones: 565 pass. `test/ui` and `test/app`
  were not run (another engineer's).
- Five probes in the session's scratchpad (`014-review/p1` to `p5`), importing the repository's
  modules and test helpers by absolute path, with `TMPDIR` in the scratchpad, the in-memory key
  store, a local runner of this repository and the stand-in Docker:
  1. `p1-core-strict.ts`: odd keys and numbers in a signed version-2 payload, every pairing of kind
     and `v` through the four readers, twelve domains, and what can still be signed for a secret
     held at 2^53 - 1.
  2. `p2-held-floor.ts`: one number written into `held/`, then `secret set`, `deploy`, `secret set`,
     `secret rm`, and the same from a second machine (`twin`).
  3. `p3-folder-mode.ts`: a runner folder of mode 0777, then a `state.json` of mode 0666 changed by
     hand.
  4. `p4-records-wedge.ts`: four statements padded with JSON whitespace, sent with a member's
     deploy, then `zekno deploy`.
  5. `p5-history-race.ts`: two terminals of one machine, one waiting at its `records` request while
     the other deploys, then `zekno rollback`.
- Not used: a real server, `ssh`, the network, real Docker, the system keychain, `~/.zekno`,
  `apps/cli/.env.local`, the end-to-end tests under `apps/cli/tests/`.

## 2. Findings

| Id | Rating | Finding | Where | Confirmed |
|----|--------|---------|-------|-----------|
| S1 | Medium | A version nobody signed, from `held/` or a record that does not verify, becomes the next signed version; at 2^53 - 2 the secret is then frozen on the honest server for good: never set again, never removed, from any machine | `apps/cli/src/ops/secret-versions.ts:72-112`, `ops/deploy-send.ts:175-190`; `packages/core/src/deploy/listed-secrets.ts:89-104` | Yes, probe 2 |
| S2 | Low | Statements padded to 1 MiB pass every check and are kept; `records` then refuses its whole answer `too_large` for good, so zekno can never deploy the app again, also after that member is removed | `packages/core/src/deploy/listed-secrets.ts:118-149`; `apps/runner/src/commands/records.ts:56-67`; `apps/cli/src/ops/deploy-send.ts:297-301` | Yes, probe 4 |
| S3 | Low | The lock makes the runner's folder private before `load` checks it, so `sync`, `apply` and `deploy` act on a folder others could write; a `formats` changed there reopens version 1 for an app at version 2 (predates 014) | `apps/runner/src/home/home.ts:84-104`, `:222-223`; `commands/commands.ts:60-64`, `:170-177` | Yes, probe 3 |
| S4 | Low | Two terminals: the `sent` entry is written over the history as read before the session's requests, so an accepted deploy of the other terminal leaves the history and `zekno rollback` picks an older target (predates 014 in part) | `apps/cli/src/ops/deploy-send.ts:78-86`; `ops/deploy.ts:281`; `ops/deploy-answer.ts:46-60` | Yes, probe 5 |
| S5 | Low | A key written twice in a signed version-2 payload is read last-wins, so another JSON reader can see another deploy than the runner runs | `packages/core/src/crypto/envelope.ts:163-170`; `deploy/message.ts:92-116` | Yes, probe 1 |
| S6 | Note | Number spellings (`-0`, `1e0`) are taken inside signed version-2 bytes | `packages/core/src/deploy/message.ts:45-51` | Yes, probe 1 |
| S7 | Note | The A-label rule passes emoji labels and both `xn--fa-hia` (faß) and `fass`, one domain under transitional processing; for feature 015 | `packages/core/src/deploy/later-fields.ts:138-161` | Yes, probe 1 |
| S8 | Note | R3 (`… does not account for every secret …`) is said for every `secrets_mismatch` of version 2, also K13's version mismatch, K14 and K16, where it is not what happened | `apps/cli/src/cli/errors.ts:111-113` | Read |
| S9 | Note | An impostor at the SSH destination can make this zekno sign version-2 deploys with no expiry against any `previous` it names | `apps/cli/src/ops/deploy-send.ts:303-321` | Read |

Nothing is rated critical or high. No way was found to make a runner run a deploy no member signed,
to open a sealed value for another server, app or name, to run a deploy after one accepted after it
was made, to deliver a version-1 deploy to an app that has had a version-2 deploy (through the
runner's own code), to make a refusal use a number, or to get a decrypted value or a sealed value
into an answer, a log, the history or `held/`.

### S1. A remembered version freezes a secret on the server (Medium)

**Why medium**: no value leaks and nothing unsigned runs, but a property of the spec breaks for good
on the honest server: a secret that can never be set again cannot be rotated after a leak, and one
that can never be removed must be listed by every later deploy (FR-019), so the app keeps it as long
as the name exists. It takes one number in an unsigned file, then an ordinary `zekno secret set`.
Before 014 the next version came only from items that verify (`latestVersion`), so attacker B could
not do this. The plan and research R9 accept the risk as "only raises this machine's next version
for that name … until a later deploy reads an honest answer"; that is not what happens once the
raised version is signed and deployed.

**Where**: `floorVersion` (`apps/cli/src/ops/secret-versions.ts:97-112`) takes the highest of the
verified versions, `claimed` (`:72-89`: this machine's records that do not verify, and the
statements in `held/`, both read with `peekSecretStatement`, which checks no signature, team, server
or app) and `held/`'s `versions`. `heldOf` (`ops/deploy-send.ts:175-190`) keeps every statement of
the runner's `records` answer that merely has a statement's shape, and the versions of its `status`
answer. `HeldSchema` (`profile/profile.ts:119-136`) allows any version up to 2^53 - 1. On the
runner, K12 (`packages/core/src/deploy/listed-secrets.ts:89-104`) bounds how far a version may go
back, never how far it may jump, so a listed version of 2^53 - 1 is accepted, after which no higher
version exists (`secretVersion`), the same version with another hash is `stale_secret`, and leaving
the name out is `secrets_mismatch`. Version 1 bounds the runner's word for deploy numbers
(`MAX_AHEAD`, `ops/deploy-send.ts:60`); nothing bounds it for secret versions.

**Who**: attacker B or another process on the developer's machine (one edit of `held/` or of the
secret store), a lying or compromised server, or an impostor at the SSH destination (its `status`
versions and unsigned `records` statements land in `held/`). Later, the hosted service if it relays
`records` or `status`.

**Steps and result** (probe 2; `ready()`, local runner):

- `secret set API_KEY`, then two deploys: `held/<server>/web.json` holds `API_KEY` at version 1.
- The file's `versions` set to `[{"name":"API_KEY","version":9007199254740990,"removed":false}]`.
- `secret set API_KEY` (a rotation): exit 0, `Set API_KEY (version 9007199254740991) for web on
  dev.`; `deploy`: exit 0; the runner's state: `web/API_KEY` at version 9007199254740991.
- `secret set API_KEY` again, and `secret rm API_KEY`: each exit 1, `That could not be done
  (invalid_argument).` The next deploy still lists the frozen value.
- A second machine of the member (`twin`, no `held/`): `secret set API_KEY` signs version 1; its
  deploy stops with C5b ("dev holds a newer API_KEY for web than the one set on this machine. Set it
  again with zekno secret set API_KEY to replace it, …"); `secret set` and `secret rm` there then
  both fail with `invalid_argument`. Nothing a member can run changes the secret again.
- Probe 1, in the core library: with `API_KEY` held at 2^53 - 1, a new value at 2^53 - 1 is
  `stale_secret`, a removal at it is `stale_secret`, leaving it out is `secrets_mismatch`, and
  `createSecret` and `createSecretRemoval` refuse 2^53.

`secret rm` reaches the same end: a removal signed at 2^53 - 1 retires the name for good.

**Smallest fix**: in `floorVersion`, a version only an unverified source gives (`held/`, a record
here that does not verify) counts up to 1,000 above the highest version of the name that verifies
here (0 for none), the bound version 1 puts on the runner's deploy number; past it, `secret set` and
`secret rm` stop before signing with a sentence for the maintainer to approve, and store nothing. For
every client and the later relay, the runner can also refuse at K12 a listed version more than
`LIMITS.sequenceStep` above the version it holds for the name (0 for none). Tests that pass today and
must fail: `apps/cli/test/ops/secret-versions.test.ts`, `held/` with version 2^53 - 2, `secret set`
gives exit 0 and version 2^53 - 1 (after: a stop, nothing stored); probe 2's chain in
`apps/cli/test/scenarios/held.test.ts`; for the runner part, a first deploy listing a secret at
2^53 - 1 in `apps/runner/test/scenarios/deploy-v2-refusals.test.ts` (today: `started`).

### S2. Padded statements wedge `records` for good (Low)

**Why low**: it takes a team member, and every member may deploy (`DEPLOY_ROLES` holds both roles),
which is root on the server already. But the effect outlives the member: once the statements are
kept, every version-2 deploy and rollback by zekno stops before signing, with a sentence that points
nowhere (`too_large`), C4 is never reached after the member's removal, and no zekno command can
repair it; only editing `records/` on the server by hand.

**Where**: a statement's payload may be as large as any envelope's, 1 MiB
(`EnvelopeSchema`, `crypto/envelope.ts:32-39`); JSON whitespace keeps it a valid
`SecretStatementSchema` object, so `verifySecretStatement` and `verifySecret` pass and K13 takes the
supplied record (`deploy/listed-secrets.ts:118-149`). `records` (`apps/runner/src/commands/records.ts:56-67`)
refuses the whole answer when it passes 4 MiB. `deployVersionTwo` asks `records` first and ends on a
refusal (`apps/cli/src/ops/deploy-send.ts:297-301`), before `held/` is written, so `secret rm` here
does not know the padded names either. The same records can also fill the server's 64 MiB of record
files (K15), after which a deploy of any app that supplies a new record is `too_large`.

**Who**: a team member, from a client of their own; the victim is the rest of the team, after
that member's removal too.

**Steps and result** (probe 4): a member signs `PAD_A` to `PAD_D`, each statement padded to 1,365,664
characters of base64url; `verifySecret` is true for each. Their deploy, sent on a session with the
four records: `{"outcome":"started","app":"web","sequence":2}`. `records` for web then:
`{"outcome":"refused","reason":"too_large"}`. `zekno deploy`, twice: exit 1, `The deploy is larger
than the runner accepts, or the server already holds as many apps or secrets as a runner can.`

**Smallest fix**: hold a statement's payload to 4,096 characters (`HELD_PAYLOAD_LENGTH`, the bound
`held/` already uses; a real statement is under 1 KiB) where the runner takes a supplied record
(K13, refused, nothing kept), and have `records` leave out a kept statement over it instead of
refusing the answer, so the CLI reaches C5 and its offline fix. Tests that pass today and must fail:
in `apps/runner/test/scenarios/secrets-v2-bounds.test.ts`, a supplied record whose statement is
4,097 characters (today `started`, after: refused, `records/` unchanged); probe 4's state, where
`records` must answer and `zekno deploy` say C5 for each padded name.

### S3. The lock makes the folder private before it is checked (Low, predates 014)

**Why low**: the runner never makes its folder writable by others; it takes a folder set up by hand
with wider modes, or a shared `ZEKNO_RUNNER_HOME`. Using what another user planted then needs a way
to deliver deploys, or only denies. But the check that is meant to refuse such a folder runs only
for the reads, and the first write hides that the folder was ever open.

**Where**: `acquireLock` (`apps/runner/src/home/home.ts:222-223`) and `writeState` (`:185-187`) call
`ensureDir`, which `chmod`s an existing folder to 0700 (`:84-87`). `locked`
(`commands/commands.ts:170-177`) takes the lock before the work calls `load`, whose `isPrivate`
(`:60-64`; `home.ts:94-104`) then always passes for the folder's mode. `isPrivate` checks the folder
and `server.key` only: never `state.json`, `records/` or `apps/`. `status`, `records`, `state` and
`logs` call `load` with no lock first, so they refuse the same folder. 014 adds `records/` under
the same rule (`home/records.ts:98-101`); `removeUnnamed` follows a link at `records/<app>`.

**Who**: another user on the server, while the folder was writable by others.

**Steps and result** (probe 3; the runner's own tests' `world()`):

- Folder 0777: `status` and `records` give `invalid_state`; `sync` gives `ok`, `deploy` gives
  `started`; the folder is 0700 afterwards.
- Folder 0777 and `state.json` 0666, with `formats.web` set back to 1 after web's version-2 deploy:
  `apply` of a version-1 deploy of web gives `{"outcome":"started","app":"web","sequence":2}`; the
  folder is 0700 and `state.json` 0600 afterwards. The gate of FR-031 rests on a file the runner did
  not check.

**Smallest fix**: `locked` checks `isPrivate(dir)` before `acquireLock`; `ensureDir` sets the mode
only of a folder it creates; `isPrivate` also refuses a `state.json` not owned by this user or with
group or other bits. The test that passes today and must fail: probe 3 in
`apps/runner/test/scenarios/hardening.test.ts`, where `sync`, `apply` and `deploy` on a folder 0777
must give `invalid_state` and leave its mode as it was.

### S4. A second terminal writes the history over an accepted deploy (Low)

**Why low**: nothing unsigned runs; the entry lost is this machine's own record of a deploy. But the
history is what `zekno rollback` chooses from, and the spec has two terminals as an edge case.
Research R6 makes the answer and the refusal read the history again for this reason; the write of
the `sent` entry does not.

**Where**: `sendDeploy` reads the history right after `status` (`apps/cli/src/ops/deploy.ts:281`).
`recordSent` (`ops/deploy-send.ts:78-86`) writes that copy plus its entry after the `records`
request, the listing and the signing (which can wait on the keychain). `forget`
(`ops/deploy-answer.ts:46-60`) and `answered` (`deploy-send.ts:96-109`) read again, but each is a
read and a write with no lock. Version 1 wrote the same stale copy before 014.

**Who**: nobody; one person with two terminals.

**Steps and result** (probe 5): deploys 1 and 2 from terminal A. Terminal B's `records` request is
held. A deploys 3: `started`, the history `1, 2, 3`. B goes on: refused, `Another deploy of web
reached dev first, as deploy 3. …`; the history is `1, 2`, the runner at 3. `zekno rollback`:
`Rolling back web to what deploy 1 ran.`, where the deploy before the latest was 2.

**Smallest fix**: `recordSent` reads the history from the store right before it writes, as
`answered` does; better, every read-and-write of a history file takes a short lock. The test that
passes today and must fail: probe 5 in `apps/cli/test/scenarios/deploy-v2.test.ts`, expecting `3`
in the history after B's refusal and `Rolling back web to what deploy 2 ran.`

### S5. A key written twice is read last-wins (Low)

**Why low**: only a member can sign such bytes, and this zekno never writes them (`createDeployV2`
reads its own text back, `deploy-v2.ts:189-199`). The CLI and the runner both read with
`JSON.parse`, so they agree. But FR-004 asks that nothing be ignored, and the value written first is.
A later reader that keeps the first value (the hosted service's display, an approval step, an
auditor's tool) would show one Compose text while the runner runs another. The version-2 format is
fixed now, so the rule costs nothing to add now and a format change later.

**Where**: `parseJson` (`packages/core/src/crypto/envelope.ts:163-170`) for every signed payload;
`readDeployV2Format` (`deploy/message.ts:92-116`) gets the parsed value. Feature 010's settings
reader already refuses a key written twice.

**Steps and result** (probe 1): a member-signed version-2 payload with `"previous":5,"previous":0`:
`verifyDeployV2` gives `ok` (previous 0). A `__proto__` key at the top: `malformed`.

**Smallest fix**: read the bytes of a version-2 deploy (and of the statements it relies on, if the
maintainer agrees) with a reader that refuses a key written twice at any depth, before
`readDeployV2Format`; version 1 stays as it is (FR-003). The test that passes today and must fail:
in `packages/core/test/deploy/message.test.ts`, the payload above must be `malformed`.

### S6 to S9 (Notes)

- **S6.** `"previous":-0` and `"sequence":1e0` are read as 0 and 1 inside signed bytes (probe 1).
  Both sides read the same number; the CLI never writes them. The reader of S5's fix can refuse them
  too, so each payload has one spelling.
- **S7.** `isRoutableDomain` passes `xn--ls8h.la` (an emoji, valid under UTS 46, not IDNA 2008) and
  both `xn--fa-hia.de` and `fass.de`, which browsers keep apart (nontransitional) and IDNA 2003
  maps together. Routes are refused in this step (F7); feature 015 should decide before it carries
  them out.
- **S8.** `explainDeploy("secrets_mismatch", 2)` is R3, the completeness sentence, whatever check
  gave the reason: K11, but also K13 (a supplied record of another version), K14 (a record not
  listed) and K16 (a value that does not open). This zekno does not cause the last three; the
  sentence would mislead only for another client's deploy.
- **S9.** `previous` is `status`'s word with no bound (FR-010), and `expiresAt` is `null`. An impostor
  at the SSH destination (T18; the person must accept its host key) can collect deploys made against
  numbers it chooses, each runnable on the real server once its number reaches that value, if the
  impostor can also deliver it. Version 1 gave it deploys up to 1,001 ahead that run any time later
  while they are above the last; this is no wider. The design's rule that a `null` expiry never leaves
  its SSH session holds only while the destination is the server.

## 3. Checked and found sound

**The message and its readers** (`packages/core`)

| Property | Where | How checked |
|----------|-------|-------------|
| The kind is inside the signature; each reader opens only its own kind first | `envelope.ts:43-48`, `:143-160`; `deploy-v2.ts:214-218`, `:264-269` | Probe 1: every pairing of `zekno.deploy.v1`/`v2` and `v` 1, 2, 3, `"2"` through `verifyDeployV2`, `verifyDeploy`, `readSignedDeploy`, `readSignedDeployV2`: only v2 with `v: 2` reads as version 2; v1 kind with `v` not 1 is `unsupported_version` (verify) or `malformed` (read), as before; cross kinds `wrong_payload_type` |
| Strict schema, every field present, `__proto__` and unknown keys refused, `v` 2 only, `previous` to 2^53 - 2, `sequence` exactly one above, `expiresAt` in its one spelling | `message.ts:37-116` | Probe 1 (`__proto__`, `previous` 2^53 - 1, `…:00Z` without milliseconds: `malformed`); `packages/core/test/deploy/message.test.ts` |
| F7 comes after F4 to F6 and before K8: a later field is refused, never half read, never costs a number | `message.ts:125-144`; `deploy-v2.ts:274-277` | Read; runner `deploy-v2.test.ts` (each field alone, state and records unchanged) |
| The later fields' rules match F20 to F40 one by one, the build key from arrays, strings and `null` only | `later-fields.ts` | Read against contracts/message.md; well-formed text only goes in, so `JSON.stringify` gives one byte string |
| The CLI signs only what the runner's reader reads as itself; `later` is never passed | `deploy-v2.ts:189-200`; `deploy-send.ts:309-321` | Read; `grep` of `later` in `apps/cli/src` |
| Listed versions and hashes come only from statements and removals verified in `createDeployV2` itself | `deploy-v2.ts:134-154` | Read |
| `openSecrets` opens only an object a verifier registered; `registerVerified` is not exported | `open.ts:19-27`; `index.ts:86` | Read |
| App names cannot be `__proto__`; `constructor` (a valid app name) is looked up with `Object.hasOwn` wherever 014 reads `lastSequence` or `formats` | `deploy-v2.ts:300`, `state.ts:188`, `records.ts:45`, `deploy.ts:283`, `deploy-answer.ts:96` | Read; `grep` |

**The runner's checks** (`apps/runner/src/commands/deploy.ts`)

| Property | How checked |
|----------|-------------|
| K1 to K17 in the contract's order; nothing is decrypted before K16 and nothing written but the team lists (K3) before K17 | Read `deploy.ts:85-129`, `deploy-v2.ts:243-365`, `listed-secrets.ts`; runner `deploy-v2-refusals.test.ts` (each K with `leftAsItWas`) |
| The order: equality with the runner's number, one counter for both formats, the state saved before Docker is called; a replay or an alternative signed against an older number is `replayed` for good | Read `deploy-v2.ts:299-314`, `deploy.ts:124-128`; `packages/core/test/scenarios/order.test.ts` |
| A refusal never follows a used number: after `writeState`'s rename nothing in `deploy` throws (`removeUnnamed` and `startApp` catch everything), so the session's `invalid_state` comes only before it | Read `home.ts:123-146`, `records.ts:111-133`, `commands.ts:207-227` |
| A crash between the records and the state leaves only files no state names, deleted at the app's next version-2 deploy and never used as an older version (K12) | Read |
| V20 with one lock: nothing writes the state after the number is used; `sync` meets `busy` | Read `deploy.ts:126-128`, `commands.ts:189-200` |
| Expiry: one clock read, after the order check; `null` refused when `via` is the hosted service; past now or more than 7 days ahead refused; the order never reads a clock | Read `deploy-v2.ts:316-332`, `deploy.ts:105`; core `deploy-v2.test.ts` |
| K11 to K14: every live name listed; no version back, a removal counts as a version; a supplied record verified against the list held now and equal in version and hash; a held record equal in team, server, app, name, version and hash and verified again; an extra or doubled record refused | Read `listed-secrets.ts:58-195`; probe 1 (`stale_secret`, `secrets_mismatch`) |
| A sealed value cannot be used for another name, app or server: statement name equals sealed name, hash equals the ciphertext's, and the sealed plaintext names its server, app and name (K16) | Read `secret-record.ts:170-179`, `secrets.ts:156-165`; runner test K16 |
| Paths: `records/<app>/<hash>.json` only from an app name and a 64-hex hash, held to patterns; read with `O_NOFOLLOW`, at most 4 MiB; written 0600 with `wx` then rename | Read `home/records.ts:30-101` |
| K15: at most 8,192 entries, 8,192 live records and 64 MiB of record files after the change | Read `deploy.ts:50-78`; `secrets-v2-bounds.test.ts` |
| `records`: no lock, no write, statements only (never a sealed value), at most 256, refused rather than sent past 4 MiB; whoever can start the runner may ask (T17, accepted) | Read `records.ts`; `secrets-v2-bounds.test.ts`; probe 4 (but S2) |
| `deploy` and `records` exist only in a session; `main.ts`'s one-shot list is unchanged | Read `main.ts:20`, `session.ts:181-187` |
| No port, no connection, no code loaded another way: `apps/runner/src` and `packages/core/src` hold no `Bun.serve`, `Bun.listen`, `Bun.connect`, `fetch(`, `node:net`/`http`/`tls`/`child_process`/`vm`, `eval`, `new Function`, dynamic `import(`, `Worker`; `Bun.spawn` only for Docker; `node:url` only for `domainToASCII`/`domainToUnicode` | `grep`; `no-network.test.ts` passed |
| `composeUp` starts in the runner's folder on both paths (design part 13, D1) | Read `compose.ts:120-141` |

**The stored state and version 1** (`state.ts`, `commands.ts`)

| Property | How checked |
|----------|-------------|
| A marked state read strictly; `formats` keys equal `lastSequence` keys; a missing part or `v` other than 2 is `invalid_state`; an unmarked one migrated in memory only | Read `state.ts:103-139`; core `state.test.ts`; runner `versions.test.ts` (ST10) |
| Every write is whole with its mark: `setup` writes a marked state with no app at format 1; `sync` and K3 replace only `team`; `apply` writes `afterVersionOneDeploy` (V21) | Read `commands.ts:132-135`, `:85-96`, `:265`, `state.ts:170-181`; `versions.test.ts` (SC-007) |
| The version-1 gate after `verifyDeploy`, before any open or write; a new app and an app at format 2 are `unsupported_version`, a reason older CLIs read; no record is kept by version 1 | Read `commands.ts:257-276`; pairing tests with the zekno of `e7b0146` |
| No path gives a version-1 deploy to an app at format 2 through the runner's code: `sync` and `setup` carry no deploy, the gate reads the stored `formats`, and nothing lowers a format (but S3 for a file changed by hand, and T34 for a restored folder) | Read; probe 3 |
| Runner 0.1.0 put back fails closed: its strict schema refuses the mark; `setup` is `already_set_up` | `git show runner-v0.1.0:packages/core/src/deploy.ts` (strict `RunnerStateSchema`), `…:apps/runner/src/commands.ts:35-46`; pairing test |
| No function drops an app's number or format (V22, ST8) | Read |

**The CLI** (`apps/cli/src`)

| Property | How checked |
|----------|-------------|
| The format is chosen from `version` before `status` and before anything is signed: no sessions or protocol below 3 gives version 1, 3 gives version 2, above 3 stops with C7 | Read `deploy-format.ts:39-53`, `deploy.ts:269-277`; `deploy-format.test.ts` |
| A runner that lies about its protocol gains nothing over SSH: protocol 2 makes zekno send every sealed value, which that server can open anyway (an impostor cannot); a higher one only stops the deploy; a false number only gets `replayed` or `sequence_jump` | Read; `deploy-versions.test.ts`, `deploy-v2.test.ts` |
| `secretsForDeploy` takes versions and hashes only from items that verify against the current list; `status`'s word and an unverified item can only stop a deploy (C4, C5, C5b) | Read `for-deploy.ts:141-267`, `deploy-secrets.ts` |
| C4 on both formats (decision 8 a); a removed member's newest statement stops the deploy before signing | Read `for-deploy.ts:223-233`; `removed-member.test.ts` |
| `secret set` and `secret rm` never connect | Read `secret.ts:113-140`, `:305-336`; `secret-versions.test.ts` and `held.test.ts` with `connect` throwing (but S1 for the version they take) |
| `held/`: statements and versions only, file 0600 in a 0700 folder, path from a server id and an app name held to patterns, unreadable reads as empty | Read `profile.ts:119-136`, `:162-182`, `:208-231`; `test/profile/held.test.ts` |
| The history holds both kinds, each read by its own reader by kind; only answered entries are offered for rollback; a refused version-2 entry is removed by exact envelope | Read `history.ts:22-71`, `deploy.ts:209-252`, `deploy-answer.ts:46-60` (but S4) |
| C1, C2 and R1 are never wrong in the dangerous direction: each follows a refusal, which over SSH means this deploy did not run; C2 may be said too often (a version-1 `sent` entry that was refused, research R30), never too rarely in a way that hides a run | Read `deploy-answer.ts:86-127` |
| An envelope with no expiry goes only to the history and the `deploy` request of its own session; `--json` prints the report, not the envelope (FR-015) | `grep` of `envelope` and `json(` in `apps/cli/src` |
| No decrypted value or private key in a new line, warning, error, answer, history entry or `held/`: warnings carry kinds, names and reason codes; `RunnerRefused` carries a reason of a closed list; the runner's errors are reasons | Read; `held.test.ts` searches `held/` for each value |

**What does not change** (plan.md): `git diff e7b0146` of `runner-release.json`, `apps/runner/package.json`,
`apps/cli/tests`, `e2e.config.ts`, `plain-at-head.ts`, `plain-unchanged.test.ts`, the install and
check scripts and `packages/core/src/team` prints nothing; `.github` gains only `fetch-depth: 0` and
its comment; no existing file of `packages/core/test` is modified; none of the schemas the plan lists
is touched in `protocol.ts`; `DEPLOY_REFUSALS` and `HistorySchema` are unchanged; `main.ts` gains one
comment.

**The design review's findings for this step**

| Id | In the code |
|----|-------------|
| V1 | Closed: `previous` equal to the runner's number, `sequence` one above, no `MAX_AHEAD` on version 2 |
| V2 | Closed for this step: version 1 only for apps at format 1; every team list is version 1 by construction (`parseRoster`), so the team-list half needs no code yet (research R3) |
| V5 | Closed: K11 on the runner, C5 before signing |
| V7 | Closed: every field of a held statement compared, records stored per app |
| V8, V24 | Closed: the build key's bytes defined and checked at F6; `builds[].secrets` sorted and unique; the warning for a removed member's record replaced by C4 |
| V14 | Closed as written (S7 for feature 015) |
| V19 | As decided (7 b): over SSH a new deploy is signed; `null` expiry stays in the session (S9) |
| V20 | Closed: one lock, no state write after the number is used |
| V21 | Closed: `afterVersionOneDeploy`, SC-007 |
| V22 | Closed: nothing removes an app |
| Part 13 | `composeUp`'s folder set; `MAX_AHEAD` left on version 1 (decision 4 b) |
| V3, V4, V6, V9 to V13, V23 | Later features; their fields are refused by F7 |

## 4. Tests that are missing

For properties that hold:

- A runner folder others could write, for the locked commands (S3, probe 3).
- `records` while a `deploy` of the same app replaces and deletes record files (no lock; a reader
  can miss a file it was told of, which only makes the CLI stop with C5).
- An app named `constructor` end to end (deploy, `records`, `status`, rollback).
- A version-2 payload with `"previous":-0`, `1e0` or a key written twice (S5, S6).
- A `records` answer holding a statement for another app or team, and one with a signature that does
  not verify: the CLI leaves both out of the listing (today only by reading `for-deploy.ts:175-191`).
- A deploy whose `writeRecord` fails part way (folder read-only): no number used, files left are
  never used.

For the findings, once fixed: S1's `held/` at 2^53 - 2 and a remembered statement at it, for `set` and
`rm`; S2's padded statements; S3's folder; S4's two terminals; S5's doubled key.

## 5. Carried over from earlier reviews

- Review 003, C1 (trust rebuilt from the signed lists): still true; `former` and C4 read the
  verified chain (`deploy-secrets.ts:44-51`).
- Review 003, R4 (durable writes): the runner writes records and state with `fsync` and a synced
  folder; the CLI's `held/` and history writes are renamed unsynced, as every profile write.
- Review 004, S4 (`state` and `logs` answer whoever can start the runner): `records` joins them (T17).
- Review 006, S3 (a name typed as new that the server holds): now refused by the runner too
  (`previous` 0 is `replayed`), besides `AppTaken`.
- Review 012, T9 (no lock on the profile's store): the history has the same race (S4).

## 6. Not reviewed

- `apps/cli/src/ui/**`, `apps/cli/src/app/**` and their tests: in another engineer's hands, being
  changed; how C6, C7, C8 and the R-lines are drawn was not read or run.
- `asking/first-deploy.ts` and the app's `d` and `r` paths, beyond the fact that they call
  `sendDeploy`.
- The docs and READMEs (M1, M2, `deploying.mdx`, `secrets.mdx`, `runner.mdx`, `servers.mdx`):
  read only where a finding cites them.
- Real Docker, Linux, the compiled binaries, a real server, and the hosted-service path
  (`via: "hosted service"` exists only in the core library's tests).
- The pairing tests were run, not read line by line; runner 0.1.0's code was read only for how it
  reads its state.

## 7. For the maintainer

Nothing critical or high is open. One medium is: S1, where one number in `held/` (or a lying server's
answer) lets an ordinary `zekno secret set` freeze a secret on the honest server so it can never be
rotated or removed; the plan accepted this as temporary and local, and the probe shows it is neither.
I would not merge without S1's CLI bound (a few lines in `floorVersion` and a sentence to approve),
and I would add the runner's bound at K12 with it so no later client or relay can do the same. S2 is
cheap to close at the same time and removes the one wedge zekno cannot repair. S3 to S5 can be
answered in writing; S3 and S4 predate this feature.
