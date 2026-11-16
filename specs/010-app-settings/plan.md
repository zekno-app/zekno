# Implementation Plan: App settings

**Branch**: `010-app-settings` (from `dev`) | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-app-settings/spec.md`, the approved design in
[design.md](./design.md) and the boards in [design/](./design/), and the decisions made with the
maintainer on 2026-11-16 (summarised below; the file they were handed over in is binding).

## Summary

An app gets settings in a file of its own in the project, `zekno.app.json`, in the sections a
person coming from a managed platform knows: Source (the image), Deploy (start command, restart
rule, memory and processor limits), Networking (the port, and one to publish), Variables (secret
names and plain values) and Volumes (named volumes and where they are mounted). The file is JSON,
read strictly by a small reader of zekno's own that knows the line of every key, so a fault names
its place and never repeats the file's content (contracts/settings-file.md). The developer's
machine turns the settings into Compose text, written line by line with every name and value
double-quoted and every `$` doubled, the start command as a list of words split on this machine
(contracts/compose-text.md, research R2). That text is what a deploy checks, signs, sends and
records, exactly as a hand-written Compose file is today, so the runner, `packages/core` and every
message stay as they are. A deploy uses `-f`, then the file `zekno.json` names (which may now be
`zekno.app.json`), then the one file that exists; with both and nothing else it asks at a terminal
and stops with no terminal (contracts/deploy.md). `zekno settings` shows the settings in sections,
`set` and `unset` change one after showing the old and the new value and asking once, `compose`
prints the Compose text a deploy would sign, byte for byte, and `init` starts a file
(contracts/commands.md). In the full-screen app, `e` on an app's screen opens a settings screen
with the same sections, where a value is changed in place (contracts/app-screen.md). A setting
changed since this machine's last deploy is marked, by reading that deploy's Compose text back
into settings (research R4). A written change never leaves a half-written file, never goes
through a link and never overwrites a file that changed since it was read (research R5). The
design of the second version of the signed deploy message is written and independently reviewed
as a document; nothing of it is built.

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.4 (pinned in the root `package.json`)

**Primary Dependencies**: `@workspace/core`, Ink 8.0.0, React 19.3.1, zod 4.6.7 (all already in `apps/cli/package.json`), Bun built-ins (`Bun.YAML.parse` only to read back a Compose text zekno wrote, as `composeServices` already does). **No new dependency, service or file format** other than the settings file itself.

**Storage**: one new file in a project folder, `zekno.app.json`, written only when the person asks (`set`, `unset`, `init`, the screen). Nothing new in the profile folder; the history of deploys is read, never written differently

**Testing**: `bun test`. The reader and the Compose text case by case, with a test set of good and hostile files (`test/support/settings-files.ts`); commands through `inkUi` with the stand-in terminal (`test/support/terminal.ts`) and through the plain interface; deploys end to end against the stand-in server, the real runner and the stand-in Docker (`test/support/stand-in-server.ts`); the screen through `AppView` as the other screens are drawn; the reducer as a pure function; `test/plain/plain-unchanged.test.ts` unchanged in what it checks; an optional check with `docker compose config`, skipped where Docker Compose is not installed

**Target Platform**: the CLI on macOS and Linux; servers on Linux, reached over SSH, as today

**Project Type**: a command-line app in the Bun workspace (`apps/cli`); docs pages in `apps/web` (MDX content only)

**Performance Goals**: a newcomer with an image goes from an empty folder to a running app, with a start command, a port, one secret and one volume, in under 5 minutes (SC-001); reading a settings file of 64 KiB and writing its Compose text takes well under 100 ms

**Constraints**: the runner, `packages/core` and every message format unchanged (FR-029); with no terminal, every existing command in a folder with no settings file prints, writes, connects and exits as before (FR-028); the existing screens of the app unchanged but for `e` on the app screen (FR-030); no secret value in the file, any line, any screen or any error (SC-004); the Compose text the same bytes for the same settings on every machine (FR-009); no new option for `parseArgs` (research R8); `bun run lint` and `bun run format` clean (feature 009)

**Scale/Scope**: about 12 new source files in a new folder `apps/cli/src/settings/`, 6 more new files elsewhere (`ops/settings.ts`, `commands/settings.ts`, `ui/ink/settings-report.tsx`, `app/state/settings.ts`, `app/screens/settings.tsx`, `app/effects/settings.ts`), about 20 changed source files, about 20 new or extended test files, 3 docs pages, and 2 design documents

## Decisions made with the maintainer (2026-11-16)

| Decision | Choice |
|----------|--------|
| Direction | Settings in a file in the project; the developer's machine turns them into Compose text and signs that; a hand-written Compose file stays possible |
| The file | JSON, read strictly (zod `strictObject`s, as `zekno.json` is); named `zekno.app.json`, a file of its own, not part of `zekno.json` |
| Which file a deploy uses | `-f <file>` (either kind), then the file `zekno.json` names, then the one that exists; with both and nothing above, a question at a terminal and a stop in a script. Never a silent pick |
| Commands | `zekno settings`, `zekno settings set <service>.<setting> <value>`, `zekno settings unset <service>.<setting>`, `zekno settings compose`, `zekno settings init` |
| The screen | `e` from an app's screen; its keys `↑↓` move, `enter` change, `tab` services, `c` Compose text, `d` deploy, `esc` back |
| Volumes | A named volume only |
| Look and words | The five boards as drawn (look), design.md (words). What no board shows is built to the approved look without waiting, listed in the builders' reports, and reviewed on the real program (feature 010 only) |
| Stack | Bun 1.4.4, TypeScript, Ink 8 with React 19, zod, `bun test`. No new dependency |
| Scope | `apps/cli` and docs only. The runner and `packages/core` do not change; no message format changes; no runner release |
| Folders | A new folder `apps/cli/src/settings/`; commands in `commands/`, what they do in `ops/`, the screen in `app/screens/`, its reducer part in `app/state/`, its effects in `app/effects/`. The layering test passes with no new exception |
| Security | The file is possibly hostile content: one read from one open file with today's descriptor checks, bounded in size and counts, strictly parsed, duplicate keys refused; it can never hold a secret's value, name a path outside the project, mount a folder of the server, run a command on the developer's machine or include another file; errors name a place, never content; a value cannot break out of its place in the Compose text; a write is never half-written, never over a changed file, never through a link; every existing protection stays; an independent review of the new surface and of the deploy v2 document |
| Deploy v2 | A document, `deploy-v2.md`, read by an independent reviewer whose findings are recorded beside it (its part 12). Nothing of it is built |
| Tests | `bun test`; screens rendered through Ink; single commands through the stand-in terminal; `plain-unchanged.test.ts` green and `plain-at-head.ts` never edited; a byte-for-byte test of `zekno settings compose` against the signed deploy; the agent end-to-end tests run by the orchestrator |
| Git | Commits per phase on `010-app-settings`; nothing pushed or merged without the maintainer |

Where the spec, the design and the boards disagree, or are silent, research.md R9 says what was
chosen; R10 lists what cannot be met as written.

## Constitution Check

*GATE: checked before Phase 0 research and again after Phase 1 design. Both pass.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | Nothing reaches a hosted service, and nothing new reaches a server: what is signed and sent is a Compose text, as today, made on the developer's machine. The settings file holds secret names only; a value has no place in its grammar. The file is read as hostile content (one descriptor, size and counts bounded, strict UTF-8, duplicate keys refused, every field known) and its faults carry a place and a fixed rule, never its content (SC-005). Every name and value is double-quoted and escaped in the Compose text, and every `$` doubled, so no value can become a variable, a key, a tag, an anchor or a new line; the one variable the text asks for is a secret's `${NAME}`, with a checked name. A volume is written as `type: "volume"` and can never mount a folder of the server. Nothing in the file is run on the developer's machine; the start command runs in the container, without a shell. A write is checked against the bytes read, never goes through a link, and replaces the file whole. The signing key is used exactly as today, by a deploy; settings commands never sign. `zekno settings` reads the keychain once, to verify the history, only in a folder whose `zekno.json` is signed by the team and in use. | Pass |
| II. Honest Surface | "Runner" everywhere, never "agent". A later setting is refused with a sentence saying it is not in this version yet, never ignored. "Changed, not deployed" is shown only when this machine knows (research R4), and the docs say that a teammate's later deploy is not seen. The docs say what the settings cannot do (a folder of the server, a build, a domain), that a published port is on every address of the server, that removing a volume keeps its data, and that every member deploying a folder linked to `zekno.app.json` needs this zekno. "Pre-alpha and unaudited" stays on every page that has it (FR-031). | Pass |
| III. Read the Installed Docs First | No Next.js code changes (MDX content only). Ink's `useInput`, `Text` `wrap`, `Box` and `renderToString` are used as the code already uses them; Bun's `Bun.YAML.parse`, `TextDecoder` with `fatal`, `node:fs` `fsyncSync`, `linkSync` and `renameSync` as the code already does. Tasks that use an API name the installed docs to check (`node_modules/ink/readme.md`, `node_modules/.bun/bun-types@1.4.4/node_modules/bun-types/docs`). | Pass |
| IV. One Design System | The terminal keeps feature 004's justified deviation (the CLI's own theme, `ui/terminal/theme.ts`). The screen is built from the app's existing pieces (`Frame`, `Header`, `Trail`, `Pane`, `Marker`, `KeyHints`, `StateCell`, `NoticeLine`, `Confirm`-style box, `applyTextInput`, `applySelectKey`); single commands from `ErrorLine`, `ListPrompt`, `TypedPrompt`, the yes-or-no question. No new colour; every colour from the theme, light and dark. | Pass |
| V. Motion With Purpose | Nothing moves but the existing spinner while a deploy runs. | Pass |
| VI. Accessible and Fast by Default | Every state has words and a symbol (`!` for changed, `✖` for a fault), never colour alone; the screen fits 80 by 24 with a window that keeps the selected row in view; every key works from the keyboard and `esc` leaves any change. | Pass |
| VII. Verified Before Done | Unit tests for every branch: the reader case by case and a hostile test set, the Compose text byte for byte and a seeded random set, the writer, the reducer, every command at a terminal and piped, the deploy end to end. `typecheck`, `lint`, `test` from the root at the end without the cache, `bun run format` leaving no change, and `bun run compile` in `apps/cli`; `bun run build` (`next build`) is recorded as not run, by the maintainer's rule. The pseudo-terminal walkthrough records what was and was not seen, a light terminal included. | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/010-app-settings/
├── spec.md
├── design.md                  # the six approved decisions and the words (binding)
├── design/                    # the five approved boards (binding for the look)
├── plan.md                    # this file
├── research.md                # R1 to R10: decisions, the probes, contradictions (R9)
├── data-model.md              # the file, the settings as read, a change, the Compose text, the screen's state
├── quickstart.md              # how to check it; results are added as tasks complete
├── contracts/
│   ├── settings-file.md       # the grammar, the order of checks, every fault (SR, SJ, SV, SL), the writer's form
│   ├── compose-text.md        # each setting's lines, the worked example, escaping
│   ├── commands.md            # zekno settings, set, unset, compose, init; HELP; sentences (SH, C, IN)
│   ├── deploy.md              # which file, the question (DP1), the from line, the sentences (DP)
│   └── app-screen.md          # the settings screen, its keys, a change, the states no board shows (AS)
├── checklists/requirements.md
├── deploy-v2.md               # US5: drafted beside this plan, finished by T065; its part 12 holds T066's review
├── security-review.md         # written by T070
└── tasks.md
```

