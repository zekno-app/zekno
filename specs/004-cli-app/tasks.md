# Tasks: The Zekno Terminal App

**Input**: Design documents from `/specs/004-cli-app/`

**Tests**: included. The constitution requires tests for logic with branches, and SC-008 requires the earlier security tests to keep passing.

**Organization**: grouped by user story. Paths are relative to the repository root.

**Design reference**: https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW. All four rows are approved: rows 1 to 3 on 2026-11-13, and the seven boards of row 4 on 2026-11-14.

## Phase 1: Setup

- [X] T001 [P] Add apps/cli/src/runner-release.json (`{ "version": "0.2.0", "files": { "linux-x64": { "sha256": null }, "linux-arm64": { "sha256": null } } }`) and a strict loader in apps/cli/src/runner-release.ts: `version` matches `^[0-9]+\.[0-9]+\.[0-9]+$`, each `sha256` is 64 lowercase hex characters or `null`
- [X] T002 [P] Set the runner's version to 0.2.0 in apps/runner/package.json and add `compile:linux-x64` and `compile:linux-arm64` scripts (`bun build --compile --target=bun-linux-x64|arm64`)
- [X] T003 [P] Add the `brand-darker` token (`#1a73d1`) beside `brand` in packages/ui/src/styles/globals.css, and apps/cli/src/ui/theme.ts: the terminal's own text colour for normal text, dim for secondary, green/red/yellow for state, `brand` (`#2383e2`) on a dark terminal and `brand-darker` on a light one, chosen by asking the terminal for its background colour at start and assuming dark when it does not answer; selection is shown by the marker and bold text, never by a background

## Phase 2: Foundational (blocks every story)

