# Implementation Plan: Deploy version 2, the first step

**Branch**: `014-deploy-v2` (from `dev` at `e7b0146`) | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: the approved spec (7 user stories, FR-001 to FR-052, SC-001 to SC-011, the nine points
decided with the maintainer on 2026-11-18), the approved lines and boards in [design/](./design/),
and the design and its review in `specs/010-app-settings/` (`deploy-v2.md`, "the design";
`deploy-v2-review.md`, "the review"). This plan builds the design's question Q16: `previous`,
`expiresAt`, secrets by version with the completeness rule, protocol 3, version 1 and 2 together,
with V20 and V21 closed and the later fields refused.

## Summary

The core library gains a second signed deploy, kind `zekno.deploy.v2`, whose whole format is fixed
now (contracts/message.md), with its signer, its reader and its verifier, a stored runner state
with a version mark, and the rule that works out which secret statements a deploy lists
(`secretsForDeploy`). The runner gains two session commands: `deploy`, which checks a version-2
deploy in the order of contracts/runner-checks.md and keeps each secret's latest sealed record, and
`records`, which reads the statements it holds. Its `apply` keeps the version-1 path for the apps it
held before its first version-2 write, and writes the whole marked state back (V21). The CLI asks
the runner's protocol on the deploy's own connection, signs version 2 for protocol 3, version 1 with
C6 for an older runner, and stops with C7 before a newer one; it signs one above the runner's number,
lists every secret the server holds, sends a sealed record only when the server lacks it, and stops
with C4, C5 or C5b before signing when a secret cannot be used. Each version-2 deploy remembers what
the server said it holds (`held/`, never a value), so `zekno secret set` and `rm`, which never
connect, then fix it offline. Every new refusal has its own sentence.
The README and the docs say what the hosted service would read (M1, M2). No release is made and no
real server is used: the new runner is proven by tests that run the real runner program, the real
programs of `runner-v0.1.0` and of `e7b0146` taken from git, and real Docker where today's tests do.

## Needs the maintainer

Nothing. C5b's words, the one sentence decision B (below) added, were approved by the maintainer
on 2026-11-18 as written in `design/lines.md`.

## Decided with the maintainer after the plan (2026-11-18)

- **N1, decision B: `zekno secret set` and `zekno secret rm` never connect.** They stay offline in
  every case, and the four scenes `apps/cli/test/plain/plain-unchanged.test.ts` froze stay as they
  are. FR-028 is met another way (research R9): each version-2 deploy keeps on this machine what the
  server said it holds for the app (`held/<serverId>/<app>.json`: its statements and its versions,
  never a value, replaced whole at each read); set and rm take the next version as one above the
  highest of this machine's records and that memory, read as a floor and never for a hash or a
  listing; `rm` signs the removal of a name this machine only remembers. A deploy that finds the
  server holding something this machine cannot account for stops before signing (C4, C5, C5b), and
  the two commands its sentence names then work offline (contracts/cli.md, CL21).
- **N2: yes.** The checkout of `.github/workflows/pull-request-checks.yml` gets `fetch-depth: 0`
  (T082), so the pairing tests run on GitHub. The workflow still runs on `pull_request` only, with a
  read-only token, `persist-credentials: false` and no secret; the whole history it fetches is the
  repository's own, public one.

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.4 (pinned in the root `package.json`).

**Primary Dependencies**: `zod` and `libsodium-wrappers` in `packages/core`; Ink 8.0.0 and React
19.3.1 in `apps/cli`, untouched; Bun's built-ins, including `node:url`'s `domainToUnicode` and
`domainToASCII` for the A-label rule (research R10, probed on Bun 1.4.4). **No new package.**

**Storage**: the runner's `state.json` gains a mark and each app's format (contracts/state.md);
the CLI's profile folder gains `held/<serverId>/<app>.json`, what the server said it holds for an app
(statements and versions, never a value; data-model.md);
`records/<app>/<hash>.json` holds each live secret's latest record, sealed and signed, mode 0600.
The CLI's files keep their shapes: the history holds envelopes of both kinds.

