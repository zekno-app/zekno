# Data model: build from source (feature 016)

Shapes and rules in full: [contracts/core.md](./contracts/core.md), [contracts/runner.md](./contracts/runner.md), [contracts/cli.md](./contracts/cli.md). Quotes are from [spec.md](./spec.md). "Item N" is an item of the plan's "Needs the maintainer"; the model follows its recommendation.

## In the project folder

### The settings' Build section (FR-006 to FR-011, FR-037a)

Names as choice G-a (a) of `design/lines.md` (Railway's words). Per service:

```json
"web": {
  "source": { "root": ".", "include": ["certs/server.key"] },
  "build": { "builder": "dockerfile", "dockerfile": "Dockerfile", "stage": "runner",
             "timeout": 3600, "network": "internet", "secrets": ["NPM_TOKEN"] },
  "networking": { "port": 3000 }
}
```

| Field | Key for `set` | Rule | Left out | Signed as |
|---|---|---|---|---|
| `source.root` | `<service>.root` | relative, `/` between parts; the settings file's folder, one inside it, or one above it up to the top of its git repository, never beyond; outside a repository, the settings file's folder or one inside it; no link on the way that leads out (FR-009, point 5) | `.` | decides the pack, not signed itself |
| `source.include` | `<service>.include` | relative paths inside the root, at most 64, unique: files on the list of secret-looking files to send, `.git` or a path under it among them (FR-015, choice G-b); each sent only after its own yes (B26) | none | decides the pack |
| `source.image` | `<service>.image` | as today; optional when `build` is set; never under `zekno.invalid` (FR-077) | — | the Compose text |
| `build.builder` | `<service>.builder` | `dockerfile`; `railpack` from step 2 (FR-008). A value this zekno does not know is refused and says to update zekno | required with `build` | `builder.name` |
| `build.dockerfile` | `<service>.dockerfile` | relative to the folder sent, inside it, at most 255 characters, core's path rule; the file's name on disk equal to it byte for byte; Dockerfile builds only | `Dockerfile`, unless the folder sent holds several Dockerfiles (FR-004): then it must be set, and the deploy stops before signing (CL7) | `builder.dockerfile` |
| `build.stage` | `<service>.stage` | `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`, a stage of the Dockerfile; Dockerfile builds only | the last stage | `builder.target` (`null`) |
| `build.timeout` | `<service>.build-timeout` | a whole number of seconds from 1 to 7,200 (FR-010) | 1,800 | `timeout` |
| `build.network` | `<service>.build-network` | `internet` or `none`; Dockerfile builds only (point 18) | `internet` | `network`: `default` or `none` |
| `build.secrets` | `<service>.build-secrets` | step 1b: secret names, unique, at most 32, no credential name (FR-037b), none for a Railpack build (FR-037h) | none | `secrets` |

Rules across fields:

- A service has `source.image` or `build`, never both, never neither (FR-006). `root` and `include` need `build`.
- Setting a build on a service that runs an image replaces the image in one change, and the reverse (FR-011).
- `source.build` leaves the list of settings "not in this version"; today's refusal of it goes (FR-006).
- An app whose name ends with a hyphen cannot have a built service (item 15).
- The reach of `source.root` needs the disk, so it is checked by the reader right after the schema. A root that is, or holds, the person's home folder or zekno's own folder is refused before signing (CL2).
- Holds no secret value, no key, no address.

### The Compose text of a built service (FR-022, FR-072a, FR-076)

Written by zekno, signed with the deploy:

```yaml
image: "zekno.invalid/shop:<key>"
pull_policy: "never"
environment:
  PORT: "3000"        # only with a port, and only when the settings do not set PORT
```

The image name is the build key's. No registry can answer for `zekno.invalid`.

### The proposed `.dockerignore` (FR-002b)

Written only on the yes of the first question, when the folder has none. First line `# Written by zekno deploy. What is listed here is not sent to the server.`, then each line of the root's `.gitignore` turned into Docker's form, then `**/node_modules`, `**/.venv`, and `.next` when present. A line that would leave out a path the Dockerfile copies by name (a `COPY` or `ADD` source with no wildcard, in the stages the chosen stage uses) is dropped, and a note names it (lines.md, unclear point 2).

## What zekno makes and sends

### The pack (FR-013 to FR-020, FR-030)

The folder's files as zekno packed them: "the same bytes for the same files on every machine".

| Part | Rule |
|---|---|
| Form | POSIX ustar. Regular files (`0`) and folders (`5`) only. No pax, no long-name extension, no link. |
| Which files | what `docker build .` would send from the folder, with `.dockerignore` applied by zekno (the Dockerfile's own ignore file wins), minus links, special files, zekno's own folder, and `.git` and secret-looking files not named and agreed to (`.git` counts as secret-looking, CL2); the Dockerfile and the ignore file in use are always sent, a Dockerfile build's under exactly the name signed |
| Folders | every folder that holds a sent entry, and every folder the ignore rules keep, is an entry with a trailing `/` |
| Order | strictly increasing by the UTF-8 bytes of the name (never JavaScript's `<`); each entry's parent is an earlier entry |
| Names | valid UTF-8 as on disk, relative, no empty, `.` or `..` part, no control character; split into a `prefix` of at most 155 bytes and a `name` of at most 100 at a `/`, a folder's trailing `/` counted (`splitsAsUstar`, item 16) |
| Mode | `0644`, or `0755` for a folder and for a file its owner may run |
| Owner | uid and gid 0, empty names |
| Time | one fixed time, 946684800 (2000-01-01). The runner gives each file the build's start time as it streams the checked pack to the builder (item 14) |
| End | two zero blocks, then nothing |
| Fingerprint | `hash("zekno/v1/pack", tar bytes)`, streamed |
| Limits | 512 MiB (`LIMITS.packBytes`), 50,000 entries (`LIMITS.packEntries`); a warning above 100 MB |

Rules: refused before signing when empty, when every file is left out, over a limit, or when a file cannot be read or changes while it is read (FR-018, FR-019). zekno keeps no copy after the deploy (FR-020).

### A piece (FR-026, FR-028, FR-029, FR-029a)

| Part | Rule |
|---|---|
| Cut | the tar is cut at fixed 8 MiB boundaries of its bytes; piece `i` holds exactly `L(i) = min(8 MiB, size − i × 8 MiB)` bytes |
| Compressed | alone, with zstd level 3, before sealing (item 10) |
| Sealed | `crypto_box_seal` for the server's key from the signed team list; nothing else inside |
| Fingerprint | `hash("zekno/v1/pack-chunk", sealed bytes)`, listed in the build's `pack.chunks` |
| Bound | sealed at most `LIMITS.sealedPieceBytes` (8 MiB + 64 KiB); opens to exactly `L(i)` bytes, the runner stopping at that bound; anything else is `pack_mismatch` |
| Count | `chunks.length = ceil(size / 8 MiB)`; at most 64 distinct code pieces per deploy, two builds of one folder naming the same pieces |
| On the developer's machine | written once into the run's own folder `~/.zekno/tmp/<random>/` (folder 700, files 600) between sealing and the end of the upload, deleted when the run ends; a run never empties `tmp/`, and deletes at its start only folders there older than 24 hours, since two runs can overlap; a new run seals again |
| On the server | staged in `<home>/packs/<app>/` by `pack`, moved to `<home>/building/<app>/` when the number is used |

### The build entry (signed; FR-021, FR-024, FR-027)

One entry per distinct key, at most 8 per deploy, sorted by key. A relay may read every field below. It never reads code, a plan or a secret value.

| Field | Rule |
|---|---|
| `key` | 64 hex, equal to `buildKey` computed again (FR-023) |
| `pack` | `{ hash, size, chunks }`: the fingerprint, 1 byte to 512 MiB, the pieces' fingerprints |
| `builder` | `{ name: "dockerfile", dockerfile, target }`, or `{ name: "railpack", version, frontend, images, plan: { hash, size, piece } }`: Railpack's fields are in the format from step 1, carried out from step 2 |
| `args` | the plain variables given to the build: `{ name, value }`, at most 32, sorted, unique; each value at most 4 KiB in bytes; 64 KiB in all per deploy |
| `secrets` | names of build secrets, at most 32, sorted, unique; each listed in the deploy's `secrets` |
| `network` | `default` or `none` |
| `timeout` | 1 to 7,200 seconds |
| `fresh` | `null`, or a deploy number from 1 to this deploy's own |

### The build key (FR-022, FR-037e)

`hash("zekno/v1/build", JSON.stringify([pack.hash, recipe, args, secrets, network, fresh]))`, where `recipe` is `["dockerfile", dockerfile, target]` or `["railpack", version, frontend, images, plan.hash]`, `args` is `[[name, value], …]`, `secrets` is `[[name, the fingerprint of its sealed value the deploy lists], …]`, and `fresh` is `null` or the number as text.

- "Changing any part of the key MUST change the key."
- The sizes, the pieces, the plan's size and piece, and the time limit are signed and not in the key.
- The base key is the key with `fresh` null.
- No secret value, and nothing made from one by a plain hash, is in it.

### Build variables (FR-036 to FR-036e)

"The plain variables of a service that its build reads."

| Builder | Which | Never given |
|---|---|---|
| Dockerfile | those whose names the Dockerfile declares with `ARG` anywhere, in any stage and before the first `FROM`, read as Docker reads it | names zekno reserves (`PATH`, `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, `GODEBUG`, `DOCKER_*`, `COMPOSE_*`, `BUILDKIT_*`, `BUILDX_*`, `LD_*`, `DYLD_*`, `SSL_CERT_*`, `*_PROXY`), names the builder reads as its own (`SOURCE_DATE_EPOCH`, `TARGETPLATFORM`, `TARGETOS`, `TARGETARCH`, `TARGETVARIANT`, `BUILDPLATFORM`, `BUILDOS`, `BUILDARCH`, `BUILDVARIANT`), and names of the app's secrets |
| Railpack (step 2) | every plain variable of the service but those never given | as above, plus the credential names of FR-037b |

`PORT` set by zekno is a plain variable like any other. A name never given is named in the summary, and the deploy goes on. Over 32, or past a value's bound, is refused before signing.

### Build secrets (step 1b; FR-037 to FR-037h)

"A secret of the app that the build settings name, one by one, as one the build may read, and that this machine agreed to give to that build."

- A secret of the app, set and not removed; it need not be one the running service reads.
- Never `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, or a name starting `HTTP_AUTH_TOKEN_` or `HTTP_AUTH_HEADER_`, in any case: a schema rule, so zekno cannot sign one and a runner refuses it.
- Its name is signed; its value never is. The key takes its name and the listed fingerprint of its sealed value.
- It reaches the build only as a mounted secret under its own name. The program that starts the build gets it under a name the runner picks, `ZEKNO_BUILD_SECRET_<i>`.
- None for a Railpack build until FR-089a's checks lift it, with a protocol number of its own.

### The Railpack plan and pins (step 2; FR-049a, FR-051 to FR-060)

| Thing | Rule |
|---|---|
| The pin | `apps/cli/src/railpack/railpack-release.json`: the version; for `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64` the archive's name, size and SHA-256, and the SHA-256 of the `railpack` program inside; the download hosts; the frontend by digest; each plan image's tag and digest; any program `railpack prepare` downloads (R16). Established by M3 (item 1), each checksum and digest fetched on two networks and compared, read by a strict schema, never from the download |
| The kept copy | `~/.zekno/tools/railpack/<version>/<system>/railpack`, mode 700, hashed again before each use |
| A run | on a copy of the packed files in the run's own `~/.zekno/tmp/<random>/railpack/`, with a `HOME`, `XDG_*` and `TMPDIR` of its own there, deleted after |
| The plan | made by `railpack prepare` on that copy; read by a strict schema of the pinned version's format, a key it does not know refused (CO15); each image tag rewritten to its pinned digest; written in one form (sorted keys, no spaces); at most 256 KiB |
| Signed | `version`, `frontend`, `images` (1 to 8, sorted, unique, by digest), and the plan's fingerprint `hash("zekno/v1/plan", plan bytes)`, size and sealed piece |
| Travels | as its own sealed piece, compressed and sealed like a code piece, at most one per build |
| On the server | checked before the number (fingerprint, images by digest); written to the work folder's `plan/plan.json`, outside the code folder |
| Kept on this machine | the last plan of each service in `~/.zekno/plans/<server id>/<app>.json`, to say why it changed |

### The summary (FR-017, FR-072 to FR-072c)

Made by one pure function from the files chosen, the Dockerfile's reading, the settings, this machine's history and the runner's answers. Shown before signing: files, size, largest folders, what was left out and by which rule, every secret-looking file sent and why, the builds and what each reads (secrets by name only), the warnings, what the signature does not cover. With no terminal, and with `--json`, each fact is one line on standard error.

## On the developer's machine

### Answers kept on this machine (FR-015a, FR-015b, FR-037f)

`~/.zekno/agreed.json`, mode 600, written whole, at most 1,024 entries of each kind, the oldest dropped. A damaged file counts as empty, so the question is asked again, and with no terminal the deploy stops. Unsigned, as `links.json` is.

| Kind | Holds | Asked |
|---|---|---|
| `folders` | the real path of the folder sent and of the settings file | the first deploy that builds from that folder (B24) |
| `files` | the real path of the folder sent and the file's path inside it | a secret-looking file the settings name (B26) |
| `secrets` | server id, app, service and secret name | step 1b: giving a secret to a build (H4) |

Never written by `--yes` or any other option.

### The saved build output (FR-071a, point 23)

`~/.zekno/builds/<server id>/<app>.log`, mode 600. At a terminal and in the app, each line the runner sends is appended to a temporary file, which replaces this one when the deploy ends. Its first line names the deploy, the server and the time. At most 32 MiB: past it the oldest lines are dropped and their count is said in the first line. With no terminal nothing is saved; the lines go to standard error, sanitized. Read by `zekno logs --build`, which sanitizes each line as it prints it; the file keeps the raw text.

### The history (FR-065)

Each version-2 deploy this machine signed keeps its `builds` as signed and the services each build serves. The outcome list gains `build_failed`. Used by rollback, "changed, not deployed", and "builds again because".

## On the server

### The runner's state, mark 5 (FR-045, FR-066, FR-067, FR-085)

Mark 4 plus:

```ts
builds: Record<APP_NAME, {
  running: number | null                              // the deploy whose Compose text is in force
  images: { key: Hex64; manifest: Digest; config: Digest }[]   // at most 24, sorted by key, each once
  deploys: { sequence: number; keys: Hex64[] }[]      // at most 3, newest first; their keys are exactly `images`
  drop: { key: Hex64; manifest: Digest; config: Digest }[]     // at most 24: images to remove, kept until removed
  fresh: { base: Hex64; sequence: number }[]          // at most 24, sorted by base, each base once
  last: { sequence: number; outcome: "built" | "reused" | "build_failed"; reason: Reason | null; at: string } | null
}>
building: {
  app: APP_NAME; sequence: number; keys: Hex64[]; since: string; limit: number
  phase: "building" | "stopping" | "starting"         // what `busy` and `builds` report
  run: Hex32                                          // the token every build client of this deploy carries
  stopped: string | null                              // when the runner stopped it (phase stopping)
} | null
```

Rules: every app in `builds` is at format 2; every sequence is at most the app's last number; no key is in both `images` and `drop`; `building.sequence` equals its app's last number; a digest is `sha256:` and 64 hex. `building` is written with the number, before any build client starts, so a runner that dies at any point leaves its run token for the next request (RB15). Mark 4, 3, 2 and none are read forward with `builds: {}` and `building: null`. Runner 0.1.1 refuses mark 5, so a runner put back by hand refuses every request.

### Kept images (FR-061 to FR-064, FR-067)

"An image the runner keeps for the deploy an app runs, or for one of the two most recent other deploys whose builds succeeded, with the image id it recorded."

- A build is reused only when the state records its key for the app (in `images`, or in `drop` while its image is still there) and `docker image inspect zekno.invalid/<app>:<key>` gives an `.Id` equal to its manifest or config digest.
- After each deploy: keep `running`'s keys and the two newest other `deploys`, deploys with the same keys counted once. A failed build and a reuse push nothing out.
- An image no entry keeps moves to `drop`, and is removed by its tag, only while its `.Id` is still one of its digests. Its entry and its `kept/` file stay until the removal succeeds (a container may still use it), and each later deploy of the app tries again. A tag that is gone or leads elsewhere is left alone and its entry dropped.
- An image a deploy that ends `build_failed` made, a leftover under a tag about to be built, and an image a runner that died left are removed by their tags the same way (RB11, RB15): none is ever recorded, so nothing else would find them.
- The list comes from the state, never from a list of every image on the server.

### Fresh generations (FR-021a)

After a fresh build succeeds, `fresh` records its base key with the deploy's number. A later deploy of the same base key signs that number, so its key is the fresh image's: the newer of what `builds` reports and what this machine's history holds, never an older one on the server's word alone (CL7 step 9). At most 24 per app, the oldest dropped.

### The build record (FR-066, FR-031a)

`<home>/kept/<app>/<key>.json`, mode 600, removed with the image. "The server's word, never signed. Never the builder's lines."

| Field | Rule |
|---|---|
| `key`, `manifest`, `config` | as in the state |
| `builder` | `dockerfile`, or `railpack` with its version |
| `docker` | the server's Docker Engine and buildx versions, and the BuildKit version inside, each held to a version pattern |
| `reader` | Docker's built-in Dockerfile reader with its version, or the Railpack frontend's digest |
| `cache` | whether a cached step other than `FROM` was used |
| `bases` | at most 16 base images, each a reference with a digest, held to a pattern |
| `arch` | `amd64` or `arm64` |
| `built` | the time |

### The bounded reasons (FR-031a)

`step_failed`, `out_of_memory`, `out_of_disk`, `time_limit`, `wrong_processor`, `cache_used`, `team_changed`, `runner_restarted`, and `reserved_image` with item 17 (a) or (c). Chosen by the runner from what it did and saw; never text the builder printed, never a step's command. `runner_restarted` is recorded, never answered to a deploy; `zekno status` shows it.

### Staging and work folders (FR-028, FR-031, FR-047, FR-050, FR-069)

| Thing | Rule |
|---|---|
| `<home>/packs/<app>/` | one deploy's pieces, named by fingerprint, and a file naming the deploy and when it was staged; another deploy's `pack` for the app replaces them; at most 2 GiB in all, none older than 24 hours, none of a deploy that can no longer run; a piece that would bring the disk of `<home>` below the floor is refused `low_disk` |
| `<home>/building/<app>/` | the pieces of the deploy being checked, moved there under the state lock just before the check (K14d), then of the build; deleted on `pack_mismatch`, on a refusal before the number, and when the build ends |
| `<unpacked>/<24 hex>/` | the work folder of one build, outside `<home>`: `/var/lib/zekno-unpacked/` for root, else `~/.local/state/zekno-unpacked/`, mode 700. Holds `meta.json` (deleted once read) and, for Railpack, `code/` and `plan/`. Deleted when the build ends; everything left in `zekno-unpacked/` is deleted before the next build |
| `<home>/buildx/` | the private `BUILDX_CONFIG`: one ref file per build the runner started, deleted once Docker's record is removed; a ref whose record could not be removed stays, and the next deploy tries it again |

There is no `building.json`: the state's `building` holds the run token, the phase and the stop time, written before any client starts; the refs are the files in `buildx/`.

## State changes

### A deploy that builds, from upload to started or failed

| From | Event | To | Number |
|---|---|---|---|
| signed by zekno | `deploy` sent, a build not kept, its pieces not all staged | refused `pack_missing` with the missing fingerprints; nothing written | not used |
| signed by zekno | `deploy` sent while another deploy builds | refused `busy` with `building`; zekno sends the pieces with `pack` and waits (CL7, item 29) | not used |
| missing pieces | `pack` for each (state lock only; never waits for a build) | staged in `packs/<app>/`, or refused `low_disk` | not used |
| staged | `deploy` again: kept, Docker, disk, limits, secrets and pieces pass, and the team lists still allow it | the number written with `building` (phase `building`, a new run token); state lock released | used |
| any check fails | `docker_too_old`, `no_build_plugin`, `low_disk`, `too_large`, `secrets_mismatch`, `pack_mismatch`, a core reason | nothing written but team lists; pieces moved for the check deleted | not used |
| every build kept | the checks pass | no build; `last` is `reused` | used |
| building | every build succeeds; the signer and every statement and removal used are still allowed | images recorded with the deploy's entry; `last` is `built`; phase `starting`; then `up --no-build`, routes and health as in 015; `building` cleared | used |
| building | a step fails, out of memory, wrong processor, a cached step where none was allowed, `reserved_image` | `build_failed` with its reason; every image the deploy made removed, none recorded; the running app untouched | used |
| building | its time limit, free disk below the floor, or the team list watch finds the signer or a statement no longer allowed | stopped (phase `stopping`); the builds left skipped; the lock held until Docker's record is no longer `Running`, or 120 seconds (then released with `building` kept, and every deploy `busy` while the record runs, item 28); `build_failed`, `time_limit`, `out_of_disk` or `team_changed`; the deploy's images removed | used |
| built | the team lists at B3 no longer allow the signer, or a statement or removal used | `build_failed`, `team_changed`; the new images removed and not recorded; the running app untouched | used |
| building | the runner dies | at the next request that takes the deploy lock (or, bounded, `sync`, `pack`, `builds`, `status`): every client with the run token stopped, records removed, the run's images removed, `last` is `build_failed`, `runner_restarted`; `building` cleared | used |
| starting | the runner dies during `up`, routes or health | at the next such request: `building` cleared; `last` stays `built`; the outcome as when a runner dies in 015 | used |
| built | `up` fails, or routes fail, or not healthy | the images stay recorded and kept; the outcome as in 015 | used |

Outcomes in order: `refused` (no number) → `build_failed` → `start_failed` → `routes_failed` → `unhealthy` → `started`.

### Kept images, after each deploy

| From | Event | To |
|---|---|---|
| an app's entry | a deploy whose builds succeeded or were reused reaches `up` | it becomes `running` and the newest of `deploys` |
| more than three distinct deploys | the same | the oldest entries past the three dropped; images no entry names move to `drop` |
| an entry in `drop` | a later deploy of the app (before its answer) | removed when `docker image rm` succeeds or the tag is gone or leads elsewhere; else kept for the next deploy |
| any | `build_failed` | unchanged but `last` (the deploy's own images were never recorded, and are removed) |
| any | a deploy with no build reaches `up` | `running` is that deploy; the images of the two newest built deploys stay |

### The locks (FR-044, point 7)

Two files in `<home>`: `lock` (the deploy lock, "D") and `state.lock` ("S"). D is always taken before S, never the reverse. S is held only for short spans: no Docker call is made and no piece is read while it is held, except by version 1's `apply`, as today. So a team list update that removes a stolen key lands within its 120-second wait, whatever Docker or a resent deploy does.

| Request | Takes | While the other is held |
|---|---|---|
| `setup` | D and S; RB15 first when `building` is set | busy |
| `deploy` | D for the whole deploy; S for K3 to K14, for the move of K14d's pieces, at K17, at B3 and for each later state write | D held: busy, with the building app, its seconds, its limit and its phase. S held: waits up to 120 seconds, then busy |
| `apply` (version 1) | D and S for its whole span; RB15 first | as `deploy` |
| `proxy` | D; S for its state writes; RB15 first | busy |
| `sync` | S only; D tried once, without waiting, when `building` is set (RB15's bounded part) | never waits for a build |
| `pack` | S only; D tried as `sync` does | never waits for a build |
| `status`, `builds` | none; D tried as `sync` does | answered |
| `records`, `state`, `logs`, `builder` | none | answered |

Every state write after the number is used takes S, reads the state again, changes only its own part, and writes the whole state with its mark. A lock whose holder is gone is taken over, as today; a request that takes D and finds `building` set knows that no runner watches that build any more (RB15).
