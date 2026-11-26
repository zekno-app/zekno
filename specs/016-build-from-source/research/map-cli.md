# Research record: apps/cli for building from source (map and design)

Written by an agent on 2026-11-27, at commit 00912ad on `016-build-from-source`. Line numbers go stale. Every design here is the agent's proposal. What is decided goes into plan.md and the contracts.

**Read or ran.** Every statement is from reading the code, unless it says **(ran)**. What was run: line counts (`wc -l`), and two probes in Bun 1.4.4 in a scratch folder outside the repository (part 1.11). Nothing was run against a server, Docker or the network. Railpack's release was not looked at again: its file names and flags below come from the research (R1 to R10), and are marked "to confirm at M3".

Paths are relative to `apps/cli/` unless they start with `packages/`, `apps/web/`, `specs/` or `README.md`.

---

## Part 1. The map (read)

### 1.1 `zekno deploy`, from the first question to the result

| Step | Where | What happens today |
|---|---|---|
| Arguments | `cli/cli.ts:271-278`, `cli/options.ts:84` | At a terminal (`deps.ui.asks`) goes to `deployAtTerminal`; otherwise `commands/deploy.ts` `deploy`. `--skip-dns-check` is parsed for deploy only. |
| First use of zekno.json | `asking/first-deploy.ts:241-259` | `withProject` judges zekno.json before any other question. |
| Which file | `asking/first-deploy.ts:265-277`; `settings/source.ts:78-99` | `chooseSource`: `-f`, the link, then the one of `compose.yaml` and `zekno.app.json` here. Both here: "Deploy from which file?" (`asking/asking.ts:204-217`, words `settings/words.ts:433-441`). Neither: a `compose` source whose read fails. |
| Read once | `asking/first-deploy.ts:279-283`; `settings/source.ts:169-185` | `readSource`: a Compose file by `readCompose` (`project/compose-read.ts:261-271`); a settings file read and checked whole, then turned into Compose text (`settings/compose.ts:96-109`), with routes and health. Neither file: today's sentence `No Compose file at <path>. Point to one with -f <file>.` (`project/compose-read.ts:79`). |
| Opening line | `asking/first-deploy.ts:286-295` | Only when the key or a server is missing. |
| Key, server, app, remember folder, values | `asking/first-deploy.ts:305-431` | Each made by an existing operation. `NOTHING_MORE` (`:101`) once something was made. |
| The deploy | `asking/first-deploy.ts:442-461` | `prepareDeploy` with the text read, then `send` (`commands/deploy.ts:51-96`). |
| No terminal | `commands/deploy.ts:118-134` | `prepareDeploy` (`ops/deploy.ts:202-231`) reads the file itself, then `send`. |
| Session | `ops/deploy.ts:309-384` | One session: `version` → `chooseFormat` (`ops/deploy-format.ts:51-69`) → `status` and `checkIdentity` → `AppTaken` → `checkDomains` → `deployVersionTwo` or `deployVersionOne` (`ops/deploy-send.ts:360-415`, `:297-349`). |
| Answer | `ops/deploy-send.ts:128-197` | `deliver`: progress and health events (`:146-158`), the `sent` stage, the report, only `ANSWERED` outcomes (`:204-209`), history saved. |
| Result | `commands/deploy.ts:76-95` | `--json` object; HTTPS wait (`ops/deploy-https.ts`); `view.end`; exit 0 only for `started`. |

### 1.2 The checks before signing, in order (today)

1. zekno.json first use (`project/project.ts`, `withProject`).
2. The file chosen and read once; a settings file checked whole (`settings/file.ts:139-197`, `checkSettings` at `:181`). An empty text stops (`ops/deploy.ts:217-218`, `asking/first-deploy.ts:282-283`).
3. `checkApp` (`ops/deploy.ts:114-121`).
4. In the session: C7 and B10 (`ops/deploy-format.ts:60-63`); identity (`ops/status.ts:46`); a rollback's routes (`ops/deploy.ts:336-343`); A12 `AppTaken` (`:348-349`); domains B9, B11, B12 and DNS (`ops/deploy-domains.ts`, called at `ops/deploy.ts:352-359`).
5. Version 2: `records` (`ops/deploy-send.ts:364`), `held` saved (`:368`), the listing with C4, C5 and C5b (`:369`, `ops/deploy-secrets.ts`), stage `checked` (`:374`), then `createDeployV2` (`:376-390`). A `CoreError` while signing becomes one sentence (`:64-73`). The history entry `sent` is written before it leaves (`:97-105`).

`createDeployV2` is given `routes` and `health` only. `builds` stays empty: core keeps it for tests (`packages/core/src/deploy/later-fields.ts:37-76`, research 7.1).

### 1.3 What a person sees

