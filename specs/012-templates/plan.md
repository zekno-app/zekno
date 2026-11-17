# Implementation Plan: Templates

**Branch**: `012-templates` (from `dev`) | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-templates/spec.md`, its Clarifications of
2026-11-17 (the Redis way approved the same day), the four approved boards in
[design/](./design/), and the maintainer's answers to this plan of 2026-11-17 (an index file; D1 to
D33 approved, D27 changed; FR-002 reworded), after which the boards were redrawn.

## Summary

A template is one JSON file inside the CLI (`apps/cli/src/templates/files/<name>.json`), named
on one line of an index beside it (`files/index.ts`), that describes one or more services of feature 010's settings file, the passwords they need, the
connection secret it offers to the app's own services, and its author. The first set is PostgreSQL
18.7, MySQL 9.7, MongoDB 9.0 and Redis 8.10 (images `18.7`, `9.7.4`, `9.0.8`, `8.10.3`), each the
official image pinned by digest
(research R3, R4; every one started with real Docker on 2026-11-17). A file is read by a strict
reader of zekno's own, built on feature 010's JSON reader, and its `services` part is checked by
the settings file's own rules, so a template can say nothing a settings file cannot
(contracts/template-file.md). `zekno add <template>` finds the settings file a deploy of this
folder would sign by feature 010's rule, finds the app and server as `zekno secret set` does,
checks every clash (a service, a volume, a variable, a secret the app has), shows what it will add
as the board draws it, asks once, then makes the passwords on this machine, seals them, writes the
file and stores the secrets, whole or not at all (research R7; contracts/commands.md). Nothing is
deployed and nothing is contacted. A folder that deploys a hand-written Compose file gets the
lines to add and, if the person agrees, the secrets. `--list` and `--show` look without a team. A
contributor copies a file, adds its line to the index, runs `bun run test:templates`, and opens a
pull request that one new
workflow checks with a read-only token and no secret; a docs page is built from the same files
(contracts/contributing.md). `packages/core`, the runner and every message stay as they are.

## Needs the maintainer

Nothing waits for the maintainer. The one open question (N1: how the template files reach the
compiled CLI) was answered on 2026-11-17: **an index file**, one line per template, with a test that
fails when the folder and the index differ (research R1; contracts/template-file.md, "The index").
The macro this plan first recommended is not used, and the layering test needs no special case.
FR-022 and SC-009 now say "one new file and one line in the index". No task is blocked.

## Design choices, approved by the maintainer

What the boards did not show, or showed in a way that could not be built as drawn. The maintainer
approved D1 to D33 on 2026-11-17 as planned here, with one change: D27 follows `zekno settings`,
not the board. The boards were then redrawn for D1, D2, D3 and D27 (design/README.md). The tasks
that build each are in brackets.

| # | Choice | As approved |
|---|--------|---------------------------|
| D1 | **Volume names.** A Compose volume is the whole app's: the boards' `data` would be one volume for every service that mounts `data`, so postgres then mysql, or postgres in an app whose `web` keeps uploads in `data`, would share it and lose data (research R5). | A template keeps naming its volume `data`; adding names it `<service>-<volume>` in the app (`postgres-data`; `db-data` with `--name db`). A name already in the app is refused with AD9 (new). The redrawn boards show `postgres-data`. [T016, T023, T033, T044] |
| D2 | **Postgres 18's data path.** The boards mount `/var/lib/postgresql/data`; the 18 image refuses to start with a volume there (research R3). | `/var/lib/postgresql`, the image's declared volume, proven; the redrawn boards show it. [T009] |
| D3 | **Versions.** The first boards' were examples. | PostgreSQL 18.7, MySQL 9.7.4 (the `lts` tag), MongoDB 9.0.8 (`latest`), Redis 8.10.3, each pinned by its index digest (research R3). Shown as the redrawn boards show them, PostgreSQL 18.7, MySQL 9.7, MongoDB 9.0, Redis 8.10: that is each file's `software`, and the image tag is it or starts with it and a dot (TF30). [T009] |
| D4 | **MySQL's settings** (no board). | Makes `MYSQL_ROOT_PASSWORD` and `MYSQL_PASSWORD`; `MYSQL_USER=app`, `MYSQL_DATABASE=app`; offers `DATABASE_URL` = `mysql://app:{MYSQL_PASSWORD}@{service}:3306/app`. Not `MYSQL_RANDOM_ROOT_PASSWORD`, which prints the password to the log. [T009] |
| D5 | **MongoDB's settings** (no board). | Name `mongodb`, also `mongo` (the board's example); `MONGO_INITDB_ROOT_USERNAME=app`, makes its password; offers `MONGODB_URI` (the name MongoDB's drivers' docs use) = `mongodb://app:{...}@{service}:27017/app?authSource=admin`; a second note, `Your app connects as the database's administrator.`, since the image makes only an administrator without a mounted init script. [T009] |
| D6 | **Redis's connection secret.** | `REDIS_URL` (board) = `redis://default:{REDIS_PASSWORD}@{service}:6379`, the user named, which every current client reads; volume `data` at `/data`. [T009] |
| D7 | **One connection secret, two templates.** postgres and mysql both offer `DATABASE_URL`, so the second of them added to one app is refused by the secret that exists (AD5). | Accept for this version; the docs say so. [T053] |
| D8 | **The order of the list and the picker.** | The four of the first set in the boards' order (postgres, mysql, mongodb, redis), then any other by name. [T012] |
| D9 | **A name that is no template's.** The board shows only a name in `also`. | AL3's second form `Run zekno add --list to see them.`; a name that breaks the name rule is not repeated (AL4). [T035] |
| D10 | **`HELP`'s three lines** (contracts/commands.md, "Usage"). | As written there, after `zekno settings init`. [T029, T035] |
| D11 | **Usage sentences** AU1 to AU10 (no board). | As written in contracts/commands.md. [T029, T035] |
| D12 | **The picker**: its middle column (`PostgreSQL 18.7`) is new to the one-row list, and its line left behind is not drawn. | `ListRow` gains `column`; left behind `✔ Template  postgres`. [T033, T035] |
| D13 | **Who reads the connection secret, at a terminal**: the board shows `web` picked, not why. | It opens with the first service picked; Enter with none picked shows AD11 and stays open; left behind `✔ Read by  web, worker`. [T020, T021] |
| D14 | **AD12 and AD14** (the board says only "it stops and names the flag"). | `<file> has several services. Say which read <NAME> with --for <service>.`; `<file> has no service named <svc>. Its services are ...` [T016, T051] |
| D15 | **"Nothing was added."** for a no, Esc or Ctrl-C at `zekno add`'s own questions, dim, status 1; the app and server questions keep today's `✖ Nothing was done.` | As planned. [T029] |
| D16 | **AD4's status.** The board lists refusals with status 2 in one column and the script sentence in another. | AD4 is status 1, as every "no terminal to ask on" sentence. [T052] |
| D17 | **The hand-written path's cases no board shows**: piped without `--yes` (AH8, status 1), a no (AH9, `No secret was made.`), `--for` refused (AU10), the lines printed bare (no box) when piped. | As planned; `$` written `$$` in a start command (research R10). [T044, T048, T050] |
| D18 | **`--list --json`, `--show` piped and `--show --json`** (the board says only "`--json` gives the list, or one template, as data"). | As written in contracts/commands.md. [T033, T035] |
| D19 | **Several services in one template**: what `{service}` and `--name` mean. | `{service}` is the first service's name in the app; `--name` is refused for a template of several (AU9). The first set has one each. [T014, T016] |
| D20 | **A template that asks** (AD28, TF4). | `<template> asks a question when it is added.` / `Questions are not in this version of zekno yet. They come with domains.` [T004, T008] |
| D21 | **Added settings that break a settings rule** (too many services, a file past 64 KiB). | AD15: `<service> cannot be added to <file>.` and the settings sentence's place and rule. [T016] |
| D22 | **The secret store's own cases**: AD19 (the file could not be put back), AD20, AD21, AD24, AD25. | As written; AD24 and AD25 as I13 and I14 with `Nothing was added.` [T025, T027] |
| D23 | **"A client connects" for any template** cannot be generic: each database speaks its own protocol. And the board's test lines are drawn by `bun test`'s own reporter. | A client per template of the first set in `test/templates/clients.ts`; a template without one gets every other check and a skipped test naming the reviewer's step. Test names as the board; marks and times `bun test`'s. [T036] |
| D24 | **What "notes" and "Good to know" show.** | The summary shows each note after `!`; `--show` shows AV3 (in place of the backup note), AV4, then the other notes. The list and picker show `about` without its full stop. [T023, T033] |
| D25 | **Digests printed whole** in `--show` and the hand-written lines (the boards, redrawn too, shorten them to `2ea8…1bbc`): a person copies or checks them. | Whole. [T033, T044] |
| D26 | **A start command in the summary** (Redis's): no board. | Not in the summary; `--show` has it in the Deploy section, and the docs page says what it does. [T023] |
| D27 | **AD8 and AD13**: the first board gave them status 2, where `zekno settings`'s CS12 and SH1 are 1. | **Changed by the maintainer**: status 1, as `zekno settings`; AD21, of AD8's kind, is 1 too. The redrawn `AddOther` says so. [T025, T027] |
| D28 | **"The app has this template already"** is known by a secret it makes or offers being the app's (the board's AD5 names that secret). | As planned. [T025] |
| D29 | **The check pulls the images from Docker Hub** on every pull request (its Docker part). | Accept; MS4 in contracts/contributing.md. [T039] |
| D30 | **Blank lines.** The boards set blocks apart by 12 px; a terminal has whole lines only, and the summary must fit 80 by 24. | No empty line between the blocks of the summary and of `--show`. [T023, T033] |
| D31 | **Counts in words** the boards show for one (`a service`, `a secret`, `its two secrets`). | Digits for several (`Adds 2 services`), `from them` for several made secrets, AH6's count a word from two to nine. [T023, T046] |
| D32 | **The boards' white that is not bold** (`data` in `data kept in volume data`). The theme has nothing brighter than the text colour but bold. | The text colour. [T023] |
| D33 | **MongoDB's `/data/configdb`**, a volume the image declares and a single server leaves empty, is an anonymous volume. | Leave it; research R4 and the docs page say so. [T009, T053] |

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.4 (pinned in the root `package.json`)

