# Research: Small CLI Features

Checked on 2026-11-15 on macOS with Bun 1.4.4 and the repository at `03443f2`. The decisions made
with the maintainer that day (handed over in `spec006-decisions.md`) are binding and are marked
**(maintainer)**. The rest follow from them, from the code, or from the approved mock-ups in
[design.md](./design.md). Nothing was run on a server. The questions at the end are for the
maintainer; each has a recommended answer.

## R1. Where a command asks, and why the plain path cannot change **(maintainer: "at a terminal" is `wantsPlain` false)**

- **What the code does today.** `main.ts` picks the interface once: `wantsPlain(argv, stdout,
  stdin)` (`ui/plain.ts`) is true with `--json`, with `TERM=dumb`, and whenever standard output or
  standard input is not a terminal; then `processPlainUi()`, else `inkUi()`. `run` in `cli.ts`
  fills details from `zekno.json` with `withProject` and hands them to the command, whose
  operation throws today's sentence for a missing one: `findServer` (`profile.ts`) throws
  `new UsageError(MISSING_SERVER)` and `checkApp` (`ops/deploy.ts`) throws
  `new UsageError(MISSING_APP)`. `run` prints a `UsageError` as
  ``<message>\nRun `zekno --help` for the list of commands.`` and returns 2.
- **Decision.** The `Ui` gains `readonly asks: boolean`: true for the Ink interface when its input
  is a terminal, false for the plain interface. Every new question is reached only through code
  that first checks `deps.ui.asks`. When it is false, `run` takes exactly the path it takes
  today: the same calls, in the same order, so the same sentence and exit status come out
  (FR-002, FR-028). The plain interface still implements the new members, and each throws what
  the decisions say (the sentence the command has today for that detail), so a mistake in a
  caller cannot make a script wait.
- **Rationale.** Skipping the asking code entirely is the only way to prove "the same sentence and
  exit status" without re-deriving every order of checks. For example `zekno secret set` with no
  name, no `--server` and no `zekno.json` says `MISSING_SERVER` today, not "Say which secret",
  because `prepareSecretSet` finds the server first. A plain interface that threw its own
  sentences would have to repeat that order for ten commands.
- **At a terminal, checks that need no answer come first.** Before the first question a command
  checks what it can: `--to` (rollback), `--tail` (logs), the secret's name (`secret set`:
  present, the name rule, not reserved; `secret rm`: present), the import file (read and parsed
  whole), and for `deploy` the Compose file (FR-014). This changes only the order of failures at
  a terminal, never in a script.
- **Alternatives considered.** Asking inside the operations (`findServer`, `checkApp`): the
  operations are shared with the full-screen app, which must not change (FR-029), and they have
  no interface. A plain interface whose question methods throw today's sentences, called on every
  path: rejected for the reason above.

## R2. What the `Ui` gains, and how Ink draws it **(maintainer: the mock-ups; Ink 8, no new dependency)**

- **Decision.** In `ui/types.ts`: `asks`; `choose` (a list); `ask` (a one-line typed answer, with a
  value filled in and a check); `confirm` keeps its signature and gains an optional third argument
  `{ leave: true }`, with which Esc and Ctrl-C leave instead of answering no; `askValue` (the
  hidden prompt that Esc skips, for the first deploy); `note` (one dim line); `code` (a code and
  what it is for, as the first-deploy mock-up shows the team code and the server code); `groups`
  (labelled lines, for the import summary); `gap` (an empty line at a terminal, nothing in plain
  output); `doctorReport` (the whole `zekno doctor` report). The exact shapes are in
  [data-model.md](./data-model.md) and the looks in [contracts/questions.md](./contracts/questions.md).
- **Ink.** A new file `ui/questions.tsx` holds the list and the typed answer as Ink components,
  built from what `ui/select.tsx` and `ui/text-input.tsx` already export (`applySelectKey`,
  `MARKER`, `applyTextInput`, `TEXT_LIMIT`). Those two files are used by the full-screen app and
  are imported, not edited. `ui/ink.tsx` keeps one question on screen at a time, as it does for
  `confirm` and the hidden prompt, and adds what a question leaves behind to the lines already
  written (`Static`), so it stays above whatever comes next.
- **Which input.** The new questions use the input stream `inkUi` was given (`streams.stdin`, else
  `process.stdin`) for `isTTY`, raw mode and the type-ahead discard, so the tests can drive them
  with a stand-in terminal. `confirm` and `askSecret` move to the same stream.
