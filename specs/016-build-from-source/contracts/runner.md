# Contract: the runner (`apps/runner`)

For FR-021a to FR-050, FR-061 to FR-069, FR-076, FR-078 to FR-080, FR-083, FR-085. The facts about Docker behind each rule, with where they ran: [research/map-runner.md](../research/map-runner.md) (E01 to E12, Docker Desktop) and [research/map-checks.md](../research/map-checks.md) (T1 to T11, nested engines). Every such fact is run again on Linux by the check before the rule relies on it ([quickstart.md](../quickstart.md)). Shapes: [core.md](./core.md). "Item N" is an item of the plan's "Needs the maintainer".

## Names and paths the runner uses

| Thing | Name |
|---|---|
| The deploy lock, the state lock | `<home>/lock`, `<home>/state.lock` |
| Staged pieces | `<home>/packs/<app>/<fingerprint>`, and `<home>/packs/<app>/deploy.json` (the payload's hash, when staged) |
| Pieces of the deploy being checked or built | `<home>/building/<app>/` |
| Detailed build records | `<home>/kept/<app>/<key>.json`, mode 600 |
| buildx's own folder | `<home>/buildx/`, mode 700, set as `BUILDX_CONFIG` |
| A deploy's run token | `building.run` in the state: 32 hex, random, written with the number; every build client of that deploy carries it as `ZEKNO_BUILD_RUN` |
| Work folders | `/var/lib/zekno-unpacked/<24 hex>/` for root, else `~/.local/state/zekno-unpacked/<24 hex>/`, mode 700, checked as `<home>` is |
| An image | `zekno.invalid/<app>:<key>` |
| An app's cache space | `zekno-<app>` (Dockerfile: `BUILDKIT_CACHE_MOUNT_NS`; Railpack: `cache-key`) |
| A build's salt host (step 1b) | `zekno-<buildSalt>` |
| Names the build client gets values under | `ZEKNO_BUILD_SECRET_<i>`, `ZEKNO_BUILD_VAR_<i>` (step 2) |

Nothing in this table is taken from a deploy, except the app's name and the key, both checked. There is no `building.json`: the state's `building` holds everything the restart path needs, written before any client starts.

## RB1. The locks (FR-044, point 7)

- `home/locks.ts` holds both, with today's `acquireLock`: a file linked into place holding `pid:token`, removed only by its holder, taken over when its pid is gone.
- The deploy lock ("D") is always taken before the state lock ("S"), never the reverse.
- S covers every read-then-write of `state.json`, `packs/` and `kept/`. It is held only for short spans: one read and write of the state, one piece written or moved, a check that reads no code. **No Docker call is made, and no piece is read, while S is held**, except by `apply` (version 1), which holds both for its whole span as today.
- A request that finds S held waits up to 120 seconds, then answers `busy`. A request that finds D held answers `busy` at once; a `deploy` answer then carries `building` (CO10) when the state's `building` is set.
- Every request that takes D (`setup`, `apply`, `deploy`, `proxy`) runs RB15 first, inside the wrapper that takes D (`locked()` today), when the state's `building` is set: D was free or its holder gone, so no runner watches that build any more.
- `sync`, `pack`, `builds` and `status` take no D for their own work. When they read `building` set, they try D once, without waiting; if they get it, they run RB15's bounded part and release D before their own work.
- Who takes what: [data-model.md](../data-model.md), "The locks".

## RB2. `pack` (FR-028, FR-040, FR-069)

RB15's bounded part first, as RB1 says. Then under S only:

1. The request schema; the piece at most `sealedPieceBytes` once decoded.
2. CO9's gate for the envelope: K4 to K10, F7 included. Nothing is used up and no secret is opened.
3. `hash("zekno/v1/pack-chunk", piece)` must be listed by one of the deploy's builds, as a code piece or a plan piece. Else `pack_mismatch`.
4. Clean `packs/`: delete the pieces of deploys that can no longer run (their `previous` is not the app's last number), older than 24 hours, and, oldest first, past 2 GiB in all. `building/` is never touched here.
5. Free disk: `fs.statfsSync` on the filesystem that holds `<home>`. When free space less this piece would fall below `LIMITS.diskFloorBytes`: `low_disk` with `disk: { free, floor }`, so staging never fills the disk under the running apps.
6. Past 2 GiB with this piece: `too_large`. Otherwise, when `packs/<app>/deploy.json` names another deploy, empty `packs/<app>/` first; write the piece by its fingerprint with the runner's atomic write; answer `{ staged }`.

A piece is not opened here. It is opened in RB4, for a deploy that can run.

## RB3. A deploy that builds, in order

A refusal before K17 changes nothing but the team lists of K3, uses no number, and deletes `building/<app>/` when K14d had moved pieces there.

| Step | What | Locks | Refusal or outcome |
|---|---|---|---|
| K1 | The request schema, as today | none | `invalid_request` |
| K2 | Set up and private; take D; read the key and the state. When the state's `building` is set: RB15 first | D | `busy` (with `building`, while a record of that build still runs) |
| K3 | Take S; read the state; team lists followed and saved, as today | D, S | roster reasons |
| K4 to K14 | `verifyDeployV2`, with CO7's table of what this runner carries out; then S is released | D, S | core reasons, `unsupported_version` |
| K14a | For each build: kept when the state records its key for this app, in `images` or in `drop` (CO13), and `docker image inspect` of its name gives an `.Id` equal to its manifest or config digest (FR-061, FR-062) | D | none |
| K14b | Only when a build is not kept: RB5 | D | `docker_too_old`, `no_build_plugin`; with item 12 (i), `docker_unchecked` for a build with secrets |
| K14c | Only when a build is not kept: RB6, before the number | D | `low_disk` |
| K15 | Today's limits | D | `too_large` |
| K16 | Every listed secret opens, a build's named secrets among them | D | `secrets_mismatch` |
| K14d | For each build not kept: RB4. Under S: when every listed piece is staged for this deploy, they are moved from `packs/<app>/` to `building/<app>/` (emptied first), and S is released; then they are checked under D alone. On `pack_mismatch`, `building/<app>/` is deleted, so the same envelope sent again gets `pack_missing` and each full check costs a full upload | D (S for the move) | `pack_missing`, `pack_mismatch` |
| K17 | Take S; read the state again. When its team lists differ from those K4 to K14 used, K4 to K14 run again against them (FR-044). Then records, then the state with the number and `building` (`phase: "building"`, a new run token); S released. **The number is used here** | D, S, then D | core reasons, no number used |
| B1 | Each build not kept, in key order: RB11's removal of a leftover under its tag, then RB7 or RB8, watched by RB9 to RB11. Before each build, and every 5 seconds during one, RB10's team list watch | D | `build_failed` with a reason (RB16) |
| B2 | Docker's record of each build removed (RB12); `building/<app>/` and the work folders deleted; on `build_failed`, every image this deploy tagged removed (RB11) | D | none |
| B3 | Take S; read the state again. `stillAllowed` (CO9): the signer, and every secret statement and removal the deploy used, supplied or held, against the team lists now in the state. When allowed: record each new image with this deploy's entry (`keepAfter`, CO13), the fresh generation and `last`; `building.phase` becomes `starting`. Release S | D, S | `build_failed`, `team_changed` (the new images removed after S is released) |
| U | Write the Compose text; `up --no-build` (RB13); routes and health as in 015, each state write under S; then, under S, `building` cleared | D, S briefly | as in 015 |
| R | RB14: kept images, the drop list, the cache prune, staging | D, S briefly | none |
| A | Answer | D | |

- The steps keep 014's names, and run in the order of the table: K15 and K16 come before K14d, so a deploy whose limits or secrets fail says so before zekno uploads up to 512 MiB, and nothing can refuse a deploy between the check of its pieces and the number but K17's second look at the team lists.
- When every build is kept, K14d and B1 to B3 are skipped, `building` is never set, and `last` is `reused`; the deploy's entry is written with U's first state write.
- On `build_failed` the runner never reaches U: the running app is not stopped, replaced or re-routed (FR-043). B2, then under S `last` is written and `building` cleared (or kept with phase `stopping`, RB10), then R, then the answer.
- A deploy that builds nothing skips K14a to K14d and B1 to B3. K17's second look at the team lists covers it, since `sync` no longer waits for a deploy.
- R runs for a deploy of an app that has builds in the state or that built. A deploy of an app with none makes exactly today's calls.

## RB4. Checking the code (K14d; FR-029, FR-030, FR-031, FR-049a)

- Every fingerprint the build lists (code pieces and, for Railpack, its plan piece) must be a file in `packs/<app>/` for this deploy. Missing: `pack_missing` with the fingerprints, at most 72, and nothing is moved. For a build the state recorded before (a rollback), `missing.images` says `gone` or `changed`.
- Each piece, in order, from `building/<app>/`: `openPiece` (CO5), the opened bytes fed to the streaming hash and to CO5's checker. Stop at the signed size. Nothing is written.
- A Dockerfile build's pack must hold a regular-file entry named exactly `builder.dockerfile`, byte for byte; else `pack_mismatch`. BuildKit's reader would otherwise fall back to a file named `dockerfile`.
- `# syntax=`: with item 11 (a), and whatever item 11 decides for a build whose `secrets` is not empty, a line of that entry that CO6's `isSyntaxLine` matches is `unsupported_version`. zekno refuses the same lines with the same function before signing. The entry is read up to 1 MiB, the most zekno reads (CL3); a longer one is `pack_mismatch`, since zekno never signs one.
- Railpack (step 2): the plan piece opens to exactly `plan.size` and hashes to `plan.hash`; `railpackPlanImages(plan)` (CO15, a strict schema) must equal the signed `images`; `"unreadable"` or any difference is `pack_mismatch`.
- Nothing opened from the code is ever written to `<home>` (FR-031). For a Dockerfile the code is never written out: it is streamed again from the pieces into the builder (RB7), each piece checked again before any byte of it reaches the builder.

## RB5. Can Docker build (K14b; FR-034a, FR-078)

Each through `runDocker` with its time limit (`CALL_MS`, 60 seconds), holding D, never S:

- `docker version --format json`: the server's engine version and processor. Below the floor (29.5.0, item 11): `docker_too_old` with `docker.engine`.
- `docker buildx version`: missing or failing: `no_build_plugin`. Below the buildx floor the check sets (item 11): `docker_too_old` with `docker.buildx`.
- `docker context show`, then `docker buildx inspect --builder <that name>`: its driver must be `docker`. Else `no_build_plugin`. So a `docker buildx use` of the server's user, or a container builder, never takes a build.
- With item 12 (i), for a build whose `secrets` is not empty: an engine or buildx newer than the newest the check covered (`builder/covered.ts`, raised only with a passing check) is `docker_unchecked` with `docker: { engine, buildx }`.

The same facts answer `builder` (RB17).

## RB6. Free disk (K14c and during the build; FR-040)

- `docker info --format '{{.DockerRootDir}}'` once per deploy. Then `fs.statfsSync` on Docker's root, on `/var/lib/containerd` when it exists, on `<home>`, and on the work folders' parent. The floor (2 GiB, `LIMITS.diskFloorBytes`, confirmed by L7) holds for the least of them.
- Before the number: below it is `low_disk` with `disk: { free, floor }`. A place that cannot be read (a remote `DOCKER_HOST`) is `low_disk` with `free` 0.
- During a build: read every 5 seconds. Below the floor: RB10's stop, reason `out_of_disk`.
- `pack` holds the filesystem of `<home>` to the same floor (RB2).

## RB7. The build command, a Dockerfile (FR-032 to FR-038)

One fixed argument list, built in `builder/args.ts`, passed as a list with no shell:

```text
docker buildx build
  --builder <the current context's name>
  --file <signed dockerfile>                          # a path inside the pack
  [--target <signed target>]
  --network <default | none>                          # signed (FR-038); never host
  --build-arg BUILDKIT_CACHE_MOUNT_NS=zekno-<app>      # FR-035
  [--build-arg BUILDKIT_SYNTAX=dockerfile.v0]          # only if item 11 ends (c); never with secrets (they refuse the line)
  --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg FTP_PROXY=
  --build-arg NO_PROXY= --build-arg ALL_PROXY=
  --build-arg http_proxy= --build-arg https_proxy= --build-arg ftp_proxy=
  --build-arg no_proxy= --build-arg all_proxy=         # item 13 (a): both cases of each name
  [--build-arg <NAME>=<value> ...]                     # the signed args, in their order (FR-036a)
  [--secret id=<NAME>,env=ZEKNO_BUILD_SECRET_<i> ...]  # step 1b (FR-037)
  [--add-host zekno-<buildSalt>:127.0.0.1]             # step 1b, item 12 (a)
  [--no-cache --pull]                                  # a fresh build (FR-021a)
  [--policy reset=true]                                # when the server's buildx has it (E09)
  [<item 17 (c)'s source policy>]                      # only if item 17 ends (c)
  --provenance=false --sbom=false
  --tag zekno.invalid/<app>:<key>
  --metadata-file <work>/meta.json
  --progress=rawjson
  -                                                    # the checked pack on standard input
```

- **Never passed** (FR-033, SC-008): `--allow`, `--network host`, `--ssh`, `--build-context`, `--output` or `-o`, `--load`, `--push`, `--attest`, `--cgroup-parent`, `--security-opt`, `--secret` with `src=`, a `--file` outside the pack, a context other than `-`, `BUILDKIT_SYNTAX` with any other value. A test reads the list `args.ts` builds for every combination and fails on any of them; check L18 runs the list on real Docker.
- **`--policy reset=true`**: E09 showed buildx loading a `<recipe>.rego` beside the recipe as a build policy, and the flag stopping it. Whether a `.rego` inside a tar on standard input is loaded was not run; L2 runs it with a deny-all `<dockerfile>.rego` in the pack, and the build must succeed.
- **Environment** (FR-033a): today's `dockerEnv()` names, `BUILDX_CONFIG=<home>/buildx`, `BUILDX_GIT_INFO=0`, `BUILDX_GIT_LABELS=0`, `ZEKNO_BUILD_RUN=<the run token>`, and for step 1b `ZEKNO_BUILD_SECRET_0…n` with the named secrets' values only. Nothing else of the runner's environment; never a secret under its own name. A test asserts the whole environment.
- **Working folder**: the build's own empty work folder, which receives `meta.json`.
- **Standard input**: the pieces of `building/<app>/` in order. Each is read whole into memory and its fingerprint `hash("zekno/v1/pack-chunk", sealed)` checked against `pack.chunks[i]` before it is opened; a mismatch stops the client before any byte of that piece reaches it (`step_failed`). Then it is opened, each header's time set to the build's start (`withTime`, item 14), the data unchanged.

## RB8. The build command, Railpack (step 2; FR-046 to FR-050)

After K17 only. The work folder gets `code/`, written by the checker's entries in their one order: folders with mode 0755; files opened exclusive (`wx`, never replacing, never following a link), then `fchmod` to 0644 or 0755, never a set-user or set-group bit; stop at the signed size and at 50,000 entries. No link is ever made. The plan goes to `plan/plan.json`, with an empty `plan/plan.json.dockerignore` beside it (FR-049).

```text
docker buildx build
  --builder <the current context's name>
  --file <work>/plan/plan.json
  --build-arg BUILDKIT_SYNTAX=<signed frontend reference with its digest>
  --build-arg cache-key=zekno-<app>
  --build-arg secrets-hash=<secretsHash>
  [--secret id=<NAME>,env=ZEKNO_BUILD_VAR_<i> ...]     # the signed args, as check R7 shows the frontend takes them
  --build-arg HTTP_PROXY= ... --build-arg all_proxy=  # the ten names of RB7
  --network default
  [--policy reset=true]                                # when the server's buildx has it
  [<item 17 (c)'s source policy>]
  --provenance=false --sbom=false
  --tag zekno.invalid/<app>:<key>
  --metadata-file <work>/meta.json
  --progress=rawjson
  <work>/code
```

- **Environment**: as RB7, with `ZEKNO_BUILD_VAR_<i>` in place of the secrets. `BUILDX_GIT_INFO=0` and `BUILDX_GIT_LABELS=0` matter most here: by default buildx runs `git` on the host in a local context and its parents (for a runner that is not root, its home folder among them) to record source-control facts. Check R5 builds a folder holding a `.git`, and parents holding one, whose configuration would run a program, and shows no `git` runs. If R5 shows that buildx or the frontend still reads `.git` outside the sandbox, `.git` is refused for a Railpack build: by zekno before signing, and by RB4 before the number (`pack_mismatch`, a pack zekno never makes).
- The work folder is deleted when the build ends, whatever the result; everything left in `zekno-unpacked/` is deleted before each build (FR-050).

## RB9. Output, events and the failing step (FR-031a, FR-070, FR-071)

- buildx writes progress to standard error. Each `rawjson` line is parsed with a bound (1 MiB a line). Its vertices, statuses and logs are turned into the plain form (`#9 [build 4/7] RUN npm ci`, the step's own lines, `#9 CACHED`, `#9 ERROR …`), each sent as a `build_line` event of at most 4,096 characters, never after the answer.
- In memory only: which vertices of a stage step other than `FROM` and `[internal]` were cached, and the failing vertex's name and error. They become `build_error` (`step` cut to 1,024 characters, `error` to 4,096, CO11) and the reason.
- The runner keeps none of the lines, in any file. `meta.json` is deleted once read; its two digests are kept in memory until B2 or B3.

## RB10. The time limit, the watches and stopping (FR-039, FR-040, FR-044, FR-045)

- **The watches**, during each build: a timer at the signed `timeout`; RB6's disk reading every 5 seconds; and the **team list watch**: every 5 seconds, and before each build, `state.json` is read without a lock (the runner writes it atomically). When its team lists differ from those K17 checked against, `stillAllowed` (CO9) runs.
- **The stop**: at the limit, below the floor, or when `stillAllowed` fails: `stopChild` (asked, then killed after 2 seconds), which stopped a step at once on Docker Desktop (E04). Under S, `building.phase` becomes `stopping` and `building.stopped` the time. The builds not yet run are skipped. The reason is `time_limit`, `out_of_disk` or `team_changed`.
- **The wait**: up to 120 seconds, until Docker's record of the build is no longer `Running` (`docker buildx history inspect <ref>`). Then B2, the images this deploy made removed (RB11), and the outcome.
- **A record still `Running` after 120 seconds**: the runner answers `build_failed` with its reason, keeps `building` (phase `stopping`) and the ref file, and releases D. Every later request that takes D runs RB15 first, which waits again and answers `busy` while that record still runs, so no deploy starts while a step of the build may still run (FR-039). How long that lasts is item 28.
- A dropped connection does not stop a build: the deploy finishes, as today, and the outcome is recorded for `zekno status`.

## RB11. The image (FR-041, FR-043, FR-061, FR-066, FR-067)

- From `meta.json`: `containerimage.digest` (manifest) and `containerimage.config.digest` (config). Never the iidfile.
- `docker image inspect --format '{{.Id}} {{.Architecture}}' zekno.invalid/<app>:<key>`: `.Id` must be one of the two digests, and the architecture must equal the server's (`amd64` or `arm64`). Another architecture: `wrong_processor` with `arch`.
- From `meta.json`'s `buildx.build.provenance` materials: the base images with their digests, at most 16, each held to its pattern. With item 17 (a), a material under `zekno.invalid/` fails the build as `reserved_image`.
- The record of CO14 is written to `kept/<app>/<key>.json` in B3.
- **The images of a deploy that ends `build_failed`**, whatever the reason (a later build failed, `cache_used`, `wrong_processor`, `reserved_image`, `team_changed`, a stop): for each build of this deploy that tagged an image, `docker image inspect` its tag, and `docker image rm` it (no `-f`) while its `.Id` equals the manifest or config digest that build's `meta.json` gave. Nothing of the deploy is recorded (FR-043), so without this no record would ever name these images (FR-067, SC-012).
- **A leftover under a tag**: before B1 builds a key, when its tag already names an image whose `.Id` is none of the digests the state records for that key (left by a failed deploy, or by a runner that died), `docker image rm` that tag (no `-f`), so the new build's tag never strands an older image where nothing can find it.

## RB12. Docker's own record of a build (FR-031b)

- The runner lists `<home>/buildx/refs/<builder>/<node>/` before and after it starts a build. The new file is this build's ref. Its contents are paths, never code.
- When the build ends, whatever the outcome: `docker buildx history rm --builder <name> <ref>`, then the ref file is deleted. When the removal fails, the file stays, and the next deploy tries every ref left in the folder first. The runner removes only records of builds it started.
- Until check L10 shows that a marker a step printed is gone from Docker's storage after the removal, the docs say that Docker keeps the builder's output on the server (K14's first form).

## RB13. Never building from Compose text (FR-076)

`composeUp` runs `docker compose -p zekno-<app> -f <home>/apps/<app>/compose.yaml up -d --remove-orphans --no-build`, for every app, built or not. A service whose image does not exist does not start: `start_failed` (E08). For images from a registry nothing else changes: `--no-build` only drops builds.

## RB14. Kept images, the cache and staging (FR-063, FR-064, FR-067, FR-068, FR-069)

Step R of RB3: under D, after U or after a failed build, **before the answer**. zekno closes the session once it has the answer and stops a local runner 5 seconds later (`CLOSE_GRACE_MS`), so nothing here may wait for after it. Each step leaves the state so that a cut at any point is taken up by the next deploy of the app:

1. `keepAfter` (CO13) with the `running` U left. The entries it no longer keeps move, under S, from `images` to `drop`, before anything is removed.
2. For each `drop` entry of the app: `docker image inspect` its tag; while `.Id` is one of its digests, `docker image rm zekno.invalid/<app>:<key>` (no `-f`). When the removal succeeds, or the tag is gone or leads elsewhere, the entry leaves `drop` under S, and then its `kept/<app>/<key>.json` is deleted. When it fails (a container still uses the image), the entry stays, and each later deploy of the app tries again.
3. `docker buildx prune --builder <name> --force` with `--max-used-space 10gb`, or `--keep-storage 10gb` on a buildx without that flag (FR-068), with a time limit of its own (120 seconds); cut by it, it runs again at the next deploy. It reaches builds made outside Zekno too; the docs say so.
4. RB2's cleaning of `packs/`.

A rollback carries the old builds. K14a finds them kept (in `images`, or in `drop` while the image is still there, which then returns to `images` with the deploy's entry), or K14d answers `pack_missing` with `missing.images`. A rollback never builds by itself: zekno sends no piece for it (FR-064).

## RB15. A restart during a build (FR-031b, FR-039, FR-045, FR-050)

Run when a request takes D and finds the state's `building` set (RB1): no runner watches that build any more. Every step holds D only, and takes S just for its state writes.

1. **Stop** (`stopRun` in `builder/restart.ts`): every live process of the runner's own user whose `/proc/<pid>/environ` holds `ZEKNO_BUILD_RUN=<building.run>` is sent SIGTERM, then SIGKILL after 2 seconds, and `/proc/<pid>` is polled until each is gone. Today's `stopChild` takes a handle a restarted runner does not have. The token is in the state before any client starts, so a runner killed between the number and the start, or at any later point, leaves no client this cannot name; a silent step outlived its runner on Docker Desktop (E04c). Under S: `phase` `stopping`, and `stopped` set if it was not.
2. **Wait**, up to 120 seconds, until the records of the refs left in `<home>/buildx/refs` are no longer `Running`; remove them (RB12). While one still runs, `building` stays and the request answers `busy` (a deploy's answer carries `building`). Item 28 (b): once no process of the run is alive and a record has stayed `Running` for 10 minutes past `stopped`, the steps below run anyway, the ref file is kept for a later removal, and `builder` counts it (`stale`) so that `zekno doctor` names it.
3. **Images**: for each key of `building.keys`, `docker image inspect` its tag; `docker image rm` it (no `-f`) when its `.Id` is none of the digests the state records for that key.
4. Delete `building/<app>/` and everything in `zekno-unpacked/`.
5. Under S: `last` is `build_failed` with `runner_restarted`; `building` is cleared; nothing built is recorded.

With phase `starting` (the runner died during `up`, routes or health), steps 1 to 4 have nothing to do; under S `building` is cleared and `last` stays as B3 wrote it; the deploy's outcome is as when a runner dies during `up` in 015.

**The bounded part**, for `sync`, `pack`, `builds` and `status` (RB1): step 1, then one look at each record (one `history inspect` each, 10-second limit, no wait). When none still runs, steps 3 to 5; else `building` stays with phase `stopping` for a later request. Such a request is delayed by seconds, never by the 120-second wait.

Then the request goes on, or is `busy` while a record still runs. The interrupted deploy's number stays used, and the earlier deploy keeps running.

The runner runs only while a request is handled, so until one arrives nothing on the server stops an orphaned client at its limit or the disk floor. Item 27 decides whether more is done: with (a), RB7 and RB8 start the client as `/usr/bin/timeout -k 2 <seconds left of the signed limit> docker buildx build …`, so the time limit holds without the runner.

## RB16. The bounded reasons (FR-031a), in this order

| Reason | When |
|---|---|
| `time_limit` | the runner stopped the client at the signed limit |
| `out_of_disk` | the runner stopped it below the floor, or the failing vertex's error says no space was left |
| `team_changed` | the team list watch (before or during a build) or B3: the signer, or a secret statement or removal the deploy used, is no longer allowed by the team lists now in the state. Every image this deploy made is removed and none is recorded |
| `cache_used` | a build that may reuse no cached step showed one (RB9) |
| `wrong_processor` | RB11's architecture check, or an "exec format error" |
| `reserved_image` | RB11, with item 17 (a) |
| `out_of_memory` | the failing step was killed (exit 137), or the builder's error says memory could not be allocated (as in T6) |
| `step_failed` | any other failure, a piece that no longer matches on the second pass among them |
| `runner_restarted` | recorded by RB15; never in a deploy's answer, since the zekno whose runner died saw D16. `zekno status` shows it (G30) |

The builder's text may help choose among them; it is never kept, and never becomes the reason.

## RB17. `builds` and `builder` (FR-045, FR-066, FR-078 to FR-080)

No lock for their own work (RB15's bounded part first, as RB1 says), each Docker call through `runDocker` with its limit.

- `builds` with no input: the apps that have an entry in the state's `builds`, sorted. With `apps` (1 to 8): CO12's `AppBuildsAnswer` for each, from the state and `kept/`, its `building.phase` from the state. `check` inspects each named key's image (`kept`, `gone`, `changed`), for a rollback before signing.
- `builder`: RB5's facts, `docker info` (`MemTotal`), RB6's free space and the floor, the count of refs whose records could not be removed (`stale`, item 28), and with `usage` the size of the runner's kept images (`docker image inspect --format '{{.Size}}'`) and of the build cache (`docker buildx du`, which every app on the server shares). `can` is the first of `no_docker`, `docker_too_old`, `no_build_plugin`, else `yes`.

## RB18. What older programs do

- Runner 0.1.1 handed a signed build: `malformed`, no number used; handed `pack`, `builds` or `builder`: `invalid_request`. With a signed Compose text that asks to build, runner 0.1.1 runs `up` without `--no-build`. E08 ran `docker compose up` with runner 0.1.1's flags on Docker Desktop, and Compose built the image; runner 0.1.1 itself was not run. Check L1 runs runner 0.1.1 itself on Linux, and the docs say what it found.
- A runner of step 1 handed a Railpack build, or one without step 1b handed a build with secrets: `unsupported_version`, no number used, never built another way (FR-083).
- Runner 0.1.1 put back after mark 5: `invalid_state` for every request (FR-085). Updated from 0.1.1, the runner reads mark 4 forward, and the apps, routes and domains keep working.

## Tests

- The stand-in for Docker (`test/support/docker/fake.ts`, `model.ts`, and the new `stand-in-buildx.ts`, since `fake.ts` is 319 lines) learns `buildx build` (reads standard input, writes `meta.json` and `rawjson`, can fail a step, hang, ignore a stop, print without pause, use the cache, record its environment), `buildx history ls/inspect/rm` (a record that stays `Running`), `buildx inspect`, `buildx version`, `buildx prune`, `buildx du`, `image inspect`, `image rm` (a removal that fails while a container uses the image), `version`, `info`, `context show`, and `compose up --no-build`. A call it is not told about still behaves as today.
- Every rule above has a scenario against the real runner program: the calls and their order, the files written and removed, the state before and after, the outcome. A deploy without a build makes exactly today's calls.
- The two locks: `sync` and `pack` answered during a build; a deploy told `busy` with `building` and its phase; a stale lock taken over. With Docker hanging at each call in turn, and a deploy sent again after `pack_mismatch`, a `sync` still lands within 120 seconds.
- The team list: a `sync` during a build that removes the signer stops the client within 10 seconds (`team_changed`, no `up`, the running app untouched); a `sync` that removes the setter of a secret the deploy lists ends the same way, during a build and after it, before U.
- The restart path: a client that outlives its runner; a runner killed between K17 and the client's start; a runner killed after a build finished and was tagged; a record that ignores the stop for 120 seconds, then for 10 minutes; RB15 run by `apply`, `proxy` and `setup`, and its bounded part by `sync`, `pack`, `builds` and `status`.
- Leftover images: a deploy of two builds whose second fails; a `cache_used` build; a restart after a finished build; a tag left before a build. Each ends with no `zekno.invalid/*` tag the state does not name (SC-012). A removal that fails keeps its `drop` entry and succeeds at a later deploy.
- RB14 before the answer: a session closed right after the answer leaves the state and `kept/` in step, and the cache within its bound.
- The argument list and the environment: every combination of builder, network, fresh, args, secrets and salt, against the list of RB7 that must never appear; the ten proxy names; `--policy reset=true` where buildx has it; the environment exactly as RB7 says.
- The second pass: a piece changed on disk after K14d stops the client before any of its bytes reach it.
- No file under `<home>` holds a marker string placed in the code or printed by a step (SC-007, FR-031a).
- The gated real-Docker set on the Mac, and in the Linux stand-in through `ZEKNO_LINUX_SERVER`: a build answers; nothing changed sends nothing; a failed step, a time limit, a disk floor (a stand-in figure), the wrong processor and a team list change each leave the running app answering, writing to disk every second, and with its routes unchanged (SC-005); five builds keep three; a fresh build uses no cached step; Docker's record is gone; no `zekno.invalid/*` tag is left that the state does not name; everything named `zekno-*` the test made is removed.
