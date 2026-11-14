# Release Contract

How a runner release is started, checked, built and published, and what it contains. The second
build is in [second-build.md](./second-build.md); what a person is told is in
[versions.md](./versions.md). This replaces "The release workflow" of feature 004's
contracts/commands.md.

## Versions and tags

A version matches, exactly:

```text
^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-dev\.[1-9][0-9]{0,8})?$
```

A tag is `runner-v` followed by a version, and nothing else. A version with `-dev.<n>` is a **dev**
release; without, a **prod** release. Order and examples: data-model.md, "Version".

`packages/core/src/version.ts` exports:

| Name | Does |
|------|------|
| `RUNNER_VERSION_PATTERN` | the pattern above, as a `RegExp` |
| `parseRunnerVersion(text)` | `{ major, minor, patch, dev }` (`dev` a number, or `undefined` for prod), or `undefined` when `text` is not a version |
| `compareRunnerVersions(a, b)` | negative when `a` is older, `0` when equal, positive when newer; throws when either is not a version |
| `isDevVersion(text)` | true for a valid dev version |

`RunnerVersionSchema` in `protocol.ts` uses `RUNNER_VERSION_PATTERN`. The module imports nothing.

### The installer's copy

The script in `apps/cli/src/install.ts` keeps its own check, so that a value that got past the CLI
and the transport is refused on the server too (feature 004, security review: three checks).

- The script sets `LC_ALL=C` and exports it before anything else, whatever locale SSH passed on:
  in a UTF-8 locale bash 4.2's `[0-9]` also matched digits of other scripts (security-review.md,
  RV8).
- `is_version <v>`: true exactly when `<v>` matches the pattern above. Written with `case`, `expr`,
  `cut` and `sed` only: no `${`, no backquote, no `[[`, nothing outside POSIX `sh`.
- `is_newer <a> <b>`: true exactly when `a` is newer than `b` in the order above. Both are checked
  with `is_version` first; it is never called otherwise.
- A found runner's version: the first line of `<runner> version`, cut to 200 characters, read with
  `sed -n 's/^{"version":"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\(-dev\.[0-9][0-9]*\)\{0,1\}\)",.*$/\1/p'`,
  then kept only if `is_version` accepts it, else `unknown`.
- The script's line `runner found <system|user|path|target> <version|unknown>` is read by the CLI
  with the same grammar.

## The workflow: `.github/workflows/runner-release.yml`

Runs on `push` of tags `runner-v*`. `permissions: {}` at the top; each job asks for its own.
`concurrency: runner-release-${{ github.ref }}`, never cancelled. Actions stay pinned to the full
commits they use today (`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`, v4.4.0;
`oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`, v2.2.0). Every value from an expression
reaches a shell only through an environment variable. Every install is `bun install
--frozen-lockfile --ignore-scripts`, so no package's install script runs, here or in the second
build. No secret but the default token. It can write only in the two release jobs; there,
`actions/checkout` gets it by default to read the repository and keeps none of it
(`persist-credentials: false`), and only the publish step names it in its environment. Code that
runs earlier in a release job could still reach the publish step through what GitHub carries from
step to step: splitting each release job waits for the maintainer (research.md, Q11).

| Job | Runs when | Environment | Permissions | Steps |
|-----|-----------|-------------|-------------|-------|
| `check` | always | none | `contents: read` | checkout with `fetch-depth: 0` and `persist-credentials: false`; read the Bun pin from the root `package.json` (`^bun@[0-9]+\.[0-9]+\.[0-9]+$`); set up that Bun; `bun install --frozen-lockfile --ignore-scripts`; `bun apps/runner/scripts/release.ts check --tag "$TAG" >> "$GITHUB_OUTPUT"` |
| `release-dev` | `needs.check.outputs.environment == 'dev'` | none | `contents: write` | first, before any checkout: the tag itself must be a dev tag (below), which gives the version; checkout (one commit, `persist-credentials: false`); read the Bun pin as `check` does; set up that Bun; `bun install --frozen-lockfile --ignore-scripts`; with `working-directory: apps/runner`, `bun run compile:linux-x64` and `bun run compile:linux-arm64`; `bun apps/runner/scripts/release.ts files --tag "$TAG" --commit "$COMMIT" --bun "$BUN"`; publish as a pre-release |
| `release-prod` | `needs.check.outputs.environment == 'prod'` | `prod` (waits for approval before its first step) | `contents: write` | the same as `release-dev`, with a prod tag; publish as a release |

