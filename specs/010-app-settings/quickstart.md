# Quickstart: checking app settings

How to see each part of the feature work, and where the results are recorded. The contracts say
what is expected; this page says how to look. Nothing here contacts a real server: servers are
the stand-ins of `apps/cli/test/support/stand-in-server.ts`, and the real keychain is never used.

## Prerequisites

- Bun 1.4.4, from the repository root: `bun install --frozen-lockfile`.
- macOS or Linux, `/bin/sh`.
- Optional: Docker Compose (`docker compose version`), for the check that reads every Compose text
  with `docker compose config`; it contacts nothing, and the test is skipped without it.
- For the walkthrough: Python 3 for the pseudo-terminal driver (as in
  specs/006-cli-small-features/quickstart.md), kept in the scratchpad, not in the repository.

## 1. Automated checks

```bash
cd apps/cli
bun test test/layers                                               # settings/ is held to rule 3 (Phase 1)
bun test test/settings test/shared                                 # the file, its reader and writer, the Compose text (Phase 2)
bun test test/scenarios/settings-deploy.test.ts test/asking test/app/app-effects.test.ts   # User Story 1
bun test test/ui/ink/settings-report.test.tsx test/ops/settings.test.ts test/commands/settings.test.tsx   # US2 and US3, commands
bun test test/app/settings-state.test.ts test/app/settings-effects.test.ts test/app/settings-screen.test.tsx test/app/app-operate.test.tsx   # US2 to US4, the screen
bun test test/scenarios/settings-compose.test.ts                   # User Story 4, byte for byte
bun test test/plain test/version test/docs                         # what does not change; commands, flags, keys and docs in step
bun test                                                           # everything in apps/cli
bun run lint && bun run format && git diff --stat                  # no finding, no change
```

From the root, at the end: `bun run typecheck --force`, `bun run lint --force`,
`bun run test --force`, and in `apps/cli` `bun run compile`.

Expected: every test passes; `bun test` in `apps/cli` passes after every phase.

## 2. The scenarios the tests prove

One line per acceptance scenario of spec.md, then the edge cases.

