# Review: Code in folders (feature 007)

An independent review of the claim that this change moves code and changes nothing the code
does. Reviewed on 2026-11-15. The reviewer did not write the change. Nothing in the repository was
changed by the review except this file.

## 1. Scope and method

**Commits.** Everything between `dev` (7d4c66e) and `HEAD` (29af7c4) on `007-code-in-folders`:
11 commits, dc50206 to 29af7c4, including the merge 900eca6. 250 files changed. The review read
the total diff `git diff -M dev HEAD`, not the commit messages.

**How moved text was compared.** Both trees were exported with `git archive` into a scratch
folder outside the repository.

- For each split, the old file (plus the files that gave it types, where types moved too) was
  compared with the union of the new files as multisets of trimmed lines. Every line on one side
  only was read. Imports, export keywords and comments were then set aside, and every remaining
  line was traced to its new or old place.
- Order was checked with a second script: for every pair of consecutive code lines in a new file,
  the same pair must be consecutive somewhere in the old file. Each break was read. All breaks fall
  at top-level boundaries or at a renamed variable (`closed` to `context.closed`, `known` to
  `context.known`, `connect` to `servers.connect`, and so on).
- The same multiset comparison was run over the whole of `apps/cli/src`, `apps/runner/src`,
  `packages/core/src` and `apps/runner/scripts`, dev against HEAD, to catch a change outside the
  splits. Every remaining line is accounted for below.
- Every renamed or modified file outside the splits was read hunk by hunk, with import lines set
  aside (`git diff -M dev HEAD`).

**What was run.**

- `tsc --noEmit` in `apps/cli`, `apps/runner` and `packages/core`: no errors.
- CLI test files, one at a time: `test/layers/layers.test.ts` (14 pass),
  `test/server/install/*.test.ts` (87 pass in all), `test/server/check-script.test.ts` (28),
  `test/app/app-state.test.ts` (61), `test/app/app-effects.test.ts` (14),
  `test/ui/ink/questions.test.tsx` (34), `test/asking/asking.test.ts` (27),
  `test/asking/first-deploy.test.ts` (29), `test/ops/doctor.test.ts` (24),
  `test/plain/plain-unchanged.test.ts` (6), `test/version/version.test.ts` (15),
  `test/compiled/compiled.test.ts` (6, builds zekno into a temporary folder). No failure.
- The old `test/install.test.ts` at `dev`, in the scratch copy: 87 pass, the same count as the five
  files it became.
- The runner's whole suite: 147 pass, 1 skip. The core's whole suite: 102 pass.
- Throwaway probes in the scratch folder: the bytes of both fixed scripts; the old and new
  secret-name rules over 1191 inputs; the core's exports at runtime on both trees; eight attempted
  breaches of the layering test in a copy of `apps/cli/src`; the transitive import closure of every
  folder of `apps/cli/src`; `release.ts check` for the tag `runner-v0.1.0` in a local clone.

The whole CLI suite was not run (another process was running it). The agent end-to-end tests
were not run.

## 2. Findings

No change of behaviour was found: nothing signed, sealed, sent, checked, asked or drawn differs.
The findings are about the new layering test, the release tooling's handling of old tags, and
claims in the spec.

### R1. The layering test lets some breaches through

- **Kind:** a claim that is false. FR-007 says the directions are "checked by a test", and the
  commit says they are "checked on every import". Some imports are not checked.
- **Where:** `apps/cli/test/layers/layers.test.ts`, lines 66-69 (only `.ts` and `.tsx` files are
  read), line 82 (a specifier that does not start with `.` is skipped), lines 107-125 (no rule
  names `cli/`), lines 220-224 (only `import(` followed by a quote is counted).
- **Evidence.** In a copy of `apps/cli/src` and the test, outside the repository, each breach was
  added alone and the test run:

  | Breach | Result |
  |--------|--------|
  | `server/batch.ts` imports `update` from `../app/state/state` (sanity) | caught |
  | `server/batch.ts` imports `run` from `../cli/cli`, which imports `commands/`, `asking/` and `ops/` | **passes** |
  | `cli/context.ts` re-exports `prepareDeploy` from `../ops/deploy`, and `ui/parts/panel.tsx` imports it from `../../cli/context` (an ops value in ui/) | **passes** |
  | `ui/parts/panel.tsx`: `const where = "../../app/state/state"; import(where)` | **passes** |
  | `ui/parts/panel.tsx`: `require(there)` with a variable | **passes** |
  | `ui/parts/panel.tsx` imports `./bridge.js`, a `.js` file that re-exports from `app/` | **passes** |
  | `ui/parts/panel.tsx`: `require("../../app/state/state")` with a literal | caught |
  | `` import(`../../app/state/${n}`) `` | caught (the count of `import(` differs) |
  | `ops/init.ts`: `export type { Ui } from "../ui/types"` | caught |

  The first two passes come from the plan itself: `cli/` is in none of rules 1 to 4, so a folder
  of rule 3 may import `cli/cli.ts` and reach every folder rule 3 forbids, and `cli/context.ts`
  can pass on anything. A non-relative alias (a tsconfig `paths` entry, or package.json
  `imports`) would also be skipped; none exists today, so that one was not tried.
