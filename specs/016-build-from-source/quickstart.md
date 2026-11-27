# Quickstart: proving build from source (feature 016)

How each user story is shown to work, end to end, step by step, and where. Contracts: [core](./contracts/core.md), [runner](./contracts/runner.md), [CLI](./contracts/cli.md). The checks L1 to L16, R1 to R10 and B1 to B6 are those of [research/map-checks.md](./research/map-checks.md), part 7. The plan adds L4b (file times and the cache, item 14), L17 (zekno's file choice and Dockerfile reading against BuildKit's), L18 (no host network, device, insecure step or SSH agent, FR-033) and R16 (what `railpack prepare` starts, writes and reaches, item 26; R11 to R15 are lines of `lines.md`, so the check takes the next free number). Which job runs which check is "The jobs" below, which replaces map-checks part 8's table. Script and fixture names below are written in phase 0 and step 1; they do not exist yet.

## Where things run

| Place | What it is | What it cannot show |
|---|---|---|
| **Mac, tests** | `bun --no-env-file test` in each package: the real runner program with the stand-in for Docker, stand-ins for the SSH host, Railpack's release and `railpack` | real Docker |
| **Mac, real Docker** | the gated sets on Docker Desktop, run by hand; none of them builds: every build of this feature runs in the stand-in's own engine, never Docker Desktop's | Linux; QEMU lets a build for the wrong processor run |
| **Linux stand-in, Mac** | the server stand-in container on the Mac, the same script as on GitHub, with a client container for SC-003 (the same `ubuntu:24.04` digest) | a server's kernel and init; the Mac's VM is shared |
| **GitHub** | `linux checks` on every push: the stand-in on `ubuntu-24.04` (x86-64), and on ARM64 and macOS (items 4 and 5) | a real domain and a public certificate; a real 1 GB server |
| **Server proof** | the maintainer's own server, once, at the end of step 2 (M9), each use with a go-ahead | an older engine; out of memory; ARM64 unless the server is |

Prerequisites: Bun 1.4.4; for the Mac's real-Docker and stand-in runs, Docker running. No run reads `apps/cli/.env.local`: every command uses `bun --no-env-file`. Every key, team list and secret value is made in the run, and secrets are marker values.

**Fixtures.** The repository's `.gitignore` ignores `.env*`, `*.pem`, `build`, `dist`, `out/`, `.next/`, `coverage` and `node_modules` at any depth, so a committed fixture cannot hold those names, and a file under such a name that exists only in the Mac's working copy would change SC-013's fingerprint between the Mac and GitHub. Fixtures that need such names, links, FIFOs, sparse files or a `.git` folder are written by the test at run time; the committed `fingerprint` fixture holds no name the repository's `.gitignore` matches, and a test checks that.

```sh
bun --no-env-file run typecheck && bun --no-env-file run lint && bun --no-env-file run build
(cd packages/core && bun --no-env-file test)
(cd apps/runner && bun --no-env-file test)        # the gated set says in one line whether it ran
(cd apps/cli && bun --no-env-file test && bun --no-env-file run screens --check)
(cd apps/web && bun --no-env-file test)
```

The Linux stand-in, on the Mac (phase 0 writes it; it reads `apps/runner/test/support/linux-server/pins.json`):

```sh
bun --no-env-file apps/runner/test/support/linux-server/server.ts up --engine floor --store containerd
ZEKNO_LINUX_SERVER=zekno-check-<id>-server bun --no-env-file apps/runner/test/support/linux-server/run-checks.ts --job checks --engine floor --store containerd
bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id <id>
```

