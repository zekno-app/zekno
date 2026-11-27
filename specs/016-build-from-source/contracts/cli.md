# Contract: the CLI (`apps/cli`)

For FR-001 to FR-020, FR-021a, FR-025, FR-034a, FR-036 to FR-037h, FR-042, FR-042a, FR-045, FR-051 to FR-060b, FR-063 to FR-065, FR-070 to FR-082. The words of every line are `design/lines.md`'s and the boards', approved on 2026-11-27 (M2); the new lines of the plan's item 23 are drafts, shown to the maintainer before their screens are built. This file says when each is said. Line numbers below (A1, B1, …) are `lines.md`'s. The code as it was, with file and line: [research/map-cli.md](../research/map-cli.md). Shapes: [core.md](./core.md). "Item N" is an item of the plan's "Needs the maintainer", decided on 2026-11-27 as recommended; where a check settles an item's branch, the rule names the check.

## CL1. The settings' Build section

Fields, rules and defaults: [data-model.md](../data-model.md), "The settings' Build section".

- **Keys of `zekno settings set` and `unset`**: `<service>.root`, `.include` (comma-separated, the whole list), `.builder`, `.dockerfile`, `.stage`, `.build-timeout`, `.build-network`, and from step 1b `.build-secrets` (comma-separated). `set <service>.builder dockerfile` on a service that runs an image replaces the image in one change line, and `set <service>.image <ref>` on a built service replaces the build (FR-011). `unset <service>.builder` and `unset <service>.image` on the service's only one are refused (G17, G16).
- **Values refused by `set`, exit status 2** (FR-071b): G20's forms (a builder, a Dockerfile path outside the folder sent, a stage, a time limit, a network, a root directory beyond its reach or through a link out), G21 (Railpack and `none`), H11 (credential name), H14 (more than 32), H16 (a secret for Railpack), and a G20 form for an image under `zekno.invalid` (item 23). C22 to C29 are the lines for a file that cannot be read as settings, said when the file is read (at deploy, `zekno settings`, `compose`), never by `set`. Whether a build secret is a secret of the app is checked at deploy, exit status 1 (FR-037a).
- **Rows**: a Build section between Source and Deploy (G9, J16); `root` under Source (J15); values as G10. Piped: one line a setting, `<service><TAB><key><TAB><value>` (G11). `--json`: the same facts. Only the settings that are set, as today.
- **Reading**: `source.build` leaves the "later" list; the reach of `root` is checked right after the schema (`settings/build-reach.ts`), through real paths, with the git top found as CL4 finds it. A file read by a zekno of step 1 naming `railpack`: F5, before signing, exit status 1.
- **The Compose text** of a built service (G22): `image: "zekno.invalid/<app>:<key>"`, `pull_policy: "never"`, and `PORT` under `environment` when the service has a port and does not set `PORT` (FR-072a). `composeText` takes the map from service to image name made by the deploy. `inSettingsForm` and `SETTINGS_LINES` learn `pull_policy`; `deployedSettings` reads a built service back.
- **`zekno settings compose`** (item 18 (a), as the plan words it): for a Dockerfile build with no build secret, it packs the folder (no network, no server) and prints the text a deploy signs, the key made with `fresh` null, and one line on standard error says that a fresh build made from any machine changes the key. For a Railpack build, a build with secrets, or a build whose base key this machine's history shows with a fresh generation, the image line shows `zekno.invalid/<app>:<made at deploy>`, and one line on standard error says why. Those are the only exceptions to "byte for byte" (FR-011).
- **"Changed, not deployed"**: compared with the builds this machine's history keeps for the latest accepted deploy, mapped to services by the key in their image names. `root` and `include` are not signed and get no mark.

## CL2. Choosing what is sent (FR-013 to FR-019)