| Piece | Where |
|---|---|
| Summary panel (`app`, `server`, `from`, `secrets`, `domains`, `replaces`) | `ui/parts/deploy-summary.tsx:121-181`; `from` row from `commands/deploy.ts:105-116` (DP3). |
| Stage row `Checked Signed Sent Starting/Started` | `LABELS` `ui/parts/deploy-summary.tsx:16`, `DONE` `:18-25`, `stagesOf` `:45-62`, fifth stage `healthStagesOf` `:75-95`; marks in `ui/parts/stages.tsx`. |
| Number used | `numberUsed` `ui/parts/deploy-summary.tsx:104-113`. |
| Live line (Docker's latest) | `ui/ink/deploy-view.tsx:201-213`; nothing drawn until the runner answered (`ui/ink/deploy-live.ts`). |
| Result and failed start lead | `ui/ink/deploy-view.tsx:214-258`. |
| "Docker said" panel | `ui/ink/deploy-view.tsx:260-269`; `earlierLeftOut` `shared/deploy.ts:292-293`; `HELD_LINES` 500 `:189`. |
| What to do after | `failedNext` `shared/deploy.ts:336-341`, drawn at `ui/ink/deploy-view.tsx:270`. |
| Plain output | `plainDeployView` `shared/deploy.ts:357-401`: nothing while it runs; `startedSentence` on standard output; a failed start's sentence on standard error, then Docker's lines as `remote` lines (`ui/plain/plain.ts:78`). In plain output `info` and `note` write to standard output, `warn` and `error` to standard error (`ui/plain/plain.ts:58-63`). |
| Types | `DeployStage` `shared/deploy.ts:18-19`, `DeployOutcome` `:27-28`, `DeployInfo` `:51-69`, `DeployStart` `:72-95`, `DeployEnding` `:107-119`, `DeployView` `:127-140`, `DeployProgress` `:148-186`. |

### 1.4 The settings file and its commands

| Part | Where |
|---|---|
| Shape (zod) | `settings/shape.ts`: `later` `:88`, `SourceSchema` (`image`, `build: later`) `:134-140`, `DeploySchema` `:142-163`, `ServiceSchema` `:229-238`, `SECTIONS` `:260-265`, `LATER` (`source.build`, `deploy.predeploy`, `deploy.replicas`) `:272-284`. |
| Types | `settings/types.ts`: `ServiceSettings` (image required) `:13-33`, `LaterSetting` `:66`, `SettingPath` `:78-96`, `Change` `:99-109`, `SettingRow.section` `:113`, `SettingsReport` `:132-150`, `DeployText` `:157-169`. |
| Checks | `settings/schema.ts`: `unknownKey` (SV6 and the later settings) `:120-162`, `serviceOf` `:265-302`, `acrossSettings` `:309-334`, `checkSettings` `:432`. Values in `settings/values.ts` (limits `:30-69`). |
| Reader | `settings/file.ts:139-197`: one open file, 64 KiB, strict UTF-8, then `checkSettings`. |
| Writer | `settings/text.ts` (`serviceNode` `:56`, `settingsText` `:158`); `settings/write.ts` (`FIELDS` `:66`, `writeSettings` `:224`, `createSettings` `:363`). |
| Compose text | `settings/compose.ts`: `serviceLines` `:55-93`, `composeText` `:96-109`, read back by `deployedSettings` `:191-209`. The form is fixed; `project/compose-file.ts` `SETTINGS_LINES` `:108-139` and `inSettingsForm` `:149-155` must know every line it writes (security review S9 of 010). |
| Sentences | `settings/words.ts` (633 lines): SV7 `:108`, the build later-sentence `:281-286`, `laterSentences` `:298-311`, CS5 `:366-367`, CS6 `:369-370`, CS15 `:395`, IN1 to IN3 `:403-410`, DP1 `:433`, `IMAGE_NEEDED` `:500`, `settingWords` `:533`, `NOT_SET` `:611`. |
| Set and unset | `settings/change.ts`: `SINGLE` `:51-78`, `LATER` (`build`, `source.build`) `:81-88`, `parseSettingPath` `:102`, `applyChange` `:276`. Command `commands/settings.ts:93-118`; operation `ops/settings.ts:323-363`. |
| Report | `commands/settings.ts:42`; `ops/settings.ts` `showSettings` `:241`, `lastDeployed` `:219` (uses `deployedSettings`); `settings/rows.ts` `reportRows` `:324`, `reportOf` `:401`, `screenRows` `:428`; `settings/piped.ts` `placesOf` `:44`; drawn by `ui/ink/settings-report.tsx`, plain by `ui/plain/plain.ts` `settingsReport`. |
| Init | `commands/settings.ts:128-150` (IN1 image, IN2 name); `ops/settings.ts` `prepareInit` `:370-391`, `createFromAnswers` `:399-411`. |
| Compose | `commands/settings.ts:160-171`; `ops/settings.ts` `folderCompose` `:420-426`: the same `composeText` a deploy signs, no keychain, no server. |

### 1.5 Status, doctor, rollback, logs

- **Status**: `commands/status.ts:70`; `ops/status.ts` `askStatus` `:89`, `readStatus` `:219`. The runner's `status` schema is strict (`packages/core/src/protocol/protocol.ts:309`): a new field breaks an older zekno's `status`.
- **Doctor**: `commands/doctor.ts:62`; `ops/doctor.ts` (764 lines). Labels `:110-119`, the Disk line's next step "before the next deploy" `:236-237`, the warning at 1 GiB `:257`. The server check is a fixed script (`server/check-script.ts`): it reads Compose's version (`:51-56`) and free space with `df` (`:83-87`), not the Engine's version, not buildx, not memory.
- **Rollback**: `commands/rollback` is `commands/deploy.ts:137-151`; `prepareRollback` `ops/deploy.ts:249-293` takes the old Compose text only. `sentDeploys` `:142-173` keeps number, text and outcome. The history reader drops everything but the shared fields, routes and health (`shared/history.ts:36-40`, `:57-118`).
- **Logs**: `commands/logs.ts:29`; `ops/logs.ts` follows the runner's logs. Nothing reads a local file.

### 1.6 The full-screen app

- **Deploy effects**: `app/effects/deploys.ts` (471 lines). A folder with no Compose file says `There is no compose.yaml in …` (`:202-213`). The plan is made by `prepareDeploy` (`:305`); missing values are asked (`:309-326`); `deploy` sends with `sendDeploy` and turns each callback into an event (`:374-468`, `:403-424`).
- **Deploy screen**: `app/screens/deploy.tsx`: `PointedLines` above the panel `:232`, `Summary` `:233`, `Stages` `:238`, panel "Docker said" or "Docker's output" `:251`, `o` `:216`, "Leaving this screen does not cancel the deploy" `:266`, the question panel "Remember this folder?" `:398`. Lines kept: `DEPLOY_LINES` 500 (`app/state/types.ts:24`).
- **App screen**: deploy rows `✔ started` / `✖ did not start` (`app/screens/app.tsx:74-79`).
- **Settings screen**: sections laid out in `app/screens/settings-layout.ts:243-247`; rows from `screenRows`; change panel `app/screens/settings-change.tsx`, state `app/state/settings-change.ts`; "changed, not deployed" from `app/effects/settings.ts`.

### 1.7 How a runner release is fetched and checked (the model for Railpack)

- **The pin**: `version/runner-release.json` (version and a SHA-256 per Linux architecture), read by a strict zod schema (`version/runner-release.ts:17-38`). The checksum "comes from here and never from the download" (`:7-11`). The address is built from the version and the architecture only (`:47-49`).
- **The download** happens on the server, not here: the install script fetches with `curl --proto =https … --max-filesize 268435456` or `wget` (`server/install/script.ts:147-156`), caps the bytes with `head -c` (`:286`, `:291`) and compares the SHA-256 this zekno sends as a script word (`:273-298`; words checked in `server/install/checks.ts:57-62`). With `--runner-file`, this zekno sends the bytes in 64 KiB pieces (`server/install/install.ts:43-51`) with its own SHA-256 (`checks.ts:150`). The line `✔ Runner installed  110 MB, checksum verified` is `asking/first-deploy.ts:489-492`.
- **The one HTTP fetch zekno makes itself**: `version/newest.ts`. One fixed HTTPS address, a fixed `User-Agent: zekno`, no credentials, 3 s and 16 KiB at most, redirects only to one host, the answer parsed by the strict schema, never throws. `deps.fetch` is set only in `main.ts:31`. `test/version/never-fetches.test.ts:24-60` runs every command of the help with a counting fetch, and `:110-127` allows `.fetch` only in `version/newest.ts`. The docs promise "Only `zekno version` and `zekno doctor` contact GitHub" (`apps/web/content/docs/doctor.mdx:136`).
- **After a release**: the checksums are committed in a reviewed change ("run the second build and commit its checksums", spec M7).

### 1.8 Where this machine remembers things

`ZEKNO_HOME`, else `~/.zekno` (`main.ts:25`). Folders mode 700, files written whole with mode 600 (`profile/profile.ts:173-191`).

| File | Holds | Where |
|---|---|---|
| `profile.json` | team, servers | `profile/profile.ts:164` |
| `secrets/<server>/<app>.json` | sealed records | `:165-166` |
| `history/<server>/<app>.json` | the last 50 signed deploys and outcomes; outcome enum strict (`:101-112`) | `:167-168` |
| `held/<server>/<app>.json` | what the server said it holds | `:169-170` |
| `links.json` | real path and SHA-256 of each zekno.json used here; unsigned on purpose | `project/accepted.ts:1-56` |

`links.json` is the model for remembered answers: bounded size, strict schema, a damaged file counts as empty, oldest entries dropped, a link in its place replaced.

### 1.9 Tests, frozen transcripts, stored captures

- **Layout**: `test/<folder>/` mirrors `src/<folder>/`; scenarios in `test/scenarios/`; helpers in `test/support/` (stand-in server `stand-in-server.ts`, older runners `older-runner.ts`, the runner of this repository with a stand-in Docker). Real Docker tests are tagged (`test/scenarios/real-docker.test.ts`, `ZEKNO_TEMPLATES_DOCKER`). The e2e suite is `tests/*.e2e.ts` with `e2e.config.ts` (it reads `.env.local`, which was not opened).
- **Folders and imports**: `test/layers/layers.test.ts`: `LAYOUT` `:58-73` (a new folder of `src` changes it), `BASE` `:282-292` (rule 3), `DATA_FILES` `:43-48` (a JSON file in `src` must be listed).
- **Frozen transcripts**: `test/plain/plain-unchanged.test.ts`. The help may only gain lines listed in `ADDED_TO_HELP` (`:20-41`); every scene's calls, lines and exit status equal `plain-at-head.ts`. No scene holds a Compose file with `build:` (grep, read).
- **Help**: `cli/help.ts:11-41`. "A line of the help is never edited: a feature adds lines of its own."
- **Stored captures**: `test/screens/capture.ts` writes `apps/web/content/screens/*.json` (15 files); `test/screens/screens.test.ts` fails on drift. New help lines change `help.json`, which is redrawn with `bun run screens`.
- **Docs tests**: `test/docs/` (`metadata-note.test.ts` holds the README's metadata sentence that K8 changes).

### 1.10 Files at or over 500 lines (ran: `wc -l`)

Over: `ops/doctor.ts` 764, `settings/words.ts` 633, `asking/first-deploy.ts` 539. Near: `app/effects/servers.ts` 493, `settings/rows.ts` 487, `server/session.ts` 487, `app/screens/app.tsx` 478, `app/effects/deploys.ts` 471, `server/transport.ts` 469. Each is a file this feature touches. New code goes in new files; the three over the limit are split before anything is added to them.

### 1.11 What the probes showed (ran, Bun 1.4.4, scratch folder)

- `Bun.CryptoHasher("blake2b256")` over `domain ‖ 0x00 ‖ data` equals core's `hash()` (libsodium `crypto_generichash`, 32 bytes). libsodium's `crypto_generichash_init/update/final` gives the same. So the pack can be hashed as a stream, with no new code in libsodium.
- `Bun.CryptoHasher("sha1")` of `blob 0\0` gives git's empty blob id `e69de29b…`.
- `Bun.zstdCompressSync` of the same 8 MiB twice gave the same bytes; `Bun.zstdDecompressSync` exists.
- `node:zlib` `inflateSync` works (git objects).
- `Bun.Archive` read a `.tar.gz` and gave the entry's name and bytes, but no mode.
- This repository's `.git/index`: version 2, 1,057 entries, a `TREE` extension, HEAD a branch ref, one pack, no `packed-refs`, SHA-1, no reftable.

---

## Part 2. The requirements that land in the CLI

Runner-only requirements are left out (FR-023, 028, 031, 031b, 032 to 035, 039, 040, 046 to 050, 067 to 069, 076, 083, 085, 088 to 090). Core (`packages/core`) carries the format, the key and the pack form for both sides; the CLI fills and checks them.

| Requirements | What the CLI does | Where (proposed) |
|---|---|---|
| FR-001, 012 | Build each built service; one pack per folder sent, one build per distinct key | `ops/deploy-build.ts` |
| FR-002, 002a, 002b, 003, 004, 005 | First-deploy question, port, proposed `.dockerignore`, no terminal as today, only `Dockerfile` counts | `asking/first-build.ts`; `pack/propose.ts` |
| FR-002c | After the first deploy, how to reach a built service | `shared/build-words.ts`, drawn by the deploy view |
| FR-006 to 011 | Build section, values, reach of `source.root`, set/unset/compose/init/screen | `settings/` (new files `build-shape.ts`, `build-values.ts`, `build-words.ts`, `build-rows.ts`) |
| FR-013 to 020 | Choose files as Docker would, links, `.git`, secret-looking list, yes per file and per folder, same bytes everywhere, summary, uncommitted line, limits, read faults, no copy kept | `pack/`, `git/`, `profile/agreed.ts` |
| FR-021, 021a, 022, 024, 025 | Fill and check the signed build entry; `--fresh`; key from core | `ops/deploy-build.ts`; core |
| FR-026, 027, 029, 029a, 030 | Compress, seal, chunk, send missing pieces, the one form | `pack/chunks.ts`, `ops/deploy-upload.ts` |
| FR-034a, 081, 082, 084 | Stop before signing for an old runner or old Docker; protocol numbers | `ops/deploy-format.ts` |
| FR-036 to 036e, 037, 037a, 037b, 037e, 037f, 037h | Which plain variables and secrets each build reads, limits, names left out, the yes for a secret | `dockerfile/args.ts`, `ops/build-reads.ts` |
| FR-038, 041, 043, 043a, 044, 045, 070 to 073 | Notes, failure sentences, busy, Ctrl-C, stage row, live line, "Docker said", saved output, `--json`, exit statuses | `shared/`, `ui/`, `app/` |
| FR-042, 042a, 075, 077 | Read Dockerfiles; refuse reserved images, `ADD` of URLs; refuse Compose `build:` and reserved names | `dockerfile/`, `project/compose-build.ts` |
| FR-051 to 060b | Railpack pin, fetch, check, keep, run, plan, refusals, warnings | `railpack/` |
| FR-061 to 065 | Kept builds, "reused, nothing sent", rollback carries builds, refusals before signing | `ops/deploy.ts`, `shared/history.ts` |
| FR-066, 078 to 080 | Status rows, doctor rows, Railpack line | `ops/status-builds.ts`, `ops/doctor-builds.ts` |
| FR-072a | `PORT` for a built service with a port | `settings/compose.ts` |
| FR-074, 086, 087, 089b, 091 to 093 | Frozen transcripts, docs, Linux check for the CLI's parts, no package unasked, approved words | tests, `apps/web/content/docs` |

---

## Part 3. Design

### 3.1 New folders

No folder is named `build` (`.gitignore:24` ignores it). Each new folder is a subject, gets a mirror in `test/`, and is added to `LAYOUT`. All four go in `BASE`: they import nothing from `ops/`, `ui/` (but `ui/types.ts`), `app/`, `commands/`, `asking/`.

| Folder | Subject | Files (proposed) |
|---|---|---|
| `pack/` | What is sent: ignore rules, the walk, the secret-looking list, limits, the proposed `.dockerignore`, chunks and seals, the summary's facts | `ignore.ts`, `walk.ts`, `secret-looking.ts`, `limits.ts`, `propose.ts`, `chunks.ts`, `facts.ts`, `words.ts` |
| `dockerfile/` | Reading a Dockerfile as Docker reads it | `lex.ts` (directives, escape, continuation, heredocs), `instructions.ts`, `expand.ts`, `images.ts`, `args.ts`, `words.ts` |
| `git/` | Reading `.git` files, never running git | `find.ts`, `index-file.ts`, `objects.ts`, `changes.ts` |
| `railpack/` | The pinned Railpack: pin, fetch, check, run, plan | `railpack-release.json`, `release.ts`, `fetch.ts`, `kept.ts`, `run.ts`, `plan.ts`, `words.ts` |

The tar writer and the pack's reader-checker belong in `packages/core` (`pack/` there), so the CLI and the runner share one form. That is the core map's to place.

### 3.2 Choosing files as Docker would (FR-013 to 019)

**The root** is the folder sent: `source.root` resolved from the settings file's folder, `.` by default (3.6).

**The ignore file**, as BuildKit chooses it: `<dockerfile>.dockerignore` beside the Dockerfile (for `docker/web.Dockerfile`, `docker/web.Dockerfile.dockerignore`), else `.dockerignore` at the root. Read once from one open file inside the root, at most 1 MiB. For Railpack, only the root's `.dockerignore`.

**Reading the file**, as `moby/patternmatcher/ignorefile.ReadAll`:

1. Drop a UTF-8 byte order mark on the first line.
2. A line whose first character is `#` is a comment. This is checked before trimming, so ` #x` is a pattern.
3. Trim white space at both ends. Skip an empty line.
4. A leading `!` makes an exception; trim again after it.
5. Clean the pattern as Go's `filepath.Clean` does (collapse `//`, drop `.` parts, fold `a/..`), then drop one leading `/` when the pattern is longer than one character.
6. A line longer than 64 KiB is refused, as Docker's scanner refuses it.

**Matching**, as `patternmatcher` compiles a pattern to a regular expression and as `MatchesOrParentMatches` applies it:

- `*` is any run of characters but `/`; `?` is one character but `/`; `**` is any run of folders, `**/` at the start included, and a trailing `**` matches everything below.
- `\` escapes the next character. `[` and `]` pass through as a regular-expression class. A class zekno cannot turn into the same JavaScript class (a POSIX class such as `[[:alpha:]]`, or anything Go's syntax reads differently) is refused before signing, with the line's number. zekno never guesses a pattern.
- Patterns apply in order. An exception is tried only once the path matched; a plain pattern only while it has not. A pattern also matches when it matches one of the path's parent folders. So the last pattern that matches wins.
- **The walk**, as BuildKit's `fsutil` walker skips folders: an excluded folder is not entered, unless an exception pattern starts with that folder's path followed by `/`. Then it is entered and each entry is judged.

**Always sent**: the Dockerfile and the ignore file in use, even when a pattern lists them (Docker sends both, spec edge case). One difference stays and is documented: from a tar, `COPY . /app` on the server also copies them, which a local `docker build` does not.

**Entries**, judged with `lstat`, never following a link:

| Entry | Sent? | Listed as |
|---|---|---|
| Regular file | yes, mode `0755` when the owner may run it, else `0644` | sent |
| Folder | yes, mode `0755`, even when empty | sent |
| Symbolic link | never (FR-014) | left out: "a link" |
| FIFO, socket, device | never | left out: "not a file" |
| `.git` at any depth, file or folder | unless `source.include` names it | left out: zekno's own rule |
| Secret-looking (below) | only when named and agreed on this machine | left out: "looks like it holds secrets" |

**The secret-looking list** (FR-015). The spec's list: `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`, `.git-credentials`, and files whose name or content marks a private key. Proposed additions (the plan may add): `.envrc`, `.pypirc`, `.dockercfg`, `.docker/config.json`, `.aws/credentials`, `.kube/config`, every file inside a `.ssh` folder, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.p12`, `*.pfx`. By content: a file of at most 64 KiB holding `PRIVATE KEY-----` after `-----BEGIN` (RSA, EC, OpenSSH, PKCS 8, encrypted, a cloud service-account JSON), `-----BEGIN PGP PRIVATE KEY BLOCK-----`, or starting `PuTTY-User-Key-File-`. A larger file is not read for this; the docs say the list is a convenience, not a guarantee.

**Names**: valid UTF-8, no control character, each part at most 255 bytes, the whole path at most 4,096 bytes; else C7 with the place, cleaned. Names are packed as they are on disk (no Unicode normalisation).

**Two passes.**

- *Pass 1*, before anything is shown: the walk, the ignore rules, the list (reading only files of at most 64 KiB for content), counts and sizes from `lstat`. The tar's exact size is a function of names and sizes, so the limits are checked here: 512 MiB (C1), 50,000 entries counted as files and folders sent (C2), the warning above 100 MB (B12), the largest top-level folders by bytes and by entries. An empty pack is C3 or C4. The first-deploy question uses pass 1 only.
- *Pass 2*, before signing: each file opened with `O_NOFOLLOW`, held to a regular file, read once, its `fstat` size and mtime compared with pass 1 and again after the read. Any difference is C6; a read fault is C5 (FR-019). The bytes stream into the tar writer, the pack hash, the git blob hash when 3.5 needs it, and the chunker.

### 3.3 Packing, sealing, uploading (FR-016, 020, 026, 029, 029a, 030; point 8)

- **The form** (core): ustar, entries sorted by the UTF-8 bytes of their path, a folder entry with a trailing `/`, a pax `path` record only for a path longer than 100 bytes, owner 0/0, empty owner names, mtime 0, the end's two zero blocks and nothing after.
- **Fingerprint**: `hash("zekno/v1/pack", tar bytes)`, streamed (1.11).
- **Chunks**: the tar cut into 8 MiB pieces; each compressed with zstd level 3 (`Bun.zstdCompressSync`, ran), then sealed for the server's key from the signed team list (core's sealing); each chunk's hash is `hash("zekno/v1/pack-chunk", sealed bytes)`.
- **Where the sealed chunks wait**: in `~/.zekno/tmp/<random>` (mode 600), written once, deleted in a `finally` when the deploy ends, and the whole `tmp/` swept at the start of each deploy. They are sealed for the server, so a leftover is readable by nobody else. No plaintext copy is ever written (FR-020).
- **Two services, one folder**: one pack, sealed once; both builds name the same chunks, so the code travels once (FR-012). Two roots give two packs.
- **Sending**: after the runner refuses the signed deploy with the missing chunks (core names the refusal), zekno sends one `pack` request per missing chunk, base64url on one line (about 11 MiB per 8 MiB chunk, under the 32 MiB line limit), writing the line in 64 KiB pieces with the awaited `send`, as the installer does (`server/install/install.ts:43-51`). Then the same signed deploy again. Chunks the runner still lacks are sent again in the same run only.
- **Progress** (D2, D3): the plaintext bytes of the chunks the runner acknowledged, plus the share of the current chunk's line written to SSH. It is approximate, since SSH buffers.
- **Ctrl-C or a dropped connection during the upload**: no number is used. A new run seals again, so every chunk hash differs and everything is sent again. So D14's "it sends only what prod-1 lacks" is not true across runs (risk 4).

### 3.4 Reading a Dockerfile (FR-036a, 042, 042a, the refusals)

What zekno needs from the file, and nothing more: the directives, the stages, every `ARG` name, every image named, every `ADD` source, every `EXPOSE`. It refuses what it cannot resolve fully.

**Lexing**, as BuildKit's `frontend/dockerfile/parser`:

- *Directives*: at the very top, lines `# key=value` (key case-insensitive), until the first line that is not one. Known: `syntax`, `escape`, `check`. A repeated directive is refused. `# syntax=` is noted for B15 and changes nothing else (the server ignores it).
- *Escape*: `\` or `` ` `` by `# escape=`.
- *Lines*: a line ending with the escape character (after trailing white space) continues. Comment lines and empty lines inside a continuation are dropped.
- *Heredocs*: for `RUN`, `COPY` and `ADD`, each `<<WORD`, `<<-WORD`, `<<"WORD"` or `<<'WORD'` takes the following lines up to a line equal to `WORD` (tabs stripped for `<<-`). Their bodies are never read as instructions.
- *Bounds*: the file at most 1 MiB, 20,000 lines; else refused with a sentence.

**Instructions read**:

| Instruction | What zekno takes |
|---|---|
| `ARG a[=x] b[=y]` before the first `FROM` | global names and defaults |
| `ARG` in a stage | the stage's names and defaults; every name counts for FR-036a, in any stage |
| `FROM [--platform=…] ref [AS name]` | the stage, its base: an earlier stage (case-insensitive) or an image |
| `ENV` (both forms) | the stage's environment, inherited by `FROM <stage>` |
| `COPY --from=x` | a stage name or index, else an image |
| `RUN --mount=…,from=x` (CSV with quotes) | the same, for any mount type |
| `ADD [--checksum=…] src… dest` (shell or JSON form) | each source but the last argument |
| `EXPOSE p[/proto] …` | ports of the chosen stage and the stages it is built from |
| `ONBUILD …` | ignored: it runs in other builds |

**Expansion**, as BuildKit's shell lexer: `$V`, `${V}`, `${V:-w}`, `${V:+w}`, `${V-w}`, `${V+w}`, quotes and the escape character. Any other form (`${V#p}`, `${V%p}`, `${V/p/r}`, `${V:?e}`) in a place zekno must resolve makes the name unresolvable.

- `FROM` sees the global `ARG`s, the plain variables given to the build (FR-036a), and the platform `ARG`s (`TARGETPLATFORM`, `TARGETOS`, `TARGETARCH`, `TARGETVARIANT`, `BUILD*`). zekno resolves the name twice, for `linux/amd64` and for `linux/arm64` (the only servers the runner supports), so it needs nothing from the server.
- `COPY --from`, `--mount from=` and `ADD` see the stage's `ARG`s and `ENV`. A variable that the base image might define (one not set by an `ARG` or `ENV` of the file's own chain) is unresolvable.

