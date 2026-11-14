# Tasks: Runner Releases

**Input**: Design documents from `/specs/005-runner-release/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (release.md, second-build.md, versions.md), quickstart.md

**Tests**: included. The constitution requires unit tests for logic with branches (Principle VII), and the decisions require the installer's stand-in tests in both shells, the release script tested against a local stand-in release, and the workflow's logic in a tested script.

**Organization**: grouped by user story. Paths are relative to the repository root. Within a phase, write the test task first and see it fail.

**Before you start**: read research.md, "Open questions for the maintainer". These tasks depend on answers there: T002 (Q5); T016 and T030 (Q2, Q3, Q6); T019, T021 to T024 and T027 (Q4, the wording); T035 (Q10). Where no answer has come, follow the recommended answer and say so in the commit, except Q4: T023 and T024 wait for the maintainer's approval of the wording.

**The version grammar**, used everywhere below (contracts/release.md):

```text
^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-dev\.[1-9][0-9]{0,8})?$
```

Order: the three numbers as numbers; with the same three numbers a dev version is older than the plain one; two dev versions by their count. The ordered list used by several tests: `0.0.9 < 0.1.0-dev.1 < 0.1.0-dev.2 < 0.1.0-dev.10 < 0.1.0 < 0.1.1-dev.1 < 0.1.1 < 0.2.0 < 0.10.0 < 1.0.0-dev.1 < 1.0.0`. The refused list: `0.1`, `0.1.0.1`, `01.1.0`, `0.01.0`, `0.1.00`, `0.1.0-dev`, `0.1.0-dev.0`, `0.1.0-dev.01`, `0.1.0-dev.1.2`, `0.1.0-rc.1`, `0.1.0-DEV.1`, `0.1.0+1`, `v0.1.0`, `1000000000.0.0`, `0.1.0-dev.1000000000`, the empty string, `0.1.0 ` (a trailing space), `0.1.0\n`.

## Phase 1: Setup

- [X] T001 [P] Add `"scripts"` to `include` in apps/runner/tsconfig.json (it becomes `["src", "test", "scripts"]`) so `bun run typecheck` covers the release scripts
- [X] T002 [P] Set the three compile scripts in apps/runner/package.json exactly as contracts/release.md, "apps/runner/package.json scripts": `compile:linux-x64` uses `--target=bun-linux-x64-baseline`, `compile:linux-arm64` keeps `--target=bun-linux-arm64`, and `compile`, `compile:linux-x64` and `compile:linux-arm64` all add `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (leave the two flags out only if the maintainer answered no to Q5). Keep the output names `dist/zekno-runner`, `dist/zekno-runner-linux-x64`, `dist/zekno-runner-linux-arm64`. Do not change `version` here (T008)

---

## Phase 2: Foundational (the rename and the widened version format)

**Purpose**: one version grammar everywhere, and 0.1.0 in place of 0.2.0. Blocks every story.