- **Colour.** The mock-ups draw `?` and `❯` in the brand colour (`BRAND` in `ui/theme.ts`). Today
  `confirm` and the hidden prompt draw `?` in cyan. Every `?` of single commands becomes the brand
  colour. That changes how two existing questions look at a terminal only.

## R3. A key typed before a question is on screen **(maintainer: every question goes through `discardTypedAhead`)**

- **What exists.** `discardTypedAhead` (`ui/type-ahead.ts`) turns raw mode on, throws away what has
  arrived and what arrives in the next 50 ms, and puts raw mode back. `Ui.confirm` calls it before
  it draws (feature 004, K12). The hidden prompt of `secret set` does not:
  specs/004-cli-app/security-review.md, "Left", says "The hidden prompt of `secret set` does not
  throw away what was typed before it is drawn ... Whether such keys end up in the value was not
  checked".
- **Decision.** `choose`, `ask`, `confirm`, `askValue` and `askSecret` (at a terminal, without
  `--stdin`) all call `discardTypedAhead` on the interface's input before the question is drawn.
  For a hidden prompt raw mode goes on first, as today, so nothing typed is echoed.
- **Tested** with a stand-in terminal stream that holds `y`, `\r` and letters before the question:
  none answers or reaches a value; a key written after the question is drawn does (FR-007).

## R4. Leaving a question **(maintainer: Esc and Ctrl-C print "Nothing was done." and exit 1)**

- **Decision.** `errors.ts` gains `class Left extends CliError`, whose message is
  `NOTHING_DONE` ("Nothing was done."). `NOTHING_DONE` moves from `project.ts` to `errors.ts` and
  `project.ts` re-exports it, so `useOnce` and every existing import keep working. `run` prints a
  `CliError` through `ui.error` and returns 1, so leaving looks as a "no" to the first-use question
  looks today: `✖ Nothing was done.` at a terminal.
- **Ctrl-C.** Ink is started with `exitOnCtrlC: false`, so while a question is open Ctrl-C reaches
  the question as `c` with `ctrl`. Each question takes it as leaving. Outside a question the
  terminal turns Ctrl-C into the usual interrupt, as today.
- **The yes-or-no question in the first deploy** ("Remember this folder?") must be leavable too
  (FR-005), but today Esc and Ctrl-C answer no. It is asked with `{ leave: true }`. Every existing
  `confirm` call keeps today's keys.
- **After something was made.** In the first-deploy flow, leaving after the key or a server was
  made would print "Nothing was done.", which is then not true. Research Q3 asks the maintainer.

## R5. Where the list of apps comes from **(maintainer: "the apps deployed to the chosen server", FR-003)**

