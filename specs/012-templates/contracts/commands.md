# Commands Contract: `zekno add`

User Stories 1 to 4 (FR-004 to FR-016, FR-019). The boards `AddTemplate`, `AddLook` and `AddOther`
are binding for the words of each line, colours, what is bold or dim, and layout; they were redrawn
on 2026-11-17 after the plan (design/README.md). Where a board shortens a digest (`2ea8…1bbc`),
this contract prints it whole (D25). The command is drawn and asked in
`apps/cli/src/commands/add.ts`, done in `apps/cli/src/ops/add.ts` and `ops/add-commit.ts` (data
only), its words in `apps/cli/src/templates/add-words.ts`. Lines no board shows are marked (new);
each is one of plan.md's design choices, approved on 2026-11-17.

None of it contacts a server or the network, deploys, or signs a deploy (FR-010, SC-005). Adding
reads the keychain once, to seal and sign the secrets (`withSigner`), and opens the team as
`zekno secret set` does.

## Usage, and the changes to `HELP`

These three lines are added to `HELP` in `apps/cli/src/cli/cli.ts`, after `zekno settings init`
and before `zekno doctor` (new, D10). Nothing else of `HELP` changes:

```text
  zekno add [<template>] [--name <service>] [--for <service>] [--app <app>] [--server <name>] [--yes]
  zekno add --list [--json]
  zekno add <template> --show [--json]
```

- `WORDS` gains `add: 2`. `WITHOUT_TEAM` gains `add`: at a terminal with no team, `zekno add` says
  AD1, never A3.
- `parseArgs` gains `for` (`{ type: "string", multiple: true }`), `list` and `show` (booleans).
  `zekno add` takes `--name`, `--for`, `--app`, `--server`, `--yes`, `--list`, `--show`, `--json`
  and no other option: another is refused with ``\`zekno add\` does not take \`--<option>\`.``
  (`optionNotTaken`, status 2 with the help line). With `--list` or `--show`, only `--json`
  (AU6).
- Every other command given `--for`, `--list` or `--show` fails exactly as it does today, by
  parsing its arguments again with the option table as it was (research R9).
- `apps/cli/test/plain/plain-unchanged.test.ts`: `ADDED_TO_HELP` gains the three lines, marked as
  feature 012's; a scene runs `zekno deploy --list` and `zekno status --for web` and expects today's
  sentence and status. `plain-at-head.ts` is not edited.
- `apps/cli/test/version/version.test.ts`: the table of commands that never call `deps.fetch` gains
  `add --list`, `add postgres --show`, and `add postgres --yes --app demo --server dev`.
- `apps/cli/README.md` and `apps/web/content/docs/cli.mdx` name the three lines and every flag
  (`docs.test.ts`).

## `zekno add <template>`, a settings file, at a terminal

Board `AddTemplate`, left column. The columns: headings and the title from column 0; the rows of a
block from column 2, names padded to 24, values from column 26 (research R11). No empty line
between blocks (new, D30).

```text
$ zekno add postgres
PostgreSQL 18.7  A relational database.                                   by zekno
╭───────────────────────────────────────────────────────────────────────────────╮
│ app     demo                                                                    │
│ server  prod deploy@203.0.113.7                                                 │
│ file    zekno.app.json  2 services: web, worker                                 │
╰───────────────────────────────────────────────────────────────────────────────╯
Adds a service
  postgres                postgres:18.7  pinned by digest
                          restart always · port 5432, not published
                          data kept in volume postgres-data
Makes a secret on this machine  never shown
  POSTGRES_PASSWORD       32 random characters
                          read by postgres
Builds a secret from it
  DATABASE_URL            postgres://app:••••@postgres:5432/app
                          read by web