- **The root** is `source.root`, resolved from the settings file's folder. A root that is, or holds, the person's home folder or zekno's own folder (`ZEKNO_HOME`, else `~/.zekno`), compared by real path, is refused before signing with a line that names `source.root` (item 23): where the home folder is itself a git repository (dotfiles kept in git), a cloned settings file could otherwise reach it, and a `.dockerignore` narrow the pack to small credential files not on the secret-looking list. zekno's own folder is left out of every pack, whatever the ignore rules say.
- **The ignore file** as BuildKit picks it: `<dockerfile>.dockerignore` beside the Dockerfile, else `.dockerignore` at the root; for Railpack only the root's. One open file inside the root, at most 1 MiB, lines at most 64 KiB.
- **Reading it**, as Docker's `ignorefile.ReadAll`: a byte order mark dropped; a line starting `#` is a comment (before trimming); trimmed; empty lines skipped; `!` makes an exception; the pattern cleaned as Go's `filepath.Clean`; one leading `/` dropped.
- **Matching**, as Docker's `patternmatcher`: `*`, `?`, `**`, `\` escapes, classes. A class zekno cannot reproduce exactly (a POSIX class, or one Go reads differently) is refused before signing with its line, never guessed. The last pattern that matches a path or one of its parents wins. An excluded folder is not entered unless an exception starts with its path and `/`.
- **Always sent**: the Dockerfile and the ignore file in use, even when a pattern lists them.
- **Entries**, by `lstat`, never following a link: a regular file (mode 0755 when its owner may run it, else 0644); a folder (0755, sent even when empty). A link, a FIFO, a socket or a device: never sent, listed as left out. `.git`, at any depth, unless `source.include` names it; `.git`, or a path under it, named in `source.include` is on the secret-looking list (FR-015 lets the plan add to it): it holds the whole history, secrets committed and deleted since among it, and its `config` often holds a token in a remote's address. A secret-looking file unless named and agreed to (CL5).
- **The Dockerfile's name**: the entry the walk finds for `build.dockerfile` must equal the setting byte for byte. On a system that ignores case (macOS), a file `dockerfile` does not stand for a setting `Dockerfile`: C20. The runner refuses a pack without the exact entry (RB4).
- **The secret-looking list**: `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`, `.git-credentials`, `.envrc`, `.pypirc`, `.dockercfg`, `.docker/config.json`, `.aws/credentials`, `.kube/config`, every file in a `.ssh` folder, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.p12`, `*.pfx`; and by content, in a file of at most 64 KiB, `-----BEGIN` followed by `PRIVATE KEY-----`, `-----BEGIN PGP PRIVATE KEY BLOCK-----`, or a start of `PuTTY-User-Key-File-`. A convenience, not a guarantee; the docs show the list.
- **Names**: valid UTF-8, no control character, and a name the pack's form can hold, by core's `splitsAsUstar` (CO5), a folder's trailing `/` counted (item 16); packed as on disk. Else C7, cleaned, with its place, in its form for that case.
- **Pass 1**, before anything is shown: the walk, the rules, the list, sizes from `lstat`. Limits come from it: 512 MiB (C1), 50,000 entries (C2), the warning above 100 MB (B12), the largest top-level folders by bytes and by entries. An empty pack is C3 or C4. The first question uses pass 1 only.
- **Pass 2**, before signing: each file opened with `O_NOFOLLOW`, held to a regular file, read once, its size and time compared with pass 1 before and after the read. A difference is C6; a read fault is C5. The bytes stream into the tar writer, the pack's hash, the git blob hash when CL4 needs it, and the pieces.

## CL3. Reading a Dockerfile (FR-036a, FR-042, FR-042a)

Item 8 (a): written in `dockerfile/`, with no dependency.

- **Lexing**, as BuildKit's parser: directives at the very top (`syntax`, `escape`, `check`, any case; one repeated is refused); the escape character; continuations; comment and empty lines inside them dropped; heredocs of `RUN`, `COPY` and `ADD` (`<<WORD`, `<<-WORD`, quoted forms) never read as instructions. At most 1 MiB and 20,000 lines. Apart from the lexer, core's `isSyntaxLine` (CO6) is applied to every line of the file, wherever it stands, as the runner applies it (RB4): a `# syntax=` comment after the first instruction, which BuildKit reads as a comment, is still found, so zekno never signs a file the runner refuses.
- **Read**: `ARG` before the first `FROM` and in each stage; `FROM [--platform=…] ref [AS name]`; `ENV` in both forms; `COPY --from`; `RUN --mount=…,from=`; `ADD [--checksum=…]` sources; `EXPOSE`. `ONBUILD` lines are not run here (item 17).
- **Expansion**, as BuildKit's shell lexer: `$V`, `${V}`, `${V:-w}`, `${V:+w}`, `${V-w}`, `${V+w}`, quotes, the escape character. Any other form, or a variable a base image might define, in a place zekno must resolve makes the name unresolvable. `FROM` is resolved twice, for `linux/amd64` and `linux/arm64`, with the global `ARG`s, the plain variables given to the build, and the platform names.
- **Refused before signing, exit status 1**: an image under `zekno.invalid`, any case, any port (C10); a name in any image place that cannot be resolved fully (C11); a remote `ADD` (a scheme, an SCP-like address, or `github.com/…`) with no checksum (C12); a remote `ADD` whose host names the server itself or a private address, checksum or not (C13, below); a stage `build.stage` does not name (C18); a line `isSyntaxLine` matches, if check L2 settles item 11 as (a) (a new line in place of B15), and, whatever L2 shows, in a build whose `build.secrets` is not empty (a new line, item 23).
- **C13's set, exactly**: after one pair of brackets and one trailing dot are removed from the host, it is refused when it is `localhost` or ends `.localhost`; is a single label; is the server's own name or address as zekno knows it; is an address in `0.0.0.0/8`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (cloud metadata at 169.254.169.254), `100.64.0.0/10` (metadata at 100.100.100.200 among it), `::`, `::1`, `fc00::/7`, `fe80::/10`, or the IPv4-mapped (`::ffff:a.b.c.d`) or IPv4-compatible (`::a.b.c.d`) form of any of these; or is made only of numeric labels (digits, or `0x` with hex) and is not a plain dotted-decimal address with no leading zero, such as `0177.0.0.1` or `0x7f.1`, which a resolver may read as an address. The check is lexical: a name that resolves to such an address on the server, and a redirect from a public address, are not caught. The docs say so, and that the checksum (C12) is what holds a fetch to its content.
- **Warned in the summary**: a base image without a digest (B14; H3 when the build reads a secret); a `# syntax=` line in a build without secrets, if check L2 settles item 11 as (c) (B15).
- **The build's plain variables**: the service's plain variables whose names any `ARG` declares, minus CO6's names (B16, B17) and the app's secrets (B18, B19). Limits: 32 per build (C14), 4 KiB a value in bytes (C15), 64 KiB per deploy (C16).
- **The port**: the first `EXPOSE` of the chosen stage's chain, with `ARG` defaults; none when none or unresolvable.
- **Checked against BuildKit** in the Linux check (L17): stages with `docker buildx build --call=targets`, and the file list of pass 1 against a `FROM scratch` build that copies the context out.