- **Today's tree:** a walk of every file's value imports, followed to the end, found no folder that
  reaches a forbidden folder, except `ops/doctor.ts -> version/version.ts -> ui/types.ts`. Rule 3
  allows `version/` to import `ui/types.ts`, and `ui/types.ts` imports types only, so that path is
  harmless.
- **Confirmed by running:** yes, in the scratch copy.
- **Smallest fix:** give `cli/` a rule (for example: rule-3 folders may take only `cli/context.ts`
  and `cli/errors.ts` from `cli/`, and those two import only rule-3 folders and `ui/types.ts`);
  fail on any file in `src` that is not `.ts`, `.tsx` or `.json`; fail on any `import(` or
  `require(` whose argument is not a plain string literal; fail on any specifier that is neither
  relative nor a package named in package.json.

### R2. HEAD's `release.ts check` refuses an older prod tag, with a misleading sentence

- **Kind:** untidy but harmless.
- **Where:** `apps/runner/scripts/release.ts`, lines 131-137, with `RUNNER_RELEASE` from
  `apps/runner/scripts/release-lib.ts`, line 23.
- **Evidence:** in a local clone checked out at `runner-v0.1.0` (whose commit holds the file at
  `apps/cli/src/runner-release.json`), HEAD's script printed
  `apps/cli/src/version/runner-release.json names undefined, which is not a runner version. A
  commit on main must not carry one.` and exited 1. The tag's own `release.ts` printed the four
  lines and exited 0. The workflow checks out the tag and runs the tag's own script, so a re-run
  of the workflow for an old tag works, as plan.md says. Only a person running today's script
  against an old prod tag meets the refusal. It fails closed.
- **Other cases, read from the code:** `release.ts files` does not read the file; it writes
  release notes that name the new path. `second-build.ts` reads and writes the file in the
  current checkout, never in the tag's commit (lines 175-182, 321), and checks the downloaded notes
  only for the version and commit (`notesNames`), so an old release's notes still pass step 13.
  Run on a checkout of the new layout for an old tag, it works; the notes it hands to
  `gh release edit` then name the new path, which is where the checkout that records it holds the
  file. Run from today's script on a checkout of the old layout, `readFileSync` fails and it stops
  with status 3 and "Nothing was compared, and nothing was recorded."
- **Confirmed by running:** the `check` case, yes. The rest by reading.
- **Smallest fix:** none is needed. If wanted, `check` could say that the file is missing at that
  commit instead of "names undefined".

### R3. Three expectations were removed, not two, and FR-003 says expectations are unchanged

- **Kind:** a claim in the spec that is false (harmless).
- **Where and evidence:** removed whole: `apps/cli/test/ops/doctor.test.ts` "each connection's
  limit is the app's 20 seconds" (dev line 188) and `apps/cli/test/asking/first-deploy.test.ts`
  "the runner's size and what is said of a runner found are the app's add-server screen's words"
  (dev line 208). Removed from a kept test: `apps/cli/test/asking/asking.test.ts`, the test once
  named "A3, and the read limit is the app's own" is now "A3" (line 127), without
  `expect(ASKING_LIMIT_MS).toBe(READ_LIMIT_MS)`.
- **Effect:** none of the three weakens a protection: each compared a copy with its original, and
  the copies are gone. No test pins the value of `READ_LIMIT_MS` (20 seconds); none did on `dev`
  either. Every other changed test line is a path named as text.
- **Confirmed by running:** read from `git diff -M dev HEAD -- '*test*'`.
- **Smallest fix:** say in results.md that three equality expectations went with the copies.

### R4. Two files are longer than about 500 lines with no reason at their top

- **Kind:** a claim in the spec that is false (harmless). Acceptance scenario 3 says no file a
  person has to read is longer than about 500 lines without a reason written at its top.
- **Where:** `apps/cli/src/app/screens/home.tsx`, 673 lines (669 on `dev`), with no header
  comment at all; `apps/cli/src/project/project.ts`, 665 lines (665 on `dev`), whose header says
  what the file does but not why it is long. Every other file under the three `src` folders is
  under 500 lines.