### Source Code (repository root)

```text
apps/cli/
├── src/
│   ├── settings/                      # new folder: the settings file, its reader, its writer, the Compose text
│   │   ├── types.ts                   # new: Settings, ServiceSettings, SettingsRead, SettingsFault, SettingPath, Change, SettingRow, SettingsReport, DeployText
│   │   ├── words.ts                   # new: every sentence and label of the contracts (SR, SJ, SV, SL, SH, C, IN, DP, AS), the words of a setting not set
│   │   ├── json.ts                    # new: readJson, a strict JSON reader that knows the line of every key
│   │   ├── values.ts                  # new: each value's rule; splitStart, joinStart; reading a value typed for `set` or the screen
│   │   ├── schema.ts                  # new: the shape as zod strictObjects; checkSettings, the order of checks; the rules across settings
│   │   ├── file.ts                    # new: SETTINGS_FILE, SETTINGS_BYTES, isSettingsFile, readSettingsFile
│   │   ├── text.ts                    # new: settingsText, the form zekno writes the file in
│   │   ├── compose.ts                 # new: quote, composeText, deployedSettings
│   │   ├── change.ts                  # new: parseSettingPath, applyChange, how a value reads
│   │   ├── rows.ts                    # new: reportOf, screenRows: the sections, rows and marks
│   │   ├── write.ts                   # new: writeSettings (a change), createSettings (init)
│   │   └── source.ts                  # new: chooseSource, readSource: which file a deploy uses, read once
│   ├── ops/settings.ts                # new: showSettings, prepareSettingChange, writeSettingChange, folderCompose, prepareInit, createFromAnswers
│   ├── commands/settings.ts           # new: settingsShow, settingsSet, settingsUnset, settingsCompose, settingsInit (draw and ask)
│   ├── cli/cli.ts                     # HELP (five lines), WORDS, `settings` grouped, WITHOUT_TEAM, dispatch, WrongInput printed without the help line
│   ├── cli/errors.ts                  # WrongInput: status 2, no help line
│   ├── ops/deploy.ts                  # prepareDeploy reads through chooseSource and readSource; DP2; the plan carries the services
│   ├── ops/link.ts                    # a new zekno.json without -f names the one file that exists; DP2 with both
│   ├── commands/deploy.ts             # deploy() gives DeployStart its `from`
│   ├── asking/asking.ts               # whichFile: the question DP1
│   ├── asking/first-deploy.ts         # the source chosen before the first question but the first-use one; F5 links that file; `from` in the summary
│   ├── shared/deploy.ts               # DeployStart.from, DeployProgress.fromDetail
│   ├── shared/views.ts                # lastDeployedCompose; verifiedDeploys takes the store and the trust only
│   ├── project/shown.ts               # shownFile, moved here from commands/deploy.ts (re-exported there)
│   ├── project/compose-read.ts        # the two byte readers exported for settings/file.ts; a Compose file read exactly as before
│   ├── ui/types.ts                    # settingsReport(report), settingChange(change)
│   ├── ui/plain/plain.ts              # both, as plain lines
│   ├── ui/ink/ink.tsx                 # both, at a terminal
│   ├── ui/ink/settings-report.tsx     # new: the report and the change line, as the board CmdSettings draws them
│   ├── ui/ink/deploy-live.ts          # the `from` of DeployStart into the panel
│   ├── ui/parts/deploy-summary.tsx    # the from row's dim detail
│   ├── app/state/types.ts             # the settings screen, ScreenChange, State.settingsView
│   ├── app/state/events.ts            # read-settings, write-setting; settings-read, setting-written, setting-refused
│   ├── app/state/settings.ts          # new: openSettings, onSettings, typeSetting, settingsRead, settingWritten, settingRefused
│   ├── app/state/app.ts               # `e`
│   ├── app/state/state.ts             # the screen's keys, its text question, its events, the tick, a deploy that ended
│   ├── app/state/reading.ts           # textQuestionOpen and refreshAllowed know the screen
│   ├── app/screens/settings.tsx       # new: the screen, the change box, the Compose text, the states no board shows
│   ├── app/screens/placeholder.tsx    # HINTS.app gains `e settings`; HINTS.settings
│   ├── app/app.tsx                    # the screen in the switch
│   ├── app/effects/settings.ts        # new: reading the file, the marks, writing a change
│   ├── app/effects/effects.ts         # runs read-settings and write-setting
│   └── app/effects/deploys.ts         # composeOf by the source rule; "remember this folder?" names the file deployed
└── test/
    ├── support/settings-files.ts      # new: the test set: design.md's file, good files, hostile files, each with its expected sentence
    ├── settings/json.test.ts          # new
    ├── settings/values.test.ts        # new
    ├── settings/schema.test.ts        # new: every sentence, the order of checks, the hostile set, no content in any error
    ├── settings/file.test.ts          # new: the descriptor checks, size, UTF-8, links, pipes
    ├── settings/text.test.ts          # new: design.md's example byte for byte, one change one line
    ├── settings/compose.test.ts       # new: the worked example, each setting, escaping, a seeded random set, reading back, docker compose config when present
    ├── settings/change.test.ts        # new
    ├── settings/write.test.ts         # new: whole or nothing, a changed file, a link, a read-only folder, create never over a file
    ├── settings/rows.test.ts          # new: rows, words, marks
    ├── settings/source.test.ts        # new: the four rules, every combination of files and flags
    ├── ops/settings.test.ts           # new: show with and without a usable link, marks from a stand-in history, no fetch, no server
    ├── commands/settings.test.tsx     # new: the five commands at a terminal and piped, the board CmdSettings
    ├── scenarios/settings-deploy.test.ts  # new: deploy end to end, byte for byte, both files, faults, link, rollback, status, logs
    ├── asking/first-deploy.test.ts    # the question DP1, F5 naming the file, values asked
    ├── app/settings-state.test.ts     # new
    ├── app/settings-screen.test.tsx   # new
    ├── app/settings-effects.test.ts   # new
    ├── app/app-operate.test.tsx       # the app screen's hint line with `e settings`
    ├── ui/parts/ui-parts.test.tsx     # the summary's from row
    ├── layers/layers.test.ts          # settings/ in LAYOUT and in rule 3
    ├── plain/plain-unchanged.test.ts  # ADDED_TO_HELP gains the five lines
    ├── version/version.test.ts        # the five commands never fetch
    └── docs/docs.test.ts              # keys read from both contracts

apps/cli/README.md, apps/web/content/docs/cli.mdx, README.md      # docs
```

