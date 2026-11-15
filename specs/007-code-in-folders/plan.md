# Implementation Plan: Code in folders

**Branch**: `007-code-in-folders` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

## Summary

Move every loose file of `apps/cli`, `apps/runner` and `packages/core` into the folders the
maintainer approved, mirror the tests, split the four largest files by subject, and make the
imports between folders point one way. No behaviour changes.

## Technical Context

Bun 1.4.4, TypeScript, Ink 8 with React 19, zod, `bun test`. No new dependency.

**Why the cycle is compact** (constitution, Development Workflow: a deviation is recorded): the
feature has no interface, data or contract of its own, so there is no research, data model or
contract document. The layout below is the design, and the maintainer approved it. The existing
tests are the acceptance tests.

## Constitution Check

- **I. Security Promise First**: nothing signed, sealed, sent or checked changes. The installer's
  script and the check script stay byte for byte (pinned). The release tooling's one path change
  is covered by its own tests. An independent review reads the diff at the end.
- **II. Honest Surface**: docs name the new paths; nothing else in them changes.
- **VII. Verified Before Done**: typecheck, lint, every test, the compiled program and the agent
  end-to-end replay after each phase. `next build` is not run (the maintainer's rule).
- **Code in folders** (Technology Constraints): this feature applies it to the code that
  existed before the rule.

## The layout

```text
apps/cli/src/
├── main.ts            the entry point, the only loose file
├── cli/               arguments and dispatch, what a command is given, errors
├── commands/          one file per command: draws and asks
├── ops/               what each command does: data only
├── asking/            questions in single commands, deploy from nothing
├── secrets/           reading a file of secrets
├── version/           the version, the newer-release check, the runner release it carries
├── server/            reaching a server: transport, session, sanitize, check script
│   └── install/       the installer: its script, its steps, its checks
├── project/           zekno.json, the record of first use, reading the Compose file
├── profile/           the profile folder and the keychain
├── shared/            what both the app and single commands show: times, app views, deploy stages
├── ui/                single commands at a terminal and in a pipe
│   ├── ink/           the terminal interface
│   ├── plain/         the interface with no terminal
│   ├── parts/         pieces both the app and single commands draw with
│   └── terminal/      the terminal itself: background, typed-ahead keys, colours, logo
└── app/               the full-screen app
    ├── state/         the reducer, by screen
    ├── effects/       what the app does outside its state, by concern
    └── screens/       one file per screen

apps/runner/src/       main.ts; commands/; session/; docker/; home/
packages/core/src/     index.ts; crypto/; team/; secrets/; deploy/; protocol/
```

Tests: `test/<the same folder>/`; `test/support/` for helpers and stand-ins; `test/scenarios/`
for tests that cross subjects; `test/compiled/`, `test/layers/` and `test/docs/` for the compiled program, the directions of imports and the
docs. `apps/cli/tests/` (the agent end-to-end tests) keeps the layout its runner expects.
`apps/runner/scripts/` already is a folder and stays.

## Which way imports point (apps/cli/src)

1. Nothing outside `app/` imports from `app/`.
2. `ops/` imports nothing from `ui/`, `app/`, `asking/` or `commands/`.
3. `shared/`, `server/`, `project/`, `profile/`, `secrets/` and `version/` import nothing from
   `app/`, `commands/`, `asking/` or `ops/`, and from `ui/` only `ui/types.ts`
   (the shapes a `Ui` draws) where they must.
4. `ui/` imports from `ops/` only types (the data it draws), and nothing from `app/`,
   `commands/` or `asking/`.
5. Nothing that `cli/cli.ts` imports statically loads Ink or React (already tested).
6. `cli/` holds two kinds of file. `cli/cli.ts` (arguments and dispatch) is imported by
   `main.ts` only. `cli/context.ts` and `cli/errors.ts` are what every folder may import, so
   they import nothing from `ops/`, `commands/`, `asking/` or `app/`, from `ui/` only
   `ui/types.ts`, and re-export nothing from another folder (review R1).

The test also fails on what would let a breach pass unseen (review R1): a source file that is
not `.ts` or `.tsx`, an `import(` or `require(` whose argument is not a plain string, and an
import that is neither relative nor one of the packages `apps/cli/package.json` names (or a
`node:`/`bun` built-in).

A test, `apps/cli/test/layers/layers.test.ts`, walks the imports and fails on a breach of 1 to 4.

## Phases

- **A. The move** (mechanical): `git mv` by a mapping, relative imports rewritten by a script,
  paths named as text fixed by hand, the runner release file's path in the release tooling.
- **B. The splits and the directions**: `app/state`, `app/effects` and what leaves `app/` for
  `shared/` and `server/`; the single secret-name rule; `ui/ink`; `server/install`.
- **C. The end**: the layering test, an independent review of the whole diff, the checks, docs.

## Risks

- A path named as text that no test opens: searched for by a script over every tracked file.
- The release tooling writes its file's path into sentences and release notes: its tests pin
  those sentences and are updated with them. Tags already published keep the old path in their
  own commits; `release.ts` reads the path from the commit it runs in.
- A split that changes behaviour by accident: every existing test must pass unchanged, and the
  reviewer reads each split as moved text.