- **Confirmed by running:** `wc -l`.
- **Smallest fix:** a line at the top of each saying why it stays one file, or a split in a later
  feature.

### R5. The core still writes the secret-name pattern inline twice

- **Kind:** a claim in the spec that is partly false (harmless, and older than this change).
  FR-008 says "A rule that exists twice MUST exist once: the secret-name rule is the core's."
- **Where:** `packages/core/src/deploy/deploy.ts`, line 107
  (`/^[a-z0-9][a-z0-9-]{0,62}\/[A-Za-z_][A-Za-z0-9_]*$/`, no length limit) and
  `packages/core/src/protocol/protocol.ts`, line 179 (the same with `{0,127}`), the keys
  `app/NAME` of the runner's state and status. Both are on `dev` as they are now. The app's own
  copy, which this change removed, was the one FR-008 was written for.
- **Smallest fix:** word FR-008 as "the app's copy of the secret-name rule is removed", or build
  those two keys from `SECRET_NAME` in a later feature.

## 3. Checked and found the same

- **The reducer split** (`dev:apps/cli/src/app/state.ts`, 1309 lines, against `app/state/*`, plus
  the types that went to `shared/views.ts`, `shared/deploy.ts` and `shared/notice.ts`). Every code
  line is present on both sides. The new lines are signatures and calls of extracted functions:
  each `case` body of `onTextQuestion` and `update` became a function called from the same `case`
  with the same arguments, and the `deploy` and `add-server` keys of `onKey` became `onDeploy` and
  `onAddServer`, which return `undefined` exactly where the old code left `step` undefined. The
  hidden prompt (`onHiddenPrompt`, `textQuestionOpen`, `hiddenPromptOpen`, `promptedName`) and the
  questions (`onQuestion`, `skipValues`, `CHOICES`, the Esc-is-no rule, `askDeployElsewhere`) are
  the same text in the same order, read line by line.
- **The effects split** (`dev:apps/cli/src/app/effects.ts`, 1177 lines, against `app/effects/*`).
  Every code line is present. Each `let` of `createEffects` that more than one concern needs
  became a field of the one `context` object: `closed` and `known`. Every read of them is
  `context.closed` or `context.known` at the moment of use; no file copies either out of the
  context (`grep` of every destructuring of `context`). `remember` writes `context.known` through
  the object, so a destructured `remember` still updates it. `deploying`, `waiting`,
  `linkSkipped`, `adding`, `following`, `updating` and the session maps stay closure variables of
  one factory each, made once per `createEffects`. `close()` still sets `closed`, then stops the
  logs, then closes the sessions. The checks before a deploy is signed (`composeOf`, `plan`,
  `goOn`, `deploy`) and `useLink` are the same text in the same order.
- **The installer split** (`dev:apps/cli/src/install.ts`, 844 lines, against `server/install/*`).
  No code line differs, only comments and imports. Every import names the same module as before.
  No order break inside a function. `runInstaller` and the word checks (`installWords`,
  `isInstallPath`, `RUNNER_PATH` from `server/transport.ts` as before) are unchanged.
- **The terminal interface split** (`dev:apps/cli/src/ui/ink.tsx`, 932 lines, with the moved
  `deploy-view.tsx` and `questions.tsx`, against `ui/ink/*`). The only new code is `rawMode()` and
  `liveDeploy()`, which wrap moved lines. `rawMode(input, store)` is now called before `render`;
  it only defines closures and one `let`, so nothing happens earlier. `asking` still turns raw mode
  on, then discards typed-ahead keys, then draws the question, and turns raw mode off only when
  nothing holds it. `keepAfter`, `showQuestion`, `release`, `interrupt`, `HOLD_MS` (2000),
  `HeldInput`, `SecretPrompt`, `ValuePrompt` (Esc skips, Ctrl-C leaves) and `QuestionPrompt` are
  the same text.
- **The fixed scripts.** `INSTALL_SCRIPT` and `CHECK_SCRIPT` were cut out of the `dev` and `HEAD`
  sources as text and evaluated as `String.raw` templates: install 8810 bytes, SHA-256
  `46bbf2f7…f548`, on both; check 1436 bytes, SHA-256 `88e6eb86…69c1`, on both. Importing the
  modules at HEAD gives the same two hashes. The pinned length and hash in
  `test/server/install/script.test.ts` are the lines of `dev:apps/cli/test/install.test.ts`,
  unchanged. `test/server/check-script.test.ts` changed in its imports only.
