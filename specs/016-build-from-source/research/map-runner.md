# Research record: the runner, today and for building from source (a snapshot at commit 00912ad)

Written on 2026-11-27 for the plan of feature 016, from reading the code and from experiments on this Mac. Line numbers go stale. Proposals in it are the writer's; nothing here is decided. Two marks are used throughout:

- **[read]**: from reading this repository, or the source of Docker's tools. Not run.
- **[ran]**: run on this Mac, on **Docker Desktop 4.82.0** (Engine 29.6.1, containerd image store, BuildKit v0.31.1 in the daemon, buildx v0.35.0-desktop.2, Compose v5.3.0, Bun 1.4.4). Docker Desktop is not a plain Linux engine. **Every [ran] result must be repeated on Linux, on both image stores, before the plan relies on it** (FR-089, FR-089b).

The scripts are in `.specify/plan-016/runner/`, a folder git ignores, (one folder per experiment, `eNN/run.sh`; outputs in `out/`). A scratchpad can be cleared; the results that matter are copied into part 3.

## 1. Summary

- Today a deploy is one span under one lock file. Every check comes before the number is used, then `docker compose up -d --remove-orphans` runs in the runner's folder for at most 30 minutes, then routes and the health check. A refusal is one word. Nothing in the runner builds, and nothing stops Compose from building.
- Four results from this Mac change the design (all [ran], Docker Desktop only):
  1. `--build-arg BUILDKIT_SYNTAX=dockerfile.v0` does **not** select the built-in Dockerfile reader. BuildKit tries to pull an image named `docker.io/library/dockerfile.v0` and the build fails. Point 4's "the server ignores `# syntax=`" cannot be done that way here (part 3, E02).
  2. A step built with a mounted secret **is reused** by a build with another value of the secret, and by a build with no secret. `--no-cache` does not help other builds: its result is reused by the next build. A runner-chosen `--add-host` name is part of every `RUN` step's cache key, so it works as a per-app, per-secret salt (E05).
  3. On the containerd store, `--iidfile` holds the **config** digest, while `docker image inspect .Id` gives the **manifest** digest. The metadata file holds both (E01).
  4. Killing the build client stops the step at once. But when only the reader of its output goes away (a runner that dies), a silent step **goes on** (E04).
- Also [ran]: Docker's record of a build holds the build arguments with their values and the builder's whole output, and `docker buildx history rm <ref>` removes it. A private `BUILDX_CONFIG` folder gets one file per build the runner starts, named by its ref, so the runner can always find and remove exactly its own records, after a restart too (E01, E04, part 3 "Cleanup"). `docker compose up --no-build` refuses a missing image instead of building it (E08). Proxy settings of the client's `config.json` reach every build step (E10).
- The plan needs a second lock, a `pack` command, a fixed builder invocation in a module of its own, a state mark 5, a private `BUILDX_CONFIG`, a marker file for the build in progress, and new report fields that only `deploy` answers carry.

## 2. The runner today

### 2.1 How a request arrives [read]

| What | Where |
|---|---|
| One-shot commands: `setup`, `sync`, `apply`, `status`, `version`, `session`. `deploy`, `records`, `proxy` exist only in a session. | `apps/runner/src/main.ts:20`; `apps/runner/src/session/session.ts:1-8` |
| A one-shot command reads at most `LIMITS.messageBytes` (32 MiB) from standard input. | `main.ts:26-35` |
| A session reads one request per line, at most 32 MiB a line. A longer line is dropped as it arrives and refused. | `session.ts:115-141`, `:269` |
| At most 32 MiB and 1,024 lines may wait. A client further ahead ends the session. Three bad lines in a row end it too. | `session.ts:32-42`, `:272-279`, `:320-323` |
| Requests run one at a time. Each gets zero or more events, then one `result` frame. The session waits until the result has left before it reads the next request. | `session.ts:315-331` |
| The input is turned back into text and parsed again by the command's own schema. | `session.ts:159-167` |
| Progress frames are dropped once 8 MiB is unsent. Results are never dropped. | `session.ts:51`, `:87-102` |
| A reader that went away (EPIPE) does not stop a deploy: it finishes, and its answer is lost. | `session.ts:63-109`, `:226-237` |
| An exception inside a command becomes `refused`/`invalid_state`, with no detail. | `session.ts:213-216`; `main.ts:80-88` |
| Exit status: 1 for `refused` or `start_failed`, else 0. | `main.ts:76-77` |
| Protocol number 5. Commands of a session and their frame bounds (`deploy`: 64 KiB). | `packages/core/src/protocol/session.ts:39`, `:48-61`, `:129-150` |

### 2.2 How a version-2 deploy is checked, numbered and started [read]

`deploy()` in `apps/runner/src/commands/deploy.ts:145-210`, in the order of 014's `contracts/runner-checks.md` (K1 to K17) and 015's additions:

| Step | What | Where | Refusal |
|---|---|---|---|
| K1 | The request schema (team lists, envelope, at most 256 records). | `deploy.ts:153-155`; core `protocol.ts:164-168` | `invalid_request` |
| K2 | Set up, private folder, then the lock (`locked`), then key and state read. | `deploy.ts:157-159`; `commands.ts:61-79`, `:177-194` | `not_set_up`, `invalid_state`, `busy` |
| K3 | The team lists sent with it are followed and saved at once, even if the deploy is refused later. | `deploy.ts:161-164`; `commands.ts:86-97` | roster reasons |
| K4-K14 | `verifyDeployV2`: envelope, signer, payload, order, expiry, domains, secrets and records. A non-empty `builds` or a pre-deploy command is refused `unsupported_version` here, after the format checks. | `deploy.ts:166-176`; core `deploy/message.ts:155-167` | core reasons |
| K15 | Limits of what the runner would hold: apps, secrets, record files (8,192 and 64 MiB), domains, health bytes. | `deploy.ts:178-189`, `:64-92` | `too_large` |
| K16 | Every listed secret opens, or none is used. | `deploy.ts:191-193` | `secrets_mismatch` |
| K17 | Record files written, then the state: **the number is used here**. Then files no live secret names are deleted. | `deploy.ts:195-200` | none |
| Start | `composeStart`: Compose text written, then `up`. | `deploy.ts:201-207`; `commands.ts:230-252` | outcome `started` or `start_failed` |
| After | Routes put in force, then the health wait. | `deploy.ts:102-143`, `:208` | `routes_failed`, `unhealthy` |

`apply` (version 1) is the same shape with `verifyDeploy` against the version-1 view (`commands.ts:287-330`).

### 2.3 The lock [read]

- One file, `<home>/lock` (`home.ts:79`). `acquireLock` creates it complete by linking a finished file into place. Its content is `pid:token`. Only the run whose mark is inside removes it (`home.ts:302-359`).
- A lock whose pid no longer exists is moved aside and taken over (`home.ts:330-358`). An unreadable lock counts as held.
- `locked()` checks set-up and privacy before it takes the lock, and answers `busy` when the lock is held (`commands.ts:177-194`). `setup` takes the same lock itself (`commands.ts:126-146`).
- Everything that writes takes it: `setup`, `sync`, `apply`, `deploy`, `proxy` (`proxy.ts:81`). `status`, `records`, `state` and `logs` take no lock.
- So a `sync` during a deploy is refused `busy` today. Feature 014 put the second lock off "until builds make deploys long" (`specs/014-deploy-v2/spec.md:298`, decision 5; `contracts/runner-checks.md:99`). The design's two locks are in `specs/010-app-settings/deploy-v2.md:1162-1183`.
- The routes code already writes the state the way two locks need: it reads the state again and changes only its own part (`routes/apply.ts:146-152`; `routes/released.ts:33-37`).

