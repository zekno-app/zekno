# Implementation Plan: Runner Releases

**Branch**: `005-runner-release` (from `dev`) | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-runner-release/spec.md`, and the decisions made with
the maintainer on 2026-11-14 (summarised below; the file they were handed over in is binding).

## Summary

Feature 004 built the installer, `zekno server update` and a release workflow that has never run.
This feature makes them carry a real release. The version 0.2.0 that was never released becomes
0.1.0, and the version format widens to allow a development release (`0.1.0-dev.1`) everywhere a
version is checked: the installer's three checks, the session protocol, the comparisons and the
release workflow. The workflow's logic moves into a tested Bun script and splits into two
environments: a **dev** release from `dev`, published as a pre-release, and a **prod** release from
`main`, which waits for the maintainer's approval. A second command, run on the maintainer's own
machine, rebuilds the tagged commit and compares its files with the published ones and with
`SHA256SUMS`; only when all three agree does it write the checksums into
`apps/cli/src/runner-release.json`. The CLI says when a runner is older or newer than the one it
carries, and the installer says what a server lacks when the runner cannot start there. One page,
`apps/runner/RELEASING.md`, takes a maintainer through a release. The first releases,
`0.1.0-dev.1` and `0.1.0`, are then made by the maintainer and proven on a real server.

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.4 (pinned in the root `package.json`), POSIX `sh` for the installer script, GitHub Actions YAML

**Primary Dependencies**: `@workspace/core`, `zod` 4.6.7, Ink 8 (CLI), Bun built-ins (`Bun.CryptoHasher`, `Bun.gzipSync`, `Bun.gunzipSync`, `Bun.spawn`, `fetch`), `git`, `gh` on GitHub's machine only. **No new packages, actions or services.**

**Storage**: files: `apps/cli/src/runner-release.json` (what a CLI installs), `apps/runner/package.json` (what the runner reports), the GitHub Release's four files

**Testing**: `bun test`. Pure functions by unit test; the installer script run with `/bin/sh` and `/bin/dash` against stand-ins (as in feature 004); the release script against temporary git repositories with a bare `origin`; the second build against a stand-in release in a temporary folder, no network

**Target Platform**: the runner on Linux x86-64 (`bun-linux-x64-baseline`) and ARM64 (`bun-linux-arm64`) with glibc; the CLI on macOS and Linux; the workflow on GitHub's `ubuntu-24.04`; the second build on the maintainer's macOS machine

**Project Type**: two command-line apps and one library in the Bun workspace, two GitHub Actions workflows, two maintainer scripts

**Performance Goals**: adding a server from a release in under two minutes on an ordinary connection (SC-001): the download is about 49 MB gzipped, 110 MB unpacked; a release made by following the page in under one hour (SC-004)

**Constraints**: the installer keeps every protection of feature 004 (fixed text, no `${` or backquote, values checked three times, HTTPS only, only a file named `zekno-runner` replaced); nothing outward (a push, a tag, a setting, a server) without the maintainer; the rule "all three agree or nothing is recorded" is never weakened by the implementer

**Scale/Scope**: one maintainer, two releases, about 30 changed files (most of them for the rename) and 12 new ones

## Decisions made with the maintainer (2026-11-14)

| Decision | Choice |
|----------|--------|
| Where the second build runs | The maintainer's own machine, one Bun command that takes a tag |
| x86-64 build | `bun-linux-x64-baseline`; ARM64 `bun-linux-arm64`; glibc only, no musl build |
| Provenance or signing | None in this feature. The checksum the CLI holds, confirmed by the second build, is the trust |
| Who may release | Only the maintainer, by a repository ruleset on `runner-v*` tags |
| Environments | dev: `runner-v<x.y.z>-dev.<n>` from `dev`, a pre-release, never latest. prod: `runner-v<x.y.z>` from `main`, waits for approval in the GitHub Environment `prod` |
| Second build for dev too | Yes, one rule for both |
| First version | 0.1.0. First releases `0.1.0-dev.1`, then `0.1.0`. Every 0.2.0 in code, tests and docs becomes 0.1.0 |
| Compression | gzip, as now |
| Outward steps | The maintainer's, each with a go-ahead at the time (list below) |

## Constitution Check

*GATE: checked before Phase 0 research and again after Phase 1 design. Both pass.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | No signing key exists anywhere. A server installs only a file whose SHA-256 equals the value the CLI holds, and that value is written only after a build on the maintainer's machine matched GitHub's build and `SHA256SUMS`. GitHub's build service alone cannot get a different runner onto a server. The workflow keeps only the default token. Nothing closed is added. | Pass |
| II. Honest Surface | Release notes name what Bun documents and, separately, what was tried (SC-007). Docs never say a release exists before one is recorded, and never say none exists after. The threat table row that says runner releases are "signed" is corrected (they are checked against pinned checksums). "Pre-alpha and unaudited" stays everywhere it is (FR-027). "Runner", never "agent". | Pass |
| III. Read the Installed Docs First | Bun's own docs in `node_modules/.bun/bun-types@1.4.4/.../docs` were read for the compile targets, the C library, the processor floor and the config autoload (research R3). GitHub and git facts are cited to their official pages. No Next.js code changes; the docs pages are MDX content only. | Pass |
| IV. One Design System | No new component. Wording changes in existing screens only. Feature 004's justified deviation (the CLI's own theme) is unchanged. | Pass |
| V. Motion With Purpose | No motion added. | Pass |
| VI. Accessible and Fast by Default | An older or newer runner is said in words with a symbol, never by colour alone. Lines fit the 80-column Home pane. | Pass |
| VII. Verified Before Done | Every branching rule has unit tests: the version grammar and order, the shell's comparison checked against the TypeScript one, tag and environment, the branch check, the three-way comparison. Typecheck, lint, build and tests from the root at the end. The real-server proof records what was and was not tried. | Pass |

Note for the maintainer: the constitution's "Technology Constraints" still say Bun 1.4.2; the
repository pins 1.4.4. That is a wording fix to the constitution, outside this feature.

## Project Structure

### Documentation (this feature)

```text
specs/005-runner-release/
├── plan.md               # this file
├── research.md           # Phase 0: findings with sources, and the open questions
├── data-model.md         # Phase 1: versions, tags, environments, release files, records
├── quickstart.md         # Phase 1: how to check it; results are added as tasks complete
├── contracts/
│   ├── release.md        # tag and version grammar, the workflow, the release's files, release.ts, runner-release.json
│   ├── second-build.md   # the maintainer's command: arguments, steps, record, exit statuses
│   └── versions.md       # what a person is told for each version situation, and the installer's new failures
├── checklists/requirements.md
├── security-review.md    # written by the review task
└── tasks.md              # Phase 2
```

### Source Code (repository root)

```text
packages/core/src/
├── version.ts                       # new: the version grammar, parse, compare (no imports)
├── protocol.ts                      # RunnerVersionSchema uses the grammar
└── index.ts                         # exports version.ts
packages/core/test/version.test.ts   # new

apps/runner/
├── package.json                     # version 0.1.0-dev.1; compile scripts
├── tsconfig.json                    # includes scripts/
├── RELEASING.md                     # new: the release procedure page
├── scripts/
│   ├── release-lib.ts               # new: pure functions shared by the two scripts
│   ├── release.ts                   # new: the workflow's logic (check, files, check-main)
│   └── second-build.ts              # new: the maintainer's second build
└── test/
    ├── release.test.ts              # new
    ├── second-build.test.ts         # new
    ├── workflow.test.ts             # new: the two workflow files' shape
    └── releasing-doc.test.ts        # new: the page names only commands that exist

apps/cli/src/
├── install.ts                       # grammar, is_version, is_newer, found version; libc, cpu, space; tools first
├── runner-release.json              # 0.1.0-dev.1, no checksums until the second build
├── runner-release.ts                # grammar from core
├── ops/server.ts                    # relation older/same/newer replaces isOutdated
├── commands/server.ts, status.ts    # sentences of contracts/versions.md
└── app/effects.ts, state.ts, screens/home.tsx   # the same in the app

.github/workflows/
├── runner-release.yml               # rewritten: check, then release-dev or release-prod
└── main-versions.yml                # new: main never holds a dev version
```

**Structure Decision**: no new package. The version grammar goes into `packages/core`, because
the protocol already checks versions there and both apps and the scripts depend on core. The
release scripts live in `apps/runner/scripts/` because they build and publish the runner; they
write the CLI's `runner-release.json` by its path in the repository.

## Order of work

1. **Rename and widen** (Foundational). 0.2.0 becomes 0.1.0 (the runner's own version on `dev`
   becomes `0.1.0-dev.1`, so the first dev tag can match it). One grammar in
   `packages/core/src/version.ts`; the installer's three checks (the CLI's pattern, the
   transport's word check, the script's own `is_version` and `is_newer`, plus the line the script
   reads a found runner's version from), the protocol, `runner-release.ts` and the comparison all
   follow it. The transport's word check already admits a hyphen after the first character, so it
   needs a test, not a change (research R1).
2. **The workflow's logic in a tested script, with two environments** (US2): `release-lib.ts`,
   `release.ts`, the rewritten workflow.
3. **The second build** (US2): `second-build.ts`.
4. **The installer and the CLI's sentences** (US1, US4, US5): disk space, checksum tool before
   download, what a server lacks, older and newer runners.
5. **Docs and the release procedure page** (US3, US6).
6. **The independent review** of the new surface, then the end checks.
7. **The maintainer's steps**, then recording what they showed.

## Built and tested without any outward step

Everything in tasks Phase 1 to Phase 9. In particular:

- The grammar, the comparison, the installer's new checks: unit tests and the script under `sh`
  and `dash` against stand-ins.
- The workflow's checks: `release.ts check` against temporary repositories with a bare `origin`
  that has `main`, `dev` and a feature branch; `release.ts files` against stand-in binaries.
- The second build: against a stand-in release in a temporary folder (no network) with a
  stand-in build; and the real build path once, locally, building the same commit twice
  (needs the network for `bun install` and Bun's Linux runtimes, nothing outward).
- The Linux runners built locally with Bun 1.4.4: size, C library symbols, and starting in local
  containers (Debian, a glibc 2.17 system, Alpine for the refusal). This downloads container
  images; it touches no server and no repository setting.

What cannot be done without the maintainer: anything on GitHub (ruleset, environment, pushes,
tags, approval, release notes), anything on a real server, and the second build of a real
release (it needs a release to exist).

## Maintainer steps, in order

Each needs the maintainer's go-ahead at the time. The tasks named must be done first.

| # | Step | Needs first |
|---|------|-------------|
| 1 | Create the tag ruleset for `runner-v*` (restrict creations, updates and deletions; block force pushes; bypass: Repository admin only). Check who holds the admin role (research R5). Try a tag push from an account without the right if one is available (SC-006, open question Q8). | RELEASING.md (T030) to follow |
| 2 | Create the Environment `prod`: required reviewer the maintainer, "Prevent self-review" off, deployment tags `runner-v*`, administrators' bypass off. Must exist before any prod tag: a workflow that names a missing environment creates it with no protection (research R6). | T030 |
| 3 | Merge `005-runner-release` into `dev`, push `dev`, push the one tag `runner-v0.1.0-dev.1` (never several tags at once). Watch the run. | All tasks T001 to T039; steps 1 and 2 |
| 4 | Run `bun apps/runner/scripts/second-build.ts runner-v0.1.0-dev.1` on `dev`. On a match, commit `runner-release.json`, push `dev`, add the record to the release notes. On a mismatch, stop (below). | Step 3 succeeded |
| 5 | The proof on the maintainer's server: add a server from the dev release, deploy, update from an older runner (quickstart, "Real server"). | Step 4 |
| 6 | On `dev`, commit the prod versions (`apps/runner/package.json` `0.1.0`, `runner-release.json` `0.1.0` with no checksums), merge `dev` into `main`, run `release.ts check-main`, push `main`, push `runner-v0.1.0`, approve the run. | Step 5 passed; step 2 |
| 7 | Run the second build for `runner-v0.1.0` on `main`; commit and push on a match; add the record to the release notes. | Step 6 published |

Tasks T040 to T042 record what the steps showed and tick the roadmap. Open questions Q6 and
Q7 in research.md propose two more steps (merge `main` back into `dev`; a short proof with the prod
release); they are not part of this list unless the maintainer adds them.

## If GitHub's build differs from the maintainer's

Whether a build on GitHub's Linux machine equals one on macOS is unknown until step 4. If it does
not:

- The second build exits with status 1, names each file that differs with its three checksums,
  and writes nothing to `runner-release.json`. No CLI will install that release.
- The record of the mismatch (the command's output and its record file) is kept: in the release
  notes, added by the maintainer, and in `quickstart.md`'s results by task T040.
- Nobody changes the rule, the comparison or the build to make them agree. The decision of what
  to do next (look for the cause and cut `0.1.0-dev.2`, rebuild on Linux on the maintainer's
  machine, or something else) is the maintainer's. Until then the plan stops at step 4.

## How `main` never holds a dev version

Four layers, each cheap:

1. **The only writer refuses.** `second-build.ts` records a dev release only when the current
   branch is `dev`, and a prod release only on `main`.
2. **The procedure.** Before a prod release, the prod versions are committed on `dev`, so the merge
   into `main` brings plain versions. `release.ts check-main` is run before `main` is pushed.
3. **CI.** A new workflow, `main-versions.yml`, runs `release.ts check-main` on every push to
   `main` and every pull request into it, and fails when `apps/runner/package.json` or
   `apps/cli/src/runner-release.json` holds a dev version.
4. **The prod release refuses.** `release.ts check` stops a prod tag whose commit's
   `runner-release.json` holds a dev version.

A required status check on `main` would make layer 3 blocking; that is a repository setting, and
it is not proposed here.

## The release procedure page

`docs/` does not exist in this repository. The page goes to **`apps/runner/RELEASING.md`**: the
releases are of the runner only, its README already describes the release workflow and links to
it, the scripts it names live beside it, and the public docs site is for people using Zekno, not
for maintainers. The root README and the runner's README link to it.

## Risks

- **Reproducibility across machines is unproven.** Two builds on the maintainer's machine match;
  GitHub's Linux build against a macOS build has never been compared. Handled above; it can stop
  the plan at step 4.
- **What both builds share.** The second build is independent of GitHub's build service, not of
  npm or of Bun's own runtime download, which both builds fetch. It proves the build service
  changed nothing; it does not prove the dependencies are sound (research R9).
- **A dev runner met by a prod CLI, and the reverse.** A prod CLI sees `0.1.0-dev.1` as older and
  offers to update it. A dev CLI sees `0.1.0` as newer and never replaces it. A runner built from
  this repository before this feature reports `0.2.0`, which now counts as newer than everything
  released; only the maintainer can have one (feature 004's proof removed its runner from the
  server), and it is replaced by hand.
- **Download size on slow servers.** About 49 MB per install. A stalled download waits without a
  time limit; Ctrl-C stops it and the temporary folder is removed. The peak disk need is about
  160 MB in the runner's folder; a full disk now says so.
- **Settings only the maintainer can change.** The ruleset and the `prod` environment. Without the
  ruleset anyone with write access can start a release (it still is not installed by any CLI
  until the maintainer's second build records it). A prod tag pushed before the environment
  exists would create it unprotected and publish without approval.
- **Who bypasses the ruleset.** In the settings page, bypass is given to roles, not people. "Only
  the maintainer" holds while the maintainer is the only one with that role.
- **Tags pushed together.** GitHub creates no event when more than three tags are pushed at once;
  the page says to push one tag.

## Complexity Tracking

No principle is violated. Nothing to justify.