! Zekno does not back up this data.
? Add postgres to demo? Nothing is deployed until you deploy. (y/N)
```

- **The title line**: `<title> <software>` bold, two spaces, `<about>` dim; `by <author>` dim, its
  end at the box's right edge (two spaces after the about when the window is too narrow).
- **The box**: drawn as `zekno deploy` draws its summary panel (the same panel, border and row
  pieces of `ui/parts/`), with three rows: `app` and the app's name bold; `server`, the server's
  name and, dim, where it is (`deploy@203.0.113.7`, or `this machine`); `file`, the settings file
  as a sentence names it (`shownFile`) and, dim after two spaces, the services it has now
  (`<n> service: <name>` or `<n> services: <names>`, DP3's words). Labels dim.
- **Adds a service** bold (`Adds <n> services` for several, new). Per service: its name in the app
  bold in the brand colour; its image without the digest, then `pinned by digest` dim two spaces
  after; then on one row the restart rule (`restart always`; `on-failure` reads `on failure`) and
  the port (`port 5432, not published`) joined by ` · ` with the dot dim, the row left out when
  neither is set; then `data kept in volume <vol>` (`volumes <a>, <b>` for several, new), the row
  left out with no volume. Names and words in the text colour (the board's white that is not bold:
  research R11).
- **Makes a secret on this machine** bold, `never shown` dim two spaces after
  (`Makes <n> secrets on this machine` for several, new). Per made secret: its name, `<n> random
  characters`; under it, dim, `read by <services>` (the template's services that read it, joined
  with `, `).
- **Builds a secret from it** bold (`from them` when it uses several made secrets, new). Per
  connection secret: its name, its text with `••••` (dim) in place of each made value and the
  service's name in place of `{service}`; under it, dim, `read by <readers>`. Left out when the
  template offers none.
- **Notes**: each of the template's notes as `! <note>`, the whole line in the warning colour.
- **The question**: AD3 with today's yes-or-no question (`Ui.confirm`): `?` in the brand colour,
  `Add <service> to <app>?` bold, ` Nothing is deployed until you deploy.` in the text colour,
  `(y/N)` dim; `yes` or `no` left after it. `<service>` is the service's name in the app.
- With `--yes` the question is not asked, and the summary is still drawn.
- **compose.yaml beside the file** (security review T3): when the settings file is this folder's own
  `zekno.app.json`, `compose.yaml` is here too and nothing decides (no zekno.json in use here
  names a file for the app), IN6 of feature 010, unchanged, as a warning before the summary, as `zekno settings set`
  says it: `! This folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f
  <file>.` A deploy here then asks which file (DP1), or stops with DP2.

### Who reads the connection secret

Board `AddTemplate`, right column. Before the summary, for each connection secret, in the
template's order:

- `--for <service>` given (once or more): those services, in the file's order.
- Else one other service in the file: that one; the summary's `read by web` says so (US1, scenario
  7).
- Else, at a terminal, AD10 with a list to pick several from:

  ```text
  ? Which services read DATABASE_URL?
  ❯ ◉ web
    ◯ worker
    ↑↓ move   space pick   enter done   esc leave
  ```

  `?` brand, the sentence bold; per row the marker `❯` brand on the selected row, `◉` green for a
  picked service and `◯` dim for one not picked, the name bold on the selected row and in the text
  colour otherwise; the keys in the text colour and their words dim. It opens with the first
  service picked (new, D13). Enter with none picked draws AD11 under the rows in the warning colour
  and stays open (new). Left behind once done: `✔ Read by  web, worker` (new, as a list's
  collapsed line). Esc and Ctrl-C: AD22.
- Else, with no terminal: AD12, status 2.

### After a yes

```text
✔ Added postgres to zekno.app.json
✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for prod
  Run zekno deploy to start it.