- [X] T003 [P] Write packages/core/test/version.test.ts (it fails until T004): `RUNNER_VERSION_PATTERN` and `parseRunnerVersion` accept `0.0.0`, `0.1.0`, `1.2.3`, `10.20.30`, `999999999.0.0`, `0.1.0-dev.1`, `0.1.0-dev.12`, `1.0.0-dev.999999999` and refuse every entry of the refused list above; `parseRunnerVersion("0.1.0-dev.3")` is `{ major: 0, minor: 1, patch: 0, dev: 3 }` and of `"1.2.3"` has `dev` undefined; `compareRunnerVersions` orders the ordered list above for every pair in both directions, gives 0 for a version with itself, and throws for a refused version; `isDevVersion` is true only for valid dev versions; `RunnerVersionSchema` accepts `{ version: "0.1.0-dev.1", protocol: 2 }` and refuses `0.1.0-dev`, `0.1.0-rc.1` and `01.0.0`
- [X] T004 Create packages/core/src/version.ts with `RUNNER_VERSION_PATTERN` (the grammar above as a `RegExp`), `parseRunnerVersion`, `compareRunnerVersions` and `isDevVersion` as contracts/release.md describes, importing nothing; export them from packages/core/src/index.ts; make `RunnerVersionSchema` in packages/core/src/protocol.ts use `RUNNER_VERSION_PATTERN`; in packages/core/test/scenarios/messages.test.ts change the `0.2.0` of the three `RunnerVersionSchema` lines to `0.1.0` and keep their refusals. T003 passes
- [X] T005 Use the core grammar in the CLI: in apps/cli/src/install.ts `VERSION_PATTERN` becomes `RUNNER_VERSION_PATTERN`, and `parseInstallLine` reads `runner found (system|user|path|target) (<version>|unknown)` with the same grammar (build the expression from `RUNNER_VERSION_PATTERN.source` without its anchors); in apps/cli/src/runner-release.ts the schema's `version` uses `RUNNER_VERSION_PATTERN`; in apps/cli/src/ops/server.ts `compareVersions(a, b)` returns `compareRunnerVersions(a, b)` (T022 later replaces `isOutdated`)
- [X] T006 In `INSTALL_SCRIPT` in apps/cli/src/install.ts, rewrite `is_version`, `is_newer` and the line that reads a found runner's version, as contracts/release.md, "The installer's copy": `is_version` accepts exactly the grammar; `is_newer a b` is true exactly when `a` is newer than `b` in the order above (dev older than plain with the same three numbers, dev counts compared as numbers); the found version is read with `sed -n 's/^{"version":"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\(-dev\.[0-9][0-9]*\)\{0,1\}\)",.*$/\1/p'` and becomes `unknown` unless `is_version` accepts it. Only `case`, `expr`, `cut`, `sed` and `printf`; no `${`, no backquote, no `[[`
- [X] T007 Extend apps/cli/test/install.test.ts. In every shell of `SHELLS`: (a) each version of the refused list as the version word ends in `["connected", "fail usage"]`, and `0.1.0-dev.1` is accepted; (b) for every ordered pair `(a, b)` from the ordered list, `update` carrying `b` over a fake runner reporting `a` ends in `fail newer` exactly when `compareRunnerVersions(a, b) > 0`, so the shell's order equals the TypeScript order; (c) a runner reporting `0.1.0-dev.1` gives `runner found target 0.1.0-dev.1`, and one reporting `0.1.0-dev.0` or `1.2` gives `runner found target unknown`; (d) `update` carrying `0.1.0` replaces a `0.1.0-dev.1` runner, and carrying `0.1.0-dev.2` leaves a `0.1.0` runner with `fail newer`. Outside the shells: `installWords` accepts `0.1.0-dev.1` and throws before placing anything for each refused version; `transport.script` accepts the word `0.1.0-dev.1` (its `SCRIPT_WORD` is not changed); `parseInstallLine("runner found user 0.1.0-dev.1")` returns that version. Replace the arithmetic on `RUNNER_RELEASE.version` in the test "update: a runner newer than the one carried is never replaced" with fixed versions, so the file passes whether `runner-release.json` holds a dev or a prod version
- [X] T008 The rename (FR-016a, research R2): set `version` to `"0.1.0-dev.1"` in apps/runner/package.json and in apps/cli/src/runner-release.json (both `sha256` stay `null`). Change every other line `git grep -n "0\.2\.0" -- ':!specs/' ':!bun.lock'` prints: in apps/cli/test/ (first-run.test.tsx, app-state.test.ts, session.test.ts, single-commands.test.tsx, state-logs.test.tsx, install.test.ts, stand-in-server.ts) a carried version comes from `RUNNER_RELEASE.version` or an injected `deps.release`, a runner's own version in a stand-in becomes `0.1.0`, and comparison examples use the ordered list; apps/cli/src/commands/server.ts `outdatedWarning` with no version says W1 of contracts/versions.md; apps/cli/src/app/effects.ts `foundDetail(undefined, …)` returns `no version reported, out of date`; the question in apps/cli/src/app/screens/home.tsx shows `no version reported` in place of `from before 0.2.0`; comments in apps/cli/src/app/state.ts, apps/cli/src/install.ts and apps/cli/test/stand-in-server.ts say "a runner that does not report its version"; apps/runner/test/session.test.ts expects the reported version to match `RUNNER_VERSION_PATTERN` and to equal apps/runner/package.json; in apps/cli/README.md, apps/runner/README.md, apps/web/content/docs/cli.mdx and apps/web/content/docs/runner.mdx the example becomes `{"version":"0.1.0","protocol":2}`, "A runner older than 0.2.0 has no sessions" becomes "A runner that does not report its version has no sessions", and "It needs runner 0.2.0 or later" becomes "It needs a runner that reports its version, as every released runner does". Rename the test "the release files are those with a published checksum, and today there are none" in apps/cli/test/install.test.ts so its name holds with or without checksums. Leave specs/004-cli-app as it is (Q9). Done when that `git grep` prints nothing and `bun test` passes in packages/core, apps/runner and apps/cli

**Checkpoint**: one grammar, three installer checks widened together, 0.1.0 everywhere. Every story can start.

---

## Phase 3: User Story 2 - A release is only what the maintainers published (Priority: P1) 🎯 MVP

**Goal**: the workflow's checks in a tested script, two environments, and the second build that is the only writer of the CLI's checksums.

**Independent Test**: `bun test apps/runner/test/release.test.ts apps/runner/test/second-build.test.ts apps/runner/test/workflow.test.ts`; then quickstart.md section 3 with `ZEKNO_REAL_BUILD=1`.

### Tests for User Story 2