- **Batch-mode SSH** (`server/batch.ts` against `dev:apps/cli/src/app/hand-over.ts`).
  `batchOnly` (`batch: true`, `errorLines: recording(lines, undefined)`), `recording`,
  `KEPT_LINES` (64), `DENIED`, `HOST_KEY` and the last-line rule are moved text.
  `hand-over.ts` now calls `wouldHaveAsked`, which on `dev` was already `saysWouldAsk` under
  another name. The options SSH is given are built in `server/transport.ts`, whose code did not
  change.
- **The single copies.** On `dev`, `READ_LIMIT_MS` (app), `ASKING_LIMIT_MS` (asking) and
  `DOCTOR_LIMIT_MS` (doctor) were all `20_000`. The two `megabytes` were the same text. `foundDetail`
  in the app and `runnerFoundDetail` in the first deploy were the same text, with
  `RUNNER_PROTOCOL` from the core in both; the one left in `ops/server.ts` is that text.
  `appTaken` and `writeStandardError` were moved, not copied.
- **No Ink before `DEV` is gone.** The walk of `main.ts`'s static imports in
  `test/asking/asking.test.ts` passes, so `server/batch.ts`, `shared/sizes.ts` and
  `ops/server.ts`, which now hold the single copies, bring no Ink or React. `main.ts` now loads
  `app/effects/profile` instead of `app/effects`, still inside `withoutDev`.
- **The secret-name rule.** `dev`: `/^[A-Za-z_][A-Za-z0-9_]{0,127}$/`. HEAD: the core's
  `/^[A-Za-z_][A-Za-z0-9_]*$/` and `name.length > 128`. Both allow 1 to 128 ASCII letters, digits
  and underscores, not starting with a digit. In JavaScript without the `m` flag `$` matches only at
  the very end, so neither takes a final newline; and `secretNameProblem` is given a trimmed name
  anyway. The rule has no `g` or `y` flag, so the shared `RegExp` keeps no state between calls. A
  probe called HEAD's `secretNameProblem` and the `dev` rule on 1191 inputs (empty, lengths 120 to
  136 including 128 and 129, leading digits, trailing `\n` and `\r`, NUL, spaces, `é`, `İ`, fullwidth
  letters, zero-width characters, emoji, the reserved names, every string of up to three
  characters from an alphabet of edge cases): no input was answered differently.
- **The core's public interface.** At runtime both `index.ts` export the same 80 values. As text
  both have the same 133 export names, types included. Only the module paths after `from`
  changed. Every other changed line in `packages/core/src` and `apps/runner/src` is an import path
  to the same moved module, and `session/session.ts` reads `../../package.json`, the same file.
- **The release tooling.** `RUNNER_RELEASE` in `release-lib.ts`, the release notes text, and every
  sentence of `release.ts` and `second-build.ts` use the one constant. No file outside the earlier
  features' specs names the old path (`git grep`); four comments name the bare file name. The tests
  pin the new sentences. `RELEASING.md`, the READMEs and `apps/web/content/docs/cli.mdx` name the
  new path. `.github/workflows/main-versions.yml` and `runner-release.yml` changed in two comment
  lines only. Old tags: see R2.
- **Things a move can break.** `apps/cli/build.ts` points the devtools stub at
  `src/ui/ink/devtools-stub.ts`, which exists; the compiled test builds and runs zekno. The `bin`
  entries and package scripts name `src/main.ts`, which did not move. No `tsconfig.json`,
  `package.json`, `turbo.json` or `.gitignore` changed. The only `import.meta.dir` path in source
  is in `main.ts`, which did not move. Every dynamic `import()` and every path built from
  `import.meta.dir` in source, tests and `tests/support/` names a file that exists, and `tsc`
  checks the dynamic import literals. `git ls-files -ci --exclude-standard` lists only `AGENTS.md`
  and `CLAUDE.md`, as on `dev`; no source or test file is ignored, tracked or not. No untracked
  file, no file left at an old place, no empty folder. Each `src` holds one file and folders.
