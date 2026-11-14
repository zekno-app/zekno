# Data Model: Runner Releases

Everything from feature 004's data model still holds, except what this page changes. The exact
formats are in [contracts/](./contracts).

## Version

A runner version, as the runner reports it, as a tag carries it, and as the CLI holds it.

```text
^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-dev\.[1-9][0-9]{0,8})?$
```

| Field | Rule |
|-------|------|
| text | matches the pattern above: three numbers of 1 to 9 digits with no leading zero (or `0`), optionally `-dev.` and a count from 1, with no leading zero |
| kind | **prod** when it is three numbers; **dev** when it ends in `-dev.<count>` |
| order | The three numbers as numbers, left to right. Same three numbers: dev is older than prod. Two dev versions: by count. |

Examples in order: `0.0.9 < 0.1.0-dev.1 < 0.1.0-dev.2 < 0.1.0-dev.10 < 0.1.0 < 0.1.1-dev.1 < 0.1.1 < 0.2.0 < 0.10.0 < 1.0.0-dev.1 < 1.0.0`.

Refused: `0.1`, `0.1.0.1`, `01.1.0`, `0.01.0`, `0.1.00`, `0.1.0-dev`, `0.1.0-dev.0`, `0.1.0-dev.01`,
`0.1.0-dev.1.2`, `0.1.0-rc.1`, `0.1.0-DEV.1`, `0.1.0+1`, `v0.1.0`, `1000000000.0.0`,
`0.1.0-dev.1000000000`, an empty string, and anything with a space or a line break.