| Story | Scenario | Expected | Contract | Test |
|-------|----------|----------|----------|------|
| US1.1 | A folder with only design.md's `zekno.app.json`; `zekno deploy` | deployed with each setting; signed text = contracts/compose-text.md's 594 bytes; ends as a deploy does | deploy.md | T026 |
| US1.2 | Two services | both in one Compose text; each reaches the other by its name (one Compose network) | compose-text.md | T016, T026 |
| US1.3 | A secret with no value | asked hidden at a terminal; with no terminal, as today (research R9, item 1) | deploy.md | T029, T026 |
| US1.4 | Both files, nothing says which | DP1 at a terminal; DP2 and status 2 with none; `-f` and `zekno.json` decide; never silent | deploy.md | T024, T026, T029 |
| US1.5 | A later setting (each of five) | nothing deployed; SL1 to SL5 | settings-file.md | T010, T026 |
| US1.6 | Not in the right form (unknown field, wrong type, too large, a bad name) | nothing deployed or written; one sentence naming the place, no content | settings-file.md | T010, T012, T026 |
| US1.7 | Rollback, status, logs after a settings deploy | each as for any deploy | deploy.md | T026 |
| US2.1 | `zekno settings` | services, sections in a fixed order, secrets by name | commands.md | T035, T039 |
| US2.2 | `e` on the app's screen | the same sections and values; the keys on the hint line | app-screen.md | T041, T045 |
| US2.3 | No settings file | SH1 | commands.md | T037, T039 |
| US2.4 | A folder deployed from a Compose file | SH2, nothing invented; on the screen too | commands.md, app-screen.md | T037, T043, T045 |
| US2.5 | Piped, `--json` | plain tab lines, or one object; asks nothing; no secret value | commands.md | T035, T039 |
| US3.1 | `set` at a terminal | old and new, one question; yes writes one change, no writes nothing | commands.md | T051 |
| US3.2 | Changing on the screen | the file holds the change; the screen shows the new value | app-screen.md | T055, T057, T059 |
| US3.3 | A value not allowed | one sentence (CS7 / the rule on the screen); the file untouched | commands.md, app-screen.md | T051, T055 |
| US3.4 | No terminal | written only with `--yes`; else CS10 | commands.md | T051 |
| US3.5 | A change written, not deployed | `! changed, not deployed (was …)` beside it, on the command and the screen | commands.md, app-screen.md | T022, T037, T043, T045 |
| US3.6 | The file changed between read and write | not overwritten; CS12, try again | commands.md, app-screen.md | T020, T051, T057 |
| US4.1 | `zekno settings compose` | the Compose text; no secret value | commands.md | T061 |
| US4.2 | The same file read twice (two runs, two machines) | the same bytes | compose-text.md | T016, T061 |
| US4.3 | Save the text as `compose.yaml`, remove the settings file | it deploys as before | commands.md | T061 |
| US5.1 | A later feature adds build, domains, a health check, a pre-deploy command | each has its reserved place; a file valid today stays valid | settings-file.md | T010; T065 |
| US5.2 | The deploy v2 document | for each later setting: what is signed, what the runner checks, what a hosted service can and cannot change | deploy-v2.md | T065 |
| US5.3 | The changes of this feature | no message format, core or runner file | plan.md, "What does not change" | T073 |
| Edge | Settings, Compose file and a `zekno.json` naming the Compose file | the Compose file, no question; a flag wins | deploy.md | T024, T026 |
| Edge | The file is a link elsewhere, not a regular file, too large, changed while read | SR9, SR2, SR3, SR6 | settings-file.md | T012 |
| Edge | A cloned repository's file: a path outside, a server folder, hundreds of services, a later field | SV28/SV29, SV3, SL; nothing written or sent | settings-file.md | T004, T010 |
| Edge | A service renamed or removed between deploys | the old one is not left running (`--remove-orphans`) | deploy.md | T026 |
| Edge | A secret retired, named twice, or a name zekno keeps | asked for again; SV20; SV19 | settings-file.md | T010, T029 |
| Edge | A plain variable with a secret's name; two services publishing one port | SV25; SV16 | settings-file.md | T010 |
| Edge | A volume removed | its data kept; the docs say how to remove it | deploy.md | T026, T067 |
| Edge | The screen open while the file is edited | the screen follows the file; a change confirmed after is refused | app-screen.md | T043, T057 |
| Edge | 80 columns, too small | fits with a window; the "too small" message | app-screen.md | T045, T059 |
| Edge | First deployed from Compose, now from settings, and back | each deploy signs its own text | deploy.md | T026 |

## 3. The pseudo-terminal walkthrough (T071)

Each board of design/ against the real program, at 100 by 30 and at 80 by 24, with a Python driver
that reads the terminal the whole time and keeps a model of its cells (character, colour, bold,
dim, inverse), as feature 006's walkthrough did. The driver runs a small script in the scratchpad
that calls `run(argv, deps)` from `apps/cli/src/cli/cli.ts` with `inkUi()` and `memoryKeyStore()`,
and `openApp` from `apps/cli/src/app/app.tsx` for the full-screen app, so the real keychain is
never touched; `ssh` is the stand-in of `sshStandIn`, first on `PATH`, in front of a stand-in
server whose release is the real runner with the stand-in Docker; `deps.fetch` is a stand-in.