## CL4. The uncommitted-changes line (FR-017a)

Item 9 (a): `git/` reads files only, and never runs `git`.

1. From the folder sent, walk up at most 64 folders to an entry `.git` (a folder, or a file `gitdir: <path>` of at most 4 KiB; a `commondir` file there). None: the line is left out.
2. Give up, leaving the line out, when `config` sets `extensions.objectFormat` or `extensions.refStorage` or `core.bare = true`; when the index is not version 2, 3 or 4, or has a split or sparse extension; when anything is malformed or past a bound (index 128 MiB, 1,000,000 entries, an object 16 MiB inflated, delta depth 64, 2 seconds in all).
3. The working files under the folder sent against the index (size, time, executable bit; else the blob id of the bytes read), and the index against HEAD's tree (the `TREE` extension where valid, else HEAD's subtree from loose objects or packs).
4. Any difference shows B13 once. It never stops the deploy and never changes what is sent. Not detected: SHA-256 repositories, reftable refs, split or sparse indexes, alternates or partial clones, changes inside a submodule. Said too often: Git LFS and line-ending conversions, build output git ignores and Docker sends. The docs say both.

## CL5. The summary and the questions before signing

- **Facts** come from one pure function (`pack/facts.ts`). Shown at a terminal as a block above the deploy panel (B1 to B11, B20 to B23, D13; choice B-b), its warnings marked `!` (B12 to B19, H3), and two rows in the panel (B28). Notes of B8, B20, B21 and I15 show at the first deploy from the folder on this machine and again when what they say changes (choice B-a); rows and warnings show every time.
- **With no terminal, and with `--json`**: each fact is one sentence on standard error (B29), before anything is signed. Standard output keeps only today's result line, or the one JSON object.
- **"Builds again because"** (B23, H7, I12, I30): from this machine's history of the app's builds. Without that history the reason is left out.
- **The questions**, asked after the block and before the SSH session opens, so no session waits on a person:
  - B24: the first deploy that builds from this folder on this machine (FR-015b), when a settings file exists; in a folder with none, the first question's yes counts (FR-002).
  - B26: each secret-looking file `source.include` names, once per file (FR-015a); `.git`, or a path under it, once per entry, with a row saying it carries the repository's history and configuration (item 23).
  - H4 (step 1b): each build secret, once per secret, service, app and server (FR-037f); its block names each base image of that build without a digest (H4a).
  - No, Esc or Ctrl-C: B25, H6. With no terminal and no earlier yes: C19, H9, exit status 1, nothing signed.