```

`✔` green, the words in the text colour (AD16, AD17), then AD18 dim, set in by two columns
(`Ui.note`). Names in AD17 are the made secrets then the connection secrets, in the template's
order, joined `A`, `A and B`, `A, B and C`. Exit status 0.

### A no, Esc or Ctrl-C

At AD3, AD10 or the picker: AD22, dim, from column 0, as the board draws it (not `✖`). Exit status
1. Nothing was written and no secret was made. Esc at a question `details` asks for the app or the
server is that question's own: `✖ Nothing was done.`, status 1, as for every command.

## With no terminal (scripts)

Board `AddOther`, right column.

- Without `--yes`: AD4 on standard error, exit status 1, nothing else printed, nothing read but
  what the checks before it read, nothing written.
- With `--yes`: nothing is asked; with several other services and no `--for`, AD12 (status 2: it
  does not guess). Then, on standard output, one line per thing done, with tabs (AD23):

  ```text
  added	postgres	zekno.app.json
  stored	POSTGRES_PASSWORD	1
  stored	DATABASE_URL	1
  ```

  `<file>` as a sentence names it; the number is the version each secret got. Exit status 0.
  With compose.yaml beside the settings file and nothing that decides, IN6 follows on standard
  error, as `zekno settings set` says it once it wrote (security review T3); without `--yes` AD4
  stays the only line.
- Anything the command needs and does not have (the app, the server) stops it with the sentence
  the other commands use (`MISSING_APP`, `MISSING_SERVER`; FR-012).
- Every refusal is one line on standard error, its two sentences joined by a space.

## `zekno add` with no template

- At a terminal (board `AddLook`, left column), after AD1 is checked:

  ```text
  $ zekno add
  ? Add which template?
  ❯ postgres  PostgreSQL 18.7  A relational database
    mysql     MySQL 9.7        A relational database
    mongodb   MongoDB 9.0      A document database
    redis     Redis 8.10       A cache and key-value store
    ↑↓ move   enter choose   esc leave
  ```

  Today's one-row list (`ListPrompt`), its row given a middle column: the name (bold when selected,
  else the text colour), `<title> <software>` in the text colour, the about without its full stop
  dim. Columns padded to the longest of each plus two. Left behind: `✔ Template  postgres` (new,
  D12). Then the command goes on as `zekno add postgres`. Esc: AD22.
- With no terminal: AU1, status 2 with the help line.

## `zekno add --list`

Needs no team, server, file or keychain (FR-013, board).

At a terminal:

```text
$ zekno add --list
  postgres  PostgreSQL 18.7  A relational database        by zekno
  mysql     MySQL 9.7        A relational database        by zekno
  mongodb   MongoDB 9.0      A document database          by zekno
  redis     Redis 8.10       A cache and key-value store  by zekno
```

From column 2: the name bold, `<title> <software>` in the text colour, the about without its full
stop dim, `by <author>` dim; each column padded to its longest plus two.

Piped, one line each, with tabs (board):

```text
postgres	PostgreSQL	18.7	zekno
mysql	MySQL	9.7	zekno
mongodb	MongoDB	9.0	zekno
redis	Redis	8.10	zekno
```

`--json`, one object on one line (new, D18):
`{"templates":[{"name":"postgres","title":"PostgreSQL","about":"A relational database.","software":"18.7","author":"zekno","also":[]}, ...]}`

Exit status 0. The order is the catalogue's (contracts/template-file.md, "The first set").

## `zekno add <template> --show`

What the template would add, before adding it (FR-013, FR-016; board `AddLook`, middle column).
Needs no team, server, file or keychain; changes nothing.

At a terminal, from column 2:

```text
$ zekno add postgres --show
  PostgreSQL 18.7  A relational database. By zekno.
  postgres
  Source        image          postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc
  Deploy        restart        always
  Networking    port           5432, not published
  Variables     secrets        POSTGRES_PASSWORD
                plain          POSTGRES_USER=app, POSTGRES_DB=app
  Volumes       postgres-data  /var/lib/postgresql
  Secrets
  POSTGRES_PASSWORD       made on your machine, 32 random characters
  DATABASE_URL            built from it, for your own services
  Good to know
  Zekno does not back up this data. It is kept in a Docker volume on your server.
  The image is the official one, pinned by digest. A newer one comes with a newer zekno.
  Nothing was changed.
