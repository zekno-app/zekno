# Implementation Plan: Small CLI Features

**Branch**: `006-cli-small-features` (from `dev`) | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-cli-small-features/spec.md`, the approved mock-ups
in [design.md](./design.md), and the decisions made with the maintainer on 2026-11-15 (summarised
below; the file they were handed over in is binding).

## Summary

Four small features in `apps/cli`, and the CLI's own version. **Questions instead of stops**: at a
terminal, the ten commands that take a server or an app ask for a missing one with a list (one
server is used and said), and leaving prints "Nothing was done." with status 1; with no terminal
nothing changes. **One command from nothing**: `zekno deploy` at a terminal finds what is missing
and makes it in order, each thing whole before the next question: the key (`createTeam`), the
server (`prepareServerAdd` and `addServer`, the installer included), the app and whether to
remember the folder (`linkFolder`), the values the Compose file expects (`setSecret`), then the
deploy. **`zekno secret import <file>`**: a strict reader of our own for `NAME=value` files, a
summary by name only, one question, and every value sealed in one write of the app's secret store,
so all or none are stored. **`zekno doctor`**: read-only checks of this machine and of each server,
the server ones through SSH's batch mode with a new fixed read-only script and the runner's
existing `version` and `status`, so the runner does not change. **`zekno --version`**: the CLI's
version (now `0.1.0`, from `apps/cli/package.json`, bundled into the compiled program) and the
runner release it installs. **A newer release**: `zekno version` and `zekno doctor`, and only they,
ask GitHub's REST API once per run for the latest published release (research R14), within 3
seconds, sending nothing about the developer, and say in one line that this is the newest, that a
newer one exists, or that it could not check; `zekno --version` never uses the network. The
full-screen app does not change.

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.4 (pinned in the root `package.json`); POSIX `sh` for the new server script

**Primary Dependencies**: `@workspace/core`, Ink 8.0.0, React 19.3.1, zod 4.6.7 (all already in `apps/cli/package.json`), Bun built-ins. **No new dependency, service or file format.**

**Storage**: the profile folder as today (`profile.json`, `secrets/<serverId>/<app>.json`, `history/`, `links.json`), the keychain entry, `zekno.json` in a project folder. Nothing new is stored. `apps/cli/package.json` `version` becomes `0.1.0`

**Testing**: `bun test`. Logic through a scripted terminal (`answering` in `test/helpers.ts`); looks through `inkUi` with a stand-in terminal stream; plain output through `plainUi`; the first deploy and `doctor` end to end against `test/stand-in-server.ts` (stand-in server, stand-in `ssh`, the real runner, stand-in Docker); the new script under `/bin/sh` and `/bin/dash`

**Target Platform**: the CLI on macOS and Linux; servers on Linux, reached over SSH

**Project Type**: a command-line app in the Bun workspace (`apps/cli`); docs pages in `apps/web` (MDX content only)

**Performance Goals**: a newcomer reaches a running app in under three minutes with at most six answers (SC-001); a question is drawn within the 20-second read limit even when a server does not answer

**Constraints**: plain output and exit statuses of every existing command unchanged (FR-028); the full-screen app unchanged (FR-029); the runner and the session protocol unchanged; no value ever outside a sealed record (FR-021); `doctor` writes nothing anywhere and never asks (FR-024); every rule of the signed link unchanged; the only new network use is one HTTPS GET to `api.github.com` by `zekno version` and `zekno doctor` (FR-033 to FR-036), never by another command, never in a test

**Scale/Scope**: about 12 changed source files, 7 new source files, 8 new or extended test files, 3 docs pages

## Decisions made with the maintainer (2026-11-15)

| Decision | Choice |
|----------|--------|
| Stack | Bun 1.4.4, TypeScript, Ink 8 and React 19 in single commands (`ui/ink.tsx`), the plain interface for scripts, zod, `bun test`. No new dependency |
| Scope | `apps/cli` and docs only. The runner does not change and no runner release is needed. The full-screen app (`apps/cli/src/app/`) does not change |
| The questions | The `Ui` gains a list, a typed answer with a check and a value filled in, and keeps the yes-or-no question and the hidden prompt. The plain interface never asks; it throws today's sentences. "At a terminal" is `wantsPlain` false |
| Type-ahead | Every question goes through `discardTypedAhead` |
| One server | Used without asking; one dim line says which |
| Leaving | Esc and Ctrl-C print "Nothing was done." and exit 1 |
| Commands that ask | `deploy`, `rollback`, `status`, `logs`, `secret set`, `secret rm`, `secret ls`, `secret import`, `link`, `server update`. A flag or a usable linked folder is never asked for. The signed-link rules stay as they are |
| From nothing | `zekno deploy` only, mock-up 3's order, the existing operations, each thing whole before the next question; a second run carries on. Another command with no team says to run `zekno deploy` in a project folder, or `zekno init` |
| Import | A small strict reader of our own (not `util.parseEnv`, no library); its grammar written in a contract; a typed path read as `-f` is; names held to `secret set`'s rule, reserved and invalid names left out and named; an empty value left out; all or nothing; one question; `--yes` in a script; `--app` and `--server` as the other secret commands |
| Doctor | Checks in mock-up 5's order; good, warning, problem, not checked; a warning does not fail; `--server`, `--json`; changes nothing; everything a server says goes through `sanitize`; the runner is not changed |
| Version | `zekno --version` and `zekno version` as mock-up 6; the CLI's version from `apps/cli/package.json`, set to `0.1.0`; the runner's from `runner-release.json`; `--json`; the compiled program reports what source does |
| A newer release | `zekno version` and `zekno doctor` ask GitHub once per run (mock-up 6); `zekno --version` never uses the network; no other command checks, nothing in the background, no cache; Bun's `fetch`, no new dependency, no credentials, a generic `User-Agent`, 3 seconds, HTTPS redirects only, a bounded body; the answer is hostile text held to the version grammar; nothing is downloaded because of it; tests never use the network; the address chosen in research (R14: the REST API's latest release) |
| Tests | Both halves for every command (Ink and plain); the first deploy end to end with the stand-ins; an independent internal security review; a pseudo-terminal walkthrough of each mock-up; the agent end-to-end tests run once by the orchestrator |
| Git | Commits per phase on `006-cli-small-features`; nothing pushed or merged without the maintainer |

The maintainer is asked six questions in [research.md](./research.md), each with a recommended
answer (Q1 what an answered question leaves on screen, Q2 which deploys ask for values, Q3 what
leaving says once something was made, Q4 the sentences not in the mock-ups, Q5 the SSH line after a
server is added, Q6 a `zekno.json` not signed by the team at a terminal). The plan is built on the
recommended answers.

## Constitution Check

*GATE: checked before Phase 0 research and again after Phase 1 design. Both pass.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | Nothing reaches a hosted service. A secret value never becomes an argument, a message, an error, a log or a file other than its sealed record: the import reader's errors carry a line number and a fixed reason; values are sealed with the existing `createSecret` inside one `withSigner`; the hidden prompt is the existing one, now also discarding type-ahead. The signing key stays in the keychain; the key is read once per run. `doctor` reads the keychain to verify, as every command does, and signs nothing. The newer-release check reaches GitHub, not a Zekno service, and sends no data about the developer, the team, the servers or the project: a fixed GET with a generic `User-Agent` and no credentials (research R14). A `zekno.json` not signed by the team is still never used; at a terminal the person names app and server, as `--app` and `--server` do today. | Pass |
| II. Honest Surface | "Runner" everywhere, never "agent". The first deploy says where the server's identity rests (research Q5). `doctor` says "not checked" rather than guessing, and "SSH needs an answer" rather than "down". The import reminds that the file still holds the values in plain text. The docs say plainly that `zekno version` and `zekno doctor` contact GitHub, what GitHub learns (the address and time of the request), and that nothing else in zekno does so on its own; "SSH is the route" stays true for everything that touches a server. "Pre-alpha and unaudited" stays on every docs page that has it. | Pass |
| III. Read the Installed Docs First | No Next.js code changes (MDX content only). Ink's `useInput`, `Static`, `render` options and Bun's `Bun.build` JSON bundling, `parseArgs`, `TextDecoder` `fatal` are used as the code already uses them; the tasks name the installed docs to check (`node_modules/ink/readme.md`, `node_modules/.bun/bun-types@1.4.4/.../docs`). | Pass |
| IV. One Design System | The terminal keeps feature 004's justified deviation (the CLI's own theme, `ui/theme.ts`). New pieces reuse `MARKER`, `applySelectKey`, `applyTextInput`, `BRAND`, `ErrorLine`. No new colour. | Pass |
| V. Motion With Purpose | One spinner, the existing one, while a server is read (state indication). Nothing else moves. | Pass |
| VI. Accessible and Fast by Default | Every result has a symbol and a word (`✔ good`, `! warning`, `✖ problem`, `– not checked`), never colour alone; lists fit the window and say how many rows are hidden; every question works from the keyboard and can be left with one key. | Pass |
| VII. Verified Before Done | Unit tests for every branch: the reader's grammar case by case, each command's questions and its plain half, the first deploy's states and failures, each doctor check and result, the version source. `typecheck`, `lint`, `test` from the root at the end, plus `bun run compile` in `apps/cli`; `bun run build` (the web app's `next build`) is run or recorded as not run. The pseudo-terminal walkthrough records what was and was not seen. | Pass |

Note for the maintainer, as in feature 005: the constitution's "Technology Constraints" still say
Bun 1.4.2; the repository pins 1.4.4.

## Project Structure

### Documentation (this feature)

```text
specs/006-cli-small-features/
├── spec.md
├── design.md                 # the approved mock-ups (binding)
├── plan.md                   # this file
├── research.md               # Phase 0: decisions, rationale, questions for the maintainer
├── data-model.md             # Phase 1: questions, lists, first-deploy state, import, checks
├── quickstart.md             # Phase 1: how to check it; results are added as tasks complete
├── contracts/
│   ├── questions.md          # the four kinds of question, the lists, leaving, type-ahead, sentences
│   ├── first-deploy.md       # zekno deploy at a terminal: lines, steps, second run, failures
│   ├── import.md             # the grammar, limits, summary, sentences, exit statuses
│   ├── doctor.md             # the checks, CHECK_SCRIPT, --json, plain output, sentences
│   ├── version.md            # zekno --version and zekno version
│   └── help.md               # the changes to HELP and to docs.test.ts
├── checklists/requirements.md
├── security-review.md        # written by the review task
└── tasks.md                  # Phase 2
```

### Source Code (repository root)

```text
apps/cli/
├── package.json                      # version 0.1.0
├── src/
│   ├── version/                      # new folder: the version and the newer-release check
│   │   ├── version.ts                # new: CLI_VERSION, versionLines()
│   │   └── newest.ts                 # new: checkNewest (the one request to GitHub)
│   ├── asking/                       # new folder: what a single command asks at a terminal
│   │   ├── asking.ts                 # new: whichServer, whichApp, the rows, the folder's name, A1 to A5
│   │   └── first-deploy.ts           # new: deployAtTerminal (every zekno deploy at a terminal)
│   ├── secrets/                      # new folder: reading a file of secrets
│   │   └── import-file.ts            # new: readImportFile, parseImport (the grammar)
│   ├── server/                       # new folder: what zekno runs on a server to look at it
│   │   └── check-script.ts           # new: CHECK_SCRIPT, checkWords, runCheck
│   ├── main.ts                       # hands Bun's fetch to run as deps.fetch
│   ├── cli.ts                        # HELP, WORDS, --version, the asking step for each command, secret import, doctor, version
│   ├── errors.ts                     # Left, NOTHING_DONE (moved here, re-exported by project.ts)
│   ├── context.ts                    # Deps.fetch (optional); readIdentity exported; teamOnce gains peek() and forgets a failed open
│   ├── profile.ts                    # isMemberName exported
│   ├── project.ts                    # withProject: optional leaveAside for a file not signed by the team
│   ├── install.ts                    # scriptLines exported; INSTALL_SCRIPT unchanged
│   ├── ops/secret.ts                 # prepareSecretImport, storeSecrets
│   ├── ops/doctor.ts                 # new: runDoctor (data only)
│   ├── commands/deploy.ts            # send exported
│   ├── commands/secret.ts            # secretImport
│   ├── commands/doctor.ts            # new: doctor (draws, or --json)
│   └── ui/
│       ├── types.ts                  # asks, choose, ask, confirm(…, { leave }), askValue, note, code, groups, gap, doctorReport
│       ├── plain.ts                  # the same, never asking
│       ├── ink.tsx                   # the same at a terminal; type-ahead before every question; ? in BRAND
│       └── questions.tsx             # new: ListQuestion and TypedQuestion components, pure key logic
└── test/
    ├── helpers.ts                    # answering(m, answers)
    ├── ui/questions.test.tsx         # new: the four kinds, drawn and driven by keys; type-ahead; plain throws
    ├── asking/asking.test.ts         # new: every command of the list, at a terminal and with no terminal
    ├── asking/first-deploy.test.ts   # new: from nothing to running, every state, second run, failures
    ├── secrets/import-file.test.ts   # new: the grammar case by case, reading the file, no value in an error
    ├── secrets/import.test.ts        # new: the groups, all or nothing, the command, no value anywhere
    ├── server/check-script.test.ts   # new: CHECK_SCRIPT under sh and dash against the stand-in server
    ├── ops/doctor.test.ts            # new: each check and result, --json, plain, nothing changed
    ├── version/version.test.ts       # new: the two lines, the third line of `zekno version`, no other command fetches
    ├── version/newest.test.ts        # new: the request and every answer, with a stand-in fetch
    ├── plain/                        # new: plain-unchanged.test.ts and its scenes and transcripts (FR-028)
    ├── compiled.test.ts              # the version, compiled and from source
    └── docs.test.ts                  # flags of zekno alone include those of `zekno --version`