- **Kept answers**: `~/.zekno/agreed.json` ([data-model.md](../data-model.md)). Never written by `--yes`, nor by any option.
- **The full-screen app** asks B24, B26 and H4 in the panel of "Remember this folder?" (choice J-a (a), J12).

## CL6. The first deploy in a folder with a Dockerfile (FR-002 to FR-005)

- **When**: at a terminal, `zekno deploy` with no `-f`, no link and no file named, in a folder with a `Dockerfile` at its top and neither `zekno.app.json` nor `compose.yaml`. It comes before the opening line and the questions about the key, the server and the app, and needs no keychain (`asking/first-build.ts`).
- **What it shows**: A1 to A6: pass 1's block, the settings file it would write, `PORT`, and the proposed `.dockerignore` when there is none (choice A-a), with the lines it writes (`**/node_modules`, `**/.venv`; A5's board shows them so, item 23). A line of the proposal that would leave out a path the Dockerfile copies by name is dropped, and a note names it.
- **Several Dockerfiles** (FR-004): A14 lists them, and also `Dockerfile.*` and `*.Dockerfile` at the top when no `Dockerfile` is there (item 19 (a)). The choice is written as `build.dockerfile` (A15).
- **The question**: A7 with A8 or A9 (choice A-b), A10, A11 for a port. A yes writes `zekno.app.json` (and `.dockerignore`) and says A12, then the deploy goes on from the settings file. `Don't build`, Esc or Ctrl-C: nothing written, `✖ Nothing was done.` (choice A-c (b)), exit status 1.
- **With no terminal, or `--json`** (FR-003): unchanged. Nothing written, fetched or run; today's sentence for a folder with no Compose file on standard error (A16), exit status 1.
- **`zekno settings init`** in the same folder: the same question with `This writes zekno.app.json.`, or `This writes zekno.app.json and .dockerignore.` when a `.dockerignore` is proposed (item 23, lines.md unclear point 11), and a last row `Run an image instead` (A18, G25).
- **A Compose file written by hand** that asks Docker to build, or names `zekno.invalid`: C8 or C9 before signing, exit status 1 (FR-075, FR-077). FR-074's stated exception. A settings file whose `source.image` is under `zekno.invalid`: C29.

## CL7. A deploy that builds

**Before the session**, in this order, each a stop with nothing signed unless marked a warning:

