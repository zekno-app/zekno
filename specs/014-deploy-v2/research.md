# Research: Deploy version 2, the first step

Checked on 2026-11-18 on macOS with Bun 1.4.4, against the repository at `c9002b5` on
`014-deploy-v2` (its code is `dev`'s at `e7b0146`; the three commits since are documents). What
the maintainer decided (spec.md, "Decided with the maintainer") is binding and marked
**(maintainer)**. Every statement about today names its file and function. One probe ran in the
session's scratchpad: `node:url`'s `domainToUnicode` and `domainToASCII` on twelve labels (R10).
Nothing else was run; no server, no network, no file of the repository but these documents.

## R1. Where version 2 lives in the core library, and the files that must be split first

- **Fact.** `packages/core/src/deploy/deploy.ts` is 576 lines: `DeploySchema`, `RunnerState`,
  `RunnerStateSchema`, `initialRunnerState`, `parseRunnerState`, `readState`, the `verified`
  WeakMap, `createDeploy`, `readSignedDeploy`, `verifyDeploy`, `openSecrets`.
  `secrets/secret-record.ts` is 450 lines with the private `SecretStatementSchema`.
- **Decision.** Before anything is added, move the state (`RunnerState` to `readState`) into a new
  `deploy/state.ts` and the registry with `openSecrets` into `deploy/open.ts`, behaviour unchanged
  (T001); move `SecretStatementSchema` into `secrets/statement.ts` (T002). Version 2 then goes into
  new files: `later-fields.ts`, `message.ts`, `deploy-v2.ts`, `secrets/for-deploy.ts`.
- **Rationale.** No file over 500 lines; `openSecrets` must open both kinds, so its registry must
  be reachable from both verifiers.
- **Alternatives.** One `deploy-v2.ts` with everything: about 700 lines. Exporting the WeakMap:
  any caller could then register a deploy and open its secrets.

## R2. How the runner's state is stored today, and the mark

- **Fact.** `writeState` (`apps/runner/src/home/home.ts`) writes `state.json` with `writeAtomic`
  (exclusive temporary file, `fsync`, `rename`, folder synced). `load`
  (`apps/runner/src/commands/commands.ts`) reads it with `parseRunnerState`, a strict schema, and
  answers `invalid_state` for anything it cannot read. Runner 0.1.0's schema is strict too
  (`git show runner-v0.1.0:packages/core/src/deploy.ts`, `RunnerStateSchema = z.strictObject`).
- **Decision.** The mark is a top-level `"v": 2`, and each app's format is `"formats": { app: 1 | 2 }`
  (contracts/state.md). A state without `v` is a version-1 state: read strictly by today's schema
  and migrated in memory, every app with a number of 1 or more marked 1. A read that writes nothing
  (`status`, `state`, `logs`, `records`) changes nothing on disk; every write (`setup`, `sync`,
  `apply`, `deploy`) writes the whole stored state with its mark. A marked state is read strictly:
  a missing part, an extra field, `v` other than 2, or an app in `lastSequence` without a format
  (or the reverse) is `invalid_state`.
- **Rationale.** Any new top-level field makes runner 0.1.0's strict read fail, so an older runner
  fails closed by construction (FR-034). A number lets a later runner that adds parts (routes, kept
  builds) tell a state written before them; no release ships this mark, so 015 may still change it.
- **Alternatives.** A second file beside `state.json`: an older runner would read the old file and
  act on it. The design's name `formats` is kept.

## R3. The version-1 path on a version-2 runner (FR-031, V21)

- **Fact.** `apply` parses with `RunnerApplyRequestSchema`, takes the lock, follows the team lists,
  runs `verifyDeploy`, `withinLimits`, `openSecrets`, then `writeState(nextState)`. The app is known
  only from inside the verified payload.
- **Decision.** `apply` checks the deploy with `verifyDeploy` against the version-1 view of the
  stored state, then refuses `unsupported_version` unless `formats[app]` is 1, then goes on as
  today, and saves `afterVersionOneDeploy(stored, nextState)`: the stored state with only
  `lastSequence` and `secrets` replaced. The team list's half of FR-031 holds by construction: every
  team list is format 1 (`parseRoster` refuses any other `v`), so no check is written until a
  second format exists (part 4.6, with CI).
- **Rationale.** The gate needs the app; checking it after the signature and the payload costs
  nothing, refuses before any write, and keeps `verifyDeploy` unchanged (FR-003).
- **Alternatives.** Reading the app from the payload before the signature: trusting unsigned bytes
  for a decision. A `teamListFormat()` returning 1: code with nothing to decide.

## R4. How the CLI learns the protocol, and where the format is chosen (FR-029)

- **Fact.** `openSession` (`apps/cli/src/server/session.ts`) asks `version` first on the deploy's
  own connection and keeps the answer as `session.runner` (undefined for a runner from before
  sessions, `mode: "one-shot"`). `sendDeploy` (`ops/deploy.ts`) runs inside `withSession`.
- **Decision.** `chooseFormat` (new `ops/deploy-format.ts`) runs first inside the session, before
  `status`: no sessions or protocol below 3 gives version 1; protocol 3 gives version 2; above 3
  stops with C7 (decision 2, (a)). This CLI uses no later field, so "the runner carries out every
  field the deploy uses" is protocol 3 exactly. `RUNNER_PROTOCOL` becomes 3 in T025, once the
  runner answers `deploy`, while the CLI still signs version 1; the CLI signs version 2 from T032.
  So the tree is green between tasks.
- **Rationale.** The choice needs nothing but the version answer, and must come before signing.
- **Alternatives.** Asking a separate connection first: a second SSH login.

## R5. The `records` read and the `deploy` request in the session protocol

- **Fact.** `SESSION_COMMANDS` is a closed list in `SessionRequestSchema`; `SESSION_FRAME_BYTES`
  bounds each answer line on the CLI (`lineReader` in `server/session.ts`); a runner from before
  feature 014 answers an unknown command `invalid_request` before running anything.
- **Decision.** Both are session commands only; `main.ts`'s one-shot `COMMANDS` do not change. The
  `records` answer is the statements only (envelopes of `zekno.secret.v1`), never a sealed value,
  at most 256, sorted by name (contracts/protocol.md). Frame bounds: `deploy` 64 KiB (as `apply`),
  `records` 8 MiB (the design's; a real answer is under 256 KiB). `records` takes no lock, as
  `status`.
- **Rationale.** FR-022 and FR-023: a statement carries name, version, hash and signer; the value,
  even sealed, need not pass through the CLI. Every protocol-3 runner speaks sessions.
- **Alternatives.** Returning whole records: sealed values travel to every deployer for nothing.

## R6. `previous` replaces the CLI's counter; the history

- **Fact.** `sendDeploy` signs `max(runner's number, highest this machine signed) + 1` and refuses a
  runner more than `MAX_AHEAD` (1,000) ahead; the history (`HistorySchema`, `profile.ts`) holds up to
  50 `{ envelope, at, outcome }` with outcome `sent`, `started` or `start_failed`, saved `sent`
  before sending; `views.ts` keeps the later of two entries with one number.
- **Decision.** Version 2: `previous` is the runner's `lastSequence[app]` from `status` on the same
  connection (0 if absent), `sequence = previous + 1`, no counter, no bound (FR-010). Version 1:
  unchanged, counting entries of both kinds for "highest this machine signed". The history file
  keeps its schema; it holds envelopes of both kinds, each read with its own verifier
  (`readDeployEntry`, new `shared/history.ts`, R32). When the runner refuses a version-2 deploy,
  the history is read again from the store (another terminal may have written since) and its
  `sent` entry, found by its envelope, is taken out: it used no number and will never run. An
  entry whose answer never came stays `sent`. A zekno from before this feature skips version-2
  entries with its own warning (`Ignored <n> entries in the deploy history that could not be
  verified.`), a line in a release already out (lines.md, O).
- **Rationale.** A refused entry left `sent` would make C2 say an answer never came when it did.
  Adding an outcome would make the older zekno call the whole file damaged.
- **Alternatives.** A new outcome `refused`: breaks older zekno's strict `HistorySchema`.

## R7. Secrets by version in a deploy

- **Fact.** `currentSecrets` (`secrets/secret-record.ts`) verifies records and removals, keeps the
  highest version per name, drops a conflict, and reports what it left out (no name for a record it
  could not read, V24). `sendDeploy` passes its records to `createDeploy` and warns
  `Left out a <kind>[ for <name>]: <reason>.` for each ignored item.
- **Decision.** One core function, `secretsForDeploy` (new `secrets/for-deploy.ts`), for both
  formats (contracts/cli.md, "What a deploy lists"): verified candidates are this machine's records
  and removals and, for version 2, the runner's statements; the highest per name is chosen as
  `currentSecrets` chooses it; for version 2 an own record is supplied only when no statement the
  runner holds has its hash; a name blocks for C4 or (version 2) C5 as R8 says; every other item
  left out keeps today's warning. With no runner statements its version-1 result equals
  `currentSecrets`'s (a test checks it on every fixture). `createDeployV2` takes statements and
  removals, not versions, and verifies each itself, so FR-021 is enforced by the library.
  **The first version-2 deploy of an app with version-1 secrets** (FR-024): those live names have
  no statement on the runner, so this machine's own records are chosen and supplied; a machine
  without them gets C5, then `zekno secret set` or `rm` fixes it offline (R9). C5b (R8) is worked
  out in the CLI from `secretsForDeploy`'s `statements` and this machine's own items, so the core
  function is as T016 and T017 write it.
- **Rationale.** Today's behaviour for one developer is the version-1 result, unchanged; the new
  rules are additions, each with its reason.
- **Alternatives.** Writing the listing in the CLI: a later CI client would have to copy it.

## R8. C4 and C5: which secret stops a deploy, and why

- **Decision.** For each name, `chosen` is the highest verified candidate. **C4** (both formats,
  decisions 8 (a)): an item for the name, this machine's or the runner's, fails `unknown_signer`,
  its key id belongs to a member of an earlier team list in this machine's verified chain
  (`team.chain`) and not of the current one, and its version is at least `chosen`'s (or there is no
  `chosen`). **C5** (version 2 only): `status` says the name is live, not C4, and there is no
  `chosen`, or `chosen` is lower than the version `status` reports. Name, version and key id of an
  item that does not verify are read without trusting it (`peekSecretStatement`); a name is held to
  `SECRET_NAME`, so it prints safely. Several blocked names: one line per name in name order (its
  C4 or C5 sentence without `Nothing was signed.`), then `Nothing was signed.` once at the end of
  the last line, as lines.md's C4 says ("One line per secret, then the last sentence once").
- **C5b** (version 2 only; sentence approved on 2026-11-18; decision B). After
  `secretsForDeploy`, in `ops/deploy-secrets.ts`: for each listed statement that is the runner's
  (its envelope is not one of this machine's records), take this machine's highest verified item
  for the name (`verifySecret`, `verifySecretRemoval`); when that item is a record, its version is
  lower than the listed statement's, and its hash differs, the name is blocked with C5b. A removal
  never trips it (this machine has no value to lose), nor does a name with no item here (a lost
  copy, US2 scenario 5), nor the ordinary case (this machine set versions 1 and 2 and the server
  holds 2: the listed statement is this machine's own, or the same statement). Two items at one
  version are already a conflict (CL12) and end in C5 when the server holds the name.
- **Rationale.** A removed member's statement that is the newest is the case decision 8 is about;
  an older one is harmless and keeps today's warning. `status`'s word can only stop a deploy, never
  choose what is signed.
- **Alternatives.** Any `unknown_signer` as C4: a key that was never a member would be called
  "someone who is no longer in the team".

## R9. `zekno secret set` and `rm` never connect **(maintainer: decision B, 2026-11-18, replacing 6 (a))**

- **Fact.** `setSecret` and `removeSecret` (`ops/secret.ts`) take the version from this machine's
  verified records and removals (`latestVersion`) and never connect; `plain-unchanged.test.ts`
  freezes that for `secret set GREETING`, `OTHER`, `MULTI` and `secret rm NEVER`. The profile's files
  are written by `profileStore`'s `write` (a new file under a name nobody can predict, mode 0600,
  folder 0700, then a rename) and read strictly by its `read`.
- **Decision: what this machine remembers of the server.** A new profile file,
  `held/<serverId>/<app>.json` (`profile/profile.ts`, `profileStore().held` and `saveHeld`),
  `{ statements: Envelope[], versions: { name, version, removed }[] }`: the statements of the
  runner's `records` answer and the app's entries of its `status` answer, both read on the same
  connection by a version-2 deploy (CL3, CL3b). Written by `write`, like every profile file, and
  replaced whole at each such read, so it never grows or goes stale in pieces; written even when
  the deploy then stops (C4, C5, C5b), since that is when it is needed. Kept: at most 256
  statements, each one `peekSecretStatement` reads and whose `payload` is at most 4,096 characters
  (a real statement is under 1 KiB); at most 8,192 versions (`LIMITS.secretsPerServer`), names held
  to `SECRET_NAME`. No value and no sealed value is ever in it. A file that is missing, unreadable
  or does not match its schema reads as empty: it is only a floor, and the next version-2 deploy
  writes it again. Version-1 deploys read no statements and leave it as it is.
- **Decision: the version.** `zekno secret set NAME` and `zekno secret rm NAME` take the next
  version as one above the highest of: this machine's records and removals of the name that verify
  (today's rule); this machine's records of the name that do not verify, read with
  `peekSecretStatement` (without this, a removed member's record on this machine would make C4
  say itself again after `secret set`); the remembered statements of the name, read with
  `peekSecretStatement`; the remembered version of the name. These are floors only: a remembered
  statement never gives a hash and never decides what a deploy lists, which still comes only from
  statements verified at deploy time (FR-021).
- **Decision: `rm`.** It signs the removal when this machine holds a current secret of the name
  (today), or holds a record of it that does not verify, or remembers it from the server (a
  statement, or a version that is not removed), and says S1. With none of these, today's
  `<A> on <S> has no secret named <NAME>.` Nothing connects in any case; the frozen scenes stay as
  they are (a scene's profile holds no `held/` file).
- **The chain (FR-028).** A deploy that finds a secret this machine cannot account for stops before
  signing with C4, C5 or C5b, after it has written `held/`. `zekno secret set NAME` then signs a
  version above what the server holds, offline, and the next deploy lists and supplies it;
  `zekno secret rm NAME` signs a removal above it, and the next deploy lists the removal. This holds
  for a secret only the server holds, for one a removed member set (from this machine or another),
  and for a version-1 secret with no statement (its version comes from `status`).
- **Known and accepted** (for the review): a lying runner, or attacker B editing `held/`, can report
  any version, which only raises this machine's next version for that name. `secretVersion` allows
  1 to `Number.MAX_SAFE_INTEGER` (2^53 - 1); at that floor `createSecret` and
  `createSecretRemoval` refuse (`invalid_argument`), the CLI says today's
  `That could not be done (invalid_argument).` and stores nothing, and the name cannot be set or
  removed from this machine until a later version-2 deploy replaces `held/` with an honest answer.
  Denial only, from the server SSH checked, which already holds every value. The same floor risk
  as `status`'s version. `secret import` and `zekno add` keep today's rule (decision B names set
  and rm).
- **Alternatives.** Reading the server in set and rm (6 (a)): changes the frozen scenes and makes a
  new name need SSH. Taking a hash from the memory: would let a runner choose what is signed.

## R10. The later fields without a new package (FR-002, FR-036, FR-046)

- **Decision.** zod schemas and regular expressions for every rule of part 5 (contracts/message.md).
  The A-label rule: each `xn--` label must give a non-empty `domainToUnicode(label)` and
  `domainToASCII(domainToUnicode(label)) === label` (`node:url`). Probe on Bun 1.4.4:
  `xn--bcher-kva`, `xn--d1acpjx3f.xn--p1ai`, `xn--55qx5d` round-trip; `xn--zz`, `xn--a`,
  `xn--ab`, `xn--abc-` give `""`; `xn--Bcher-kva` does not round-trip (upper case is refused before,
  by the lowercase rule). The build key is `hash("zekno/v1/build", utf8(JSON.stringify([...])))` of
  part 4.1 (b). Where part 5 is silent, nothing is added: `builds[]` has no order rule; the
  pre-deploy command's 16 KiB is the UTF-8 bytes of its words; a `pack.chunks` entry may repeat
  within one build (the 64 distinct chunks per deploy are counted across builds).
- **Rationale.** Bun implements `node:url`; no package is needed, so FR-046 asks nothing of the
  maintainer.
- **Alternatives.** A hand-written RFC 3492 decoder (about 60 lines), kept as the fallback.

## R11. Expiry and the 7-day window **(maintainer: decision 3 (a))**

- **Decision.** `verifyDeployV2` takes `now` (the runner passes its clock) and `via`
  (`"session"`, or `"hosted service"` for the later client and the tests). After K9's order check:
  `expiresAt` not null and not later than `now` is `expired`; more than 7 days after `now`
  (`LIMITS.expiryWindowMs`) is `expired`; null with `via: "hosted service"` is `expired`.
  `expiresAt` must be exactly `new Date(expiresAt).toISOString()` (one spelling per time), else
  `malformed`. This CLI signs `null` (FR-015).
- **Rationale.** The design's order (part 6, step 8); one comparison against the runner's clock;
  the window keeps a long CI setting from holding T5 and T31 open (Q7). The spec's "No security
  decision depends on time" is replaced by "the order never depends on time".

## R12. One lock and no time limit **(maintainer: decision 5 (b))**

- **Decision.** `deploy` takes the deploy lock through `locked`, as `apply` does; `records` takes
  none. Nothing writes the state after the number is used (records are written before the state,
  and no build or route bookkeeping exists yet), so V20 holds without a second lock. A `sync`
  during a deploy is `busy`, as today. `up` has no time limit.

## R13. Record files

- **Decision.** `records/<app>/<hash>.json` (hash from the signed listing, app from the payload,
  both held to patterns), the record `{ envelope, sealed }` as JSON, mode 0600 in 0700 folders,
  written with `writeAtomic`. Order at a version-2 deploy: write the supplied records, save the
  state, then delete every file of `records/<app>/` whose hash no live entry of the app names
  (which also clears what a crash left). Held records are read by a function the runner gives
  `verifyDeployV2`. Bounds after the change: live records at most 8,192
  (`LIMITS.secretsPerServer`) and their bytes at most 64 MiB (`LIMITS.recordBytesPerServer`),
  counted over files named by the next state (kept files by `statSync`, new ones by length), else
  `too_large`.
- **Rationale.** Part 4.5: a file before the state that names it, so a version-2 app never names a
  missing file; named by app and hash, never by secret name (letter case).

## R14. `composeUp`'s working folder, and the bound of 1,000 **(maintainer: decision 4 (b))**

- **Decision.** `composeUp` takes `dir` and passes `cwd: dir` to both `Bun.spawn` calls, as
  `dockerOutput` and `followLogs` do; one function, so both paths get it. `MAX_AHEAD` stays as it
  is on the version-1 path.

## R15. Refusal reasons and their sentences **(maintainer: decision 9 (b))**

- **Decision.** `DEPLOY_V2_REFUSALS = ["secret_missing", "untrusted_secret", "expired"]`; the later
  features' reasons join with them. `RunnerReportSchema` accepts them; `DEPLOY_REFUSALS` and
  `StatusReportSchema` do not change. `explainDeploy(reason, format)` (`cli/errors.ts`): R1 to R3
  for a version-2 deploy, today's sentences for version 1; R4 to R8 for any deploy; `REASONS` for
  the rest; the general sentence otherwise. `RunnerRefused` keeps its `reason` and takes the
  sentence. SC-011's test covers every reason a `deploy` check can give: the 15 of
  `DEPLOY_REFUSALS`, the 3 new and the 5 of `RUNNER_REFUSALS`. The four team-list reasons a `deploy`
  can also return while following team lists (`not_admin`, `wrong_version`, `wrong_previous`,
  `invalid_members`) keep the general sentence, as for `apply` and `sync` today: lines.md approves
  none for them.

## R16. Where each line is produced

| Line | Produced in | Said through |
|---|---|---|
| R1 to R8 | `cli/errors.ts`, `explainDeploy` | `RunnerRefused` from `ops/deploy-answer.ts` (v2) or `ops/deploy.ts` (v1) |
| C1, C2 | `shared/deploy-words.ts`; chosen in `ops/deploy-answer.ts` | `CliError` after `sent` |
| C4, C5, C5b | `shared/deploy-words.ts`; chosen in `ops/deploy-secrets.ts` (C5b from `secretsForDeploy`'s result) | `CliError` before `checked`, after `held/` is written |
| C6 | `shared/deploy-words.ts`; condition in `ops/deploy-format.ts` | `callbacks.warning`, right after signing |
| C7 | `shared/deploy-words.ts`; `chooseFormat` | `CliError` before `status` |
| C8 | `ui/parts/deploy-summary.tsx`, `numberUsed` | the app's `Outcome`; the terminal's failed block |
| S1 to S3 | unchanged words (`commands/secret.ts`, `ops/secret.ts`); S2's case and S3's version from R9 | |
| M1, M2 | `README.md`, `apps/web/content/docs/security.mdx` | |

A warning said during a deploy is drawn above the deploy's block at a terminal, because the block
becomes a line of its own only when the deploy ends (`liveDeploy`, `end`); that is why C6, said
after signing, is drawn above the panel as the board shows.

## R17. A stop before signing, at a terminal ("Known before building")

- **Fact.** `liveDeploy` draws nothing before the first `stage` (SSH may be asking on the
  terminal), and `end({ outcome: "error" })` with nothing drawn draws nothing: today a stop before
  Checked (the 1,000 bound, `AppTaken`) is the sentence alone. The app dispatches `deploy-started`
  before `sendDeploy`, so its screen shows the panel and `✖ Checked ○ Signed ○ Sent ○ Starting`.
- **Decision.** Follow today: C4, C5, C5b and C7 are the sentence alone at a terminal and in plain
  output; the app shows the panel as the boards draw it.

## R18. C6 when this zekno carries the same version as the runner

- **Fact.** No release (decision 1): `runner-release.json` stays 0.1.0, so a zekno built from this
  branch carries 0.1.0, and against runner 0.1.0 C6 would read "version 0.1.0, older than this
  zekno's 0.1.0", and `zekno server update` would leave it as it is.
- **Decision.** C6 is said when the deploy is signed version 1 because the runner's protocol is
  below 3 and the runner reports a version older than the one this zekno carries
  (`compareRunnerVersions < 0`). Otherwise version 1 is signed as today, silently. From 015, which
  carries 0.1.1, every protocol-2 runner is older. Tests carry `0.1.1` (`deps.release`).
- **Alternatives.** Saying C6 whenever version 1 is signed: a false sentence, and a command that
  does nothing.

## R19. C8 after a version-2 deploy that ended in error

- **Decision.** `numberUsed` is false for a version-2 deploy whose outcome is `error`, refused or
  without an answer: on version 2 the next number is the runner's, so "the next deploy will be
  <N+1>" cannot be said. Kept for `start_failed` and for version 1.

## R20. The summary's secret names

- **Decision.** The stage info of Checked carries the names the deploy lists (`secretNames`); the
  app's `deploy-stage` puts them in the panel. The single commands keep the count only, as today:
  their panel has never shown names (`liveDeploy`), and lines.md changes no panel row.

## R21. Stored docs screens and end-to-end tests

- **Fact.** Every recipe of `apps/cli/test/screens/` draws with the real runner of this
  repository (`scene/server.ts`), which answers protocol 3, so from T032 on they sign version 2; no
  recipe shows a refusal, an older runner, or the app's deploy screen after a refusal. The
  end-to-end tests (`apps/cli/tests/`) use a runner on this machine and assert `lastSequence`,
  `secrets` versions, Docker's `up` calls and where a value appears: none of these changes (records
  are sealed; `status` keeps its shape).
- **Decision.** No stored screen and no end-to-end test is expected to change; `bun run screens
  --check` is run in T035, T056 and T074, and a screen it names is redrawn with `bun run screens`. The
  end-to-end tests are neither edited nor run; nothing for "Needs the maintainer".

## R22. The older programs, from git

- **Decision.** `apps/runner/test/support/older-programs.ts` extracts `packages/core`,
  `apps/runner` and `apps/cli` at a fixed ref with `git archive` into a temporary folder, links
  every entry of the repository's `node_modules` folders (root, `apps/cli`, `apps/runner`,
  `packages/core`) into the same places there except `@workspace`, and points
  `node_modules/@workspace/core` at the copy's own `packages/core`. Refs: `runner-v0.1.0` (runner
  0.1.0, protocol 2, as every server runs) and `e7b0146d33a4683aace174f2e0c3d1e4ee1e3b19` (the zekno
  from before this feature). The older runner runs as a process (`bun <copy>/apps/runner/src/main.ts`);
  the older zekno runs in the test's process through the copy's `run` (`apps/cli/src/cli/cli.ts`),
  with the copy's `plainUi`, `connect` and `memoryKeyStore`, never the keychain. When
  `git cat-file -e <ref>^{commit}` fails, the pairing tests skip with
  `Skipping the pairing tests: <ref> is not in this clone's history.` The pull-request check
  fetches the whole history (`fetch-depth: 0`, N2, decided yes), so they run on GitHub too.
- **Alternatives.** A runner 0.1.0 rebuilt from today's version-1 functions: it would prove
  today's code, not the release's. Release binaries: need the network.

## R23. Existing tests that change, and why

- **Decision.** (a) Protocol literals that mean "this zekno's protocol" become `RUNNER_PROTOCOL`
  or `RUNNER_PROTOCOL ± 1`: `apps/cli/test/ops/doctor.test.ts` (cases with `2` and `3`),
  `test/support/stand-in-server.ts` (`fakeRunner`, `releasedRunner`),
  `apps/runner/test/compiled/compiled.test.ts`; literals that mean runner 0.1.0 stay 2.
  (b) Readers of the history with `readSignedDeploy` read with `readDeployEntry`:
  `test/scenarios/add-settings.test.ts`, `settings-compose.test.ts`, `settings-deploy.test.ts`,
  `settings-which-file.test.ts`. (c) Cases whose subject is version 1 run against a runner that
  answers protocol 2 on a state from before version 2 (`olderState`):
  `test/scenarios/hardening.test.ts` ("The runner's memory goes back", now signed `previous` 1 on
  version 2, and its version-1 twin). (d) Runner tests that `apply` to a new app move onto
  `deploy`, or onto `olderState` when their subject is `apply` (T050). (e) `secret set` and `rm`
  never connect (R9), so `apps/cli/test/plain/plain-unchanged.test.ts`, the first-deploy tests and
  the app's set-secret tests keep their calls; a test that lists the profile folder's files sees
  `held/` after a version-2 deploy. (f) `apps/cli/test/templates/workflow.test.ts`'s CW4 expects the
  checkout's `with` to gain `fetch-depth: 0` (N2). No asserted sentence changes but these.

## R24. What SC-005's "every end-to-end deploy test of today" is run as

- **Decision.** The deploy flows of `apps/cli/tests/deploy.e2e.ts`, `rollback.e2e.ts` and
  `link.e2e.ts` (a linked folder, one with a secret, a rollback to deploy 1, two apps) are replayed
  as plain commands in `apps/cli/test/scenarios/pairing.test.ts` against runner 0.1.0 from git,
  each checked as those tests check (`status`'s numbers and versions, Docker's `up` calls, where the
  value is) and each saying C6. The end-to-end files are not edited or run.

## R25. Records the hosted service would read (M1, M2)

- **Decision.** M1 is the board `Deploy2Refusals`'s list (it is later than lines.md): it names
  "deploy numbers and times" and not "expiries". The same words go to `security.mdx` (M2); a test
  keeps the two notes equal word for word.

## R26. No listening socket (SC-010)

- **Decision.** A test reads every file of `apps/runner/src` and `packages/core/src` for
  `Bun.serve`, `Bun.listen`, `Bun.connect`, `Bun.udpSocket`, `fetch(`, `WebSocket`, `node:net`,
  `node:http`, `node:https`, `node:http2`, `node:dgram`, `node:tls`; and, when `lsof` is present,
  lists the runner's internet sockets while a deploy is held in `up`: none.

## R27. The docs

- **Decision.** `deploying.mdx` (previous, refused deploys use no number, C1, C2, C6, C7, the
  rollback), `secrets.mdx` (kept on the server, the completeness rule, C4, C5, when set and rm read
  the server), `runner.mdx` and `apps/runner/README.md` (protocol 3, `deploy` and `records`, the
  `records/` folder, the mark, the new reasons, an older runner put back fails closed, restoring
  the folder is not supported), `servers.mdx` (updating to a protocol-3 runner is one way),
  `security.mdx` (M2), `README.md` (M1), `packages/core/README.md` ("What it guarantees"). No
  roadmap line: nothing asks for one, and the runner that carries version 2 ships with 015.

## R28. The hash domains

- **Decision.** `zekno/v1/pack`, `zekno/v1/pack-chunk` and `zekno/v1/build` join `HashDomain` now,
  since they define what `pack.hash`, `pack.chunks` and `key` mean. Only `zekno/v1/build` is
  computed in this step (the build key, K6); the review checked that the nine labels differ and
  hold no zero byte (review part 4, "Hash domains").

## R29. Two deploys with one number in the history

- **Decision.** Kept as today: `verifiedDeploys` keeps the later entry for a number; rollback offers
  only answered entries. With R6, a refused version-2 entry is gone, so two entries share a number
  only when one never got its answer (C2).

## R30. C1, C2 and R1, after `replayed`

- **Decision.** On `replayed` to a version-2 deploy the CLI asks `status` again on the same
  session. If that fails in any way, or the app's number is not above `previous`, R1. Otherwise,
  with `N` the number: C2 when the history holds another entry of the app numbered `N` whose
  outcome is `sent`; else C1. Rollback says `zekno rollback` in C1 (lines.md). C2 is said only on
  this path (FR-011; the board draws it at `✖ Starting` of the new deploy); before signing, a
  `sent` entry equal to the runner's number is signed on top of without a word (C3 is not built,
  decision 7 (b)). A `sent` version-1 entry counts too; it may have been refused rather than lost,
  a rare case when an app moves to version 2, accepted.

## R31. What `secretsForDeploy` reads from `status`

- **Decision.** The live names (`status.secrets` keys `<app>/<NAME>` with `removed: false`) and
  their versions, only to stop (C5); never as a listed version or hash. The app's entries are also
  remembered in `held/` as a floor for set and rm (R9).

## R32. `readDeployEntry`

- **Decision.** `readDeployEntry(envelope, trust)` (`shared/history.ts`) reads `payloadType`, then
  calls `readSignedDeploy` or `readSignedDeployV2`, and gives `{ format, deploy, signer }`, where
  `deploy` has the fields both kinds share (`teamId`, `teamHash`, `serverId`, `app`, `sequence`,
  `createdAt`, `compose`, `secrets`, `removed`) and `previous` for version 2. Every reader of the
  history uses it: `sentDeploys` (`ops/deploy.ts`), `deployedSecrets` (`ops/secret.ts`),
  `verifiedDeploys` (`shared/views.ts`).
