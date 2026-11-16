# Results: lint and format

Checked on 2026-11-16, on Bun 1.4.4, from the repository root, without the cache.

| Command | Result |
|---|---|
| `bun run typecheck --force` | 5 of 5 pass |
| `bun run lint --force` | 5 of 5 pass: `apps/cli`, `apps/runner` and `packages/core` with `--max-warnings 0`; `apps/web` (60 files read) and `packages/ui` (11 files read) with no finding |
| `prettier --check` in the three packages | all files formatted |
| `bun run test --force` | core 102 pass; runner 147 pass, 1 skipped (the real build); CLI 936 pass; web 28 pass; 0 fail. The same totals as before this feature |
| `bun run compile` in `apps/cli` | built; `./dist/zekno --version` prints `zekno 0.1.0` and `runner 0.1.0, the runner release this zekno installs` |
| `bun run test:e2e` in `apps/cli` | 11 of 11 pass, all 12 goals replayed from the cache, no model call |
| `bun run build` | not run: it would run `next build`, which the maintainer's rule forbids in these sessions |

- A scratch file with an unused constant and an `any` made `bun run lint` fail in `apps/cli`
  with both named; it was removed.
- `apps/cli/test/plain/plain-at-head.ts` is unchanged.
- The installer's and the doctor's scripts are template text, which Prettier does not touch;
  the tests that pin their SHA-256 pass.
- Dependencies: `typescript-eslint` ^8.72.2 added to `packages/eslint-config`; `@babel/core`,
  `@babel/eslint-parser` and `@babel/preset-typescript` removed from it. `eslint` and
  `@workspace/eslint-config` are named as dev dependencies of the three packages (both were in
  the repository already).