| Board | Steps | What to compare |
|-------|-------|-----------------|
| `SettingsFile` | `zekno settings init` in an empty folder (image, Enter for `web`), then the settings of design.md written with `zekno settings set` one by one | the file `init` writes; after the sets, the file equals design.md's text byte for byte; `zekno settings` reads it |
| `CmdSettings` | design.md's file, linked to `demo` on `prod`, deployed once with memory `512m`, then memory `1g` in the file; `zekno settings`; `zekno settings set web.memory 1g` then `y` (with memory first set back); `zekno settings set web.memory lots`; `zekno settings compose`; `zekno settings \| cat`; `zekno settings` in an empty folder | every line, column and colour of the board's left and middle columns; the piped lines; SH1; status 2 for `lots` with no help line |
| `SettingsDeploy` | `zekno deploy` in a folder with only the file; then with both files, Enter, Esc; `zekno deploy < /dev/null` with both; a file with `networking.domains`; a file with `deploy.memory` `lots`; a file with an unknown field on line 9 | the panel with `from  zekno.app.json  2 services: web, worker` (detail dim); DP1, its rows and hint line; `✔ From  zekno.app.json`; `✖ Nothing was done.`; DP2 and status 2; SL5; SV11; SV6 with `(line 9)` |
| `AppSettings` | the app opened in that folder; Home, Enter on `demo`, `e`; `↓` to memory; `tab`; `c`; `esc`; again at 80 by 24; again on a light terminal (the driver answers the background question with a light colour) | every line, column and colour; the mark on memory with `(was 512m)`; at 80 by 24 the window and its `more` lines; the light theme's colours |
| `AppSettingsEdit` | on the settings screen, `enter` on memory, type `lots` and Enter, then fix it to `1g` and Enter, then `y`; again with `n`; again with Esc while typing; `enter` on restart | the box at each stage; the rule in the warning colour; `y write it  n keep 512m  esc back`; the file after `y`; nothing written after `n` or Esc |
| The states no board shows | the screen in a folder with no settings file, with only `compose.yaml`, linked to another app, with a fault, with both files; the file edited by the driver while the screen is open; the window made 70 by 20 and back | each sentence and its look; the screen following the edit; the "too small" message and the screen coming back as it was |
| SC-001 | an empty folder, a profile with `prod`: `zekno settings init`, `set web.start "bun run start"`, `set web.port 3000`, `set web.secrets DATABASE_URL`, `set web.volumes.data /data`, `zekno deploy` (the value typed when asked) | the app running on the stand-in server; the time from the first command to the result line |

Record for each: passed, or what differed, with the screen as the driver read it; every look and
sentence of research R9, items 10 to 28, that was reached; and what was not checked.

## 4. The agent end-to-end tests (T072, the orchestrator's)

`cd apps/cli && bun run test:e2e`, once. Only `tests/rollback.e2e.ts` passes through the app
screen whose hint line changed; its recorded step is expected to replay (research R7). A step that
does not replay calls the model once (a few cents). `e2e.config.ts` is not changed.

## 5. Checks at the end (T073)

- `bun run typecheck --force`, `bun run lint --force`, `bun run test --force` from the root.
- `bun run format` from the root, then `git diff --stat`: no change.
- In `apps/cli`: `bun run compile`, then `./dist/zekno settings compose` in a folder with
  design.md's file prints the 594 bytes of contracts/compose-text.md.
- `bun run build` (`next build`) is not run, by the maintainer's rule; recorded as not run.
- `git diff --stat f0f8303 -- packages/core apps/runner apps/cli/src/version/runner-release.json apps/cli/test/plain/plain-at-head.ts`
  prints nothing.

## Results

Added by the tasks as they complete.

### Phase results

(not yet run)

### The pseudo-terminal walkthrough

Run 2026-11-16 at `2272197` (branch `010-app-settings`), macOS, Bun 1.4.4. A Python driver
(`pty.fork()`, a `select` loop reading the whole time, keys one at a time, a screen model of every
cell) ran a scratchpad script that calls `run` (`cli/cli.ts`) with `inkUi()`, or the plain
interface where `main.ts` would pick it, and opens the app as `main.ts` does (`loadStart`,
`detectBackground`, `openApp`). Test-only dependencies: `memoryKeyStore()`, a temporary profile,
`prod` at `deploy@203.0.113.7` reached only through a stand-in `ssh` in front of the stand-in
server (the real runner, the stand-in Docker), a stand-in fetch (never called). `TERM=xterm-256color`,
`COLORTERM=truecolor`, `CI` unset; 100 by 30 and 80 by 24, the settings screen once on a light
terminal. 133 sessions and 312 captures, kept in the scratchpad (`walkthrough-010/captures`),
with `screens.md` there holding every screen no board shows. Deploy numbers, durations and
temporary paths depend on the set-up and are not differences. Every session ended with the cursor
shown, raw mode off and the alternate screen left; none hung; every exit status was the
contract's.

