# Security Review: Runner Releases

Everything in [`specs/004-cli-app/security-review.md`](../004-cli-app/security-review.md) and
[`specs/003-cli-runner/security-review.md`](../003-cli-runner/security-review.md) still applies.

## The release machinery (reviewed 2026-11-14, T037)

**Scope**: `apps/runner/scripts/release-lib.ts`, `release.ts` and `second-build.ts`;
`.github/workflows/runner-release.yml` and `main-versions.yml`; the widened version format in the
installer's three checks and in the protocol; the installer's new checks (`tools`, `space`, `libc`,
`cpu`, the runner's standard error passed on); the compile flags of T002; `apps/runner/RELEASING.md`.
At commit `389addc`, against [`contracts/release.md`](./contracts/release.md),
[`contracts/second-build.md`](./contracts/second-build.md) and
[`contracts/versions.md`](./contracts/versions.md) · **Kind**: internal, focused review

This is not an external audit. An independent reviewer (a separate agent that did not write the
code) read the source at `389addc` and ran its own experiments against an export of it: the version
grammar under seven shells, hostile answers from a stand-in server, the second build against
stand-in repositories and releases, and the compiled programs in folders full of configuration. The
fixes were made afterwards, on the source at `42c27ef` (which changed only docs after `389addc`), by
an assistant other than the reviewer, who first reproduced each finding a test or a run could show.
An external audit is still required before production use.

**Who was considered**

| Attacker | Can do |
|----------|--------|
| Code in a release build | A compromised npm package (its install script, or its code bundled into the runner) or build tool. Runs on GitHub's machine during a release job. |
| Whoever can push a tag or a commit | Anyone with write access until the rulesets exist, and the workflow's own token while a release job runs. Whoever pushes a tag also chooses the workflow that runs for it (research R5). |
| Whoever serves the release's files | Changes what the download address serves, or makes a deleted release again. |
| A server that lies | As in feature 004: answers the installer anything. |
| The maintainer's machine | Not an attacker: its environment and Bun's caches, which the second build should not take on trust. |

**Outcome**: one finding rated high, one medium, four low, and six notes. The high finding is fixed
in part; its last part, splitting each release job in two, waits for the maintainer (research Q11).
Every other finding is fixed, in code or in the pages.

| Id | Rating | Finding | State |
|----|--------|---------|-------|
| RV1 | High | **Untrusted code ran in the same job as the token that can write.** Each release job held `contents: write` and ran `bun install`, whose install scripts ran (Bun trusts `esbuild`'s `postinstall`), the build, and the built runner. Code run there can put its own `gh` on `GITHUB_PATH`, which GitHub applies to every later step, and so get the publishing step's token: push to `dev` or `main` (a new `runner-release.json`), or replace a release's files. A fake `bun` in the `check` job could send a prod tag to the dev job, past the approval. Reproduced in part (the install scripts ran in a frozen install); the rest reasoned from GitHub's documentation. | **Fixed in part.** (1) Every `bun install`, in both workflows and in the second build, has `--ignore-scripts`. (2) Each release job's first step, before any checkout, setup or install, checks with bash, in the C locale, that the tag itself is of the job's kind, and takes the version from it; the job reads the Bun version from the commit itself; only the commit comes from `check`, and `release.ts files` stops unless the checkout is that commit. (3) RELEASING.md part 1 sets rules for `dev` and `main`: no deletions, no force pushes, `check-main` required on `main`, the admin role the only bypass. (4) The workflow's comment and the test's name say what is true. **Open, waiting for the maintainer** (research Q11, recommended: yes, before the first release): split each release job into a build job that cannot write and a publish job that runs nothing of the repository. Until then, code bundled into the runner, or a changed build tool, runs beside the token, and the branch rules do not stop such a push to `dev`. |
| RV2 | Medium | **The second build trusted the tag.** It checked only that the tag here is the tag on GitHub, never that the tagged commit is on `dev` or `main`, and its frozen install ran the tagged commit's install scripts on the maintainer's machine before anything was compared. A commit on no release branch was recorded on `dev` with status 0. Reproduced. | Fixed: before anything is downloaded or built, the tagged commit must be an ancestor of `refs/heads/dev` (dev tag) or `refs/heads/main` (prod tag) as the maintainer's checkout has it; otherwise status 1, and a sentence that says to pull first. The install has `--ignore-scripts`. The record names the commit and its one-line subject (printable ASCII, at most 100 characters), and RELEASING.md part 7 says to compare them with the commit that was tagged before running anything it prints. The advice for a missing tag now says that a fetched tag's commit must be on the branch here. |
| RV3 | Low | **Withdrawing does not stop every zekno**, as the page said. A release can be made again on the kept tag with the original files, which were public, or the original dev run run again; a zekno built before the withdrawal then installs it again. | Fixed in the page: part 9 says what withdrawal does and does not do, adds deleting the tag's workflow runs (marked **[outward]**), and says that whether immutable releases (Q1) would change this is not known. |
| RV4 | Low | **"Only the publishing step gets the token" was not met**: `actions/checkout` gets it by default. | Fixed in words, with RV1 (4). Every checkout keeps `persist-credentials: false`, no step is handed the token as an input (tested), and the workflow's comment, contracts/release.md, the runner's README and its docs page say that checkout gets it to read the repository. |
| RV5 | Low | **`main-versions.yml` reports; it does not gate.** It runs after the push, is not required, `[skip ci]` skips it, and a push made with a workflow's token does not start it. | Fixed in the pages and by a rule: the workflow's comment, contracts/release.md and RELEASING.md say so; part 1's rule for `main` makes `check-main` a required check for everyone but the admins; part 4 still runs `check-main` locally before pushing `main`. |
| RV10 | Low | **The procedure page was unsafe to copy.** Parts 4 and 9 set `VERSION=0.1.0` and `VERSION=0.1.0-dev.1`, then ran `gh release delete "runner-v$VERSION" … --yes`. | Fixed: each place runs `unset VERSION TAG`, then `VERSION=<version>`, which no shell runs as it stands, then `TAG="runner-v${VERSION:?}"`. Every use is `${VERSION:?}` or `${TAG:?}`. The here-document is read before the file is opened, so an unset `VERSION` leaves `runner-release.json` as it was. No `--yes`. The page's test checks each of these, in every shell on the machine. |

**Notes**

| Id | Finding | State |
|----|---------|-------|
| RV6 | `BUN_OPTIONS="--preload <file>"`, `BUN_BE_BUN=1` and `BUN_INSPECT` still steer both compiled programs. Whoever sets them already controls the account. The pages named only the `ZEKNO_*` variables and `PATH`. | Fixed in the pages: the runner's README and docs page name the three and say the server's SSH must not accept `BUN_*` (`AcceptEnv`); the CLI's README and docs page name them where they speak of its environment. |
| RV7 | The second build passed all of its environment to the build, and used Bun's cached Linux runtimes without a check: a changed cached runtime was embedded as it was. On its own this fails safe, since the two builds would differ. | Fixed: the build gets only `HOME`, `PATH` (this Bun first), a `TMPDIR` of its own and, for the compile steps, an empty runtime cache of its own (`BUN_INSTALL_CACHE_DIR`), so Bun downloads the runtimes again, about 107 MB each unpacked (RELEASING.md part 7, contracts/second-build.md, "The build"). Checking the runtimes against Bun's published checksums is open question Q12, written up with what is and is not known. |
| RV8 | Under bash 4.2 in a UTF-8 locale, the installer's `is_version` accepted Arabic-Indic digits, which JavaScript refuses. It cannot be reached: the CLI checks the version in JavaScript first. | Fixed: the script sets and exports `LC_ALL=C` before anything else. Reproduced in the local `centos:7` image (bash 4.2.46) with no network: `٣.2.3` and `1.2.3-dev.١` got past the check (to `fail docker`) before, and stop at `fail usage` after; `1.2.3` goes on as before. This machine's `sh` (bash 3.2) and `dash` refused them before too. Every earlier installer test passes as it was. |
| RV9 | A failure that is none of the second build's checks (the network dropping during a download, a program that cannot start) ended with status 1, which the page reads as "did not match". | Fixed: a download cut off part way is a failed download, a build step that cannot start is a failed build step, and any other such failure is caught; all end with status 3 and a sentence that says whether anything had been compared. contracts/second-build.md and RELEASING.md say so. |
| RV11 | Nothing checked that the environment `prod` exists and is protected before a prod tag. | Fixed in the page: RELEASING.md part 4 runs two read-only `gh api` calls before each prod tag, `repos/zekno-app/zekno/environments/prod` and its `deployment-branch-policies`, and says what the answers must hold. Their form was checked against GitHub's REST documentation ("Deployment environments", "Deployment branch policies") and their `--jq` filters on answers shaped like its schema; they were not run. The documented answer does not include the administrators' bypass, so the page says to check that on the settings page. |
| RV12 | Docs that were not true at `389addc`. | The docs phase (`42c27ef`) had fixed "signed releases" in README.md and the docs index, checksums said to come from the build job, "any tag on any commit starts a release", the missing dev and prod split, and Bun 1.4.2. Fixed here: design rule 6 in README.md keeps its words and adds that it is the rule for the planned desktop app and that runner releases are not signed yet; "that token only in the step that publishes" in the runner's README and docs page (RV4). Left, the maintainer's: the landing page copy, `apps/web/modules/landing/content/index.ts`, says twice that "public code and signed releases" reduce the risk of a tampered app or runner release (the threat row's reason, and the answer to "What does Zekno not protect against?"). Runner releases are not signed. |

**What the second build proves and does not prove**

1. It proves that the files GitHub published are what this source and this Bun build on another machine: GitHub's build service did not change them.
2. It proves that `SHA256SUMS` and the notes name those files and that commit, and that the commit is on the release's branch as the maintainer has it.
3. It does not prove that the source is good: whatever is on that branch is built and recorded.
4. It does not prove that Bun, its Linux runtimes or the npm packages are good: both builds use the same ones, from the same places (Q12).
5. It has not yet compared a build on GitHub with one on macOS: that happens at the first release, and if they differ nothing is recorded (plan.md).

**Where each fix is tested**

| Finding | Test |
|---------|------|
| RV1 (1), (2), (4), RV4 | `apps/runner/test/workflow.test.ts`: "every install runs no package's scripts" for each workflow; "each release job's first step works out from the tag itself that it is of its kind", which runs the step's own script with bash for every valid, refused and hostile tag of the version fixtures and compares it with `parseTag`; "the release jobs take from `check` only the commit"; "the token is named only in the publishing step's environment"; the pins unchanged. Seven of its thirteen tests fail at `42c27ef`. |
| RV1 (1) in the second build, RV7 | `apps/runner/test/second-build.test.ts`, "the second build's own build, without the network": on a repository of workspaces only, neither the root's nor a package's `postinstall` runs, and each compile step gets exactly the variables above, with the runtime cache empty. At `42c27ef` both `postinstall` scripts ran. |
| RV2 | `second-build.test.ts`, "a tag on a commit that is not on the release's branch here" (the reviewer's case, status 0 at `42c27ef`; a branch not pulled yet; a commit of `main` that `dev` holds), and "the record names the commit's subject". |
| RV9 | `second-build.test.ts`, "a failure that is none of its own checks" (at `42c27ef` the call threw) and "a step that cannot even start" (at `42c27ef` the build threw). |
| RV8 | `apps/cli/test/install.test.ts`, "before anything else it works in the C locale" (fails at `42c27ef`), and, under `/bin/sh` and `/bin/dash`, "in a UTF-8 locale, digits of other scripts are not version digits" (passes at `42c27ef` on this machine; the bash 4.2 case is the container run above). |
| RV3, RV10, RV11 | `apps/runner/test/releasing-doc.test.ts`: "no version is written into a command"; the here-document run with `VERSION` unset in each shell; "its gh api commands only read, and only this repository"; `gh run delete` among the steps that must be marked **[outward]**. |
| RV1 (1), RV7, the runner's bytes | The real double build, once, recorded in quickstart.md ("The same, again, after the security review's fixes"): with `--ignore-scripts` and freshly downloaded runtimes, both builds of `42c27ef` give the bytes recorded before. |

**Checked and found to hold** (the reviewer's list)

- The second build records its own build's checksums, never the download's, and only when its
  build, the downloaded files and `SHA256SUMS` all agree; nothing is read again after comparing.
- `SHA256SUMS` must be exactly two lines in order. Gzip with data after it, a cut-off file and an
  empty file are refused. Both sides hash the unpacked file.
- The branch check cannot be fooled by a tag named like a branch, or the reverse: full ref names.
  A tag pushed twice or moved fails safe. No `${{ }}` inside a `run:`. Every output line is held to
  a pattern.
- The version grammar: the shell and JavaScript agree on 58 strings and 324 ordered pairs under
  bash 3.2, dash, zsh, BusyBox, Debian's dash and Alpine. A number of 20 digits never gives a wrong
  order. `"0.1.0\n"` is refused.
- The installer's protections U1, U2 and U3 of feature 004 hold under both shells. Hostile answers
  from `getconf`, `ldd`, `df` and a runner's standard error run nothing and leave nothing behind.
- A server's claimed version never goes into the script; there is no way to put an older runner in
  place.
- The compiled runner and CLI ignore `.env`, `bunfig.toml`, `tsconfig.json` and `package.json` in
  the folder they start in, its parent, the home folder and the configuration folder.

**Noticed while fixing, not part of the review**

- `release.ts files` still starts the built runner in the release job, with the job's environment.
  Code bundled into the runner runs there, beside the token; that is part of what Q11 removes.
  Giving that process fewer variables would only slow such code down, since the files GitHub reads
  between steps can be found without them. Not changed.
- The branch rules of part 1 do not include **Restrict updates**. On `dev` and `main` it would stop
  a push by anyone but the admins, the workflow's token included, and also every merge by someone
  else. Not in the decided fix; for the maintainer to choose.
- The second build writes `runner-release.json` in one write, not by a rename. If that write failed
  part way, status 3 says to check the file with `git diff`.
- Bun still reads its own configuration files in the home folder (`~/.bunfig.toml`, `~/.npmrc`)
  during the second build, as every Bun command on that machine does. The install needs `HOME` to
  find Bun's package cache.
- The record cleans the commit's subject to printable ASCII, so a letter such as `é` is shown as
  `?`.

**Not checked by any review of this feature**

- Either workflow running on GitHub; the rulesets, the environment `prod` and the token's real
  permissions there; the answers of the `gh api` calls (checked against the documentation only).
- The release jobs' first step under GitHub's bash 5; it was run under bash 3.2 on macOS only.
- Whether a build on GitHub equals one on macOS (the first release shows it).
- What immutable releases do to a release made again on a kept tag (Q1).
- Where Bun downloads its Linux runtimes from, and whether it checks them (Q12).
- The installer under bash 4.2 beyond its version check, which was run in a container.

**Open, for the maintainer**

- RV1's last part: split each release job (research Q11). Recommended before the first release.
- Q12: whether to check Bun's runtimes against Bun's published checksums.
- Whether to add **Restrict updates** to the rules for `dev` and `main` (above).
- The landing page copy on signed releases (RV12).
- An external audit is still required before anything here is relied on.