`check` outputs `environment`, `version`, `commit` and `bun`, from the four lines `release.ts
check` prints. The release jobs do not take its word for anything a changed tool could turn. Each
works out from the tag itself, in its first step, before anything is checked out, set up or
installed, that the tag is of its own kind, with bash's `[[ =~ ]]` in the C locale:

```text
release-dev:  ^runner-v((0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})-dev\.[1-9][0-9]{0,8})$
release-prod: ^runner-v((0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8}))$
```

Otherwise it stops with `This tag is not runner-v<x.y.z>-dev.<n>. This job publishes development
releases only.` (or `runner-v<x.y.z>` and `prod releases`), which does not repeat the tag. The
version it matched is the one published. The Bun version is read from the commit in the job
itself. Only `commit` is taken from `check`, and `release.ts files` stops unless the checkout is
that commit.

Publishing, in `apps/runner/dist`, with `GH_TOKEN` set to the default token:

```sh
gh --version
if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "A release for $TAG already exists. A version is released once." >&2
  exit 1
fi
gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --verify-tag \
  --title "zekno-runner $VERSION" --notes-file RELEASE-NOTES.md \
  [--prerelease --latest=false]   # release-dev only
  zekno-runner-linux-x64.gz zekno-runner-linux-arm64.gz SHA256SUMS RELEASE-NOTES.md
```

Nothing is published when any step before fails. Recording the checksums in the CLI is not part
of the workflow.

## `apps/runner/scripts/release.ts`

`bun apps/runner/scripts/release.ts <command> [options]`. Run from anywhere in the repository; paths
are taken from `git rev-parse --show-toplevel`. Messages are one sentence each on standard error.

Exit status, for every command: `0` passed; `1` refused (a check failed; nothing to publish); `2`
wrong usage (an unknown command or option, a missing value).

### `check --tag <tag> [--remote <name>]`

`--remote` defaults to `origin`. Checks, in this order, stopping at the first that fails:

| # | Check | Refusal |
|---|-------|---------|
| 1 | `<tag>` is `runner-v<version>` | `The tag <tag> is not runner-v<x.y.z> or runner-v<x.y.z>-dev.<n>.` |
| 2 | `git rev-parse HEAD` equals `git rev-parse <tag>^{commit}` | `The checked-out commit <a> is not the commit <tag> points to, <b>.` |
| 3 | `git merge-base --is-ancestor HEAD <remote>/<branch>`, `<branch>` `dev` for a dev tag and `main` for a prod tag. Status 1 refuses; another non-zero status is an error | `<tag> is a <dev\|prod> release, so its commit must be on <branch>. Commit <12 hex> is not on <remote>/<branch>.` or `Could not tell whether commit <12 hex> is on <remote>/<branch>. Is <remote>/<branch> in this checkout?` |
| 4 | `apps/runner/package.json` `version` equals the tag's version | `The tag says <v>, but apps/runner/package.json says <w>.` |
| 5 | The root `package.json` `packageManager` is `bun@<x.y.z>` | `The root package.json does not pin a Bun version.` |
| 6 | Prod only: `apps/cli/src/runner-release.json` `version` is not a dev version | `apps/cli/src/runner-release.json names <v>, a development release. A commit on main must not carry one.` |

On success it prints exactly these four lines on standard output:

```text
environment=<dev|prod>
version=<version>
commit=<40 lowercase hex>
bun=<x.y.z>
```

### `files --tag <tag> --commit <40 hex> --bun <x.y.z> [--dir <dir>] [--runner <path>]`