**Primary Dependencies**: `@workspace/core`, Ink 8.0.0, React 19.3.1, zod 4.6.7 (all already in `apps/cli/package.json`); Bun's built-ins (`crypto.getRandomValues`, `node:fs`, its `text` loader for the index's imports); feature 010's `settings/` reader, writer and Compose text. **No new dependency, tool, library or file format** other than the template files, which are JSON read by the existing reader. In `apps/web`, Next.js 16 and fumadocs as installed.

**Storage**: the template files, inside the CLI. A template's services go into the project's `zekno.app.json` (feature 010's format); its secrets into the profile's secret store as sealed records (`zekno secret set`'s format). Nothing else.

**Testing**: `bun test`. The reader with good and hostile fixtures (`test/support/template-files.ts`); each shipped file (TT1, TT2); the addition as a pure function; the commit with a failure injected at each step; the command through `inkUi` with the stand-in terminal and through the plain interface; the layering test, `plain-unchanged.test.ts`, the version test, the docs test; `bun run test:templates` with real Docker (TT3); an end-to-end scenario with the local runner and real Docker (SC-008); the workflow file read by a test; the docs page's list by a test in `apps/web`.

**Target Platform**: the CLI on macOS and Linux; servers on Linux x86-64 and ARM64 (each image's index holds both); GitHub's `ubuntu-24.04` for the check.

**Project Type**: a command-line app in the Bun workspace (`apps/cli`), a page of the docs site (`apps/web`), one workflow, one guide.

**Performance Goals**: SC-001, a database added and deployed in under 2 minutes; reading the catalogue (four files of about 1.4 KiB) well under 50 ms; `zekno add --list` printing in under 300 ms like any command.

**Constraints**: no message format, `packages/core` file or runner file changes (FR-018, SC-007); every existing command with no terminal behaves exactly as before (FR-019, SC-006); no network and no server contacted (SC-005); no made value anywhere but its sealed record (SC-002); whole or nothing (SC-004); the Compose text of an app with a template is `composeText`'s (FR-020); `bun run lint` and `bun run format` clean; files under 500 lines.

**Scale/Scope**: one new source folder (`apps/cli/src/templates/`, about 12 files and 4 data files), 3 new files elsewhere in `apps/cli/src` (`ops/add.ts`, `ops/add-commit.ts`, `commands/add.ts`) and 3 in `ui/ink/`, about 12 changed source files, about 20 new or extended test files, 1 workflow, 1 guide, 1 docs page with its component, and the docs of the CLI.

## Decisions made with the maintainer (2026-11-17)

| Decision | Choice |
|----------|--------|
| Where templates live | Inside the CLI, one data file each, entering by a reviewed pull request, shipping with a release; nothing downloaded or read from the project or profile |
| What a template adds | Services of `zekno.app.json`, checked by its rules; with a hand-written Compose file, lines printed and nothing edited |
| The command | `zekno add <template>`, with `--name`, `--for`, `--app`, `--server`, `--yes`, `--list`, `--show`, `--json` (boards) |
| The first set | PostgreSQL, MySQL, MongoDB, Redis, each the official image; Redis itself, not Valkey |
| Redis's password | Its start command writes the password from the secret into a file only Redis can read, then starts Redis with it (approved 2026-11-17) |
| No server yet | Say to run `zekno deploy` first; change nothing |
| Removing | Not in this version; the developer edits the file; the volume is never deleted |
| Once per app | One of each per app, because a secret's name is the app's |
| Questions (`asks`) | Kept in the format, refused until domains |
| Several services | The format allows it; the first set has one each |
| Contributions | By pull request: one file and its line in the index, a guide, an automatic test of every template, a docs page crediting authors, a maintainer's review, a release |
| The check | One workflow on `pull_request`, `permissions: {}`, `contents: read` on the job, actions pinned to full commits, no secret, `persist-credentials: false`; typecheck, lint, tests, template tests; required check is the maintainer's setting |
| Starters | Not in this feature |
| How template files reach the CLI (N1, after the plan) | An index file, `templates/files/index.ts`, one line per template, and a test that fails when the folder and the index differ; FR-022 and SC-009 say one file and one line |
| The plan's design choices (after the plan) | D1 to D33 approved as planned, but D27: AD8 and AD13 (and AD21) are status 1, as `zekno settings` |
| Allowed images (FR-002, after the plan) | A Docker Official Image, from a list of allowed sources kept in the repository |
| Look and words | The four boards, binding, as redrawn on 2026-11-17 after the plan |
| Stack | Bun, TypeScript, Ink with React, zod, `bun test`, ESLint and Prettier at 80 columns. No new dependency |

## Constitution Check

*GATE: checked before Phase 0 research and again after Phase 1 design, and again after the maintainer's answers of 2026-11-17. All pass.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | Nothing reaches a hosted service or a server: adding is local (FR-010, SC-005). A made password is made on this machine from the system's random source, sealed and signed at once by `createSecret` as `zekno secret set` does, and kept nowhere else: not in the settings file, a line, an error, a log, an argument or a returned value (research R6; SC-002, tested with a sentinel random source). A template is reviewed data inside the CLI, read strictly anyway (known fields, size and counts bounded, duplicate keys refused, its services by the settings rules, faults naming places only); it cannot run code, fetch, mount a folder of the server, publish a port, read a secret the user sets, or name an image that can change (contracts/template-file.md, "What a file can never do"). The image is pinned by digest and from an allowed publisher. Every template fails closed without its password (research R4). The password never reaches a command line in the container, also for Redis (`$$`, proven) and in the hand-written lines (research R10). Adding is whole or nothing (research R7). The check on GitHub runs with a read-only token and no secret. No signing key is held anywhere new. | Pass |
| II. Honest Surface | "Runner" everywhere, never "agent". What is shown before adding says Zekno does not back up the data and where it is kept; `--show` and the docs say the image changes only with a new zekno (FR-016; research R15 item 4 notes the summary's board). Refusals say why and what to do. The docs page keeps the "Pre-alpha and unaudited" callout; every page that has one keeps it (FR-017). The docs say what cannot be undone in the one window of research R7, that two templates offering `DATABASE_URL` cannot share an app (D7), and that MongoDB's app user is its administrator (D5). The check's limits are stated: it runs a pull request's own copy of the tests (contracts/contributing.md, CG8). | Pass |
| III. Read the Installed Docs First | The docs page's component follows `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` ("Predictable values": module-scope synchronous reads are prerendered); no other Next.js code changes. Bun's `text` loader and dynamic imports were probed for the index (research R1). Ink's `useInput`, `Text`, `Box` as the code already uses them. Tasks that use an API name the installed docs to check. | Pass |
| IV. One Design System | The terminal keeps feature 004's justified deviation (`ui/terminal/theme.ts`); the new drawings are built from `Panel`, the field rows, `ListPrompt`'s pieces, `ErrorLine`, `Ui.confirm`; no new colour. The docs page uses fumadocs' MDX table and the site's tokens; no new component system. Both themes: the CLI's light and dark themes are tested; the docs page inherits the site's. | Pass |
| V. Motion With Purpose | Nothing moves but the existing spinner. | Pass |
| VI. Accessible and Fast by Default | Every state has words and a symbol (`✔`, `✖`, `!`, `◉`/`◯`), never colour alone; the summary fits 80 by 24 with no blank lines (D30); every question works from the keyboard and Esc leaves. The docs page is a static table with a header row. | Pass |
| VII. Verified Before Done | Unit tests for every branch (the reader case by case, the addition, the commit's every step, both halves of every command); real Docker for each template (T036, T031); `typecheck`, `lint`, `test` from the root at the end, `bun run format` leaving no change, `bun run compile` in `apps/cli` and the binary's `zekno add --list`; `bun run build` recorded as not run (`next build`, the maintainer's rule); the pseudo-terminal walkthrough of each board, a light terminal included; an independent security review. | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/012-templates/
├── spec.md
├── design/                    # the four approved boards (binding)
├── plan.md                    # this file
├── research.md                # R1 to R16: the probes, the images, the order of writes, disagreements (R15)
├── data-model.md              # the file, a template as read, an addition, a plan, what is shown
├── quickstart.md              # how to check it; results are added as tasks complete
├── contracts/
│   ├── template-file.md       # the format, the order of checks, every rule (TR, TF, TS, TC), the first set
│   ├── commands.md            # zekno add: HELP, every line, the order of checks, whole or nothing, AD, AU, AL, AV, AH
│   └── contributing.md        # the guide (CG), the template tests (TT), the workflow (CW), the docs page (TD), the maintainer's steps (MS)
├── checklists/requirements.md
├── security-review.md         # written by T055
└── tasks.md
```

### Source Code (repository root)

```text
apps/cli/
├── package.json                       # the script test:templates
├── src/
│   ├── templates/                     # new folder: everything about a template that needs neither a team nor a terminal
│   │   ├── files/                     # new: the template files, data only, and their index
│   │   │   ├── index.ts               # new: one line per template file
│   │   │   ├── postgres.json
│   │   │   ├── mysql.json
│   │   │   ├── mongodb.json
│   │   │   └── redis.json
│   │   ├── types.ts                   # new: Template, MadeSecret, Offer, TemplateFault, Addition, TemplateRow, AdditionReport, TemplateView, HandLines
│   │   ├── file-words.ts              # new: TR, TF, TS's mapping, TC
│   │   ├── add-words.ts               # new: AD, AU, AL, AV, AH and the summary's words
│   │   ├── publishers.ts              # new: the allowed sources (FR-002)
│   │   ├── shape.ts                   # new: the top-level fields, makes and offers as zod strictObjects
│   │   ├── read.ts                    # new: readTemplate, the order of checks
│   │   ├── catalogue.ts               # new: TEMPLATE_TEXTS from the index, catalogue, findTemplate, the order
│   │   ├── made.ts                    # new: makePassword, fillOffer, shownOffer
│   │   ├── addition.ts                # new: planAddition (pure)
│   │   ├── hand.ts                    # new: the lines for a hand-written Compose file
│   │   └── shown.ts                   # new: rows, the summary, the view, joined names
│   ├── settings/schema.ts             # checkSettingsValue exported (steps 3 to 6 of a read value); checkSettings calls it
│   ├── settings/types.ts, file.ts     # SettingsRead.bytes
│   ├── settings/write.ts              # restoreSettings
│   ├── ops/settings.ts                # findPlace; readPlaced built on it, unchanged
│   ├── ops/secret.ts                  # latestVersions and asCliError exported
│   ├── ops/add.ts                     # new: prepareAdd, the target, the store's checks, the view and list data
│   ├── ops/add-commit.ts              # new: commitAdd and commitHand, steps a to f
│   ├── commands/add.ts                # new: draws and asks
│   ├── cli/cli.ts                     # HELP, WORDS, WITHOUT_TEAM, the three options, ADD_OPTIONS, the re-parse, case "add"
│   ├── ui/types.ts                    # ListRow.column, SeveralQuestion, and six methods of Ui
│   ├── ui/plain/plain.ts              # the plain halves
│   ├── ui/ink/ink.tsx                 # the terminal halves
│   ├── ui/ink/questions.tsx           # ListPrompt's middle column
│   ├── ui/ink/several.tsx             # new: SeveralPrompt
│   ├── ui/ink/left-behind.ts          # the line a several-row question leaves
│   ├── ui/ink/templates.tsx           # new: the list and --show
│   └── ui/ink/addition-report.tsx     # new: the summary, the result, the hand-written lines
└── test/
    ├── support/template-files.ts      # new: good and hostile template fixtures, each with its sentence
    ├── templates/                     # new, mirroring src/templates
    │   ├── read.test.ts, files.test.ts, index.test.ts, catalogue.test.ts, made.test.ts
    │   ├── addition.test.ts, hand.test.ts, shown.test.ts, words.test.ts
    │   ├── docker.test.ts, clients.ts, workflow.test.ts
    ├── settings/schema.test.ts, file.test.ts, write.test.ts   # extended
    ├── ops/add.test.ts, ops/add-commit.test.ts                # new
    ├── commands/add.test.tsx                                  # new
    ├── ui/ink/several.test.tsx, templates.test.tsx, addition-report.test.tsx   # new
    ├── scenarios/add-settings.test.ts, add-hand.test.ts, add-scripts.test.ts, templates-real-docker.test.ts   # new
    ├── layers/layers.test.ts                                  # templates/ in LAYOUT and rule 3; the data files
    ├── plain/plain-unchanged.test.ts                          # ADDED_TO_HELP; the three options elsewhere
    ├── version/version.test.ts                                # add never fetches
    └── docs/docs.test.ts                                      # unchanged; the docs name the new lines

apps/web/
├── content/docs/templates.mdx                 # new: the page
├── modules/docs/components/templates.tsx      # new: <TemplateList />
├── modules/docs/components/mdx.tsx            # registers TemplateList
├── modules/docs/lib/templates.ts              # new: reads the files' shown fields
└── modules/docs/lib/templates.test.ts         # new

.github/workflows/pull-request-checks.yml      # new: the check
CONTRIBUTING.md                                 # new: the guide
README.md, apps/cli/README.md, apps/web/content/docs/cli.mdx   # docs
```

**Structure Decision**: no new package. One new folder, `apps/cli/src/templates/`, named for its
subject (constitution 1.3.0, "Code in folders"), holding everything about a template that needs
neither a team nor a terminal: its files, its words, its reader, the catalogue, the made values,
the addition and what is shown. The template files are in a subfolder of their own, `files/`. What
uses the team or the profile is in `ops/add.ts` and `ops/add-commit.ts`; what draws and asks in
`commands/add.ts` and `ui/`. Tests mirror the folders; the end-to-end runs cross subjects and are in
`test/scenarios/`.

## Which way imports point (rules of specs/007-code-in-folders)

`templates/` is one of the folders the rest is built on (rule 3), beside `settings/`: it imports
nothing from `app/`, `commands/`, `asking/` or `ops/`, and from `ui/` nothing. It imports
`settings/` (`json.ts`, `schema.ts`, `values.ts`, `compose.ts`, `text.ts`, `piped.ts`, `types.ts`),
`server/` (`sanitize`), `cli/errors.ts` and `@workspace/core` (`isReservedSecretName`). Nothing in
`settings/` imports `templates/`. `ops/`, `commands/` and `ui/` (types only, through `ui/types.ts`)
import it.

The layering test changes in four places and gains no exception:

- `LAYOUT` gains `"templates"`, after `"shared"`;
- `BASE` gains `"templates"`, and rule 3's text reads `3. shared/, server/, project/, profile/,
  secrets/, settings/, templates/ and version/ import nothing from app/, commands/, asking/ or
  ops/, and from ui/ only ui/types.ts.`;
- `DATA_FILES` gains every `templates/files/<name>.json` (a pattern, held to the name rule, not a
  list), so a new template needs no change to the test; the index's imports write each path out,
  so the test follows them as it follows every import;
- "the checker itself" gains `broken("templates/addition.ts", "ops/add.ts")` giving `["3."]` and
  `broken("templates/read.ts", "settings/schema.ts")` giving `[]`.

Rule 5 holds: `templates/`, `ops/add*.ts` and `commands/add.ts` import neither Ink nor React; the
new drawings are reached only through `ui/ink/ink.tsx`, which `main.ts` loads with `import()`.

## What does not change

A checklist for the security review (T055) and the end checks (T057). The base is `d19b25f`.

- [ ] `packages/core`, `apps/runner`, `apps/cli/src/version/runner-release.json`: no file changes.
      `git diff --stat d19b25f -- packages/core apps/runner apps/cli/src/version/runner-release.json`
      prints nothing (FR-018, SC-007).
- [ ] Every message format: the signed deploy, the signed link, the secret records and removals,
      the team list, the history and the profile files: no schema changes (checked by the line
      above and by `git diff d19b25f -- apps/cli/src/profile` touching no schema).
- [ ] Plain output and exit status of every command that existed, with no terminal:
      `test/plain/plain-unchanged.test.ts` passes, with only the three lines of `HELP` added to
      `ADDED_TO_HELP`; `plain-at-head.ts` unchanged; `--for`, `--list` and `--show` on any other
      command give today's error and status 2.
- [ ] The settings commands, the settings screen and `zekno deploy`: unchanged; `readPlaced` keeps
      every sentence and status (feature 010's tests pass unchanged).
- [ ] Feature 010's settings file: no rule, sentence or limit changes; `checkSettings` gives the same
      result for every file of `test/support/settings-files.ts`.
- [ ] Secrets: no value in any file but its sealed record, in any output, screen, error or argument
      (T026, T055).
- [ ] No command but `zekno version` and `zekno doctor` calls `deps.fetch`
      (`test/version/version.test.ts`, with `add` in its table).
- [ ] `INSTALL_SCRIPT` and `CHECK_SCRIPT`: byte for byte as before (their tests pin them).
- [ ] The existing workflows: unchanged.

## Phases

1. **Setup**: the folder `templates/` with its types and the layering test; `checkSettingsValue`;
   `SettingsRead.bytes`.
2. **Foundational**: the words; the allowed sources; the reader and its fixtures; the index and the catalogue;
   the four files and their tests; the made values; the addition; `restoreSettings`;
   `findPlace`. Each with its tests first.
3. **US1, add a database** (P1, MVP): `prepareAdd`, `commitAdd`, the summary, the readers question,
   the result, `zekno add` at a terminal and its plain lines, the refusals, whole or nothing, the
   end-to-end run with real Docker.
4. **US2, see what exists** (P2): the picker, `--list`, `--show`, `--json`.
5. **US5, contribute a template** (P2): `test:templates` with Docker, the guide, the check, the docs
   page.
6. **US3, a hand-written Compose file** (P3): the lines, the question, the secrets.
7. **US4, from scripts** (P3): `--yes`, AD4, AD12, the scripted scenarios, the three options
   elsewhere.
8. **Polish**: the docs of the CLI, the root README, the independent security review, the
   pseudo-terminal walkthrough, the end checks.

Each phase leaves `bun test` in `apps/cli` green, `bun run lint` clean and `bun run format` leaving
no change. A task that adds a line to `HELP` adds it to both docs pages, to `ADDED_TO_HELP` and to
the version test's table in the same task.

## Risks

- **The window between two renames** (research R7). A process ended after the settings file is
  written and before the store is leaves a service without its secrets. Mitigation: the store's
  write comes right after, with nothing between but a compare; each image refuses to start without
  its password (proven), so nothing runs open; the docs say how to finish by hand.
- **A made value in memory.** JavaScript strings cannot be wiped. Mitigation: the values exist in
  one function's locals, after the last check and before the store's write, and reach only
  `createSecret`; the sentinel tests look everywhere else.
- **A file without its line in the index** is not in the CLI. Mitigation: the index test (TI1)
  fails and says which line to add; the docs page reads the folder, and the same test keeps the two
  alike. The index awaits its imports when it loads (top-level await), which Bun supports in the
  program and the compiled binary (research R1).
- **An image digest that goes away.** Docker Hub keeps a manifest pulled by digest; if one were
  removed, the deploy fails with Docker's own line naming the image (the spec's edge case). A new
  release pins a new digest.
- **The first run of the check on Linux.** The whole suite has run only on macOS so far. Mitigation:
  T039 reads every test for what assumes macOS before the workflow lands; the first pull request's
  run is recorded in quickstart.md.
- **Docker Hub's pull limits on GitHub** (D29, MS4).
- **The docs page reads outside `apps/web`** at build. A build that sees only `apps/web` would fail
  loudly at that page; the monorepo checkout every build uses today has both.
- **A pull request that changes its own checks** (R13). Mitigation: the guide's CG8 and the
  maintainer's MS1 to MS3.
- **Copying lines out of a box** (the hand-written path at a terminal): a terminal's selection takes
  the border too. Piped, the lines are bare; the docs say to pipe them.
- **A teammate on an older zekno**: an app with a template is an ordinary settings file, which
  feature 010's zekno already reads. Nothing new.

## Complexity Tracking

No principle is violated. Nothing to justify.
