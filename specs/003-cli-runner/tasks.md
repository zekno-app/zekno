# Tasks: CLI and Runner, Deploying Directly

**Input**: Design documents from `/specs/003-cli-runner/`

**Tests**: included. SC-002 to SC-004 require automated end-to-end and refusal tests.

**Organization**: grouped by user story. Paths are relative to the repository root.

## Phase 1: Setup

- [X] T001 [P] Create apps/runner/package.json (`@workspace/runner`, scripts `typecheck`, `test`, `compile`) and apps/runner/tsconfig.json
- [X] T002 [P] Create apps/cli/package.json (`@workspace/cli`, scripts `typecheck`, `test`, `compile`) and apps/cli/tsconfig.json
- [X] T003 Run `bun install` so both apps resolve `@workspace/core`

## Phase 2: Foundational (blocks every story)

- [X] T004 Add `RunnerSetupRequest`, `RunnerSetupResponse`, `RunnerSyncRequest`, `RunnerApplyRequest`, `RunnerReport` (outcomes `ok`, `started`, `start_failed`, `refused`; runner reasons `invalid_request`, `invalid_state`, `not_set_up`, `already_set_up`, `busy`) and `RunnerStatus` to packages/core/src/protocol.ts, export them from packages/core/src/index.ts, and test them in packages/core/test/scenarios/messages.test.ts
- [X] T005 Implement the runner's folder in apps/runner/src/home.ts: folder mode 0700, `server.key` and `state.json` mode 0600, state written to a temporary file and renamed, exclusive lock file
- [X] T006 [P] Implement the CLI profile in apps/cli/src/profile.ts: `profile.json`, `secrets/<serverId>/<app>.json`, `history/<serverId>/<app>.json`, with schemas and the name patterns from data-model.md
- [X] T007 [P] Implement `KeyStore` with the OS keychain (`Bun.secrets`, service `app.zekno.cli`) and an in-memory version in apps/cli/src/keystore.ts
- [X] T008 [P] Implement transports in apps/cli/src/transport.ts: SSH (destination `^[A-Za-z0-9][A-Za-z0-9._@:-]*$`, runner path `^[A-Za-z0-9._/~-]+$`, passed after `--`) and local process
- [X] T009 [P] Add a stand-in `docker` and helpers for tests in apps/runner/test/helpers.ts

## Phase 3: User Story 1 - First deploy to my own server (P1) 🎯 MVP

**Independent Test**: `bun test apps/cli/test/journey.test.ts`

- [X] T010 [US1] Implement `setup` and `status` in apps/runner/src/commands.ts
- [X] T011 [US1] Implement `sync` and `apply` in apps/runner/src/commands.ts following the order of work in contracts/commands.md
- [X] T012 [US1] Implement Docker Compose start with secrets in the environment and reserved names (`PATH`, `HOME`, `DOCKER_*`, `COMPOSE_*`) protected in apps/runner/src/compose.ts
- [X] T013 [US1] Implement the runner entry (one command per run, JSON in, one JSON line out, exit status 0, 1 or 2) in apps/runner/src/main.ts
- [X] T014 [US1] Implement `zekno init` in apps/cli/src/commands/init.ts
- [X] T015 [US1] Implement `zekno server add` and `zekno server ls` in apps/cli/src/commands/server.ts
- [X] T016 [P] [US1] Implement reading a value without echo, or from standard input, in apps/cli/src/ui/ (first written as apps/cli/src/prompt.ts, replaced by T034)
- [X] T017 [US1] Implement `zekno secret set` and `zekno secret ls` in apps/cli/src/commands/secret.ts
- [X] T018 [US1] Implement `zekno deploy` and `zekno status` in apps/cli/src/commands/deploy.ts
- [X] T019 [US1] Implement argument parsing, dispatch, help and exit statuses in apps/cli/src/cli.ts and the entry in apps/cli/src/main.ts
- [X] T020 [US1] End-to-end journey with a real runner process and a stand-in docker in apps/cli/test/journey.test.ts
- [X] T021 [US1] End-to-end with a real container, skipped when Docker or the image `caddy:2.11.9` is missing, in apps/cli/test/real-docker.test.ts

## Phase 4: User Story 2 - The runner refuses what my team did not sign (P2)

**Independent Test**: `bun test apps/runner/test/refusals.test.ts`

- [X] T022 [US2] Tests: forged deploy, replay, exchanged secrets, garbage input, each leaving state unchanged and starting nothing, in apps/runner/test/refusals.test.ts
- [X] T023 [US2] Tests: second setup refused, damaged state refused, `start_failed` keeps the deploy number, a held lock reports `busy`, in apps/runner/test/runner.test.ts

## Phase 5: User Story 3 - Change, roll back and retire (P3)

**Independent Test**: `bun test apps/cli/test/day-two.test.ts`

- [X] T024 [US3] Implement `zekno secret rm` in apps/cli/src/commands/secret.ts
- [X] T025 [US3] Implement deploy history and `zekno rollback` in apps/cli/src/commands/deploy.ts
- [X] T026 [US3] Tests: set again raises the version, rollback reuses the earlier definition under the next number, a removed secret is gone and cannot come back, in apps/cli/test/day-two.test.ts

## Phase 6: Polish & Cross-Cutting

- [X] T027 [P] Edge-case tests from the spec (command before `init`, unknown server or app, missing or oversized Compose file, reserved secret name, server connected twice, wrong usage) in apps/cli/test/edge-cases.test.ts
- [X] T028 [P] Test that no private key and no secret value is in any file either program wrote (SC-004) in apps/cli/test/journey.test.ts
- [X] T029 [P] Write apps/cli/README.md and apps/runner/README.md, and update the repository table and roadmap in README.md
- [X] T030 Confirm both programs compile to single files with `bun run compile`
- [X] T031 Run the quickstart on this machine and record the results in specs/003-cli-runner/quickstart.md
- [X] T032 Internal security review of both programs, fix every finding rated high or critical, and record it in specs/003-cli-runner/security-review.md

## Phase 7: Review fixes and the terminal interface

- [X] T033 Runner fixes from the review (lock, setup order, durable writes, late failures, folder ownership, reserved names) in apps/runner/src/home.ts, apps/runner/src/commands.ts and packages/core/src/secrets.ts
- [X] T034 Put a `Ui` between commands and the terminal: Ink at a terminal in apps/cli/src/ui/ink.tsx, plain lines in apps/cli/src/ui/plain.ts, key handling for the hidden prompt in apps/cli/src/ui/secret-input.ts
- [X] T035 CLI fixes from the review: rebuild trust from signed lists and the team code in the keychain (apps/cli/src/context.ts), store no command for a local runner (apps/cli/src/transport.ts), signed deploy history and number checks (apps/cli/src/commands/deploy.ts), resume of `server add` (apps/cli/src/commands/server.ts), answer size limit and extra words refused
- [X] T036 Tests for every fix in apps/cli/test/hardening.test.ts and apps/cli/test/secret-input.test.ts, and a run of the Ink interface in a pseudo-terminal recorded in specs/003-cli-runner/quickstart.md

## Dependencies & Execution Order

Setup → Foundational → US1. US2 only adds tests on US1's runner. US3 adds two commands to the CLI.
T010 and T011 share apps/runner/src/commands.ts; T017 and T024 share apps/cli/src/commands/secret.ts.

## Implementation Strategy

MVP is Phases 1 to 3: one developer deploys one app to one server. Phase 4 proves SSH access
alone cannot drive the runner. Phase 5 adds the day-two commands.