**Testing**: `bun test` in each package. The core library's rules field by field and refusal by
refusal; the runner as a real process (one-shot and session) with the stand-in Docker; the CLI
through its operations, the plain interface, `inkUi` with the stand-in terminal and the app's
state; scenarios with the local runner of this repository; pairing scenarios with the programs of
`runner-v0.1.0` and `e7b0146` from git; the existing real-Docker scenario extended; `bun run screens
--check`; the docs test.

**Target Platform**: the CLI on macOS and Linux; the runner on Linux (tests on this machine).

**Project Type**: a library (`packages/core`), a server program (`apps/runner`), a command-line app
(`apps/cli`), docs (`apps/web/content/docs`, READMEs).

**Performance Goals**: a deploy over SSH takes one session, as today; the `records` read adds one
request of at most 256 statements (well under 1 MiB). A runner checks at most 256 statements per
deploy.

**Constraints**: the runner opens no port and makes no connection (FR-043); the version-1 verifier
and today's answers keep their behaviour and shape (FR-003, FR-033); no code file over 500 lines;
the CLI's import rules; no new package; no release, no real server; `apps/cli/tests/` and
`apps/cli/e2e.config.ts` neither edited nor run; `apps/cli/test/plain/plain-at-head.ts` and
`apps/cli/test/plain/plain-unchanged.test.ts` not edited.

**Scale/Scope**: 7 new and 9 changed files in `packages/core/src`, 3 new and 4 changed in
`apps/runner/src`, 6 new and 12 changed in `apps/cli/src`, about 32 new or extended test files, 7
docs pages and READMEs.

## Constitution Check