apps/cli/README.md, apps/web/content/docs/cli.mdx, README.md   # docs
```

**Structure Decision**: no new package. Every new module is in a folder named for its subject
(constitution 1.3.0, "Code in folders", the maintainer's rule of 2026-11-15): `version/`,
`asking/`, `secrets/` and `server/` in `apps/cli/src`, with tests in folders of the same names;
the doctor's checks in `ops/` (data only) and its drawing in `commands/`, as every other command
is split. The files that existed before this feature (`install.ts`, `project.ts`, `session.ts`
and the others beside `main.ts`, and the flat `apps/cli/test/`) are not moved here: a feature of
its own moves them right after this one. `install.ts` only exports its line reader
(`scriptLines`) for `check-script.ts`; its script stays byte for byte as it is.

## What each command asks

The ten commands of the list. In each table "No terminal" is today's behaviour, which does not
change; the tests check each sentence and status. Shorthand for today's sentences:

- **[NO-TEAM]** ``No team on this machine yet. Run `zekno init --name <you>` first.`` status 1.
- **[MS]** ``Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.`` then ``Run `zekno --help` for the list of commands.``, status 2 (`MISSING_SERVER`, a `UsageError`).
- **[MA]** ``Say which app with `--app <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.`` then the help line, status 2 (`MISSING_APP`).
- **[S1]** `notSigned(link)` then the help line, status 2. **[S2]** `notUsedHere(member, link)` then the help line, status 2.
- **[A1]** to **[A5]**, **[A14]**, **[A15]**: [contracts/questions.md](./contracts/questions.md), "Sentences".