- [X] T009 [P] [US2] Write apps/runner/test/release.test.ts (fails until T013). A helper makes a temporary bare repository `origin` and a clone with: `package.json` (`"packageManager": "bun@1.4.4"`), `apps/runner/package.json`, `apps/cli/src/runner-release.json`; commit A on `main`, commit B on `dev` (branched from `main`), commit C on `feature` (not merged); `main` and `dev` pushed to `origin`. Cases, each through the `release.ts` command with `Bun.spawn` and its exit status and standard error checked against contracts/release.md: every valid and refused tag (refused list above, plus `runner-0.1.0`, `runner-v`); `check --tag runner-v0.1.0-dev.1` at B prints exactly the four lines `environment=dev`, `version=0.1.0-dev.1`, `commit=<B>`, `bun=1.4.4`; a dev tag at A passes (A is on `dev` too); a dev tag at C is refused with sentence 3; a prod tag at B is refused and at A passes; HEAD not the tag's commit refused with sentence 2; no `origin/dev` in the clone gives "Could not tell whether commit … is on origin/dev." with status 1; package.json of another version refused (4); no Bun pin refused (5); a prod tag whose commit's runner-release.json names `0.1.0-dev.1` refused (6); an unknown command or option gives status 2. `files` with two small stand-in binaries and `--runner` a shell script printing `{"version":"<v>","protocol":2}`: SHA256SUMS is exactly two lines `<64 hex>  zekno-runner-linux-x64` then `…arm64`, two spaces, line feeds; each `.gz` unpacks to its binary; RELEASE-NOTES.md is exactly the template for a dev and for a prod release (the dev paragraph only in dev); refused when the runner answers another version, when a binary is missing, and when one is over 256 MiB (a sparse file). `check-main`: passes with two prod versions, and names each file that holds a dev version, status 1
- [X] T010 [P] [US2] Write apps/runner/test/second-build.test.ts (fails until T016), through `secondBuild(tag, deps)` with a temporary repository and bare `origin` as in T009, `download` reading from a temporary folder of release files, and a stand-in `build` returning given bytes. Cases, each checking the exit status, the message of contracts/second-build.md, and that apps/cli/src/runner-release.json is byte for byte unchanged except on success: all match: status 0, the file written exactly (two-space JSON, keys `version`, `files`, `linux-x64`, `linux-arm64`, a final line feed), the record, commit message and notes files exactly as "The record", the printed next commands, and `origin` unchanged (nothing pushed); the downloaded x64 file one byte different: status 1, that file marked `differs`, the temporary folder kept; SHA256SUMS different from both builds: 1; this build different: 1; SHA256SUMS malformed: 1; notes naming another commit: 1; the tag on `origin` moved to another commit: 1; the commit's apps/runner/package.json of another version: 1; wrong branch, uncommitted runner-release.json, another Bun version, no local tag, a newer version already recorded: 2 each; the same version already recorded with the same checksums: 0 and unchanged; with other checksums: 1; a download that fails: 3; a build that fails: 3; no argument or a bad tag: 2
- [X] T011 [P] [US2] Write apps/runner/test/workflow.test.ts (fails until T014 and T015): parse .github/workflows/runner-release.yml and .github/workflows/main-versions.yml with `Bun.YAML.parse` and check: the release workflow runs on tags `runner-v*` only; top-level `permissions: {}`; jobs exactly `check`, `release-dev`, `release-prod`; `release-dev` and `release-prod` need `check` and run on its `environment` output being `dev` and `prod`; `environment: prod` only on `release-prod`; `--prerelease --latest=false` only in `release-dev`; `fetch-depth: 0` in `check`; `persist-credentials: false` on every checkout; every `uses:` is pinned to a 40-hex commit; no `${{` inside any `run:`; no `secrets.` anywhere; `contents: write` only on the two release jobs; `gh release view` runs before `gh release create`; main-versions runs on push and pull_request to `main` only and runs `bun apps/runner/scripts/release.ts check-main`

### Implementation for User Story 2