- **What is known without a connection.** This machine's verified history: `appsOf(team, server,
  home)` in `app/views.ts` gives each app this machine deployed to that server, with its latest
  deploy number, read from under the signature, in Home's order (`latestFirst`). It cannot know
  what is running, nor apps a teammate deployed.
- **What the mock-up shows.** `demo  deploy 4, running`: the state needs the server. The runner's
  `status` (`lastSequence`, every app it holds, by anyone in the team) and `state` (what is
  running) give it, and `readStatus` (`ops/status.ts`) already reads both over one session, checks
  that it is the server that was connected (`checkIdentity`), and never writes on the server
  (the runner's `status` and `state` only read: `apps/runner/src/commands.ts` `status`, and
  `inspect.ts`, "Nothing here changes anything or takes the lock").
- **Decision.** Before the list is drawn, under a step `Asking <server>` (with the spinner: batch
  mode never writes on the terminal), the server is read in SSH's batch mode, as the app's
  background reads are (`batchOnly` in `app/hand-over.ts`, imported, not changed), with a limit of
  `READ_LIMIT_MS` (20 seconds, `app/effects.ts`) through an `AbortSignal`. What SSH writes is
  recorded and not shown. Then:
  - read: one row per app in `status.lastSequence` with a number of 1 or more, its detail
    `deploy <n>, <state>` (`running`, `stopped`, `partly running`; with `unknown` the detail is
    `deploy <n>`), in Home's order by this machine's history;
  - not read (unreachable, SSH would have asked, too old for `state`, the limit, any error): the
    rows of `appsOf`, each `deploy <n>`. Nothing is said about the failed read.
- **Rationale.** Batch mode never asks for a password, so a question is never preceded by a
  password prompt, and the operation that follows still connects as today. The read changes
  nothing and is limited in time. A command that never connected before (`secret set`, `secret
  ls`, `link`) connects only at a terminal and only when the app was not given.
- **Alternatives considered.** This machine's history only (simplest, but cannot draw "running",
  which the mock-up shows, and misses a teammate's apps). A read that may ask (a second password
  prompt for `deploy`, `logs` and `rollback`, which connect again).

## R6. A `zekno.json` not signed by the team, at a terminal **(spec, edge cases; FR-009; asked as Q6)**

- **Today.** `withProject` throws `new UsageError(notSigned(link))` (S1), exit 2, unless both
  `--app` and `--server` were given, when the file is left aside and the Compose file is
  `compose.yaml` in the current folder.
- **Decision.** At a terminal the file is never used and the command says why with
  `notSignedHere(link, cwd)` (the sentence the app shows on Home: "zekno.json here is not signed
  by your team, so zekno does not use it. It names api on dev."), drawn as a warning, then asks
  for what is missing as if the file were not there. `withProject` gains an optional
  `leaveAside(sentence)` in its `places`; given, the unsigned branch calls it and returns what was
  given instead of throwing. Only the single commands at a terminal pass it. In a script S1 stays
  exactly as it is.
- **Security argument.** S1 exists so that such a file never "chose an app and a server unasked,
  and handed them a Compose file from a folder nobody in the team made". Answering the questions
  is the same as typing `--app` and `--server`, which leaves the file aside today: the person
  chooses both, and the Compose file is the one in the folder they are in. The file's names are
  never offered as answers.
- **A file signed by the team and not used here yet (S2)**: unchanged. The first-use question still
  comes first, before any other question and before any connection; "no" ends with "Nothing was
  done." and status 1.
- **`zekno link` with such a file in this folder and no `--force`**: linking would have to replace
  it, which `writeProject` refuses ("There is already a zekno.json in <folder>. Run `zekno link
  --force` to replace it."). At a terminal `link` says that before asking anything.

## R7. The first deploy from nothing **(maintainer: in `zekno deploy` only, in the order of mock-up 3, with the existing operations)**

- **Decision.** A new module `apps/cli/src/asking/first-deploy.ts` with `deployAtTerminal(deps, team,
  values)`, called by `run` for `deploy` when `deps.ui.asks`. It covers every `zekno deploy` at a
  terminal: from nothing, with some things missing, and with nothing missing. The plain path of
  `deploy` stays as it is. The states and steps are in
  [contracts/first-deploy.md](./contracts/first-deploy.md). Each step calls an existing operation:
  `createTeam` (`ops/init.ts`), `prepareServerAdd` and `addServer` (`ops/server.ts`, with the
  installer), `linkFolder` (`ops/link.ts`, the same checks as `zekno link`), `prepareSecretSet` and
  `setSecret` (`ops/secret.ts`), `prepareDeploy` with the Compose text read once at the start
  (`read`), and `send` from `commands/deploy.ts` (exported), which shows the deploy panel as
  today.
- **One keychain read for the run.** After the key exists, the flow takes the verified team once
  and hands every operation `deps` whose `team` returns that same team, so the key is read once
  (feature 004, K10). `teamOnce` keeps a failed open today (`opened ??= openTeam(deps)` holds a
  rejected promise); it is changed to forget a rejection, and it gains `peek()`, which opens the
  team and keeps it until `take()`, for the questions that list servers.
- **Rationale.** Nothing about what is signed, checked, installed or sent is new: the flow only
  orders the operations and asks between them, and each operation leaves its result whole before
  the next question (FR-011).

## R8. The import file's grammar **(maintainer: a small strict reader of our own; not `util.parseEnv`, no library)**

- **Decision.** The grammar is in [contracts/import.md](./contracts/import.md), with every case the
  decisions name. In short: UTF-8; LF or CRLF; blank lines and `#` comment lines; an optional
  `export ` in front; a name of letters, digits, `_`, `.` and `-`, then `=`; an unquoted value, a
  single-quoted value taken as written, or a double-quoted value with the escapes `\\`, `\"`,
  `\n`, `\r`, `\t` and `\$`; a value never spans lines; after a value, a comment only after a space
  or a tab; a name given twice is an error naming both line numbers.
- **Three places where it is stricter than Docker Compose's reading of `.env`**, each because two
  tools read the line differently, and a value that quietly differs from what the app had is
  worse than a clear stop:
  - `$` in an unquoted or double-quoted value. Compose expands `${NAME}` and `$NAME` there; zekno
    stores what it reads and a deploy passes it on as it is. Such a line stops the import and says
    to put the value in single quotes (or write `\$` in double quotes).
  - `#` inside an unquoted value. Compose keeps `VAL#x` whole, other readers cut it at `#`. It stops
    the import and says to quote the value, or to put a space before `#` for a comment.
  - A quoted value that does not end on its line. Compose and other readers join the next lines;
    zekno stops and says to write line breaks as `\n` inside double quotes.