*GATE: checked before research and again after the contracts. All pass.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Security Promise First | Nothing new reaches the hosted service; no key is held anywhere new. A version-2 deploy is signed whole with its kind inside the signature, so neither version verifies as the other (FR-003). The order rule makes a deploy overtaken by another unrunnable (V1). Every secret statement is checked again at each use on the runner and before signing on the CLI, which takes versions and hashes only from statements it verified (FR-020, FR-021; `createDeployV2` verifies them itself). Stored records are sealed and signed, never decrypted on disk (FR-018). What the CLI remembers of the server (`held/`) is signed statements and versions only, never a value, and gives no hash or listing; `secret set` and `rm` connect to nothing. The version-1 path keeps the marked state (V21) and takes only apps held at the upgrade (FR-031). The runner's code makes no connection; a test reads its source and its open sockets (SC-010). An independent review is a task (FR-045). | Pass |
| II. Honest Surface | "Runner" everywhere. Every new line is an approved line of `design/lines.md` or a board; where the two differ the board is used (research R25). Every refusal has its own sentence (FR-039). The README and the security page say what the hosted service would read, including what arrives with later features, and that it never reads a value (M1, M2). The docs keep "Pre-alpha and unaudited", say that restoring a runner's folder is not supported, and that putting runner 0.1.0 back fails closed. C6 is said only when its words are true (research R18). | Pass |
| III. Read the Installed Docs First | No framework code changes. Bun's `node:url` IDNA functions were probed before they were chosen (research R10). Ink and React are used only as the existing parts use them. | Pass |
| IV. One Design System | No new component or colour: refusals and warnings are drawn by the existing `ErrorLine`, `MarkedLine`, `NoticeLine`, `Summary` and `Stages`. | Pass |
| V. Motion With Purpose | Nothing moves but what moves today. | Pass |
| VI. Accessible and Fast by Default | Every refusal has words and a mark (`✖`, `!`), never colour alone; the stage row keeps Checked, Signed, Sent, Starting. | Pass |
| VII. Verified Before Done | Tests are written first where a contract fixes the behaviour; every refusal, every check of part 6 for this step and every pairing of old and new programs has a test; at the end `typecheck`, `lint`, `test` without cache, `format`, `screens --check` and `compile` from the root and `apps/cli`, and the boards walked through at a pseudo-terminal. `bun run build` (`next build`) is recorded as not run, by the maintainer's rule. | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/014-deploy-v2/
├── spec.md                 # approved
├── design/                 # lines.md and the four approved boards (binding)
├── plan.md                 # this file
├── research.md             # R1 to R32: facts verified in the code, and the decisions taken
├── data-model.md           # the payload, the stored state, a held record, history, reasons, an app's states
├── contracts/
│   ├── message.md          # every field of the version-2 payload, its rule, and how later fields are treated
│   ├── runner-checks.md    # K1 to K17: the runner's order of checks for this step, and what a refusal leaves
│   ├── protocol.md         # protocol 3: `deploy` and `records`, their messages and bounds
│   ├── state.md            # the stored state, its mark, migration, the version-1 path, an older runner
│   └── cli.md              # the format choice, each command, the secrets rules, every line with its place and test
├── quickstart.md           # how to check each success criterion, and what must fail
├── tasks.md
├── checklists/requirements.md
└── security-review.md      # written by T070
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── crypto/envelope.ts         # PAYLOAD_TYPES.deployV2 = "zekno.deploy.v2"
│   ├── crypto/hash.ts             # HashDomain gains zekno/v1/pack, zekno/v1/pack-chunk, zekno/v1/build
│   ├── protocol/limits.ts         # the later fields' limits, stored records (64 MiB), the expiry window (7 days)
│   ├── protocol/result.ts         # DEPLOY_V2_REFUSALS: secret_missing, untrusted_secret, expired
│   ├── protocol/protocol.ts       # RUNNER_PROTOCOL 3; deploy and records; their schemas and frame bounds; RunnerReportSchema's reasons
│   ├── deploy/deploy.ts           # version 1 only, behaviour unchanged; state and opening moved out (576 → about 430 lines)
│   ├── deploy/state.ts            # new: the version-1 state (moved), the stored state with its mark, migration, the version-1 view
│   ├── deploy/open.ts             # new: the registry of verified deploys and openSecrets (moved), for both kinds
│   ├── deploy/link.ts             # staysInside exported
│   ├── deploy/later-fields.ts     # new: builds, predeploy, health, routes; the domain, path and word rules; buildKey
│   ├── deploy/message.ts          # new: the version-2 payload schema and readDeployV2Payload (malformed, then unsupported_version)
│   ├── deploy/deploy-v2.ts        # new: createDeployV2, readSignedDeployV2, verifyDeployV2
│   ├── secrets/statement.ts       # new: the secret statement schema (moved), verifySecretStatement, peekSecretStatement
│   ├── secrets/secret-record.ts   # verifySecret built on verifySecretStatement, behaviour unchanged (450 → about 400 lines)
│   ├── secrets/for-deploy.ts      # new: secretsForDeploy, what a deploy lists, supplies, and what stops it
│   └── index.ts                   # the new names
└── test/
    ├── crypto/hash.test.ts        # new
    ├── deploy/                    # new folder, mirroring src/deploy
    │   ├── message.test.ts, deploy-v2.test.ts, state.test.ts
    ├── secrets/statement.test.ts, secrets/for-deploy.test.ts   # new
    ├── scenarios/order.test.ts    # new: SC-001
    └── scenarios/messages.test.ts # extended: the new schemas and frames

apps/runner/
├── src/
│   ├── commands/commands.ts       # load reads the stored state; setup, sync and apply write it whole; apply's version-1 gate
│   ├── commands/deploy.ts         # new: the deploy request, in the order of runner-checks.md
│   ├── commands/records.ts        # new: the records request
│   ├── home/home.ts               # writeAtomic and ensureDir exported
│   ├── home/records.ts            # new: record files: read, write synced, delete those no state names, sizes
│   ├── docker/compose.ts          # composeUp runs in the runner's folder (decision 4)
│   └── session/session.ts         # deploy, with progress events, and records
└── test/
    ├── support/helpers.ts         # deployed() deploys with version 2
    ├── support/deploy-v2.ts       # new: buildDeployV2, signPayload, deployV2, olderState, recordFiles
    ├── support/older-programs.ts  # new: the programs of runner-v0.1.0 and e7b0146, from git
    ├── scenarios/deploy-v2.test.ts, secrets-v2.test.ts, versions.test.ts, pairing.test.ts, no-network.test.ts   # new
    ├── scenarios/runner.test.ts, refusals.test.ts, hardening.test.ts, session/session.test.ts   # moved onto deploy, or onto an older state
    └── compiled/compiled.test.ts  # the protocol it expects is RUNNER_PROTOCOL