| Board | Sizes | Ran | Result |
|---|---|---|---|
| `SettingsFile` | both | `settings init` in an empty folder (image, Enter keeps `web`), then design.md's web settings with `set ... --yes` one by one, then `zekno settings` | Matched: `init` writes `settingsText` of the answers; after the sets the file is design.md's `web` service byte for byte, and `zekno settings` reads it. `set` cannot add `worker` (CS4, status 2), as the contract says, so the two-service file itself cannot be built by commands. |
| `CmdSettings` | both | the design's file linked to `demo` on `prod`, deployed 4 times with `512m`, now `1g`: `settings`, `--json`, `\| cat`; memory back to `512m`, `set web.memory 1g`, `y`, `settings`; `set web.memory lots`; `compose` at a terminal and piped; a folder with no file | Matched line by line, both sizes (every line fits 80): columns 2, 16 and 26; service bold brand, sections bold, labels dim, values text, the mark yellow; change line (`web · memory limit` dim, `→` dim, new bold), CS9 with `yes`, CS11 (`✔` green, detail dim); CS7 bold then dim, status 2, no help line; Compose text dim; piped lines and `--json` exactly the contract's; piped `compose` = the 594 bytes. One difference (1). |
| `SettingsDeploy` | both | `zekno deploy` linked, file only, to the end; one service; a Compose deploy; both files: Enter, `↓` Enter, Esc, Ctrl-C; no terminal with and without `--app --server`; a domain; memory `lots`; an unknown field on line 9 | `from` row matched (label dim, file text colour, two spaces, detail dim; `1 service: web`; no row for a Compose file); DP1 matched (`?` brand, question bold, `❯` brand, chosen bold, details dim, hint keys text and words dim), then `✔ From  zekno.app.json`; Esc and Ctrl-C `✖ Nothing was done.`, status 1; SL5, SV11, SV6 `(line 9)` matched (`✖` red, bold, rule dim set in by two), nothing connected; DP2 with `--app --server` matched (plain, status 2, no help line, no `ssh`). One difference (2). |
| `AppSettings` | both, light | Home, Enter on `demo`, `e`; `↓↓↓`; `↓` to the end; `↑`; `tab`, `tab`; `c`, scroll to the end, `↑`, `c`, `c`, `esc`, `esc`; light terminal; 70 by 20, 79 by 23 and back | 100 by 30 matched line by line: header (`› prod › demo` dim, `settings` bold, `● running` green, `deploy 4` dim), Services pane (22 wide, dim border, title bold dim, `❯` brand, name bold, AS2 dim), service pane (brand border, title bold, file dim, headings bold, labels dim, selected bold, `not published` dim, the mark yellow, rule and AS1 dim), hint line. 80 by 24 as the contract: state alone, window with `↓ 5 more` / `↑ n more`, selected row kept in view, every line at most 80 columns and 24 lines. Light: brand `#1a73d1`, no other fixed colour. Too small: the app's message; the screen and an open change came back as they were. |
| `AppSettingsEdit` | both | `enter` on memory (`512m`), `lots` Enter, `1g` Enter, `n`; again with Esc at asking, Esc while typing; `y`; `enter` on restart, `↓`, Enter; empty memory; empty image; `worker` published port; `d` | The asking step at 100 by 30 matched: one pane with a dim border, its section, the box with a brand border, `Change a setting` bold and `web · memory limit` dim, `now`/`new` dim with the new value bold, CS9 (`?` brand, first sentence bold, `(y/N)` dim), `y write it  n keep 512m  esc back`. The refusal is yellow set in by two. File after `n` and Esc unchanged, after `y` `1g` with the mark; `d` deployed and the mark went. At 80 by 24 every stage fits. One difference (3). |

Differences:

1. `CmdSettings`, a folder with no settings file, at a terminal (look). Board (its right column):
   `This folder has no settings file. Run zekno settings init to start one.`, one line, text
   colour. Program: `✖ This folder has no settings file.` (red, bold) and
   `  Run zekno settings init to start one.` (dim). Piped, it is the board's one line. The board's
   line stands in its explanation column, so this may be intended.