- **Names shown and names not shown.** A name is shown (in the summary, in "left out") only when it
  is 1 to 128 characters of `[A-Za-z0-9_.-]`, which cannot hold most values and no control
  character. A longer name is named by its line number only: it may be a value in the wrong
  place.
- **Rationale.** The decisions ask for a reader that names the line that is wrong. `util.parseEnv`
  exists in Bun and accepts almost anything without saying where.

## R9. All or nothing with the way secrets are stored today **(FR-019)**

- **What one write is today.** `profileStore(home).secrets(serverId, app)` reads one file,
  `secrets/<serverId>/<app>.json`, holding `{ records, removals }` for that app on that server.
  `setSecret` (`ops/secret.ts`) signs one record and calls `saveSecrets` with the whole store plus
  that record. `write` in `profile.ts` writes a new file under a name nobody can predict, mode
  600, then renames it over the old one: a whole file or none.
- **Correction to the decisions file.** The decisions say "secrets are stored as one record per
  version in the profile folder". They are one record per version, but all of an app's records
  on one server are in one file, written whole.
- **Decision.** `storeSecrets(plan, values)` in `ops/secret.ts` works out each name's next version
  (`latestVersion` + 1), seals and signs every record inside one `team.withSigner`, and only then
  calls `saveSecrets` once with every new record appended. A failure while sealing stores nothing;
  a failure of the write leaves the old file and removes the temporary one. One rename makes all
  of them visible at once.
- **Limits checked before anything is sealed:** at most 256 values in the file
  (`LIMITS.secretsPerDeploy`, the most one deploy carries); the app's current secrets together
  with the new names at most 256; the store's records and removals plus the new records at most
  `LIMITS.secretHistory` (4096), past which `currentSecrets` refuses the store
  (`packages/core/src/secret-record.ts`).

## R10. Reading the import file