apps/cli/
├── src/
│   ├── cli/errors.ts              # R4 to R6 in REASONS; explainDeploy(reason, format) with R1 to R3, R7, R8; RunnerRefused takes a message
│   ├── shared/deploy.ts           # DeployInfo gains format and secretNames; DeployProgress gains format
│   ├── shared/deploy-words.ts     # new: C1, C2, C4, C5, C6, C7
│   ├── shared/history.ts          # new: readDeployEntry, a history entry of either kind, read by its own verifier
│   ├── shared/views.ts            # reads the history with readDeployEntry
│   ├── server/session.ts          # EVENTS: deploy sends progress
│   ├── ops/deploy.ts              # sendDeploy: the format, the records read, the listing, previous, the request; version 1 as today with C4
│   ├── ops/deploy-format.ts       # new: chooseFormat, C6's condition, C7
│   ├── ops/deploy-secrets.ts      # new: the listing of a deploy, C4 and C5, the former members' key ids
│   ├── ops/deploy-answer.ts       # new: the runner's answer to deploy: C1, C2, the R-lines, the history entry
│   ├── ops/secret.ts              # set and rm take floorVersion; rm of a name only remembered; deployedSecrets reads both kinds
│   ├── ops/secret-versions.ts     # new: latestVersions (moved), floorVersion, remembersName: offline, from the store and held/
│   ├── profile/profile.ts         # held(serverId, app) and saveHeld: what the server said it holds, never a value
│   ├── ui/parts/deploy-summary.tsx  # numberUsed is false once a version-2 deploy ended in error (C8)
│   ├── ui/ink/deploy-live.ts      # keeps the format from the stage
│   ├── app/state/events.ts        # deploy-stage carries format and secretNames
│   ├── app/state/deploy.ts        # deployStage keeps them
│   └── app/effects/deploys.ts     # dispatches them
└── test/
    ├── cli/errors.test.ts                       # new: every reason's sentence (SC-011)
    ├── shared/deploy-words.test.ts, shared/history.test.ts   # new; shared/views.test.ts extended
    ├── ops/deploy-format.test.ts, deploy-secrets.test.ts, deploy-answer.test.ts, secret-versions.test.ts   # new
    ├── profile/held.test.ts                     # new: the held/ file
    ├── support/team-of-two.ts                   # new: a second member, a record they set, their removal
    ├── scenarios/deploy-v2.test.ts, secrets-v2.test.ts, removed-member.test.ts, deploy-versions.test.ts, pairing.test.ts   # new
    ├── scenarios/real-docker.test.ts            # extended: a second deploy with nothing changed
    ├── ui/ink/single-commands.test.tsx, app/app-operate.test.tsx, app/app-state.test.ts   # extended: the lines
    ├── scenarios/held.test.ts                   # new: a stop, then set or rm offline, then the deploy goes through
    ├── templates/workflow.test.ts               # CW4: the checkout's `with` gains fetch-depth: 0
    ├── docs/metadata-note.test.ts               # new: M1 and M2 say the same
    └── (protocol literals, history readers)     # ops/doctor.test.ts, scenarios/first-run.test.tsx, support/stand-in-server.ts,
                                                 # scenarios/hardening.test.ts, add-settings, settings-compose, settings-deploy,
                                                 # settings-which-file (T025, T027, T032)