- [X] T012 [US2] Create apps/runner/scripts/release-lib.ts with the pure functions both scripts use: `parseTag(tag)` returning `{ version, environment }` or `undefined`; `branchOf(environment)` (`dev` or `main`); `sha256sumsText(x64, arm64)` and a strict `parseSha256sums(text)`; `releaseNotes({ version, environment, commit, bun, x64, arm64 })` producing the RELEASE-NOTES.md text of contracts/release.md exactly; `recordText(…)` producing "The record" of contracts/second-build.md exactly; `runnerReleaseJson(version, x64, arm64)`; `devVersionFiles(files)` for `check-main`. Imports only `@workspace/core` and Node built-ins
- [X] T013 [US2] Create apps/runner/scripts/release.ts with the commands `check`, `files` and `check-main` exactly as contracts/release.md: the checks in their order, their sentences on standard error, the four output lines of `check`, exit statuses 0, 1 and 2. It runs only when `import.meta.main`; `git` is started with `Bun.spawn` and an argument array, never a shell string; the runner's `version` answer is read with a 10-second limit and parsed with `RunnerVersionSchema`; `.gz` files are written with `Bun.gzipSync` at level 9 and checked to unpack to the same bytes. T009 passes
- [X] T014 [US2] Rewrite .github/workflows/runner-release.yml as contracts/release.md, "The workflow": jobs `check` (`contents: read`, `fetch-depth: 0`, reads the Bun pin, sets up Bun, `bun install --frozen-lockfile`, `release.ts check --tag "$TAG" >> "$GITHUB_OUTPUT"`), `release-dev` and `release-prod` (`contents: write`; `release-prod` with `environment: prod`), the same pinned commits of `actions/checkout` and `oven-sh/setup-bun` as today, every expression passed to a shell only through `env:`, `GH_TOKEN` only in the publish step, the `gh release view` guard, and `--prerelease --latest=false` only for dev. Update the comment at the top to point to contracts/release.md and apps/runner/RELEASING.md. T011 passes for this file
- [X] T015 [US2] Add .github/workflows/main-versions.yml as contracts/release.md, ".github/workflows/main-versions.yml": on push to `main` and pull_request into `main`, `permissions: {}`, one job with `contents: read`, the same pinned actions, `bun install --frozen-lockfile`, `bun apps/runner/scripts/release.ts check-main`. T011 passes
- [X] T016 [US2] Create apps/runner/scripts/second-build.ts as contracts/second-build.md: export `secondBuild(tag, deps)`, run it only when `import.meta.main`, exit with its status. Real `deps`: `git` through `Bun.spawn` argument arrays (`ls-remote` against `origin` is the only network call git makes); `download` with `fetch` from `https://github.com/zekno-app/zekno/releases/download/<tag>/<name>`, refusing any response whose final URL is not HTTPS, stopping at the size limits while reading; `build` that pipes `git archive --format=tar <commit>` into `tar -x -C <temporary folder>/src` (two processes, no shell), then runs `bun install --frozen-lockfile` there and `bun run compile:linux-x64` and `bun run compile:linux-arm64` in its `apps/runner`. It writes only apps/cli/src/runner-release.json (on a full match) and files in the operating system's temporary folder, and never runs `git commit`, `git push` or `gh`. The record goes to the release notes and the commit message as research Q3 recommends, unless the maintainer answered otherwise. T010 passes
- [X] T017 [US2] Add to apps/runner/test/second-build.test.ts one test that runs only when `ZEKNO_REAL_BUILD=1` is set: the real `build` of T016 run twice on `HEAD`, in two separate temporary folders, gives identical bytes for both binaries. Run it once (it needs the network for `bun install` and Bun's Linux runtimes; nothing outward) and record in specs/005-runner-release/quickstart.md, "Results": the SHA-256 of each file from each build, the sizes, and how long it took

**Checkpoint**: a release can be checked, built, published and confirmed by a second build, all proven against stand-ins.

---

## Phase 4: User Story 1 - Add a server with nothing on it (Priority: P1)

**Goal**: installing from a release works with a dev version and says what happened on every way it can stop.

**Independent Test**: `bun test apps/cli/test/install.test.ts apps/cli/test/first-run.test.tsx`; the real install is maintainer step 5.

### Tests for User Story 1

- [X] T018 [US1] Extend apps/cli/test/stand-in-server.ts with stand-in `df`, `getconf` and `ldd`, each off unless a test sets its answer, and add to apps/cli/test/install.test.ts, in every shell: no `sha256sum` and no `shasum` ends in `fail tools` and the stand-in `curl` was never called; a download that fails with `df -Pk` reporting 1000 KiB available ends in `fail space`, and with 10000000 KiB in `fail download`; a release whose runner differs from the published one by one byte (one byte of the fake runner flipped before packing, the checksum of the original given) ends in `fail checksum` with nothing installed and nothing left (SC-002); a `.gz` that unpacks to more than 256 MiB (packed zeros) ends in `fail download` with nothing left. The sentences for `tools` and `space` are those of contracts/versions.md, with "The runner that was there is still in place." in an update

### Implementation for User Story 1

- [X] T019 [US1] In `INSTALL_SCRIPT` in apps/cli/src/install.ts: look for `sha256sum` or `shasum` before downloading or reading the runner file, and stop with `fail tools` then; when the download, `gzip -t` or the unpacking fails, read the space available in the runner's folder with `df -Pk "$dir" | tail -n 1 | tr -s ' ' | cut -d ' ' -f 4` (only when `df` exists) and stop with `fail space` when it is a number under 262144, else `fail download`. In the same file add `space` to `InstallFailure` and `FAILURES`, and give `tools` and `space` the sentences of contracts/versions.md, ending "Nothing was installed." or, in an update, "The runner that was there is still in place." No `${`, no backquote. T018 passes
- [X] T020 [US1] Add to apps/cli/test/first-run.test.tsx, with `deps.release` set to `{ version: "0.1.0-dev.1", files: { "linux-x64": { sha256: <the stand-in release's> }, "linux-arm64": { sha256: null } } }`: `zekno server add prod --ssh deploy@example.test` installs from the stand-in release over one connection (`sh -s -- add 0.1.0-dev.1 release x64 <sha>`), prints `Installed the runner 0.1.0-dev.1 at ~/.local/bin/zekno-runner. It matched the checksum this zekno holds.`, and the server is in the team list; the same from the app's add-server screen through the reducer and effects; with both `sha256` `null`, it stops with `NO_RELEASE` and the profile is unchanged (FR-007)

**Checkpoint**: User Stories 1 and 2 work against stand-ins.

---

## Phase 5: User Story 4 - Bring an older runner up to date (Priority: P2)

**Goal**: older and newer runners are said as contracts/versions.md writes it, and an update never goes backwards.

**Independent Test**: `bun test apps/cli/test/first-run.test.tsx apps/cli/test/app-state.test.ts apps/cli/test/single-commands.test.tsx`.

**Needs**: the maintainer's approval of contracts/versions.md (research Q4) before T023 and T024.

### Tests for User Story 4

- [ ] T021 [US4] Tests in apps/cli/test/first-run.test.tsx and apps/cli/test/app-state.test.ts (fail until T022 to T024): `runnerRelation` for each row of contracts/versions.md, "The relation" (no sessions; older with the same and with a lower protocol; same; newer with the same and with a higher protocol; `0.1.0-dev.1` against `0.1.0` and the reverse); `zekno status` and `zekno server add` print W1 to W5, with D1 or D2 where they apply, exactly once on standard error and nothing when the relation is "same"; `foundDetail` gives `version <F>`, `version <F>, out of date`, `no version reported, out of date` and `version <F>, newer than this zekno`; Home draws `! older runner` and `! newer runner` within 16 columns at 80 by 24 and within the pane at 100 by 30; `u` opens the question only for an older runner, with the rows `on <S>` and `this zekno` and the sentence for what does not work; a newer runner gives its notice once per server per run; `zekno server update` replacing an older runner leaves every file of the runner's folder and its modes as they were, and against a newer runner changes nothing
  - Done so far (the parts that need no wording waiting for Q4): `runnerRelation` for every row and every pair of the ordered list; W1 said exactly once by `server add` and by `status` (also with `--json`), and nothing once the runner has this zekno's version; `zekno server update` keeps the runner's folder, files and modes, and against a newer runner changes nothing (all in apps/cli/test/first-run.test.tsx). Left for T023 and T024: W2 to W5 with D1 and D2, the fourth `foundDetail` (`version <F>, newer than this zekno`), `! older runner` and `! newer runner` on Home, `u` and its question's sentence by what does not work (apps/cli/test/app-state.test.ts), and the newer runner's notice once per server per run

### Implementation for User Story 4

- [X] T022 [US4] In apps/cli/src/ops/server.ts replace `isOutdated` with `runnerRelation(mode, runner, carried)` returning `{ relation: "older" | "same" | "newer", missing: "state and logs" | "some" | "nothing", newerProtocol: boolean }` by `compareRunnerVersions` and `RUNNER_PROTOCOL`, as contracts/versions.md, "The relation"; `ServerAddResult` carries the relation (keep an `outdated` boolean derived from it only where callers still need one)
- [ ] T023 [US4] In apps/cli/src/commands/server.ts and apps/cli/src/commands/status.ts replace `outdatedWarning` with one function that returns W1 to W5 and adds D1 or D2, word for word from contracts/versions.md, "Single commands"; `server add` and `status` call it for a runner reached over SSH whose relation is not "same"
- [ ] T024 [US4] The app, as contracts/versions.md, "The app": apps/cli/src/app/effects.ts (`foundDetail` with the four details, `runnerOf` carrying the relation, the line for a newer runner when a server is added, the newer notice once per server per run), apps/cli/src/app/state.ts (the server row carries `runner: { version?, relation, missing }`; `u` asks only for an older runner), apps/cli/src/app/screens/home.tsx (`! older runner` or `! newer runner` under the name; the question's rows and its sentence for what does not work). T021 passes
- [ ] T025 [US4] Add to apps/cli/test/single-commands.test.tsx (FR-021): with `deps.release.version` set to a version after the runner's own (the next one in the ordered list), a deploy to the real runner process with the stand-in Docker succeeds and `zekno status` prints W2; with a version before it, the deploy succeeds and `zekno status` prints W4
  - Done so far: both deploys succeed over the stand-in SSH, and `zekno status` warns once for the older runner, checked up to the part of its sentence that W2 keeps (`The runner on prod is version <F>, older than this zekno's <C>.`). Left for T023: the whole of W2, and W4 for the newer runner (today `status` says nothing about a newer runner)

**Checkpoint**: User Story 4 works on its own against stand-ins.

---

## Phase 6: User Story 5 - The runner starts on ordinary servers (Priority: P3)

**Goal**: the installer says what a server lacks, and the release's claims about supported servers are checked.

**Independent Test**: `bun test apps/cli/test/install.test.ts`; quickstart.md sections 4 and 5.

### Tests for User Story 5

- [X] T026 [US5] Add to apps/cli/test/install.test.ts, in every shell (fail until T027): a stand-in `getconf GNU_LIBC_VERSION` printing `glibc 2.16` ends in `fail libc` before any download (the stand-in `curl` never called); printing `glibc 2.17` or `glibc 2.39` goes on; with no `getconf` answer and a stand-in `ldd --version` writing `musl libc (x86_64)` on standard error, `fail libc` before any download; neither answering goes on. After a matching checksum, fake runners that exit 127 → `fail libc`; that write `version 'GLIBC_2.99' not found` on standard error and exit 1 → `fail libc`, and that line reaches the script's standard error; that are killed by `kill -ILL $$` → `fail cpu`; that exit 1 silently → `fail version`. In each case nothing is put in place and nothing is left; in an update the old runner still answers `version`. The CLI's sentences for `libc` and `cpu` are those of contracts/versions.md

### Implementation for User Story 5

- [X] T027 [US5] In `INSTALL_SCRIPT` and apps/cli/src/install.ts, as contracts/versions.md, "The installer's new and changed failures": after `platform ok` and before `ready` or the download, the `getconf` and `ldd` checks; after the checksum matched, run the new runner's `version` with its output and standard error to files in `$tmp` and its exit status kept, decide `libc` (127, or `GLIBC_` in standard error), `cpu` (132) or `version`, and write the first line of its standard error, cut to 200 characters, to the script's standard error before failing; add `libc` and `cpu` to `InstallFailure` and `FAILURES` with their sentences. No `${`, no backquote: the test "its text has nothing a template could have put in it" still passes. T026 passes
- [X] T028 [P] [US5] Build both Linux runners with Bun 1.4.4 (`cd apps/runner && bun run compile:linux-x64 && bun run compile:linux-arm64`) and record in specs/005-runner-release/quickstart.md, "Results": each size, unpacked and after `gzip -9 -n`; the `file` output (interpreters `/lib64/ld-linux-x86-64.so.2` and `/lib/ld-linux-aarch64.so.1`); the highest `GLIBC_` version from `strings -a <file> | grep -oE '^GLIBC_[0-9.]+$' | sort -V | tail -1`. If it is above `GLIBC_2.17`, stop and report it: the release notes' "glibc 2.17 or newer" and the installer's 2.17 would then be wrong
- [X] T029 [US5] With Docker on this machine (it downloads images; nothing outward), run the install script in `file` mode in containers, as quickstart.md section 5: `INSTALL_SCRIPT` followed by the runner file piped to `docker run -i --rm [--platform …] <image> sh -s -- add <version> file <sha256>`, with a stand-in `docker` that answers `compose version` mounted first on `PATH`. Images: `debian:12` with `--platform linux/arm64` and with `--platform linux/amd64`, `centos:7` (glibc 2.17), `alpine:3`. Expected: the runner answers `version` in the first three, `fail libc` before the file is read in Alpine. Record each result in quickstart.md, "Results", saying that these stand in for the C library and the kind of processor only, not the processor floor or the kernel (SC-007)

**Checkpoint**: User Story 5 works against stand-ins and local containers.

---

## Phase 7: User Story 3 - Cut a release by following a short written procedure (Priority: P2)

**Goal**: one page takes a maintainer from start to end, withdrawal included.

**Independent Test**: `bun test apps/runner/test/releasing-doc.test.ts`; the real test is maintainer steps 3 to 7, made by following the page.

- [X] T030 [US3] Write apps/runner/RELEASING.md, in plain short sentences, with these parts in this order: (1) Once, before the first release: the tag ruleset (Settings, Rulesets, New tag ruleset; Active; target `runner-v*`; restrict creations, updates and deletions; block force pushes; bypass list the Repository admin role only; check who holds that role) and the Environment `prod` (required reviewer the maintainer; "Prevent self-review" off; deployment tags `runner-v*`; "Allow administrators to bypass configured protection rules" off; created before any prod tag, because a workflow that names a missing environment creates it without protection); (2) Which commits: a dev release from a commit on `dev`, a prod release from a commit on `main`; (3) The version: the grammar, dev counts from 1, a version is never used twice, `apps/runner/package.json` must say it; (4) Preparing a prod release: on `dev` commit `apps/runner/package.json` `0.1.0` and `apps/cli/src/runner-release.json` `0.1.0` with `null` checksums, run the tests, merge `dev` into `main`, run `bun apps/runner/scripts/release.ts check-main`, push `main`; (5) Starting: push one tag only, `git push origin runner-v<version>`, never `--tags` (GitHub creates no event for more than three tags at once); (6) Watching the run, and approving a prod release under "Review deployments"; what each job checks; (7) The second build: `bun apps/runner/scripts/second-build.ts runner-v<version>` on the right branch, what a match prints, the four commands it prints, and on a mismatch: stop, record nothing, add the mismatch record to the notes, decide with the maintainer, never change the comparison; what both builds share (npm, Bun's runtimes); (8) The release notes: what the workflow writes, and what is added after (the second build's record in place of "Not made yet.", a "Tried on" section, with `gh release edit`); (9) Withdrawing a release, as research R11 and the answer to Q2: `null` checksums on each branch that carries it, the GitHub release deleted or marked, the tag kept, the version never reused, servers that run it keep running and get `zekno server update` once the next release is recorded, or a runner replaced by hand at once if it must go; (10) After a prod release: merge `main` back into `dev` and push `dev` (as answered to Q6). Link it from apps/runner/README.md. Every command must be one that exists
- [X] T031 [US3] Add apps/runner/test/releasing-doc.test.ts: every `bun apps/runner/scripts/<name>.ts …` command in apps/runner/RELEASING.md names a file that exists and, for `release.ts`, one of `check`, `files`, `check-main`; every `runner-v…` example parses with `parseTag`; the page has the ten parts of T030 as headings; apps/runner/README.md links to it

**Checkpoint**: the procedure is written and its commands exist.

---

## Phase 8: User Story 6 - Docs that say how it really works (Priority: P3)

**Goal**: every page describes the install route as it works, true before and after a release is recorded, with its limits.

**Independent Test**: T036.

The docs must never say a release exists before one is recorded, nor that none exists after. Write what is always true: a build of zekno installs the one runner version it carries in `apps/cli/src/runner-release.json`; a build from `dev` carries a dev release, a build from `main` a prod release; a build that holds no checksums says it has no published runner to install. "Pre-alpha and unaudited" stays wherever it is (FR-027).

- [X] T032 [P] [US6] apps/cli/README.md: remove the bullet "No runner release is published yet…" and the paragraph "Today no release is published…"; describe the install route as above, with the checks a release passes (the second build), the limits (about 49 MB to download and 160 MB free while installing; Linux with glibc 2.17 or newer; x86-64 with SSE4.2 or ARM64; not Alpine; needs github.com over HTTPS), the new failure sentences, and the older and newer sentences of contracts/versions.md; replace "Whether the build can be reproduced, so that someone else gets the same checksum, was not checked" with what the second build checks and what it does not; `--runner-file` stays described as development only
- [X] T033 [P] [US6] apps/runner/README.md: the same changes; rewrite "The release workflow" for the two environments, the checks, the approval and the four files; link apps/runner/RELEASING.md; rewrite the limit "A release is only as good as its checksums…" with the second build and what both builds share; replace "restricting who can push such tags is left to the maintainer" with the ruleset
- [X] T034 [P] [US6] apps/web/content/docs/cli.mdx, apps/web/content/docs/runner.mdx and apps/web/content/docs/index.mdx: the same content as T032 and T033 for readers of the site; remove both "No release is published yet" callouts; in index.mdx change the threat table row "A Zekno app or runner release is tampered with … Mitigated by public code and signed releases" so it says that a runner release is checked against checksums the CLI holds, confirmed by a second build, and is not signed; update its status table
- [X] T035 [P] [US6] README.md: the `apps/cli` and `apps/runner` rows of the repository table say the CLI installs the runner release its build carries (drop "No runner release is published yet, so a server still needs a runner installed by hand"); the threat table row as in T034; "Reporting a vulnerability" as the maintainer answered Q10; link apps/runner/RELEASING.md; leave the roadmap line "Publish the first runner release" unticked (T042 ticks it)
- [X] T036 [US6] Run `bun test apps/cli/test/docs.test.ts` (every command and flag the CLI docs name exists); check that `git grep -n -i -e "no runner release" -e "no release is published" -e "today no release" -e "signed releases" -- README.md apps/` prints nothing and that every page that said "pre-alpha" or "unaudited" before this feature still does
  - The grep prints two lines, both landing page copy, which is the maintainer's and was left as it is: apps/web/modules/landing/content/index.ts, lines 379 and 497 ("signed releases"). Every other file it covers is clean. Every file that said "pre-alpha" or "unaudited" at 389addc still does, as often

**Checkpoint**: the docs match the code.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T037 Independent internal security review, by an agent or person that did not write the code, of: apps/runner/scripts/release-lib.ts, release.ts and second-build.ts (what each trusts: the tag, git's output, the download, the notes; the one file the second build writes), .github/workflows/runner-release.yml and main-versions.yml (permissions, pinning, expressions reaching a shell, the `prod` environment, what someone who can push a tag controls), the widened version format in the three installer checks and in the protocol, the installer's new checks (`tools`, `space`, `libc`, `cpu`, the runner's standard error passed on), and the compile flags of T002. Re-run under `sh` and `dash` the checks listed in specs/004-cli-app/security-review.md, "Checked and found to hold", for the installer, and confirm each still holds (FR-026). Fix every finding rated high or critical, each with a test. Record every finding, its rating and its state in specs/005-runner-release/security-review.md, in the form of specs/004-cli-app/security-review.md
  - Done: reviewed at 389addc, fixed on 42c27ef, recorded in security-review.md. One high (RV1), one medium (RV2), four low (RV3, RV4, RV5, RV10) and six notes, each fixed with a test or in the pages. Open, waiting for the maintainer: RV1's last part, splitting each release job in two (research Q11, recommended before the first release), and research Q12
- [ ] T038 The agent end-to-end tests: only if a change in this feature altered text that a test in apps/cli/tests/*.e2e.ts reads (first run, adding a server, deploy, logs, rollback, link). Check with `git diff dev -- apps/cli/src` against those flows. If it did, ask the maintainer's go-ahead (refreshing the replay cache calls the model and costs a little), then `cd apps/cli && bun run test:e2e` and record the result as specs/004-cli-app/quickstart.md did. If it did not, record "not needed" and why in specs/005-runner-release/quickstart.md, "Results"
- [ ] T039 From the repository root run `bun run typecheck`, `bun run lint`, `bun run test` and `bun run build` (constitution VII), without the cache (`--force`), and record in specs/005-runner-release/quickstart.md, "Results, checks at the end", the packages each covered and the test totals per package, with any failure and its output

---

## Maintainer steps (not tasks for the implementer)

Each is the maintainer's own action, or is done only with their go-ahead at the time. They come in this order.

1. **Create the tag ruleset** for `runner-v*`, and the rules for the branches `dev` and `main` (security review RV1 and RV5), as apps/runner/RELEASING.md part (1). Check who holds the Repository admin role (research Q8). If an account without that role is available, try `git push origin runner-v0.0.1-dev.1` from it and keep the refusal (SC-006). *Needs first*: T030.
2. **Create the Environment `prod`**, as apps/runner/RELEASING.md part (1). It must exist before any prod tag. *Needs first*: T030.
3. **Merge `005-runner-release` into `dev`, push `dev`, and push the tag `runner-v0.1.0-dev.1`** (one tag). Watch the run: `check` gives `environment=dev`, `release-dev` publishes a pre-release with four files. *Needs first*: T001 to T039 done; steps 1 and 2.
4. **Run the second build** on `dev`: `bun apps/runner/scripts/second-build.ts runner-v0.1.0-dev.1`. On a match, run the commands it prints (commit, push `dev`, `gh release edit` with the record). On a mismatch, stop: nothing is recorded, and what happens next is decided with the maintainer (plan.md, "If GitHub's build differs"). *Needs first*: step 3 succeeded; T016.
5. **The proof on the maintainer's own server** (asked for each time): add a server from the dev release, deploy, update from an older runner, as quickstart.md section 7. *Needs first*: step 4 matched and is committed on `dev`.
6. **On `dev`, commit the prod versions** (`apps/runner/package.json` `0.1.0`; `apps/cli/src/runner-release.json` `0.1.0` with `null` checksums), **merge `dev` into `main`**, run `bun apps/runner/scripts/release.ts check-main`, **push `main`**, **push the tag `runner-v0.1.0`**, and **approve** the waiting `release-prod` job. *Needs first*: step 5 passed; step 2.
7. **Run the second build** on `main`: `bun apps/runner/scripts/second-build.ts runner-v0.1.0`; on a match, run the commands it prints. *Needs first*: step 6 published.

Research proposes two more, only if the maintainer agrees: merge `main` back into `dev` and push it (Q6), and a short proof with the prod CLI on the server running `0.1.0-dev.1` (Q7).

Before step 3, the maintainer answers research Q11 (split each release job in two; security review RV1). The recommended answer is to build it before the first release, as a task of its own, with two more pinned actions.

---

## Phase 10: After the maintainer steps

Each task waits for the maintainer step it names. Work on a branch from `dev`; the maintainer merges it.

- [ ] T040 After maintainer steps 3 and 4: record in specs/005-runner-release/quickstart.md, "Results": the run's address, `check`'s four outputs, the release's four files and sizes, and the second build's record. If it did not match: the record, and that the plan stops for the maintainer's decision
- [ ] T041 After maintainer step 5 (and step 1's SC-006 try): record in specs/005-runner-release/quickstart.md the proof as a table like specs/004-cli-app/quickstart.md, "A real server": each step, its result and its time (SC-001 under two minutes; SC-005 the container's id and start time unchanged through the update; FR-024), whether SC-006 was tried, and what was not tried (ARM64, a user who is not root, the oldest processor) with what stood in for it. Write the "Tried on" text for the release notes and hand it to the maintainer
- [ ] T042 After maintainer step 7: record the prod release and its second build in specs/005-runner-release/quickstart.md; tick "Publish the first runner release" in the roadmap of README.md and adjust any status line that only becomes true now; run T036's checks and T039's commands again and record the totals; if the maintainer agreed to Q7, record that proof too

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. Blocks every story. Inside it: T003 before T004; T004 before T005, T006 and T008; T006 before T007.
- **US2 (Phase 3)** and **US1 (Phase 4)**: after Foundational; independent of each other.
- **US4 (Phase 5)**: after Foundational, and after the maintainer approved contracts/versions.md (Q4) for T023 and T024.
- **US5 (Phase 6)**: after US1 (T027 edits the same script lines as T019).
- **US3 (Phase 7)**: after US2 (the page names its commands).
- **US6 (Phase 8)**: after US1, US2, US4 and US5 (the docs describe them), and US3 (they link the page).
- **Polish (Phase 9)**: after every story.
- **Maintainer steps**: after Phase 9, in their order.
- **Phase 10**: each task after the maintainer step it names.

The phases follow the order plan.md sets (rename, workflow script, second build, installer and sentences, procedure and docs, review), not strictly the spec's priorities: the procedure page and the docs describe what the other stories build, so they come last.

### Within each story

- Tests first, failing; then the implementation that makes them pass.
- The installer script (`INSTALL_SCRIPT` in apps/cli/src/install.ts) is edited by T006, T019 and T027, one after another, never in parallel.
- apps/cli/test/install.test.ts is edited by T007, T018 and T026, one after another.

## Parallel Opportunities

- Setup: T001 and T002.
- Foundational: T003 alongside T001 and T002.
- US2: T009, T010 and T011 (three test files); then T014 and T015 (two workflow files) alongside T012 and T013.
- US2 and US1 can be worked on side by side once Phase 2 is done.
- US5: T028 alongside T026 and T027.
- US6: T032, T033, T034 and T035 (four sets of files).

## Parallel Example: User Story 2

```bash
# The three test files together:
Task: "Write apps/runner/test/release.test.ts"
Task: "Write apps/runner/test/second-build.test.ts"
Task: "Write apps/runner/test/workflow.test.ts"

# Then the two workflow files beside the scripts:
Task: "Rewrite .github/workflows/runner-release.yml"
Task: "Add .github/workflows/main-versions.yml"
```

## Implementation Strategy

### MVP first

Phases 1 to 3: one grammar, 0.1.0, the workflow's checks in a tested script with two environments, and the second build. That is what the first dev release needs; everything after it makes the install route say more and the docs true.

### Incremental delivery

1. Setup and Foundational: every test green with `0.1.0-dev.1`.
2. US2: a release can be made and confirmed (stand-ins).
3. US1: installing from it says what happened on every way it stops.
4. US4: older and newer runners are said, after the wording is approved.
5. US5: what a server lacks is said; the Linux builds and containers are checked.
6. US3 and US6: the page and the docs.
7. Review and end checks. Then the maintainer's steps.

## Requirement Coverage

| Requirement | Tasks (and maintainer steps) |
|-------------|------------------------------|
| FR-001 install by itself | T020; step 5; T041 |
| FR-002 x86-64 and ARM64, chosen by the server | T014 (both built), T028, T029; existing `uname` check and tests |
| FR-003 root and non-root, no elevated rights | existing tests (non-root); T029; step 5 (root); T041 |
| FR-004 checksum from the CLI only | T007, T018 (one byte); existing tests |
| FR-005 put in place only after answering its version | T026, T027 (old runner kept); existing tests |
| FR-006 every stop says what and what to do, server as it was | T018, T019 (`tools`, `space`), T026, T027 (`libc`, `cpu`) |
| FR-007 no checksum: says so and names alternatives | T020 |
| FR-008 checksums recorded only after a second build | T010, T016, T030; steps 4 and 7 |
| FR-009 the comparison fails, says which, leaves a record | T010, T012, T016, T030; steps 4 and 7; T040 |
| FR-010 only named maintainers; dev from `dev`, prod from `main` | T009, T013, T014; step 1 |
| FR-010a prod waits for approval; dev a pre-release | T011, T014; step 2; step 6 |
| FR-010b the version grammar and order | T003, T004, T005, T006, T007 |
| FR-011 stop when the version differs from the runner's | T009, T013 (package.json and the built binary) |
| FR-012 replaced files caught | existing checksum tests, T018; step 1 (tags cannot move); research Q1 |
| FR-013 notes and a file: checksums, commit, what it is built for | T009, T012, T013 |
| FR-014 one page, start to end | T030, T031 |
| FR-015 withdrawing, and servers that have it | T030 (with Q2) |
| FR-016 0.1.0 as `0.1.0-dev.1` then `0.1.0`, recorded on each branch | steps 3 to 7; T040, T042 |
| FR-016a 0.2.0 becomes 0.1.0 | T008 |
| FR-017 exactly the version it carries | existing `installWords`; T020 |
| FR-018 told when older and when newer | T021, T022, T023, T024 |
| FR-019 update: older replaced, apps kept, never newer replaced | T007 (d), T021; step 5; T041 |
| FR-020 only when asked; confirmed at a terminal | existing tests in apps/cli/test/first-run.test.tsx |
| FR-021 one release apart still deploy; told what does not work | T025, T022, T023 |
| FR-022 starts on what the notes name | T012 (notes), T028, T029; step 5; T041 |
| FR-023 below the line: stop before putting in place, say what lacks | T026, T027 |
| FR-024 add, deploy, update on a real server, written down | step 5; T041 |
| FR-025 README, docs and feature map as it works | T032 to T036; T042 |
| FR-026 the installer's protections still hold | T006, T007, T019, T027 (no `${`), T037 |
| FR-027 pre-alpha and unaudited stay | T012 (notes), T032 to T036 |

Totals: 42 tasks. Setup 2, Foundational 6, US2 9, US1 3, US4 5, US5 4, US3 2, US6 5, Polish 3, after the maintainer steps 3.