- **Decision.** `readImportFile(path)` in `apps/cli/src/secrets/import-file.ts` opens the path the person
  typed, resolved from the current folder, as `readGiven` in `compose-read.ts` does: links are
  followed (it is the person's path, like `-f`), `O_RDONLY | O_NONBLOCK` so a pipe cannot hold the
  read up, `fstat` must say a regular file, the size is checked before and while reading, and the
  bytes are read from that one open file. The limit is 1 MiB (1,048,576 bytes). The bytes are
  decoded as UTF-8 with `fatal: true`; a byte order mark at the very start is dropped. The file is
  read once, never copied, never written, and the text is dropped once parsed.
- **A link** (security review S4; decision 2 of specs/008-cli-decisions, 2026-11-15). When the path
  typed is a symbolic link, the summary's first line names the real path of the file that was
  opened. It is taken right after `fstat`: `realpath` of the path, used only when its device and
  inode are those of the open descriptor (contracts/import.md, "Reading the file").
- **The folder's own `zekno.json`** needs no case of its own: its first line, `{`, is not a
  `NAME=value` line, so nothing is stored and line 1 is named.

## R11. How `zekno doctor` checks a server without changing the runner **(maintainer: no runner change)**

- **What the installer's script can and cannot do.** `INSTALL_SCRIPT` (`install.ts`) has two modes
  and neither only reads. In `add` it creates the runner's folder (`if [ ! -d "$folder" ]; then
  mkdir -p "$(dirname "$folder")" && mkdir -m 700 "$folder" || fail folder; fi`), installs a
  runner when none is found, and ends with `exec "$final" session`. In `update` it replaces a
  runner of another version. A read-only run needs a mode of its own.
- **What the session commands can and cannot do.** `version` (in every session's first line) and
  `status` tell the runner's version and protocol and whether it is the server that was
  connected; `state` asks Docker what is running. None says whether Docker has Compose, which
  version, or how much disk is free.
- **Decision.** Two connections per server, both in SSH's batch mode, each limited to
  `READ_LIMIT_MS`:
  1. **A new fixed script, `CHECK_SCRIPT`**, in a new file `apps/cli/src/server/check-script.ts`, sent
     the way the installer is (`transport.script(words)` runs `sh -s -- <words>` and the text goes
     on standard input). Its only words are `check` and the runner's path from the profile,
     checked by `isInstallPath` (`install.ts`) before they are placed and by the transport's
     `SCRIPT_WORD` after. It prints `connected`; `docker ok <compose version>` or `docker none`,
     with the installer's own commands for Docker and Compose; `runner here` or `runner none`
     (whether a file that can be run is at that path, with the installer's own lookup lines for a
     path, `~/`, or a bare name); `space <KiB>` or `space unknown` (`df -Pk` of the runner's
     folder, or the nearest folder above it that exists, as the installer's `lost` reads it);
     then `done`. It never creates, moves, downloads, installs or starts anything, and does not
     run the runner. Its text is in [contracts/doctor.md](./contracts/doctor.md).
  2. **A session**, `openSession` on the profile's target, which asks `version` first as every
     session does, then one `status` request, checked with `checkIdentity`, then closed.
- **Why not a third mode in `INSTALL_SCRIPT`.** It would change the text that features 004 and 005
  reviewed, which every install and update runs; a script of its own leaves the installer byte for
  byte as it is (a test pins its SHA-256), and is short enough to read in one go. The few lines
  it shares with the installer are copied and tested against the same stand-in server, so the two
  cannot drift unseen.
- **Security argument.** The script's text is fixed in the repository, a `{ ... }` block with no
  `${` and no backquote, so nothing can be placed into it. The two values that vary travel as
  words after `sh -s --`, each held to a pattern twice. What the server prints is read one line at
  a time, at most `INSTALL_LINE_LIMIT` (256) bytes, against fixed patterns in a fixed order;
  anything else ends the reading. No line is ever used as a path, a command or a file name; the
  Compose version is held to `[0-9A-Za-z.+-]{1,32}` and a number to `[0-9]{1,15}`, and both are
  cleaned before they are drawn. SSH's batch mode never asks, so `doctor` never waits on a person
  (FR-024). The runner is only asked `version` and `status`, which read its state and change
  nothing.
- **What it cannot check without changing the runner.** Nothing the decisions list: reachable,
  Docker with Compose and its version, the runner and its version, free space. The C library
  (named in the decisions as a check the installer has) only matters for installing; a runner
  that answers has the C library it needs, so `doctor` does not draw a line for it, as mock-up 5
  shows. No open question for the runner.

## R12. `zekno doctor` on this machine, and why it changes nothing **(FR-024, SC-005)**

- **Decision.** The checks read and never write:
  - `zekno`: `CLI_VERSION` and `RUNNER_RELEASE.version`, and whether `releaseFiles(RUNNER_RELEASE)`
    holds a checksum (a build that holds none cannot install a runner).
  - Key: `profile.json` as `profileStore(home).load()` reads it (only for `keyName`), then
    `readIdentity(keyStore, keyName)` from `context.ts`, exported for this.
  - Profile: `openTeam(deps)`, which reads `profile.json` and the keychain and verifies.
  - This folder: `findProject(cwd)` (reads), `standingOf(link, trust, home)` (reads `links.json`
    through `isAccepted`, never `accept`), `readCompose(source)` (reads). Never `withProject` or
    `useOnce`, which may ask and write `links.json`.
- **Not used:** `teamOnce` (no operation follows), `profileStore().save`, `accept`, `writeProject`,
  any operation that signs. Nothing creates the profile folder.
- **The keychain.** Reading the identity reads the signing key into memory, as every command does
  to verify the profile; nothing is signed. On macOS the system may ask for permission the first
  time a program reads its entry, as it does for every command.

## R13. The CLI's version **(maintainer: `apps/cli/package.json`, set to 0.1.0)**

- **Decision.** `apps/cli/src/version/version.ts` imports `../package.json` and exports
  `CLI_VERSION = version` after checking it against `RUNNER_VERSION_PATTERN` (the one version
  grammar, `0.1.0` and `0.1.0-dev.1` both fit). `runner-release.ts` already imports
  `runner-release.json` the same way.
- **In the compiled program.** `Bun.build` bundles a JSON import into the program, so
  `dist/zekno` carries the version it was built with and never reads a `package.json` at run
  time. `build.ts` already sets `autoloadPackageJson: false` (research R16 of feature 005), so a
  `package.json` in the folder `zekno` starts in is not read either. Run from source, the import
  reads `apps/cli/package.json` by its path from `version.ts`, never from the working folder.
- **Tested** in `apps/cli/test/compiled.test.ts`: the compiled program and the program run from
  source, both started in a folder that holds a `package.json` with `"version": "9.9.9"`, print the
  same two lines, and those name `apps/cli/package.json`'s version and `runner-release.json`'s.

## R14. Checking for a newer release: which address **(maintainer: `zekno version` and `zekno doctor` only, Bun's `fetch`, 3 seconds, nothing about the developer, the answer held to the version grammar; the address is chosen here)**

Sources, each read on 2026-11-15:

- GitHub Docs, "REST API endpoints for releases", "Get the latest release"
  (docs.github.com/en/rest/releases/releases#get-the-latest-release): the path
  `GET /repos/{owner}/{repo}/releases/latest`; "View the latest published full release for the
  repository."; "The latest release is the most recent non-prerelease, non-draft release, sorted
  by the created_at attribute."; the response has `tag_name`, `prerelease` and `draft`, each
  required; "Setting to `application/vnd.github+json` is recommended", with the header
  `X-GitHub-Api-Version: 2026-03-10`. For listing releases the same page says "Information about
  published releases are available to everyone." It does not say in so many words that "latest"
  needs no authentication for a public repository; the request is made without any.
- GitHub Docs, "Rate limits for the REST API": "The primary rate limit for unauthenticated requests
  is 60 requests per hour."; "Unauthenticated requests are associated with the originating IP
  address"; "If you exceed your primary rate limit, you will receive a `403` or `429` response".
- GitHub Docs, "Getting started with the REST API": "All API requests must include a valid
  `User-Agent` header."; "Requests with no `User-Agent` header will be rejected."; "GitHub
  recommends using your GitHub username, or the name of your application, for the `User-Agent`
  header value."
- GitHub Docs, "API Versions": "Requests without the `X-GitHub-Api-Version` header will default to
  use the `2022-11-28` version."; `2022-11-28` is supported until 2028-03-10 and `2026-03-10` has
  no end date yet; "the previous API version will be supported for at least 24 more months"; a
  version no longer supported gets "a `410 Gone` response".
- GitHub Docs, "Viewing and understanding files": the Raw button lets you "view or copy the raw
  content of a file without any styling". Nothing in the docs describes `raw.githubusercontent.com`
  as an interface, its limits or its caching.
- GitHub Changelog, "Updated rate limits for unauthenticated requests", 2025-05-08
  (github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/): the
  tighter limits cover "downloading files from raw.githubusercontent.com", among other
  unauthenticated operations. It gives no numbers and no status code.
- Bun's installed docs, `node_modules/.bun/bun-types@1.4.4/node_modules/bun-types/docs/runtime/networking/fetch.mdx`:
  "Fetching a URL with a timeout ... use `AbortSignal.timeout`"; "Without a `proxy` option, Bun
  reads `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` (upper or lower case) each time `fetch` runs".
  So the request goes through the developer's own proxy settings, as their other tools do. The page
  does not describe `redirect`; the implementer checks `RequestInit` in the same package's types
  for `redirect: "manual"` before relying on it (T007).

| | REST API, latest release | Raw file on `main` (`apps/cli/src/runner-release.json`) |
|---|---|---|
| A documented interface | Yes, versioned; a pinned version is supported for at least 24 months after its successor | No; the docs describe the Raw button, not the host |
| What "newest" means | the newest published release that is not a pre-release or a draft: exactly "not a development release" (feature 005 publishes dev releases as pre-releases), and a withdrawn release is deleted (feature 005, R11), so it drops out | whatever `main` holds; between the prod commit and the second build (feature 005, maintainer steps 6 and 7) it names the next version with no checksums, before that release exists |
| Coupling | the repository's name and the tag form `runner-v<version>` | also a path inside the repository, which every zekno ever built would depend on |
| Limits | 60 an hour per address, documented; past it 403 or 429 | tighter limits than before, numbers not published |
| Size of the answer | a JSON object with the release notes (at most 64 KiB, feature 005) and the file list | about 300 bytes |
| What GitHub learns | the address the request comes from, its time, the `User-Agent` (`zekno`), and that this repository's latest release was asked for: someone at that address runs zekno now | the same, for that file |

- **Decision: the REST API** (changed later the same day: see "Change of decision" at the end of
  R14). `GET https://api.github.com/repos/zekno-app/zekno/releases/latest` with
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10` (the version with no end
  date; after its end GitHub answers 410 and the check says it could not check, it never fails) and
  `User-Agent: zekno` (the application's name, as GitHub recommends; no version, nothing about the
  machine). No `Authorization`, no cookie, no query, no body. It is steadier (documented and
  versioned) and its meaning of "latest" is the spec's "newest release that is not a development
  release" with nothing to add.
- **The request** (contracts/version.md): one GET with `deps.fetch`, `redirect: "manual"`; a
  redirect is followed only to an `https:` address on `api.github.com`, at most three times; one
  `AbortSignal.timeout(3000)` covers connecting, every redirect and reading the body; the body is
  read from its stream up to 262,144 bytes and the reading stops past that; only status 200 counts.
- **The answer is hostile text.** `JSON.parse` inside `try`, within the byte limit; it must be an
  object whose `tag_name` is a string `runner-v` followed by a version that matches
  `RUNNER_VERSION_PATTERN` and is not a development version, and whose `prerelease` and `draft`, if
  present, are `false`. Nothing else of the answer is read or kept. The version is compared with
  the one this zekno carries (`RUNNER_RELEASE.version`) by `compareRunnerVersions`: newer, or this
  is the newest (also when the answer is older, as for a development build ahead of every
  release). Anything else, any error, any status but 200, the time limit: "not checked".
- **No request by accident.** The fetch is a new optional member of `Deps`, `fetch`. `main.ts` sets
  it to Bun's `fetch`; when it is not set the check is "not checked" and nothing is requested. So no
  test, no operation and no other command can reach the network unless it is handed a fetch and
  calls the one function that uses it, `checkNewest` in `apps/cli/src/version/newest.ts`, which only
  `zekno version` and `zekno doctor` call. The full-screen app is handed the same `deps` and never
  calls it (FR-036); a test runs every command of `HELP` but these two with a fetch that fails the
  test if called.
- **Known limits.** A release published and not yet recorded in `runner-release.json` on `main`
  (the hours between publication and the second build, or a second build that did not match) is
  announced although a build from `main` does not carry it yet. In an office behind one address,
  more than 60 runs an hour get "Could not check". GitHub, or anything this machine trusts to
  answer for `api.github.com` (a proxy, a certificate installed by someone else), can name a false
  version; the effect is one sentence (FR-035).
- **Alternatives considered.** The raw file (above). `github.com/zekno-app/zekno/releases/latest`,
  which the docs describe as a link to share, not an interface. A feed or a host of our own (none
  exists, and the decisions name GitHub).
- **Change of decision: the raw file** (approved by the maintainer on 2026-11-15, decision 1 of
  [specs/008-cli-decisions](../008-cli-decisions/spec.md)). Why: on 2026-11-15, from a shared
  address (a VPN, iCloud Private Relay or an office share one), the API answered 403 "rate limit
  exceeded", and `zekno version` said "Could not check for a newer release."; the limit of 60
  unauthenticated requests an hour per address is the table's "Limits" row coming true. The raw
  file host answered 200 from the same address, with `cache-control: max-age=300`. The check now
  reads `https://raw.githubusercontent.com/zekno-app/zekno/main/apps/cli/src/version/runner-release.json`
  (the file's place after feature 007; on `main` it never names a development version, which the
  `check-main` workflow holds). The file is held to the form the CLI's own strict reader accepts
  (`RunnerReleaseSchema`), and a version counts as published only when both checksums are there,
  which answers the table's "What newest means" row: between a release being started and its
  second build the checksums are null, and such a version is not announced. The API-only headers
  (`Accept`, `X-GitHub-Api-Version`) go; `User-Agent: zekno` stays. The body limit is 16 KiB. Every
  other part of "The request" and "The answer is hostile text" above stays, with the host now
  `raw.githubusercontent.com`. Known and accepted: the address names a path in the repository; if
  the file moves again, older builds say "Could not check for a newer release.", never something
  false. The host's own limits are not published (the 2025-05-08 changelog above).

## R15. Testing **(maintainer: `bun test`, both halves for every command)**

- **Logic** through a scripted terminal: `answering(m, answers)` in `test/helpers.ts` wraps the
  plain interface of `machine()` with `asks: true` and answers each question from a queue,
  recording what was asked and what was offered. This tests order, offers, leaving and what is
  written, for every command of the list (SC-002).
- **Looks** through Ink: `inkUi` with a stand-in terminal (a `PassThrough` with `isTTY` true and a
  `setRawMode` stub, as `test/plumbing.test.tsx` builds one), keys written to it, and the screen
  read back with the `screenOf` of `test/single-commands.test.tsx`. Each mock-up line is checked.
- **The "never asks" half**: the plain interface of `machine()`, for each command and each missing
  detail, against today's sentence and status.
- **The first deploy end to end** with `standInServer()`, `sshStandIn()` and `withSsh` of
  `test/stand-in-server.ts`, an in-memory key store, the real runner as the release
  (`realRunner(docker)`) and the stand-in Docker.
- **`doctor`'s script** under `/bin/sh` and `/bin/dash` (when present) against the stand-in
  server, as `test/install.test.ts` runs the installer; `doctor` end to end with the stand-in
  `ssh` (`ask()`, `down()`), and a file-by-file snapshot of the profile folder, the project folder
  and the stand-in server before and after (SC-005).
- **The newer-release check** never uses the network in a test: `deps.fetch` is a stand-in that
  answers, hangs, fails, redirects, or sends a huge or hostile body, and `machine()` sets none, so a
  command that reached for the network by mistake would have nothing to call.
- **The agent end-to-end tests** (`bun run test:e2e`) drive the full-screen app, which does not
  change. One task near the end, the orchestrator's, runs them once.

## Questions for the maintainer

Each has a recommended answer. Tasks that depend on an answer say so; each is built as recommended
unless the maintainer answers otherwise before that task.

| # | Question | Recommended answer | Tasks |
|---|----------|--------------------|-------|
| Q1 | **What an answered question leaves on screen.** Mock-ups 1 and 2 say a list collapses to `✔ Server  prod`. Mock-ups 3 and 4 show the other questions as they are asked and do not say what stays. Today `confirm` leaves `  <question> yes` (indented, no `?`), and the hidden prompt of `secret set` leaves nothing. Leaving prints `Nothing was done.` through the error line, so at a terminal it reads `✖ Nothing was done.`. | A list: `✔ Server  prod`, `✔ App  demo` (decided). A typed answer: its line as asked, `? Your name › ada`. A yes-or-no question: `? <question> (y/N) yes` or `no`, for every yes-or-no question of single commands, the existing ones included (terminal only; no test reads today's line). The first deploy's hidden prompt: `? Value for DATABASE_URL (demo on prod): (hidden)` when a value was given, and the same line ending `skipped` after Esc; `zekno secret set` keeps today's (the prompt goes, its `✔ Set ...` line says what was set). Leaving: `✖ Nothing was done.`, as a "no" to the first-use question reads today. | T011, T015, T022, T023 |
| Q2 | **Which deploys ask for the values the Compose file expects.** FR-010 puts them in the first deploy. The full-screen app lists missing values before every deploy. | Every `zekno deploy` at a terminal asks for the expected values that have no secret, as the app does before every deploy; Esc skips each. Never in a script. The alternative is to ask only in a run that also asked something else. | T022, T023 |
| Q3 | **What leaving says once something was made.** The clarification says leaving prints `Nothing was done.`. In the first deploy, after the key or a server was made in the same run, that is not true. | Before anything was made in the run: `Nothing was done.`. After: ``Nothing more was done. What was set up so far is kept: run `zekno deploy` again to carry on.`` Exit status 1 either way. A failure after something was made ends with the failure's sentence followed by ``What was set up so far is kept: run `zekno deploy` again to carry on.`` | T022, T023 |
| Q4 | **The sentences that are not in the mock-ups.** Every sentence marked "needs approval" in contracts/questions.md, first-deploy.md, import.md and doctor.md (the reasons a typed answer is refused, the sentences for no team, no server and no apps at a terminal, the import's errors and its plain output, the doctor's details and next steps for every result the mock-up does not show, the disk thresholds), and the plain output of `zekno doctor` and `zekno secret import`. | Approve as written. The pseudo-terminal walkthrough (T047) shows each one that can be reached. | T021, T023, T028, T032, T036, T041, T043, T047 |
| Q5 | **The SSH line after a server is added.** `zekno server add` says "You reached this server over SSH, so its identity rests on SSH's host verification." after the server code. Mock-up 3 does not show it. The constitution asks that the limits of the design be stated where the protections are claimed. | Add it to the first deploy, after the server code and what it is for, exactly as `server add` prints it. | T022, T023 |
| Q6 | **A `zekno.json` not signed by the team, at a terminal.** The decisions say the rules for such a file "stay exactly as they are" (feature 004: it is refused with status 2 and never offered). The spec's edge cases say it "is never used, and the questions are asked as if it were not there, after saying why". The two differ only at a terminal: stop with S1, or say why and ask. | The spec's edge case, at a terminal only (research R6): the file is named with the app's own sentence (A14), never used, and the command asks for the server and the app; answering is the same as typing `--app` and `--server`, which leaves such a file aside today. With no terminal S1 and status 2 stay exactly as they are. If the maintainer prefers today's stop at a terminal too, T020 is dropped and T023 and T028 stop with S1 instead. | T020, T022, T023, T027, T028 |