- [X] T004 Add to packages/core/src/protocol.ts, export from packages/core/src/index.ts and test in packages/core/test/scenarios/messages.test.ts: `RunnerVersion` `{ version, protocol }`; `SessionRequest` `{ command, input? }` with `command` one of `setup`, `sync`, `apply`, `status`, `state`, `logs`, `version`; `SessionFrame` (either `{ event, … }` or `{ result }`); `ProgressEvent` (`line` at most 4096 characters); `LogEvent` `{ service, time, line }` (`line` at most 16384 characters, `time` RFC 3339); `RunnerAppStates`; `RunnerLogsRequest` `{ app, tail }` with `tail` 0 to 1000. All strict. `service` matches `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$`; `state` is one of `running`, `exited`, `created`, `restarting`, `paused`, `dead`, `removing`, `unknown`; `health` is `healthy`, `unhealthy`, `starting` or empty
- [X] T005 Capture Docker's output line by line through a callback in apps/runner/src/compose.ts and pass it through `apply` in apps/runner/src/commands.ts; one-shot `apply` keeps writing it to standard error
- [X] T006 Implement `zekno-runner session` in apps/runner/src/session.ts and `version` and `session` in apps/runner/src/main.ts, following contracts/session.md: one request at a time, each through the same code as its one-shot command, three unreadable lines in a row end the session with exit status 1, a deploy in progress finishes when the input closes
- [X] T007 Tests for the session in apps/runner/test/session.test.ts: several requests on one process, progress events before an `apply` result, a refusal for an unreadable line, exit after three, `apply` completing after the input closes, and every refusal test of apps/runner/test/refusals.test.ts repeated through a session
- [X] T008 [P] Implement apps/cli/src/sanitize.ts (remove terminal control characters and escape sequences from text that came from a server) with tests in apps/cli/test/sanitize.test.ts covering colour codes, cursor movement, OSC 52 clipboard writes, hyperlinks and a lone escape byte
- [X] T009 Implement the session client in apps/cli/src/session.ts: start the runner once, send requests, validate frames, read up to the message size limit, clean event text with apps/cli/src/sanitize.ts, and fall back to one-shot commands when `session` exits with status 2; tests in apps/cli/test/session.test.ts
- [X] T010 Move what each command does into apps/cli/src/ops/ (deploy.ts, server.ts, secret.ts, status.ts): operations take callbacks for stages and progress, return results, draw nothing, and reach a server through one session of apps/cli/src/session.ts per command (FR-034); apps/cli/src/commands/*.ts become an operation plus the `Ui`. All tests in apps/cli/test/ pass unchanged
- [X] T011 [P] Implement the pixel wordmark in apps/cli/src/ui/logo.ts: the 5-row bitmap of "zekno.app" drawn with half-block characters, 41 columns by 3 lines, "zekno" in the text colour and ".app" in the brand blue; test in apps/cli/test/logo.test.ts that every line is 41 columns and the bitmap matches the canvas letter shapes
- [X] T012 [P] Implement apps/cli/src/ui/panel.tsx (a box with a title on its top line), stages.tsx (the stage row) and key-hints.tsx, with `renderToString` tests in apps/cli/test/ui-parts.test.tsx
- [X] T013 [P] Implement apps/cli/src/ui/select.tsx, text-input.tsx and confirm.tsx with their key handling as pure functions (as apps/cli/src/ui/secret-input.ts does) and tests in apps/cli/test/ui-inputs.test.ts
- [X] T014 Implement the app shell: apps/cli/src/app/state.ts (pure reducer: screen stack, selection per screen, which keys do what per contracts/app.md), apps/cli/src/app/effects.ts (runs operations, dispatches results), apps/cli/src/app/app.tsx (alternate screen, window size, header with the logo and "pre-alpha, unaudited", key hints, restores the terminal on every exit path); open it from apps/cli/src/main.ts when there are no arguments and a terminal, and print the help with exit status 2 when there is no terminal
- [X] T015 Tests for the reducer in apps/cli/test/app-state.test.ts: every key in contracts/app.md on every screen, a key that does nothing is ignored, letters type into an open question, `q` during a deploy waits

## Phase 3: User Story 1 - Operate my servers and apps from one screen (P1) 🎯 MVP

**Independent Test**: `bun test apps/cli/test/app-operate.test.tsx`, then the pseudo-terminal walkthrough in T024

- [X] T016 [P] [US1] Implement Home in apps/cli/src/app/screens/home.tsx as on canvas board "Home": servers pane, apps pane (deploy number and when; the state column shows "unknown" until US3), details and actions pane, the linked-folder line
- [X] T017 [P] [US1] Implement the app screen in apps/cli/src/app/screens/app.tsx as on canvas board "One app: deploys and secrets": deploy history from the verified local history, secrets by name and version, the selected deploy's details, the note for a secret newer than the running deploy
- [X] T018 [US1] Implement the deploy screen in apps/cli/src/app/screens/deploy.tsx as on canvas board "A deploy in progress": summary panel, stage row, live line, `o` for Docker's output, the failure form with what Docker reported; `esc` leaves without cancelling and the result arrives as a line on the previous screen
- [X] T019 [US1] Wire deploy (`d`) and rollback (`r`) from Home and the app screen to apps/cli/src/ops/deploy.ts in apps/cli/src/app/effects.ts, including "waiting for deploy <n> to finish" on quit
- [X] T020 [US1] Implement setting and removing a secret in apps/cli/src/app/screens/set-secret.tsx with the hidden prompt rules of apps/cli/src/ui/secret-input.ts (echo off before the question is drawn, multi-line refused, empty not stored, Ctrl-C cancels the prompt only) and a confirm before removing
- [X] T021 [US1] Show an unreachable server on Home without blocking the others, in apps/cli/src/app/effects.ts and apps/cli/src/app/screens/home.tsx
- [X] T022 [US1] Tests in apps/cli/test/app-operate.test.tsx: each of the three screens rendered at 100 columns contains the wording, symbols and keys of its canvas board; deploy, failed start, rollback, set and remove a secret driven through the reducer and effects against a real runner process with a stand-in Docker
- [X] T023 [US1] (canvas: "Help", approved 2026-11-14) implement the help screen in apps/cli/src/app/screens/help.tsx and its test
- [X] T024 [US1] Walk through User Story 1 in a pseudo-terminal that reads continuously (open, move, open an app, deploy, leave during a deploy, roll back, set a secret, quit) and record what was and was not checked in specs/004-cli-app/quickstart.md

## Phase 4: User Story 2 - From nothing to a running app without leaving the app (P2)

**Independent Test**: `bun test apps/cli/test/install.test.ts apps/cli/test/first-run.test.tsx`

- [X] T025 [US2] Change the runner's default folder in apps/runner/src/home.ts: `ZEKNO_RUNNER_HOME` if set, else `/var/lib/zekno` if it exists or the user is root, else `~/.local/state/zekno`; tests in apps/runner/test/runner.test.ts
- [X] T026 [US2] Implement the install script and its steps in apps/cli/src/install.ts following contracts/commands.md "Installing the runner over SSH": fixed script text; only the version (digits and dots), the architecture (`x64` or `arm64`) and the SHA-256 (64 hex characters) are put into it, each checked against its pattern first; root installs to `/usr/local/bin/zekno-runner` and `/var/lib/zekno`, another user to `~/.local/bin/zekno-runner` and `~/.local/state/zekno`; nothing is installed unless the checksum matches
- [X] T027 [US2] Tests in apps/cli/test/install.test.ts that run the script with `sh` in a temporary home against stand-in `uname`, `curl`, `docker` and `sha256sum`: fresh install, runner already at the right version, no Docker, unsupported processor, download failure, checksum mismatch leaves nothing installed, and a value that does not fit its pattern never reaches the script
- [X] T028 [US2] Extend `server add` in apps/cli/src/ops/server.ts and apps/cli/src/cli.ts: install when no runner is found, `--runner-path` to use an installed one, `--runner-file <path>` (development) to send a local runner and check its SHA-256 on arrival, then setup and adding to the team list in the same session; "no published runner to install" when apps/cli/src/runner-release.json has no checksum
- [X] T029 [US2] Implement `zekno server update <name>` in apps/cli/src/ops/server.ts and apps/cli/src/cli.ts: asks at a terminal, needs `--yes` without one, never updates unasked
- [X] T030 [P] [US2] Implement first run in apps/cli/src/app/screens/welcome.tsx as on canvas board "First run: no team yet": the logo, three steps, the name question, where the key is kept
- [X] T031 [US2] Implement "add a server" in apps/cli/src/app/screens/add-server.tsx as on canvas board "Add a server": destination and name, each step as it completes, the team code and server code each with its sentence, `o` for details
- [X] T032 [US2] Hand the terminal over when SSH has to ask a question, in apps/cli/src/app/effects.ts: try batch mode first, and only when that fails for a password or host key use Ink's `suspendTerminal` until the runner's first frame arrives
- [X] T033 [US2] (canvas: "Two questions the app asks", approved 2026-11-14) show the "runner is out of date" notice and the `u` key on Home and wire it to the update operation, in apps/cli/src/app/screens/home.tsx
- [X] T034 [P] [US2] Add .github/workflows/runner-release.yml following contracts/commands.md "The release workflow": runs on a `runner-v*` tag, builds linux x64 and arm64, gzip, `SHA256SUMS` of the unpacked binaries, attaches them to a GitHub Release; no secrets beyond the default token
- [X] T035 [US2] Tests in apps/cli/test/first-run.test.tsx: from no profile to a connected local runner through the reducer and effects; a runner set up for this team by an earlier attempt is carried on from; a runner of another team stops with nothing changed; an older runner is reported and not updated unasked

## Phase 5: User Story 3 - See what is running and read the logs (P3)

**Independent Test**: `bun test apps/runner/test/inspect.test.ts apps/cli/test/state-logs.test.tsx`

- [X] T036 [US3] Implement `state` and `logs` in apps/runner/src/inspect.ts and wire them into apps/runner/src/session.ts: `docker compose -p zekno-<app> ps --all --format json` reduced to service, state, exit code and health; `docker compose logs --follow --timestamps --no-color --tail <n>` parsed into `LogEvent`s; only for apps the runner has accepted a deploy for; stops when the input closes
- [X] T037 [US3] Extend the stand-in Docker in apps/runner/test/helpers.ts to answer `ps` and `logs`, and test in apps/runner/test/inspect.test.ts: running, stopped and partly running; labels and commands never reach the answer; an unknown app is refused; an app name outside the pattern never reaches Docker; logs end when the reader goes away
- [X] T038 [US3] Add state to apps/cli/src/ops/status.ts and logs in apps/cli/src/ops/logs.ts; an app is running when every service is `running`, stopped when none is, partly running otherwise, unknown when the runner is too old or unreachable
- [X] T039 [US3] Show state on Home and the app screen with a word and a symbol as well as a colour, refreshed every 5 seconds while either is showing and never while a question is open, in apps/cli/src/app/effects.ts and the two screens
- [X] T040 [US3] Implement the logs screen in apps/cli/src/app/screens/logs.tsx as on canvas board "Live logs": time, service, text; follow and pause (`f`), filter (`/`), one service (`1`–`9`, `0`); at most 2000 lines kept; the line saying logs do not pass through Zekno; a notice and a way to reconnect when the connection drops
- [X] T041 [US3] Add `zekno logs [--app] [--server] [--tail <n>] [--no-follow]` and the state cell of `zekno status` in apps/cli/src/cli.ts and apps/cli/src/commands/
- [X] T042 [US3] Tests in apps/cli/test/state-logs.test.tsx: state shown on both screens; a log line with escape sequences is drawn as plain text; filter, pause and one-service view through the reducer; nothing is written to disk by a logs session; plain `zekno logs` prints `<time>\t<service>\t<text>`

## Phase 6: User Story 4 - A project that remembers where it deploys (P4)

**Independent Test**: `bun test apps/cli/test/project.test.ts apps/cli/test/compose-file.test.ts`

- [X] T043 [P] [US4] Implement apps/cli/src/project.ts: find `zekno.json` in the current folder then each parent, stopping at the home folder or the filesystem root; strict schema `{ app, server, compose }` with `app` and `server` matching `^[a-z0-9][a-z0-9-]{0,62}$` and `compose` a relative path inside the file's folder with no `..`; write it only when asked; tests in apps/cli/test/project.test.ts including malformed files, unknown fields, a path that escapes the folder, and an unknown server or app name
- [X] T044 [P] [US4] Implement apps/cli/src/compose-file.ts with `Bun.YAML.parse`: a name is expected when a service's `environment` lists it with no value, or the file uses `${NAME}` or `$NAME` without a default; names with a default and reserved names are left out; a file it cannot read yields no names, not an error; tests in apps/cli/test/compose-file.test.ts
- [X] T045 [US4] Read defaults from `zekno.json` in apps/cli/src/cli.ts for `deploy`, `rollback`, `status`, `logs` and `secret`; flags win; a missing detail fails naming the flag and the project file; add `zekno link [--app] [--server] [-f] [--force]`
- [X] T046 [US4] Open the app focused on the linked server and app, and list missing values before a deploy with the choice to set each or go ahead, in apps/cli/src/app/effects.ts and apps/cli/src/app/screens/set-secret.tsx as on canvas board "Set a secret"
- [X] T047 [US4] (canvas: "Two questions the app asks", approved 2026-11-14) ask before writing `zekno.json` on the first deploy of a folder, in apps/cli/src/app/screens/deploy.tsx
- [X] T048 [US4] Tests in apps/cli/test/project-flow.test.tsx: `zekno deploy` with no flags in a linked folder; flags override the file; the app opens focused; missing values are listed and can be set or skipped

## Phase 7: User Story 5 - Single commands that match, and still work in scripts (P5)

**Independent Test**: `bun test apps/cli/test/single-commands.test.tsx`

- [X] T049 [US5] Add a deploy view to the `Ui` in apps/cli/src/ui/types.ts, ink.tsx and plain.ts: at a terminal the summary panel, stage row and result line of canvas board "zekno deploy: success and failure", with what Docker reported on a failed start; plain mode prints only the result line and, on a failed start, Docker's lines on standard error
- [X] T050 [US5] Style `status`, `secret ls`, `server ls` and errors at a terminal as on canvas board "Status, lists, errors and piped output" in apps/cli/src/ui/ink.tsx and apps/cli/src/commands/
- [X] T051 [US5] Apply the two plain-output changes of contracts/commands.md in apps/cli/src/commands/: "`<k>` secrets", "1 secret" or "no secrets"; and the state cell in `status`; update the tests that assert the old lines
- [X] T052 [US5] Tests in apps/cli/test/single-commands.test.tsx: terminal output rendered with `renderToString` matches the canvas wording; piped output has no colour, symbols or panels; a command without a terminal never asks and names the flag; `zekno` with no arguments and no terminal prints the help; `deploy`, `status` and `server add` each open one session (counted)

## Phase 8: Polish & Cross-Cutting

- [X] T053 (canvas: "Home at 80 columns" and "One app at 80 columns", approved 2026-11-14) arrange Home and the app screen at 80 columns in apps/cli/src/app/screens/home.tsx and app.tsx, with `renderToString` tests at 80 columns
- [X] T054 (canvas: "Terminal too small", approved 2026-11-14) implement the message in apps/cli/src/app/app.tsx for a window under 80 by 24, returning to the same screen when there is room
- [X] T055 (canvas: "Home on a light terminal", approved 2026-11-14) implement background detection in apps/cli/src/ui/background.ts (ask the terminal with OSC 11, short timeout, assume dark) with tests for the answer parser, and apply the colour rules of apps/cli/src/ui/theme.ts to every screen
- [X] T056 (canvas: "Profile could not be verified", approved 2026-11-14) implement the error screen for a profile that does not verify in apps/cli/src/app/screens/profile-error.tsx
- [X] T057 [P] Confirm every test of apps/cli/test/hardening.test.ts, journey.test.ts, secret-input.test.ts and apps/runner/test/refusals.test.ts still passes, and extend the "no key and no value in any file" test of apps/cli/test/journey.test.ts to a run that used the app, logs and state
- [ ] T058 Independent internal security review of the new surface (session mode, the install script and `--runner-file`, state and log text reaching the terminal, `zekno.json`, the release workflow), fix every finding rated high or critical, and record all findings in specs/004-cli-app/security-review.md
- [X] T059 [P] Update apps/cli/README.md and apps/runner/README.md to describe exactly what exists: the app and its keys, every command, `zekno.json`, the install route and its limits, the session command
- [X] T060 [P] Update the public docs in apps/web/content/docs/ (a CLI page and a runner page, and the status table of index.mdx) and the repository table and roadmap in README.md
- [X] T061 Add apps/cli/test/docs.test.ts: every command in the CLI's help and every key in contracts/app.md is named in apps/cli/README.md and the CLI docs page, and nothing named there is missing from the CLI (SC-010)
- [X] T062 Walk through every screen in a pseudo-terminal at 100 and at 80 columns, compare each with its canvas board, compile both programs with `bun run compile`, and record the results in specs/004-cli-app/quickstart.md
- [X] T063 With the maintainer's go-ahead, run "A real server" from specs/004-cli-app/quickstart.md against the maintainer's server using `--runner-file`, including one deploy timed against feature 003, and record the result
- [X] T064 Run `bun run typecheck`, `bun run lint` and `bun run test` from the repository root and record the totals in specs/004-cli-app/quickstart.md

## Maintainer steps (not tasks for the implementer)

1. Done 2026-11-14: the seven boards of the fourth canvas row are approved.
2. Confirm each of the nine approved screens against the running app (SC-007).
3. When ready for a first runner release: push the tag `runner-v0.2.0`. The workflow from T034 publishes the files; the SHA-256 values are then recorded in apps/cli/src/runner-release.json in a commit of their own.
4. Commit and create the feature branch when you choose. Nothing is committed or pushed until you ask.

## Dependencies & Execution Order

Setup → Foundational → US1. US2, US3, US4 and US5 each need only the Foundational phase and can follow in any order; they are listed by priority.

- T004 comes before T006, T009 and T036. T005 before T006. T006 before T007 and T009.
- T010 comes before every screen and every command change.
- T014 and T015 come before any task in apps/cli/src/app/screens/.
- T026 before T027 and T028. T036 before T037 and T038. T043 and T044 before T045 and T046.
- Within the CLI, tasks that touch apps/cli/src/cli.ts (T028, T029, T041, T045) are done one after another.

## Parallel Opportunities

- Setup: T001, T002, T003.
- Foundational: T008, T011, T012 and T013 are separate files and can go alongside T004 to T007.
- US1: T016 and T017 are separate screens.
- US2: T030 and T034 are independent of the install work.
- US4: T043 and T044.
- Polish: T057, T059 and T060.

## Implementation Strategy

MVP is Phases 1 to 3: the app operating an existing team and server, which already replaces the long commands. US2 then removes the manual server setup, US3 adds state and logs, US4 the project file, and US5 brings the single commands into line. Each phase leaves every test green.

Totals: 64 tasks. Setup 3, Foundational 12, US1 9, US2 11, US3 7, US4 6, US5 4, Polish 12.