1. The source chosen and read; the settings checked whole, with the reach of `root`; the Compose rule of CL6.
2. `--fresh` on a deploy that builds nothing: C21.
3. For each built service: the Dockerfile there, its name on disk equal to the setting byte for byte (C20); when `build.dockerfile` is left out and the folder sent holds several Dockerfiles in FR-004's sense (a `Dockerfile` beside a `Dockerfile.*`, or one in a sub-folder that is sent), a new stop, exit status 1, that names them and `zekno settings set <service>.dockerfile <path>` (item 23), since FR-004 lets zekno choose none; CL3; more than 8 builds (C17). Step 2: CL10's steps for Railpack.
4. CL2's pass 1, the git line (CL4), pass 2 with the fingerprints.
5. The summary (CL5) and its questions.

**In the session**, in this order:

6. `version`; today's C7; then, only when the deploy builds: F1 below protocol 6; F2 for a Railpack build below 7; F3 for a build with secrets below `BUILD_SECRETS_PROTOCOL`. A deploy that does not build is not affected.
7. `status`, identity, the app taken, domains: as in 015.
8. When the deploy builds: `builder` (CO12). `docker_too_old`: F4 before signing (FR-034a). A build with secrets on a Docker newer than the runner's covered versions (item 12 (i)): its F line (item 23) before signing. `no_build_plugin` and `low_disk` are left to the runner (R13, R14), with no number used.
9. `builds` for this app (`apps: [app]`). **The fresh generation** each build signs for its base key is the newer of the one `builds` reports and the newest this machine's history holds for that server, app and base key, or `null` when neither has one. The runner's answer is not signed, and a deployer never takes a version from the runner's word alone (deploy-v2.md, part 4.5): an answer that left a generation out, or gave an older one, would make zekno sign the key of an image built before the fresh one (SC-019). When the runner reports none, or an older one than the history holds, the history's is signed and a new warning line says so (item 23). The summary's `builds` row says which generation is signed. From a machine without that history, the generation is the server's word; the docs say so. For a rollback, `check` with its keys: G43 (`gone`) or G44 (`changed`) before signing, ending `Nothing was signed.`
10. `records` and the listing, as today; a build secret must be listed even when the running service does not read it (H12, H13). Each key made with core's `buildKey` and the listed fingerprints. For a rollback, a build secret whose listed fingerprint differs from the one its key took: G45 (set again) or G46 (removed).
11. Seal the pieces (and plan pieces) for the server's key from the signed team list, into this run's own folder `~/.zekno/tmp/<random>/` (mode 700), deleted when the run ends. There is no single-instance lock (two terminals, or the app and a terminal, can run at once), so a run never empties `tmp/` itself: at its start it deletes only folders there older than 24 hours. Stage `checked`; sign with the builds; the history entry `sent`.
12. `deploy`. On `pack_missing`: send each named piece with `pack`, one line each, waiting for each answer (D2, then D3 for a second round), then `deploy` again with the same envelope. At most three rounds; then a new line (item 23), exit status 1. A rollback sends no piece: `pack_missing` to a rollback is G43 or G44 with "Nothing of it ran."
    - **`busy` with `building`** (another deploy builds, item 29 (a)): `builds` with `check` for this deploy's keys, then every piece of the builds not reported `kept` is sent with `pack`, which never waits for a build (FR-044). zekno then waits in the same run, with a live line (item 23), bounded by that build's remaining limit (`limit` less `seconds`), sending `deploy` again with the same envelope every 10 seconds; an answer other than `busy` goes on as above, with no second upload. When the bound runs out: E15, exit status 1. Ctrl-C while waiting: D14.
    - **A connection that drops while a `pack` is sent** (the number cannot have been used: `pack` uses none): zekno opens the session again, at most twice in the run, checks `version` and the server's identity as in steps 6 and 7, sends `deploy` with the same envelope, and sends only the pieces `pack_missing` lists (D3). Still failing: D14. A drop during `deploy` itself is D16 or D14 as today, since the number may have been used.