Defined once, in `packages/core/src/version.ts`, and used by the protocol, the CLI and the release
scripts. The installer script carries its own copy in `sh` (contracts/release.md, "The installer's
copy").

## Environment

| | dev | prod |
|---|---|---|
| Version kind | dev (`0.1.0-dev.1`) | prod (`0.1.0`) |
| Tag | `runner-v<x.y.z>-dev.<n>` | `runner-v<x.y.z>` |
| Commit must be on | `origin/dev` | `origin/main` |
| On GitHub | a pre-release, never "latest" | a release |
| Approval | none | the Environment `prod`, required reviewer the maintainer |
| `runner-release.json` on that branch names | a dev version | a prod version, never a dev one |
| Installed by | a CLI built from `dev` | a CLI built from `main` |

The environment is never chosen by a person using Zekno; it follows from the branch the CLI was
built from.

## Release

One version of the runner as published on GitHub at
`https://github.com/zekno-app/zekno/releases/tag/runner-v<version>`.

| Field | Content |
|-------|---------|
| tag | `runner-v<version>` |
| environment | from the version's kind |
| commit | the 40-hex commit the tag points to, built by the workflow |
| files | `zekno-runner-linux-x64.gz`, `zekno-runner-linux-arm64.gz`, `SHA256SUMS`, `RELEASE-NOTES.md` |
| title | `zekno-runner <version>` |
| notes | the text of `RELEASE-NOTES.md`, later followed by the second build's record and what was tried |
| flags | dev: pre-release, not latest. prod: neither |

A version is released once. A release is never replaced; a withdrawn one keeps its tag and its
version is not used again.

### SHA256SUMS

Exactly two lines, the output format of `sha256sum` (two spaces), for the **unpacked** binaries, in
this order, each ending with a line feed:

```text
<64 lowercase hex>  zekno-runner-linux-x64
<64 lowercase hex>  zekno-runner-linux-arm64
```

After `gunzip -k *.gz`, `sha256sum -c SHA256SUMS` checks both files.

## In the CLI: `apps/cli/src/runner-release.json`

Unchanged in shape; the version follows the new grammar.

```json
{ "version": "0.1.0-dev.1", "files": { "linux-x64": { "sha256": null }, "linux-arm64": { "sha256": null } } }
```

| Field | Rule |
|-------|------|
| `version` | A Version. The one version this build of the CLI installs (FR-017). |
| `files.linux-x64.sha256`, `files.linux-arm64.sha256` | 64 lowercase hex characters, or `null` |

Strict: no other field. Both checksums are written together, and only by the second build after a
full match. `null` means nothing to install: the CLI says it has no published runner (FR-007).

### How it moves through the first releases

| When | On `dev` | On `main` |
|------|----------|-----------|
| This feature merged into `dev` | `0.1.0-dev.1`, `null`, `null` | (as today) |
| Maintainer step 4: second build of `runner-v0.1.0-dev.1` matched | `0.1.0-dev.1`, two checksums | |
| Maintainer step 6: prod versions committed on `dev`, merged into `main` | `0.1.0`, `null`, `null` | `0.1.0`, `null`, `null` |
| Maintainer step 7: second build of `runner-v0.1.0` matched | | `0.1.0`, two checksums |
| Withdrawing a release | the same version, `null`, `null` | the same version, `null`, `null` |

The runner's own version, `apps/runner/package.json` `version`, moves separately: it is what the
next tag must say. It is `0.1.0-dev.1` on `dev` when this feature is merged, and `0.1.0` from
maintainer step 6.

The second build refuses to record: a dev version anywhere but on `dev`; a prod version anywhere but
on `main`; a tagged commit that is not on that branch as the maintainer's checkout has it; a
version older than one already recorded with checksums; the same version with other checksums than
those recorded.

## Second build record

Printed by the second build and written to a file it names, then added to the release notes by the
maintainer (contracts/second-build.md, "The record").

| Field | Content |
|-------|---------|
| release | the tag and its environment |
| commit | the commit built, equal locally, on GitHub, and in the release notes, and on the release's branch locally; with its one-line subject, cleaned to printable ASCII and cut to 100 characters, for the maintainer to compare with the commit they tagged |
| made by | `git config user.name`, the operating system and processor, the Bun version, the date |
| per file | the SHA-256 of the own build, of the downloaded and unpacked file, and the line of `SHA256SUMS`; `match` or `differs` |
| result | `matched` (checksums recorded) or `did not match` (nothing recorded) |

## Supported servers

What the release notes name (research R3), and what the installer checks.

| Need | From | Checked by the installer |
|------|------|--------------------------|
| Linux on x86-64 or ARM64 | the build targets | `uname -sm` (as before), `fail platform` |
| x86-64: SSE4.2 (Intel Nehalem, AMD Bulldozer or newer) | Bun's docs | after the download: the runner killed by an illegal instruction, `fail cpu` |
| GNU C library 2.17 or newer; not musl (Alpine) | Bun's docs and the binaries' symbols | before the download: `getconf`, `ldd`; after: exit status 127 or `GLIBC_` on standard error; `fail libc` |
| Docker with Compose | the runner | as before, `fail docker` |
| About 160 MB free in the runner's folder while installing | the file sizes | a failed download or unpacking with under 256 MiB free: `fail space` |
| `curl` or `wget`, `gzip`, `sha256sum` or `shasum` | the script | as before; the checksum tool now before the download |

## Installer failures

Feature 004's list, plus three. Each is one line, `fail <word>`, read strictly by the CLI.

| Word | New | Said (contracts/versions.md) |
|------|-----|------------------------------|
| `usage`, `name`, `newer`, `docker`, `home`, `missing`, `platform`, `release`, `download`, `checksum`, `install`, `version`, `folder` | no | as in feature 004 |
| `tools` | wording | now said before anything is downloaded |
| `libc` | yes | the server lacks glibc 2.17 or newer |
| `cpu` | yes | the processor lacks an instruction the runner needs |
| `space` | yes | not enough free disk space in the runner's folder |

## A runner against the CLI that reaches it

| Relation | When | `u` in the app | `zekno server update` |
|----------|------|----------------|------------------------|
| same | the runner reports exactly the CLI's version | no | "already has version …", nothing changed |
| older | it reports no version (no sessions), or a version before the CLI's | yes | replaces it |
| newer | it reports a version after the CLI's | no | refuses, nothing changed |

What does not work until an older runner is updated: with no sessions, running state and logs;
with sessions and a lower protocol number, "some of what this zekno does"; with the same protocol,
nothing. A newer runner with the same protocol works; with a higher protocol, the developer is told
to update zekno before deploying. Sentences: contracts/versions.md.