- **Tests.** Apart from R3, every changed test line is an import or a path named as text
  (`../../build.ts`, `../support/flood.ts`, `cli/cli.ts` in `version.test.ts`, the release file's
  path in the runner's release tests). The installer's tests are the old file split in five, 87
  runs before and after. Test declarations in the CLI: 816 on `dev`, 823 at HEAD (minus 2
  removed, plus 9 in `layers.test.ts`); runner 142 and core 102 on both.
  `apps/cli/test/plain/plain-at-head.ts` is the same blob (5c7b3b1) on both, SHA-256
  `b72ccdb6…961d`. The transcripts were not edited.
- **The layering test, what it does catch.** Static, type-only and literal dynamic imports and
  literal `require` between the folders of plan.md, an import that lands on no file, and
  `typeof import(…)`. Its own checker test holds `scanImports`' treatment of type-only imports.

## 4. Not checked

- The whole CLI suite (another process was running it) and lint.
- The agent end-to-end tests and whether they replay from their cache (not to be run).
- Raw mode at a real terminal. The review relies on the text being the same and on the existing
  tests.
- The wording of the READMEs and the docs page beyond the paths they name.
- A run of the second build. Its behaviour for old tags is read from the code (R2).
- Running the tag's own `release.ts` in the clone, which has no `node_modules`, started Bun's
  automatic install. It found the packages it needed; the review cannot say whether that used only
  Bun's cache or also reached the package registry.

## 5. After the review: what was done

Written by the implementer of T015 and T016, not by the reviewer, after the review above. The
reviewer's text above is unchanged.

**R1, the layering test.** `apps/cli/test/layers/layers.test.ts` now also holds rule 6 of plan.md
and refuses what let the five passes through. Made with T016, in the commit that adds this part.

- Rule 6, on every import: `cli/cli.ts` is imported by `main.ts` only; every file of `cli/` but
  `cli/cli.ts` (today `cli/context.ts` and `cli/errors.ts`) imports nothing from `ops/`,
  `commands/`, `asking/` or `app/`, and from `ui/` only `ui/types.ts`; `cli/` holds exactly those
  three files; and none of its files but `cli/cli.ts` re-exports from another folder of `src`,
  whether written `export … from "…"` (a list, `*` or `* as name`, `type` or not) or as an
  imported name listed again in an `export { … }`. The code as it stands breaks none of this: no
  exception was named.
- Every file of `apps/cli/src` is `.ts` or `.tsx`, or a data file the test names
  (`version/runner-release.json`, and `apps/cli/package.json`, which `version/version.ts`
  imports); every import lands on such a file; an import that lands outside `src` on code is
  refused, since the imports of that file are not read.
- Every `import(…)` and `require(…)` has a plain string as its argument, read in the text Bun's
  transpiler gives back without comments and types.
- Every import that is not relative is a `node:` or `bun` built-in, or a package that
  `apps/cli/package.json` names in `dependencies`, read from that file; a subpath
  (`react/jsx-dev-runtime`) counts as its package.
- The test's own self-test runs each check over made-up input, with one case for each of the five
  passes in the table of R1, and each is caught. Each of the five was also added alone to a copy
  of `apps/cli/src` outside the repository, and the test then failed: (1) `server/batch.ts`
  importing `run` from `../cli/cli` fails "cli/cli.ts is imported by main.ts only"; (2)
  `cli/context.ts` re-exporting `prepareDeploy` from `../ops/deploy`, imported by
  `ui/parts/panel.tsx` from `../../cli/context`, fails the second rule 6 test and the re-export
  test; (3) `import(where)` and (4) `require(there)` fail the plain-string test; (5) `./bridge.js`
  fails the test of files and of where imports land, also when nothing imports it. The test has 22
  tests, 14 before.

**R4, two long files.** Both were split by subject, as moved text (T015). Comparing the trimmed
lines of each old file with the union of its new files, the only lines on one side are imports,
the new files' opening comments, and the word `export` added to what another new file now uses.

- `apps/cli/src/project/project.ts` (665 lines), commit 9a6e201: `file.ts` (the file's name, form,
  and how it is found and read, 284 lines), `signed.ts` (who signed it and how it stands here, 57),
  `project.ts` (the first-use question and `withProject`, 221, with the opening comment of the old
  file), `write.ts` (`composeFor`, `projectText`, `writeProject`, 127), `shown.ts` (`tilde`,
  `shownPath`, 13). The checks run in the same order, under the same conditions, from the same
  text.
- `apps/cli/src/app/screens/home.tsx` (673 lines), commit fd37244: `app/screens/home/`, with
  `home.tsx` (`HomeScreen`, 119), `widths.ts`, `servers.tsx`, `apps.tsx`, `details.tsx`,
  `hints.ts`, `update.tsx` and `rows.ts`, each under 200 lines.

No file of `apps/cli/src`, `apps/runner/src` or `packages/core/src` is now longer than 450 lines
but `apps/cli/src/ops/doctor.ts`, 480 lines.

**R2.** No change, the workflow runs the tag's own script. Recorded by the orchestrator in spec.md.

**R3.** FR-003 now states it. Recorded by the orchestrator in spec.md.

**R5.** FR-008 now states it. Recorded by the orchestrator in spec.md.
