# Lint and format for the CLI, the runner and the core

**Branch**: `009-lint-format` | **Date**: 2026-11-16
**Asked for by the maintainer** on 2026-11-16 ("then do the lint and format"), after the
assessment of 2026-11-15 found that only the website and the component package had either.

A compact record: this feature adds tooling and changes no behaviour, so it has no contracts or
data model. The existing tests are its acceptance tests.

## What the maintainer chose

1. **ESLint and Prettier**, the tools the repository already had, not a second linter or
   formatter.
2. **80 columns**, the root Prettier settings unchanged, for every package.
3. **typescript-eslint**, one new dev dependency, after the finding below. Asked and answered
   on 2026-11-16.
4. **The website and the component package are linted for real too**, report only: their
   findings stay warnings that do not fail, and no code of theirs is changed without asking.

## What was found

The repository's ESLint setup had never read a TypeScript file:

- ESLint reads only JavaScript files unless a config names others, and the shared config
  (`packages/eslint-config/base.js`) named none. `bun run lint` read 2 files in `apps/web` and 2
  in `packages/ui`: their own config files.
- Pointed at TypeScript, that config could not read it. Its parser (Babel) failed on the JSX of
  45 files of the CLI, and it does not understand types: about 1,800 false findings such as
  `'kind' is not defined` for a field of a type.

So principle VII of the constitution ("`bun run lint` MUST pass") had been passing with nothing
checked.

## What was done

- **Format.** `bun run format` in `apps/cli`, `apps/runner` and `packages/core`, as in the two
  packages that had it. One commit reformats 243 files and nothing else
  (`.git-blame-ignore-revs` names it). The recorded transcripts
  `apps/cli/test/plain/plain-at-head.ts` are never rewritten: `apps/cli/.prettierignore`.
- **Lint.** `packages/eslint-config/base.js` reads TypeScript with typescript-eslint's parser
  and its recommended rules; the Babel parser and its three packages are removed. A new
  `packages/eslint-config/node.js` is the config for code that runs on Bun or Node.
  `bun run lint` in the three packages is `eslint --max-warnings 0`, so any finding fails.
- **Rules set, each with its reason in the config:**
  - `@typescript-eslint/no-unused-vars` with `ignoreRestSiblings`: taking one field out of an
    object to keep the rest is not an unused variable.
  - `prefer-const` with `ignoreReadBeforeAssign`: a variable a callback reads before it is
    given its one value cannot be a const.
  - In `node.js` only: `turbo/no-undeclared-env-vars` off (these programs read their
    environment when they run; the rule is about cached builds), and `no-control-regex` off
    (cleaning control characters out of what a server sends is this code's job).
- **Findings fixed** (78 in the three packages before the rules above; 20 after):
  two values assigned and never read (`apps/cli/src/commands/doctor.ts`,
  `apps/cli/src/asking/first-deploy.ts`: the first assignment is removed, the declared type
  kept), six unused names in tests, two statements written as comma expressions in the
  end-to-end support files (now blocks), one error that dropped its cause in the same files,
  and two `any` in test helpers that tamper with JSON files, kept with a reason beside each.
- **The website and the component package**: ESLint now reads 60 and 11 files there. It found
  nothing.

## How it was checked

- **Formatting changed no code.** Each of the 257 `.ts` and `.tsx` files was compiled with
  Bun's transpiler before and after, whitespace set aside. 255 give the same JavaScript. The
  other two (`app/screens/deploy.tsx`, `ui/ink/deploy-view.tsx`) differ in one JSX sentence now
  given as two pieces of the same text (`"…will be "` became `"…will be"` and `" "`), which Ink
  draws as the same line; the screen tests hold it.
- **Lint fails on a fault.** A scratch file with an unused constant and an `any` made
  `bun run lint` fail in `apps/cli`; it was removed.
- The results are in [results.md](./results.md).

## Not done

- No lint or format step runs on GitHub: the repository has no workflow for tests either. It
  is a separate choice.
- `turbo.json` does not list the environment variables tests read, so a cached test result
  does not depend on them. Checks in these sessions run without the cache (`--force`).
