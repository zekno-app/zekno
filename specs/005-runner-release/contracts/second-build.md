# Second Build Contract

The command a maintainer runs on their own machine after a release was published. It is the only
thing that writes checksums into `apps/cli/src/runner-release.json` (FR-008).

```sh
bun apps/runner/scripts/second-build.ts runner-v<version>
```

One argument, the tag. No options. Run from anywhere inside the repository, on the branch the
release is recorded on: `dev` for a dev release, `main` for a prod release.

## What it does, in order

It stops at the first step that fails. Nothing is written before step 13.

| # | Step | Stops with (exit status) |
|---|------|--------------------------|
| 1 | Exactly one argument | `Usage: bun apps/runner/scripts/second-build.ts runner-v<version>` (2) |
| 2 | The tag is `runner-v<version>` (contracts/release.md) | `The tag <tag> is not runner-v<x.y.z> or runner-v<x.y.z>-dev.<n>.` (2) |
| 3 | The current branch (`git symbolic-ref --short HEAD`) is `dev` for a dev tag, `main` for a prod tag | `A <dev\|prod> release is recorded on <branch>. This checkout is on <name>.` (2) |
| 4 | `apps/cli/src/runner-release.json` has no uncommitted change | `apps/cli/src/runner-release.json has changes that are not committed. Commit or undo them first.` (2) |
| 5 | The file does not already record a newer version with checksums | `This branch already records runner <w>, newer than <v>. Nothing was changed.` (2) |
| 6 | The tag exists here (`git rev-parse <tag>^{commit}`) | `There is no tag <tag> here. Fetch it with: git fetch origin tag <tag>` (2) |
| 7 | The tag on GitHub points at the same commit (`git ls-remote origin refs/tags/<tag> refs/tags/<tag>^{}`, the peeled commit when the tag is annotated) | `The tag on GitHub points at <a>, the tag here at <b>.` (1); not reachable: `Could not ask GitHub where <tag> points.` (3) |
| 8 | `Bun.version` equals the `packageManager` pin in the root `package.json` of that commit | `The release was built with Bun <x>; this machine runs Bun <y>. Install Bun <x> and run this again.` (2) |
| 9 | `apps/runner/package.json` of that commit has the tag's version | `The commit of <tag> builds runner <w>, not <v>.` (1) |
| 10 | Downloads `zekno-runner-linux-x64.gz`, `zekno-runner-linux-arm64.gz`, `SHA256SUMS` and `RELEASE-NOTES.md` from `https://github.com/zekno-app/zekno/releases/download/<tag>/<name>`, the address servers use, over HTTPS only (every redirect too). At most 256 MiB for each `.gz` and for what it unpacks to, 4 KiB for `SHA256SUMS`, 64 KiB for the notes | `Could not download <name> (<HTTP status or reason>).` (3); `<name> is larger than <limit>.` or `<name> is not a gzip file.` (1) |
| 11 | `SHA256SUMS` is exactly in the form of data-model.md | `SHA256SUMS is not in the expected form.` (1) |
| 12 | The first line of `RELEASE-NOTES.md` names this version and this commit | `RELEASE-NOTES.md names <what it names>, not runner <v> from <commit>.` (1) |
| 13 | Builds the commit: `git archive --format=tar <commit>` unpacked into a new temporary folder; there `bun install --frozen-lockfile`; then in its `apps/runner`, `bun run compile:linux-x64` and `bun run compile:linux-arm64` (the same scripts and output names as the workflow) | `The build failed at <step>.` with that step's output (3) |
| 14 | For each of the two binaries, three SHA-256 values: this build, the downloaded file unpacked, its line in `SHA256SUMS` | (below) |

## The result

- **All six pairs agree** (each file: this build = downloaded = `SHA256SUMS`):
  - If the file already records this version with these checksums: `Already recorded. Nothing was
    changed.`, exit status 0.
  - If it records this version with other checksums: treated as a mismatch (exit status 1), nothing
    written.
  - Otherwise it writes `apps/cli/src/runner-release.json` (two-space JSON, keys in the order
    `version`, `files`, `linux-x64`, `linux-arm64`, a line feed at the end). In the operating
    system's temporary folder it writes a commit message (the subject `chore(cli): install runner
    <version>`, a blank line, the record) and the release notes with the record in place of "Not
    made yet.". It prints the record, then exactly:

    ```text
    Recorded runner <version> in apps/cli/src/runner-release.json. Next, on <branch>:
      git add apps/cli/src/runner-release.json
      git commit -F <commit message file>
      git push origin <branch>
      gh release edit <tag> --repo zekno-app/zekno --notes-file <notes file>
    ```

    Exit status 0. It runs none of these commands itself.
- **Any pair differs**: it prints the record (below), with each file that differs marked, keeps the
  temporary folder with its own build and the downloaded files and prints its path, writes the
  notes with the mismatch record, writes nothing to `runner-release.json`, and exits with status 1.
  The release is then not usable by any CLI. What happens next is the maintainer's decision
  (plan.md, "If GitHub's build differs from the maintainer's").

The temporary folders are removed on every other way out.

## The record

```markdown
Second build of runner-v<version> (<dev|prod>): <matched|did not match>.

Commit <40 hex>, built from `git archive` with Bun <x.y.z> on <darwin|linux> <arm64|x64> by <git config user.name>, <YYYY-MM-DD>.

| File | This build | Downloaded | SHA256SUMS | Result |
|------|------------|------------|------------|--------|
| zekno-runner-linux-x64 | <64 hex> | <64 hex> | <64 hex> | <match or differs> |
| zekno-runner-linux-arm64 | <64 hex> | <64 hex> | <64 hex> | <match or differs> |

<matched:> The checksums are recorded in apps/cli/src/runner-release.json on <branch>.
<did not match:> Nothing was recorded. No zekno installs this release.
```

When `git config user.name` is empty, "by" and the name are left out.

## Exit status

| Status | Meaning | `runner-release.json` |
|--------|---------|-----------------------|
| 0 | Matched and recorded, or already recorded | written, or unchanged |
| 1 | Did not match: a file, the commit, the version, `SHA256SUMS` or the notes | unchanged |
| 2 | Wrong usage, or a condition on this machine (tag, branch, uncommitted file, Bun version, older than recorded) | unchanged |
| 3 | Could not be completed (network, build) | unchanged |

## For tests

`apps/runner/scripts/second-build.ts` exports `secondBuild(tag, deps)` and runs it only when
started as the main module (`import.meta.main`). `deps` gives: the repository root; a way to run
`git`; `download(name)` returning bytes or a failure; `build(commit)` returning the two binaries'
bytes or a failure; the Bun version; the date; the user name; the operating system and processor;
a temporary folder. The command wires the real ones. Tests use a temporary repository with a bare
`origin` for the git steps, files in a temporary folder for the release, and a stand-in build; no
network.