**The rules**:

- *Reserved images* (FR-042, C10): a resolved image reference whose registry host is `zekno.invalid`, compared without letter case and without a port, is refused. An unresolvable name in any image place is C11.
- *Image references*: parsed by Docker's reference grammar (in the project). A string that is neither a stage nor a valid reference is refused. `scratch` is no image.
- *Digests* (B14, H3): a base image without `@sha256:` gets the warning.
- *`ADD`* (FR-042a): a source is remote when it has `scheme://`, is SCP-like (`user@host:path`), or starts with `github.com/` (BuildKit's old git form; to confirm in the Linux check). Remote with no `--checksum`: C12. A remote source whose host is `localhost`, a name ending `.localhost`, a single label (`http://redis/`), the server's SSH host name or its address (`domains/server-address.ts`), or an IP literal that `domains/ip.ts` `isPublicAddress` rejects: C13, checksum or not. A public name that the server's own DNS turns into a private address is not caught; the docs say so.
- *Stages*: `build.stage` must name a stage (C18).
- *`ARG` names* (FR-036a): every `ARG` instruction outside heredocs and `ONBUILD`. The build is given the service's plain variables whose names are among them, minus the names zekno keeps or the builder reads as its own (FR-036b: the core library's reserved names, plus `SOURCE_DATE_EPOCH` and the platform names), minus the app's secrets (FR-036e). Limits: 32 per build, 4 KiB each, 64 KiB per deploy (C14 to C16).
- *Port* (A8): the first port of `EXPOSE` in the chosen stage's chain, with its `ARG` defaults; none when none or unresolvable.