**Structure Decision**: no new package. One new folder, `apps/cli/src/settings/`, named for its
subject (constitution 1.3.0, "Code in folders"), holding everything about the settings file
that needs neither a team nor a terminal: its words, its reader, its writer, the Compose text and
which file a deploy uses. What uses the team or the history is in `ops/settings.ts`; what draws
and asks in `commands/settings.ts`, `ui/ink/settings-report.tsx` and `app/`. Tests mirror the
folders; the end-to-end deploy crosses subjects and is in `test/scenarios/`.

## Which way imports point (rules of specs/007-code-in-folders)

`settings/` is one of the folders the rest is built on, with `shared/`, `server/`, `project/`,
`profile/`, `secrets/` and `version/` (rule 3): it imports nothing from `app/`, `commands/`,
`asking/` or `ops/`, and from `ui/` nothing (it needs not even `ui/types.ts`). It imports
`project/` (`compose-read.ts`'s byte readers, `file.ts`'s `isAbove`, `shown.ts`), `server/`
(`sanitize`), `cli/errors.ts` and `@workspace/core` (`SECRET_NAME`, `isReservedSecretName`,
`LIMITS`). Nothing in `project/` imports `settings/`, so the two folders do not import each
other. `ops/`, `commands/`, `asking/` and `app/` import `settings/`.

