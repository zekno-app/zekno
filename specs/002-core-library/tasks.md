# Tasks: Core Library

**Input**: Design documents from `/specs/002-core-library/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: included. The spec's success criteria require automated end-to-end scenarios for every attack (SC-002) and typed rejection of every malformed input (SC-007).

**Organization**: grouped by user story. Paths are relative to the repository root.

## Phase 1: Setup

- [X] T001 Create the package manifest in packages/core/package.json (`@workspace/core`, `typecheck` and `test` scripts, export `./src/index.ts`)
- [X] T002 Install `libsodium-wrappers` and `zod` in packages/core/package.json and confirm the libsodium functions used exist in the installed type definitions
- [X] T003 [P] Add packages/core/tsconfig.json extending `@workspace/typescript-config/base.json` with Bun types

## Phase 2: Foundational (blocks every story)

- [X] T004 Load libsodium once and re-export it in packages/core/src/sodium.ts
- [X] T005 [P] Implement byte, base64url, hex and well-formed-text helpers in packages/core/src/encoding.ts
- [X] T006 [P] Define `Result`, `CoreError` and every refusal code from data-model.md in packages/core/src/result.ts
- [X] T007 [P] Put every limit in packages/core/src/limits.ts: 256 secrets per deploy, 64 KiB per secret value, 128-character secret names, 256 KiB service definition, 64 members, 1 MiB payload, 2 MiB envelope
- [X] T008 Implement domain-separated BLAKE2b hashing in packages/core/src/hash.ts
- [X] T009 Implement marked key text forms (`zk_mpk_`, `zk_msk_`, `zk_spk_`, `zk_ssk_`), key generation, key ids, server ids and `createSigner` in packages/core/src/keys.ts
- [X] T010 Implement the signed envelope (prefix `zekno-sig-v1`, payload type, byte length; payload types `zekno.deploy.v1` and `zekno.roster.v1`) in packages/core/src/envelope.ts
- [X] T011 [P] Unit tests for keys and envelopes in packages/core/test/keys.test.ts and packages/core/test/envelope.test.ts

**Checkpoint**: keys can be made, and bytes can be signed and verified per message kind.

## Phase 3: User Story 1 - A deploy only the team can authorize and only the server can read (P1) 🎯 MVP

**Goal**: seal secrets, sign a deploy, verify it as the runner, open the secrets.

**Independent Test**: `bun test test/scenarios/round-trip.test.ts` in packages/core.

- [X] T012 [US1] Implement `sealSecret` and the internal open with the `{ v, serverId, app, name, value }` record, name pattern `^[A-Za-z_][A-Za-z0-9_]*$` and the value limit in packages/core/src/secrets.ts
- [X] T013 [US1] Implement `createTeam` and the team-list payload schema (version 1, `previous` null, 1 to 64 members, unique keys and names, at least one admin) in packages/core/src/roster.ts
- [X] T014 [US1] Implement `createDeploy` and the deploy payload schema (app pattern `^[a-z0-9][a-z0-9-]{0,62}$`, sequence ≥ 1, secrets sorted by name with ciphertext hashes) in packages/core/src/deploy.ts
- [X] T015 [US1] Implement `verifyDeploy` checks for size, shape, payload type, known signer, signature, payload version and role in packages/core/src/deploy.ts
- [X] T016 [US1] Implement `openSecrets` behind a module-private `WeakSet` of verified deploys, refusing anything else with `not_verified`, in packages/core/src/deploy.ts
- [X] T017 [US1] Export the public interface from packages/core/src/index.ts
- [X] T018 [P] [US1] Add a team, a server and an attacker-controlled relay for tests in packages/core/test/helpers.ts
- [X] T019 [US1] End-to-end scenario: accepted deploy, exact secrets, unknown signer, altered byte, no readable secret in the relay's copy, no decrypt without verification, in packages/core/test/scenarios/round-trip.test.ts
- [X] T020 [P] [US1] Unit tests for secrets in packages/core/test/secrets.test.ts

**Checkpoint**: the product's promise works end to end for one member and one server.

## Phase 4: User Story 2 - A breached relay cannot replay, redirect or swap anything (P2)

**Goal**: valid signatures are not enough; binding and ordering are enforced.

**Independent Test**: `bun test test/scenarios/hostile-relay.test.ts` in packages/core.

- [X] T021 [US2] Add the sequence check (`replayed`) and `nextState` to `verifyDeploy` in packages/core/src/deploy.ts
- [X] T022 [US2] Add the team and server checks (`wrong_team`, `wrong_server`) to `verifyDeploy` in packages/core/src/deploy.ts
- [X] T040 [US2] Sign every secret (`zekno.secret.v1` statement with team, server, app, name, version and ciphertext hash), verify the records in `createDeploy`, and refuse older secret versions in `verifyDeploy` (`stale_secret`), in packages/core/src/secret-record.ts and packages/core/src/deploy.ts (added from the security review, FR-029 and FR-030)
- [X] T023 [US2] Add the secrets check (`secrets_mismatch` for a missing, extra, duplicated or re-hashed value) to `verifyDeploy`, and `binding_mismatch` to `openSecrets`, in packages/core/src/deploy.ts
- [X] T024 [US2] End-to-end scenario: replay, rollback as a new deploy, other server, other team, exchanged ciphertexts, in packages/core/test/scenarios/hostile-relay.test.ts

## Phase 5: User Story 3 - Team membership the relay cannot forge (P3)

**Goal**: only a current admin can change the team, one step at a time.

**Independent Test**: `bun test test/scenarios/team.test.ts` in packages/core.

- [X] T025 [US3] Implement `proposeRoster` (version N+1, `previous` = hash of N, signer must be an admin of N) in packages/core/src/roster.ts
- [X] T026 [US3] Implement `applyRosterUpdate` with refusals `unknown_signer`, `bad_signature`, `not_admin`, `wrong_team`, `wrong_version`, `wrong_previous`, `invalid_members` in packages/core/src/roster.ts
- [X] T027 [US3] End-to-end scenario: add a deployer, forged change, deployer signing a change, removed member, rollback of the list, list without an admin, in packages/core/test/scenarios/team.test.ts

## Phase 6: User Story 4 - Confirming keys when a server is connected (P4)

**Goal**: a substituted key or founding list is visible to a person.

**Independent Test**: `bun test test/scenarios/pairing.test.ts` in packages/core.

- [X] T028 [US4] Implement 100-bit Crockford base32 codes, `serverConfirmationCode`, `rosterConfirmationCode` and constant-time `confirmationCodesMatch` in packages/core/src/confirm.ts
- [X] T029 [US4] Implement `trustFoundingRoster(envelope, confirmedCode)` with refusal `code_mismatch` in packages/core/src/roster.ts
- [X] T030 [US4] End-to-end scenario: same key gives the same code, substituted key and substituted founding list give different codes, case and separators ignored, in packages/core/test/scenarios/pairing.test.ts

## Phase 7: User Story 5 - One description of every message (P5)

**Goal**: shared, validated message definitions.

**Independent Test**: `bun test test/scenarios/messages.test.ts` in packages/core.

- [X] T031 [US5] Define strict schemas and types for `PublishDeployRequest`, `PendingDeploysResponse`, `StatusReport`, `PublishRosterRequest`, `RosterChainResponse` and `RegisterServerRequest` in packages/core/src/protocol.ts
- [X] T032 [US5] Implement `parseMessage(schema, input, maxBytes?)` returning a `Result` in packages/core/src/protocol.ts
- [X] T033 [US5] End-to-end scenario: each message round-trips; unknown field, missing field, oversized content and unknown version are rejected; a status report has no free-text field, in packages/core/test/scenarios/messages.test.ts

## Phase 8: Polish & Cross-Cutting

- [X] T034 [P] Edge-case tests from the spec (duplicate names, missing or extra values, empty deploy, first deploy, wrong key kind, bad text, garbage input, repeated team change) in packages/core/test/edge-cases.test.ts
- [X] T035 [P] Performance test for SC-004 (verify and open 50 secrets in under 100 ms) in packages/core/test/performance.test.ts
- [X] T036 [P] Write packages/core/README.md and update the repository table and roadmap in README.md
- [X] T037 Run the quickstart checks from specs/002-core-library/quickstart.md and record the results there
- [X] T038 End-to-end pass over every scenario, including a cross-process run behind a real HTTP relay in packages/core/test/scenarios/cross-process.test.ts, and record the outcome in specs/002-core-library/quickstart.md
- [X] T039 Internal security review of packages/core, fix every finding rated high or critical, and record the outcome in specs/002-core-library/security-review.md
- [X] T041 Fix the independent reviewer's findings in packages/core/src/roster.ts, packages/core/src/secret-record.ts and packages/core/src/deploy.ts: server keys in the team list (FR-031), founding hash in trust and `teamConfirmationCode` (FR-032), `teamHash` in deploys with refusal `stale_team` (FR-033), version-and-hash secret memory, required runner state, sequence step limit `sequence_jump` (FR-034), `proposeRoster` returning trust, stricter display names

- [X] T042 [US2] Signed secret removals (FR-035): `createSecretRemoval`, `verifySecretRemoval` and `currentSecrets` in packages/core/src/secret-record.ts; `removed` entries in deploys and removal memory in the runner state in packages/core/src/deploy.ts; `PublishSecretRemovalRequest` and removals in `SecretsResponse` in packages/core/src/protocol.ts; scenarios in packages/core/test/scenarios/retired-secrets.test.ts

## Dependencies & Execution Order

- Setup → Foundational → US1. US2 extends `verifyDeploy` from US1. US3 extends `roster.ts` from US1. US4 needs `roster.ts` and `keys.ts`. US5 needs the envelope and secret shapes.
- T015, T016, T021, T022 and T023 all edit packages/core/src/deploy.ts and run in sequence.
- T013, T025, T026 and T029 all edit packages/core/src/roster.ts and run in sequence.

## Parallel Opportunities

- T005, T006 and T007 touch separate files.
- Scenario files (T019, T024, T027, T030, T033) are separate files and can be written in parallel once their source tasks are done.
- T034, T035 and T036 are independent.

## Implementation Strategy

MVP is Phase 1 to 3: a single member can deploy to a single server with the full promise intact. Each later phase closes one way a breached relay could still hurt a customer, in order of how directly it breaks the promise.