`--dir` defaults to `apps/runner/dist`; `--runner` to `<dir>/zekno-runner-linux-x64` (the binary
asked for its version; GitHub's machine is x86-64).

| # | Step | Refusal |
|---|------|---------|
| 1 | The tag is valid; `git rev-parse HEAD` equals `--commit` (the tag itself is not looked up: a one-commit checkout may not hold it) | as `check` 1; `The checked-out commit <a> is not <commit>.` |
| 2 | `zekno-runner-linux-x64` and `zekno-runner-linux-arm64` are regular files in `<dir>`, 1 byte to 256 MiB each | `<name> was not built.` or `<name> is larger than 256 MiB.` |
| 3 | `<runner> version`, input closed, at most 10 seconds: its first line parses as `RunnerVersion` and its `version` is the tag's (FR-011) | `The built runner says <first line, cleaned, at most 200 characters>, not version <v>.` |
| 4 | Writes `SHA256SUMS` (data-model.md), the two `.gz` files (gzip, level 9; each checked to unpack to the same bytes) and `RELEASE-NOTES.md` (below) into `<dir>` | `Could not write <name>.` |

On success it prints the four file names, then the content of `SHA256SUMS`.

### `check-main`

Reads `apps/runner/package.json` and `apps/cli/src/runner-release.json` from the working tree. Both
versions must be prod versions. Otherwise, for each one that is not:
`<path> holds <v>, a development version. main must not carry one: before merging into main, commit the prod versions on dev (apps/runner/RELEASING.md).`

## The release's files

| File | Content |
|------|---------|
| `zekno-runner-linux-x64.gz` | the x86-64 runner, gzip |
| `zekno-runner-linux-arm64.gz` | the ARM64 runner, gzip |
| `SHA256SUMS` | data-model.md, "SHA256SUMS" |
| `RELEASE-NOTES.md` | the notes below; also the release's body |

Servers download `https://github.com/zekno-app/zekno/releases/download/runner-v<version>/zekno-runner-linux-<x64|arm64>.gz`
(unchanged). The other two files are for people and for the second build.

### `RELEASE-NOTES.md`

Exactly this text, with `<…>` filled in. The paragraph marked "dev only" is left out of a prod
release; the marker `<- dev only` itself is never part of the text.

```markdown
zekno-runner <version>, a <development release|release> built from commit <40 hex> with Bun <x.y.z>.

Pre-alpha and unaudited. Do not use it for anything you could not afford to lose.

This is a development release, for proving a runner on a real server. A zekno built from `main` never installs it.   <- dev only

## Built for

- Linux on x86-64 (`bun-linux-x64-baseline`): processors with SSE4.2, Intel Nehalem or AMD Bulldozer and newer.
- Linux on 64-bit ARM (`bun-linux-arm64`).
- The GNU C library (glibc) 2.17 or newer: Debian, Ubuntu, RHEL and similar. Not Alpine or other systems with musl.

These are what Bun documents for its Linux builds. What was tried is added below after the release.

## Checksums

SHA-256 of each unpacked file, as in `SHA256SUMS`:

    <64 hex>  zekno-runner-linux-x64
    <64 hex>  zekno-runner-linux-arm64

zekno installs this release only once these checksums are recorded in its
`apps/cli/src/runner-release.json`, after a second build on another machine produced the same files.

## Second build

Not made yet.
```

After the release, the maintainer replaces "Not made yet." with the second build's record and adds
a section "Tried on" with what was run where (SC-007), with `gh release edit <tag> --notes-file
<file>`.

## `apps/cli/src/runner-release.json`

Shape and rules: data-model.md, "In the CLI". Read by `apps/cli/src/runner-release.ts` with a strict
schema whose `version` uses `RUNNER_VERSION_PATTERN`. Written only by the second build.

## `.github/workflows/main-versions.yml`

Runs on `push` to `main` and on `pull_request` into `main`. `permissions: {}`, the one job
`contents: read`. Steps: checkout (pinned, `persist-credentials: false`); read the Bun pin; set up
Bun (pinned); `bun install --frozen-lockfile --ignore-scripts`; `bun apps/runner/scripts/release.ts
check-main`. It fails, and so marks the commit, when `main` carries a dev version. It reports and
does not stop a push on its own: it runs after the push, `[skip ci]` skips it, and a push made with
a workflow's token does not start it. The branch rule for `main` in apps/runner/RELEASING.md, part
1, makes its job `check-main` a required check for everyone but the admins.

## `apps/runner/package.json` scripts

| Script | Command |
|--------|---------|
| `compile` | `bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig src/main.ts --outfile dist/zekno-runner` |
| `compile:linux-x64` | `bun build --compile --target=bun-linux-x64-baseline --no-compile-autoload-dotenv --no-compile-autoload-bunfig src/main.ts --outfile dist/zekno-runner-linux-x64` |
| `compile:linux-arm64` | `bun build --compile --target=bun-linux-arm64 --no-compile-autoload-dotenv --no-compile-autoload-bunfig src/main.ts --outfile dist/zekno-runner-linux-arm64` |

The two autoload flags depend on open question Q5. The output names must stay as they are: the
binary embeds its file name, and the second build compares byte for byte.
