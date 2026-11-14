# Quickstart: Runner Releases

How to check that this feature works. Formats are in [contracts/](./contracts) and
[data-model.md](./data-model.md); the maintainer's steps are in [plan.md](./plan.md) and
`apps/runner/RELEASING.md`.

## Checks (repository root)

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
```

## 1. Versions and the installer, on this machine

```bash
bun test packages/core/test/version.test.ts packages/core/test/scenarios/messages.test.ts
bun test apps/cli/test/install.test.ts          # the script under /bin/sh and /bin/dash
bun test apps/cli/test/first-run.test.tsx apps/cli/test/single-commands.test.tsx
git grep -n "0\.2\.0" -- ':!specs/' ':!bun.lock'  # prints nothing
```

Expected: the grammar accepts `0.1.0-dev.1` and refuses every form listed in data-model.md; the
shell's `is_newer` agrees with `compareRunnerVersions` on every pair; a dev runner is updated by a
prod CLI and never the reverse; a one-byte change is never installed; `fail tools`, `fail space`,
`fail libc` and `fail cpu` each stop with nothing put in place.

## 2. The workflow's logic, without GitHub

```bash
bun test apps/runner/test/release.test.ts apps/runner/test/workflow.test.ts
bun apps/runner/scripts/release.ts check-main   # on this branch: refuses, naming both files (they hold 0.1.0-dev.1)
```

Expected: `check` passes a dev tag on a commit of `dev` and a prod tag on a commit of `main`, and
refuses every other case with the sentence of contracts/release.md; `files` writes the four files
exactly; the workflow files keep their permissions, pins and environment.

## 3. The second build, without a release

```bash
bun test apps/runner/test/second-build.test.ts
ZEKNO_REAL_BUILD=1 bun test apps/runner/test/second-build.test.ts   # needs the network; builds HEAD twice, downloading Bun's Linux runtimes each time
```

Expected: a full match writes `runner-release.json` and prints the record and the next commands;
any difference, in any of the three places, exits with status 1, names the file and writes
nothing; a tag on a commit that is not on the branch here exits with status 1 before anything is
downloaded or built. The build runs no package's install script and gets only the variables of
contracts/second-build.md, "The build". The real build gives the same bytes twice.

## 4. The Linux runners

```bash
cd apps/runner && bun run compile:linux-x64 && bun run compile:linux-arm64 && cd ../..
ls -l apps/runner/dist/zekno-runner-linux-*
file apps/runner/dist/zekno-runner-linux-*
for f in apps/runner/dist/zekno-runner-linux-*; do strings -a "$f" | grep -oE '^GLIBC_[0-9.]+$' | sort -V | tail -1; done
```

Expected: each under 256 MiB (about 110 MB); interpreters `/lib64/ld-linux-x86-64.so.2` and
`/lib/ld-linux-aarch64.so.1`; highest symbol `GLIBC_2.17`.

## 5. Supported servers, in local containers

Needs Docker. The install script runs in `file` mode with the runner sent after it, and a stand-in
`docker` (a script that answers `docker compose version`) first on `PATH`:

| Image | Expected |
|-------|----------|
| `debian:12`, `--platform linux/arm64` | the runner answers `version`; `done user` |
| `debian:12`, `--platform linux/amd64` | the same (emulated on an ARM machine) |
| `centos:7` (glibc 2.17) | the same |
| `alpine:3` | `fail libc` before the file is read |

These stand in for the C library and the kind of processor. They do not stand in for the oldest
processor (SSE4.2) or for an old kernel.

## 6. The maintainer's steps

| Step | What to see |
|------|-------------|
| 1. Ruleset | Settings, Rulesets lists it as Active for `runner-v*`. From an account without the bypass role, `git push origin runner-v0.0.1-dev.1` is refused by GitHub (SC-006). |
| 2. Environment `prod` | Settings, Environments, `prod`: required reviewer, deployment tags `runner-v*`, administrators' bypass off. |
| 3. `runner-v0.1.0-dev.1` | The run shows `check` passed with `environment=dev`, then `release-dev`; the release is a pre-release, not latest, with four files. |
| 4. Second build on `dev` | `Second build of runner-v0.1.0-dev.1 (dev): matched.` and `runner-release.json` written; or status 1 and the plan stops. |
| 5. Real server | Below. |
| 6. `runner-v0.1.0` | `check` passes with `environment=prod`; `release-prod` waits for review; after approval the release is published as latest. |
| 7. Second build on `main` | matched; `runner-release.json` on `main` names `0.1.0` with both checksums. |

## 7. A real server (maintainer step 5)

With a CLI run from `dev` after step 4 (`bun apps/cli/src/main.ts`), a throwaway team, and the
maintainer's server (Linux x86-64, root, Docker with Compose, no runner). Run from source, the CLI
reads `.env` and `bunfig.toml` from the folder it is started in, as Bun does for any script: start
it that way only inside folders you trust, and use the compiled `zekno`
(`cd apps/cli && bun run compile`) anywhere else.

1. `zekno server add proof --ssh root@<server>`, no development option. Expected: the runner is
   downloaded from `runner-v0.1.0-dev.1`, checked, installed at `/usr/local/bin/zekno-runner`; the
   server code shown; under two minutes (SC-001).
2. `zekno secret set GREETING --stdin`, `zekno link`, `zekno deploy`. Expected: the app runs.
3. Note the container's id and start time on the server.
4. Put an older runner in place by hand: feature 003's runner (commit `536f24c`), built for
   Linux x86-64, copied over `/usr/local/bin/zekno-runner`.
5. `zekno status`: W1 of contracts/versions.md. `zekno server update proof`, answer `y`. Expected:
   replaced; `zekno status` says nothing about the version; the container has the same id and start
   time (SC-005); `zekno deploy` works and the secret is there.
6. Clean up as in feature 004: the container, its network, the image, the runner and
   `/var/lib/zekno`; the throwaway key and profile.

A server user that is not root and an ARM64 server are tried only if one is available; otherwise
the record says they were not, and points to section 5.

## Limits to remember

- Unaudited. Pre-alpha.
- The second build shows that GitHub's build service changed nothing. Both builds fetch the same
  packages and the same Bun runtimes, so it says nothing about those.
- A server downloads about 52 MB (49 MiB) and needs about 160 MB free while installing, and must
  reach github.com over HTTPS.
- Linux with glibc 2.17 or newer only; x86-64 with SSE4.2, or ARM64. Not Alpine.

## Results

Filled in by tasks T017, T028, T029, T039 and, after the maintainer's steps, T040 to T042.

### The second build's own build, twice (T017, 2026-11-14)

`ZEKNO_REAL_BUILD=1 bun test apps/runner/test/second-build.test.ts`, on this machine (macOS 27.0.1,
Apple silicon, `darwin arm64`), Bun 1.4.4. It ran `realBuild` of `apps/runner/scripts/second-build.ts`
twice, each in its own new temporary folder: `git archive` of the commit unpacked by `tar`,
`bun install --frozen-lockfile`, then `bun run compile:linux-x64` and `bun run compile:linux-arm64`
in `apps/runner`.

The commit built was `29ae797`, a commit object made from the working tree at the end of tasks
T001 to T020 (with `ZEKNO_REAL_BUILD_COMMIT`), on no branch. Its tree differs from the commit that
records these results only in files no build of the runner reads: `specs/005-runner-release/`, the
wrapping of three sentences in `apps/cli/README.md` and the docs pages, and two test files of
`apps/runner/test/`. `apps/runner/src`, `apps/runner/package.json`, `packages/core`, the root
`package.json` and `bun.lock` are the same.

| Build | `zekno-runner-linux-x64` SHA-256 | `zekno-runner-linux-arm64` SHA-256 | Took |
|-------|----------------------------------|------------------------------------|------|
| first | `fb68d252cb89956750c558123449954ff07f043b893a81efef3517aeb94463f6` | `5829b647353f7b71d5f99be61dbba0c9f946cbd0f1c773656cdc7ef9692c51b5` | 1.8 s |
| second | `fb68d252cb89956750c558123449954ff07f043b893a81efef3517aeb94463f6` | `5829b647353f7b71d5f99be61dbba0c9f946cbd0f1c773656cdc7ef9692c51b5` | 1.2 s |

- Identical, byte for byte, for both binaries.
- Sizes: `zekno-runner-linux-x64` 109,824,176 bytes, `zekno-runner-linux-arm64` 109,890,552 bytes,
  the same in both builds.
- The packages and Bun's Linux runtimes were already in Bun's cache on this machine, and the times
  are of builds that found them there. A build that has to download them was not timed.
- This shows two builds on one machine agree. Whether GitHub's Linux build agrees with a macOS
  build is known only at maintainer step 4 (plan.md, "If GitHub's build differs").

### The same, again, after the security review's fixes (2026-11-14)

The review (security-review.md, RV1 and RV7) changed how the second build builds: `bun install
--frozen-lockfile --ignore-scripts`, as the workflow now installs; only `HOME`, `PATH` (this Bun
first), a `TMPDIR` of its own and, for the compile steps, an empty `BUN_INSTALL_CACHE_DIR` of its
own, so each build downloads Bun's two Linux runtimes afresh. Run the same way:
`ZEKNO_REAL_BUILD=1 bun test apps/runner/test/second-build.test.ts -t "the real build gives the same bytes twice"`,
same machine, Bun 1.4.4.

The commit built was `42c27ef`. The commit that records these results changes no file the runner's
build reads: `apps/runner/src`, `apps/runner/package.json`, `packages/core`, the root
`package.json` and `bun.lock` are the same.

| Build | `zekno-runner-linux-x64` SHA-256 | `zekno-runner-linux-arm64` SHA-256 | Took |
|-------|----------------------------------|------------------------------------|------|
| first | `fb68d252cb89956750c558123449954ff07f043b893a81efef3517aeb94463f6` | `5829b647353f7b71d5f99be61dbba0c9f946cbd0f1c773656cdc7ef9692c51b5` | 7.2 s |
| second | `fb68d252cb89956750c558123449954ff07f043b893a81efef3517aeb94463f6` | `5829b647353f7b71d5f99be61dbba0c9f946cbd0f1c773656cdc7ef9692c51b5` | 6.1 s |

- The two builds agree, byte for byte, and the bytes did not change: they are the values recorded
  above for T017 and T028, so `--ignore-scripts` and the fresh runtimes make no difference to the
  runner. No recorded value was changed. Sizes as above.
- The runtimes each build downloaded, by SHA-256: `bun-linux-x64-baseline-v1.4.4`
  `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`, `bun-linux-aarch64-v1.4.4`
  `354c2b049c716aca07b2e5cddb887928ac58950675d1258bb6312083917793b6`, the same in both builds and
  the same as the copies in `~/.bun/install/cache` on this machine, dated 2026-11-14 19:18.
- The npm packages came from Bun's cache on this machine. Before the run, the same install in a
  copy of the commit was run with the network denied (`sandbox-exec`), and installed all 695
  packages: the runtimes were the only download.
- The times include the two downloads of each build.

### The Linux runners (T028, 2026-11-14)

Built on this machine (macOS, Apple silicon) with Bun 1.4.4, from `0158605` (the runner's sources,
`packages/core`, the root `package.json` and `bun.lock` are the same as in the commit built for
T017): `cd apps/runner && bun run compile:linux-x64 && bun run compile:linux-arm64`. Bun named the
runtimes it used `bun-linux-x64-baseline-v1.4.4` and `bun-linux-aarch64-v1.4.4`.

| | `zekno-runner-linux-x64` | `zekno-runner-linux-arm64` |
|---|---|---|
| Size | 109,824,176 bytes | 109,890,552 bytes |
| After `gzip -9 -n` | 51,845,154 bytes (49.4 MiB) | 51,767,220 bytes (49.4 MiB) |
| `file` | ELF 64-bit LSB executable, x86-64, dynamically linked, interpreter `/lib64/ld-linux-x86-64.so.2`, for GNU/Linux 3.2.0 | ELF 64-bit LSB executable, ARM aarch64, dynamically linked, interpreter `/lib/ld-linux-aarch64.so.1`, for GNU/Linux 3.7.0 |
| Highest `GLIBC_` (`strings -a … \| grep -oE '^GLIBC_[0-9.]+$' \| sort -V \| tail -1`) | `GLIBC_2.17` | `GLIBC_2.17` |
| Libraries it needs (`llvm-objdump -p`, `NEEDED`) | `libc.so.6`, `ld-linux-x86-64.so.2`, `libpthread.so.0`, `libdl.so.2`, `libm.so.6` | `libc.so.6`, `ld-linux-aarch64.so.1`, `libpthread.so.0`, `libdl.so.2`, `libm.so.6` |
| SHA-256 | `fb68d252cb89956750c558123449954ff07f043b893a81efef3517aeb94463f6` | `5829b647353f7b71d5f99be61dbba0c9f946cbd0f1c773656cdc7ef9692c51b5` |

- The highest symbol version is `GLIBC_2.17` in both, by `strings` as the task names it and by the
  version references `llvm-objdump -p` lists. "glibc 2.17 or newer" in the release notes and the
  installer's 2.17 hold for these builds.
- Each file is under the installer's 256 MiB (268,435,456 bytes) and so is each `.gz`. The `.gz`
  files are 51.8 MB, which is 49.4 MiB: "about 49 MB" in the decisions is MiB.
- The SHA-256 values are those T017 recorded for its two builds.

### Supported servers, in local containers (T029, 2026-11-14)

Docker Desktop on this machine (engine 29.6.1, its Linux virtual machine on kernel
6.12.76-linuxkit, ARM64; `linux/amd64` containers are emulated). The script was run as the CLI runs
it, in `file` mode: `docker run -i --rm --platform <platform> <image> sh -s -- add 0.1.0-dev.1 file <sha256>`,
with `INSTALL_SCRIPT` on standard input and the runner file of T028 sent only after `ready`, and a
stand-in `docker` that answers `docker compose version` mounted first on `PATH`. Each container
runs as root, so the runner goes to `/usr/local/bin/zekno-runner`.

| Image (digest) | Platform | What the image says | Runner sent | Result |
|----------------|----------|---------------------|-------------|--------|
| `debian:12` (`sha256:268fb24c…3ff8`), Debian 12 | `linux/arm64` | `getconf GNU_LIBC_VERSION`: `glibc 2.36` | arm64 | the runner answered `version` from the temporary folder and again in place: `install ok`, `version ok`, `done system` (1.2 s) |
| `debian:12` | `linux/amd64` | `glibc 2.36` | x64 | the same (2.9 s) |
| `centos:7` (`sha256:be65f488…18ea4`), CentOS 7.9.2009 | `linux/arm64` | `glibc 2.17` | arm64 | the same (1.0 s) |
| `centos:7` | `linux/amd64` (added: the x86-64 file on glibc 2.17) | `glibc 2.17` | x64 | the same (2.7 s) |
| `alpine:3` (`sha256:f59abe65…71bf`), Alpine 3.24.4 | `linux/arm64` | `getconf`: `getconf: GNU_LIBC_VERSION: unknown variable`; `ldd --version`: `musl libc (aarch64)` | arm64 | `fail libc` straight after `platform ok arm64`: before `ready`, so the file was never read, and nothing was created (0.2 s) |
| `alpine:3`, with stand-in `getconf` and `ldd` that answer nothing (added: the check after the download) | `linux/arm64` | no answer | arm64 | `ready`, `download ok 109890552`, `checksum ok`, then `fail libc`; on standard error, passed on: `sh: /usr/local/bin/.zekno-install.HMdglC/zekno-runner: not found` (the runner exited with status 127) (1.7 s) |

- Run directly in `alpine:3`, the ARM64 runner exits with status 127 and the shell writes
  `sh: /r/zekno-runner: not found`: there is no `/lib/ld-linux-aarch64.so.1` on a musl system. This
  is what the installer reads as `libc` after the checksum.
- These containers stand in for the C library and the kind of processor only. They do not stand
  in for the oldest processor: the emulated x86-64 processor reports `sse4_2`, so `fail cpu` was not
  met. They do not stand in for an old kernel either: every container ran on the same 6.12 kernel
  (SC-007).
- The driver used is a script outside the repository; it imports `INSTALL_SCRIPT` from
  `apps/cli/src/install.ts` and adds nothing to it.