### 2.4 The state file and its marks [read]

- `<home>/state.json`, written whole by `writeAtomic`: a temporary file created exclusively, synced, renamed, folder synced (`home.ts:147-172`, `:211-214`). Mode 0600. A reader sees the old file or the new one.
- Marks (`packages/core/src/deploy/state.ts:92-104`, `:270-333`):

| Mark | Written by | Holds |
|---|---|---|
| none | runner 0.1.0 | server id, team, `lastSequence`, `secrets` |
| 2 | feature 014 | + `formats` (1 or 2 per app) |
| 3 | runner 0.1.1-dev.1 | + `routes` (routes, health check, container names per app) |
| 4 | runner 0.1.1 | + `released` (domains whose certificate is still to delete) |

- Every older mark is read strictly and lifted to 4 in memory; nothing is written by reading (`state.ts:311-333`). An unknown mark or field is refused (`invalid_state`). So a runner put back by hand refuses a newer state (FR-085 holds by bumping the mark).

### 2.5 How the app is started [read]

- `composeUp` (`apps/runner/src/docker/compose.ts:120-208`) runs `docker compose -p zekno-<app> -f <home>/apps/<app>/compose.yaml up -d --remove-orphans` (`:144-154`), in the runner's own folder (`:170`), standard input closed.
- Environment: the opened secrets, minus reserved names, then `PATH`, `HOME`, `DOCKER_HOST`, `DOCKER_CONFIG`, `DOCKER_CONTEXT`, `XDG_RUNTIME_DIR`, which win (`compose.ts:7-14`, `:136-142`). The reserved names are `PATH`, `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, `GODEBUG` and `DOCKER_*`, `COMPOSE_*`, `BUILDKIT_*`, `BUILDX_*`, `LD_*`, `DYLD_*`, `SSL_CERT_*`, `*_PROXY` (`packages/core/src/secrets/secrets.ts:32-36`).
- No `--no-build`. No `pull_policy` is written anywhere in the code today: the CLI's Compose text carries none, so Compose pulls a missing image and builds a service that has `build:` (part 3, E08).
- **The 30-minute limit**: `START_LIMIT_MS` (`compose.ts:75-81`). `withinLimit` waits for the outputs and the exit, and past the limit stops Docker (`stopChild`: SIGTERM, then SIGKILL after 2 s, `inspect.ts:87-96`) and gives the outputs 1 s more (`compose.ts:95-110`; `run.ts:37`). A start stopped there is `start_failed` with `startLimit` in whole seconds (`commands.ts:210-252`). Whatever Docker made by then stays.
- Docker's lines go out as `progress` events of at most 4,096 characters, never after the answer (`compose.ts:16-17`, `:156-186`). A line is cut at 4,096; a line with no end is cut too (`compose.ts:49-73`).
- Other Docker calls use `runDocker`: 60 s limit, each output kept to 1 MiB, no shell (`apps/runner/src/docker/run.ts:28-103`).

### 2.6 How outcomes and refusals are reported [read]

- `RunnerReportSchema` (`packages/core/src/protocol/protocol.ts:241-264`) is strict: `outcome`, optional `app`, `sequence`, `reason`, `routes`, `health`, `startLimit`. There is no free-text field.
- Outcomes: `ok`, `started`, `start_failed`, `refused`, `routes_failed`, `unhealthy` (`protocol.ts:180-190`). The first that holds wins: `start_failed`, `routes_failed`, `unhealthy`, `started` (`deploy.ts:14-17`, `:102-143`).
- `reason` is present exactly with `refused`. `routes` exactly with `routes_failed`; `health` exactly with `unhealthy`; `startLimit` only with `start_failed`.
- **What a refusal can carry today: only `outcome` and `reason`.** `refused()` sets nothing else (`commands.ts:43-47`). Reasons are `DEPLOY_REFUSALS`, `DEPLOY_V2_REFUSALS` (`secret_missing`, `untrusted_secret`, `expired`, `domain_taken`), `ROSTER_REFUSALS` and `RUNNER_REFUSALS` (`invalid_request`, `invalid_state`, `not_set_up`, `already_set_up`, `busy`) (`packages/core/src/protocol/result.ts:21-74`; `protocol.ts:172-178`).
- The CLI turns `busy` into "The runner is in the middle of another deploy. Try again in a moment." (`apps/cli/src/cli/errors.ts:60`).

### 2.7 What the runner keeps [read]

| Path in `<home>` | What | Where |
|---|---|---|
| `server.key`, `server.pub` | the server's key pair | `home.ts:76-77`, `:179-205` |
| `state.json` | the state, mark 4 | `home.ts:78` |
| `lock` | the one lock | `home.ts:79` |
| `apps/<app>/compose.yaml` | the Compose text of the last accepted deploy | `home.ts:80`, `:216-227` |
| `records/<app>/<hash>.json` | each live secret's statement and sealed value, as it arrived | `home/records.ts:1-161` |
| `proxy/etc/caddy.json` | the proxy's configuration (folder 0755, file 0644) | `home.ts:81-85`, `:229-272` |

`<home>` is `/var/lib/zekno` for root, else `~/.local/state/zekno`, or `ZEKNO_RUNNER_HOME` (`home.ts:27-73`). The folder, key and state must be the user's and closed to others (`isPrivate`, `home.ts:116-127`). Nothing decrypted is written there.

### 2.8 What `status` and `zekno doctor` get today [read]

- `status` (one-shot or session, no input): server id, key, team (id, version, hash), `lastSequence`, and per secret its version and whether removed; built from the version-1 view so its shape never changes (`commands.ts:149-170`).
- `status` with `{ "routes": true }` (session, protocol 4): the same, plus routes and health checks in force and the proxy's state (`commands/proxy.ts:33-66`; core `session.ts`, `RunnerStatusWithRoutesSchema`).
- `state`: for each deployed app, `docker compose ps` reduced to service, state, exit code and health (`docker/inspect.ts:164-188`). `records`: the statements of an app's live records (`commands/records.ts:40-77`).
- `zekno doctor` runs a fixed shell script over SSH (`apps/cli/src/server/check-script.ts:36-91`): it reports `docker ok <compose version>` or `docker none`, whether a runner file is at the path, and `df -Pk` of the runner's folder. Then it asks the runner `version` and `status` (`apps/cli/src/ops/doctor.ts:513-563`). Its Disk line warns below 1 GiB free and calls 256 MiB a problem (`doctor.ts:256-258`, `:582-593`). Nothing reads the Docker Engine version, the build plugin, BuildKit, the processor type, memory, or the free space where Docker keeps its data.

### 2.9 The installer's limits [read]

`apps/cli/src/server/install/script.ts` and `checks.ts`:

- It needs `docker` and a working `docker compose` (`script.ts:202-206`). It does not check the Engine version, the build plugin or BuildKit.
- Linux on x86-64 or ARM64 only (`script.ts:264-269`); glibc 2.17 or newer, musl refused (`:111-130`).
- A runner file of at most 256 MiB (`checks.ts:19-20`; `script.ts:286`, `:291`, `:294-295`); when a download fails with less than 256 MiB free, it says so (`:139-145`).
- It makes the runner's folder 0700 if missing (`script.ts:324-327`), and nothing inside it. It never uses `sudo`.
- So a server that runs today's runner may have no build plugin and any Engine version. Builds need no change to the installer if `doctor` and the runner say what is missing (FR-078).

## 3. Experiments on this Mac [ran, Docker Desktop only]

Images were named `zekno.invalid/zekno-plan-016-*` or `zekno-plan-016-*`, containers `zekno-plan-016-*`. From E04 on, buildx ran with `BUILDX_CONFIG` set to a scratch folder.

| # | Tried | Result | What it means for the runner |
|---|---|---|---|
| E01 | A Dockerfile build from a tar on standard input, `--provenance=false --sbom=false`, `-t`, `--iidfile`, `--metadata-file` | Built. **iidfile = config digest** (`sha256:c92e…`). **`docker image inspect .Id` = manifest digest** (`sha256:0650…`). The metadata file holds `containerimage.config.digest`, `containerimage.digest`, `buildx.build.ref`, and `buildx.build.provenance` with the base image's digest in `materials` (`pkg:docker/busybox@1.36`, `sha256:73aa…`) and the build arguments with their values, even with `--provenance=false`. | Record both digests from the metadata file. A kept tag is still ours when `.Id` equals either. Base-image digests can be read after a build (FR-066). Delete the metadata file once read. |
| E01 | The build's record: `docker buildx history ls/inspect/logs` | The record lists the build arguments with values, the cache-mount namespace, materials, attachments, step counts. `history logs` shows a marker the step printed. No secret id or value appeared in it. | FR-031b is needed: the record holds the output and the arguments. |
| E01 | `docker buildx history rm <ref>` | Exit 0. `ls` no longer lists it; `inspect` and `logs` say "ref … is deleted". | One record can be removed by its ref. Whether the bytes leave Docker's storage was **not** checked (see part 7). |
| E02 | `--build-arg BUILDKIT_SYNTAX=dockerfile.v0`, with and without a `# syntax=` line naming an image that does not exist | **Both fail**: "resolve image config for docker-image://docker.io/library/dockerfile.v0:latest … pull access denied". Without the argument, a plain Dockerfile builds, and a `# syntax=` line makes BuildKit try to pull the image it names. An empty value is refused by buildx. | Research part 8, claim 1 does not hold here. buildx 0.35 rewrites the argument to the `gateway.v0` frontend with that source [read: buildx `build/opt.go`]; moby 29.6.1 vendors a reroute of that case in `llbsolver.Solver.Solve` [read], which this path evidently does not reach (my inference: buildx sends the request through its client-side gateway). Point 4 (a) and FR-034, FR-037c need another way, or a Linux result that differs. |
| E04 | `RUN` loop that calls a server on the Mac every second; client stopped with SIGTERM after 10 s (the runner's `stopChild`) | Client exit 130, step `CANCELED`, **calls stopped at once** (10 before, 10 after 15 s). Record status `Error`. | Point 24's open question ("does the builder stop when told") holds here. |
| E04 | The same, client killed with SIGKILL | Calls stopped at once. The `docker` front program was killed; its buildx plugin noticed and cancelled. No process left. | A runner's own time limit stops a build. |
| E04c | The reader of the client's output exits after 1 byte (a runner that dies); the client itself is left running | **The silent step went on** (22 calls after 22 s, client alive). Stopping the client then stopped it. | A runner that restarts must find and stop the orphan client itself (part 4.11). |
| E04 | Where buildx keeps its client state | One file per build, named by its ref, appears in `$BUILDX_CONFIG/refs/<builder>/<node>/` while the build runs. All 31 records my builds made matched the 31 ref files exactly. | A private `BUILDX_CONFIG` lists exactly the builds the runner started (FR-031b, "never a record of a build it did not start"). |
| E05 | `RUN --mount=type=secret,id=NPM_TOKEN` writing the secret's length, built with value `one`, then `twotwo`, then no secret | 2nd and 3rd: **step CACHED**, image holds the length of `one`. | A changed or absent secret does not make the step run again (FR-037d needs a mechanism). |
| E05 | `--no-cache` with `three`, then a build with no secret and cache allowed | The `--no-cache` build ran the step; the next build **reused its result** (length of `three`). | `--no-cache` alone cannot keep other builds from reusing a secret step. |
| E05 | `--add-host zekno-salt-1111:127.0.0.1` with `one`; again with the same; another salt with no secret | First ran, second CACHED, third ran. The name appears in the record's `ExtraHosts`, not in the image's config or history. | A runner-picked `--add-host` name is in every `RUN` step's cache key: a working salt. Undocumented behaviour. |
| E05 | `--build-arg no_proxy=…`; `BUILDKIT_CACHE_MOUNT_NS=other`; `--ulimit nofile=1024:1025` | Proxy argument and cache namespace: CACHED (not in the key). `--ulimit`: ran (in the key, but it changes the build's limits). | Neither proxy arguments nor the cache namespace can serve as a salt. |
| E05 | The record's step counts | `NumCachedSteps` was 3/6 both when the secret step ran under `--no-cache` and when it was cached. | Step counts cannot tell whether the cache was used. Per-step `cached` from `--progress=rawjson` can (E06). |
| E06 | `--no-cache`, and `--no-cache --pull`, read through `--progress=rawjson` | `RUN` vertex `cached: false`. `FROM` and the context vertices still `cached: true`. | FR-021a's check: a fresh build fails when a vertex named `[stage …]` other than `FROM`, and not `[internal]`, is cached. |
| E07 | `RUN --mount=type=cache,target=/c` under `BUILDKIT_CACHE_MOUNT_NS` a, b, a, none, then a with `--no-cache`, then a again | a and b kept apart; a saw its own earlier run; no namespace was a third folder. **`--no-cache` got an empty cache folder, and the next build in a saw only that new one.** | FR-035 holds here. FR-037g and FR-089's question: a build with no cached step does not read the app's cache folders, and replaces them for later builds. |
| E08 | `docker compose up -d --remove-orphans` (today's flags) with `build: .` and `image: zekno.invalid/…`, `pull_policy: never` | **Compose built the image.** | Runner 0.1.1 most likely builds from hand-written Compose text too (to run on Linux, FR-089). |
| E08 | The same with `--no-build`; `build:` with no `image:`; a kept image; a missing image | Refused "No such image" (exit 1); refused; started; refused. | `--no-build` is the way FR-076 holds (part 4.6). |
| E09 | A build from a folder on disk, the recipe in another folder | The folder's `.dockerignore` was applied. An empty `<recipe>.dockerignore` beside the recipe replaced it. A `<recipe>.rego` beside the recipe **was loaded** (the build failed on it); `--policy reset=true` stopped that. A `Dockerfile.rego` in the folder buildx ran in was **not** loaded for a tar on standard input. | For Railpack (FR-049): the plan in a runner-made folder of its own, with an empty `plan.json.dockerignore`. Whether Railpack's frontend honours that file is not known. |
| E10 | `proxies` in the client's `config.json` | `HTTP_PROXY`, `http_proxy`, `NO_PROXY` reached the `RUN` step. `--build-arg HTTP_PROXY=` (and the other four upper-case names, empty) removed them. They were not in the image's history. | FR-036 ("settings of the server's own Docker client … MUST NOT add any") needs one of the two ways of part 4.5. |
| E10 | A private `DOCKER_CONFIG` | `docker` could no longer find the buildx plugin, which Docker Desktop keeps in `~/.docker/cli-plugins`. | A runner-owned `DOCKER_CONFIG` can break plugin lookup on some installs. |
| E12 | `--resource memory=64m`, a step that holds 300 MB | **Not applied**: the step finished. No warning. | No memory limit per step is available here anyway (point 9). Out of memory was not reproduced. |
| — | Bun 1.4.4: `node:zlib` `zstdDecompressSync(…, { maxOutputLength: 8 MiB })` on 8 KB that opens to 256 MiB | Throws `ERR_BUFFER_TOO_LARGE`; memory grew by about 8 MiB. `fs.statfsSync` exists. | Bounded decompression (FR-029) and free-disk readings need no package. Repeat in the compiled runner on Linux. |

**Cleanup and side effects.** My images, containers, Compose projects and the 37 build records I made were removed; the scratch `BUILDX_CONFIG` holds only my refs. 28 small cache records of my builds (under 1 MB in all) are marked not reclaimable and were left to Docker's own collection; I did not prune anything else. **Side effect**: while my records were present, the daemon's own limit on build records (about 50, the default) removed the 19 oldest records the maintainer already had (April to 18 October 2026). The 18 newest, including the Railpack hand test of 2026-11-26, are still there. The same limit means a runner's builds evict other build records on a server. Looking inside Docker Desktop's virtual machine was not allowed in this session, so whether a removed record's bytes leave Docker's storage was not checked.

## 4. Design for the runner

### 4.1 The requirements that land in the runner

| Requirement | Where in this part |
|---|---|
| FR-021a, FR-022, FR-023 (fresh build; key computed again) | 4.2, 4.5, 4.12 |
| FR-028, FR-029, FR-029a, FR-030, FR-031, FR-069 (pieces, checks, staging) | 4.2, 4.3 |
| FR-031a, FR-031b (output, reasons, Docker's record) | 4.10, 4.11 |
| FR-032, FR-033, FR-033a, FR-034, FR-034a, FR-035, FR-036, FR-036b, FR-036d, FR-037, FR-037b, FR-037c, FR-037d, FR-037e, FR-037h, FR-038 (the build's fixed form) | 4.5 |
| FR-039 (time limit, holding the lock until no step runs) | 4.5, 4.11 |
| FR-040 (free-disk floor) | 4.9 |
| FR-041 (processor) | 4.10 |
| FR-043, FR-045 (a failed build leaves the app alone; the connection drops) | 4.2, 4.11 |
| FR-044 (busy sentence; team list and upload during a build) | 4.4, 4.12 |
| FR-046 to FR-050, FR-049a (Railpack folder) | 4.7 |
| FR-061 to FR-064, FR-067, FR-068 (kept images, rollback, prune) | 4.8 |
| FR-066, FR-078, FR-079, FR-080 (records, doctor, status) | 4.13 |
| FR-076 (never build from Compose text) | 4.6 |
| FR-081, FR-083, FR-085 (protocol, older runners, state mark) | 4.12, 4.14 |
| FR-089, FR-089a (checks on Linux) | part 7 |

### 4.2 A deploy that builds, in order

The state lock ("S") and the deploy lock ("D") are those of 4.4. A refusal before K17 changes nothing but the team lists of K3, and uses no number.

| Step | What | Locks | Refusal or outcome |
|---|---|---|---|
| K1 | Request schema, as today | none | `invalid_request` |
| K2 | Set up, private; take D, then S; read key and state. If a marker of a build in progress is left by a runner that died, clean up first (4.11). | D, S | `busy` (+ `building`, 4.12) |
| K3 | Team lists followed and saved | D, S | roster reasons |
| K4-K14 | `verifyDeployV2`, with core now accepting `builds` whose builder this runner carries out. It computes each key again (FR-023), refuses a credential secret name (FR-037b), a reserved argument name (FR-036), a Railpack build that names a secret (FR-037h), a builder this runner does not carry out (`unsupported_version`, FR-083). | D, S | core reasons |
| K14a | For each build: kept when the state records its key for this app **and** `docker image inspect zekno.invalid/<app>:<key>` gives an `.Id` equal to the recorded manifest or config digest (FR-061, FR-062). | D, S | none |
| K14b | Only when some build is not kept: Docker can build. `docker version` server version at least the floor, `docker buildx version` exits 0, the builder's driver is `docker` (4.5). | D, S | `docker_too_old`, `no_build_plugin` |
| K14c | For each build not kept: every piece staged with its signed hash; each opens with the server key, decompresses to at most 8 MiB, and the stream hashes to the signed size and hash; the tar is exactly zekno's form (FR-030). Nothing is written. | D, S | `pack_missing` (+ `missing`), `pack_mismatch` |
| K14d | Free disk at least the floor (4.9). | D, S | `low_disk` (+ `disk`) |
| K15 | Limits, today's plus kept-build records | D, S | `too_large` |
| K16 | Open the secrets, the build's named secrets among them | D, S | `secrets_mismatch` |
| K17 | Records, then the state: **number used**, `lastBuild[app] = building`. Write the marker `building.json`. Move this deploy's pieces from `packs/<app>/` into `building/<app>/` (emptied first). Release S. | D, S → D | none |
| B1 | Build each build not kept, in order (4.5). Stop at its time limit or below the floor. | D | `build_failed` with a reason (4.10) |
| B2 | Remove Docker's record of each build (4.11). Delete `building/<app>/` and any Railpack folder. | D | none |
| B3 | Take S, read the state again: does the team list still let the signer deploy to this server? Record kept builds and the outcome. Release S. | D, S | `build_failed`, reason `team_changed` (+ `team`) |
| U | Write the Compose text; `up` with `--no-build` (4.6); routes and health as today, their state writes under S, read again. | D (+S) | as today |
| A | Answer. Then, still under D: drop kept builds past three deploys, remove their images, prune the cache, clean staging, remove the marker (4.8). | D | none |

On a failed build the runner never reaches U: the app that runs is not stopped, replaced or re-routed (FR-043). The number was used at K17. A build that succeeded is recorded and kept even if U fails (spec, Edge cases).

### 4.3 Receiving the pieces: a `pack` command

- A new session command `pack`, input `{ envelope, chunk }`, the chunk sealed, base64url. Answer `{ outcome: "ok" }` or a refusal. Frame bound 64 KiB.
- A line holds about 8 MiB compressed and sealed, about 11 MiB as base64url, plus the envelope (at most about 1.4 MiB): within the 32 MiB line limit and queue. The CLI waits for each answer, as for every request.
- Under S only, in one span: the design's steps 4 to 8 for the envelope (signer, signature, payload, team, server, `previous` equal to the app's last number, not expired), with no secrets. This needs a core function for that gate. Then the chunk's `hash("zekno/v1/pack-chunk", sealed bytes)` must be listed by one of the deploy's builds.
- Staging: `packs/<app>/` holds one deploy's pieces, named by chunk hash, with a small file naming the deploy (its payload hash) and when it was staged. A `pack` for another deploy of the app replaces them. At every `pack` and every accepted deploy, pieces of deploys that can no longer run, older than 24 hours, or past 2 GiB in all are deleted (FR-069). Past 2 GiB, `pack` is refused `too_large` (FR-028). `building/<app>/` is never cleaned by this.
- Checking (K14c, and again while building): open with `crypto_box_seal_open`; decompress with `node:zlib` zstd and `maxOutputLength` of 8 MiB, which Bun 1.4.4 carries (part 3, last row; no package); feed the bytes to a streaming BLAKE2b (`crypto_generichash_init/update/final`, core change; today `hash()` takes one buffer, `crypto/hash.ts:27-37`) and to a streaming tar reader that accepts only zekno's form (FR-030). Stop at the signed size.
- `pack_missing` names the missing chunk hashes (at most 64), so zekno sends only those (FR-029a).
- For a Dockerfile build the runner never unpacks: it streams the opened tar into the builder's standard input (4.5). Nothing opened is written to its folder (FR-031).

### 4.4 The second lock (FR-044, the 014 note)

- **Two files**: the deploy lock `lock`, as today, and a state lock `state.lock` beside it, taken by the same `acquireLock`, given a name. The order is always D before S, never the reverse.
- **S covers** every read-then-write of `state.json`, `packs/` and `kept/`. It is short: seconds, never a build. **D covers** a whole deploy, `apply`, and `proxy`.

| Request | Today | Proposed |
|---|---|---|
| `setup` | the lock | D and S |
| `sync` | the lock (`busy` during a deploy) | **S only**: never waits for a build |
| `pack` | — | **S only** |
| `deploy` | the lock | D for the whole deploy; S from K2 to K17, and again for B3 and each write after |
| `apply` (version 1) | the lock | D and S for its whole span (it never builds) |
| `proxy` | the lock | D; S for its state writes, read again |
| `status`, `records`, `state`, `logs`, new reads | none | none |

- **Waiting for S**: S is held for seconds, so a request that finds it held waits, up to a bound (proposed 120 s, since K14b and K14c run a few bounded Docker calls and hash up to 512 MiB under it), then answers `busy`. D is never waited for: held, it is `busy`.
- **Read again**: every state write after K17 takes S, reads the state, changes only its own part, writes the whole state with its mark, and releases S. The routes code already does this (2.3).
- **A team list taken during a build**: at B3 the deploy checks its signer against the team list now in the state (a core function: member, role, allowed on this server). If it no longer holds, the built app does not start: outcome `build_failed`, reason `team_changed`, with the team list's version. The image is still recorded, so it is not built again for nothing; whether it may be reused is the plan's choice (proposed: yes, since another member's signed deploy is needed to run it).
- **A stale S** (its holder died) is taken over as D is today.

### 4.5 Running the build

**The builder is pinned.** The runner sets `BUILDX_CONFIG=<home>/buildx` (a private folder, part 4.11) and passes `--builder <the current context's name>` (`docker context show`, with the runner's environment). Before the first build it checks with `docker buildx inspect --builder <name>` that the driver is `docker`, and refuses `no_build_plugin` otherwise. So a `docker buildx use` of the server's user, or a `docker-container` builder, never takes the build [read; the private folder ran in E04, E10].

**A Dockerfile build, from the tar on standard input** (proposal; flags marked "1b" come with step 1b):

```
docker buildx build
  --builder <context name>
  --file <signed dockerfile path, inside the tar>
  [--target <signed stage>]
  --network <default|none>                         # signed (FR-038); never host
  --build-arg BUILDKIT_CACHE_MOUNT_NS=zekno-<app>   # FR-035 (E07)
  [--build-arg <NAME>=<value> ...]                  # the signed plain variables only (FR-036a)
  --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg FTP_PROXY=
  --build-arg NO_PROXY= --build-arg ALL_PROXY=      # keeps client proxies out (E10); needs the maintainer
  [--secret id=<NAME>,env=ZEKNO_BUILD_SECRET_<i> ...]   # 1b: named secrets, runner-picked env names (FR-037)
  [--add-host zekno-<salt>:127.0.0.1]               # 1b: only with named secrets (FR-037d, E05); needs the maintainer
  [--no-cache --pull]                               # a fresh build (FR-021a)
  --provenance=false --sbom=false
  --tag zekno.invalid/<app>:<key>
  --metadata-file <private work folder>/meta.json
  --progress=rawjson
  -
```

- **No `BUILDKIT_SYNTAX`** for a Dockerfile: on this Mac `dockerfile.v0` breaks every build (E02). Without it the built-in reader is used unless the file has a `# syntax=` directive. Proposed answer, for the maintainer: zekno refuses a Dockerfile with a `# syntax=` directive before signing, and the runner refuses it before the number is used (K14c reads the Dockerfile's entry while it streams the pack; a line matching `^\s*#\s*syntax\s*=` (any case) anywhere in the file is refused, a superset of BuildKit's rule). The other way is a pinned official frontend, `BUILDKIT_SYNTAX=docker/dockerfile:<version>@sha256:<digest>`, which then receives the secrets. Both change point 4 (a) and line B15 of `design/lines.md`. The Engine 29.5 floor of FR-034a rested on `dockerfile.v0`; the plan sets the floor again from the Linux checks.
- **Never passed**: `--allow`, `--network host`, `--ssh`, `--build-context`, `--output`/`-o`, `--load`, `--push`, `--attest`, `--cgroup-parent`, `--security-opt`, `--secret` without `env=`, `src=`, `--file` outside the tar, a context other than `-`. A test reads the argument list the runner builds and fails on any of them (FR-033, SC-008).
- **Environment** (FR-033a): `dockerEnv()` (today's six names), `BUILDX_CONFIG`, and for 1b `ZEKNO_BUILD_SECRET_0…n` with the values of the named secrets only. Nothing else of the runner's environment. A secret never travels under its own name, so it cannot act as a setting of `docker` or buildx (FR-037).
- **Working folder**: a fresh private folder outside `<home>`, created per build and removed after, which also holds `meta.json`. A `<dockerfile>.rego` in the folder buildx runs in was not loaded for a tar on standard input (E09), but an empty folder removes the question.
- **The salt** (FR-037d), with 1b only: `salt = hex(hash("zekno/v1/build-salt", JSON [app, [[name, listed hash] …]]))`, cut to 32 characters, made only from fields the signed deploy lists. A build of the same app with the same secret fingerprints gets the same salt and may reuse its steps. A build of another app, a build that no longer reads the secret, a build with another fingerprint, and a build with no secret (no salt) cannot (E05). It rests on behaviour Docker does not document, so a test on every engine the check covers must fail if two salts ever share a step. Without it, FR-037d can only be met by never caching a secret build **and** keeping others off its steps, which `--no-cache` does not do (E05, D then E). A per-app builder (`docker-container` driver) would also do it, but needs BuildKit's image: a tool for the maintainer.
- **Railpack** (step 2), the code written out as a folder (4.7):

```
docker buildx build
  --builder <context name>
  --file <work>/plan/plan.json                       # outside the code folder (FR-049)
  --build-arg BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend@sha256:<signed digest>   # FR-034
  --build-arg cache-key=zekno-<app>                  # Railpack's own, per app (FR-035, FR-036)
  --build-arg secrets-hash=<hex of signed fields>    # FR-036d
  [--secret id=<NAME>,env=ZEKNO_BUILD_VAR_<i> ...]   # plain variables, as FR-089a shows Railpack takes them
  --build-arg HTTP_PROXY= … --build-arg ALL_PROXY=
  --network default
  --policy reset=true                                # if the server's buildx has it (E09)
  --provenance=false --sbom=false
  --tag zekno.invalid/<app>:<key>
  --metadata-file <work>/meta.json
  --progress=rawjson
  <work>/code
```

  with an empty `<work>/plan/plan.json.dockerignore`, so the folder's own `.dockerignore` is not a setting (FR-049, E09). Whether Railpack's frontend honours that file, `cache-key`, `secrets-hash` and the plain variables as secrets is FR-089a's to show.
- **Output**: buildx writes progress to standard error. The runner parses each `rawjson` line (one `SolveStatus`: `vertexes`, `statuses`, `logs` with base64 data, `warnings`) and sends lines in the plain form (`#9 [build 4/7] RUN npm ci`, the step's own lines, `#9 CACHED`, `#9 ERROR …`) as today's `progress` events of at most 4,096 characters, never after the answer. It keeps none (FR-031a). It notes, in memory only, which `[stage …]` vertices were cached and the error of the vertex that failed.
- **Time limit**: a timer at the signed `timeout`. At it, `stopChild` (SIGTERM, then SIGKILL after 2 s). E04 showed both stop the step at once. Then the runner waits, up to a bound (proposed 120 s), until the build's record is no longer `Running` (`docker buildx history inspect <ref>`), before it releases anything (FR-039). If the record still says `Running`, the marker stays in place, with the state `stopping`, and every deploy is `busy` until it does not.
- **Image identity**: from `meta.json`, `containerimage.digest` (manifest) and `containerimage.config.digest` (config). Not the iidfile (E01). Then `docker image inspect --format '{{.Id}} {{.Architecture}}' zekno.invalid/<app>:<key>`: `.Id` must be one of the two, and the architecture must equal `docker version --format '{{.Server.Arch}}'` (FR-041; `docker info` says `aarch64` where images say `arm64`).
- **Base images and versions** (FR-066): `materials` of `buildx.build.provenance` in `meta.json` (`pkg:docker/<name>@<tag>` with a digest), at most 8 kept, each held to a pattern and length; the Docker and BuildKit versions from 4.13's calls; the reader: "Docker's built-in reader, version <`environment.dockerfileVersion`>" or the Railpack frontend's digest; whether a cached `[stage …]` step other than `FROM` was used. The meta file is deleted once read.

### 4.6 Never building from Compose text (FR-076)

- `composeUp` gains `--no-build`: `up -d --remove-orphans --no-build` (`compose.ts:144-154`). E08: a service with `build:` and a missing image is refused "No such image" (exit 1, so `start_failed`), and a kept image under `pull_policy: never` starts.
- Today it changes nothing for images from a registry: `--no-build` only drops builds.
- The CLI writes `pull_policy: never` for built images, as the design says, so Compose never pulls `zekno.invalid/…`.
- Runner 0.1.1 has no `--no-build`: E08 says Compose builds in that case on Compose 5.3.0. FR-089 runs it on Linux; the docs say what it found.

### 4.7 The Railpack folder (FR-046 to FR-050)

- **Where**: apart from `<home>`, never named `build`: `/var/lib/zekno-unpacked/` for root, `~/.local/state/zekno-unpacked/` otherwise, mode 0700, owned by the runner's user (checked as `isPrivate` checks `<home>`). One folder per build, `<random 24 hex>/`, with `code/` and `plan/` inside. Only the buildx client reads it, so 0700 is enough.
- **When**: only after K14c passed and the number is used (FR-046).
- **How**: the runner's own streaming tar reader, the one that checks the form, writes each entry in the one order zekno writes them. Folders with `mkdirSync(…, 0o755)`; files with `openSync(path, "wx", mode)` (exclusive: never replaces, never follows a link at the final name), then `fchmod` to 0644 or 0755 (no set-user or set-group bit), then the bytes. Names were already checked (relative, no `..`, no empty part, no control character, each once). No link is ever made, so no parent can lead out. It stops at the signed size and at 50,000 entries (FR-048).
- **The plan** is written to `plan/plan.json`, after its fingerprint and its images were checked before the number (FR-049a), with an empty `plan.json.dockerignore` beside it (4.5).
- **Removal**: `rm -rf` of the build's folder (`fs.rmSync`, recursive, no link followed) when the build ends, whatever the result. Before each build, and when a dead runner's marker is cleaned up, everything left in `zekno-unpacked/` is removed (FR-050).
- The free-disk check (4.9) also covers this folder's file system.

### 4.8 Kept images, rollback and the cache (FR-061 to FR-064, FR-067, FR-068)

- **Kept**: for each app, in the state, the deploys whose builds succeeded or were reused, newest first, each with its builds' keys and the two digests. Kept: the deploy the app runs now (the last one that reached U), and the two most recent others, counting once deploys that carry the same images (FR-067). At most 3 entries of 8 builds per app.
- **Removal**, under D after the answer: for each recorded tag no kept entry names, `docker image inspect` it; only when `.Id` is still one of its recorded digests, `docker image rm zekno.invalid/<app>:<key>` (no `-f`; an image a container still uses stays until a later deploy). A tag that leads elsewhere is left alone and dropped from the records. The list comes from the state, never from a list of every image (FR-067).
- **Rollback**: the rollback deploy carries the old builds. K14a finds them kept, or K14c answers `pack_missing`. Proposed: `pack_missing` then also says, per build, `image: "gone"` or `"changed"`, so zekno says G43 or G44 without guessing (design/lines.md, "unclear" item 7). zekno has no pack for a rollback, so it never sends one (FR-064).
- **Fresh builds** (FR-021a): the runner builds with `--no-cache --pull` and fails with `cache_used` when a cached step shows (E06). "Never an older image later" needs the key or a record of the latest fresh build per recipe; that is core's key design (FR-022), not settled here.
- **Cache**: after each deploy, `docker buildx prune --builder <name> --force --max-used-space 10gb` [read; the flag is in buildx 0.35; not run here because it would prune the maintainer's own cache]. It covers builds made outside Zekno (FR-068; the docs say so). Older buildx versions may only have `--keep-storage`; the plan checks the server's buildx.
- Note E07: a `--no-cache` build starts its app's cache folders empty and replaces them.

### 4.9 The free-disk floor (FR-040)

- **Where**: `docker info --format '{{.DockerRootDir}}'`, read once per deploy with `runDocker`. Then `fs.statfsSync` (Bun 1.4.4 has it) on: Docker's root, `/var/lib/containerd` when it exists (the containerd store may keep layers there [read, not checked]), the Railpack folder's parent, and `<home>` (staging). The floor holds for the least of them.
- **Before the number** (K14d): below 2 GiB (FR-040's recommended floor, to be confirmed by measuring a 512 MiB build on Linux) is `low_disk`, and the refusal carries the free bytes and the floor (4.12). A path that cannot be read, such as a remote `DOCKER_HOST`, refuses the build too (proposed: the same reason with no number; the plan decides).
- **During the build**: read every 5 s. Below the floor: `stopChild`, reason `out_of_disk`, and the 4.5 wait for the record.

### 4.10 The bounded failure reasons (FR-031a)

Decided by the runner, in this order, from what it did and what it held in memory; never text the builder printed:

| Reason | When |
|---|---|
| `time_limit` | the runner stopped the client at the signed limit |
| `out_of_disk` | the runner stopped it below the floor, or the failing vertex's error says "no space left on device" |
| `team_changed` | B3 (4.4) |
| `cache_used` | a fresh build showed a cached `[stage …]` step other than `FROM` (E06) |
| `wrong_processor` | the image's architecture is not the server's, or the error says "exec format error" |
| `out_of_memory` | the failing step ended with exit code 137 (a guess: the kernel's OOM kill is SIGKILL; not reproduced, E12) |
| `step_failed` | any other failure |
| `runner_restarted` | recorded at the next start, never answered (4.11) |

The step and the error reach only the zekno that sent the deploy: proposed as one new event before the result, `{ event: "build_error", key, step, error }`, each at most 4,096 characters. The runner keeps neither.

### 4.11 Docker's own record of a build, and a restart (FR-031b, FR-039, FR-045)

- **Finding the ref**: with `BUILDX_CONFIG=<home>/buildx` (0700), buildx writes `refs/<builder>/<node>/<ref>` for each build the runner starts (E04). The runner lists that folder before and after it starts a build: the new file is this build's ref. The files hold the builder's target, `LocalPath` and `DockerfilePath`: paths, no code.
- **Removing it**: when the build ends, whatever the outcome: `docker buildx history rm --builder <name> <ref>`, then delete the ref file. If the removal fails, the file stays, and the next deploy tries every ref left in the folder first. So the runner only ever removes records of builds it started.
- **The marker**: `<home>/building.json` (0600, atomic), written at K17: app, sequence, keys, the phase (`building`, `stopping`, `starting`), when it started, the sum of the limits, the client's pid and its start time from `/proc/<pid>/stat`. It is the source of the `busy` details (4.12).
- **A restart**: E04c showed a silent step survives its runner. So at K2, holding D, when `building.json` exists and its runner is gone: if the recorded pid is alive with the recorded start time and runs `docker`, stop it (`stopChild`); wait until the records of the refs in `<home>/buildx/refs` are not `Running`; remove them; delete `building/<app>/` and `zekno-unpacked/*`; under S, set `lastBuild[app]` to failed with `runner_restarted`; remove the marker. The deploy that arrived then goes on (or is `busy` while a record still runs). The number of the interrupted deploy stays used (spec, Edge cases).
- **A dropped connection** (FR-045): the deploy finishes, as today, and B3 records the outcome. `zekno status` reads it (4.13). A server whose login manager kills a user's processes when SSH closes (`KillUserProcesses=yes`) would stop the runner and its client; the restart path above then records `runner_restarted` [read; not tested].
- **The record's bound**: Docker keeps about 50 records by default and evicts the oldest (part 3, "Cleanup"). The runner removes its own anyway, since its records hold arguments and output.

### 4.12 What reports newly carry (protocol 6; design/lines.md "unclear" item 7)

All new fields are only in answers to `deploy` and `pack`, which only a zekno that checked the protocol sends. `sync`, `status` and `proxy` keep today's shapes, so older zeknos still read them.

| Field | With | Holds |
|---|---|---|
| outcome `build_failed` | a deploy whose build failed or was stopped | `app`, `sequence` and `build: { key, reason }`; with `time_limit` also `limit` (seconds); with `team_changed` also `team: { version }` |
| `building` | `busy` | `{ app, seconds, limit, phase }`: the app, seconds since its build began, the sum of its limits, and whether it builds or starts (E15) |
| `missing` | `pack_missing` | the chunk hashes the runner lacks (at most 64), and per build `image: "gone" | "changed"` when it was kept before |
| `disk` | `low_disk` | `{ free, floor }` in bytes |
| `docker` | `docker_too_old` | `{ version }`, held to a version pattern |
| new reasons | `refused` | `pack_missing`, `pack_mismatch`, `low_disk`, `docker_too_old`, `no_build_plugin` (and `unsupported_version` for a builder or a secret the runner does not carry out, as FR-083 asks) |

The schema keeps its rule that each field comes only with its outcome or reason. Protocol 6 is step 1, 7 is step 2 (FR-081). A runner of step 1 refuses a Railpack build `unsupported_version` before the number (FR-083).

### 4.13 `status` and `doctor`

- **Builds of each app** (FR-045, FR-066, FR-080): a new read-only session request `builds`, input `{ apps: [...] }` (at most 64), no lock. For each app: the builds of the deploy it runs now, each with key, manifest and config digests, builder and its version, Docker and BuildKit versions, reader, cache used, base digests (at most 8), when built; and `lastBuild` (sequence, outcome, reason, when). Frame bound about 1 MiB. `status` itself keeps its shape (FR-033 of 014).
- **Can this server build** (FR-078, FR-079): a new read-only request `builder`, no lock: `docker version` (server version, architecture), `docker buildx version`, `docker buildx inspect` (driver, BuildKit version), `docker info` (`MemTotal`, `DockerRootDir`), free space (4.9), the floor, and what Zekno's builds take: the sizes of kept images (`docker image inspect --format '{{.Size}}'`) and the build cache (`docker buildx du`, total, shared with other builds). Each call through `runDocker` with its limit. `zekno doctor` asks it for servers with a built app, and all servers with `--builds`; a runner below protocol 6 is G36 ("runner 0.1.1 does not build").
- The CLI's check script stays as it is: it already says when Docker or Compose is missing.

### 4.14 State mark 5, files and modules

- **Mark 5** adds `kept` (per app, at most 3 entries of 8 builds: sequence, key, two digests) and `lastBuild` (per app: sequence, outcome, reason, time). About 150 bytes per kept build (design). Mark 4 is read and lifted with both empty. Runner 0.1.1 refuses mark 5, so FR-085 holds.
- **Files**: the detailed record of each kept build in `<home>/kept/<app>/<key>.json` (0600), outside the state, so the state stays small. New folders: `packs/`, `building/`, `kept/`, `buildx/`; files `state.lock`, `building.json`. Outside: `zekno-unpacked/` and the build's work folder.
- **Modules** (no folder named `build`, no file over 500 lines, tests mirrored):

| Folder | What |
|---|---|
| `src/pack/` | the `pack` command's staging and cleaning, opening pieces, bounded zstd, streaming hash, the tar form, the Railpack unpacking |
| `src/builder/` | the fixed argument list, spawning, `rawjson` to progress lines, time limit and disk watch, stopping, reasons, the metadata file, Docker's record |
| `src/kept/` | the reuse check, retention, removal, cache prune |
| `src/disk/` | the free-space readings and the floor |
| `src/home/` | new paths; the locks move to `home/locks.ts` (`home.ts` is 359 lines) |
| `src/commands/` | `pack.ts`, `builds.ts`, `builder.ts`; `deploy.ts` split by subject before it passes 500 lines |
| `test/…` | the same names; the fake Docker (`test/support/docker/fake.ts`, `model.ts`) learns `buildx build`, `buildx history rm/inspect`, `buildx inspect`, `buildx prune`, `image inspect`, `image rm`, `version`, `info` |

## 5. Risks

1. **The built-in reader cannot be forced as the research said** (E02). If Linux behaves the same, point 4 (a) as decided cannot be built; FR-034, FR-037c and step 1b depend on the answer.
2. **FR-037d rests on undocumented behaviour** (`--add-host` in the cache key, E05). A BuildKit change could make secret steps shared again without any error; only a test catches it.
3. **Image identity differs by store** (E01). Comparing the iidfile with `.Id`, as the design says, fails on the containerd store.
4. **Orphan builds after a runner dies** (E04c). Without the marker and the restart path, a build could run on with no lock held.
5. **`--no-cache` empties and replaces the app's cache folders** (E07): a fresh build is slower afterwards, and FR-037g's wording needs care.
6. **Client proxy settings reach builds** (E10). Either way of stopping them changes FR-036's letter or the plugin lookup.
7. **The runner's builds evict other build records** on a shared Docker (Docker's limit of about 50).
8. **Free disk is read in the wrong place** on servers where the containerd store keeps layers outside `DockerRootDir`.
9. **Long spans under S** (K14b, K14c): a `sync` may wait for them; the bound must be generous.
10. **Report fields an older zekno cannot read**: kept to `deploy` and `pack` answers only.
11. **Out of memory is guessed from exit code 137**, never reproduced here (E12).
12. **Railpack's frontend** may ignore the recipe's ignore file, `cache-key` or `secrets-hash`: all unknown.

## 6. What I read but did not run

- The reroute of `gateway.v0`/`dockerfile.v0` in moby 29.6.1's vendored `llbsolver/solver.go`; buildx 0.35's rewrite in `build/opt.go`, its proxy handling (`proxyArgKeyExists`, case-insensitive) and its loading of `<Dockerfile>.rego`.
- `docker buildx prune --max-used-space` (flag present; not run).
- Where the containerd store keeps layers on a Linux server.
- `KillUserProcesses` and SSH logout.

## 7. Not settled

- **Everything above on Linux**, on overlay2 and on the containerd store, on Engine 29.5 and an older engine (FR-089, FR-089b). In particular E02, E04, E04c, E05, E07, E08 and E10.
- Whether a marker printed by a step is gone from Docker's storage after `history rm` (FR-031b, SC-021): inspecting Docker Desktop's virtual machine was not allowed here, and it is a Linux check anyway.
- What an out-of-memory build prints, and whether `--resource` works anywhere (E12: silently ignored here).
- What the cache prune removes, and how fast.
- Whether buildx writes the ref file before the build's first step (seen only while it ran).
- Base-image digests on the overlay2 store; whether `--pull` re-resolves under the daemon's `ImageResolveMode: local`.
- Which buildx versions on servers have `--policy` and `--max-used-space`.
- Everything about Railpack's frontend on the runner (FR-089a).
- The disk a 512 MiB build takes, which sets the floor.

## For the plan

- Add a state lock `state.lock` beside `lock`; `sync` and `pack` take only it; D before S, always.
- Every state write after the number is used takes S, reads again and changes only its own part.
- Check the signer against the team list again after the build, before `up`; else `build_failed`, `team_changed`.
- A new session command `pack`, under S, with the gate of design steps 4 to 8 and staging of 2 GiB, 24 h, one deploy per app.
- Pieces are zstd-compressed before sealing, using the zstd Bun carries; the runner caps each at 8 MiB with `maxOutputLength`.
- Check every piece, the streamed hash, the size and the tar form before the number is used; never unpack for a Dockerfile.
- `pack_missing` names the missing chunks, and for a kept build whether its image is gone or changed.
- Pin the builder: a private `BUILDX_CONFIG=<home>/buildx`, `--builder <context name>`, driver `docker` checked.
- Build with the argument list of 4.5, fixed in `src/builder/`, with a test that fails on any forbidden flag.
- Do not pass `BUILDKIT_SYNTAX` for a Dockerfile; how `# syntax=` is handled goes to the maintainer.
- Pass named secrets only as `--secret id=<NAME>,env=ZEKNO_BUILD_SECRET_<i>`.
- `BUILDKIT_CACHE_MOUNT_NS=zekno-<app>` on every Dockerfile build.
- Read `--progress=rawjson`, send plain-form lines as `progress`, keep none, and send the failing step in one `build_error` event.
- Take image identity from the metadata file (manifest and config digests), not the iidfile; reuse a tag only when `.Id` is one of them.
- Check the image's architecture against `docker version`'s server architecture.
- Stop a build with `stopChild` at its limit or below the floor, then wait until its record is not `Running`.
- Remove Docker's record of every build by its ref from the private `BUILDX_CONFIG`, retrying what is left at the next deploy.
- Write `building.json` at K17; on a restart, stop the orphan client, remove its records, record `runner_restarted`.
- Add `--no-build` to `docker compose up`.
- Write the Railpack code with exclusive creates into `zekno-unpacked/<random>/code`, the plan beside it with an empty `.dockerignore`, and remove it after.
- Keep the images of the running deploy and two more per app in state mark 5; remove only tags whose `.Id` is still ours.
- Prune the build cache to 10 GiB after each deploy, under the deploy lock, after the answer.
- Measure free disk with `statfs` on Docker's root, containerd's root, `<home>` and the Railpack folder; 2 GiB until measured.
- New report fields only on `deploy` and `pack` answers: `build`, `building`, `missing`, `disk`, `docker`.
- Fix the failure reasons as the list of 4.10, decided by the runner, never from builder text.
- New read requests `builds` and `builder` for `zekno status` and `zekno doctor`; `status` keeps its shape.
- Detailed build records in `<home>/kept/<app>/<key>.json`; the state holds keys and digests only.
- Module folders `src/pack`, `src/builder`, `src/kept`, `src/disk`; locks move to `src/home/locks.ts`.
- Run E02, E04, E04c, E05, E07, E08 and E10 on Linux, both stores, first in the plan.

## Needs the maintainer

- **`# syntax=` lines** (point 4 (a), FR-034, FR-037c, line B15): `BUILDKIT_SYNTAX=dockerfile.v0` failed here. Options: (a) zekno refuses a Dockerfile with a `# syntax=` directive before signing, and the runner refuses it before the number; (b) the runner pins Docker's official frontend by digest (`docker/dockerfile@sha256:…`), a registry pull on each server, and that image then reads the secrets; (c) wait for the Linux result first. **Recommended: (c), then (a) if Linux fails the same way**: it needs nothing new, and keeps the secrets with the reader built into Docker. The Engine 29.5 floor is then set again from the Linux checks.
- **The FR-037d mechanism** (step 1b): (a) a runner-picked `--add-host zekno-<salt>:127.0.0.1` made from the app and the secrets' listed fingerprints, which works here but is not documented; (b) a builder per app (`docker-container` driver), which needs BuildKit's image on every server, a new tool; (c) builds that read a secret reuse no step and get a fresh random salt each time, so no other build can reuse theirs (still the same `--add-host` behaviour, without reuse). **Recommended: (a)**, with a test on every engine the check covers that fails if two salts share a step.
- **Client proxy settings** (FR-036): (a) the runner passes the five proxy names empty, which FR-036's list of allowed arguments must then name; (b) the runner uses its own `DOCKER_CONFIG`, which loses the server's registry logins unless copied, and can lose the buildx plugin (E10). **Recommended: (a).**
- **Compression format** for pieces: zstd, built into Bun (no package) on both sides. It fixes the format of what is sealed; confirm it.
- **A Docker on the check's Linux machines** at 29.5 or newer, and an older one (M4, FR-091): still open.