The layering test changes in three places, and gains no exception:

- `LAYOUT` gains `"settings"`;
- `BASE` (the folders of rule 3) gains `"settings"`, and rule 3's text names it: `3. shared/,
  server/, project/, profile/, secrets/, settings/ and version/ import nothing from app/,
  commands/, asking/ or ops/, and from ui/ only ui/types.ts.`;
- "the checker itself" gains `broken("settings/compose.ts", "ops/settings.ts")` giving `["3."]`.

Rule 5 (nothing `cli/cli.ts` imports statically loads Ink or React) holds: `settings/`,
`ops/settings.ts` and `commands/settings.ts` import neither; `ui/ink/settings-report.tsx` is
reached only through `ui/ink/ink.tsx`, which `main.ts` loads with `import()`. The walk in
`test/asking/asking.test.ts` checks it.

## Which file a deploy uses, and where that is decided

```text
-f <file> given? ──yes──▶ name is zekno.app.json? ──yes──▶ settings (links followed, as -f)
     │                                         └─no──▶ Compose file, as today
     no
     ▼
zekno.json signed, in use, its app deployed? ──yes──▶ the file it names, by its name (inside its folder)
     │
     no (none, not signed: left aside at a terminal / S1 in a script, not in use: first-use question first)
     ▼
compose.yaml here?   zekno.app.json here?
   yes, no  ─▶ Compose file, as today
   no, yes  ─▶ settings
   no, no   ─▶ today's "No Compose file at ..." 
   yes, yes ─▶ at a terminal DP1 (Esc: Nothing was done, 1); no terminal DP2, status 2
     ▼