2. `SettingsDeploy`, both files, no terminal, no `-f`, no link and no flags (words). Board and
   DP2: `This folder has zekno.app.json and compose.yaml. Say which with -f <file>.` Program:
   ``Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.``
   then the help line, status 2. DP2 is said only with `--server` (and `--app`); contracts/deploy.md
   rule 4 does not say which comes first.
3. Type-ahead on the screen's write question: a `y` written 3.2 ms after the Enter that opens
   the question, before the question reached the terminal (7.0 ms), answered it and the file was
   written. The command's question throws such keys away (checked: `y` and Enter written before
   anything was drawn left CS9 open). app-screen.md "As built" item 12 says "a key typed ahead
   never writes"; a `y` typed ahead does.
4. Look, no board, contract ambiguous: contracts/app-screen.md, "Words", says the words of a
   setting not set are dim, "also the `<old>` and `<new>` of a change". In the change box
   `now  no limit` is in the text colour and `new  no limit` bold (the board draws the new value
   bold); in `unset`'s change line `→ no limit` is bold.

Known deliberate differences, confirmed as drawn: R9 item 3 (`(was 512m)` on the command too);
item 4 (the Compose text in R2's quoted form); item 5 and the board's own caption (the deploy
panel is today's: title `Deploy n` in its border, `app demo` not bold, `server prod` with no
address, `secrets 2`, stages `Checked Signed Sent Started`, `demo is live on prod in 0.1s`);
item 6 (no Services pane during a change); item 7 (DP1's label column 16 and rows set in by two,
as every list); item 9 (two spaces in the change line); item 14 (the caption not printed);
commands.md "As built" (value column 26); app-screen.md "As built" items 1 to 3, 6, 15 and 16
(label at 2 and value at 13; Services 22 wide with no line under its title; one space before
`deploy 4`; SH1 split bold then dim; the box's title inside it, `now`/`new` padded to 5, no empty
lines; restart rules bold when chosen, dim when not), 24 (SH2 on the screen where the commands say
SH3), 26 and 27 (AS9 with 52 and 80 more lines; the box cut to one line each with 47 more).

R9 items 10 to 28 reached: 10 (`e settings` after `x remove secret`, two rows at both sizes),
11, 12 (`on failure`, `3000, not published`, `3000, published on 8080`, `NAME=value`, volumes),
13, 14, 15, 16, 17 (`web.memory` and `web.deploy.memory`), 18 (`PATH` as a plain variable), 19
(`&&` refused), 20, 21 (`zekno link` with both: DP2 at a terminal; the app's `d`: DP5), 22, 23,
24 (`expose: ["3000"]`), 25, 26 (a `zekno.json` nobody signed: no app, no marks, no warning), 27.
Item 28 is in the docs, not on a screen.

Security fixes seen: SH3 (every command, status 1; `init` says IN4), IN6 apart (a warning after
the settings and the Compose text, a dim note after `init`), IN7, DP6 (nothing deployed, the
screen read again), AS8 on the command and the screen, AS9 at both sizes with `c` reaching the
value's end, SV9 (g) and SV24's second rule in the file and typed (CS7).

SC-001: an empty folder and a profile with `prod`; `settings init`, `set web.start "bun run start"`,
`set web.port 8080` (not 3000: the walk keeps clear of that port), `set web.secrets DATABASE_URL`,
`set web.volumes.data /data`, `zekno deploy` with the value typed when asked: 4.1 s from the first
command to the result line, answers typed by the driver at once.

Not checked: the two-service file built by commands (CS4); CS13 and CS14; the reader's SR
sentences; DP1 with no profile; the security review's folders A and C (a sub-folder, a link naming
`deploy/zekno.app.json`); the screen before its first read (the read was too fast to see); the
light theme at 80 by 24; a real terminal emulator (only the screen model); a real server.

### The agent end-to-end tests

(not yet run)

### Checks at the end

(not yet run)
