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
ZEKNO_REAL_BUILD=1 bun test apps/runner/test/second-build.test.ts   # needs the network; builds HEAD twice
```

Expected: a full match writes `runner-release.json` and prints the record and the next commands;
any difference, in any of the three places, exits with status 1, names the file and writes
nothing. The real build gives the same bytes twice.

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
maintainer's server (Linux x86-64, root, Docker with Compose, no runner):

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
- A server downloads about 49 MB and needs about 160 MB free while installing, and must reach
  github.com over HTTPS.
- Linux with glibc 2.17 or newer only; x86-64 with SSE4.2, or ARM64. Not Alpine.

## Results

Filled in by tasks T017, T028, T029, T039 and, after the maintainer's steps, T040 to T042.
