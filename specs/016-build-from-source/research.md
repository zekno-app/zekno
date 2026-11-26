# Research: build from source

**Feature**: 016-build-from-source · **Started**: 2026-11-26 · **Status**: research before the spec. Nothing here is built.

How to read it: part 1 is what the maintainer decided. Part 2 is a test run by hand on a real Docker. Parts 3 to 6 come from five researchers who read the code and the tools' own documentation on 2026-11-26, and an editor who compared their reports; nothing in those parts was run unless it says so. Part 7 holds the five reports as written. The plan extends this file.

## 1. Decided by the maintainer, 2026-11-26

| # | Decision | Note |
|---|---|---|
| D1 | The build runs on the customer's own server. | Already the README's design rule 5 ("Builds that deploy run on the customer's server or in their CI") and part 4.1 (b) of `specs/010-app-settings/deploy-v2.md`. Building in CI stays with the stage "deploys from CI". |
| D2 | This stage covers folders with a Dockerfile and folders without one, in that order. | Two steps of one stage. |
| D3 | An app with no Dockerfile is built with Railpack. | Chosen after the comparison in part 7 (prior art) and the test in part 2. |
| D4 | The settings file gets a builder choice, and the signed format is made to hold more than one builder. | So a second builder changes no format. |
| D5 | Cloud Native Buildpacks come next, as their own step after this stage. Nixpacks is left out. | Nixpacks is in maintenance mode by its makers' own README. Buildpacks need more than Docker on the server. |
| D6 | zekno fetches a pinned copy of Railpack for the developer by itself and checks its checksum, as it checks a runner release. | The developer installs nothing by hand. |

## 2. Railpack on a stock Docker: a test by hand, 2026-11-26

Run on macOS (ARM64) with Docker Desktop 29.6.1 (its `docker` builder, BuildKit 0.31.1, buildx 0.35, containerd image store), with the maintainer's go-ahead. Not run on Linux and not on a server.

Railpack 0.43.1 (`railpack-v0.43.1-arm64-apple-darwin.tar.gz` from the project's GitHub release; its SHA-256 matched the release's `checksums.txt`). The app: a folder with `package.json` (`engines.node` 22, a `start` script) and one `server.js`, no Dockerfile and no lockfile.

| # | Tried | Result |
|---|---|---|
| R1 | `railpack prepare --plan-out plan.json <folder>` on the developer's machine | Wrote a plan of 3,984 bytes in about 6 seconds. It resolved Node 22 to an exact version (22.23.5), which needs the network. It warned that there was no lockfile and no stated package manager. |
| R2 | The same command a second time | The same bytes (the same SHA-256). |
| R3 | What the plan names | Two images by tag, `ghcr.io/railwayapp/railpack-builder:mise-2026.11.12` and `ghcr.io/railwayapp/railpack-runtime:mise-2026.11.12`; the steps (install tools with mise, `npm install`); the start command. |
| R4 | Build with the code and the plan as one tar on standard input: `tar … \| docker buildx build --build-arg BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v0.43.1 -f railpack-plan.json -` | **Refused**: `failed to solve: no local sources enabled`. Railpack's frontend reads the code as a local folder only. |
| R5 | The same build from a folder | Worked with the stock `docker` builder, in 41 seconds the first time. It pulled the frontend and the two images (the builder image is about 230 MB in its largest layer), installed Debian packages and downloaded Node during the build. |
| R6 | Run the image and call it | It answered. The image is 161 MB by `docker image inspect` (670 MB as `docker images` lists it), starts with `/bin/bash -c "npm run start"`, and runs as root. |
| R7 | The frontend named by digest, `…/railpack-frontend@sha256:1f0bb301…` | Worked. |
| R8 | The plan's two images rewritten to digests | Worked. |
| R9 | A plan from 0.43.1 with the frontend of 0.44.0 | Worked for this app. Railpack's docs ask for the same version on both sides. |
| R10 | `--no-cache`, and `--network none` | `--no-cache` was not honoured (every step said CACHED), so whether `--network none` reaches Railpack's steps is not established. |

What this means for the design:

1. **Railpack needs nothing on the server but Docker**, on this builder. Still to prove on a Linux server.
2. **The runner cannot pipe the pack straight into the builder for Railpack**, as the 010 design does for a Dockerfile. It has to write the code to a folder first, so the rule "the runner never unpacks the pack" needs a second, stated way for this builder, with the checks that unpacking needs.
3. **Railpack picks its frontend through `BUILDKIT_SYNTAX`**, a name the signed format reserves. The runner sets it itself in both cases: Docker's built-in frontend for a Dockerfile, and one pinned Railpack frontend for a plan.
4. **Three things can be pinned by digest and were**: the frontend and the plan's two images. What a build downloads while it runs (Debian packages, the language's tools) is not pinned by any of them.
5. **Making a plan reaches the network from the developer's machine** and takes seconds. The plan is the same for the same folder and Railpack version, so it can be part of what is signed.
6. **The image runs as root and through a shell.**


## 3. The research brief

The editor's summary of the five reports. Written before decisions D2 to D6, so its "what waits" list still names Railpack.

### What the code already gives

- **The signed format for server builds exists and is checked in full.** `builds[]` carries key, pack `{hash, size, chunks}`, dockerfile, target, args, secrets, network and timeout (packages/core/src/deploy/later-fields.ts:38-78), with the build key (:111-141), cross-field rules (:150-177), hash domains (packages/core/src/crypto/hash.ts:17-19) and limits (packages/core/src/protocol/limits.ts:44-63).
- **Older runners refuse it cleanly.** A non-empty `builds` is `unsupported_version` before a number is used (packages/core/src/deploy/message.ts:155-167). The CLI never fills it (packages/core/src/deploy/deploy-v2.ts:248).
- **The 010 design already settled much** (specs/010-app-settings/deploy-v2.md:372-559; Q2, Q3, Q10, Q11, Q13, Q14 at :1360-1376):
  - chunks are sealed over SSH too;
  - packs are 512 MiB, in 8 MiB chunks;
  - the build network is `default`, with `none` offered;
  - the CLI keeps no packs;
  - the image is `zekno.invalid/<app>:<key>` with `pull_policy: never`;
  - the builds of three deploys are kept per app, and the build cache is pruned to 10 GiB.
- **Option B already works for images in a registry.** `source.image` accepts `@sha256:` (apps/cli/src/settings/values.ts:124-136). No code turns a tag into a digest.
- **Pieces to reuse:**
  - sealing to the server key;
  - a time-limited Docker child that streams its lines (apps/runner/src/docker/compose.ts:95-110);
  - 32 MiB session lines (limits.ts:22) and progress frames;
  - the installer's raw-byte upload, as a precedent (apps/cli/src/server/install/install.ts:43-51).

### How a server build would work

The steps, in the design's order (deploy-v2.md:1214-1240):

1. The CLI packs the folder into a deterministic tar and hashes it. It computes the build key, names the image `zekno.invalid/<app>:<key>` in the Compose text, and signs.
2. It sends `deploy`. If the runner keeps an image under that key, and the tag still names the recorded id, nothing travels and nothing is built.
3. Otherwise the runner refuses `pack_missing`, and no number is used.
   - The CLI seals each 8 MiB chunk and sends one `pack` line per chunk, about 11 MiB of base64url, waiting for each answer.
   - The runner stages a chunk under `packs/<app>/` only for a deploy that passes the signature and order checks.
4. The CLI sends the same signed deploy again. Before the number is used, the runner opens every chunk and streams it through the hash, checking size and hash (`pack_mismatch`).
5. The number is used, and the chunks move to `building/<app>/`.
6. The runner pipes the opened tar into `docker build -f … --network … --secret … --iidfile F -`, run in its own folder.
   - It stops the client at `timeout` and records the image id.
   - A failure ends `build_failed`: the number is used, and the app already running is untouched.
7. `docker compose up`, routes and the health check run as today.

**Missing in code:**
- A `pack` session command and its frame bound (packages/core/src/protocol/session.ts:48-61, 129-150).
- `pack_missing`, `pack_mismatch` and `build_failed`, in core, the runner and the CLI.
- State mark 5 for kept builds (packages/core/src/deploy/state.ts:133-145), and protocol 6 with a CLI check before signing.
- The `packs/` and `building/` paths (apps/runner/src/home/home.ts:76-85), and a streaming hash.
- A tar writer. None exists, and `Bun.Archive` cannot fix file times (source-pack report, tested on Bun 1.4.4).
- A typed `source.build`, which is `later` today (apps/cli/src/settings/shape.ts:134-140).
- A rollback that carries `builds`: the history drops them (apps/cli/src/shared/history.ts:36-40, 103-118).

### The pack