`--engine` takes `floor` (29.5.0), `floor-no-buildx` (29.5.0 without `docker-buildx-plugin`), `older` (29.4.3), `distro` (Ubuntu's `docker.io`), `distro-no-buildx` or `newest`; `--store` takes `containerd` or `overlay2`; `--memory 1g` holds the stand-in to 1 GB. Afterwards nothing named `zekno-check-*` is left, and `server.ts` says so.

## The jobs

All on `ubuntu-24.04` unless marked, in parallel, each with a time limit, with no repository secret (rules LC1 to LC10). The engines and images come from `pins.json`.

| Job | Stand-in | Runs | Time limit |
|---|---|---|---|
| `checks` (engine: floor, newest × store: containerd, overlay2) | the floor runs every check of the row; the newest runs L2, L8, L9, L12, L13, L15, L17 and L18 | L2 to L5, L4b, L7 to L10, L12 to L18, R1, R4 to R10, R16 (Linux side), B2, the Linux half of R2 and R3 | 40 min |
| `older-engine` | 29.4.3; Ubuntu's `docker.io` with and without its buildx; `floor-no-buildx` | L2, L3 and L4 observed; B5 (on `floor-no-buildx`: `no_build_plugin`, R13, G35) | 20 min |
| `memory` | the floor, held to 1 GB | L6 | 15 min |
| `released` | the floor | L1 (runner 0.1.1 itself); FR-083 for runner 0.1.1; B6 | 15 min |
| `proof` (engine: floor, newest) | containerd | B4, each step's scenarios | 30 min |
| `arm64` (item 4) | `ubuntu-24.04-arm`, the floor | B1, B4 | 30 min |
| `macos` (item 5) | a GitHub macOS machine, no Docker | B3, R16's macOS side: the fingerprint and the plan handed to `checks` as job outputs | 15 min |

- L17 and L18 run where the runner builds: the floor and the newest. The older engines are below the floor, where the runner refuses every build, so what their BuildKit reads or allows never reaches a build; L18 joins `older-engine` for Ubuntu's `docker.io` once its version meets the floor.
- L8 runs at the floor and the newest: those are the buildx versions a build meets. Ubuntu's own `docker-buildx` comes only with an engine below the floor.
- With the newest legs, about 30 minutes from push to result.

## Phase 0: the check records what Docker does

Where: GitHub, on every push to the branch; the Linux stand-in on the Mac while building.

1. Push the branch. `linux checks` runs the jobs above. Expect each within its time limit, with no repository secret.
2. Read each job's record. Expect one line per check, naming the engine, the store and what was seen: for L2, whether `BUILDKIT_SYNTAX=dockerfile.v0` builds (map-checks T4), at the floor and the newest, and whether a deny-all `<dockerfile>.rego` inside the pack is loaded; for L4, whether the iidfile equals `.Id`; L4b, whether a file's time changes a cached `COPY`; L5, whether a silent step stops when only its reader goes; L7, the disk a 512 MiB build used; L9, the materials of a build from a local image, and whether item 17 (c)'s policy stops it; L15, whether two salts ever share a step, at the floor and the newest.
3. L18 asserts from its first run: with RB7's argument list (as written in the contract until `args.ts` exists), Dockerfiles holding `RUN --network=host`, `RUN --security=insecure`, `RUN --device=<name>` (where the built-in reader accepts it) and `RUN --mount=type=ssh` each fail, or run with no host network interface, no device, no insecure mode and no SSH agent socket; under a signed `none`, `RUN --network=default` trying an address has no network.
4. The findings settle the branches of items 11 (L2), 14 (L4b), 17 (L9) and 27 (L5) before the runner's build code is written, and L15 settles item 12 before step 1b is built, as the plan's phase 0 says. A finding goes back to the maintainer only where the item says so: item 12, when `--add-host` is not in the cache key on an engine the check covers.

## Step 1: a folder with a Dockerfile

### US1. Deploy a folder that has a Dockerfile

- **Mac, tests** (`apps/cli/test/scenarios/build-first-deploy.test.ts`): a fixture folder with only `Dockerfile` (`EXPOSE 3000`), at a stand-in terminal. Run `zekno deploy`. Expect A1 to A12 before the key question: the block, the settings file it would write, `PORT=3000`, the proposed `.dockerignore` when there is none. Answer `Build, port 3000`. Expect `zekno.app.json` with `build.builder` `dockerfile` and `networking.port` 3000, and the deploy going on, with the stage row `✔ Checked ✔ Signed ✔ Sent ✔ Built ✔ Started`. Answer `Don't build` instead: nothing written, `✖ Nothing was done.`, exit status 1. With no terminal: today's sentence for a folder with no Compose file, exit status 1, nothing written. With `Dockerfile` and `Dockerfile.dev`: A14 asks which. A settings file with no `build.dockerfile` in a folder holding `Dockerfile` and `Dockerfile.prod`, or a sent `api/Dockerfile`: the new stop naming them, exit status 1. On macOS, a file `dockerfile` and a setting `Dockerfile`: C20.
- **Mac, tests**: a fixture with a 600 MB `node_modules` (made by the test, sparse files) and no `.dockerignore`. Expect the proposal to list `**/node_modules`, and the summary to send none of it.
- **Linux stand-in, Mac and GitHub** (job `proof`): from a client with a throwaway `ZEKNO_HOME` and no terminal, `zekno server add stand-in --ssh root@<stand-in> --runner-path /usr/local/bin/zekno-runner` (the runner compiled from this commit, which `server.ts up` placed there), then `zekno deploy --json`, and again without `--json`, in the fixture `dockerfile-web` (which holds its `zekno.app.json`). Expect the `--json` outcome `started` with its builds, B29's facts and D17's `remote:` lines on standard error, today's result line on standard output, the app answering on its port inside the stand-in, the image `zekno.invalid/<app>:<key>` on the stand-in's Docker, and no registry asked for it. Then `zekno domain add` and deploy again with no change: nothing sent, nothing built (the `--json` outcome says every build was reused), and the domain answering over HTTPS with Caddy's internal authority. The stage row and D6's `✔ Reused` are shown by the in-process scenarios with a stand-in terminal.
- **Linux stand-in, Mac** (ARM64) and **GitHub** (x86-64, and ARM64 by item 4): the same image built for each processor (US1 sc8).
- **Server proof**: the same with a real domain and a public certificate (M9).

### US2. Know what is sent before anything is signed

- **Mac, tests** (`apps/cli/test/pack/`, `test/scenarios/build-summary.test.ts`), fixtures written at run time: a `.dockerignore`, a `.git` folder, each kind on the secret-looking list, a link out, a FIFO, a name with a control character, a folder whose last part is 100 bytes, a path with no ustar split point, a file changed while read. Run `zekno deploy`. Expect B1 to B6 counting files and bytes exactly; each left-out entry listed with its rule; C5, C6, C7 (in its form for a name the pack cannot hold) stops with nothing signed. A folder over 512 MiB (sparse): C1 naming its largest folders. 50,001 entries: C2.
- **Mac, tests**: a settings file naming `certs/server.key` in `source.include`. At a terminal: B26, and the file sent after a yes, listed by B6. With no terminal and no earlier yes: C19, exit status 1. A settings file present from the start (a cloned repository): B24 before signing. One naming `.git`: B26 with its row for the repository's history and configuration; with no terminal and no earlier yes, C19's form for it.
- **Mac, tests**: a `source.root` that resolves to the home folder (a home folder made a git repository by the test) or holds `ZEKNO_HOME`: the new stop naming `source.root`, nothing signed. `ZEKNO_HOME` inside the folder sent: never in the pack.
- **Mac, tests**: a git fixture made by the test (no `git` run) with a changed file. Expect B13 once, the deploy going on, and nothing different in the pack. Outside a repository, or with nothing changed: no line. A SHA-256 repository: no line.
- **Mac, tests**: with no terminal, every fact on standard error (B29); standard output holds only today's result line.
- **Mac and GitHub** (SC-013): the fixture `fingerprint` packed on the Mac (by hand, and on GitHub's macOS by item 5) and on Linux gives the fingerprint recorded in the tests.
- **Linux stand-in, Mac** (SC-003, L11): from the client container held to 10 Mbit/s and 50 ms, deploy a 10 MB and a 100 MB fixture. Expect packing, the summary, sealing and sending under 30 and 150 seconds. Recorded in the results with the date.
- **Mac, tests**: two runs at once (two stand-in terminals) each keep their sealed pieces in their own folder under `~/.zekno/tmp/`, and neither deletes the other's; a folder there older than 24 hours is deleted at a run's start.
- **GitHub** (L17, at the floor and the newest): the file list of pass 1 equals what BuildKit copies out of the same fixture, for each ignore-file fixture.

### US3. Follow a build; a failed build leaves the app alone

- **Mac, tests** (runner scenarios): the stand-in for Docker fails a step, hangs past the time limit, reports disk below the floor, builds for another processor. Expect `build_failed` with `step_failed`, `time_limit`, `out_of_disk`, `wrong_processor`; the number used; no `up`; the state's `running` unchanged; Docker's record removed; nothing of the output in `<home>`; no `zekno.invalid/*` tag the state does not name. A deploy of two builds whose second fails, and a `cache_used` build: both images removed, none recorded.
- **Mac, tests** (runner): a `sync` during a build that removes the signer stops the client within 10 seconds, `team_changed`, no `up`; one that removes the setter of a secret the deploy lists ends the same way. A record that ignores the stop: `build_failed` after 120 seconds, `building` kept with phase `stopping`, and the next deploy `busy` until the record leaves `Running`, or, with no process of the run alive, for 10 minutes past the stop (item 28 (b)); then the deploy goes on and `zekno doctor` names the record (G39a).
- **Mac, tests** (CLI): E1 to E13 word for word by reason, the "Docker said" panel with `step` and `error`, E4 past 40 lines, E6 naming `zekno logs --build`; with no terminal E18 and exit status 1; `--json` with `build.reason`. `zekno logs --build` prints the saved output; with none, E17. A step that prints an OSC 52 sequence: it reaches neither the screen, standard error, nor what `zekno logs --build` prints.
- **Mac, tests** (CLI and runner): a deploy of app `shop` while app `blog` builds. Expect `busy` with `building`, the pieces of `shop` sent with `pack` and staged during `blog`'s build, the live line while zekno waits, then the deploy running with no second upload. With a bound that runs out: E15, exit status 1, nothing of `shop` ran.
- **Mac, tests** (CLI): the connection cut after half the pieces were sent. Expect a second connection in the same run that sends only the rest (D3), and the deploy going on; cut three times: D14, no number used.
- **Linux stand-in, Mac and GitHub** (job `proof`): an app running deploy 6 that writes to disk every second; deploy 7 from the fixture `fails-at-step`. Expect E1 naming deploy 6, the app still answering and writing, its routes unchanged. A build given a 30-second limit with a step that sleeps: E9, and the lock held until Docker's record is no longer `Running`, the app still writing.
- **Linux stand-in held to 1 GB, Mac and GitHub** (job `memory`, L6): a build whose step asks for 1.6 GB, with an app beside it. Expect E8 and what the builder printed recorded. Nothing is claimed about a real 1 GB server.
- **Linux stand-in** (L5): the connection cut during the build. Expect D16, the build ending on its own, and `zekno status` showing how (G30). The runner killed during a silent step, and killed between the number and the client's start: at the next request that takes the deploy lock, and with `zekno status` alone, every client carrying the run token is stopped, the record removed, no image of the run left, and `zekno status` shows G30 with the runner restarted.

### US4. Only what a team member signed is built

- **Mac, tests** (core and runner): change one byte of the pack, a piece, the Dockerfile's path, the stage, the builder's name, a plain variable's value, a build secret's name, `fresh`, the network after signing. Expect `malformed` or `pack_mismatch`, no number used (SC-006). A piece sealed for server A sent to server B: `pack_mismatch` (FR-026). The same envelope sent again after `pack_mismatch`: `pack_missing`, its pieces gone. A piece changed on disk after the check: the client stopped before any of its bytes reach it. A marker string in a source file appears in no sealed piece, not in the payload, not under `<home>` (SC-007).
- **Mac, tests** (CLI): a hand-written `compose.yaml` with `build: .`: C8, nothing signed, exit status 1. One naming `zekno.invalid/shop`: C9. A Dockerfile `FROM zekno.invalid/blog:…`, through an `ARG` default, through a plain variable, or in `COPY --from`: C10. `ADD https://…` without a checksum: C12; `ADD` of `http://10.0.0.5/…`, `http://[::ffff:127.0.0.1]/…`, `http://169.254.169.254/…`, `http://100.100.100.200/…`, `http://0177.0.0.1/…` or `http://localhost./…` with a checksum: C13. A `# syntax=` line after the first instruction: found as the runner finds it.
- **Mac, tests**: the argument list and environment the runner builds, for every combination, holds none of RB7's forbidden flags, both cases of the five proxy names, and `BUILDX_GIT_INFO=0` (SC-008).
- **GitHub** (L18, at the floor and the newest, both stores): the Dockerfiles of phase 0's item 3 with the runner's exact command; each fails or stays in the sandbox (SC-008, FR-033).
- **GitHub** (job `released`, L1): runner 0.1.1 itself given a signed Compose text with `build:` (context `.`, a git address, `../..`). Expect what it does recorded, and said in the docs. The new runner given the same text: `start_failed`, nothing built (SC-009).
- **GitHub** (L2): as L2 settles item 11, a `# syntax=` line in a build without secrets is either ignored, with no image pulled for it (c), or refused before the number (a); a deny-all `<dockerfile>.rego` in the pack does not stop the build.
- **GitHub** (L8, at the floor and the newest): a private base image through the stand-in's registry login, and the client's `config.json` proxies, upper and lower case, reaching no step.

### US5. Nothing changed, nothing sent, nothing built

- **Mac, tests**: deploy, then deploy again with only a secret changed that the build does not read. Expect `pack_missing` never answered, no `pack`, no `buildx build`, `✔ Reused`, the app with the new secret (SC-004). Retag the kept image by hand in the stand-in for Docker: the runner asks for the code and builds (`.Id` not recorded), and the hand-tagged image's tag is removed first.
- **Linux stand-in, GitHub** (L4, both stores): the same with real Docker; the recorded digests match `.Id` on each store.
- **Mac, tests**: `zekno deploy --fresh`, then a deploy with only a secret changed. Expect the fresh image to run, never the older one (SC-019); `builds` reports the generation and the second deploy signs it. A runner that reports no generation, or an older one, while this machine's history holds the fresh one: the history's is signed, the new warning line said, and the fresh image runs.

### US7. Build settings where a Railway user looks for them

- **Mac, tests** (`apps/cli/test/settings/`): `zekno settings` shows the Build section (G9); `set` and `unset` of each key, with G20's forms and the other refusals and exit status 2 (G16 to G21); `set web.builder dockerfile` on an image service is one change line (G14); `zekno settings compose` prints the signed text for a Dockerfile build with no secret, byte for byte, with the note on a fresh build; a build this machine's history shows fresh prints the placeholder; `source.root` above the git top: C22 when read, G20's form at `set`; through a link out: C23.
- **Mac, tests**: a zekno built at the tag of runner 0.1.1 (the pairing tests' older program) reading a settings file that builds: F8, nothing signed. A settings file naming `railpack` read by step 1: F5.
- **Mac, tests**: a folder with `Dockerfile` and a `compose.yaml` whose `web` has `build: .`: C8; `zekno settings init` offers the build (A18, saying it writes `.dockerignore` too when one is proposed); then `zekno deploy` builds it.

### US8. Roll back to a built deploy

- **Mac, tests**: build deploys 1, 2 and 3, then `zekno rollback --to 2`. Expect `builds` asked with `check`, nothing packed or sent, deploy 2's image run (D18 then D6). Five builds that each change the code, then `--to 1`: G43 before signing, no number used. An image whose removal failed (a container used it) stays in `drop`, is reused by a rollback while it is there, and is removed by a later deploy once nothing uses it.
- **Linux stand-in, GitHub** (job `proof`): the same with real Docker; deploys 5, 6 and 7 fail to build, and a rollback to 3 still runs its kept image (US8 sc4).

### US9. A server's disk stays in check; doctor says when a server cannot build

- **Linux stand-in, GitHub** (job `checks`): five builds that each change the code, a deploy of two builds whose second fails, and a `cache_used` build. Expect the images of the last three successful deploys only, removed by their tags, only images the runner made, and no `zekno.invalid/*` tag the state does not name (SC-012). After each deploy, the build cache within its bound (`docker buildx du`), done before the answer.
- **Mac, tests**: free disk below the floor (a stand-in figure): R14, no number used. During the build: E10. A `pack` that would bring the disk of `<home>` below the floor: `low_disk`, R14.
- **GitHub** (job `older-engine`, B5): on 29.4.3 and on Ubuntu's `docker.io` (with and without its buildx), a deploy that builds stops before signing with F4 (zekno asked `builder`), the runner, handed one anyway, answers `docker_too_old`, and `zekno doctor --builds` says G34; an image deploy still works (SC-018). On `floor-no-buildx`: `no_build_plugin`, R13, and `zekno doctor --builds` says G35.
- **Mac, tests**: `zekno doctor` with a built app shows G33, G37, G38, G39; with no built app and no terminal, its plain output is as before (US9 sc6). `zekno status` on a server with 20 built apps asks `builds` in three batches and shows each.

### US10. Old and new programs say what to do

- **Mac, tests** (pairing tests with the released programs, as 014 and 015 did): this zekno against runner 0.1.1: F1 for a build, nothing signed; an image deploy as in 015. zekno 0.1.1 against this runner: F7 (C7). Runner 0.1.1 handed a signed build: `malformed`, F11. Runner 0.1.1 put back after mark 5: F12 for every request.
- **GitHub** (job `released`, B6, after M7): `zekno server update` from runner 0.1.1 to 0.1.2-dev.1, from the published pre-release with its recorded checksum. Expect the apps, routes and domains still working, and a build working after it.

### US11. A build reads the service's plain variables (Dockerfile)

- **Linux stand-in, GitHub** (job `proof`): the fixture `dockerfile-args` declares `ARG API_URL` and writes it into a file of the image; the service has `API_URL` and `NODE_ENV`. Expect the image to hold `API_URL`'s value, the build not given `NODE_ENV`, and B10 naming `API_URL`. Change only `NODE_ENV`: nothing sent or built. Change `API_URL`: B23, sent and built again (SC-020).
- **Mac, tests**: `ARG HTTP_PROXY` with a plain variable of that name: B16, not given, the deploy goes on. `ARG SESSION_KEY` where `SESSION_KEY` is a secret: B18. 33 plain variables declared: C14. A value of 5,120 bytes: C15. `FROM ${BASE}` where `BASE` is a plain variable naming `zekno.invalid/…`: C10.

### End of step 1

- Mac: every test, typecheck, lint, `bun --no-env-file run build` from the root, format, `screens --check`, the compiled runner answering `{"version":"0.1.2-dev.1","protocol":6}`.
- The docs pages that change (`building.mdx` and the pages of the plan's Step 1 item 5), checked in a real browser at phone and desktop widths, in both themes, with reduced motion.
- GitHub: every job green on the commit to tag; the record of each check copied into the docs' K20 with where it ran.
- The security review of step 1 (`security-review.md`), and the walkthrough of the real screens against the boards (`design/walkthrough.md`).

## Step 1b: named build secrets

### US12. A build reads only the secrets named for it

- **Mac, tests** (CLI): `zekno settings set web.build-secrets NPM_TOKEN`: H1, G15. At a terminal the first deploy: H2, H3 for a base image named by tag, H4 with H4a and H5; yes, and the deploy is signed. With no terminal and no earlier yes: H9, exit status 1. `GIT_AUTH_TOKEN`: H11 at `set` (exit status 2), H10 at deploy. A name the app does not have: H12; one removed: H13. A `# syntax=` line in that build's Dockerfile: the new stop, whatever check L2 settles for item 11.
- **Mac, tests** (runner): the build client gets `ZEKNO_BUILD_SECRET_0` and never `NPM_TOKEN` as a name in its environment; `--secret id=NPM_TOKEN,env=ZEKNO_BUILD_SECRET_0` in its arguments; `--add-host zekno-<salt>` (item 12 (a), as L15 settles). A build without secrets has no salt. A signed build with secrets and a `# syntax=` line: `unsupported_version`, no number used. A server above the covered versions (item 12 (i)): `docker_unchecked`, no number used.
- **Linux stand-in, GitHub** (L12, floor and newest, both stores): a step reads the mounted secret and checks its value without printing it. Expect the marker value nowhere in the image, its history, its metadata, the build cache, Docker's record once removed, the signed deploy, what a relay reads, or `<home>` (SC-021).
- **GitHub** (L13, floor and newest): a build with a secret and a `# syntax=` line naming a frontend served by the check's registry is refused before signing, and, handed one signed by hand, before the number; the registry logs no request for it, and the secret reaches no frontend (FR-037c). If L2 settles item 11 as (c), the same line in a build without secrets: no request either.
- **GitHub** (L14): a secret named `GIT_AUTH_TOKEN` never reaches the builder: refused before signing and, handed one signed by hand, `malformed`.
- **GitHub** (L15, floor and newest, both stores): the same step built with the secret, then with another value, then with none, then by another app with a secret of the same name. Expect no reuse across any of them, and reuse for the same app and fingerprint (SC-022). If two salts ever share a step on an engine, item 12 goes back to the maintainer.
- **GitHub** (L16): a build with no cached step reads a fresh cache folder; recorded, and said in the docs (FR-037g).
- **GitHub** (job `proof`, SC-021 and SC-022): zekno runs with no terminal, so the test writes H4's entry into the throwaway profile's `agreed.json` before the deploy, as zekno would after a yes (a test seam, never an option). The build that reads the named secret deploys and answers. The same deploy without that entry stops with H9, nothing signed.
- **Mac, tests**: `NPM_TOKEN` set again, then a deploy: H7, sent and built again. A rollback to a deploy whose build read it: G45; after `zekno secret rm`: G46.
- **Mac, tests** (US10 sc8, only if step 1b ships after step 1): this zekno against a runner without build secrets: F3; that runner handed one: `unsupported_version`.
- **Server proof**: a build that reads a named secret; the marker not in the image or its history (M9).

## Step 2: a folder with no Dockerfile

Before it: M3, the pin file, and R1 to R10 and R16 recorded on GitHub (R2 and R3 with the Mac's plan committed with the tests).

### US6. Deploy a folder that has no Dockerfile

- **Mac, tests** (stand-ins for Railpack's release and for `railpack`): a Node fixture with `package.json` and no Dockerfile, no settings file, at a terminal. Expect I1 before anything is fetched or run; on yes I5 and I6 (checksum verified), I7, then I8; on its yes the files written with `builder: railpack` and port 3000. A release file that does not match: I20, deleted, never run. A kept copy changed on disk: I17 and a new fetch. A system with no pin: I23. No network: I22. No plan: I24. A plan naming an image not pinned: I25. A plan with a key the strict schema does not know: I25's form for it. With no terminal: nothing fetched or run.
- **Mac, tests**: the plan run on a copy of exactly the packed files, with no secret and no variable of the person's environment (a marker in the environment never reaches `railpack`), and a `HOME` of its own for each run: a file one run leaves there is not there for the next.
- **GitHub and Mac** (R16, item 26): `railpack prepare` exactly as CL10 runs it, on a benign fixture and on a hostile one (`mise.toml` with an `exec` template or `[env] _.source`, `.tool-versions`, `railpack.json` with commands). Expect every program it starts, every file it writes and every host it reaches recorded; anything it downloads pinned under M3, or step 2 waits.
- **GitHub** (R1, R5, both stores): the fixture `node-railpack` built by the pinned frontend from the plan made on the Mac (R2). Expect the app to answer, the plan checked against its signed fingerprint and images, and the work folder gone after the build. R5 also: a plan with an image in each field the format allows to hold one, and a plan with one unknown key, both refused unless their images are signed; a `.git` in the code folder and in its parents whose configuration would run a program, and no `git` run on the host (`BUILDX_GIT_INFO=0`).
- **GitHub** (R4): no network and a fresh build with Railpack. Recorded; until both reach Railpack's steps, I26 and G21 stay.
- **Linux stand-in, GitHub** (job `proof`, SC-016 and SC-004 for Railpack): deploy `node-railpack` and the app answers; deploy again with nothing changed and the committed plan: 0 bytes sent, no build, every build reused; a Railpack fixture whose build step fails, while the earlier deploy keeps answering and writing to disk; a rollback to the first Railpack deploy, which runs its kept image.
- **Mac, tests** (US10 sc4, sc7): a zekno of step 2 against a runner of step 1: F2. That runner handed a signed Railpack build: `unsupported_version`.
- **Mac, tests** (US7 sc3): `zekno settings plan` prints the plan; for a Dockerfile build, G24.
- **Server proof**: from a profile on which zekno never fetched Railpack, the macOS program fetches and checks it, plans, deploys; the app answers; the work folder is gone (M9).

### US11 (Railpack). Every plain variable reaches the build

- **GitHub** (R7, R8): a Node fixture whose build step reads `API_URL`. Expect its value in the build, B10 naming every plain variable but those never given, and a change to one making Railpack's steps run again through `secrets-hash`. 33 plain variables: I27.

### US12 (Railpack). No secret for a Railpack build yet

- **Mac, tests**: `build.secrets` on a Railpack service: H16 at `set`, H15 at deploy. A runner handed one: `unsupported_version`. **GitHub** (R10) records how the frontend would receive a secret, for a later step.

### End of step 2

As at the end of step 1 (the root build and the docs pages in a real browser among it), with the compiled runner answering `{"version":"0.1.2-dev.2","protocol":7}`, R1 to R10 and R16 asserting, the Railpack proof scenarios green, B1 (ARM64, item 4) and B3 (macOS, item 5), and the security review of step 2.

## The one proof on the maintainer's server (M9)

With a go-ahead at the time of each use. From the Mac's own zekno (the macOS program), over real SSH, with a throwaway profile and its key in a file, never the system keychain.

1. Note the server's Docker Engine, store, buildx and Compose versions, its processor and memory. Each must meet the floor; nothing on the server is changed to meet it.
2. `zekno server update` from 0.1.1 to 0.1.2-dev.2, from the published pre-release, with its recorded checksum.
3. Step 1: deploy the fixture `dockerfile-web`, `zekno domain add`, deploy: HTTPS with a public certificate. Deploy again with nothing changed: nothing sent or built. A build that reads a plain variable. A failed build while the app keeps answering on its domain. A rollback to a built deploy. `zekno doctor`.
4. Step 1b: a build that reads a named secret; the marker is not in the image or its history.
5. Step 2: a folder with no Dockerfile from a profile that never fetched Railpack; the app answers; the work folder is gone.
6. On the server: no build record zekno started is left; no `zekno.invalid/*` tag the state does not name; the build cache within its bound.
7. Clean up: the proof's apps, images, build cache and domains; check nothing of the proof is left (SC-016). The runner stays at 0.1.2-dev.2 unless the maintainer says otherwise.
8. Write what ran and what did not in the release notes' "Tried on" (`apps/runner/RELEASING.md`).

Not part of it: an out-of-memory build, an older engine, ARM64 unless the server is ARM64.

## Results

Filled in as each step ends: the counts of each package's tests, the jobs of `linux checks` on the tagged commit, each L and R finding with where it ran, SC-003's times, and the server proof.

The digests of `pins.json`, printed by `bun --no-env-file apps/runner/test/support/linux-server/digests.ts` (T006), for T023 to compare with GitHub's run:

```text
Mac network, 2026-11-27: ubuntu:24.04 ubuntu@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b (as pins.json)
Mac network, 2026-11-27: busybox:1.36.1 busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662 (as pins.json)
```

### Counts

- Core at the end of phase 1 (T058, 2026-11-28): 869 tests in 61 files, all passing; every source module loads when imported first. The runner's and the CLI's own tests that pin protocol 5 or state mark 4 fail until phases 2 and 3 move them.

### Phase 0 on the Mac (T022, 2026-11-27)

Every check written so far ran in the stand-in on the Mac: the floor and the newest on both stores, 29.4.3, Ubuntu's `docker.io` with and without its buildx, the floor without buildx, the floor held to 1 GB, and the released runner. Every record line, as printed, is in [results/phase-0-mac.md](results/phase-0-mac.md), each marked `Mac stand-in, ARM64, 2026-11-27`. QEMU is registered in Docker Desktop's VM (map-checks T11), and the Mac's records alone settle nothing: the items wait for GitHub's x86-64 run (T023, T024).

`server.ts up` took 33 to 77 seconds and an engine swap 4 to 14 seconds. After each stand-in, `down` said nothing named `zekno-check-*` was left, no image was added or removed but its own, and the Mac's build records were 18 before and after. What the Mac saw, in short:

| Check | Seen on the Mac | Bears on |
|---|---|---|
| L1 | Runner 0.1.1, sent a signed Compose text with a `build:` section, let Compose build the image on the server (three contexts tried) | FR-083 |
| L2 | With `BUILDKIT_SYNTAX=dockerfile.v0` the build fails: the builder asks Docker Hub for an image named `dockerfile.v0`. Without it, the frontend a `# syntax=` line names is fetched. The same with buildx 0.30.1, 0.34.1 and 0.39.1. A `Dockerfile.rego` inside the pack changes nothing | item 11 |
| L3 | Another app's cache namespace did not see the first app's cached file; the same app's next build did | FR-035 |
| L4 | The iidfile equals `containerimage.config.digest`; `.Id` equals `containerimage.digest`; the same pack again is cached and both stay the same | FR-061 |
| L4b | The same content with file times a day later: its `COPY` was cached | item 14 |
| L5 | With its reader killed, a silent step ran on for about 80 seconds, to its end; with the client itself killed, the build ended at once | item 27 |
| L6 | A step asking for 1.6 GB in a stand-in held to 1 GB was killed (`ResourceExhausted`, exit 102 after 3 s); the running app kept running and dockerd answered | FR-043a |
| L7 | A 512 MiB context grew Docker's root by at most 2.50 GiB on containerd's store and 1.50 GiB on overlay2 | FR-040, the 2 GiB floor |
| L8 | A private base resolved through the stand-in's login; no proxy value of `config.json` reached a step | FR-036 |
| L9 | The materials name a local `zekno.invalid/` image, also behind `ONBUILD`. buildx reads a `--policy` file only from the context's folder, so a pack on standard input can be given none. BuildKit's source-policy file stopped both builds before any step and let the control build | item 17 |
| L10 | After `docker buildx history rm`, what the step printed was still in one file under Docker's root, on both stores | FR-031b, K14 |
| L12 | After the record's removal the secret's value was found nowhere on disk, nor in the image | FR-037 |
| L13 | In a build with a secret, the frontend a `# syntax=` line names was fetched; the value was in no log | FR-037c |
| L14 | The stand-in has no git, so the `ADD` of a git address failed before any request: nothing learnt about `GIT_AUTH_TOKEN` yet | FR-037b |
| L15 | Builds with different salts never shared a step; the same salt again reused its own step | item 12 |
| L16 | A secret copied into the app's cache folder was not there in a later build with no cached step | FR-037g |
| L17 | The same files copied and the same stages read on the floor and the newest, both stores | CL2, CL3 |
| L18 | Passed: host network and insecure steps were refused; a build signed `none` had no address and reached nothing | FR-033 |

## Maintainer steps

Each is the maintainer's, with a go-ahead at the time. On 2026-11-27 the maintainer decided M2 to M4 as the plan recommends, but for the parts their rows leave open. M5 to M10 each keep their own go-ahead (item 25).

| Step | What | State |
|---|---|---|
| M1 | Answer the open points of the spec. | Done on 2026-11-26. |
| M2 | Approve the boards: every new screen and line, the README's and the docs' new words, and the nineteen choices; with them the lines of the plan's item 23. Screens and every sentence are built after it. | Done on 2026-11-27 for the 18 boards and the nineteen choices, each as recommended. The lines of item 23 are drafts in `lines.md`, shown to the maintainer before their screens are built. |
| M3 | Approve the tools: the stand-in's engines, packages and images (items 2, 3), the readers written in the project (items 8, 9), zstd (item 10), the tracing tool of R16 (item 26), and `timeout` if check L5 settles item 27 as (a); for step 2, the Railpack pin, how it was established and the attestation tool (item 1). | Decided on 2026-11-27: items 2, 3, 8, 9, 10 and 26, `timeout` as L5 settles item 27, and how the pin is established and verified (item 1). Open: the maintainer's own fetch of Railpack's checksums when step 2 starts. |
| M4 | Where the Linux checks run: decided (D10). Approve the way the check gets its engines (item 2), the two extra jobs (items 4, 5) and the newest-engine legs (item 6). | Done on 2026-11-27 (items 2, 4, 5 and 6). The ruleset setting of item 7 stays the maintainer's, made once `linux checks` has passed on `dev`. |
| M5 | Merge step 1, and step 1b if ready, into `dev` after each one's security review; push `dev`. | Open. |
| M6 | Before the tag, read step 1's proof from `linux checks` on the commit to tag. | Open. |
| M7 | Push `runner-v0.1.2-dev.1` from `dev`; the workflow publishes the pre-release. Run the second build and commit its checksums on `dev`. Then read B6, the update from 0.1.1. | Open. |
| M8 | Merge step 1b (unless it came with step 1) and step 2 into `dev` after their reviews; read their proof; push `runner-v0.1.2-dev.2`; the second build and its checksums. | Open. |
| M9 | The one proof on the maintainer's server, above. | Open. |
| M10 | Whether and when to release 0.1.2: merge `dev` into `main`, push `runner-v0.1.2`, approve the release in `prod`, the second build, the short proof of the released files. | Open. |