```

- `<title> <software>` bold, two spaces, `<about> By <author>.` dim.
- Per service, as it would be added with its own name: the name bold in the brand colour; then the
  sections grid of `zekno settings` (feature 010: section bold, padded to 14; label dim, padded to
  `max(10, longest label + 2)`; value in the text colour; a value too long goes on under itself),
  but the plain variables on one row joined with `, `, and the image with its whole digest
  (research R10; the board shortens it). A start command is the Deploy section's `start` row.
- **Secrets** bold; per made secret, its name padded to 24 and `made on your machine, <n> random
  characters` dim; per connection secret, `built from it, for your own services` dim (`from them`
  when it uses several, new).
- **Good to know** bold; dim: AV3 when a service keeps data in a volume; AV4; then each note of the
  template but `Zekno does not back up this data.`, which AV3 says.
- AV5 dim. Exit status 0.

Piped (new, D18): the services as `zekno settings` prints its piped lines (`pipedLines`), with the
volumes under their names in the app, then `made	<NAME>	<length>` per made secret and
`built	<NAME>	<offer text>` per connection secret, its placeholders as written:

```text
postgres	source.image	postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc
postgres	deploy.restart	always
postgres	networking.port	5432
postgres	variables.secrets	POSTGRES_PASSWORD
postgres	variables.plain.POSTGRES_USER	app
postgres	variables.plain.POSTGRES_DB	app
postgres	volumes.postgres-data	/var/lib/postgresql
made	POSTGRES_PASSWORD	32
built	DATABASE_URL	postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app
```

`--json` (new, D18): the template's data as read, one object on one line, its keys in the order of
contracts/template-file.md, "The format", and each service's keys in the order `zekno settings
--json` writes them.

## A hand-written Compose file

When the file `zekno deploy` in this folder would use is a Compose file (FR-015; board `AddOther`,
left column). It is never written or read.

At a terminal:

```text
$ zekno add postgres
This folder deploys from compose.yaml, a file written by hand.
Zekno does not edit it. Add these lines yourself.
Under services:
╭──────────────────────────────────────────────────────────────────────────────────────────────────╮
│   postgres:                                                                                        │
│     image: postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc    │
│     restart: always                                                                                │
│     environment:                                                                                   │
│       POSTGRES_USER: app                                                                           │
│       POSTGRES_DB: app                                                                             │
│       POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}                                                      │
│     volumes:                                                                                       │
│       - postgres-data:/var/lib/postgresql                                                          │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
Under volumes:  postgres-data:
In the environment: of each service that uses it
╭──────────────────────────────────────╮
│       DATABASE_URL: ${DATABASE_URL}  │
╰──────────────────────────────────────╯
? Make and store its two secrets for demo on prod? (y/N) yes
✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for prod
```

- AH1 with the file's name bold; AH2 dim; AH3 dim with `services:` in the text colour; the lines in
  a box with a faint border, in the text colour; AH4 dim with `volumes:` and each `<vol>:` in the
  text colour; AH5 dim with `environment:` in the text colour; the connection secrets' lines in a
  second box; AH6 as a yes-or-no question; AD17.
- **The lines** (research R10): two spaces, the service's name and `:`; `image`, `command` (a start
  command, as a flow list of quoted words with every `$` written `$$`), `restart`, `mem_limit` and
  `cpus` (a template's limits, the very lines `composeText` writes: `mem_limit: "512m"`, `cpus: 0.5`;
  added 2026-11-17, design/README.md); `environment:` with the plain values, then each secret as
  `<NAME>: ${<NAME>}`; `volumes:` with `- <service>-<vol>:<path>`. Keys in the order above, a key
  with nothing to say left out. The port is not written (no `expose`, never `ports`), as the board
  draws the lines: every template of the first set has a port, and `expose` changes nothing between
  the services of one Compose project. A value is
  bare as the board writes `app` only when it starts with a letter, holds only letters, digits and
  `._/:@-`, and is not a YAML word for true, false or null; else it is written as `composeText`
  writes a string (`quote`). The image is whole, with its digest. The connection secret's line is
  `      <NAME>: ${<NAME>}`, six spaces in.
- A no, Esc or Ctrl-C at AH6: AH9 dim, status 1 (new, D17).
- `--for` is refused here (AU10): the person adds the lines to the services they choose.
- A zekno.json not in use on this machine yet that names another file than this Compose file: SH4,
  status 1, before any line or question (step 6; security review T4), as for a settings file. Its
  end names the Compose file in place of `zekno.app.json` (2026-11-18): `This folder's zekno.json
  names deploy/zekno.app.json and is not in use on this machine yet: zekno deploy asks about it
  first, and a yes deploys deploy/zekno.app.json, not the compose.yaml here.`

With no terminal (board: "Piped, the lines are printed as they are and no secret is made without
`--yes`"): the service's lines, then the connection secrets' lines, on standard output exactly as
they would be typed into the file (no box, no words around them); then without `--yes`, AH8 on
standard error and status 1 (new, D17); with `--yes`, the secrets are made and stored and one
`stored	<NAME>	<version>` line each follows on standard output, status 0.

## The order of checks

The first that applies stops the command. Nothing is written before step 15. The board `AddOther`
gives its refusals exit status 2 and its last two, AD8 and AD13, status 1, as `zekno settings`
gives for the same cases (D27); AD21 is of AD8's kind and is 1 too.

1. The words and the options: AU1 to AU7, and ``Unexpected "<x>" after `zekno add`.`` for a third
   word (status 2, with the help line).
2. `--list`: the list, status 0. `--show`: the template (AL3, AL4, AD27, AD28), then the view,
   status 0. Nothing below.
3. A template given: AL3, AL4 (status 2); AD27 (status 1); AD28 (status 2). Then `--name`: AU8,
   AU9 (status 2).
4. AD1: no profile, or a profile with no server (status 2). Read with `profileStore(deps.home)`;
   the keychain is not opened for it.
5. No template given: the picker at a terminal (with no terminal it was AU1 at step 1); then AD28
   and AU9 for the one picked.
6. Which file (research R8): SH4 (status 1), when a zekno.json not in use on this machine yet
   names another file than the one here, a settings file or, since the security review (T4), a
   Compose file written by hand (which SH4 then names in place of `zekno.app.json`): a yes to the deploy's first-use question deploys that file; no file: AD13 (status 1, as SH1); a Compose file: the
   hand-written path from step 7, with AU10 for `--for`; a settings file: read whole and checked
   (the reader's sentences, status 1). The file is the one a deploy here signs for the app the
   command uses: a zekno.json in use here gives its file only to its own app, so with `--app`
   naming another app it is this folder's own, as `zekno deploy --app` decides it (security
   review T2). `--server` does not change it, as it does not for the deploy.
7. The app and the server: the flags, the folder's link, then at a terminal a question for each;
   the other commands' sentences (FR-012).
8. The app's secret store: read once. AD5 for the first name of the template's made secrets, then
   connection secrets, that is a secret of the app now (status 2); AD24, AD25 (status 1).
9. The service's name in the app: AD6 (status 2). Each volume `<service>-<vol>`: AD9 (status 2).
10. Who reads each connection secret: AD14 for a `--for` that is not a service of the file (status
    2); the question; AD12 with no terminal (status 2).
11. The services' secrets, then each reader's variables (security review T1): AD29 for the first
    service of the file, in its order, that lists in its `secrets` a name the template makes or
    builds, reader or not (the first such name, made secrets first; status 2); then AD7 for the
    first reader that has a plain variable of the connection secret's name (status 2). Where both
    would apply, AD29 is said. A plain variable of that name in a service that is not a reader
    stays. So the summary's `read by` names every service the Compose text gives each new secret.
12. The settings with the services added, as `checkSettings` reads the text `settingsText` would
    write: AD15 with the settings sentence's place and rule (status 2).
13. The summary, after IN6 at a terminal when compose.yaml is beside the file (security review
    T3); then AD3, `--yes`, or AD4 (status 1). A no: AD22 (status 1).
14. The file and the store unchanged since steps 6 and 8: AD8, AD21 (status 1, as CS12).
15. Adding, whole or not at all (below).

## Whole or not at all (FR-008, SC-004)

The steps of research R7, in `ops/add-commit.ts`:

| Step | What | On failure | Left as it was |
|---|---|---|---|
| a | The settings file's bytes read again; SHA-256 compared with step 6's | AD8 | both |
| b | The app's secret store read again; compared with step 8's | AD21 | both |
| c | The values made (research R6); every record sealed and signed in one `withSigner` (the keychain is read here) | the keychain's or signing's own sentence | both; the values and records dropped |
| d | `writeSettings(read, settings)`: a new file beside it, flushed, the old one checked again, then a rename | AD8 for a file changed meanwhile, CS13 for a link, CS14 for a write that failed | both: the old file stays (feature 010) |
| e | The store read and compared once more, then written whole with every new record (`saveSecrets`: a new file, then a rename) | AD20, or AD21 for a store changed meanwhile, after step f | the store |
| f | Only after e failed: `restoreSettings` puts back the bytes read in step 6, as a write puts a file in place, only while the file is exactly what step d wrote (its SHA-256) | AD19 | the store; the file holds the added service |

Nothing else is written. The hand-written path runs b, c and e (no file is written, so f never
runs). The one window the steps cannot close is a process ended between d's rename and e's
(research R7); the docs say what to do then.

## Sentences

`<file>` is the settings file as a sentence names it (`shownFile`); `<template>` a template's name;
`<service>` the service's name in the app; `<svc>` a service of the file; `<NAME>` a secret's name;
`<app>`, `<server>` as given or found. Each is shown only after it passed its rule. At a terminal a
refusal's first sentence is bold after `✖` and its second dim on the next line, set in by two
columns (`ErrorLine`); piped they are one line on standard error. Statuses in brackets.

### Adding

| Id | Sentence |
|----|----------|
| AD1 | `There is no server to keep secrets for yet.` then `Run zekno deploy first. It sets up your team and a server.` (board) [2] |
| AD3 | `Add <service> to <app>? Nothing is deployed until you deploy.` (board; the question) |
| AD4 | `Adding a template changes <file> and stores secrets. Say --yes to go ahead.` (board) [1] |
| AD5 | `<app> already has a secret named <NAME>.` then `A template can be added once to an app in this version.` (board) [2] |
| AD6 | `<file> already has a service named <service>.` then `Give this one another name with --name <service>.` (board; the second `<service>` is written as is) [2] |
| AD7 | `<svc> already has a variable named <NAME>.` then `Remove it, or leave <svc> out with --for <service>.` (board; since the security review, T1, for a plain variable of a reader only: a name in a service's `secrets` is AD29) [2] |
| AD8 | `<file> changed while this was open.` then `Nothing was added. Run zekno add <template> again.` (board) [1, as CS12; D27] |
| AD9 | `<file> already has a volume named <vol>.` then `Give this one another name with --name <service>.` (new, D1) [2] |
| AD10 | `Which services read <NAME>?` (board; the question) |
| AD11 | `Pick at least one service.` (new, D13; the reason under the rows) |
| AD12 | `<file> has several services. Say which read <NAME> with --for <service>.` (new, D14; the board: "it stops and names the flag") [2] |
| AD13 | `This folder has no settings file.` then `Run zekno settings init to start one, then add the template.` (board) [1, as SH1; D27] |
| AD14 | `<file> has no service named <svc>. Its services are <svc>, <svc>.` (`<file> has no such service.` when the name breaks the service rule; `Its service is <svc>.` with one) (new, as CS4) [2] |
| AD15 | `<service> cannot be added to <file>.` then `<place>: <rule>` of the settings sentence it breaks, such as `services: at most 32 services.`; for a file that would pass 64 KiB, `<file> would be larger than the 64 KiB a settings file may be.` (new, D21) [2] |
| AD16 | `Added <service> to <file>` (board) |
| AD17 | `Stored <names>, sealed for <server>` (board) |
| AD18 | `Run zekno deploy to start it.` (board) |
| AD19 | `<service> was added to <file>, but its secrets could not be stored, and the file could not be put back.` then `Remove <service> from <file> before you deploy.` (new) [1] |
| AD20 | `The secrets could not be stored on this machine, so nothing was added.` (new) [1] |
| AD21 | `The secrets of <app> on <server> changed while this was open.` then `Nothing was added. Run zekno add <template> again.` (new, as AD8) [1] |
| AD22 | `Nothing was added.` (board) [1] |
| AD23 | the plain lines: `added	<service>	<file>`, then `stored	<NAME>	<version>` per secret (board) [0] |
| AD24 | `<app> on <server> would have more than 256 secrets, more than one deploy carries. Nothing was added.` (new, as I13) [1] |
| AD25 | `<app> on <server> would have more than <n> secret records on this machine. Nothing was added.` (new, as I14) [1] |
| AD27 | `This zekno's template <template> does not pass its own checks. Nothing was added.` (new; a released zekno never says it: its tests read every file) [1] |
| AD28 | `<template> asks a question when it is added.` then `Questions are not in this version of zekno yet. They come with domains.` (new, D20; TF4) [2] |
| AD29 | `<svc> already reads a secret named <NAME>.` then `Remove it from <svc>.` (new, security review T1, 2026-11-17: a service of the file that lists in its `secrets` a name the template makes or builds would read the new secret without the summary naming it) [2] |