13. Events: `build` and `build_line` move the build stage and its live line (D1 to D7); each `build_line` is appended to the saved output (at a terminal and in the app), or written to standard error as `remote: <line>` as it comes (no terminal, D17). Then `up`, routes and health as today. The session accepts `build`, `build_line` and `build_error` from a `deploy` (`server/session-events.ts`, split from `server/session.ts`, CL14), and every text it hands on, `line`, `step` and `error`, has passed through `sanitize` before it is drawn or printed, as `progress` lines do today: a step can print OSC 52 (the clipboard), OSC 8 (links) or cursor sequences. The saved output keeps the raw text; `zekno logs --build` sanitizes it as it prints (CL9).

**The answer**:

| Outcome | Stage row | Lines | Exit status |
|---|---|---|---|
| `started`, every build reused | `✔ Reused` in place of `✔ Built` | D6 under the row; the result as today | 0 |
| `started`, built | `✔ Built` then as today | today's result; D9 after the first deploy of a settings file zekno wrote, for each built service with a port and no domain | 0 |
| `build_failed` | `✖ Building` | E1 to E13 by reason (E14 goes, item 23), then E3 to E6: the "Docker said" panel with `step` and `error` from `build_error` (choice E-a), the last 40 lines, E5's number line, E6 naming `zekno logs --build` | 1 |
| `start_failed`, `routes_failed`, `unhealthy` | `✔ Built`, then as in 015 | as in 015 | 1 |
| refused `pack_mismatch` | as a refusal today | R11 | 1 |
| refused `docker_too_old`, `no_build_plugin`, `low_disk` (to `deploy` or to a `pack`) | as a refusal today | R12, R13, R14 | 1 |
| refused `docker_unchecked` (item 12 (i)) | as a refusal today | its R line (item 23) | 1 |
| refused `busy` with `building`, once step 12's wait ran out | as a refusal today | E15 | 1 |
| refused `malformed` by a runner below protocol 6 for a deploy with builds | as a refusal today | F11 | 1 |

