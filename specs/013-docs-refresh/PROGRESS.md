# Progress: feature 013, README and docs refresh

Kept by the cloud session that carries on from `HANDOFF.md`. Written for a reader who saw nothing.

## Starting numbers (2026-11-18, before any change)

Branch `013-docs-refresh` at `352ed2f`. Bun 1.4.4 was already installed in this environment; `bun install` changed no tracked file.

| Check | Result |
|---|---|
| `bun run typecheck --force` | passes (5 of 5 tasks) |
| `bun run lint --force` | passes (5 of 5 tasks) |
| `bun run test --force` | fails: web 32 pass; core 102 pass; runner 144 pass, 2 skip, 2 fail; cli (run alone, `bun test` in `apps/cli`) 2092 pass, 9 skip, 67 fail, across 106 files |
| `bunx prettier --check "**/*.{ts,tsx}"` in `apps/cli` | passes |

**The failures that were already there, and why.** This environment runs every command as `root`. The runner keeps its key and state in `/var/lib/zekno` when it runs as root and nothing sets `ZEKNO_RUNNER_HOME` (`apps/runner/src/home/home.ts`, `defaultHome`). The CLI's stand-in server does not set it, so under root every stand-in runner of every test shares `/var/lib/zekno`: the first test that sets one up claims it, and the next ones are refused with "The runner on that server already belongs to a team", or read their state from the wrong folder. That accounts for the stand-in-SSH tests among the 67 (first deploy, `server add`, doctor, the app's add-server screen, ...); the rest are tests that make a folder read-only, which root can still write. On the maintainer's computer (not root) they pass. The two runner failures (`release.test.ts` gzip check, the compiled runner's `.env` check) are of the same kind or the known noise of `HANDOFF.md`. `/var/lib/zekno` is removed after each run here, since the tests left it behind.

These numbers are the baseline: a failure is new only if it is not in this list.

## Parts

| Part | Tasks | State |
|---|---|---|
| A, the screens | T003, T005 to T013 | open |
| B, the frame | T001, T004, T014, T015 | open |
| C, the split | T016 to T024 | open |
| D, the new pages | T025 to T028 | open |
| E, the READMEs | T029 to T036 | open |
| F, the end | T037 to T040 | open |

T002 is done: the old pages are kept outside the repository for the comparisons (from `9ad84d3`, since GitHub's `dev` does not hold that commit).

## Needs the maintainer

Nothing yet.