AD2 and AD26 are not used: the summary's words are listed below by themselves.

### Usage (status 2, with the help line)

| Id | Sentence |
|----|----------|
| AU1 | ``Say which template: `zekno add <template>`, or see them with `zekno add --list`.`` (new) |
| AU2 | `` `zekno add --list` takes no template.`` (new) |
| AU3 | ``Say which template to show: `zekno add <template> --show`.`` (new) |
| AU4 | ``Use `--list` or `--show`, not both.`` (new) |
| AU5 | `` `zekno add` takes `--json` with `--list` or `--show` only.`` (new) |
| AU6 | `` `zekno add --list` does not take `--<option>`.`` and `` `zekno add --show` does not take `--<option>`.`` for `--name`, `--for`, `--app`, `--server`, `--yes` (new) |
| AU7 | `` `zekno add` does not take `--<option>`.`` (`optionNotTaken`) |

### Usage, said without the help line (`WrongInput`, status 2)

| Id | Sentence |
|----|----------|
| AU8 | `That is not a service name. Use lowercase letters, digits and hyphens, starting with a letter.` (new) |
| AU9 | `<template> adds several services, so it takes no --name in this version.` (new, D19) |
| AU10 | `--for works with a settings file. With <file>, add the line to each service that uses it.` (new) |

