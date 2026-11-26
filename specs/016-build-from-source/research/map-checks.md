# Map: where and how building from source is checked on Linux

**Feature**: 016-build-from-source · **Written**: 2026-11-27 · **For**: the plan (FR-089, FR-089a, FR-089b, FR-090, FR-091; maintainer steps M4 to M9; decision D10).

**Status**: a proposal. Nothing here is built. No workflow was added and no file under `apps/` or `packages/` changed. Each fact is marked:

- **[read]**: read in this repository.
- **[looked up]**: read on the web on 2026-11-27, with its source.
- **[ran]**: run on this Mac on 2026-11-27, in throwaway containers that were removed afterwards.

## Short answer

1. GitHub's Linux machines do not carry Docker Engine 29.5. `ubuntu-24.04` has 28.0.4, `ubuntu-26.04` has 29.4.2 (part 3). So the check brings its own engines.
2. Recommended way: one **server stand-in**, the same on GitHub and on the Mac. It is a privileged Ubuntu 24.04 container, pinned by digest, with Docker's own packages installed at exact versions from Docker's signed apt repository (part 4, option C). It took 24 seconds to install and 1 second to start on this Mac [ran].
3. The stand-in gives every engine the plan needs: the floor (29.5.0), an older engine (29.4.3, and Ubuntu's own `docker.io`), and the newest. It gives both image stores, and a 1 GB memory limit for the out-of-memory stand-in. The runner's Linux build runs inside it, as on a server [ran].
4. **A finding that touches FR-034**: `--build-arg BUILDKIT_SYNTAX=dockerfile.v0` did **not** make the builder ignore a `# syntax=` line on Engine 29.5.3 or on 29.10.1. The builder looked for an image `docker.io/library/dockerfile.v0` and failed (part 5, T4). This was one trial, on ARM64, inside Docker Desktop's VM. The plan's first check must repeat it on GitHub before anything rests on research claim 1.
5. The workflow: five jobs on `ubuntu-24.04`, seven runs with their matrices, started by every push to a branch and by pull requests from forks. Two more jobs, on ARM64 and on macOS, are proposed for the maintainer. They run in parallel, each with a time limit, and should take 25 minutes or less from start to end. It has no repository secret, no write permission, no `environment`, and nothing that reaches the maintainer's server (part 8).
6. The maintainer's server is used once, at the end of step 2, for what no container can show: a real domain with a real certificate, the real update path over real SSH from a Mac, and the server's own Docker as it was installed (part 9).

## 1. What was read, looked up and ran

| Kind | What | Where from |
|---|---|---|
| [read] | spec.md (FR-034a, FR-036 to FR-037h, FR-040, FR-041, FR-089 to FR-091, SC-003, SC-013, SC-016, SC-018, Assumptions, M1 to M10) | this branch |
| [read] | research.md parts 1, 2, 5, 6, 7.2, 8 | this branch |
| [read] | `.github/workflows/pull-request-checks.yml`, `main-versions.yml`, `runner-release.yml` | this branch |
| [read] | `apps/runner/RELEASING.md` | this branch |
| [read] | the real-Docker tests and their gates: `apps/runner/test/support/real-docker.ts`, `apps/runner/test/scenarios/real-proxy.test.ts`, `apps/runner/test/support/older-programs.ts`, `apps/cli/test/scenarios/real-docker.test.ts`, `templates-real-docker.test.ts`, `apps/cli/test/templates/docker.test.ts`, `workflow.test.ts`, `apps/cli/tests/real-docker.e2e.ts`, `apps/cli/e2e.config.ts` | this branch |
| [read] | `apps/runner/src/docker/compose.ts` (`DOCKER_HOST` passes through to Docker), `apps/runner/package.json` (compile scripts), `apps/cli/src/version/runner-release.json` (0.1.1 and its checksums), `apps/cli/src/server/install/script.ts` (the release address) | this branch |
| [read] | `.specify/memory/constitution.md` (II, VII, dependencies) | this branch |
| [looked up] | GitHub's runner image software lists: `images/ubuntu/Ubuntu2404-Readme.md`, `Ubuntu2604-Readme.md`, `Ubuntu2204-Readme.md` | `github.com/actions/runner-images`, branch `main`, read 2026-11-27 |
| [looked up] | the ARM64 image's list (`images/arm-ubuntu-24-image.md`): Docker, Compose and Buildx are listed, with no versions | `github.com/actions/partner-runner-images`, read 2026-11-27 |
| [looked up] | GitHub's runner sizes and price for public repositories | `docs.github.com/en/actions/reference/runners/github-hosted-runners`, read 2026-11-27 |
| [looked up] | Docker's apt repository for Ubuntu 24.04: every `docker-ce`, `docker-buildx-plugin`, `docker-compose-plugin` and `containerd.io` version, amd64 and arm64 | `download.docker.com/linux/ubuntu/dists/noble/stable/binary-{amd64,arm64}/Packages`, read 2026-11-27 |
| [looked up] | Ubuntu 24.04's own packages `docker.io`, `docker-buildx`, `docker-registry` | `archive.ubuntu.com`, `noble` and `noble-updates`, universe, read 2026-11-27 |
| [looked up] | that the tags `docker:29.5.3-dind`, `29.4.3-dind`, `29.10.1-dind`, `28.0.4-dind` and `ubuntu:24.04` exist, and their digests | Docker Hub's registry, read 2026-11-27 |
| [looked up] | Docker Hub's pull limits for GitHub's machines | `docs.github.com/en/enterprise-server@3.20/actions/reference/limits`, `github.com/orgs/community/discussions/130794`, `docs.docker.com/docker-hub/usage/pulls/`; a web search, 2026-11-27 |
| [looked up] | the `BUILDKIT_SYNTAX` row of the Dockerfile reference | `docs.docker.com/reference/dockerfile/`, read 2026-11-27 |
| [ran] | the trial of part 5 | this Mac: Docker Desktop 29.6.1, linux/arm64, 12 CPUs, 8 GB for its VM, kernel 6.12.76-linuxkit |

## 2. What runs today, and what it skips

[read]

| What | Where it runs | Docker | What it skips on GitHub |
|---|---|---|---|
| `pull request checks` | `ubuntu-24.04`, on `pull_request` only, 30 minutes | the machine's own (28.0.4) | Nothing is skipped by switch. The real-Docker tests below skip themselves. |
| `main versions` | `ubuntu-24.04`, push and pull requests to `main` | none | |
| `runner release` | `ubuntu-24.04`, on a `runner-v*` tag | none (it compiles the runner for x86-64 and ARM64) | |
| Runner unit and scenario tests | `bun run test` | a fake Docker (`ZEKNO_DOCKER` points at a script) | |
| Runner real-proxy tests (015, T033) | where Docker answers | the machine's own, never pulls | Skipped: the pinned Caddy image is not on GitHub's machine, and the set never pulls it. |
| CLI `real-docker.test.ts`, `templates-real-docker.test.ts` | where Docker answers | the machine's own, never pulls | Skipped: `caddy:2.11.9` and the template images are not on the machine. |
| CLI template tests (`test:templates`) | the pull request check | the machine's own, pulls by digest from Docker Hub | Runs. It is today's only check with real Docker on GitHub. |
| Pairing tests (014) | `bun run test` | fake | Need the whole history (`fetch-depth: 0`), which the pull request check fetches. |
| CLI end-to-end tests (`test:e2e`, `test:e2e:docker`) | by hand only | the machine's own | They need a model gateway key from `.env.local`, a secret. They must never be part of the new check. |
| Second build's real build | by hand (`ZEKNO_REAL_BUILD=1`) | none | |

So today no runner check uses real Docker on GitHub. The new check is the first. The tests that run real Docker call the machine's own `docker`. To run them in the stand-in, they call `docker exec <stand-in> docker …` instead (part 6).

## 3. Docker on GitHub's Linux machines today

[looked up] from `github.com/actions/runner-images`, branch `main`, on 2026-11-27. The lists are written by each image build. GitHub updates the images about once a week.

| Label | Image version | Docker client and server | Buildx | Compose |
|---|---|---|---|---|
| `ubuntu-24.04` (the one our workflows use) | 20261116.376.1, kernel 7.0.0-1017-azure | 28.0.4 | 0.39.0 | 2.38.2 |
| `ubuntu-26.04` | 20261116.202.1 | 29.4.2 | 0.39.0 | 5.1.3 |
| `ubuntu-22.04` | 20261116.365.1 | 28.0.4 | 0.39.0 | 2.38.2 |
| `ubuntu-24.04-arm` | not listed with versions; built from the same scripts | | | |

- None carries 29.5 or newer. The image notes say `ubuntu-latest` moves to 26.04 in November 2026. That image still carries 29.4.2.
- An image's engine changes when GitHub updates it, with no notice to us. A check that leans on it can change meaning overnight. So the check never runs a check against the machine's own engine. It uses it only to start the stand-in.
- Machines for a public repository [looked up]: 4 processors, 16 GB of memory and 14 GB of disk, on x86-64 and on ARM64. "Use of the standard GitHub-hosted runners is free and unlimited on public repositories." Passwordless `sudo`. The repository is public (the pull request check's own comment says so [read]).

What can be installed [looked up]:

- Docker's apt repository for Ubuntu 24.04 holds every `docker-ce` from 29.0.0 to 29.10.1, for amd64 and arm64. It also holds `docker-buildx-plugin` from 0.13.1 to 0.39.1 and `docker-compose-plugin` up to 5.8.0. Old versions stay there, so an exact pin keeps working.
- Ubuntu 24.04's own archive holds `docker.io` 29.1.3 and `docker-buildx` 0.30.1 (in `noble-updates`), and `docker-registry` 2.8.2. `noble-updates` keeps only its latest version, so a pin on Ubuntu's own `docker.io` breaks when Ubuntu updates it. The check then fails with a clear line, and the pin is raised by hand.
- Docker Hub has `docker:29.5.3-dind`, `29.4.3-dind`, `29.10.1-dind` and `28.0.4-dind`.

## 4. How the check gets its engines

FR-089b asks for Docker Engine 29.5 or newer and an older engine. FR-091 makes each a tool the maintainer approves. The options:

| | Option | Time per job | Same on the Mac? | How close to a server | What it adds | Costs |
|---|---|---|---|---|---|---|
| A | Install a pinned `docker-ce` on GitHub's machine itself, from Docker's apt repository | About 30 to 60 s (estimate; not tried on GitHub) | No. The Mac still needs a container. | Closest: systemd, the machine's kernel, no nesting | Docker's apt repository and its signing key | Two ways of doing one thing. It replaces the machine's 28.0.4. One engine per job. The machine's data folder already holds content, so a fresh install is not shown unless the store is set by hand. |
| B | The official `docker:<version>-dind` image, pinned by digest, as a privileged container | About 30 s (here: 11 s to pull 131 MB, 17 s to answer) [ran] | Yes | Alpine, not a server's system. Its buildx and Compose are fixed by the image (29.5.3-dind bundles buildx 0.34.1 and Compose 5.1.4) [ran]. | Docker Hub images | The runner's Linux build needs glibc and **does not start** in it (`not found`, exit 127) [ran]. The runner would have to run in a second container. One more Docker Hub pull per job. |
| C | **A server stand-in**: `ubuntu:24.04` pinned by digest, privileged, with `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin` and `docker-compose-plugin` at exact versions from Docker's apt repository. The repository key's fingerprint is checked first (`9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`). | About 35 s: 9 s to pull Ubuntu, 24 s to install, 1 s to start [ran] | Yes, the same script | Ubuntu userland, as most servers. Engine, buildx and Compose each pinned on their own. The runner's Linux build runs inside it [ran]. | Docker's apt repository and one `ubuntu:24.04` pull | Privileged nesting: no systemd, the host's kernel (GitHub's Azure kernel, or Docker Desktop's VM). About 120 MB downloaded per job. |
| D | A full virtual machine (Lima or similar on the Mac) | minutes | No | Close | A new tool on the Mac | Not what was agreed (D10 names a container). Not studied further. |

**Recommended: C**, on GitHub and on the Mac.

- One code path in both places. What passes on the Mac while building is what runs on every push.
- The runner runs inside the stand-in, beside its own Docker, as on a server. zekno reaches it through `docker exec -i`, or over SSH to an `sshd` in the stand-in with keys made in the run (part 6).
- Both image stores by one setting each [ran]: a fresh data folder gives the containerd store, and `{"features":{"containerd-snapshotter":false},"storage-driver":"overlay2"}` gives the classic store.
- The memory limit for the out-of-memory stand-in is the stand-in's own limit (`--memory 1g --memory-swap 1g`) [ran].
- Swapping engines in a running stand-in took 4 s [ran], so one job can try two engines.

Pins the plan would start from. Each is a line in one file in the repository that both the workflow and the Mac script read.

| Pin | Value | Why |
|---|---|---|
| Base image | `ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b` (looked up 2026-11-27) | a common server system |
| The floor | `docker-ce` and `docker-ce-cli` 29.5.0 | FR-089 asks for "the oldest version FR-034a allows". That is 29.5.0, not the newest 29.5 patch. |
| Buildx at the floor | 0.34.1 to start | The buildx that Docker's own 29.5.3 image bundles [ran]. Claim 1 says the routing of `BUILDKIT_SYNTAX` happens in buildx, and claim 10 needs buildx 0.35. So FR-034a may need a buildx floor as well as an engine floor. The plan's first check settles it. |
| Older engine | `docker-ce` 29.4.3 | the newest engine below the floor: the one most likely to be let through by mistake |
| Older engine, as many servers have it | Ubuntu's own `docker.io` (29.1.3 today), with and without Ubuntu's `docker-buildx` | covers research part 6's gap: a distribution's Docker with no buildx plugin |
| The newest | `docker-ce` 29.10.1, buildx 0.39.1, Compose 5.8.0 | what a server installed today gets. Raised by hand. |
| `containerd.io` | 2.4.2-4 | the newest in the repository |
| Registry for private base images | Ubuntu's own `docker-registry` 2.8.2, installed in the stand-in | no Docker Hub pull; see "Needs the maintainer" |

The machine's own engine (28.0.4) is not used as the older engine. It is not pinned and will change.

## 5. The trial on this Mac

[ran] on 2026-11-27, Docker Desktop 29.6.1, linux/arm64. Every container, volume and image was named `zekno-plan-016-*` or pulled by digest for this trial.

| # | Tried | Result |
|---|---|---|
| T1 | Pull `ubuntu:24.04` by digest | 9 s |
| T2 | In a privileged container (`--privileged --cgroupns=private`, a named volume on `/var/lib/docker`): check the key's fingerprint, then install `docker-ce` 29.5.3, buildx 0.39.1, Compose 5.8.0, `containerd.io` 2.4.2-4 from Docker's apt repository | 24 s |
| T3 | Start `dockerd` after moving the container's processes into a child cgroup, as moby's `hack/dind` does | Answered in 1 s. Engine 29.5.3, BuildKit v0.30.0 (claim 1's pairing of 29.5 with BuildKit 0.30.0 holds), containerd store. |
| T4 | A Dockerfile with `# syntax=docker/dockerfile:1`, `FROM scratch` and one `COPY`, built with `--build-arg BUILDKIT_SYNTAX=dockerfile.v0`, from a tar on standard input and from a folder | **Failed** both ways: `resolve image config for docker-image://docker.io/library/dockerfile.v0:latest` then `pull access denied`. The same on Engine 29.10.1 (BuildKit v0.35.1, buildx 0.39.1) and on `docker:29.5.3-dind` (buildx 0.34.1). Without the argument, the builder pulled `docker/dockerfile:1` (the control). Docker's reference still says the value makes the builder "ignore the Dockerfile `# syntax=` directive" [looked up]. |
| T5 | Swap the engine to 29.10.1 with apt in the same container | 4 s |
| T6 | Hold the stand-in to 1 GB (`docker update --memory 1g --memory-swap 1g`). Inside: an app container writing each second, and a build whose step asks for 1.6 GB | The build failed in 5 s: `ResourceExhausted: … did not complete successfully: cannot allocate memory`, exit status 102. The app kept running and was not killed. `memory.events` showed one kill. `dockerd` still answered. Docker marked the stand-in `OOMKilled=true`, still running. One run only. |
| T7 | `tc qdisc add dev eth0 root netem delay 50ms rate 10mbit` in the stand-in | Accepted. A ping took 52 to 55 ms. Removed afterwards. |
| T8 | Copy a local runner build for linux-arm64 (`apps/runner/dist`, version 0.1.0-dev.1, not tracked by git) into the stand-in and run `version` | It answered, also through `docker exec -i`, as a transport would carry it. |
| T9 | `docker:29.5.3-dind` pinned by digest | 131 MB, 11 s to pull, 17 s to answer. Buildx 0.34.1, Compose 5.1.4. The runner build: `not found`, exit 127. |
| T10 | The classic store (`overlay2`), then the containerd store, each with one `FROM scratch` build | Both stores selectable. On both, `--iidfile` equalled `docker image inspect .Id` for that image. One image only, not a finding about FR-061. |
| T11 | `docker buildx inspect` in the nested engine | It listed linux/amd64 and other platforms beside linux/arm64: Docker Desktop's VM has QEMU registered, so a build for another processor would run there. |

Clean-up [ran]: the containers `zekno-plan-016-server` and `zekno-plan-016-dind`, their two volumes, and the two images pulled by digest were removed. The lists of containers, volumes and networks match those taken before. No build ran on the Mac's own engine; all ran inside the nested engines. No other container was touched; `sessora-*` and `vata-*` were left alone. One image appeared on the Mac's engine while this work ran, `zekno.invalid/zekno-plan-016-app:k1`. This trial did not make it, and it was left alone.

What T4 means: on the engines tried, FR-034's mechanism did not work. FR-034, FR-034a's floor and FR-037c rest on research claim 1, which was read from source, not run. A possible reason, not checked: the checker read buildx's `master`, which may hold code no release carries yet. Until the first check on GitHub confirms or refutes T4, the plan must not rely on claim 1. If T4 holds there, the way the runner chooses the reader of a Dockerfile is a question for the maintainer.

## 6. The same checks on the Mac

One script starts the stand-in, on GitHub and on the Mac. It reads the pins file. Proposed shape:

1. Check that Docker answers. List what exists named `zekno-check-*`. If anything from an earlier run is left, stop and print how to remove it. Never touch any other name.
2. Pick a run id. Start `zekno-check-<id>-server`, privileged, with `--cgroupns=private`, the volume `zekno-check-<id>-data` on `/var/lib/docker`, and the network `zekno-check-<id>-net`. Add `--memory 1g --memory-swap 1g` for the out-of-memory check.
3. Install the pinned engine, start `dockerd` on the chosen store, and start `sshd` with a host key and a client key made now.
4. Put the runner, compiled from this commit for the stand-in's processor with the runner's own compile script, where zekno looks for it.
5. Run the gated tests with a switch naming the stand-in (for example `ZEKNO_LINUX_SERVER=zekno-check-<id>-server`). A test that runs Docker itself runs `docker exec <stand-in> docker …`. Without the switch, each such test skips with one line, as the real-proxy tests do today.
6. Remove everything it made, by exact name, also when a test fails. Compare the lists of `zekno-check-*` before and after.

For SC-003, a second container `zekno-check-<id>-client` on the same network holds zekno's Linux build. Its own `eth0` is held to 10 Mbit/s with 50 ms (`tc … netem`), so the upload is held. It reaches the stand-in over SSH. On the Mac it runs on ARM64, which is how FR-089b's "a build on Linux on ARM64" is covered.

Run as `bun --no-env-file <script>`. On this Mac, setting up took about 35 s [ran].

What the Mac's container cannot show, beyond what GitHub cannot:

- Docker Desktop's VM kernel (linuxkit), not a server's.
- QEMU is registered in that VM (T11). A build for the wrong processor may run instead of failing, so FR-041's check means less there.
- The VM is shared with the Mac's other containers (`sessora-*`, `vata-*` and others). Disk and memory figures move with them. A privileged container could reach parts of that VM. The script writes only inside its own cgroup and network namespaces, and removes what it made.
- zekno runs as its Linux build in a container, not as the macOS program. The macOS side of SC-013 and of Railpack's plan runs on the Mac itself, by hand.

## 7. Where each check runs

"GitHub" means the stand-in on `ubuntu-24.04` (x86-64). "Mac" means the stand-in on the maintainer's Mac while building. Times are estimates. Nothing was run on GitHub. The Mac figures come from part 5.

### The checks of FR-089 (step 1, and step 1b)

| ID | Check | Where | Time | What it cannot show there |
|---|---|---|---|---|
| L1 | Runner 0.1.1 with a signed Compose file that asks for a build (context `.`, a git address, `../..`) | GitHub, job `released`; Mac | 2 min | Only the pinned Compose (5.8.0). What 0.1.1 does depends on each server's Compose. |
| L2 | FR-034 (the runner chooses the reader) | GitHub, both stores at the floor; the older engines; Mac | 2 min per engine and store | Engines between the floor and the newest other than those pinned. See T4. |
| L3 | FR-035 (each app's cache space) | GitHub, both stores; older engines | 2 min | |
| L4 | FR-061 (kept image reused; the image id on both stores) | GitHub, both stores | 1 min | A server upgraded with years of old images, beyond the classic-store stand-in |
| L5 | Whether the builder stops when the program that started it goes | GitHub, both stores; Mac | 1 to 2 min | A real init system restarting `dockerd`, or a reboot, during a build |
| L6 | An out-of-memory build while an app runs beside it, held to 1 GB | GitHub, job `memory`; Mac | 3 min | A real 1 GB server: the whole system's kill choices (`sshd`, `dockerd`, the runner, other apps), swap, slow disks. Not measured, and the docs must not claim it (FR-089b). |
| L7 | The disk a 512 MiB build uses, which sets the floor of FR-040 | GitHub, both stores | 4 min | Other filesystems (xfs, btrfs, zfs). GitHub's 14 GB disk fits one such build per job. |
| L8 | Private base images through the server's registry login, with the client's proxy settings kept out | GitHub; Mac | 2 min | Registries with token sign-in (Docker Hub, GHCR) and credential helpers. The check's registry is a stand-in with a password made in the run. |
| L9 | The base images' digests after a build, both stores | GitHub | 1 min | as L4 |
| L10 | Docker's record of a build removed, and a printed marker found nowhere in Docker's storage or the runner's folder (FR-031b) | GitHub, both stores | 2 to 3 min (it reads the whole data folder) | Data folders elsewhere than `/var/lib/docker` |
| L11 | Upload times of SC-003: 10 MB and 100 MB over 10 Mbit/s with 50 ms | Mac only (client container) | 4 min | Real home links, Wi-Fi loss, the macOS program's own speed |
| L12 | 1b: a named secret reaches its step, and stays out of the image, its history, its metadata and the build cache | GitHub, both stores | 2 min | |
| L13 | 1b: a frontend named by `# syntax=` receives no secret | GitHub | 1 min | Shown by the check's registry, which serves that frontend's name and must log no request for it |
| L14 | 1b: a secret under a name of FR-037b never reaches the builder | GitHub | 1 min | |
| L15 | 1b: when a step built with a secret is reused (FR-037d) | GitHub, both stores | 3 min | |
| L16 | 1b: a build with no cached step still reads the app's cache folders | GitHub | 1 min | |

### The checks of FR-089a (step 2, Railpack)

| ID | Check | Where | Time | What it cannot show there |
|---|---|---|---|---|
| R1 | The pinned frontend on both stores | GitHub, both stores; Mac (ARM64) | 4 to 6 min per store (the builder image's largest layer is about 230 MB) | |
| R2 | A plan made on macOS, built on Linux on x86-64 | Mac makes it, by hand. GitHub builds it. | 4 min | Proposed: the plan made on the Mac for a fixture folder is committed with the tests. GitHub builds that plan on every push. |
| R3 | The same plan on macOS and on Linux | Mac by hand; GitHub compares its own plan with the committed one | 1 min | The fixture folder pins its language version exactly and has a lockfile, so the plan does not change when a new patch release appears. |
| R4 | "No network" and a fresh build reach Railpack's steps (R10) | GitHub, both stores | 3 min | |
| R5 | FR-049 and FR-049a | GitHub | 1 to 2 min | |
| R6 | Railpack's release has a file for each system zekno carries a checksum for | GitHub | seconds (the release's `checksums.txt` over HTTPS, no token) | The build attestation, which stays the maintainer's step M3 |
| R7 | Whether planning needs the plain variables, and whether the frontend receives them as build secrets (FR-036d) | GitHub | 2 min | |
| R8 | A change to one plain variable makes Railpack's steps run again through `secrets-hash` | GitHub | 3 min | |
| R9 | `cache-key` keeps one app's cache folders from another's | GitHub | 3 min | |
| R10 | How the frontend would receive a secret, whether it or a hash of it lands in the image, and whether a stand-in value in `railpack prepare` is enough (FR-037h) | GitHub | 3 min | |

### The rest of FR-089b

| ID | Check | Where | Time | What it cannot show there |
|---|---|---|---|---|
| B1 | A build on Linux on ARM64, for both builders | Mac; proposed also GitHub `ubuntu-24.04-arm` | 10 min | On the Mac: see part 6 (QEMU) |
| B2 | SC-013, Linux side | GitHub | seconds | Proposed: the fingerprint of a fixture folder is recorded in the tests, and both sides must reach it. |
| B3 | SC-013 and R3, macOS side | Mac by hand; proposed also a GitHub macOS machine | 3 min | |
| B4 | Each step's proof (SC-016): a folder deploys and answers; nothing changed sends nothing; a failed build leaves the app answering; a rollback reuses the kept image; `zekno doctor`; for 1b, a build that reads a named secret; for step 2, a folder with no Dockerfile from a profile that never fetched Railpack; the stand-in domain over HTTPS with Caddy's own internal authority, as feature 015's real-proxy tests do | GitHub, job `proof`, at the floor and the newest engine; Mac | 8 to 12 min | A real domain and a public certificate authority (FR-090). Real SSH across the internet. |
| B5 | FR-034a and SC-018: a build refused before the number is used, and images still deploy | GitHub, job `older-engine` | 5 to 8 min | Every older engine; it tries 29.4.3 and Ubuntu's own `docker.io` |
| B6 | M7's update from runner 0.1.1 | GitHub, job `released`, once `runner-release.json` on the pushed commit records a newer runner with its checksums. Before that it skips with one line. | 3 min | The update on a server that has run 0.1.1 for weeks |

Before the code exists, each check first records what it saw. Once the plan settles a finding, the check asserts it. A later engine that behaves otherwise then fails the check. The proof jobs skip with one line while the runner of the commit does not build yet.

## 8. The workflow

Proposed file: `.github/workflows/linux-checks.yml`, named `linux checks`.

> Note added with the plan's review (2026-11-27): the jobs table below is this map's proposal as written. The plan's [quickstart.md](../quickstart.md), "The jobs", replaces it: it adds the newest engine to `checks`, the engine `floor-no-buildx`, and the checks L4b, L17, L18 and R16. The rest of this part stands.

### What starts it

```yaml
on:
  push:
    branches: ["**"]   # every push to a branch; tags start only the release workflow
  pull_request:        # for pull requests from forks; see the `if` below
permissions: {}
concurrency:
  group: linux-checks-${{ github.ref }}
  cancel-in-progress: true
```

- Each job has `if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name != github.repository`. A pull request from this repository is then not checked twice, and one from a fork is checked with no secret, as `pull_request` always runs.
- No path filter: every commit has its proof, and M6 and M8 read it on the commit about to be tagged.
- A newer push to the same branch replaces the older run. The tag goes on the branch's latest commit, whose run is not replaced.

### The jobs

All on `ubuntu-24.04` unless marked. All run at the same time.

| Job | Stand-in | Runs | Expected | Time limit |
|---|---|---|---|---|
| `checks` (store: containerd, overlay2) | the floor (29.5.0) | L2 to L5, L7 to L10, L12 to L16, R1, R4 to R10, B2, the Linux half of R2 and R3 | 15 to 20 min | 40 min |
| `older-engine` | 29.4.3; Ubuntu's `docker.io` with and without its buildx | L2, L3 observed; B5 | 5 to 8 min | 20 min |
| `memory` | the floor, held to 1 GB | L6 | 4 to 6 min | 15 min |
| `released` | the floor | L1; FR-083 for runner 0.1.1; B6 | 4 to 6 min | 15 min |
| `proof` (engine: floor, newest) | floor or newest, containerd | B4 | 8 to 12 min | 30 min |
| `arm64` (needs the maintainer) | `ubuntu-24.04-arm`, the floor | B1, B4 | 10 to 15 min | 30 min |
| `macos` (needs the maintainer) | a GitHub macOS machine, no Docker | B3: hands the fingerprint and the plan on as job outputs to `checks` | 3 to 5 min | 15 min |

Each job: checkout (pinned commit `11d5960…` v4.4.0, `persist-credentials: false`, `fetch-depth: 0` for the older programs), Bun from `package.json` with `oven-sh/setup-bun` at `0c5077e…` v2.2.0, `bun install --frozen-lockfile --ignore-scripts`, the runner compiled from this commit, the stand-in, the gated tests, the clean-up. No new action is needed. Data passes between jobs as job outputs, not as uploaded files.

Time budget: about 25 minutes from push to result, and 1.5 to 2 hours of machine time per push. That is free on a public repository. On a private one it would be billed.

### How it stays free of secrets

Held by a test that reads the workflow file, as `apps/cli/test/templates/workflow.test.ts` holds the pull request check (CW1 to CW8):

| # | Rule |
|---|---|
| LC1 | Started only by `push` to branches and by `pull_request`. Never `pull_request_target`, `workflow_run` or a tag. |
| LC2 | `permissions: {}` at the top. Each job `contents: read` and nothing else. |
| LC3 | Every action pinned to a full commit, the same ones the other workflows pin. |
| LC4 | Every checkout keeps no credentials. |
| LC5 | No `secrets.` anywhere, no `environment:`, and no `GITHUB_TOKEN` handed to a step. Downloads (Railpack's release, runner 0.1.1) use plain HTTPS and no token. |
| LC6 | The lockfile as committed, and no package's install script. |
| LC7 | Every job has a time limit. A newer push replaces an older run. |
| LC8 | Every container, volume and network the run makes is named `zekno-check-*`. Only the stand-in is privileged. |
| LC9 | Keys, team lists and secret values are made during the run. Secrets are marker values. SSH goes only to the stand-in, on its own network. The domain is a stand-in served by Caddy's internal authority. Nothing names the maintainer's server. |
| LC10 | Every engine, image and package version comes from the one pins file. |

It reports and stops nothing on its own, like the pull request check. Making it a required check for `dev` is a ruleset setting, the maintainer's own step.

## 9. The one proof on the maintainer's server, at the end of step 2

What only a real server can show. With a go-ahead at the time of each use (M9, FR-090). The GitHub check never takes part.

1. Before: note the server's Docker version, its image store, buildx and Compose versions, its processor and memory. All must meet FR-034a. Nothing on the server is changed to meet it.
2. From the maintainer's Mac, the macOS program, over real SSH: update the runner from 0.1.1 to 0.1.2-dev.2, from the published pre-release, with its checksum.
3. Step 1: deploy a folder with a Dockerfile, give it a domain, and it answers over HTTPS with a certificate from a public authority. Deploy again with nothing changed: nothing is sent or built. A build that reads a plain variable. A failed build while the app keeps answering on its domain. A rollback to a built deploy. `zekno doctor`.
4. Step 1b: a build that reads a named secret. The marker is not in the image or its history.
5. Step 2: a folder with no Dockerfile, from a profile on which zekno never fetched Railpack. zekno fetches it, checks it and plans on macOS. The server builds, and the app answers. The folder the runner wrote the code to is gone.
6. On the server's real data folder: the build records zekno started are removed (FR-031b). The build cache is within its bound.
7. Note the upload times on the maintainer's own link, as a note, not a criterion.
8. Clean up: the proof's apps, images, build cache and domains. The runner stays at 0.1.2-dev.2 unless the maintainer says otherwise. Check that nothing of the proof is left (SC-016).
9. Write what ran and what did not in the release notes' "Tried on" (RELEASING.md, part 8).

Not part of it: an out-of-memory build (out of scope, D10), an older engine, and ARM64 unless the server is ARM64.

## 10. Risks

1. **T4.** `BUILDKIT_SYNTAX=dockerfile.v0` did not work on the engines tried. If GitHub shows the same, FR-034, FR-034a's floor and FR-037c need another way, and the floor may move. The check's pins then move with it.
2. **Docker Hub's limits.** GitHub's docs say Docker Hub's limit does not apply to public images pulled from its hosted machines [looked up], but users report `toomanyrequests` on them. Each job pulls `ubuntu:24.04` and a few small test images. Logging in would need a repository secret, which the check must not hold. A failed pull is a passing failure; run the job again.
3. **Nesting is not a server.** No systemd, the host's kernel, a privileged container. A nesting fault could fail a check that a server would pass, or pass one it would fail. Option A, without nesting, stays the fallback.
4. **Timing on shared machines** varies. GitHub's times are not criteria. SC-003 is measured on the Mac only.
5. **Disk.** 14 GB per GitHub machine. Both stores in one job, plus Railpack's images, would not fit. Hence the matrix.
6. **Pins that break.** Ubuntu's `docker.io` in `noble-updates` keeps only its latest version, and Docker's key may be rotated. Both fail with one clear line. The pin is then raised by hand.
7. **The 1 GB stand-in** showed, in one run, the step killed and the app alive. A real server may differ. The docs must say only what the stand-in showed, and where.
8. **The Mac's shared VM.** A privileged container shares Docker Desktop's VM with the Mac's other containers.

## 11. Not settled

- Whether T4 holds on x86-64 on GitHub, and so where FR-034a's floor lies, and whether it needs a buildx floor.
- Which buildx and Compose versions to pair with the floor. 0.34.1 is a starting guess.
- The Docker version on `ubuntu-24.04-arm` (its list gives none).
- Whether `netem` works on GitHub's Azure kernel. Not tried. SC-003 does not need it there.
- Every time in part 7. Nothing was run on GitHub.
- Whether Docker Hub's limits will be hit.
- Whether a GitHub macOS machine can fetch Railpack and make the plan as the Mac does. Not tried.

## For the plan

- The plan's first task builds the stand-in script, the pins file and the workflow, before any check relies on Docker's behaviour (FR-089).
- One server stand-in (option C) on GitHub and on the Mac: Ubuntu 24.04 by digest, Docker's packages at exact versions, privileged, named `zekno-check-*`.
- The floor engine is 29.5.0 exactly. The older engines are 29.4.3 and Ubuntu's own `docker.io`, with and without buildx. The newest is pinned and raised by hand.
- The machine's own engine on GitHub only starts the stand-in. No check runs against it.
- The first check repeats T4 on x86-64. Until then, nothing rests on research claim 1.
- Both image stores by daemon setting, as a matrix of the `checks` job.
- The out-of-memory check holds the whole stand-in to 1 GB with no swap.
- The runner runs inside the stand-in. zekno reaches it by `docker exec -i`, or over SSH with keys made in the run.
- SC-003 runs on the Mac, from a client container whose own link is held by `netem`.
- A fixture folder's fingerprint and a macOS-made Railpack plan are recorded in the tests. GitHub checks its Linux side against them on every push.
- Each Docker check records first, then asserts once the plan settles the finding.
- Five jobs (seven runs) on `ubuntu-24.04`, on every push and on fork pull requests, about 25 minutes, no secret, held by rules LC1 to LC10 in a test.
- The real-Docker tests call `docker exec <stand-in> docker` under a switch, and skip with one line without it.
- M7's update from 0.1.1 runs in the check once the pre-release is recorded.
- The one server proof covers part 9's list, with a go-ahead at the time.
- Folders follow the subject rule, never one named "build". Proposed: the stand-in under `apps/runner/test/support/linux-server/`, the step proofs under `apps/cli/test/scenarios/`.

## Needs the maintainer

1. **The engine tool (FR-091, M4).** Approve option C: `ubuntu:24.04` by digest plus Docker's apt packages at exact versions (`docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`), with the key fingerprint checked. Also Ubuntu's `openssh-server`, `iproute2` and `docker-registry` inside it, and Ubuntu's own `docker.io` and `docker-buildx` for the older-engine job. Run privileged on GitHub and on the Mac. Options A (install on GitHub's machine) and B (the official `docker:*-dind` image) are in part 4.
2. **The check's registry (L8).** Options: (a) Ubuntu's `docker-registry` 2.8.2 package in the stand-in (recommended: no Docker Hub pull, the same apt source); (b) the official `registry` image by digest; (c) a small registry written in the repository with no dependency. (c) would test our own stand-in more than Docker.
3. **ARM64 on GitHub.** Add the `arm64` job on `ubuntu-24.04-arm`, free on a public repository, so ARM64 is checked on every push and not only on the Mac. Recommended. It changes FR-089b's placement and an assumption of the spec.
4. **The macOS side on GitHub.** Add the `macos` job, so SC-013's and Railpack's macOS-against-Linux comparisons run on every push. The Mac's hand run stays. Recommended. It also changes FR-089b.
5. **The newest-engine leg of `proof`.** Keep a pinned newest engine, raised by hand. Recommended.
6. **T4.** If GitHub confirms it, how the runner chooses the reader of a Dockerfile (FR-034, point 4) goes back to the maintainer. Whether FR-034a names a buildx floor too.
7. **A required check.** Whether `linux checks` becomes a required check for `dev`, by ruleset. That is a setting on GitHub, the maintainer's own step.
8. **A Docker Hub mirror.** Only if pull limits bite: a public mirror such as Amazon's public gallery is a service to approve. Not proposed now.
