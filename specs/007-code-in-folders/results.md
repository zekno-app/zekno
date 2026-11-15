# Results: Code in folders

Checked on 2026-11-15, on Bun 1.4.4, from the repository root, without the cache.

## What the tree looks like

- `apps/cli/src`: `main.ts` and 12 folders (`app`, `asking`, `cli`, `commands`, `ops`, `profile`,
  `project`, `secrets`, `server`, `shared`, `ui`, `version`).
- `apps/runner/src`: `main.ts` and 4 folders (`commands`, `docker`, `home`, `session`).
- `packages/core/src`: `index.ts` and 5 folders (`crypto`, `deploy`, `protocol`, `secrets`, `team`).
- The longest source file is `apps/cli/src/ops/doctor.ts`, 480 lines. Before this feature the
  longest were 1,309, 1,177, 932, 844, 673 and 665 lines.

| Was one file | Now |
|---|---|
| `app/state.ts`, 1,309 lines | 15 files in `app/state/`, the longest 230 |
| `app/effects.ts`, 1,177 | 11 files in `app/effects/`, the longest 362 |
| `ui/ink.tsx`, 932 | 12 new files in `ui/ink/`; `ink.tsx` is 252 |
| `install.ts`, 844 | 5 files in `server/install/`, the longest 333 (the script itself) |
| `app/screens/home.tsx`, 673 | 8 files in `app/screens/home/`, the longest 191 |
| `project.ts`, 665 | 5 files in `project/`, the longest 284 |

## Checks at the end (commit `8ba4536`, then the layering test's last change)

| Command | Result |
|---|---|
| `bun run typecheck --force` | 5 of 5 pass |
| `bun run lint --force` | 2 of 2 pass (`apps/web` and `packages/ui` only; the CLI, the runner and the core have no lint task) |
| `bun run test --force` | core 102 pass; runner 147 pass, 1 skipped (the real build); CLI 916 pass; web 28 pass; 0 fail |
| `bun test test/layers` in `apps/cli`, after the answer to review R6 | 24 pass (2 more than in the run above, so the CLI has 918 tests) |
| `bun run compile` in `apps/cli` | built; `./dist/zekno --version` prints `zekno 0.1.0` and `runner 0.1.0, the runner release this zekno installs` |
| `bun run test:e2e` in `apps/cli` | 11 of 11 pass, all 12 goals replayed from the cache, no model call |
| `bun run build` | not run: it would run `next build`, which the maintainer's rule forbids in these sessions |

Before this feature: core 102, runner 147 (1 skipped), CLI 896, web 28. The CLI's count moved by
the tests of the layering (24 added) and the two tests that held copies equal (removed with the
copies; spec FR-003).

## What was compared, beyond the tests

- The independent review ([review.md](./review.md)) compared each split line by line with the
  file it came from, in two passes, and found no change in behaviour.
- `INSTALL_SCRIPT` (8,810 bytes, SHA-256 `46bbf2f7…f548`) and `CHECK_SCRIPT` (1,436 bytes,
  `88e6eb86…69c1`) are byte for byte what they were, and the pinned values in their tests did
  not change.
- `packages/core/src/index.ts` exports the same 133 names.
- `apps/cli/test/plain/plain-at-head.ts` is unchanged.
- The old and the new terminal interface, driven with the same calls at 40 and 100 columns,
  gave the same bytes and the same sequence of raw-mode changes.

## Not checked

A real server; a real terminal by hand (the splits were compared as text and through the
pseudo-terminal tests); the specs of earlier features, which keep the paths that were true when
they were written.
