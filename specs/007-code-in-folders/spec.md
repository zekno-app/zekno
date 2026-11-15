# Feature Specification: Code in folders

**Feature Branch**: `007-code-in-folders`
**Created**: 2026-11-15
**Status**: Approved by the maintainer on 2026-11-15 ("Approve, use this code folders layout")
**Input**: the maintainer's rule of 2026-11-15, "make sure that we always scope codes into
folders for easier understanding and reading purpose" (constitution 1.3.0, Technology
Constraints, "Code in folders"), and the layout shown to them the same day.

## What this is

A change to where code lives, and nothing else. Nothing a person sees or types changes, nothing
that is signed, sealed, sent or checked changes, and no dependency is added. It is a compact
feature: one user story, and the plan records why the usual cycle is short.

## User Story 1: someone reading the tree understands the product (P1)

A maintainer or a new contributor opens `apps/cli/src`, `apps/runner/src` or
`packages/core/src` and sees folders named for what the code is about. Each package's `src`
holds its entry point and folders, nothing loose. Tests sit in folders of the same names.

**Independent test**: list each `src` root; read the layering rules of the plan and run the
test that enforces them; run every existing test.

**Acceptance scenarios**

1. **Given** the three packages, **when** their `src` roots are listed, **then** each holds
   exactly one file, its entry point (`main.ts`, `main.ts`, `index.ts`), and folders.
2. **Given** any command of `zekno` or the runner, **when** it runs before and after this
   feature, **then** what it prints, asks, writes, sends and exits with is the same.
3. **Given** the largest files (`state.ts`, `effects.ts`, `ink.tsx`, `install.ts`), **when** the
   feature is done, **then** each subject they held is a file of its own in that subject's
   folder, and no file a person has to read is longer than about 500 lines without a reason
   written at its top.
4. **Given** the folders of `apps/cli/src`, **when** their imports are listed, **then** they
   follow the directions the plan names, and a test fails when one does not.

## Requirements

- **FR-001**: Each package's `src` root MUST hold only its entry point and folders.
- **FR-002**: Tests MUST mirror the folders of the code they test; shared test support lives in
  `test/support/`, tests that cross subjects in `test/scenarios/`.
- **FR-003**: Behaviour MUST NOT change: every existing test passes with its expectations
  unchanged, apart from paths named as text; the transcripts of `apps/cli/test/plain/` are not
  edited; the agent end-to-end tests replay from their cache. The one exception, found by the
  review (R3): three expectations that held a copy equal to its original were removed with the
  copies (two whole tests, in `ops/doctor.test.ts` and `asking/first-deploy.test.ts`, and one
  line of a kept test in `asking/asking.test.ts`). Nothing else was removed or loosened.
- **FR-004**: The installer's script MUST stay byte for byte as it is (its SHA-256 is pinned by
  a test), and so MUST the check script of `zekno doctor`.
- **FR-005**: `packages/core`'s public interface (`src/index.ts`) MUST export exactly what it
  exported before.
- **FR-006**: The release tooling MUST name the new place of the runner release file
  (`apps/cli/src/version/runner-release.json`) everywhere: the scripts, their sentences, their
  tests, `RELEASING.md`, the READMEs, the docs page and the workflows' comments.
- **FR-007**: Imports between the folders of `apps/cli/src` MUST follow the directions of the
  plan, checked by a test.
- **FR-008**: A rule that exists twice MUST exist once: the secret-name rule is the core's.
- **FR-009**: No dependency, tool or file format is added. Lint and format for the CLI, the
  runner and the core are a separate choice for the maintainer, not part of this feature.

## Success Criteria

- **SC-001**: `ls` of each `src` root shows one file.
- **SC-002**: All tests pass, as many as before or more: core 102, runner 147 (1 skipped),
  CLI 896, web 28 before this feature.
- **SC-003**: The compiled `zekno` reports its version; the agent end-to-end tests replay.
- **SC-004**: `git diff` of the installer's script text and the check script's text is empty.

## Out of scope

Lint and format tooling; any change to wording, screens or security behaviour; the specs of
earlier features, which keep the paths that were true when they were written.