- **Ctrl-C at a terminal** during the upload, or while waiting for another app's build: D14 (its words change, item 23), no number used. During the build: D15, and zekno exits; the build goes on. A dropped connection during the build: D16. `zekno status` shows how it ended, a runner that restarted among the ways (G30; no deploy answers `runner_restarted`, so E14 goes, item 23).
- **With no terminal**: the summary's facts and the builder's lines on standard error; standard output keeps today's result line for `started` and nothing for a failed build; the lead of a failed build on standard error, then `step`, `error` and the lines as `remote:` lines (E18), each sanitized.
- **`--json`**: the one object on standard output, with the report as it came: `build_failed` carries `build.key` and `build.reason` (E19's draft reads `build.reason`).
- **The history** records `build_failed` as itself. `zekno status`, the app's list of deploys and a rollback treat it as a deploy that did not start.
- **A deploy that does not build** makes exactly today's requests and prints exactly today's lines.

**Options of `zekno deploy`**: `--fresh` (D-c (a)) asks for a fresh build of every built service: each build signs `fresh` equal to the deploy's own number (D12, D13). With Railpack, refused before signing until check R4 shows it holds (I26).

## CL8. Rollback (FR-063, FR-064, FR-064a, FR-065)

`zekno rollback` reads the deploy from this machine's history, as today, now with its builds, and signs them as they were. Before signing: CL7's steps 6 to 10 (F1 to F3; `builds` with `check`, G43 and G44; G45 and G46). It never packs and never uploads. A rollback to a deploy that did not build is as today. A rollback from a machine whose history lacks that deploy is as today.

## CL9. `zekno status`, `zekno doctor`, `zekno logs --build`

- **`zekno status`**: when the runner speaks protocol 6 or more, it also asks `builds` with no input, which names the apps that have builds, then `builds` with those apps in batches of 8 (CO12). For each built app: G28 under its line (`built <when> with <builder>`), G29 (the record, as the server's word), G30 (how its latest build ended: a dropped connection, a runner that restarted), G31 (step 2). Plain: one tab-separated `build` line a build (G32). `--json`: the runner's `builds` answers, merged. A server with no built app prints as today.
- **`zekno doctor`**: for each server whose runner speaks protocol 6 or more and holds a built app (from `builds` with no input), and for every server with `--builds`: `builder` with `usage`, then G33 to G39 (`Builds`, `Build disk`, `Disk`, `Memory`; choice G-c), and a line naming a build record that still runs when `stale` is not 0 (item 28 (b), a line of item 23). A runner below protocol 6 with `--builds`: G36. Step 2, on this machine once it fetched Railpack or with `--builds`: G40. Plain: G42's rows. A server with no built app and no `--builds`: as today (US9 sc6). `ops/doctor.ts` is split before rows are added.
- **`zekno logs --build [--app <app>] [--server <name>]`**: prints the saved output of the app's last build from this machine, as plain lines on standard output (E16), each passed through `sanitize` as it is printed (the file keeps the raw text); none saved: E17 on standard error, exit status 1. No keychain, no server. `--server` chooses among servers that hold an app of that name, since the output is saved per server.

## CL10. Railpack on this machine (step 2; FR-051 to FR-060b)

- **The pin**: `railpack/railpack-release.json`, read by a strict schema, listed in the layers test's `DATA_FILES`. A system with no entry: I23 before signing; a folder with a Dockerfile still deploys.
- **The fetch** (FR-052): `https://github.com/railwayapp/railpack/releases/download/v<version>/<file>` through `deps.fetch` (set only in `main.ts`), a fixed client name, no credentials, redirects only to the pinned hosts, at most the pinned size, at most 120 seconds. I5 while it runs, I6 when done (standard error with no terminal, I19). A failure: I21.
- **The check** (FR-053): the archive's SHA-256 against the pin before it is opened; a mismatch is deleted, never run, I20. Then only the entry `railpack` is taken (`Bun.Archive`), its SHA-256 checked, written mode 700 through a temporary name. Kept in `~/.zekno/tools/railpack/<version>/<system>/railpack`, hashed again before each use; a change is I17, then a new fetch. Never a Railpack the person installed, never the search path (FR-054).
- **The run** (FR-055, FR-056): on a copy of exactly the packed files in this run's own folder, `~/.zekno/tmp/<random>/railpack/code` (mode 700, deleted after); `railpack prepare` with the flags M3 confirms; the settings' start command when set; the plain variables when check R7 shows the plan needs them; an environment set whole (`HOME`, `XDG_*` and `TMPDIR` under `~/.zekno/tmp/<random>/railpack/home/`, new for each run and deleted after it, so one folder's run leaves nothing a later project's run reads; `PATH=/usr/bin:/bin`, `LANG=C`), nothing from the person's (item 20); no standard input; output kept to 64 KiB; at most 120 seconds. No network: I22. No plan: I24 with Railpack's reason, cleaned; at a first deploy its second way points to the docs, since no settings file exists yet.
- **What the run starts, writes and reaches** is check R16 (item 26), on the pinned version, on the Mac and on GitHub, with a benign fixture and a hostile one (a `mise.toml` with an `exec` template or `[env] _.source`, a `.tool-versions`, a `railpack.json` with commands). Any program it downloads is pinned under M3 as the archive is, or step 2 waits; any program the project supplies that it starts goes to the maintainer before step 2.
- **The plan** (FR-059, FR-060): at most 1 MiB read, then core's strict schema (CO15); `"unreadable"` stops with I25's form for it (item 23); each image tag must be in the pin (else I25) and is rewritten to its digest; written in one form; its fingerprint signed; sealed as its own piece. The summary shows I9 and I10, I11 when the settings' start command wins, I12 or I13 when it changed, I14 with no lockfile, I15, I16.
- **The first questions** (FR-060b): in a folder with no Dockerfile, no settings file and no Compose file, at a terminal: I1 (or I2 when kept) with I3, before anything is fetched or run; then I7 and I8, which writes the files with `builder: railpack` and a default port of 3000 (choice I-b). No: I4. With no terminal: nothing fetched or run, today's sentence. `zekno settings init`: I29.
- **`zekno settings plan`** (choice I-a): packs, runs Railpack as a deploy would, prints the plan JSON on standard output (G23). A Dockerfile build: G24, exit status 1.
- **Refused before signing**: a fresh build (I26), a build secret (H15), more than 32 plain variables (I27), `build.network` `none` (G21 at `set`); and, only if check R5 shows that buildx or the frontend reads `.git` outside the sandbox (RB8), `.git` named in `source.include`.
- **The network**: `zekno deploy` with Railpack reaches GitHub. `never-fetches.test.ts` allows `.fetch` in `railpack/fetch.ts` too, and shows that a deploy that does not need Railpack still never fetches.

## CL11. Exit statuses

| Status | When |
|---|---|
| 0 | `started` |
| 1 | every new stop before signing (C1 to C21, F1 to F5, G43 to G46, H9, H10, H12, H13, H15, I20 to I27, and the new stops of item 23); `build_failed`; every runner refusal, a `busy` whose wait ran out among them; `zekno logs --build` with nothing saved; `zekno settings plan` for a Dockerfile build; a declined first question |
| 2 | a value `zekno settings set` refuses (CL1), as other values are |

## CL12. The help and the options

- Help lines appended (G26; item 24): `zekno deploy --fresh`, `zekno logs --build [--app <app>] [--server <name>]`, `zekno doctor --builds`, and in step 2 `zekno settings plan`. No line of the help is edited, so each is written whole the first time.
- `--fresh` is accepted by `zekno deploy` only; `--build` by `zekno logs` only; `--builds` by `zekno doctor` only. On another command each is an unknown option.

## CL13. What older programs do

| Program | Meets | What happens |
|---|---|---|
| zekno 0.1.1 | a settings file with a `build` section | SV6, `a setting this zekno does not know` (F8), before signing |
| zekno 0.1.1 | `source.root` | SV6 (F9) |
| zekno 0.1.1 | `zekno settings set web.builder dockerfile` | today's list of settings (F10) |
| zekno 0.1.1 | a runner of protocol 6 or 7 | C7 before signing anything (F7) |
| zekno 0.1.1 | this machine's history with `build_failed` | calls that app's history damaged, as with `unhealthy` in 015 |
| zekno of step 1 | a settings file naming `railpack` | F5 before signing |
| zekno of step 1 | a runner of step 2 | C7, even for images |
| this zekno | runner 0.1.1 (`status`, `server add`, `doctor`) | F13, F14 |

## CL14. What must hold

- A deploy of an app that does not build makes no new request, no fetch, no file under `~/.zekno/tmp`, `builds/` or `agreed.json`, and prints exactly today's lines. `zekno status` and `zekno doctor` ask `builds` of a runner of protocol 6 or more and, when it holds no built app, print exactly today's lines. The frozen plain scenes pass unchanged; only `ADDED_TO_HELP` grows. FR-074's exception (C8, C9) and item 21's (C26, G16, G18) have their own tests; no frozen scene holds any of them.
- `pack/`, `dockerfile/`, `git/` and `railpack/` are in the layers test's `LAYOUT` and `BASE`. Screens and `ui/` load neither the profile nor the core library.
- No file over 500 lines is made longer: `ops/doctor.ts`, `settings/words.ts`, `asking/first-deploy.ts` and `server/session.ts` (487 lines; its event kinds and `clean()` move to `server/session-events.ts`) are split first; new words go to `settings/build-words.ts`, `pack/words.ts`, `shared/build-words.ts`; the build's screens go to `app/screens/deploy-build.tsx` and `settings-build-layout.ts`, the Build section's shape to `settings/build-shape.ts`, beside files of 423 to 447 lines.
- Every text from the server that zekno draws or prints passes through `sanitize`: `progress`, `log`, `build_line`, `build_error`'s `step` and `error`, `remote:` lines and the saved output as `zekno logs --build` prints it. A test has a step print an OSC 52 sequence and finds it in none of them.
- Every new sentence comes out of the real program word for word at a terminal, in the app and with no terminal (SC-015), checked against the boards in the walkthrough.