**Testing the reader against Docker itself**: in the Linux check (FR-089b), each fixture is also given to real BuildKit: `docker buildx build --call=targets` for stages, and a build of `FROM scratch` plus `COPY . /` exported with `--output type=local` to compare the file list with zekno's pass 1. These calls run only in the check, never in zekno or the runner.

### 3.5 The uncommitted-changes line, read from `.git` (FR-017a)

zekno never runs `git`. Running it could run programs the repository names: `core.fsmonitor`, and clean filters from `.gitattributes` with `filter.<name>.clean` in its config. zekno reads files only.

**How**:

1. *Find the repository*: from the folder sent, walk up to the first folder holding an entry `.git` (at most 64 levels). A `.git` folder is the git folder. A `.git` file (`gitdir: <path>`, at most 4 KiB) names it, relative to the file's folder; a `commondir` file there names where refs and objects are. No `.git`: the line is left out.
2. *Give up* (line left out) when `config` (at most 64 KiB, read as plain `key = value` lines) sets `extensions.objectFormat` or `extensions.refStorage`, or `core.bare = true`; when the index's version is not 2, 3 or 4; when the index has a `link` (split index) or `sdir` (sparse) extension; when anything is malformed or past a bound (index 128 MiB, 1,000,000 entries, an object 16 MiB inflated, delta depth 64, 2 seconds in all).
3. *HEAD*: `HEAD` names a branch (`ref: refs/heads/x`), found as a loose ref file or in `packed-refs`, or holds a commit id. A branch with no commit yet: every file sent is new, so the line shows.
4. *Working files against the index*, for paths under the folder sent only:
   - a file sent with no stage-0 entry: changed (a new file sent; a conflict too);
   - an entry flagged assume-unchanged or skip-worktree: unchanged, as `git status` treats it;
   - an entry whose mode is a link or a submodule while a file is sent: changed;
   - size, mtime (seconds and nanoseconds) and the executable bit equal to the entry, and the mtime older than the index file's own: unchanged (git's racy rule);
   - otherwise the git blob id (`SHA-1("blob <size>\0" ‖ bytes)`) of the bytes zekno reads is compared with the entry's: different means changed;
   - a file entry whose file is gone, and that the ignore rules would not leave out: changed.