- **Form:** an uncompressed ustar, sorted, with fixed times, owners and modes (0644/0755). No link is followed out, and `.env*` is left out unless asked (deploy-v2.md:412-418).
- **`.dockerignore`:** the CLI must apply it itself.
  - Docker documents client-side filtering for a directory only (https://docs.docker.com/build/concepts/context/).
  - Reading the source suggests buildx passes a tar on stdin through as it is. Nobody has run this.
- **What the runner checks while hashing:**
  - file and directory entries only, plus a pax `path`;
  - valid checksums;
  - clean UTF-8 names, in strictly increasing order;
  - fixed metadata and a proper end.
  - It never unpacks.
- **Which files go in is open** (decision `pack-files`). In this repository, tracked files are 10 MB and `node_modules` is 1.4 GB, so a size summary before signing matters.

### Limits

- **Signed:**
  - a pack of 512 MiB (537 MB as the CLI prints sizes), in 64 chunks;
  - 8 builds per deploy;
  - 7,200 s per build.
- **Staging:** 2 GiB in all, kept 24 h.
- **Kept:** the builds of three deploys; the cache is pruned to 10 GiB.
- **Time:** `up` already stops at 30 min (compose.ts:81). BuildKit has no build time limit of its own.
- **Memory and disk:** buildx documents a per-step `--resource`, untested on dockerd's builder. There is no disk option.
- **One lock today** (apps/runner/src/commands/commands.ts:177-194). During a 2-hour build, `sync` would answer `busy`. The two-lock design was deferred "until builds make deploys long" (specs/014-deploy-v2/spec.md:298).

### Security rules the spec should state

Signing a deploy already equals root (deploy-v2.md:144-150). What builds add is unsigned inputs and new state.

1. **A fixed command line.** It lives in the runner's code; only the signed path, target, arguments and secret names change it.
   - Never `--allow`, `--network host`, `--ssh`, `--build-context` or `--output`.
   - A test fails on any of them. dockerd's builder grants `network.host` and `device` by default.
2. **A separate cache per app.** The runner always sets `BUILDKIT_CACHE_MOUNT_NS=zekno-<app>`. `BUILDKIT_*` names are already reserved (packages/core/src/secrets/secrets.ts:32-36).
3. **Build secrets as mounts only**, through environment names the runner picks.
   - `EXPERIMENTAL_BUILDKIT_SOURCE_POLICY` is not reserved today.
   - BuildKit treats `GIT_AUTH_TOKEN` and `HTTP_AUTH_TOKEN_<host>` as credentials.
4. **What the CLI packs.** It never follows a link out of the folder, and leaves `.git` and `.env*` out unless named. It refuses a Dockerfile that names `zekno.invalid/`.
5. **Time and disk.** A build is stopped at its signed time limit and ends `build_failed`. No build starts below a free-disk floor.
6. **What the runner records:** the image id, the base-image digests, and the Docker and BuildKit versions. `status` shows them; they are the server's word, unsigned.
7. **Rollback.** It reuses a kept image only when the tag still names the recorded id, and never rebuilds silently.
8. **Nothing opened from a pack** is written to the runner's folder.
9. **How strict to be about frontends, base images and `ADD` URLs** is open (decision `outside-inputs`).

**A gap in released 0.1.1:**
- `up -d` runs without `--no-build` (apps/runner/src/docker/compose.ts:144-154).
- The CLI does not check a hand-written Compose file for `build:`.
- What happens today with one is untested.

### A first version

What it could be, if the decisions go as recommended.

**Scope:**
- A folder with one Dockerfile, built on the server (A), at protocol 6.
- Settings `source.build`: dockerfile, root, target, timeout, network. `image` is not required when `build` is set.

**CLI:**
- Before signing, a pack summary: files, size, the largest folders, and what was left out.
- A size refusal that names the largest folders.
- Upload progress per chunk.
- A stage Built between Sent and Starting, with Docker's latest line under it.
- "Kept, nothing sent" when the image is already kept.
- On a failed build, a `build_failed` sentence, then the "Docker said" panel.

**Runner:**
- Staging, the pack gate and the build step.
- Kept builds and pruning.
- The two locks.
- A check that buildx is present.
- `--no-build` on `up`.

**Rollback:** carries `builds`.

### What waits

- Build arguments and build secrets. The format is ready.
- Railpack and buildpacks. Railpack picks its frontend through `BUILDKIT_SYNTAX`, which the format reserves (deploy-v2.md:387-388).
- Option B with tag-to-digest resolution, and images over SSH without a registry.
- Chunks through the hosted service.
- Multi-platform builds, memory limits and source policies.

### Not established

- Whether BuildKit stops a build when its client dies.
- What the iidfile holds on each image store.
- Whether a tar on stdin skips `.dockerignore`.
- What 0.1.1 does with a Compose `build:`.
- Whether `--resource` works on dockerd's builder.
- Whether `BUILDKIT_CACHE_MOUNT_NS` keeps apps apart.
- Anything at all on Linux.

## 4. Open points the editor listed

Each with the editor's recommendation. The first is settled by D1.

### direction (direction)

Should the first version build the code on your own server (A), build it on the developer's machine or in CI and only sign the resulting image (B), or do both?

- A: the CLI packs the folder, the runner builds it with the server's Docker
- B: build elsewhere, push to a registry, sign the image digest
- Both in the first version

**Recommended**: A first. Keep B as it already is: a digest in source.image or in a hand-written Compose file. Add turning a tag into a digest later as a small separate step.

**Why**: For A, the signed format, the limits and a twice-reviewed design already exist (later-fields.ts:38-78, deploy-v2.md:372-559). It needs no registry. The server builds for its own processor: the runner README names Linux on x86-64 (apps/runner/README.md:308), and many developers sign on arm64 Macs. B with no registry has no design at all. What A costs: plaintext source on the server, build load on small servers (out of memory on 1 GB machines), and a deploy lock held for up to 2 hours.

### outside-inputs (security)

A Dockerfile can pull in code that is not in the signed folder: a custom Dockerfile 'frontend' named by a '# syntax=' line (it sees the build's secrets), base images named by tag, and files downloaded with ADD. How strict should the first version be?

- Runner always uses Docker's built-in frontend (ignores '# syntax='); CLI refuses ADD of a URL or git source without --checksum; CLI warns on a base image without a digest
- As the 010 design says: CLI refuses an unpinned '# syntax=' or an ADD URL only when the build reads a secret, warns otherwise
- Strict: a digest required on every FROM, plus a source policy on the runner

**Recommended**: The first option. Record the base-image digests after each build.

**Why**: It is enforced on the server whatever the CLI parsed, through a documented build argument (BUILDKIT_SYNTAX=dockerfile.v0, docs.docker.com/reference/dockerfile). It closes the path by which a registry's frontend reads build secrets. The cost: Dockerfile features are limited to the BuildKit inside each server's Docker Engine, and Railpack will later need the runner to pin its frontend. Requiring digests would refuse most real Dockerfiles. Source policies are experimental and untested on dockerd's builder.

### pack-files (design)

When zekno packs a folder to send to the server, which files go in?

- Same as 'docker build .': every file except what .dockerignore lists, with .git and .env* always left out unless named in the settings
- Git's view: tracked files plus new files git does not ignore, then .dockerignore
- Only the last commit, so uncommitted edits are left out (as Kamal does)

**Recommended**: The first option. Show a summary before signing: file count, size, the largest folders, and what was left out. The refusal past 512 MiB names the largest folders.

**Why**: It sends what 'docker build .' on the developer's own machine sends, which is what they tested. It works in folders that are not git repositories, and it keeps gitignored build output (dist/) that a Dockerfile may COPY. Git's view needs git and silently drops such output. The last commit surprises anyone with uncommitted edits. The summary and the size refusal catch node_modules (1.4 GB in this repository).

### trigger (design)

In a folder that has a Dockerfile but no zekno.app.json and no compose.yaml, what should 'zekno deploy' do?

- Ask once at a terminal, then write zekno.app.json with source.build so the signed settings say 'build'
- Build at once without asking
- Stop with a sentence explaining how to set source.build

**Recommended**: Ask once at a terminal, and write the settings file. Without a terminal, stop with a sentence. Count only a file named exactly 'Dockerfile'; with several Dockerfiles, require 'dockerfile' in the settings.

**Why**: Zekno's documented rule is that a file is never picked over another without the user saying so (apps/web/content/docs/deploying.mdx:41). Writing the settings means the signed file states that a build happens. Railway and Dokku pick silently, which breaks that habit.

### settings-v1 (design)

Which build settings should the first version offer in zekno.app.json?

- Minimal: the Dockerfile path and the folder to pack
- Also target, timeout and network (default or none)
- Everything the signed format holds, including build arguments and build secrets

**Recommended**: The second option. source.image is no longer required when source.build is set.

**Why**: Target, timeout and network are already signed fields, and the 010 design (Q10) chose 'default' with 'none' offered. Build arguments are readable by the hosted service. Build secrets bring three problems: credential names BuildKit treats specially (GIT_AUTH_TOKEN), frontend exposure, and layer reuse after a secret rotates. They can wait for real demand, such as private package registries. Today source.image is required (SV7, apps/cli/src/settings/shape.ts:134-140).

### compose-build (security)

A hand-written compose.yaml that contains 'build:' may make the released runner build something on the server outside every zekno rule (not tested yet). Should the next CLI and runner forbid it?

- The CLI refuses 'build:' in a hand-written Compose file, and the runner adds --no-build to 'up'
- Leave it as it is and document it
- Support it as a second way to build

**Recommended**: The first option, after testing what runner 0.1.1 does today.

**Why**: The runner runs 'compose up -d' without --no-build (apps/runner/src/docker/compose.ts:144-154), and no CLI code checks for 'build:'. Such a build's context can be a git URL or a folder on the server. It is unpinned, unrecorded, and gets the deploy's secrets in Compose's environment. It gives a signer no new power, since signing is root already (deploy-v2.md:144-150). But it breaks 'what runs is fixed by what was signed'. It may break someone relying on it, so it should be tested first.

### locks (tech)

A build can take up to two hours. While it runs, should the server still accept a team list update (for example, one that removes a stolen key)?

- Build the design's two locks now: team list updates and pack uploads never wait for a build
- Keep one lock: everything, including 'sync', waits or is refused 'busy'
- Build outside any lock

**Recommended**: Build the two locks now. Deploys of other apps on the same server still wait for the build.

**Why**: Feature 014 deferred the state lock to exactly this moment (specs/014-deploy-v2/spec.md:298). With one lock (apps/runner/src/commands/commands.ts:177-194), a removed member's key keeps working for the whole build, because 'sync' is refused (threat T13). Building with no lock would break the order and staging rules (V20).

### transport (tech)

How should the packed source travel to the server?

- As designed: 8 MiB sealed chunks as base64 lines in the existing SSH session, uncompressed; an interrupted upload restarts whole
- Same, but each chunk compressed (zstd) before sealing, and 'pack_missing' names the chunks the runner lacks
- Raw bytes on a second SSH connection

**Recommended**: The second option, decided now, before any runner builds.

**Why**: Sealed bytes cannot be compressed, so compression has to come before sealing. This repository's 10.8 MB tar became 2.57 MB with zstd level 3 in 31 ms (source-pack measurement). My inference: compressing each 8 MiB plaintext piece keeps pack.hash and the build key deterministic. Both hash the plaintext, and sealed-chunk hashes already differ at every seal. Since no runner builds yet, it costs no extra protocol number now; later it would. The runner must cap each chunk's opened output at 8 MiB. Naming the missing chunks lets a cut upload resume within one CLI run. A second connection means a second login. This reverses the design's 'uncompressed' choice (deploy-v2.md:412-416), whose reasons per-chunk compression addresses.

### server-resources (security)

How should the runner protect the server's disk and memory from builds?

- A free-disk floor before each build, and the design's prune of Docker's whole build cache to 10 GiB; no memory limit in v1
- Same, plus a per-step memory limit (needs a recent Docker, untested)
- No pruning by zekno at all; only the free-disk floor

**Recommended**: The first option, and the docs say that the cache prune covers all builds on the server.

**Why**: Docker's build cache is shared by the whole server, and the prune commands have no per-app filter (docker-build report, inference). So pruning to 10 GiB (Q14) also removes the cache of builds a user runs outside zekno. buildx's --resource limit is per step, needs BuildKit 0.31 or later, and is untested on dockerd's builder. An out-of-memory build on a 1 GB server should instead end with a clear sentence.

### build-screen (design)

What should the deploy screen show for a build, before signing and while it runs?

- A summary before signing (files, size, largest folders, what was left out); a new stage 'Built' between Sent and Starting with Docker's latest line; a one-sentence failure with the 'Docker said' panel; 'kept, nothing sent' when the image is reused
- Only a new stage, no summary before signing
- The full build log streamed to the terminal

**Recommended**: The first option, shown as mockups and agreed before the spec, as for every CLI design.

**Why**: It extends today's stage row (apps/cli/src/ui/parts/deploy-summary.tsx:16) and the 'Docker said' panel (apps/web/content/docs/output.mdx:61-64). It catches size and secret-file mistakes before anything is signed. It says plainly that a failed build leaves the running app alone, as Render does.

## 5. Where the reports disagree

- Frontend ('# syntax='): the 010 design lets a pinned '# syntax=' through. The CLI refuses an unpinned one only when the build reads a secret, and warns otherwise (deploy-v2.md:500-504). The docker-build and threats reports want the runner to always force BUILDKIT_SYNTAX=dockerfile.v0, which ignores every '# syntax=' line, pinned or not. The reports are better supported on security: it is enforced by the runner, through a documented argument. The design is better on reach: newer Dockerfile features, and later Railpack, which selects its frontend through BUILDKIT_SYNTAX (prior-art).
- ADD of a URL or git source: the threats report says the CLI should always refuse it. The design refuses it only in a build that reads a secret, and warns otherwise (deploy-v2.md:500-504). The threats report's loopback argument (a daemon-side HTTP fetch reaching 127.0.0.1) is source reading, not run.
- What goes in the pack: source-pack proposes git's view, then .dockerignore. The design says 'the folder the build uses' (deploy-v2.md:412), and prior-art leaves it open (working folder or git HEAD, as Kamal uses). Neither is better supported; it is a product choice. Git's view silently drops gitignored build output that a Dockerfile may COPY.
- Secret-looking files: the design leaves .env* out 'unless asked' (deploy-v2.md:416-417). source-pack would refuse the deploy for .env*, *.pem and id_* unless the settings name them. prior-art drafts a sentence saying zekno 'never packs' .env. Leave out, refuse, or never: each is a different promise.
- Compression: the design chose an uncompressed pack, for identical bytes on every machine and no archive bomb in Docker (deploy-v2.md:412-416). source-pack proposes zstd on each chunk before sealing, and says it needs a new protocol number. My inference: pack.hash and the build key hash the plaintext, and sealed-chunk hashes already differ at every seal, so per-chunk compression keeps determinism. Since no runner builds yet, it costs no extra protocol number if decided now.
- Layer cache after a secret rotates: the design accepts that a layer built with an old secret can be reused (T36, deploy-v2.md:509-514). The threats report proposes --no-cache when a build secret's hash changes. docker-build lists whether secret values enter cache keys as not established. None of them tested it.
- Provenance recorded through --metadata-file: the threats report uses BUILDX_METADATA_PROVENANCE=min, docker-build uses max. The buildx docs say min is the default. Whether min records the base-image digests is untested, so neither is established.
- Locks: the design says 'sync' and 'pack' do not wait for a build, because of a separate state lock (deploy-v2.md:539-540, 1288-1294). The code has one lock for everything (apps/runner/src/commands/commands.ts:177-194). Feature 014 deferred the second lock until builds (specs/014-deploy-v2/spec.md:298). The code-map and threats reports describe the code correctly. The code-map cites the note as '014 runner-checks.md:99'; the file is specs/014-deploy-v2/contracts/runner-checks.md, and the deferral itself is in spec.md:298.
- Image identity: the design says --iidfile gives 'the image id', and that the runner checks the tag still names it. That rests on one check on Docker Desktop (deploy-v2.md:531-535, review D10). docker-build reads buildx source as writing a manifest or index digest under the containerd image store, which Engine 29 uses only on fresh installs. The design's check may compare different kinds of id depending on the server. Unresolved until tested on both stores.
- .dockerignore with a tar on stdin: source-pack says, from reading the buildx and BuildKit source, that it is not applied. prior-art lists it as not established. Docker's docs describe only client-side filtering of a directory. Either way the CLI must apply the rules itself, so that the signed pack is what gets built.

## 6. Not covered, and to try on a real Docker

### Not covered by any report

- A Dockerfile reader in the CLI. Several proposed rules need it: refusing 'zekno.invalid/', ADD of a URL, an unpinned '# syntax=', and warning on FROM without a digest. No code exists, and no report says how much of the Dockerfile grammar to parse (heredocs, escape directive, ARG in FROM).
- A server whose Docker has no buildx plugin, such as a distribution's docker.io package. 'docker build' then falls back to the deprecated legacy builder, which lacks secret mounts and behaves differently. Neither the runner nor the doctor checks for it, and no report covered it.
- The typed shape of source.build: 'root' relative to what, .dockerignore beside the root or the Dockerfile, monorepo layouts. Also its validation codes and sentences, and how SV7 (image required) changes.
- Ctrl-C or a dropped SSH connection during upload or during the build: what the CLI says, whether the build continues on the server, and what the next deploy finds in packs/ and building/.
- Pack sizes and upload times for typical projects beyond this repository, and over real home or office uplinks.
- Runner upgrade and downgrade with state mark 5: an older runner refuses the newer mark (state.ts:96-103), so a downgrade after a build needs a stated path.
- What 'zekno status' and the runner's 'status' show about kept builds and recorded digests, and which public docs pages change. The rule about not naming the desktop app or dashboard applies.
- How builds get tested: e2e tests scoped to the runner package, a Linux Docker in CI, and the real-server host, which needs the maintainer's approval each time.
- Docker client 'proxies' settings in the runner user's config.json become build arguments automatically (docker-build). Whether the runner should use its own DOCKER_CONFIG for builds, and what that does to registry credentials for private base images.
- Interaction with the pre-deploy command (still unbuilt) and the health check when a build is kept but 'up' fails. The design orders the steps, but no report tested them together.

### To try before the plan relies on it

- What released runner 0.1.1 does with a signed hand-written Compose file containing 'build:': context '.', a git URL, and '../..' (which points at the runner's home). Does 'up -d' build, and with which environment?
- On Linux Engine 29.x, both an upgraded (overlay2) and a fresh (containerd store) install: compare the --iidfile contents with 'docker image inspect --format {{.Id}}' of zekno.invalid/<app>:<key>. Check that Compose with pull_policy: never runs it on both.
- Kill the buildx client during 'RUN sleep 600'. Does the step stop, and can the image still be tagged afterwards?
- --build-arg BUILDKIT_SYNTAX=dockerfile.v0 with a '# syntax=docker/dockerfile:1' line: confirm no frontend image is pulled. Then check that 'RUN --mount=type=secret' and '--mount=type=cache' work with the server Engine's built-in frontend.
- With --network none: does 'ADD https://…' still succeed, and does 'ADD http://127.0.0.1:<port>' reach a service on the host's loopback? With network default: can a RUN step reach the cloud metadata address?
- Put a .dockerignore inside a tar piped to 'docker build -': is it applied? Also, is a Dockerfile.rego inside the pack loaded as a build policy?
- Two apps with identical 'RUN --mount=type=cache' steps under different BUILDKIT_CACHE_MOUNT_NS values: are the caches kept apart?
- --resource memory=256m on dockerd's built-in builder: is it honoured? Also, what exit status and text does an out-of-memory npm install give on a 1 GB server?
- Disk used by building from a 512 MiB pack ('docker system df -v'), and what 'docker buildx prune --max-used-space 10gb' removes, including cache from builds made outside zekno.
- Base-image resolution without --pull on both image stores. Does --metadata-file with BUILDX_METADATA_PROVENANCE=min record the base-image digests?
- The runner's peak memory while it reads and re-parses one 11 MiB base64url 'pack' line, and the wall time to upload 64 sealed chunks over SSH on a home uplink.
- zstd-compressing each 8 MiB chunk before sealing: the ratio on a few real projects, and a bounded decompression in the runner's Bun that refuses past 8 MiB.
- A server whose Docker has no buildx plugin (a distribution's docker.io package): what 'docker build' does, and the text the runner should give.
- Review checks D1 to D14 again, on Linux and on the oldest Compose version the runner will support (open question Q18).

## 7. The five reports

### 7.1 The code as it is

#### 1. What deploy format 2 signs, and what is already reserved

- **The payload today:** `v, teamId, teamHash, serverId, app, previous, sequence, createdAt, expiresAt, compose, secrets, removed, builds, predeploy, health, routes` (packages/core/src/deploy/message.ts:38-72).
- **`builds` is already fully specified:**
  - Fields: `key`, `pack{hash,size,chunks}`, `dockerfile`, `target`, `args`, `secrets`, `network`, `timeout` (packages/core/src/deploy/later-fields.ts:38-78).
  - The build key (later-fields.ts:111-141) and the rules across fields (later-fields.ts:150-177).
  - Hash domains `zekno/v1/pack`, `pack-chunk` and `build` (packages/core/src/crypto/hash.ts:17-19).
  - Limits: pack 512 MiB, chunk 8 MiB, 64 chunks, 8 builds, 7,200 s (packages/core/src/protocol/limits.ts:44-63).
- **Today's runner refuses it:** a non-empty `builds` is refused `unsupported_version` after the format checks, so no deploy number is used (message.ts:155-167). The CLI never fills it; `later` is for tests only (deploy-v2.ts:125-126, 248).
- **No digest field exists, by design:** a digest goes inside the signed Compose text (specs/010-app-settings/deploy-v2.md:28-29, 337-362).

**Decided in the 010 design.** It was reviewed twice, and "none of it is built" (deploy-v2.md:1483-1484).
- **Prebuilt image (a, c):** no new field. Whether the CLI turns a tag into a digest is left to "the settings feature"; the design recommends yes (340-341).
- **Built on the server (b):**
  - The pack is an uncompressed, deterministic tar, with no links out and no `.env*` (412-418).
  - It is cut into 8 MiB chunks, each sealed with `crypto_box_seal`, also over SSH (420-434).
  - It travels by a new `pack` command after a `pack_missing` refusal, then the same deploy is sent again (442-454).
  - Chunks are staged under `packs/<app>/` (2 GiB, 24 h) and move to `building/<app>/` once the deploy is accepted (464-476).
  - They are checked before the number is used (478-485).
  - The build is `docker build -f … --network none --secret id=T,env=T --iidfile F -` reading the tar on stdin; the runner never unpacks it (487-494).
  - The image is named `zekno.invalid/<app>:<key>` with `pull_policy: never` (405-410).
  - A build command becomes a Dockerfile the CLI writes into the pack (380-383).
  - The runner keeps the builds of the last three deploys and prunes the cache to 10 GiB (523-529).
  - New outcome `build_failed`; new refusals `pack_missing` and `pack_mismatch` (557-558, 1270-1276).

**Left open or not checked:**
- Whether BuildKit stops when its client stops, `BUILDKIT_CACHE_MOUNT_NS`, and what `network: none` really blocks (496-517, all marked "not checked").
- The review ran no `RUN` step, no base-image pull, no `# syntax=` line, no build secret and nothing on Linux (deploy-v2-review.md:44-46).
- The oldest Compose version the runner supports (Q18, 1378).
- Carrying chunks through the hosted service needs a client that is not written (456-462).
- `pack_missing` does not say which chunk is missing (review:808-810).

#### 2. The settings file

- `source` has `image`, which is required (SV7), and `build: later`, where `later = z.unknown().optional()` (apps/cli/src/settings/shape.ts:88, 134-140; `LATER` at 272-284).
- No typed shape exists for `build`. design.md lists only "root directory, Dockerfile, build command" (specs/010-app-settings/design.md:98).
- The sentence a user gets today (SL1):
  - "`<file>` sets a build for `<svc>`."
  - "Building from source is not in this version of zekno yet."
  - Source: apps/cli/src/settings/words.ts:283-286, 298-310; contracts/settings-file.md:268.
- The image rule already accepts `@sha256:` (settings/values.ts:124-136). The CLI never resolves a tag to a digest: there is no registry code.

#### 3. How bytes travel

- **The session:** one SSH process, `ssh -o ServerAliveInterval=30 -- <dest> "<runner> session"` (apps/cli/src/server/transport.ts:364-376, 413).
  - One JSON request per line, written as a single string (server/session.ts:382-386), one request at a time (377-380).
- **On the runner:**
  - A line is read up to `LIMITS.messageBytes`, 32 MiB (limits.ts:22; apps/runner/src/session/session.ts:269).
  - The waiting queue holds 32 MiB and 1,024 lines (session.ts:35-42).
  - The input is turned back into text and parsed again by the command (session.ts:163; deploy.ts:154).
- **Other limits:**
  - Signed payload 1 MiB and Compose text 256 KiB (limits.ts:20, 10).
  - The `deploy` answer frame 64 KiB (core session.ts:144).
  - A progress line 4,096 characters (compose.ts:17).
  - Progress lines are dropped once more than 8 MiB is unsent (runner session.ts:51, 90-95).
  - The settings file 65,536 bytes (settings-file.md:166).
- **The installer** uses a separate `sh -s --` SSH connection with the script text on stdin (install.ts:101; transport.ts:420-435).
  - With `--runner-file` it sends raw bytes after the script's `ready` line, in 64 KiB pieces, each awaited (install.ts:43-51, 118-121).
  - The server caps it with `head -c 268435457`, requires at most 256 MiB, and checks a SHA-256 the CLI sends (script.ts:284-305; checks.ts:20).
- **Tens of MiB on the existing connection.** My inference: base64url grows bytes by 4/3, so one line holds about 22–23 MiB of raw data. A whole pack does not fit; the design's 8 MiB chunks (about 11 MiB per line) do. Raw binary cannot go inside a session, because lines split on byte 0x0a (session.ts:115-141).
- **What would have to change:**
  - A `pack` entry in `SESSION_COMMANDS` and in the frame bounds (core session.ts:48-61, 129-150), plus its schema and a runner handler.
  - A streaming hash: `hash()` hashes one buffer in one call (hash.ts:27-37).
  - The session writing large requests with the awaited `send` rather than `write` (transport.ts:44-49, 285-300).

#### 4. The runner's deploy path

- **Steps in order** (apps/runner/src/commands/deploy.ts):
  1. K1: read the request (153-155).
  2. K2: take the lock and load the state (157-159).
  3. K3: save the team lists sent with it (162-164).
  4. K4–K14: `verifyDeployV2` (168-176).
  5. K15: limits (181-189).
  6. K16: open the secrets (192-193).
  7. K17: write the records, then the state; the number is used here (197-200).
  8. `composeStart` (201-207).
  9. Routes, then the health check (208, 102-143).
- **Where a build would sit:** the design checks packs before the number is used (step 12, about where K14 meets K15 today) and builds after K17, before `composeStart` (deploy-v2.md:1214-1229).
- **Time limits:** `up` is limited to 30 minutes (`START_LIMIT_MS`, compose.ts:81) and reported as `startLimit` (protocol.ts:226-263). No build limit exists in code; only `buildSeconds` and `timeout` exist in the format.
- **Progress:** Docker's lines become `{event:"progress"}` frames (compose.ts:156-185; runner session.ts:184-192). The CLI accepts only `progress` and `health` events for `deploy` (server/session.ts:106-114).
- **Outcomes:**
  - Today: `ok`, `started`, `start_failed`, `refused`, `routes_failed`, `unhealthy` (protocol.ts:180-190), first match in the order of deploy.ts:14.
  - `build_failed` is missing, and so are `pack_missing` and `pack_mismatch` (result.ts:46-55).
  - The CLI would need them too: its `DeployOutcome` (shared/deploy.ts:27-28) and its history outcome list (profile.ts:104-110).
- **One lock for everything** (commands.ts:177-194): `sync` would be answered `busy` for the whole build. The design's separate state lock is not built (014 runner-checks.md:99).
- **Stored state** is at mark 4 (state.ts:133-145, 270-280).
  - Kept builds (key and image id; deploy-v2.md:1294) would need a mark 5.
  - `verifyDeployV2` writes `v: 4` as a literal (deploy-v2.ts:421-433), and `readRunnerState` would need to migrate mark 4 (state.ts:311-333).
  - Older runners refuse a mark they do not know (state.ts:96-103).
  - The `packs/` and `building/` folders are not in the runner's paths (home.ts:76-80).

#### 5. Rollback today

- **How it is built:** `prepareRollback` takes the old `compose` text only, from an accepted entry of this machine's history (ops/deploy.ts:142-173, 249-293).
  - The history keeps at most 50 entries (profile.ts:36), each with its whole envelope (profile.ts:100-103).
  - `HistoryDeploy` drops `builds` (shared/history.ts:36-40, 103-118).
- **What it re-signs:** a new deploy with today's secrets, read from the runner's `records` (deploy-send.ts:360-390), and the server's current routes and health check (deploy-domains.ts:203-213). `builds` is always `[]`.
- **What it needs from the server:** `status`, `status` with routes, and `records`.
- **With built images (my inference, not run):** an old Compose text naming `zekno.invalid/…` would run whatever is tagged under that name, or fail with "No such image" (review D8, D9, lines 40-41).
- **The design's answer:** a rollback copies the old deploy's `builds`. The runner reuses a kept image only if the tag still names the image id it recorded; otherwise it refuses `pack_missing` (deploy-v2.md:526-528, 542-547).

#### 6. Protocol numbers

- `RUNNER_PROTOCOL = 5` (core session.ts:26-39):
  - 2 = runner 0.1.0
  - 3 = format 2
  - 4 = routes
  - 5 = the start limit
- **In the CLI:**
  - `VERSION_TWO_PROTOCOL = 3` and `ROUTES_PROTOCOL = 4` (ops/deploy-format.ts:25, 32).
  - A runner with a newer protocol is stopped with C7, and a routed deploy to a runner below 4 with B10 (deploy-format.ts:60-65).
  - `runnerRelation` reports "some" missing for an older runner (ops/server.ts:148-149).
- **How an older runner answers:**
  - A non-empty `builds` is refused `unsupported_version` with no number used (message.ts:155-167).
  - An unknown session command is refused `invalid_request` (014 contracts/protocol.md:19-20).
  - My inference: build support would be protocol 6, with a CLI check before signing like B10.

#### What the code already gives this feature

- The signed format, its schema, the build key, the hash domains and the limits, plus a clean refusal from older runners.
- Sessions with 32 MiB lines, ordered requests, progress events and SSH keep-alive.
- Sealing to the server key (secrets/secrets.ts:68-108).
- A precedent for a runner image pinned by digest (proxy/image.ts:11).
- A time-limited Docker child process that streams its lines (compose.ts:95-110).
- Option B already works for images in a registry, with no runner change: a digest in `source.image` or a hand-written Compose file.

#### What is missing

- **CLI:**
  - A typed `source.build`; `image` is still required.
  - The tar packer (no tar code exists in apps/), chunking and sealing.
  - The upload flow: `pack_missing`, then `pack`, then the deploy again.
  - A rollback that carries `builds`.
  - Turning a tag into a digest.
- **Core:**
  - The `pack` schemas and frame bound.
  - The new refusals and `build_failed`.
  - State mark 5 and protocol 6.
  - Lifting the `unsupported_version` refusal for `builds`.
- **Runner:**
  - Staging, the pack gate, and the build step with its time limit and `--iidfile`.
  - Kept builds and pruning.
  - The state lock and a Compose version check.
- **Option B without a registry** (sending an image over SSH): no design exists.

#### Not established

- What today's runner does with a hand-written Compose file that uses `build:`. The CLI has no rule for it.
- That BuildKit stops at the client's exit, that the cache namespace works, and what `network: none` blocks. All are marked not checked in the design.
- Any of the build checks on Linux or on a Compose older than v5.3.0.
- How much memory the runner needs to hold an 11 MiB line with its re-parsing (an estimate, not measured).
- Exact one-line capacity: the 22–23 MiB figure is arithmetic, not tested.

### 7.2 Building with Docker on a server

#### Building on the server with only Docker Engine 29.x

Repository context: the signed build format already exists, and today the runner refuses any deploy that uses it (`packages/core/src/deploy/later-fields.ts:38-78`, `packages/core/src/deploy/message.ts:160-164`). The design is in `specs/010-app-settings/deploy-v2.md:372-559`. Its checks D1 to D10 ran on Docker Desktop for macOS (`specs/010-app-settings/deploy-v2-review.md:26`), which uses the containerd image store. Source tags such as [S1] point to the list at the end.

**1. A tar archive on standard input**
- `docker build -` takes a piped tar as the build context. `-f` gives the Dockerfile's path "relative to the root of the tarball" [S1].
- Buildx looks at the start of standard input. When it sees an archive, it streams it to BuildKit through a session upload and passes `-f` on without checking it [S4].
- `docker build` is "a wrapper around Buildx" [S27]. The docker driver runs the BuildKit built into dockerd. It cannot be configured, and it loads the image into the engine's store [S26].
- Disk: the runner keeps nothing. My inference, not something I read: BuildKit keeps the received tar and its extracted copy under Docker's data root, along with base layers, a snapshot for each step and the final image.

**2. What identifies the result**
- `--iidfile` holds the config digest. When the daemon uses the containerd store, buildx sets `prefer-image-digest` and the file holds the manifest or index digest instead ("resolves images by manifest or index digest") [S3, S4].
- Engine 29 uses the containerd store only on fresh installs. A server upgraded from an older version keeps overlay2 [S5, S25]. So what the ID means depends on the server.
- Compose's `image` grammar is `[<registry>/][<project>/]<image>[:<tag>|@<digest>]`, which has no bare ID. `pull_policy: never` "relies on the platform cached image" [S6]. The repository checks showed a tag with `never` does not pull (D8), and that any image can be tagged under that name (D9).
- `docker compose build` fits worse than `docker build`:
  - Its context is a directory or a Git URL, not a tar on standard input [S7]. The pack would have to be unpacked on disk, which the design avoids (`deploy-v2.md:493-494`).
  - It takes entitlements, `privileged`, `ssh`, a host network, `additional_contexts` and cache export from the Compose text [S7]. Each would need checking.
- Lead to check: the runner's `up` passes no `--no-build` (`apps/runner/src/docker/compose.ts:144-154`). Without a pull policy, Compose builds a missing image [S7]. I found no code that reads the Compose text in `apps/runner/src` or `packages/core/src`.

**3. What reaches outside the signed source**
- **`# syntax=`** pulls a frontend image [S8]. `--build-arg BUILDKIT_SYNTAX=dockerfile.v0` makes BuildKit "ignore the Dockerfile `# syntax=` directive and use the built-in frontend" [S8]. The cost is that Dockerfile features are limited to the bundled BuildKit (v0.31 to v0.35 across Engine 29.6 to 29.10 [S5]).
- **Base images named by tag** (also `COPY --from` and `--mount from=` an image):
  - On the classic store, the default "== prefer local" [S13]. With `--pull`, the registry decides.
  - Pin or forbid with a source policy (`EXPERIMENTAL_BUILDKIT_SOURCE_POLICY`) [S9, S11]. It is JSON with ALLOW, DENY and CONVERT rules, and match types WILDCARD, EXACT and REGEX. Within one policy the last matching rule wins, and CONVERT can pin a tag to a digest.
  - Or use build policies (`--policy`, Rego) [S10]. They see `input.image.isCanonical` and `checksum`, `input.http` and `input.git`. Requirements: buildx 0.31 or later and BuildKit 0.26 or later.
  - Buildx automatically loads `<Dockerfile>.rego` [S4, S10]. Pass `reset=true,strict=true` so a pack cannot bring its own policy.
  - To detect after the build: `--metadata-file` with `BUILDX_METADATA_PROVENANCE=max` [S2].
- **`ADD` of a URL or a git repository:** `--checksum` is up to the Dockerfile's author [S8]. The policies above can deny these.
- **Network during `RUN`:**
  - `--network none` covers `RUN` steps only [S2].
  - `RUN --network=host` needs `--allow network.host` from the client [S8]. dockerd's builder grants `network.host` and `device` by default unless `daemon.json` turns them off [S12].
  - The `proxies` setting in the Docker client's config becomes build arguments automatically [S24]. `HOME` and `DOCKER_CONFIG` are passed through to Docker (`compose.ts:7-14`).
- **Build arguments** come only from the caller. Proxy arguments are left out of history by default [S9].
- **Named contexts** come only from the caller's `--build-context`, which can also override a `# syntax` image [S2].
- **ONBUILD:** a `BUILDKIT_DISABLE_ONBUILD` argument is listed [S8]. I did not read its description.

**4. Limits**
- **Time:** BuildKit has no build time limit. The caller kills the client.
- **Memory and processor:**
  - Buildx hides the legacy flags `-m` and `--cpu-*` and maps them to `--resource` [S3].
  - `--resource` takes `memory`, `memory-swap`, `cpu-shares`, `cpu-period`, `cpu-quota` and `cpuset-*` [S2].
  - The limits apply to each step, not to the whole build. When steps are shared, "the most relaxed limits" win [S2, S14].
  - It works only on Linux and needs the `exec.meta.linux.resources` capability [S2]. It arrived in BuildKit 0.31 [S14], which is Engine 29.6 or later [S5].
- **Other controls:** `--cgroup-parent`, `--ulimit` and `--shm-size` apply to `RUN` containers [S2]. My inference: pulls, unpacking and export run inside dockerd, outside these limits.
- **Disk:** `docker buildx build` has no option for it [S2].

**5. Secrets**
- Build arguments "may persist in the image metadata, as provenance attestations and in the image history" [S9].
- Use `--secret id=N,type=env,env=N` with `RUN --mount=type=secret` [S15].
- If the runner gives neither `env` nor `src`, BuildKit reads the environment variable N if it is set, and otherwise **a file named N in the working directory** [S16]. That is the runner's private folder (`apps/runner/src/docker/run.ts:72-80`).
- An unset variable gives an empty secret with no error [S16].
- BuildKit uses the secret IDs `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER` and `HTTP_AUTH_TOKEN_<host>` as credentials when it fetches remote content [S15]. A deploy secret with one of those names would be sent to remote hosts. My inference: without a host suffix, it applies to any host.
- `plain` progress shows what `RUN` steps print [S2], including any secret a step prints.

**6. Disk**
- **Cache collection:** `daemon.json` takes `builder.gc` (`defaultKeepStorage`, `reservedSpace`, `keepDuration`, `type=` filters) [S17].
- **`docker buildx prune`** takes `--max-used-space`, `--min-free-space` and `--reserved-space`. Its filters are `until`, `id`, `parents`, `description`, `type`, `inuse`, `mutable`, `shared` and `private`, and `--all` also removes frontend images [S18].
- **`docker builder prune`** takes `--keep-storage` [S18b].
- My inference: the cache is shared by the whole server, and there is no filter for one app.
- **Images:** `docker image prune` removes dangling images only, filtered by `until` and `label` [S19].
- A Dockerfile `LABEL` can set any label, so a label proves nothing (inference). To keep the last N images of an app, remove recorded tags (`deploy-v2.md:523-529`).

**7. Platform**
- When no platform is given, the target is the daemon's own platform [S2].
- A step for another platform needs QEMU registered through binfmt_misc [S20].
- The check `FromPlatformFlagConstDisallowed` flags a fixed `FROM --platform` [S21]. `BUILDKIT_DOCKERFILE_CHECK=error=true` turns every check into an error.
- To detect: compare `Os/Architecture` from `docker image inspect` with the server's own.

**8. Output and exit statuses**
- Progress goes to standard error. `-q` prints the image ID on standard output [S3].
- `rawjson` writes one `SolveStatus` per line, with `vertexes`, `statuses`, `logs` and `warnings`. Log `data` is a Go `[]byte`, so it arrives as base64 [S22].
- The Docker CLI exits with 1 on an error, with the plugin's own status for buildx, and with 128 plus the signal number when stopped by a signal [S23]. Build-check violations exit with 0 by default [S21].

##### A minimal safe command line for a runner to use (PROPOSAL, untested)

Run it in the runner's folder. The environment holds only `dockerEnv` plus the build's secrets, and the opened pack goes in on standard input.

```
docker buildx build --builder <docker-driver builder> \
  -f <signed dockerfile> [--target <signed target>] \
  --platform linux/<server arch> --network <none|default> \
  --build-arg BUILDKIT_SYNTAX=dockerfile.v0 \
  --build-arg BUILDKIT_CACHE_MOUNT_NS=zekno-<app> \
  [--build-arg NAME=value ...signed only] \
  [--secret id=N,type=env,env=N ...] \
  --provenance=false --sbom=false \
  [--resource memory=..,cpu-quota=..] \
  -t zekno.invalid/<app>:<key> \
  --iidfile <file> --metadata-file <file> \
  --progress=rawjson -
```

After the build, check that the tag's `.Id` equals the iidfile and that its architecture is the server's. Still to decide: `--pull`, a source policy, and a `DOCKER_CONFIG` owned by the runner (which loses registry credentials).

##### Things to try on a real Docker before trusting this
1. On Linux Engine 29.x, with both an upgraded (overlay2) install and a fresh (containerd) one, compare the iidfile with `docker image inspect .Id`. Try Compose with `image: sha256:<id>` and with `name@sha256:<id>`, both under `pull_policy: never`.
2. Kill the client during `RUN sleep 600` and see whether the step stops.
3. Run `--resource memory=256m` on the docker driver with a step that uses 1 GiB.
4. Set `BUILDKIT_SYNTAX=dockerfile.v0` with a `# syntax=` line and confirm no frontend is pulled.
5. Check whether the docker driver honours a source policy's DENY for an unpinned `FROM`, for `ADD https://` and for the frontend.
6. With `--network none`, check whether `ADD https://` still succeeds.
7. Put a `Dockerfile.rego` inside the pack and see whether it is loaded.
8. On an amd64 server, build an arm64 `FROM` with no binfmt: note the error text and the exit status.
9. Measure the disk a 512 MiB pack takes with `docker system df -v`, and compare the two prune commands.
10. With a hand-written `build:` in the Compose text, see whether `up` builds today.

##### Not established
- Whether BuildKit cancels a build when its client goes away.
- Whether `--resource` works with dockerd's builder.
- Whether the docker driver honours source policies, and whether policies cover the frontend image.
- Base-image resolution on the containerd store when `--pull` is not given.
- The Engine's default garbage-collection values on Linux, and build-history retention.
- Whether QEMU comes with the Engine's built-in builder.
- Whether secret values enter cache keys.
- Whether Compose has used Bake by default since v2.37 (only GitHub issues say so).
- The minimum BuildKit for build policies: the usage page says 0.26, a search summary said 0.27.

Sources: [S1] https://docs.docker.com/build/concepts/context/ · [S2] https://docs.docker.com/reference/cli/docker/buildx/build/ · [S3] https://github.com/docker/buildx/blob/master/commands/build.go · [S4] https://github.com/docker/buildx/blob/master/build/opt.go · [S5] https://docs.docker.com/engine/release-notes/29/ · [S6] https://github.com/compose-spec/compose-spec/blob/main/spec.md · [S7] https://docs.docker.com/reference/compose-file/build/ · [S8] https://docs.docker.com/reference/dockerfile/ · [S9] https://docs.docker.com/build/building/variables/ · [S10] https://docs.docker.com/build/policies/usage/ and https://docs.docker.com/build/policies/validate-images/ · [S11] https://github.com/moby/buildkit/blob/master/sourcepolicy/engine.go and https://github.com/moby/buildkit/blob/master/sourcepolicy/pb/policy.proto · [S12] https://github.com/moby/moby/blob/master/daemon/internal/builder-next/controller.go · [S13] https://github.com/moby/moby/blob/master/daemon/internal/builder-next/adapters/containerimage/pull.go · [S14] https://github.com/moby/buildkit/pull/6569 · [S15] https://docs.docker.com/build/building/secrets/ · [S16] https://github.com/moby/buildkit/blob/master/session/secrets/secretsprovider/store.go · [S17] https://docs.docker.com/build/cache/garbage-collection/ · [S18] https://docs.docker.com/reference/cli/docker/buildx/prune/ · [S18b] https://docs.docker.com/reference/cli/docker/builder/prune/ · [S19] https://docs.docker.com/reference/cli/docker/image/prune/ · [S20] https://docs.docker.com/build/building/multi-platform/ · [S21] https://docs.docker.com/build/checks/ and https://docs.docker.com/reference/build-checks/from-platform-flag-const-disallowed/ · [S22] https://github.com/moby/buildkit/blob/master/client/graph.go · [S23] https://github.com/docker/cli/blob/master/cmd/docker/docker.go · [S24] https://docs.docker.com/engine/cli/proxy/ · [S25] https://docs.docker.com/engine/storage/containerd/ · [S26] https://docs.docker.com/build/builders/drivers/docker/ · [S27] https://docs.docker.com/build/concepts/overview/

### 7.3 The source pack

#### Already fixed in the repo

The signed format already defines the pack. `pack.hash` is `hash("zekno/v1/pack", exact bytes)`. A pack is at most 512 MiB and carries the ordered hashes of its sealed 8 MiB chunks (packages/core/src/deploy/later-fields.ts:41-47, packages/core/src/protocol/limits.ts:44-51). The format is not meant to change (later-fields.ts:5-6).

The design (specs/010-app-settings/deploy-v2.md) says:
- the pack is an uncompressed tar, sorted, with fixed times and owners, no link out, and `.env*` left out unless asked (:412-418, :1337);
- the runner never unpacks it and pipes it to `docker build -` (:487-494).

Hashing a manifest instead of the tar bytes would therefore change the format.

#### 1. What goes in

| Tool | What it packs |
|---|---|
| Docker | The client applies the root `.dockerignore` or `<Dockerfile>.dockerignore`. Rules: `filepath.Match` plus `**`, `!` exceptions, last match wins, patterns anchored at the root ([docs](https://docs.docker.com/build/concepts/context/)). |
| Kamal | A git clone by default, which "ensures a clean build with no uncommitted changes"; `context: .` packs the folder instead ([docs](https://kamal-deploy.org/docs/configuration/builders/)). |
| Fly | A client-side tar plus `.dockerignore`. With no `.dockerignore`, only `fly.toml` is left out ([archive.go](https://github.com/superfly/flyctl/blob/master/internal/build/imgsrc/archive.go)). |
| Railway | A tar.gz using `.gitignore` plus `.railwayignore`, dotfiles kept, `.git` and `node_modules` always left out. Links that leave the folder are skipped and listed ([upload.rs](https://github.com/railwayapp/cli/blob/master/src/controllers/upload.rs)). |
| Vercel | `.vercelignore` plus defaults: `node_modules`, `.git`, `.env.local`, `.env.*.local`, but not `.env`. It does not read `.gitignore` ([index.ts](https://github.com/vercel/vercel/blob/main/packages/client/src/utils/index.ts)). |

- **Key finding (read in source, not tested):** buildx hands a tar on stdin to an upload provider ([opt.go](https://github.com/docker/buildx/blob/master/build/opt.go)). BuildKit's `MainContext` then returns that context before it reads `.dockerignore` ([config.go](https://github.com/moby/buildkit/blob/master/frontend/dockerui/config.go)). So the CLI has to apply `.dockerignore` itself.
- **Ignore rules differ:**
  - A `.env` line in `.dockerignore` drops only the top-level file; `**/.env` is needed for every folder.
  - The same line in `.gitignore` matches at any depth. Files git already tracks stay in, and nothing under an excluded folder can be brought back ([gitignore](https://git-scm.com/docs/gitignore)).
- **Each choice gives a different "what I see is what is deployed":**
  - Doing what Docker does keeps gitignored build output a Dockerfile may `COPY` (`dist/`). With no `.dockerignore`, it also packs `.git`, `node_modules` and `.env`.
  - Git's view (`git ls-files --cached --others --exclude-standard`) drops `dist/` and needs git installed.
  - The last commit only (Kamal, `git archive`) leaves out every uncommitted edit.
  - A folder that is not a git repository can only be walked.
- **Monorepo:** a Dockerfile in `apps/api` usually needs the repository root as its context. The settings design already plans a "root directory" (specs/010-app-settings/design.md:98).
- **This repository:**
  - 1,034 tracked files, 10.0 MB in all;
  - `node_modules` 1.4 GB, `apps/web/.next` 592 MB, `.git` 41 MB;
  - a gitignored `.env.local` (I saw its name only and did not open it).

#### 2. Same bytes on every machine

- **`Bun.Archive` is unusable** (tested on Bun 1.4.4):
  - it writes ustar with uid/gid 0 and mode 644;
  - but the file time is always "now" and cannot be set;
  - entries are written in insertion order, with no directory entries, all in memory;
  - a `Bun.file()` value produced a 0-byte entry.
- **Instead:** a hand-written ustar/pax writer in `packages/core`, shared with the runner, of roughly 150 lines (my estimate), with no new dependency. Streaming BLAKE2b is already available (specs/010-app-settings/deploy-v2-review.md:423).
- **Rules from [reproducible-builds.org](https://reproducible-builds.org/docs/archives/):** sort names, use one file time, owner 0/0 numeric, no atime/ctime, fixed modes. Git records only modes 0644 and 0755 ([gitformat-index](https://git-scm.com/docs/gitformat-index)); doing the same means the umask stops mattering.
- **A fixed time has a cost:** the `etag` package builds tags from size and time ([stattag](https://github.com/jshttp/etag/blob/master/index.js)). A changed file of the same size would keep its old ETag. `git archive` uses the commit time instead ([docs](https://git-scm.com/docs/git-archive)).
- **Other things that can differ between machines:** Windows CRLF checkouts, NFD file names from macOS, and each machine's `core.excludesFile`.
- **Long paths:** ustar holds 100 + 155 characters split at a `/`. Anything longer needs a pax `path` record ([POSIX](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html)).

#### 3. What the runner must refuse

Python's `data` filter refuses absolute or escaping paths, links that leave the folder, and devices and FIFOs. Its hints add limits on counts and sizes, duplicate names (a later entry overwrites an earlier one) and names that collide on a case-insensitive disk ([tarfile](https://docs.python.org/3/library/tarfile.html)).

Because the pack has one fixed form, the runner can be stricter while it hashes. It would accept only:
- entry types `0` and `5`, plus `x` carrying `path` and nothing else;
- valid checksums;
- UTF-8 names with no control characters, no `.`, `..` or empty parts, and no leading `/`;
- names in strictly increasing order;
- the fixed mode, owner and time;
- zero padding, then two zero blocks, then nothing.

That also refuses hard links, GNU long names, sparse files and compressed streams. BuildKit would unpack a compressed stream (`AttemptUnpack`; my inference from the source).

Case collisions cannot hurt the runner, because it runs on Linux (apps/runner/README.md:308). Streaming the pack keeps untrusted paths off the runner's disk. Unpacking would gain nothing once the CLI applies the ignore rules.

#### 4. Sizes and compression

- **Other services' limits:**
  - Vercel CLI uploads: 100 MB on Hobby, 1 GB on Pro, at most 15,000 files ([limits](https://vercel.com/docs/limits));
  - Heroku: a 1 GB checkout ([limits](https://devcenter.heroku.com/articles/limits)).
- **This repository's tar (10.8 MB), compressed:**

  | Method | Size | Time |
  |---|---|---|
  | gzip level 6 | 2.69 MB | 83 ms |
  | zstd level 3 | 2.57 MB | 31 ms |
  | zstd level 19 | 1.85 MB | 2.4 s |

- **Published benchmark (Silesia test files):** zstd level 1 reaches a ratio of 2.896 at 510 MB/s; zlib level 1 reaches 2.743 at 105 MB/s ([zstd](https://github.com/facebook/zstd)).
- **Bun 1.4.4 has compression built in** (tested): gzip and zstd through `Bun.gzipSync`, `Bun.zstdCompress`, `node:zlib` and `CompressionStream`.
- **Where compression would go:** sealed chunks do not compress, so it would have to happen before sealing. Compressing each chunk with zstd and capping its output at 8 MiB rules out an archive bomb. It changes what a chunk is, though, so it needs a new protocol number.
- **Units:** 512 MiB is 537 MB the way `megabytes()` writes sizes (apps/cli/src/shared/sizes.ts:5).
- **A possible "too large" sentence:** "The pack for web is 734 MB, over the 537 MB a deploy can carry. Largest: node_modules 612 MB, .next 98 MB. Add them to .dockerignore, then deploy again."

#### 5. Secrets in the folder

- Docker's page on build contexts never mentions `.env`.
- Vercel leaves out only `.env.local` and `.env.*.local`.
- Railway and Kamal rely on git to keep secrets out.
- Fly leaves nothing out by default.

#### 6. Sending it

- **Current design:** one base64url `pack` line per sealed chunk, about 11 MiB for each 8 MiB, sent one at a time (deploy-v2.md:442-454). That fits under the runner's 32 MiB line limit (apps/runner/src/session/session.ts:35).
- **Raw bytes on the same SSH stdin have been done before:** the installer streams the runner in 64 KiB pieces, then that same connection becomes the session (apps/cli/src/server/install/install.ts:43-51, :69-73).
- **A second connection** means a second login unless SSH's `ControlMaster` shares the first ([ssh_config](https://man.openbsd.org/ssh_config)).
- **Resuming:** sealed bytes differ every time they are sealed. So a resume works only within one CLI run that still holds the sealed chunks, and only if the runner says which chunks it already has. Today `pack_missing` does not say (deploy-v2.md:453). Vercel works this way: its server answers `missing_files` ([upload.ts](https://github.com/vercel/vercel/blob/main/packages/client/src/upload.ts)).
- **Progress** can be counted per acknowledged chunk, or by bytes written into `ssh`. The second is approximate because SSH buffers some data (my inference).

#### A pack format proposal

This is a proposal; nothing here is decided.

- **Files:**
  - in a git repository, take git's view; outside one, walk the folder;
  - then apply `.dockerignore` in the CLI, and leave `.git` out;
  - refuse `.env*`, `*.pem` and `id_*` unless the settings file names them;
  - before signing, show the file count, total size and largest folders, as `npm pack --dry-run` does ([npm](https://docs.npmjs.com/cli/v11/commands/npm-publish)).
  - Alternatives: do exactly what Docker does, or pack the last commit only.
- **Tar:**
  - ustar, with a pax `path` record only when a path is too long;
  - directories included, sorted by UTF-8 bytes;
  - modes 0644/0755, uid/gid 0, one fixed file time, no links.
  - Alternative: keep symbolic links that stay inside the folder.
- **Runner:** a streaming checker that rebuilds each header and compares the bytes, with a limit of about 50,000 entries.
- **Hash:** of the tar bytes, as the format already says. Alternative: a manifest of files. It allows resuming file by file, but it changes the format and makes the runner build the tar.

#### Questions only the maintainer can answer

1. Git's view, Docker's behaviour, or the last commit only? Is a folder that is not a git repository allowed?
2. Is `.git` packed or left out?
3. One fixed file time, or the commit time?
4. Are symbolic links kept, followed or refused?
5. Does the secret check refuse the deploy or only warn?
6. Compression now (a new protocol number) or later?
7. Raw binary frames, or base64 lines?
8. Should `pack_missing` name the missing chunks?
9. At what size should the CLI warn, and how many entries should be allowed?

#### Not established

- Whether a tar on stdin really skips `.dockerignore`. I read the source but ran no build. I did not read the legacy builder.
- Whether BuildKit's cache key or `COPY` keeps file times.
- Whether the empty `Bun.file()` entries are a Bun bug or my misuse.
- Railway's upload limit; it is not documented.
- Typical project sizes beyond this repository.

### 7.4 Threats

# Threat model: building on the server from a signed source pack (A) or signing an image digest (B)

**Starting point.** Signing a deploy already gives root on the server (specs/010-app-settings/deploy-v2.md:144-150), and the runner's user controls Docker: "The `docker` group grants root-level privileges" ([postinstall](https://docs.docker.com/engine/install/linux-postinstall/)). The signed format for A is already fixed, but runners refuse it today (packages/core/src/deploy/later-fields.ts:38-78, deploy/message.ts:160). Its design and threats are in deploy-v2.md:372-559 and T6, T16, T19-T22, T35, T36 (:1323-1353). This report covers what building adds for people who hold no key, and for a member who signs a folder they never read. Checks the developer's own CLI makes are a real defence against a hostile folder, because the CLI is the trusted signer.

#### 1. Attackers

| Attacker | What A adds | What B adds |
|---|---|---|
| Hostile project folder | Its code runs at build time, with the build's secrets mounted. The daemon fetches on its behalf (part 2). The CLI's packing could pick up links, `.env*` and `.git/config` | The same code runs on the developer's machine or in CI, next to the signing key and the registry credentials |
| Hosted service (later) | It can hold back chunks (`pack_missing`, no deploy number used up). It sees the size, pack hash and recipe, so it can confirm a guess of the exact source (README.md:181-185). It cannot swap anything (T6) | It sees only the digest |
| Removed member | Can deploy builds until the runner gets the new list (T13). What their builds left in cache mounts and kept images stays | Only their kept images |
| Another app on the server | Shares BuildKit with this app: cache mounts, layer cache, local images (`FROM`/`COPY --from` another app's built image, which holds its source), and disk and CPU | Nothing new |
| Internet visitor | Nothing: there is no new port and they cannot start a build. They matter only if they control an image or package host (T22) | The same, but at build time elsewhere |

#### 2. What a build step can reach

- **Sandbox.** A `RUN` step is sandboxed like a container. "The default security mode is `sandbox`", and `--security=insecure` needs the `security.insecure` entitlement ([Dockerfile reference](https://docs.docker.com/reference/dockerfile/)).
- **Network.** With no network option, `RUN` joins Docker's default `bridge` network (Docker engine source, `daemon/internal/builder-next/executor_linux.go:22,27` and `executor.go:43-44`). From there it reaches:
  - the internet and the host;
  - other apps' published ports. Other bridge networks are reachable "only … using published ports" ([bridge](https://docs.docker.com/engine/network/drivers/bridge/));
  - the metadata address. Hetzner serves `/hetzner/v1/userdata` at 169.254.169.254, according to [cloud-init's datasource](https://sources.debian.org/src/cloud-init/25.3-2/cloudinit/sources/DataSourceHetzner.py).

  Any app container already reaches all of these.
- **New with A.** Some fetches are made by the daemon, not the sandbox, so `--network none` does not stop them: `FROM`, `COPY --from`, a `# syntax=` frontend, and `ADD` of a URL or git source. BuildKit fetches over HTTP with a plain client inside the daemon (BuildKit source, `source/http/source.go:216`). My inference, from source I read but did not run: `ADD http://127.0.0.1:…` reaches services on the host's loopback.
- **Entitlements.** Docker's daemon allows `network.host` and `device` by default (Docker engine source, `daemon/internal/builder-next/controller.go:604-615`). buildx adds `network.host` by itself when given `--network host` (`build/opt.go:640-643`). So the runner's own command line is the only gate.
- **Cache.** Cache mounts persist from one build to the next. `BUILDKIT_CACHE_MOUNT_NS` "Set optional cache ID namespace". Layer cache keys leave secret contents out (deploy-v2.md:509-514).

#### 3. What the signature covers

**Signed:** the pack (hash, size, each sealed chunk), the Dockerfile path, target, build arguments, build-secret names and their value hashes, the network choice and the time limit (later-fields.ts:38-78, 130-139). The Compose text names the image `zekno.invalid/<app>:<key>`.

**Not signed:** base images named by tag, the frontend, anything the build downloads, `ADD` without `--checksum`, the Docker and BuildKit versions, cache layers reused from earlier builds, and the resulting image ID. A build is not bit-for-bit reproducible unless timestamps are pinned ([build-repro](https://github.com/moby/buildkit/blob/master/docs/build-repro.md)).

**What "the server runs what was signed" can mean:**
- **Under A:** the server built exactly the signed source with the signed recipe, and ran whatever that build produced.
- **Under B:** the server ran these exact bytes ([pull by digest](https://docs.docker.com/reference/cli/docker/image/pull/)), with no proof of which source they came from.

**What A must record** for each deploy, so a later reader can tell what ran:
- the build key;
- the image ID from `--iidfile`;
- the base-image and frontend digests, from `--metadata-file` with `BUILDX_METADATA_PROVENANCE=min`, because Docker's default image store keeps no attestations ([buildx build](https://docs.docker.com/reference/cli/docker/buildx/build/));
- the Docker and BuildKit versions;
- whether the cache was used.

All of these are the server's word, and nobody signs them.

#### 4. Denial of service

Signed limits: a pack of at most 512 MiB, at most 7,200 s per build, staging of at most 2 GiB kept 24 h (packages/core/src/protocol/limits.ts:47-63, deploy-v2.md:549-553). A build holds the deploy lock, so every other deploy waits.

A `RUN` step can write layers with no size limit. Build-cache garbage collection "runs periodically" ([GC](https://docs.docker.com/build/cache/garbage-collection/)). buildx has a per-step memory and CPU limit (`--resource`), but it works only if the daemon has `exec.meta.linux.resources`. `--cgroup-parent` and `--ulimit` limit `RUN` steps, not the builder inside `dockerd`.

#### 5. Secrets

Today an opened secret lives only in the environment of the Docker process (apps/runner/src/docker/compose.ts:112-118).

- **Mounts are safe; arguments are not.** Secret mounts stay out of "the image or build cache". Build arguments "may persist in the image metadata … and in the image history" ([variables](https://docs.docker.com/build/building/variables/)).
- **What changes:**
  - The opened value also enters the buildx client's environment and the `RUN` step's tmpfs.
  - A Dockerfile can still copy it into a layer or send it out.
  - The opened source stays on disk in Docker's storage (deploy-v2.md:436-440).
- **A naming gap.** buildx reads `EXPERIMENTAL_BUILDKIT_SOURCE_POLICY` from its environment (`build/build.go:1631-1634`), and `isReservedSecretName` does not reserve that name (packages/core/src/secrets/secrets.ts:32-36).

#### 6. Rollback

- **Kept image:** content-addressed, so a rollback runs the same bytes. Kept images are limited in number but not in bytes.
- **Rebuild from kept source:** gives a different image, because the base images have moved. It is a new build, not a return to what ran.
- **B:** the old digest. If it has been pruned on the server and deleted from the registry, the rollback fails.

#### 7. Hosted route

A pack can be larger than the 32 MiB message limit (limits.ts:22) because it travels as 8 MiB chunks, sealed and fetched by hash. The runner takes chunks only for a deploy that passed its gate (deploy-v2.md:456-462). The service cannot read the code. It can confirm a guessed source. If the server key ever leaks, every chunk anyone kept can be opened (T35).

#### Ratings for a first version

| Risk | Rating | Smallest control |
|---|---|---|
| A wrong flag gives the build host networking, devices or no sandbox | Critical if it happens | A fixed command line, and a test that fails on any forbidden flag |
| The CLI packs files from outside the folder, or `.env*` / `.git/` | High | Keep links as links and never follow them; leave those files out unless asked |
| Daemon fetches reach the host's loopback; a `# syntax=` frontend gets the build's secrets | Medium | The runner sets `BUILDKIT_SYNTAX=dockerfile.v0`, which ignores `# syntax=`; the CLI refuses `ADD` of a URL or git source |
| Another app's images or cache mounts | Medium | Per-app `BUILDKIT_CACHE_MOUNT_NS`; the CLI refuses `zekno.invalid/` |
| Disk or CPU starvation | Medium | A free-disk floor; a per-step memory limit; prune after each build |
| What ran is not recorded | Medium | Record the list in part 3 |
| A secret's name collides with a variable buildx reads | Low | Environment names chosen by the runner |
| A layer survives a secret's rotation | Low | `--no-cache` when a build secret's hash changes |
| Guess confirmation; no forward secrecy | Low | Already accepted (README.md:181-185) |

#### Rules the spec must state

1. The runner builds with a command line fixed in its code. Only the signed path, target, arguments and secret names change it.
2. The runner never passes `--allow`, `--network host`, `--ssh`, `--build-context`, `--output`, or `--secret` without `env=`.
3. Every build gets `BUILDKIT_SYNTAX=dockerfile.v0` and `BUILDKIT_CACHE_MOUNT_NS=zekno-<app>`.
4. Build secrets reach buildx only through environment names the runner chooses.
5. A pack holds no file reached through a link out of the folder, and no `.env*` or `.git/` unless asked.
6. The CLI refuses a Dockerfile that has `ADD` of a URL or git source, or that names `zekno.invalid/`.
7. A build that passes its signed time limit is stopped, and the deploy ends `build_failed`.
8. A build does not start, or is stopped, while free disk is below a fixed floor.
9. For each build the runner records the image ID, the base-image and frontend digests, the Docker and BuildKit versions and whether the cache was used, and `status` reports them.
10. A rollback reuses a kept image by its ID or is refused. It never rebuilds silently.
11. Nothing opened from a pack is written to the runner's folder.

#### Not established

- Whether BuildKit stops a build when its client is killed.
- Whether Docker Engine's built-in builder has `exec.meta.linux.resources`.
- Which Dockerfile syntax version the built-in frontend supports (it decides whether `secret env=` works under `dockerfile.v0`).
- Whether `ADD` of a URL really reaches the host's loopback (I read the source, did not run it).
- Whether a build can use a local-only image in `FROM` under both image stores.
- Whether `BUILDKIT_CACHE_MOUNT_NS` changes layer cache keys.
- Hetzner's metadata endpoints, from Hetzner's own documentation.

### 7.5 What people expect, and builders for apps with no Dockerfile

#### 1. How Zekno speaks today, and how others show a build

**Zekno today.** Its sentences are short and plain. Each one says what ran and what to do next: "Nothing of this one ran. Run zekno deploy again…" (apps/web/content/docs/deploying.mdx:161) and "…Nothing was signed." (deploying.mdx:236). The stage row is Checked, Signed, Sent, Starting (apps/cli/src/ui/parts/deploy-summary.tsx:16). Docker's latest line shows dim under the stage row, and when a start fails its lines appear in a "Docker said" panel (apps/web/content/docs/output.mdx:61-64). Settings that set a build are refused today with "Building from source is not in this version of zekno yet." (apps/cli/src/settings/words.ts:283-285). The reserved design already gives `build_failed` as an outcome that uses the deploy number, and the build runs before `docker compose up` (specs/010-app-settings/deploy-v2.md:558, 1226-1234). So a failed build leaves the app that is already running alone.

| Tool | Where it builds | While it builds, and on failure | Cache |
|---|---|---|---|
| Railway | Its own builders | Initializing → Building → Deploying → Active/Failed. Build logs show during the build, and a log line reads "Using detected Dockerfile!" ([deployments](https://docs.railway.com/reference/deployments), [dockerfiles](https://docs.railway.com/builds/dockerfiles)) | "Cache hits aren't guaranteed"; `NO_CACHE=1` ([build config](https://docs.railway.com/guides/build-configuration)) |
| Render | Its own builders | Build, then pre-deploy, then start. A build may take 120 min. On failure the service "continues running its most recent successful deploy" ([deploys](https://render.com/docs/deploys)) | "Clear build cache & deploy" |
| Heroku | Its own builders | Compile limit of 25 min. Slug size is shown after "Compressing" ([slug compiler](https://devcenter.heroku.com/articles/slug-compiler)) | `heroku builds:cache:purge` |
| Fly | A remote builder by default, or `--local-only` | `--build-only`, `--no-cache` ([flyctl deploy](https://docs.fly.io/flyctl/deploy/)) | — |
| Kamal | Locally by default, from a **git clone** ("no uncommitted changes") unless `context` is set. A remote builder handles another `arch` ([builders](https://kamal-deploy.org/docs/configuration/builders/)) | — | `cache` key |
| Dokku | On the server | Shows condensed BuildKit output. `BUILDKIT_PROGRESS=plain` gives the full log ([dockerfiles](https://raw.githubusercontent.com/dokku/dokku/master/docs/deployment/builders/dockerfiles.md)) | `--no-cache` |
| Coolify | "on the deployment server by default". A build server needs a registry and the same CPU architecture ([build server](https://coolify.io/docs/knowledge-base/server/build-server)) | — | — |

#### 2. Settings

The design reserves `source.build` for "root directory, Dockerfile, build command" (specs/010-app-settings/design.md:98). The signed format already holds `dockerfile`, `target`, `args`, `secrets`, `network` and `timeout` (packages/core/src/deploy/later-fields.ts:38-77). It has no platform field and no context separate from the pack (deploy-v2.md:380).

| Setting | Meaning | Who else has it | When |
|---|---|---|---|
| build (present) | Build this folder | All | First |
| dockerfile | Path inside the pack | Railway, Fly, Render, Kamal, Dokku | First |
| root/context | Which folder is packed | Railway Root Directory, Dokku `build-dir`, Kamal `context` | First, defaulting to the folder `zekno.app.json` is in |
| timeout | Seconds; the signed limit is 1–7200 (packages/core/src/protocol/limits.ts:63) | Render and Heroku, both fixed | First, as a default |
| target | A stage of the Dockerfile | Fly, Kamal | First or later; the field already exists |
| args | Plain build arguments, readable by the hosted service | Fly, Kamal; Render and Railway pass variables in | Later |
| build secrets | Secret mounts | Fly `--build-secret`, Kamal | Later, unless private packages matter now |
| network none | No network for `RUN` | No one else | Later |
| build command / builder | Build with no Dockerfile | Railway, Render, Coolify, Dokku | Later |
| platform | Target processor | Kamal `arch`, Railpack `--platform` | Only with (B) |
| watch paths | When a push deploys | Railway, Render | Does not apply |

#### 3. Apps with no Dockerfile

| | Railpack | Nixpacks | Cloud Native Buildpacks |
|---|---|---|---|
| State | Active: v0.44.0 released 2026-11-26 (GitHub API) | README: "currently in maintenance mode and is not under active development". Last release v1.41.0, 2025-10-24 ([repo](https://github.com/railwayapp/nixpacks)) | Active: pack v0.40.11 (2026-11-13), lifecycle v0.21.30 (2026-11-24) |
| Licence | MIT | MIT | Apache-2.0 |
| How it runs | `railpack prepare` writes a plan JSON. The BuildKit frontend `ghcr.io/railwayapp/railpack-frontend` reads it through `--build-arg BUILDKIT_SYNTAX=… -f plan.json`. The CLI's own `build` needs a privileged `moby/buildkit` container ([frontend](https://railpack.com/platforms/buildkit-frontend), [production](https://railpack.com/platforms/running-railpack-in-production)) | Generates a Dockerfile, then runs `docker build` ([how it works](https://nixpacks.com/docs/how-it-works)) | A builder image holds the buildpacks and the lifecycle. `pack` is a binary or the `buildpacksio/pack` image. The lifecycle needs a registry or a daemon ([lifecycle](https://buildpacks.io/docs/for-platform-operators/concepts/lifecycle/)) |
| Stock Docker only | Probably yes, if the plan is made on the developer's machine. Release binaries cover darwin and linux on amd64 and arm64. This is my inference; I did not run it | Needs the binary, or its Dockerfile generated elsewhere | Needs `pack` on the server, or a container given the Docker socket |
| Pinning | "use the same version of the frontend that was used to generate the build plan". `--previous NAME@VERSION` keeps versions. Toolchains are downloaded during the build | Not established | Same inputs give the same image ID, with timestamps set to 1980 ([reproducibility](https://buildpacks.io/docs/for-app-developers/concepts/reproducibility/)). A builder can be pinned by digest |
| Languages | Docs cover node, bun, deno, python, go, php, java, ruby, rust, elixir, gleam, dotnet, cpp, zig, staticfile, shell | Not established | Heroku builders: .NET, Go, Java, Node.js, PHP, Python, Ruby, Scala. builder:24 and :26 run on amd64 and arm64 ([images](https://github.com/heroku/cnb-builder-images)) |

**Conflict:** Railpack picks its frontend through `BUILDKIT_SYNTAX`. The signed format reserves every `BUILDKIT_*` name and has no field for a frontend (deploy-v2.md:387-388, 501-504). Either each runner release pins one frontend, or the format gains a field.

#### 4. Detecting what to do

- The current rule picks between `compose.yaml` and `zekno.app.json`, and "Neither file is ever picked over the other without you saying so" (deploying.mdx:18-41).
- Other tools pick silently. Railway "will always build with a Dockerfile if it finds one" ([config](https://docs.railway.com/reference/config-as-code)). Dokku chooses Dockerfile "only if both the herokuish and pack builders are not detected".
- **A Dockerfile alone.** One choice that keeps Zekno's habits is to ask once at a terminal and write `zekno.app.json` with `source.build`, so that the signed file says to build. Without a terminal it would stop with a sentence.
- **A settings file and a Dockerfile.** The settings decide, and the Dockerfile is just a file in the folder.
- **Several Dockerfiles** (such as `Dockerfile` and `Dockerfile.prod`): ask, or require `dockerfile`. Count only the exact name `Dockerfile`, as `zekno.app.json` is counted (apps/web/content/docs/settings.mdx:60-63).
- **A Compose file with `build:`.** Today the runner runs `up -d` without `--no-build` (apps/runner/src/docker/compose.ts:144-154), and `up` "Builds, (re)creates, starts" ([compose up](https://docs.docker.com/reference/cli/docker/compose/up/)). The file sits in `<home>/apps/<app>/` (apps/runner/src/home/home.ts:80). I found no check for `build:`. What it does now was not tested.

#### 5. Common failures

| Failure | Sentence (my drafts) |
|---|---|
| Out of memory (exit 137; 1 GB servers, per [AWS re:Post](https://repost.aws/questions/QU3NYADQEyQxKJe5TfUXV5Qw/ec2-t3-micro-instance-fails-to-build-docker-image-on-run-npm-install-step-exit-code-137)) | `The build of web ran out of memory on prod and was stopped. shop still runs deploy 6. Give prod more memory, or build elsewhere.` |
| Wrong processor, mostly with (B); Docker says emulation "can be much slower" ([multi-platform](https://docs.docker.com/build/building/multi-platform/)) | `This image is built for arm64 only, and prod is amd64. Nothing was signed.` |
| Huge context; the pack limit is 512 MiB (limits.ts:47) | `This folder packs to 1.3 GiB; a build can send 512 MiB. node_modules is 870 MiB of it: list it in .dockerignore. Nothing was signed.` |
| Missing lockfile | `package.json has no lockfile beside it, so the server may install other versions than you tested.` |
| `.env` left out of the pack on purpose (deploy-v2.md:416-417) | `The Dockerfile copies .env, which zekno never packs. Use variables.secrets.` |
| Full disk | `prod ran out of disk space while building. Nothing of this deploy ran.` |

#### What a first version should feel like

`zekno deploy` in a folder with one Dockerfile builds it on your server without anything else to learn. Before anything is signed, the summary says what it packs and how big it is. A new stage, Built, stands between Sent and Starting, and Docker's latest line shows under it. When nothing changed, the stage says the image was kept and nothing was sent. A failed build leaves the running app alone and says so in one sentence, followed by Docker's lines. Size and secret mistakes are caught on your machine before anything is signed. A Dockerfile is never picked silently over another file.

#### Decisions only the maintainer can make

- (A), (B) or both.
- Whether a lone Dockerfile triggers a question, a written settings file, or a refusal.
- Whether the pack is the working folder or the git HEAD, as Kamal uses.
- Whether a Compose `build:` is refused or supported.
- Whether build secrets come in the first version.
- Whether a missing lockfile gets a warning or a refusal.
- Which builder for apps with no Dockerfile, and where the frontend is pinned.

#### Not established

- Whether BuildKit applies `.dockerignore` found inside a tar sent on stdin.
- Whether a Railpack frontend set by `BUILDKIT_SYNTAX` works with Docker's default builder on a stock server.
- Nixpacks' language list; architecture support of the Paketo builders.
- Exact failure text from Fly, Heroku and Railway.
- What today's runner does with a Compose `build:`.

## 8. The checked claims

Two checkers tried to refute the editor's load-bearing claims against primary documentation and source on 2026-11-26. Nothing here was run either.

1. **Partly.** Passing '--build-arg BUILDKIT_SYNTAX=dockerfile.v0' makes BuildKit ignore the Dockerfile's '# syntax=' directive and use its built-in Dockerfile frontend instead.
   - Evidence: The docs table says: "Set to dockerfile.v0 to ignore the Dockerfile # syntax= directive" (https://docs.docker.com/reference/dockerfile/). I traced how it works in the source. buildx build/opt.go:332-341 turns the build arg into frontend gateway.v0 with source=dockerfile.v0 and cmdline set (https://github.com/docker/buildx/blob/master/build/opt.go). BuildKit solver/llbsolver/solver.go:198-210 then sends that to the built-in dockerfile.v0 frontend, but only when no build context named dockerfile.v0 is passed. Because cmdline is set, frontend/dockerfile/builder/build.go:54 skips both the BUILDKIT_SYNTAX forward and the # syntax detection (https://github.com/moby/buildkit). Both the routing and the docs row came in commit 3f3c957 (PR #6643, merged 2026-04-08). The first release with them is BuildKit v0.30.0. BuildKit v0.29.0 has neither. The Engine release notes say 29.5.0 "Update BuildKit to v0.30.0", and the 29.4.0 go.mod pins v0.29.0 (https://docs.docker.com/engine/release-notes/29/). I did not test what older engines do. My reading of gateway.go is that they would try to resolve an image called docker.io/library/dockerfile.v0 and fail.
   - Corrected: This holds only on BuildKit v0.30.0 or later, which in the builder inside dockerd means Docker Engine 29.5.0 or later, and only when the build goes through buildx (which rewrites the arg into a gateway request). It also stops holding if the client passes a build context named 'dockerfile.v0': BuildKit then loads the frontend from that context instead of the built-in one. Older engines have neither the documented behaviour nor the routing code.
2. **Confirmed.** The '--network' option of 'docker buildx build' sets the networking mode for RUN instructions only (default, none or host). Fetches that BuildKit makes itself (base images, a '# syntax=' frontend image, ADD of a URL or git source) are not made under that mode.
   - Evidence: The flag text is "Set the networking mode for the "RUN" instructions during build" (buildx commands/build.go:581). The docs list default, none and host (https://docs.docker.com/reference/cli/docker/buildx/build/). buildx accepts only those values (build/opt.go:640-648). Part 2 comes from my reading of BuildKit source; no doc states it. In LLB, NetMode is a field of ExecOp only, and SourceOp (image, git, http) has no network field (solver/pb/ops.proto:45-51, 82-86, 196-202). The Dockerfile frontend sets the mode on the stage state that RUN steps use (dockerfile2llb/convert.go:841). The HTTP source uses the daemon's http.RoundTripper (source/http/source.go:57-74, 216-217). git runs as a subprocess of the daemon with only CLONE_FS unshared (source/git/source_linux.go). All at https://github.com/moby/buildkit.
3. **Partly.** On Docker Engine 29.0 and later, the containerd image store is the default only on fresh installations. An upgraded installation keeps the overlay2 graph driver until the containerd-snapshotter feature is enabled in /etc/docker/daemon.json.
   - Evidence: The docs say: "default storage backend for Docker Engine 29.0 and later on fresh installations". For upgrades: "continues using the legacy graph drivers (overlay2) until you enable" it (https://docs.docker.com/engine/storage/containerd/). The 29.0.0 release notes say "now the default for fresh installs", except with userns-remap. The moby source decides on what is on disk, not on whether the install was upgraded. daemon/image_store_choice.go picks containerd unless graphdriver.HasPriorDriver(root) is true, which gives the result 'graphdriver-prior'. HasPriorDriver is true when any registered graph driver other than vfs has a non-empty directory under the data root (daemon/graphdriver/driver.go:236-255, https://github.com/moby/moby).
   - Corrected: The real test is whether a non-empty graph-driver directory exists under the data root. It can be any driver except vfs (overlay2, btrfs, zfs, fuse-overlayfs...), not only overlay2, and it does not have to come from an upgrade. Graph drivers are also kept when storage-driver or DOCKER_DRIVER is set explicitly, when features.containerd-snapshotter is false, and always under userns-remap. Two things switch the store: setting features.containerd-snapshotter to true (old images become hidden, they are not migrated), or the experimental features.containerd-migration option.
4. **Confirmed.** When the Docker daemon uses the containerd image store, buildx sets 'prefer-image-digest' and writes the manifest or index digest, not the image config digest, to the file named by --iidfile.
   - Evidence: All in buildx (https://github.com/docker/buildx). driver/docker/driver.go:95-107 sets the PreferImageDigest feature when a worker carries the label org.mobyproject.buildkit.worker.snapshotter. Moby sets that label on its containerd worker (daemon/internal/builder-next/controller.go:128-130). build/opt.go:543-548 then sets prefer-image-digest=true on the moby exporter. build/build.go:1025-1032 deletes containerimage.config.digest from the exporter response. commands/build.go:438-439 and 469-475 write containerimage.digest to --iidfile, and fall back to the config digest only when that key is present. On the BuildKit side, exporter/containerimage/export.go:373-376 sets containerimage.digest to the exported descriptor's digest, which is the manifest or index digest.
5. **Confirmed.** The BuildKit embedded in dockerd allows the 'network.host' and 'device' entitlements by default unless daemon.json disables them. A build therefore gets host networking whenever the client requests it (buildx adds network.host itself for '--network host'), so the client's command line is the only gate.
   - Evidence: moby daemon/internal/builder-next/controller.go:604-618 says "In case of no config settings, NetworkHost and Device should be enabled". security.insecure is off unless set. The daemon.json keys are builder.entitlements.network-host / device / security-insecure (daemon/config/builder.go:135-139, https://github.com/moby/moby). buildx build/opt.go:640-643 appends network.host to AllowedEntitlements for --network host (https://github.com/docker/buildx). BuildKit util/entitlements/entitlements.go:115-147 refuses only entitlements that the daemon does not allow. No docs.docker.com page states these dockerd defaults, so this rests on source alone. Calling the client's request 'the only gate' is my inference: any client with access to the Docker API can ask for it, and a Dockerfile 'RUN --network=host' still needs the client to pass --allow network.host.
6. **Confirmed.** BuildKit treats build secrets with the IDs GIT_AUTH_TOKEN, GIT_AUTH_HEADER, HTTP_AUTH_TOKEN_<host> and HTTP_AUTH_HEADER_<host> as credentials, which it sends when it fetches remote git or HTTP sources.
   - Evidence: Docs: GIT_AUTH_TOKEN/GIT_AUTH_HEADER are 'pre-flight' secrets for private Git remote contexts and ADD of a Git repo. HTTP_AUTH_TOKEN_<host>/HTTP_AUTH_HEADER_<host> authenticate ADD/COPY requests to that host (https://docs.docker.com/build/building/secrets/). Second source, BuildKit code: llb.Git defaults AuthHeaderSecret=GIT_AUTH_HEADER and AuthTokenSecret=GIT_AUTH_TOKEN (https://github.com/moby/buildkit/blob/master/client/llb/source.go L363-398). The git source also tries GIT_AUTH_TOKEN.<host> first. It sends the token as Basic 'x-access-token:<token>' through git -c http.<remote>.extraheader (source/git/source.go L426-460). The HTTP source tries HTTP_AUTH_HEADER_<url hostname>, then HTTP_AUTH_TOKEN_<hostname>, the latter prefixed 'Bearer ', and sets the result as the Authorization header (source/http/source.go L43-45, L996-1018). A missing secret is skipped without error, so nothing is sent unless the build client supplies a secret with that ID. Not established: behaviour of older BuildKit versions; I read current master only.
7. **Confirmed.** With a tar piped to 'docker build -', the tar's contents are the build context and '-f' names the Dockerfile relative to the tar's root. Neither buildx nor BuildKit's Dockerfile frontend applies .dockerignore to such a context.
   - Evidence: First part, from the docs: 'the build uses the contents of the tarball as a filesystem context'. The --file flag gives the Dockerfile's location 'relative to the root of the tarball' (https://docs.docker.com/build/concepts/context/). Second part rests on source only; no Docker doc states it. In buildx, when the context is '-' and stdin is an archive, buildx uploads it as-is through uploadprovider (URL http://buildkit-session/<id>). It makes no local mount, so the client filters nothing, and it passes -f unchanged as the 'filename' attribute (https://github.com/docker/buildx/blob/master/build/opt.go L931-946, L914, L1078; moby/buildkit session/upload/uploadprovider/provider.go L24-27). In BuildKit dockerui, initContext treats that http:// context as an archive, unpacks it into scratch and sets bctx.context (frontend/dockerui/context.go L106-141). MainContext returns bctx.context before dockerIgnorePatterns runs, and DockerIgnorePatterns returns nil when bctx.context is set (frontend/dockerui/config.go ~L451-458, L515-527). Caveat: the legacy non-BuildKit builder does read .dockerignore from the tar, but only to drop .dockerignore and the Dockerfile itself (moby daemon/builder/remotecontext/detect.go L116-138). Not tested on a real daemon; I read current master only.
8. **Partly.** 'docker compose up' builds a service's image when the service has a 'build:' section and the image is missing, unless '--no-build' is passed or the service's pull_policy prevents it.
   - Evidence: Spec: when both build and image are set and pull_policy is absent, 'Compose attempts to pull the image first and then builds from source if the image isn't found in the registry or platform cache' (https://github.com/compose-spec/compose-spec/blob/main/build.md L21-23; https://docs.docker.com/reference/compose-file/build/). The up reference describes --no-build as 'Don't build an image, even if it's policy' (https://docs.docker.com/reference/cli/docker/compose/up/). In docker/compose source, the build step skips a build: service only when its image is already local and pull_policy != build (internal/build/build.go L100-107). mustPull never pulls for 'never' or 'build', always pulls for 'always', and by default pulls only when the image is missing (pkg/compose/pull.go L512-538). A failed pull is ignored for buildable services, which are then built (pull.go L426-428). --no-build sets the build options to nil (cmd/compose/create.go L113-119), and --build forces pull_policy=build (L184-194). So no pull_policy blocks the build ('never' still builds). The real exception is a pull of the image: name that succeeds. Not established: the Compose version on the server; I read current main.
   - Corrected: 'docker compose up' builds a build: service whose image is not in the local image store, and always rebuilds it with --build or pull_policy: build, unless --no-build is passed. No pull_policy value prevents that build: 'never' still builds. But when the service also names image:, the default policy (and 'always') makes Compose pull that name first. It uses the pulled image if the pull succeeds and builds only if the pull fails, so a registry image can silently replace the build.
9. **Confirmed.** Build arguments may persist in the image metadata, in provenance attestations and in the image history. Secrets mounted with 'RUN --mount=type=secret' are not stored in the image or the build cache.
   - Evidence: Build args 'may persist in the image metadata, as provenance attestations and in the image history' (https://docs.docker.com/build/building/variables/). The Dockerfile reference gives a second source: ARG HTTP_PROXY 'is preserved in the docker history' (moby/buildkit frontend/dockerfile/docs/reference.md L2843). The reference's mount table says a secret mount gives access 'without baking them into the image or build cache' (https://docs.docker.com/reference/dockerfile/; buildkit reference.md L885). The secrets page itself mentions only the image, not the cache: the secret is 'temporarily available inside the build container, for the duration of the build instruction' (https://docs.docker.com/build/building/secrets/). My inference, not read anywhere: anything a RUN step copies from the secret onto disk is kept in that layer like any other file. Not established: whether changing a secret's value invalidates the cache.
10. **Confirmed.** buildx's '--resource' flag constrains the containers that run RUN instructions, per step rather than for the whole build. It requires a BuildKit with the 'exec.meta.linux.resources' capability (BuildKit 0.31, in Docker Engine 29.6 or later).
   - Evidence: Docs: the flag 'constrains the resources available to the containers that run your RUN instructions'. The limits 'apply to each step in isolation rather than to the build as a whole'. They need the 'exec.meta.linux.resources' capability and take effect on Linux only (https://docs.docker.com/reference/cli/docker/buildx/build/; github.com/docker/buildx docs/reference/buildx_build.md L1173-1203). moby/buildkit#6569 was merged on 2026-05-27 with milestone v0.31.0. The capability is in solver/pb/caps.go at tag v0.31.0 and absent at v0.30.0. Engine release notes: 29.6.0 (2026-06-18) says 'Update BuildKit to v0.31.0' and 29.5.0 says v0.30.0 (https://docs.docker.com/engine/release-notes/29/). moby tag docker-v29.6.0 vendors buildkit v0.31.0. Extra: the flag came in buildx commit 80b2293881, first released in buildx v0.35.0, so the client also needs buildx 0.35 or later. buildx always sends the limits as frontend attributes (build/utils.go L148-170). If the daemon lacks the capability, the Dockerfile frontend drops them silently with no error (moby/buildkit frontend/dockerfile/dockerfile2llb/convert.go L1579). Not established: whether the buildx bundled with Engine 29.6 packages is 0.35 or later, and whether an older '# syntax=' frontend ignores the limits (my inference: yes).