apps/web/content/docs/   security.mdx (M2), deploying.mdx, secrets.mdx, runner.mdx, servers.mdx, storage.mdx
.github/workflows/pull-request-checks.yml   fetch-depth: 0 on the checkout (N2)
apps/web/content/screens/*.json   redrawn only if `bun run screens --check` names one (research R21)
README.md (M1), apps/runner/README.md, packages/core/README.md
```

**Structure Decision**: no new package and no new top-level folder in any `src`, so
`apps/cli/test/layers/layers.test.ts` needs no change. Version 2 lives beside version 1 in the
folders of its subject: the message and its checks in `packages/core/src/deploy/`, statements in
`secrets/`, messages in `protocol/`; the runner's new requests in `commands/` and its new files in
`home/`; the CLI's steps of a deploy in `ops/deploy-*.ts` as feature 012 split `ops/add*.ts`, the
words in `shared/`, the drawing where it is drawn today. Files over 500 lines are not made longer:
`packages/core/src/deploy/deploy.ts` (576) is split first (T001); `ops/doctor.ts` (778),
`ops/server.ts` (530), `asking/first-deploy.ts` (539) and `settings/words.ts` (633) are not
touched; `server/session.ts` (479) gains one line; `ops/secret.ts` (456) and
`secrets/secret-record.ts` (450) lose lines to their new neighbours (T002, T003); the runner's
`test/support/helpers.ts` (480) gains only `deployed()`'s change and its new helpers go to
`support/deploy-v2.ts`.

## Which way imports point (rules of specs/007-code-in-folders)

- `packages/core`: `deploy/message.ts` imports `deploy/later-fields.ts`, `crypto/hash.ts`,
  `protocol/limits.ts`, `secrets/secrets.ts` (names) and `team/roster.ts` (patterns);
  `deploy/deploy-v2.ts` imports `message.ts`, `state.ts`, `open.ts`, `crypto/envelope.ts`,
  `secrets/secret-record.ts` and `secrets/statement.ts`; `deploy/deploy.ts` imports `state.ts` and
  `open.ts`; `secrets/for-deploy.ts` imports `statement.ts` and `secret-record.ts`, nothing of
  `deploy/`. `later-fields.ts` imports `node:url` and `deploy/link.ts` (`staysInside`). Nothing in
  core imports a framework or does I/O; the runner's held records reach `verifyDeployV2` through a
  function it is given.
- `apps/runner`: `commands/deploy.ts` and `commands/records.ts` import `commands/commands.ts`
  (`load`, `follow`, `locked`, `refused`, `withinLimits`), `home/records.ts`, `docker/compose.ts`
  and `@workspace/core`; `home/records.ts` imports `home/home.ts`; `session/session.ts` imports the
  two new commands. Nothing imports `session/`.
- `apps/cli`: the new `ops/deploy-*.ts` and `ops/secret-versions.ts` are in `ops/`: they import
  `shared/`, `server/`, `profile/`, `version/`, `cli/context.ts`, `cli/errors.ts` and
  `@workspace/core`, and nothing from `ui/`, `app/`, `asking/` or `commands/` (rule 2).
  `shared/history.ts` and `shared/deploy-words.ts` are in a folder of rule 3: they import
  `@workspace/core` and `profile/` (types) only. `cli/errors.ts` imports nothing new (rule 6).
  `ui/parts/deploy-summary.tsx` and `ui/ink/deploy-live.ts` read the new fields from
  `shared/deploy.ts` (rule 4). `app/` imports `ops/` as today (rule 1). Rule 5 holds: nothing new
  loads Ink or React outside `ui/` and `app/`.

## What does not change

A checklist for the review (T070) and the end checks (T073). The base is `e7b0146`.

- [ ] The version-1 verifier: `createDeploy`, `readSignedDeploy`, `verifyDeploy`, `openSecrets`
      for a version-1 deploy, `parseRunnerState` and `initialRunnerState` accept and refuse exactly
      what they did; every existing test of `packages/core/test` passes unchanged (FR-003).
- [ ] The shape of today's answers: `RunnerStatusSchema`, `RunnerSetupResponseSchema`,
      `RunnerAppStatesSchema`, `RunnerVersionSchema`, `RunnerLogsRequestSchema`,
      `RunnerApplyRequestSchema`, `RunnerSyncRequestSchema` byte for byte; `RunnerReportSchema`
      gains three reasons, which only answers to `deploy` carry (FR-033).
- [ ] The hosted service's messages: `StatusReportSchema`, `PendingDeploysResponseSchema`,
      `PublishDeployRequestSchema`, `SecretsResponseSchema`; `DEPLOY_REFUSALS` (15 reasons).
- [ ] The team list's format (version 1) and `applyRosterUpdate`.
- [ ] The CLI's files: `profile.json`, the secret store and the history keep their schemas (the
      profile folder gains `held/`, a file of its own)
      (`HistorySchema`'s outcomes stay `sent`, `started`, `start_failed`); 50 entries per app.
- [ ] `zekno rollback`'s lines (`Rolling back <A> to what deploy <N> ran.`, the history lines of
      `prepareRollback`), the result lines (`startedSentence`, `failedSentence`), the stage row
      (Checked, Signed, Sent, Starting), W1 to W5, D1, D2, `zekno doctor`'s lines,
      `zekno server update`'s lines, Home's `! older runner` and `! newer runner`.
- [ ] The bound of 1,000 (`MAX_AHEAD`) on the version-1 path; `--json` output shapes; plain output
      of every command, `zekno secret set` and `rm` included (`plain-unchanged.test.ts` unedited).
- [ ] `apps/cli/src/version/runner-release.json` (0.1.0) and `apps/runner/package.json` (0.1.0):
      no release (decision 1).
- [ ] One deploy lock and no time limit on `docker compose up` (decision 5); the runner's
      one-shot commands (`main.ts` `COMMANDS`).
- [ ] `INSTALL_SCRIPT`, `CHECK_SCRIPT`, every workflow but the one line of N2, `apps/cli/tests/`,
      `apps/cli/e2e.config.ts`, `apps/cli/test/plain/plain-at-head.ts`.
- [ ] `secret set`, `secret rm`, `secret ls`, `secret import`, `zekno add`: offline, as today, with
      the same calls (research R9).

## Phases

1. **Setup**: the splits that make room (core `deploy.ts`, `secret-record.ts`; CLI `ops/secret.ts`),
   with no behaviour change; the helpers that take older programs from git and write an older state.
2. **Foundational (core)**: the hash domains, reasons, limits and kind; the later fields and the
   payload; the stored state; statements; the signer, reader and verifier; `secretsForDeploy`; the
   protocol's new messages (the number stays 2); SC-001 and SC-002.
3. **US1, the order** (P1, MVP): the runner's `deploy` with the stored state; the CLI's format
   choice, previous, the deploy request and its answer (C1, C2, R1 to R3); protocol 3 switched on
   with the tests that name it; C8 and the lines.
4. **US2, secrets by version** (P1): record files and the `records` read; the listing; supply only
   what is missing; C5, R3, R4; SC-004 and SC-008.
5. **US3, a removed member** (P1): `untrusted_secret` on the runner; C4 before signing on both
   paths; what this machine remembers of the server; offline `secret set` and `rm` that fix C4,
   C5 and C5b; R5.
6. **US4, old and new programs** (P1): the version-1 gate; the existing runner tests moved; C6 and
   C7; the pairing scenarios from git.
7. **US5, later fields refused** (P2): each later field alone; R7, R8.
8. **US6, expiry** (P3): the runner's clock and the 7-day window; the CLI signs none; R6.
9. **US7 and docs** (P3): M1, M2, the docs pages and READMEs.
10. **Security review**: independent; every finding answered.
11. **Polish**: SC-010, the end checks, the walkthrough of the boards.

Each phase leaves `bun test` green in every package it touched, `bun run lint` clean and
`bun run format` changing nothing.

## Risks

- **Protocol 3 changes what every existing CLI test exercises.** The local runner of this
  repository answers protocol 3, and from T032 every scenario that deploys signs version 2, so
  tests that read the history with `readSignedDeploy` or test version-1 numbering break.
  Mitigation: protocol 3 is switched on in T025, once the runner answers `deploy`, while the CLI
  still signs version 1; the CLI signs version 2 from T032, which moves the tests research R23
  lists; no assertion of a sentence changes except those listed.
- **The version-1 gate breaks every runner test that applies to a new app.** Mitigation: those tests
  move onto `deploy` or onto an older state first (T050), and the gate lands after (T051).
- **Pairing with the real older programs needs git history**, absent in a shallow clone.
  Mitigation: the pull-request check fetches the whole history (N2, T082); elsewhere the helper
  skips with a printed reason, and quickstart step 6 runs them in a full clone.
- **A runner built from this branch says version 0.1.0 with protocol 3**, as runner 0.1.0 says 0.1.0
  with protocol 2 (decision 1: no release). Mitigation: nothing ships it; `zekno server update`
  compares versions and never installs it; C6 is said only when the versions differ (research R18);
  015 makes 0.1.1.
- **The first version-2 write is one way**: runner 0.1.0 then refuses everything (`invalid_state`).
  Mitigation: no real server is used; the docs say so; the pairing test proves it fails closed.
- **A remembered version that lies.** A runner, or attacker B editing `held/`, can report any
  version. This plan accepted it as denial only on this machine, until a later deploy read an
  honest answer. The security review (S1) showed it was not: signed by `zekno secret set` and
  deployed, a version of 2^53 - 1 freezes the secret on the honest server for good, never set again
  or removed. Mitigation: a version only `held/` or a record here that does not verify gives counts
  up to 1,000 above the highest version of the name that verifies here (0 for none), and is ignored
  beyond (research R9; contracts/cli.md CL18). The runner's own bound on a version's jump is
  deferred to the feature that limits keys and adds deploys from CI.
- **`held/` goes stale between deploys.** It is what the last version-2 deploy read. Mitigation: it
  is only a floor and a hint; every deploy reads the server again, verifies what it lists, and stops
  with C4, C5 or C5b when this machine's view is behind, after writing `held/` anew.
- **Records on disk.** A crash between a record's write and the state's leaves a file no state
  names. Mitigation: written and synced before the state, and every file of the app no state names
  is deleted at its next version-2 deploy (research R13).
- **`node:url` in the core library** is its first built-in import. Mitigation: two functions,
  probed; a pure decoder is the fallback if core must ever run without them (research R10).

## Complexity Tracking

No principle is violated. Nothing to justify.

## As built

Written on 2026-11-19, when every task was done. The numbers and the details are in `quickstart.md` ("Results"), `security-review.md` (part 8) and `design/walkthrough.md`.

**Done**: all 82 tasks. The core library signs and checks the new deploy format; the runner carries out the order, the expiry and secrets by version, keeps each secret's latest sealed record, and takes the older format only for apps it held before; `zekno deploy` and `zekno rollback` choose the format from the runner's protocol before signing; `zekno secret set` and `zekno secret rm` never connect. Tests: core 300, runner 227 (1 skipped: the real build), web 54, cli 2,404 (4 skipped), none failing; type check, lint and Prettier clean; the docs' stored screens in step.

**No release, as decided.** A zekno built from this branch still installs runner 0.1.0, so against released servers it signs the older format. The new format is used with a runner that says protocol 3: the tests' runner, `--runner-file`, and the runner on this machine. Runner 0.1.1 and its proof on a real server belong to feature 015.

**What differs from the approved boards** (the four `Built…` boards beside them show the real program):

- At a terminal, the panel of `zekno deploy` shows the app, the server and the number of secrets, as it does today. The approved boards drew three more rows (the file, the secrets' names, "replaces deploy 41") that the command has never shown. The app's panel does show them.
- A stop before signing (C4, C5, C5b, C7) prints the sentence alone at a terminal, as any stop at that point does today. The app shows the panel with `✖ Checked`.
- When the Compose file reads the secret that stops the deploy, `zekno deploy` first asks for its value, as it does for any value it does not have. A typed value sets the secret again and the deploy goes on; skipping leads to the sentence.
- The board's case "the server learned of the removal first" does not give the sentence for a secret set by someone no longer in the team: the real runner checks the team list before the secrets, so `zekno deploy` says today's sentence about the team list. That sentence of the runner is built and tested for a deploy made by another client.

**Decided after the plan**: secrets stay offline (decision B) with the sentence C5b; the pull-request check fetches the whole history; and the review's fixes (a claimed version counts only 1,000 above a verified one; a statement is at most 4,096 characters; the runner checks its folder before the lock; the history is read again before it is written; a version-2 deploy has one spelling).

**Left, on purpose**:

- The runner's own bound on how far a secret's version may jump: with the feature that limits keys (it needs a new refusal sentence).
- Two notes of the review on domain names (S7): to be decided in feature 015, before routes are carried out.
- The app draws a long error with its backticks, without the bold first sentence, and with a row that can start one space in. It is how the app draws any long error today; it shows now because these sentences are long.
- Four source files were already over 500 lines before this feature (`ops/doctor.ts`, `settings/words.ts`, `asking/first-deploy.ts`, `ops/server.ts`); none was made longer.