5. *The index against HEAD* (staged): HEAD's commit gives its tree; walk down to the folder sent's path. Where the index's `TREE` extension has a valid entry for a path, compare ids. Where it is invalid, walk HEAD's subtree and compare each blob id and mode with the index entries. Objects come from loose files (`objects/xx/…`, zlib, ran) or packs (`.idx` version 2 and `.pack`, with offset and reference deltas).
6. Any change in 4 or 5 shows the line once. It never stops the deploy and never changes what is sent.

**Not detected** (the line is left out, or says less): SHA-256 repositories; reftable refs; split or sparse indexes; objects behind `objects/info/alternates`, or missing in a partial clone; files changed inside a submodule; changes git itself hides (assume-unchanged, skip-worktree); a repository past the bounds or the 2 seconds.

**Said too often**: a file that git rewrites on checkout (Git LFS, end-of-line conversion), once its mtime changed, reads as changed, since zekno runs no filter. A file `.gitignore` lists but `.dockerignore` does not (build output such as `dist/`) is new and sent, so the line shows at every deploy. That is what FR-017a asks; the docs say so.

### 3.6 The settings' Build section, names under choice G-a (a)

```json
"web": {
  "source": { "root": ".", "include": ["certs/server.key"] },
  "build": { "builder": "dockerfile", "dockerfile": "Dockerfile", "stage": "runner",
             "timeout": 3600, "network": "internet", "secrets": ["NPM_TOKEN"] },
  "networking": { "port": 3000 }
}
```