read once ─▶ settings: checked whole, then composeText ─▶ the text a deploy signs, as today
```

`chooseSource` and `readSource` (`settings/source.ts`) are the only code that decides; they are
called by `prepareDeploy` (plain path), `deployAtTerminal` (which asks DP1 itself, through
`whichFile`, before calling them with the answer), `linkFolder` (the default of a new
`zekno.json`) and the app's `composeOf`.

## What does not change

A checklist for the security review (T070) and the end checks (T073):

- [ ] `packages/core`: no file changes. `git diff --stat f0f8303 -- packages/core` prints nothing.
- [ ] The runner: no file under `apps/runner/` changes; `apps/cli/src/version/runner-release.json`
      unchanged; no runner release. `git diff --stat f0f8303 -- apps/runner apps/cli/src/version/runner-release.json`
      prints nothing.
- [ ] Every message format: the session protocol, the signed deploy, the signed link, the secret
      records and removals, the team list (`packages/core/src/protocol/`, `deploy/`, `secrets/`,
      `team/`), the history and the profile files: no schema changes. Checked by the first item,
      and by `git diff f0f8303 -- apps/cli/src/profile` touching no schema.
- [ ] Plain output and exit status of every command that existed, with no terminal, in a folder
      with no settings file: `test/plain/plain-unchanged.test.ts` passes, with only the five new
      lines of `HELP` added to `ADDED_TO_HELP`; `plain-at-head.ts` unchanged (`git diff --stat
      f0f8303 -- apps/cli/test/plain/plain-at-head.ts` prints nothing).
- [ ] `--json` of `deploy`, `rollback`, `status`: unchanged.
- [ ] No new option in `parseArgs`: an option unknown before is still refused with status 2.
- [ ] The app: no screen changes but the app screen's hint line (`e settings`); help unchanged;
      every existing app test passes, the two hint-line tests updated as research R7 says.
- [ ] The signed link: every rule of feature 004 and 006 holds (a file not signed by the team is
      never used; one signed and not used here is asked about first, before any connection;
      `links.json` written only by `accept` after a yes or `--yes`, and by `writeLink`).
- [ ] Secrets: no value in the settings file, the Compose text, any output, any screen or any
      error; `zekno secret set NAME value` still refused.
- [ ] `INSTALL_SCRIPT` and `CHECK_SCRIPT`: byte for byte as before (their tests pin them).
- [ ] No command but `zekno version` and `zekno doctor` calls `deps.fetch`
      (`test/version/version.test.ts`, with the five new commands in its table).

## Phases

1. **Setup**: the folder `settings/` with its types and the layering test; the byte readers of
   `compose-read.ts` exported; `WrongInput`.
2. **Foundational**: the words, the JSON reader, the values, the schema, the file reader; the
   writer's form; the Compose text and reading it back; a change; writing; the rows and marks;
   which file a deploy uses. Each with its tests first. Everything else needs them.
3. **US1, deploy from settings**: `prepareDeploy`, `zekno link`, `zekno deploy` at a terminal and
   its question, the summary's `from` row, the app's `d`. End-to-end tests.
4. **US2, seeing them**: `zekno settings` (the report, both halves); then the screen, reached with
   `e`, showing the settings and every state.
5. **US3, changing one**: `set`, `unset`, `init`; then changing a value on the screen.
6. **US4, knowing what runs**: `zekno settings compose` and the byte-for-byte test; then `c` on
   the screen.
7. **US5, the shape of what comes next**: `deploy-v2.md`, and its independent review.
8. **Polish**: the docs, the independent security review, the pseudo-terminal walkthrough of each
   board, the agent end-to-end run (the orchestrator's), the end checks.

Each phase leaves `bun test` in `apps/cli` green, `bun run lint` clean and `bun run format`
leaving no change. A task that adds a line to `HELP` adds it to both docs pages, to
`ADDED_TO_HELP` and to the table of `test/version/version.test.ts` in the same task.

## Risks

- **A value breaking out of its place in the Compose text.** The one way to sign something the
  person did not mean. Mitigation: every string double-quoted with two escapes and `$` doubled,
  no character in the settings that YAML would treat specially inside quotes (R1's character
  rule), a seeded random test that reads every value back, a test per hostile case, the optional
  `docker compose config` check, and the security review.
- **The reader showing a piece of the file.** Faults are built from line numbers, names that
  passed their rule and fixed words only; every exception inside the reader is caught and
  turned into one. Tests put a sentinel in every wrong place of every hostile file and look for
  it everywhere output can go.
- **A teammate on an older zekno.** A folder linked to `zekno.app.json` deployed by a zekno from
  before this feature signs the JSON as Compose text; Compose refuses it on the server and the
  app does not start (research R3). The docs say so; nothing secret is exposed.
- **A write racing another program.** Checked right before the rename; a write in the few calls
  between is lost (research R5). Rare; stated in the docs.
- **The hint line at 100 columns.** It wraps to two lines; the app screen's body loses a row
  (research R7). One recorded end-to-end step starts on that screen and is expected to replay;
  at worst it calls the model once.
- **"Changed, not deployed" missing a teammate's deploy.** Only this machine's history is read
  (research R4). Stated in the docs; nothing is marked when it cannot be known.
- **Published ports.** Compose publishes on every address, and Docker's published ports can pass
  host firewalls such as `ufw`. The docs say so; settings publish nothing unless `publish` is set.
- **The start command without a shell.** A person used to a platform that runs it in a shell
  writes `a && b`; it is refused on this machine with a sentence that says how (`sh -c`), never
  sent.

## Complexity Tracking

No principle is violated. Nothing to justify.