### Looking (AL, AV)

| Id | Words |
|----|-------|
| AL1 | `Add which template?` (board; the picker's question) |
| AL2 | `Template` (new; the picker's collapsed word) |
| AL3 | `There is no template named <name>.` then `Run zekno add <template>.` when `<name>` is in a template's `also` (board), else `Run zekno add --list to see them.` (new) [2] |
| AL4 | `There is no template of that name.` then `Run zekno add --list to see them.` (new; for a name that breaks the name rule) [2] |
| AV1 | `By <author>.` after the about, in `--show`'s first line (board) |
| AV2 | `Secrets`; `made on your machine, <n> random characters`; `built from it, for your own services` (board); `built from them, for your own services` (new) |
| AV3 | `Zekno does not back up this data. It is kept in a Docker volume on your server.` (board) |
| AV4 | `The image is the official one, pinned by digest. A newer one comes with a newer zekno.` (board) |
| AV5 | `Nothing was changed.` (board) |
| AV6 | `Good to know` (board) |

### The summary's words (board `AddTemplate`)

`by <author>`; `app`, `server`, `file`; `Adds a service` (`Adds <n> services`, new); `pinned by
digest`; `restart <rule>`; `port <n>, not published`; `data kept in volume <vol>` (`volumes <a>,
<b>`, new); `Makes a secret on this machine` (`Makes <n> secrets on this machine`, new); `never
shown`; `<n> random characters`; `read by <names>`; `Builds a secret from it` (`from them`, new);
`! <note>`. Counts are digits.

### A hand-written Compose file (AH)

| Id | Words |
|----|-------|
| AH1 | `This folder deploys from <file>, a file written by hand.` (board) |
| AH2 | `Zekno does not edit it. Add these lines yourself.` (board) |
| AH3 | `Under services:` (board) |
| AH4 | `Under volumes:  <vol>:` (board; several volumes after one another, two spaces apart) |
| AH5 | `In the environment: of each service that uses it` (board) |
| AH6 | `Make and store its <count> secrets for <app> on <server>?` (board: `two`); one: `Make and store its secret for <app> on <server>?` (new); `<count>` a word from two to nine, digits above (new) |
| AH8 | `Making its secrets stores them on this machine. Say --yes to go ahead.` (new, D17) [1] |
| AH9 | `No secret was made.` (new, D17) [1] |

## Exit statuses

| Status | When |
|--------|------|
| 0 | added; listed; shown; the hand-written lines printed and their secrets stored |
| 1 | a fault of the settings file; AD4, AD8, AD13, AD19, AD20, AD21, AD22, AD24, AD25, AD27; AH8, AH9; a refusal of the keychain or of signing; a question of the app or server left |
| 2 | AU1 to AU10; AL3, AL4; AD1, AD5, AD6, AD7, AD9, AD12, AD14, AD15, AD28, AD29; a third word |

## Tests

- **Both halves.** Through `inkUi` with the stand-in terminal (`test/support/terminal.ts`) at 100
  and at 80 columns, every line of the boards `AddTemplate`, `AddLook` and `AddOther` with the
  values above, colours checked with the screen model; through the plain interface, the exact
  lines, streams and statuses above.
- **The order of checks**: a folder per step where that step and no earlier one applies.
- **Whole or not at all (SC-004)**: a failure injected at each of steps a to f (a file rewritten
  while the question is open; a store rewritten; a `withSigner` that throws; a folder made
  read-only; a profile's `secrets` folder made read-only; both): the settings file's bytes and the
  store's bytes after equal those before, but in f's last case, where AD19 says what is left and the
  store is unchanged.
- **Never shown (SC-002)**: the made values are taken from a stand-in random source that gives a
  known sentinel; the sentinel appears in no output, frame, error, file of the folder, other file of
  the profile, or argument of any child process, and only inside the sealed records (opened with the
  test's key to check it is there).
- **No network, no server (SC-005)**: `deps.fetch` and `deps.connect` that throw are never called.
- **Nothing changed for scripts (SC-006)**: `plain-unchanged.test.ts` passes.