| Set name | Place | Rule | Signed as | Not set |
|---|---|---|---|---|
| `root` | `source.root` | relative, `/` between parts, only `.`, a folder inside, or `..` parts up to the git top (FR-009) | decides the pack | `.` |
| `include` | `source.include` | relative paths inside the root, at most 64 | decides the pack | none |
| `builder` | `build.builder` | `dockerfile`; `railpack` from step 2 (G20, F5) | builder | required with `build` |
| `dockerfile` | `build.dockerfile` | relative to the root (3.9, point 5), inside it, at most 255 characters | `dockerfile` | `Dockerfile` |
| `stage` | `build.stage` | `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$` (core's `target`) | `target` | last stage (`null`) |
| `build-timeout` | `build.timeout` | 1 to 7,200 seconds | `timeout` | 1,800 |
| `build-network` | `build.network` | `internet` or `none` | `default` or `none` | `internet` |
| `build-secrets` | `build.secrets` (step 1b) | secret names, unique, at most 32, no FR-037b name | `secrets` | none |

- A service has `source.image` or `build`, never both, never neither (FR-006, C25, C26). `root` and `include` without `build` are refused.
- Railpack: `dockerfile`, `stage` and `build-network` are refused (G21); `build-secrets` too (FR-037h, H16).
- `source.image` in `zekno.invalid` is refused (C29, FR-077).
- The schema stays pure text. The reach of `root` needs the disk, so it is checked by the reader right after `checkSettings` (`settings/file.ts:181`), in a new `settings/build-reach.ts`: the real path of the root must be the settings folder, inside it, or an ancestor not above the git top found as in 3.5 step 1; a link on the way that leads out is C23.
- `source.build` leaves `LATER`; a file that uses it gets SV6 like any unknown key. A zekno from before this feature reads the new `build` section as SV6 (F8) and `source.root` as SV6 (F9), as the spec wants.
- **Files to change**: `shape.ts` (a `BuildSchema`, `SourceSchema` with `root`, `include`, optional `image`), `types.ts` (`ServiceSettings.image?`, `build?`, `root?`, `include?`; `SettingPath` keys; section `"Build"`), `schema.ts` (`serviceOf`, `acrossSettings`), `change.ts` (`SINGLE`; setting `builder` on an image service, or `image` on a built one, is one change), `text.ts` (writes `source.root`, `source.include`, `build` in a fixed order), `write.ts` (`FIELDS` lists them, or the read-back check would not see them), `rows.ts` and `piped.ts` (a Build section), `compose.ts` (below). New words go to `settings/build-words.ts`; `words.ts` is already 633 lines.
- **Compose text of a built service** (G22): `image: "zekno.invalid/<app>:<key>"`, `pull_policy: "never"`, and `PORT` under `environment` when the service has a port and the settings do not set `PORT` (FR-072a). `composeText` takes a map from service to image reference, made by the deploy. `SETTINGS_LINES` and `inSettingsForm` learn the `pull_policy` line; `deployedSettings` reads a built service back.
- **"Changed, not deployed"**: the Compose text alone cannot give back a build's settings. `shared/history.ts` keeps each deploy's `builds`; `lastDeployed` (`ops/settings.ts:219`, and the app's twin) maps each build to its services by the key in their image name, giving builder, `dockerfile`, `stage`, network, timeout and secrets. `root` and `include` are not signed, so they get no "changed" mark.

### 3.7 The first-deploy flows

**`zekno deploy`, a folder with a `Dockerfile`, no settings file, no Compose file, at a terminal** (FR-002, A1 to A17). In `deployAtTerminal`, between the choice of file and the read (`asking/first-deploy.ts:277-279`), when the source is the default one, nothing names a file, and `compose.yaml` is absent: `firstBuild` (new `asking/first-build.ts`). It runs pass 1 (3.2) and the git line (3.5), reads the Dockerfile (port, several Dockerfiles A14), draws A1 to A6 and asks A7. On a build answer it writes `zekno.app.json` (with `createSettings`) and, when there is none, `.dockerignore`, then goes on with `source = settings here`. The question comes before the opening line, the key, the server and the app, and needs no keychain. `first-deploy.ts` is split first (the server connection to `asking/connect-server.ts`).

**No terminal** (FR-003, A16): unchanged. `prepareDeploy` reaches `readCompose`, which says today's sentence.

**The proposed `.dockerignore`** (FR-002b): the first line A6, then each line of the root's `.gitignore` turned into Docker's form, then `**/node_modules`, `**/.venv`, `.next` when present and not already covered. A `.gitignore` line with no `/` but at its end becomes `**/<line>`; a leading `/` is dropped; a trailing `/` is dropped (Docker has no folder-only form, so it also matches a file of that name); `!` lines keep their `!`; comments and empty lines are dropped. Nested `.gitignore` files are not read.

**`zekno settings init`** (FR-011, A18, G25): before IN1 (`commands/settings.ts:130`), the same question with "Run an image instead" last. Point 11 below adds the proposed `.dockerignore`.

**Railpack** (step 2, FR-060b, I1 to I8, I29): a folder with no `Dockerfile`, no settings file, no Compose file, at a terminal: I1 or I2 before anything is fetched or run; then fetch (3.11), pass 1 and 2 into a temporary copy, `railpack prepare`, I7, then I8, which writes the files with `builder: railpack`. No to I1 writes nothing.

### 3.8 The summary (FR-017, 017a, 018, 038, 042a, 059, 060a, 072 to 072c)

- **Facts** are made by one pure function (`pack/facts.ts`) from pass 1, pass 2, the Dockerfile reading, the settings, this machine's history and, once the session is open, the runner's answers. The words are in `pack/words.ts` and `shared/build-words.ts`.
- **Drawn** before the deploy panel, as a block (B1 to B11) with its warnings (`!`) and notes (dim), by a new Ui method `buildSummary` (`ui/types.ts`; ink in `ui/ink/build-summary.tsx`, modelled on `ui/ink/addition-report.tsx`). Plain output writes each fact as one sentence to standard error (B29): `info` writes to standard output, so it cannot be used. With `--json` the facts still go to standard error.
- **"Builds again because"** (B23, H7, I12, I30): known before the session from this machine's history, which then keeps each deploy's `builds` (args with values, secret names and hashes, plan fingerprint). A machine without that history leaves the reason out.
- **"Reused, nothing sent"** (D6, D7) and **"sent again"** are known only from the runner (3.9).
- **The yes questions** (B24 FR-015b, B26 FR-015a, H4 FR-037f) are asked after the block and before the session opens, so no SSH session waits on a person. The answers are kept in `profile/agreed.ts` (3.10).

### 3.9 The deploy session with builds

Order, with what is new in bold:

1. Read the settings; **read each Dockerfile; pass 1; the local refusals (C1 to C21, H10 to H16); pass 2 with the fingerprint; the summary block; the yes questions**.
2. Open the session; `version`; `chooseFormat` with **`BUILD_PROTOCOL` 6 (F1) and `RAILPACK_PROTOCOL` 7 (F2)**, and named secrets at whichever of the two ships step 1b (F3).
3. `status`; identity; `AppTaken`; domains.
4. **`build facts`**, a new request only for protocol 6 or more: Docker Engine version, build plugin, processor, free disk and the floor, and for each build key of this deploy whether the server keeps it. It is a new request because `version` and `status` are strict schemas, and an older zekno must still read them (FR-084). zekno stops before signing with F4, R14's words or G43 when it already knows.
5. `records`, the listing (a secret named for a build must be listed even when the running service does not read it, as core requires); **compute each build key** with core's `buildKey` and the listed hashes; **seal the chunks**; stage `checked`; sign with `builds`; record `sent`.
6. `deploy`; on the refusal that names missing chunks, **send them (3.3)**, then `deploy` again. The stage row shows `Sent` with D2 and D3 under it.
7. **Build events**: each builder line, with its service, becomes the live line (D4, D5) and goes to the saved output (3.10). `Building` is the stage between `Sent` and `Starting` (D1). Then `up`, routes and health as today.
8. The report: **`build_failed` with its reason, the failing step, its error and the last lines**, or as today. `DeployOutcome`, `ANSWERED` (`ops/deploy-send.ts:204-209`), the history enum (`profile/profile.ts:104-110`) and `numberUsed` gain `build_failed`.

**Asks of core and the runner** (for their maps): the `pack` request and its frame bound; the missing-chunks refusal naming indexes; `build facts`; build events with a service; `build_failed` with reason, step, error and last lines within the report's bound; `busy` with the building app, its seconds and its limit (E15); `low_disk` with the free space (R14); a streaming pack hash; the shared tar form; the names a build is never given (FR-036b, FR-037b); a plan fingerprint domain; where the Railpack plan travels (its own sealed piece, kept outside the code, FR-049).

**Ctrl-C at a terminal during the build** (D15): `send` (`commands/deploy.ts:51`) catches the signal once the `Building` stage began, says D15, and exits. A dropped connection gives D16. The build goes on on the server.

### 3.10 Remembered answers and a build's whole output

**`~/.zekno/agreed.json`** (`profile/agreed.ts`), written as `links.json` is (bounded, strict, whole file, mode 600, oldest dropped, unsigned for the same reason):

- FR-015b: the real path of the folder sent and of the settings file;
- FR-015a: the real path of the folder sent and the file's path inside it;
- FR-037f: server id, app, service and secret name.

`zekno settings set --yes` never writes it. No option writes it.

**A build's whole output** (FR-071a, point 23, choice E-b): at a terminal and in the app, each builder line is appended to `~/.zekno/builds/<server id>/<app>.log.<random>` (mode 600) as it comes. When the deploy ends, it replaces `builds/<server id>/<app>.log` by a rename. Its first line names the deploy, the server and the time. It is bounded to 32 MiB: past it the oldest lines are dropped and the count is said in that first line. Lines are kept as the runner sent them and cleaned when printed. With no terminal nothing is saved and the lines go to standard error as they come (D17). `zekno logs --build [--app] [--server]` prints it as plain lines (E16), or E17. It reads only this machine: no keychain, no server.

### 3.11 Railpack on this machine (FR-051 to 060b)

| Part | Design |
|---|---|
| Pin (FR-051, M3) | `railpack/railpack-release.json`, read by a strict schema as `version/runner-release.ts` does, listed in `DATA_FILES`. It holds the version; for `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`: the release file's exact name, its size, its SHA-256 from Railpack's `checksums.txt` (compared over two networks), and the SHA-256 of the `railpack` program inside it; the frontend's image and digest; each plan image's tag and digest. File names are to confirm at M3: the research saw `railpack-v0.43.1-arm64-apple-darwin.tar.gz` only. |
| Where from (FR-052) | `https://github.com/railwayapp/railpack/releases/download/v<version>/<file>`, through `deps.fetch` (set only in `main.ts`), `User-Agent: zekno`, no credentials, redirects only to an allow-list of GitHub's download hosts (to confirm at M3), at most the pinned size, at most 120 seconds. |
| Check (FR-052, 053) | The archive's SHA-256 against the pin before it is opened. Mismatch: deleted, nothing run, I20. Then only the entry `railpack` is taken (`Bun.Archive`, ran), its SHA-256 checked against the pin, written mode 700 through a temporary name and a rename. |
| Kept | `~/.zekno/tools/railpack/<version>/<system>/railpack`. Hashed again before each use (about 24 MB); a change gives I17 and a new fetch (FR-053). |
| Never another (FR-054) | Always this absolute path; never the search path. |
| Systems (FR-057) | Another system, or one whose pin is empty: I23 before signing. A folder with a Dockerfile still deploys. |
| Run (FR-055, 056) | On a copy of exactly the packed files in `~/.zekno/tmp/rp-<random>/code` (mode 700), deleted after. `railpack prepare <code> --plan-out <tmp>/plan.json --info-out <tmp>/info.json` (flags to confirm at M3), plus `--env NAME=value` for each plain variable given to the build, if FR-089a shows the plan needs them. Environment set whole: `HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `TMPDIR` under `~/.zekno/tools/railpack/home/`, `PATH=/usr/bin:/bin`, `LANG=C`; nothing from the person's environment (no `SSH_AUTH_SOCK`, no tokens). No standard input; output kept to 64 KiB; 120 seconds at most. |
| Secrets (FR-037h) | In step 2 a Railpack build that names a secret is refused (H15, H16), so no secret name reaches `prepare`. When it is lifted, each name gets the fixed stand-in value `zekno-stand-in`, never a value. |
| Plan (FR-059, 060) | Read at most 1 MiB, parsed within bounds. Each image tag must be in the pin, else I25; the tag is rewritten to its digest (R8). Written back in one canonical form (sorted keys, no spaces) so the same plan gives the same bytes on every machine. Its fingerprint is signed; the plan travels sealed. |
| Summary (FR-059, 060a) | I9 from `info.json` and the plan; I10; I14 from a fixed table of lockfile names per language, in zekno's words. |
| Plan changed (FR-059) | The last plan of each service is kept in `~/.zekno/plans/<server id>/<app>.json`, to say why (I12). Without it, only that it changed (I13), from the plan fingerprint in this machine's history. |
| Failures (FR-055, 058) | I21 when the fetch fails; I22 when Railpack cannot reach the network; I24 with Railpack's reason, cleaned. How zekno tells I22 from I24 depends on Railpack's output, to establish in FR-089a. |
| `zekno settings plan` (I-a) | Packs and runs Railpack as a deploy would, and prints the plan. |
| Doctor (FR-079) | G40, from the kept copy's hash. |

### 3.12 Rollback, status, doctor, logs

- **Rollback** (FR-063, 064, 064a, 065): `readDeployEntry` keeps `builds`; `sentDeploys` and `prepareRollback` carry them; the new deploy signs them as they were. Before signing: `build facts` says whether each key is kept (G43); each build secret's listed hash then is compared with the listing now (G45 set again, G46 removed). A rollback never uploads: a missing-chunks answer to a rollback ends with G43.
- **Status** (FR-045, 066, 080): a new `builds` request (protocol 6 or more, not inside the strict `status`) gives each app's builds and records. Rows G28 to G32 in `ops/status-builds.ts`.
- **Doctor** (FR-078, 079): `ops/doctor.ts` is split first; build rows go to `ops/doctor-builds.ts`. For a runner of protocol 6 or more, `build facts` gives Docker, the build plugin, processor, free disk and memory (G33 to G39). Runner 0.1.1 gives G36. The check script stays as it is. `--builds` checks every server; otherwise only servers holding a built app, known from this machine's history. Plain output for other servers is unchanged (US9 sc6).
- **Logs**: `--build` (3.10).
- **Help**: four lines appended (G26); `ADDED_TO_HELP` gains them; `help.json` is redrawn.

### 3.13 The full-screen app

- `app/effects/deploys.ts` is split (the build steps to `app/effects/deploy-build.ts`). Its plan path calls the same build preparation in `ops/` as the single command. A folder with a Dockerfile and no settings file says J10. The yes questions follow choice J-a: (a) the "Remember this folder?" panel with the summary (J12), or (b) J11.
- `DeployProgress` (`shared/deploy.ts:148-186`) gains: the upload's bytes, the service building, "reused", the build failure (lead, step, error, lines, total). `stagesOf` gains `Building`/`Built`/`Reused` (one function, so the command and the app agree).
- Deploy screen: the summary block where `PointedLines` stands (J4); the live line (J3); the failed build (J6, J7); the saved output written as in 3.10.
- App screen: `✖ build failed` (`app/screens/app.tsx:74-79`), the services row (J14).
- Settings screen: the Build section and `root` (J15 to J18) through `screenRows` and `settings-layout.ts`; `J19`'s words.

### 3.14 Tests

- Unit tests mirror the folders: `test/pack/`, `test/dockerfile/`, `test/git/`, `test/railpack/`, plus the changed `test/settings/`, `test/shared/`, `test/ops/`.
- `test/dockerfile/` and `test/pack/ignore` hold cases from Docker's own test tables, written from the documented grammar.
- `test/git/` builds repositories with a fixed object set written by the test (no `git` run at test time), plus fixtures with packs and deltas made once and checked in.
- Scenarios (`test/scenarios/build-*.test.ts`) run against the runner of this repository with its stand-in Docker, and stand-ins for Railpack's release (a fetch that returns a prepared archive) and for `railpack` itself.
- Real Docker: tagged tests and `tests/*.e2e.ts` with the Docker tag, run by the Linux check of FR-089b, with the differential tests of 3.4 and the macOS/Linux fingerprint of SC-013 (a checked-in fixture and its expected fingerprint).
- `test/version/never-fetches.test.ts`: `deploy` without Railpack still never fetches; a new scene shows a Railpack deploy fetches exactly the pinned address once; `.fetch` is allowed in `railpack/fetch.ts` too.
- `test/plain/plain-unchanged.test.ts`: only `ADDED_TO_HELP` grows. FR-074's exception gets its own test, with a Compose file that asks to build.
- `test/layers/layers.test.ts`: `LAYOUT`, `BASE`, `DATA_FILES`.

---

## Part 4. The reader of `.dockerignore` and Dockerfiles: in the project, or a package

| | Write it in the project | Add packages |
|---|---|---|
| What | `pack/ignore.ts` (about 150 lines) and `dockerfile/` (about 600 lines over five files), with tests | For `.dockerignore`: `@balena/dockerignore` (a port of Docker's matcher). For Dockerfiles: `dockerfile-ast` (the parser of the Docker language server). Neither was looked at again for this record; versions, upkeep and heredoc support are to confirm. |
| Exactness | Written to the rules of 3.2 and 3.4; refuses what it cannot reproduce. Checked against real Docker in the Linux check. | Whatever the package does. Still needs the expansion rules, the reserved-image check, the `ADD` rules and the refusals on top. Still needs the same differential tests. |
| Hostile input | Bounds written in (size, lines, depth, time), as the Compose and settings readers have. | Not written for it; bounds added around it. |
| Supply chain | None. | Code from outside runs in the program that holds the signing key, and every update needs review. |
| Fit | Bun, the project's habits (the JSON reader, the Compose writer and the tar writer are written in the project). | `dockerfile-ast` brings two `vscode-languageserver-*` packages. |
| Cost | More code and tests to write and keep in step with Docker. | Less to write, but reading and pinning code from outside. |

**Recommendation**: write both in the project, with no dependency. The reader is a security check (FR-042: refuse what cannot be resolved), only a small part of the grammar is needed, and the differential tests on real Docker catch drift. This is the maintainer's choice (FR-091).

The same choice for reading `.git` (3.5): write it in the project (about 400 lines), rather than `isomorphic-git` (a large package) or running `git` (refused by FR-017a's rule on programs the repository names).

---

## Part 5. The points of lines.md that fall to the plan

**4. `zekno settings compose` for a built service.** Decision: for a Dockerfile build with no build secret, it packs the folder (local, no network, no server) and prints the very text a deploy signs, as FR-011 asks. For a Railpack build, or one that reads a build secret, the key needs the network (Railpack's plan) or the server (the secret's listed hash). For those, recommended: the image line shows the key part as `<made at deploy>` and a note on standard error says why. Reason: the command has always worked offline with no server (`ops/settings.ts:420`). **Needs the maintainer**: it is an exception to FR-011's "byte for byte"; the other way is a command that reaches the network and the server.

**5. What `build.dockerfile` is relative to.** Decision: the folder sent. Reason: the signed field is a path inside the pack (`later-fields.ts:47-53`); Docker's `-f` with a tar, Compose and Railway read it that way; and a Dockerfile outside the folder sent cannot be built. No maintainer needed; C24 and G20 already say it.

**7. Values the runner does not send today.** Decision: the runner's `busy` refusal carries the building app, how many seconds it has built, and its limit, sent by a runner of protocol 6 or more, so zekno makes E15 (seconds, not a start time, so clocks need not agree). `low_disk` carries the free bytes and the floor (R14). A rollback to a build no longer kept is caught before signing from `build facts` (3.12), so G43 ends with "Nothing was signed."; the runner still refuses it if it changed since. Reason: each sentence needs a number only the server knows, and zekno stops before signing wherever it can. No maintainer needed for the mechanism; G43's last sentence changes on the board.

**8. "The plan changed since the app's last deploy".** Decision: this machine keeps the last plan of each built service (3.11). With it, I12 says why. Without it (a teammate's machine), zekno compares the plan fingerprint with this machine's history, or with what `build facts` reports of the deploy that runs, and says I13 without a reason. With neither, the line is left out. Reason: FR-059 says "why when it is known". No maintainer needed.

**10. Plain output of a failed build.** Decision: as E18. Standard output stays empty, as for a start that failed today (`shared/deploy.ts:389-390` writes the sentence with `error`); the lead goes to standard error, the builder's lines were already written there as they came, then the step and error as `remote` lines; exit status 1. With `--json`, the one object with `build_failed` and its reason. Reason: "today's result line" for a deploy that did not start is no line on standard output. No maintainer needed.

**11. `zekno settings init` and a proposed `.dockerignore`.** Decision: init proposes it too, in the same block and with the same yes, when the folder has none (A18 gains A5). Reason: a folder set up with init should not send `node_modules` at its first deploy (SC-001), and one rule for both flows is simpler. For the boards; no other maintainer step.

**12. A folder with only `Dockerfile.prod`.** Decision for the plan as the spec stands: it counts as having no Dockerfile (FR-004), ends with today's sentence in step 1 and goes to Railpack's question in step 2. At a terminal, one more dim line names the file and `build.dockerfile`. Recommended instead: list such files (`Dockerfile.*` and `*.Dockerfile` at the top) in A14, so the person chooses, which picks nothing silently. **Needs the maintainer**: it changes how FR-004 is read.

**13. Railpack's default port.** Decision: 3000 for every language, proposed in I8 and changeable there. zekno sets `PORT` to it (FR-072a), so an app that reads `PORT` works on any number. Reason: one number is predictable and easy to document; the docs name frameworks that ignore `PORT`. For the boards.

---

## Part 6. Risks

1. **Base images' `ONBUILD` triggers.** A base image from a registry can carry `ONBUILD COPY --from=zekno.invalid/blog:<key> …`. Those run in this build, and zekno cannot see them before signing. FR-042's check covers only the Dockerfile. It needs a runner-side answer, such as disabling `ONBUILD`, which is a direction (Needs the maintainer).
2. **Railpack may fetch and run other programs** (its version resolver) on the developer's machine. The checksum covers Railpack only. FR-089a should establish what `prepare` downloads and where; the fixed `HOME` and cache folders keep it in a known place.
3. **The history's strict outcome list.** Adding `build_failed` makes an older zekno on the same machine call that app's history "damaged", as `unhealthy` did in 015.
4. **D14's words.** "It sends only what prod-1 lacks" holds within one run only; a new run seals again. Either the words change, or sealed chunks are kept between runs, which FR-020 forbids.
5. **Reaching the network from `zekno deploy`.** The docs (`doctor.mdx:136`) and `never-fetches.test.ts` promise only `version` and `doctor` contact GitHub. Step 2 changes both.
6. **Divergence from Docker.** The ignore rules and the Dockerfile reader can drift from new Docker releases. The differential tests catch it only on the engines the Linux check runs.
7. **Files over 500 lines** (1.10) need splitting before the work, which adds churn to reviewed code.
8. **Memory and disk on the developer's machine.** Up to 512 MiB of sealed chunks are spooled to disk; a crash leaves them until the next deploy sweeps them.
9. **The uncommitted line's false positives** (LFS, end-of-line conversion, ignored build output) may teach people to ignore it.
10. **`build facts` is new protocol.** If the runner map chooses another shape, 3.9 to 3.12 change with it.

## Part 7. What this record could not settle

- Railpack's release file names, its redirect hosts, its `prepare` flags (`--info-out`, `--env`), its failure output, and whether its Linux file needs glibc. To confirm at M3, with the network.
- Whether `github.com/...` in `ADD` is still read as git by BuildKit 0.30.
- Whether BuildKit's `fsutil` walk rule is exactly the prefix rule of 3.2 for every exception pattern.
- Whether a downloaded Railpack runs on macOS without a quarantine prompt (`fetch` sets no quarantine flag, but this was not run).
- The exact protocol numbers for step 1b, decided when it ships (FR-081).
- How the runner reports a build's failing step and error, which decides E3's rows.

---

## For the plan

1. New CLI folders `pack/`, `dockerfile/`, `git/`, `railpack/`, each in `LAYOUT` and `BASE`; never `build/`.
2. The tar form and its checker live in `packages/core`, shared with the runner.
3. Files are chosen in two passes; limits and refusals come from pass 1, before any content is packed.
4. `.dockerignore` is read and matched as `patternmatcher` does, with `fsutil`'s folder skipping; an untranslatable pattern is refused.
5. `<dockerfile>.dockerignore` beside the Dockerfile wins over the root's; the Dockerfile and the ignore file are always sent.
6. Links, FIFOs, sockets and devices never travel and are listed; modes are `0644` or `0755`.
7. The secret-looking list adds `.envrc`, `.pypirc`, `.dockercfg`, `.docker/config.json`, `.aws/credentials`, `.kube/config`, `.ssh/*`, `id_*` key names, `*.p12`, `*.pfx`; content is read up to 64 KiB.
8. Each 8 MiB chunk is zstd level 3 then sealed; sealed chunks are spooled to `~/.zekno/tmp/` and deleted when the deploy ends.
9. Missing chunks are sent again within the run only; progress counts acknowledged chunks plus the line written.
10. The Dockerfile reader handles directives, escape, continuations, heredocs, `ARG`, `ENV`, `FROM`, `COPY --from`, `--mount from=`, `ADD`, `EXPOSE`, and resolves `FROM` for both server platforms.
11. A name in any image place that cannot be resolved fully is refused; `zekno.invalid` is matched without case or port.
12. `ADD` remote sources: URL, SCP-like, `github.com/`; private, local, single-label and the server's own hosts are refused with or without a checksum.
13. The uncommitted line reads `.git` files only, as 3.5 says, within 2 seconds, and is left out when it cannot tell.
14. Settings names as G-a (a), plus `source.include` (G-b (a)); `build.dockerfile` relative to the folder sent; defaults `Dockerfile`, last stage, 1,800 s, `internet`.
15. The reach of `source.root` is checked by the reader, after the schema, in `settings/build-reach.ts`.
16. `composeText` takes the built image names; `pull_policy: "never"` and `PORT` are written; `inSettingsForm` learns them.
17. The history keeps each deploy's `builds`, for rollback, "changed, not deployed" and "builds again because".
18. The first-build question runs in `asking/first-build.ts` before the opening line; `first-deploy.ts` is split first.
19. `zekno settings init` proposes the `.dockerignore` too.
20. The summary is a new Ui method; plain facts go to standard error, also with `--json`.
21. All yes questions are asked before the session opens; answers go to `~/.zekno/agreed.json`, never written by `--yes`.
22. Protocol 6 is building with a Dockerfile, 7 Railpack; a new `build facts` request and a new `builds` request, only for those runners.
23. `busy` and `low_disk` carry their numbers from protocol 6; a rollback to a build not kept stops before signing.
24. A build's whole output is saved to `~/.zekno/builds/<server>/<app>.log`, 32 MiB at most, read by `zekno logs --build`.
25. Railpack is pinned in `railpack/railpack-release.json` with the archive's and the program's SHA-256 for four systems, fetched through `deps.fetch`, checked before opening and before each use.
26. Railpack runs on a copy of exactly the packed files, with an environment set whole and no secret; its plan is rewritten to digests and written in one canonical form.
27. The last plan per service is kept on this machine to say why it changed.
28. Railpack's default port is 3000.
29. A failed build in plain output writes nothing on standard output and exits 1.
30. `ops/doctor.ts` and `app/effects/deploys.ts` are split before build rows and steps are added.
31. Help gains four lines; `ADDED_TO_HELP` and `help.json` follow; `never-fetches` allows `railpack/fetch.ts`.
32. Differential tests against real BuildKit (file lists, stages) and the macOS/Linux fingerprint run in the Linux check.

## Needs the maintainer

1. **Reading `.dockerignore` and Dockerfiles**: write it in the project (recommended) or add `@balena/dockerignore` and `dockerfile-ast` (part 4).
2. **Reading `.git`**: write it in the project (recommended), add `isomorphic-git`, or run `git` (not recommended, against FR-017a).
3. **Railpack's pin**: the version, the four files, their checksums and the redirect hosts (M3).
4. **Proxy variables for Railpack**: pass `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` to `railpack prepare`, or none (recommended: none in step 2, since a proxy address can hold a password, FR-056).
5. **`zekno settings compose` for Railpack and build secrets** (point 4): a marked placeholder (recommended), or reaching the network and the server.
6. **A folder with only `Dockerfile.prod`** (point 12): list such files in the first question (recommended), or keep FR-004's reading.
7. **D14 and FR-020** (risk 4): change D14's words (recommended), or keep sealed chunks between runs.
8. **Base images' `ONBUILD` triggers** (risk 1): a runner-side rule, such as disabling them, which changes what some Dockerfiles do.
9. **`zekno deploy` reaching GitHub** in step 2: the docs' promise and the test change (risk 5).