Common to all ten at a terminal: a flag or a usable `zekno.json` gives a detail and it is never
asked; the first-use question (S2's question) comes first when it applies; a file not signed by the
team draws [A14] and is left aside; with no profile [A3] (status 1), except `deploy`; leaving any
question: "Nothing was done.", status 1. With no terminal: today's checks in today's order (a
`zekno.json` problem, then [NO-TEAM], then the operation's own: server, app, the rest).

### `zekno deploy`

| | At a terminal | No terminal (today) |
|---|---|---|
| Checks before any question | the first-use question when it applies; the Compose file read once (`No Compose file at <path>. Point to one with \`-f <file>\`.`, an empty file, status 1) | as today |
| Asks, in order | the key (no profile); the server (none: added; one: [A1]; several: `Which server?`); the app (`Which app on <server>?` with `+ a new app`; none: `Name for this app`); `Remember this folder?`; each expected value with no secret (hidden, Esc skips) | nothing |
| Offers | connected servers; the server's apps; the folder's name | |
| Missing server | as above | [MS] |
| Missing app | as above | [MA] |
| No team | the first deploy (contracts/first-deploy.md) | [NO-TEAM] |
| `zekno.json` not signed | [A14], then as if not there; "Remember this folder?" is not asked | [S1] |
| Status | 0 started, 1 not started or refused, 1 left | as today |

### `zekno rollback`

| | At a terminal | No terminal (today) |
|---|---|---|
| Checks before any question | `--to` (``\`--to\` takes a deploy number, such as \`--to 3\`.``, status 2) | the same sentence, after the server and app checks |
| Asks, in order | server ([A1] or `Which server?`), then `Which app on <server>?` | nothing |
| No server connected | [A4] | [MS] |
| No apps | [A5] | [MA] |
| Missing server / app | asked | [MS] / [MA] |

### `zekno status`

| | At a terminal | No terminal (today) |
|---|---|---|
| Asks | server only ([A1] or `Which server?`) | nothing |
| No server connected | [A4] | [MS] |
| Missing server | asked | [MS] |

### `zekno logs`

| | At a terminal | No terminal (today) |
|---|---|---|
| Checks before any question | `--tail` (``\`--tail\` takes a whole number from 0 to 1000.``, status 2) | the same, as today (it is checked before the server) |
| Asks, in order | server, then app | nothing |
| No server connected / no apps | [A4] / [A5] | [MS] / [MA] |

### `zekno secret set <NAME>`

| | At a terminal | No terminal (today) |
|---|---|---|
| Checks before any question | the name: present (``Say which secret: `zekno secret set <NAME> ...`.``, status 2), the name rule (`A secret name uses letters, digits and underscore, and does not start with a digit.`, status 1), not reserved (`"<NAME>" is reserved: the runner uses it to start Docker. Choose another name.`, status 1); a value after the name stays refused by `valueAsArgument` | the same sentences, after the server and app checks, as today |
| Asks, in order | server, then app, then the hidden prompt as today (now discarding type-ahead) | nothing; the value from `--stdin` |
| No server connected / no apps | [A4] / [A5] | [MS] / [MA] |
| Without `--stdin` and no terminal | | ``There is no terminal to ask on. Pipe the value in and add `--stdin`.`` status 1 |

### `zekno secret rm <NAME>`

| | At a terminal | No terminal (today) |
|---|---|---|
| Checks before any question | the name is present (``Say which secret: `zekno secret rm <NAME> ...`.``, status 2) | after the server and app checks |
| Asks, in order | server, then app | nothing |
| No server connected / no apps | [A4] / [A5] | [MS] / [MA] |

### `zekno secret ls`

| | At a terminal | No terminal (today) |
|---|---|---|
| Asks, in order | server, then app | nothing |
| No server connected / no apps | [A4] / [A5] | [MS] / [MA] |

### `zekno secret import <file>` (new)

| | At a terminal | No terminal |
|---|---|---|
| Checks before any question | the file argument (I10, status 2); the file read and parsed whole (I2 to I9, I19 to I22, status 1) | the same, first |
| Asks, in order | server, then app, then `Store <k> values? Values are never shown.` unless `--yes` | nothing |
| No server connected / no apps | [A4] / [A5] | [MS] / [MA] |
| Without `--yes` | the question | the summary, then I16, status 1 |

The new command's "today" is the same rule as the other secret commands. Details in
[contracts/import.md](./contracts/import.md).

### `zekno link`

| | At a terminal | No terminal (today) |
|---|---|---|
| When it asks | only when no `zekno.json` applies here (none here or above, or one not signed by the team, said with [A14]) and `--server` or `--app` is missing | never |
| Checks before any question | a file not signed by the team in this folder without `--force`: [A15], status 1 | as today |
| Asks, in order | server, then app (no `+ a new app`) | nothing |
| A signed file here or above | as today: recorded as it is, after the first-use question | as today ([S2]-style refusal naming `--yes`, status 2) |
| No server connected / no apps | [A4] / [A5] | [MS] / [MA] |

### `zekno server update <name>`

| | At a terminal | No terminal (today) |
|---|---|---|
| Asks, in order | the server ([A1] or `Which server?`), then today's question ``Replace the runner on <S> with version <C>? ...`` unless `--yes` | nothing |
| Missing name | asked | ``Say which server: `zekno server update <name>`.`` and the help line, status 2 (checked before the team) |
| No server connected | [A4] | as above |
| Without `--yes` | today's question | ``There is no terminal to ask on. Add `--yes` to update the runner on <S>.`` status 1 |

Commands that do not ask: `init`, `server add`, `server ls`, `doctor`, `version`. At a terminal with
no profile, `server add`, `server ls` say [A3] instead of [NO-TEAM]; with no terminal they say
[NO-TEAM], as today.

## The first deploy, as a sequence of states

`deployAtTerminal` (research R7; lines, sentences and failures in
[contracts/first-deploy.md](./contracts/first-deploy.md)):

```text
[read]  zekno.json judged (first-use question first), Compose file read once, not empty
   │    fails: today's sentence, status 1, nothing made
   ▼
[key]   profile.json exists? ── no ──▶ "Your name" → createTeam → keychain entry + profile.json
   │                                    (leaving here: nothing made)
   ▼
[server] profile has the server? ── no ──▶ "Where is the server?" → "A name for it" → prepareServerAdd
   │       one: A1; several: list              → addServer (installer, setup, team list, sync)
   │                                    (a failure: key kept, no server in the profile)
   ▼
[app]   --app / zekno.json / list / "Name for this app"
   ▼
[folder] asked something and no zekno.json and no -f? ── yes ──▶ "Remember this folder?" ── y ──▶ linkFolder
   ▼
[values] each expected name with no secret: hidden prompt → prepareSecretSet + setSecret (one write each), Esc skips
   ▼
[deploy] prepareDeploy with the text read in [read] → send (the panel, the result line)
```

What exists after each state, and what a second run does from there:

| Stopped after | On this machine | On the server | A second `zekno deploy` |
|---------------|-----------------|---------------|-------------------------|
| nothing (left at "Your name") | nothing new | nothing | starts again from [key] |
| [key] | keychain entry, profile.json (founding team list, no server) | nothing | opening line "Two things first: a server, this app.", then [server] |
| a failed [server] | the same | what the installer leaves on failure: nothing installed, its temporary folder removed | [server] again |
| [server] | profile.json with the next team list and the server | runner installed, set up, holding the team list | `Using <server>, your only server.`, then [app] |
| [folder], "y" | zekno.json (signed) and `links.json` | nothing more | no question for the server or the app; [values], then the deploy |
| [values], some skipped | the values given, sealed | nothing more | the skipped values again, then the deploy |
| [deploy] | the deploy in history | the app running | asks nothing when every value was set and the folder remembered |

Each state's operation writes its result as one whole file (a temporary file renamed into place)
or, for the keychain, one entry; no question is drawn while one is being written (FR-011).

## Importing values

- **The reader**: `readImportFile(path)` reads a typed path once, as `-f` is read (links followed,
  `O_NONBLOCK`, a regular file, at most 1 MiB), decodes UTF-8 strictly and hands the text to
  `parseImport(text)`, which returns the entries or the first line that does not fit with a fixed
  reason. The grammar, every case, the reason chosen for each kind of wrong line, the names' rules
  and the limits are in [contracts/import.md](./contracts/import.md).
- **All or nothing** (research R9). Today one write is one whole file,
  `secrets/<serverId>/<app>.json`, holding every record and removal of that app on that server:
  `setSecret` appends one record and the store is written to a temporary file and renamed into
  place. `storeSecrets` seals and signs every record in one `withSigner`, checks the limits first,
  and writes the store once with all the new records appended. A failure before the rename stores
  nothing; after the rename every value is there.
- **What the person sees**: mock-up 4 at a terminal; plain lines without one; contracts/import.md.

## `zekno doctor`

- **This machine**: `zekno` (the two versions), `Key` (the profile names an entry, the keychain has
  it in a form this zekno reads), `Profile` (`openTeam` verifies; team list version), `This folder`
  (only with a `zekno.json` or a `compose.yaml`: the link's standing, read with `findProject` and
  `standingOf`, never `withProject`; the Compose file read with `readCompose`).
- **Each server**: `Reachable`, `Docker`, `Runner`, `Disk`, from two connections in SSH's batch
  mode, each within 20 seconds: `CHECK_SCRIPT` (a new fixed read-only script, research R11) and a
  session that asks only `version` and `status`.
- **Why it changes nothing**: every check is listed with what it reads in
  [contracts/doctor.md](./contracts/doctor.md). Nothing calls `save`, `accept`, `writeProject`,
  `withSigner`, or a runner command other than `version` and `status`; the script has no command
  that writes (no `mkdir`, `mv`, `rm`, `mktemp`, `curl`, `wget`, no redirection to a file) and
  runs nothing it found. A test snapshots every file of the profile folder, the project folder and
  the stand-in server, with modes, before and after each state (SC-005).
- **Results**: good, warning, problem, not checked; exit 0 with no problem, else 1. `--json`: one
  object (contracts/doctor.md); plain lines with tabs when piped.

## The version

`apps/cli/package.json` becomes `0.1.0`. `apps/cli/src/version/version.ts` imports it (`CLI_VERSION`), so
`Bun.build` bundles the version into `dist/zekno`; nothing reads a `package.json` at run time
(research R13). `zekno --version` and `zekno version` print mock-up 6's two lines, `--json` one
object, before anything opens the team ([contracts/version.md](./contracts/version.md)). `doctor`
shows the same two on its first line.

**The newer release** (research R14). `zekno version` then calls `checkNewest`, which asks
`GET https://api.github.com/repos/zekno-app/zekno/releases/latest` with fixed headers (`Accept`,
`X-GitHub-Api-Version: 2026-03-10`, `User-Agent: zekno`), no credentials, HTTPS redirects on
`api.github.com` only, one 3-second limit and at most 262,144 bytes of answer; takes only
`tag_name`, which must be `runner-v` and a prod version of the core's grammar; and compares it with
the release this zekno carries. One line follows: `✔ This is the newest release.`, `! A newer
release exists: <v>. Update zekno to get it.`, or, dim, `Could not check for a newer release.`;
the exit status stays 0. `doctor` makes the same check once, at the same time as its other
checks; a newer release makes its `zekno` line a warning with that sentence. Both `--json` objects
carry `latest`. The fetch is `deps.fetch`, set only by `main.ts`: with none, nothing is asked and
the result is "not checked", so no test and no other code path can reach the network.

## What does not change

A checklist for the review (T046) and the end checks (T049):

- [ ] Plain output and exit status of `init`, `server add`, `server update`, `server ls`, `secret set`, `secret rm`, `secret ls`, `deploy`, `rollback`, `status`, `logs`, `link` and `zekno` with no arguments and no terminal: the same lines, on the same stream, for every case the existing tests cover and for each missing detail in the tables above (FR-028, SC-006). The help text is the one exception (contracts/help.md).
- [ ] `--json` output of `deploy`, `rollback`, `status`: unchanged.
- [ ] Order of checks with no terminal: unchanged (a `zekno.json` problem, [NO-TEAM], then the operation's).
- [ ] The full-screen app: no file under `apps/cli/src/app/` changes; its tests and the agent end-to-end tests pass unchanged (FR-029).
- [ ] The runner: no file under `apps/runner/` changes; `apps/cli/src/runner-release.json` unchanged.
- [ ] The session protocol and `packages/core`: no change.
- [ ] No command but `zekno version` and `zekno doctor` calls `checkNewest` or `deps.fetch`; `zekno --version` does not; the full-screen app does not; nothing checks in the background or writes a cache.
- [ ] `INSTALL_SCRIPT`: byte for byte as at `03443f2` (a test pins its SHA-256); `installWords`, `runInstaller`, `parseInstallLine` unchanged.
- [ ] The signed link: a file not signed by the team is never used; one signed and not used here is asked about first, before any connection; `links.json` is written only by `accept` after a "yes" or `--yes`, and by `writeLink`; `zekno link` still refuses to overwrite without `--force`.
- [ ] A secret value is never an argument: `valueAsArgument` still refuses `zekno secret set NAME value`.
- [ ] Every existing `confirm` keeps its keys (Esc and Ctrl-C are no unless `{ leave: true }`).
- [ ] `server add` still says what it says today; the first deploy adds the server through the same operations.

## Order of work

1. **The version and the newer release** (Setup): `package.json`, `version.ts`, `zekno --version`,
   its help lines and docs, the compiled test; then `newest.ts`, `Deps.fetch`, and `zekno version`'s
   third line, its tests and docs. `doctor`'s use of it comes with US4.
2. **The building blocks** (Foundational): `Left`, the `Ui` members (plain and Ink, the components),
   type-ahead everywhere, `teamOnce.peek`, `withProject`'s `leaveAside`, `asking.ts` (the lists and
   their rows), `answering`.
3. **US1**: `deployAtTerminal` and its end-to-end tests; docs of `zekno deploy` at a terminal.
4. **US2**: the asking step for the other nine commands; both halves for each; docs.
5. **US3**: the reader, `storeSecrets`, `zekno secret import`, its help line and docs.
6. **US4**: `CHECK_SCRIPT`, `runDoctor`, `zekno doctor`, its help line and docs.
7. **Polish**: the root README, the security review, the pseudo-terminal walkthrough, the agent
   end-to-end run (the orchestrator's), the end checks.

Each phase leaves `bun test` in `apps/cli` green: a task that adds a usage line to `HELP` updates
both docs pages and, where needed, `docs.test.ts` in the same task.

## Risks

- **A script that runs zekno in a pseudo-terminal.** `expect`, `script`, `docker run -t` and some CI
  runners give a command a terminal on both ends. Such a script that relied on `zekno status`
  stopping with [MS] now gets a question and waits. Mitigation: documented (the Exit status and
  Output sections of both docs pages say to pass the flags, `--json`, or `< /dev/null` in scripts);
  `TERM=dumb` keeps the plain path. Not detectable from inside the program.
- **Type-ahead.** A key typed during a slow keychain read or a slow server read must not answer the
  next question. Every question and both hidden prompts discard first (research R3); the
  walkthrough checks it with keys written early, as feature 004's K12 did.
- **A value reaching a message through a parser error.** The reader is the only code that sees the
  text; its errors are built from a line number and a fixed reason, and every exception inside it
  is caught and turned into one. Tests put a recognisable value on every kind of wrong line and in
  every limit case, and look for it in standard output, standard error, the thrown error's message
  and stack, every file under the profile folder, and every argument given to `Bun.spawn`.
- **The `.env` file left on disk.** The import never deletes or changes it (deleting someone's file
  is not the import's business); the result says so in plain words, and the docs say to delete it
  or keep it out of git.
- **`doctor` on servers that need a password.** Batch mode never asks, so such a server is reported
  as "SSH needs an answer" with the way to answer it (the app), not as down; the person may read
  that as a failure of zekno. A server whose `sshd` accepts the connection and then stalls is cut at
  20 seconds per connection; with many servers four are checked at once.
- **Reading the server for the list of apps.** A command that never connected (`secret set`,
  `secret ls`, `link`) now makes one batch-mode connection at a terminal when the app is missing.
  It is read-only and limited to 20 seconds; on any failure the list comes from this machine's
  history. A lying server can offer app names (held to the app-name pattern); the person still
  chooses.
- **Holding the key during questions.** The first deploy holds the verified team, and the key in it,
  from the moment it is opened until the deploy ends, including while it waits for answers. Feature
  004 accepted the same for the first-use question ("Left"). Alternative: open the team again for
  each operation (one keychain read each, which can mean several keychain prompts on macOS).
- **The newer-release check.** It tells GitHub the address and time of each `zekno version` and
  `zekno doctor` run, and that zekno is running there (the `User-Agent`); the docs say so. A release
  published and not yet recorded in `runner-release.json` on `main` (before or without a matching
  second build, feature 005) is announced early. Unauthenticated requests are limited to 60 an hour
  per address; past that the line says it could not check. A proxy or a certificate this machine
  was made to trust can name a false version: the effect is one sentence, and nothing is
  downloaded. Bun's `fetch` honours the proxy variables of the environment, as the developer set
  them.
- **The first-deploy flow composes many operations.** A mistake in the order could sign before a
  question. Each operation is unchanged; tests assert, step by step, what exists on disk and on the
  stand-in server after leaving at each question.

## Complexity Tracking

No principle is violated. Nothing to justify.
