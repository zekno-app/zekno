# Tasks: Code in folders

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase A: the move

- [X] T001 Move the loose files of `apps/cli/src`, `apps/runner/src` and `packages/core/src` into the folders of plan.md with `git mv`, and rewrite every relative import
- [X] T002 Move the tests of the three packages into folders of the same names (`test/support/`, `test/scenarios/`, `test/compiled/`, `test/docs/` for the rest)
- [X] T003 Fix every path named as text: `apps/cli/build.ts`, tests that open or start a file, and `apps/cli/src/version/runner-release.json` in `apps/runner/scripts/`, their tests, `apps/runner/RELEASING.md`, the READMEs, `apps/web/content/docs/cli.mdx` and the workflows' comments
- [X] T004 Typecheck, lint, every test without the cache, `bun run compile` in `apps/cli`, the agent end-to-end replay; commit

## Phase B: the splits and the directions (US1)

- [X] T005 [US1] `apps/cli/src/app/state/`: split `state.ts` by screen, the reducer's behaviour unchanged; use the core's secret-name rule and remove the app's copy
- [X] T006 [US1] `apps/cli/src/app/effects/`: split `effects.ts` by concern
- [X] T007 [US1] Nothing outside `app/` imports `app/`: what `ui/`, `asking/`, `ops/` and `shared/` take from it moves to `shared/` or `server/`; copies made in feature 006 to avoid loading Ink are replaced by the one original
- [X] T008 [P] [US1] `apps/cli/src/server/install/`: split `install.ts` into its script, its steps and its checks; `INSTALL_SCRIPT` byte for byte
- [X] T009 [US1] `apps/cli/src/ui/ink/`: split `ink.tsx` by what it draws
- [X] T010 [US1] `ops/` imports nothing from `asking/`: the sentence of an app that is taken lives where both can use it; `server/` does not import `ui/plain`

## Phase C: the end

- [X] T011 `apps/cli/test/layers/layers.test.ts`: the directions of plan.md, checked on every import
- [X] T012 Independent review of the whole diff as moved text: nothing signed, sealed, sent, checked or drawn changed; recorded in `specs/007-code-in-folders/review.md`
- [X] T013 Docs: the "Develop" parts of the READMEs name the folders; the feature map
- [X] T014 Final checks as T004, recorded in `specs/007-code-in-folders/results.md`
- [X] T015 After the review (R4): split `apps/cli/src/app/screens/home.tsx` and `apps/cli/src/project/project.ts` by subject, as moved text
- [X] T016 After the review (R1): the layering test gains rule 6 of plan.md and fails on what would hide a breach
