# Commands Contract: `zekno settings`

User Stories 2, 3 and 4 (FR-014 to FR-016, FR-018 to FR-027). design.md's decision 4 and the board
`CmdSettings` are binding. The commands are in `apps/cli/src/commands/settings.ts` (drawing and
asking), what they do in `apps/cli/src/ops/settings.ts` (data only), their words in
`apps/cli/src/settings/words.ts`.

None of them contacts a server, deploys, or signs anything (FR-025). Each reads `zekno.app.json`
in the folder it runs in (contracts/settings-file.md, "Reading the file", "this folder"), once.
`zekno settings` may open the team to read this machine's history (below); the others never do.
None needs a team, so at a terminal none says A3 when there is no profile (`WITHOUT_TEAM` in
`cli/cli.ts`).

## Usage, and the changes to `HELP`

These five lines are added to `HELP` in `apps/cli/src/cli/cli.ts`, after the `zekno link` line
and before the `zekno doctor` line. Nothing else of `HELP` changes:

```text
  zekno settings [--json]
  zekno settings set <service>.<setting> <value> [--yes]
  zekno settings unset <service>.<setting> [--yes]
  zekno settings compose
  zekno settings init
```

- `WORDS` gains `settings: 1`, `"settings set": 4`, `"settings unset": 3`, `"settings compose": 2`,
  `"settings init": 2`; `settings` is a grouped command as `server` and `secret` are.
- `WITHOUT_TEAM` gains the five.
- No new option for `parseArgs`: they take the existing `--json` and `--yes` (research R8).
- `apps/cli/test/plain/plain-unchanged.test.ts`: `ADDED_TO_HELP` gains these five lines, marked
  as feature 010's. `plain-at-head.ts` is not edited.
- `apps/cli/test/version/version.test.ts`: the table of commands that must never call
  `deps.fetch` gains one run of each.
- Both docs pages name the five in their "Commands" list in the same task (`docs.test.ts`).

## `zekno settings`

Shows the settings in sections (FR-014 to FR-016, FR-018, FR-019).

### At a terminal (board `CmdSettings`, left column)

```text
  demo  from zekno.app.json

  web
  Source        image     ghcr.io/acme/demo-web:1.4.2
  Deploy        start     bun run start
                restart   on failure
                memory    1g  ! changed, not deployed (was 512m)
                cpus      1
  Networking    port      3000, not published
  Variables     secrets   DATABASE_URL, SESSION_KEY
                plain     NODE_ENV=production
  Volumes       uploads   /data/uploads

  worker
  Source        image     ghcr.io/acme/demo-worker:1.4.2
  Deploy        start     bun run worker
                restart   always
  Variables     secrets   DATABASE_URL
```

As built (US2, 2026-11-16): the section column is 14 wide from column 2, so the labels start at
column 16 and, with the label column of 10, the values at column 26, as the board draws them (its
section column is 110 px and an 8 px gap, 14 columns of Geist Mono at 14 px). The block above
was first written with the labels at column 14; the board is binding for spacing, so the block
now shows column 16.

- The first line, from column 2: the app's name bold and `from <file>` dim, two spaces apart,
  when the app is known (below); else `<file>` alone, bold (research R9, item 13).
- An empty line before each service. The service's name from column 2, bold, in the brand
  colour.
- Each row from column 2: the section's name bold on the section's first row, padded to 14; the
  label dim, padded to `max(10, longest label of the report + 2)`; the value in the text colour.
  A value too long for the window goes on under itself, never under the labels.
- Sections in the order Source, Deploy, Networking, Variables, Volumes; in each, the rows in the
  order of contracts/settings-file.md; only the settings that are set. A section with nothing
  set is left out.
- Values: as the file holds them, but `restart` `on-failure` reads `on failure`; the port reads
  `3000, not published` or `3000, published on 8080` (`publish` has no row of its own here); the
  secrets by name only, joined with `, `; one row per plain variable, `NAME=value`, labelled
  `plain` on the first; one row per volume, its name as the label and its path as the value.
- **Changed, not deployed** (FR-019): when the app is known and this machine's last deploy of it
  was made from settings (research R4), a value that differs from it is followed by two spaces
  and `! changed, not deployed (was <old>)` in the warning colour (`(was <old>)` left out when
  the last deploy had no such setting). A setting the last deploy had and the file no longer has
  is not shown.
- **SH3**, when this folder's `zekno.json` is signed by the team, in use here, and names a Compose
  file: after the services, drawn as a warning. As built: an empty line before it, as before each
  service.

**Which app.** Only this folder's own `zekno.json` counts, when it is signed by the team, in use
here (`standingOf` gives `used`) and its `compose` is `zekno.app.json`. Then the team is opened
once (one keychain read) to verify the history. Any other `zekno.json` is not asked about, not
recorded and not warned about: the settings are shown without the app's name and without marks.
With no profile, the same.

### Piped, `TERM=dumb`

One line per setting that is set, with tabs: the service, the setting's place in the file, the
value as the file holds it. No first line, no section names, no marks, no empty line. Secrets are
joined with `,` and no space. SH3 goes to standard error.

As built: `publish`, when set, is a line of its own (`web	networking.publish	8080`), after the
port. Every value is cleaned with `sanitize`, as every line from the file is: the reader already
refuses any control character, so only an invisible character (such as a right-to-left override in
a plain value) could ever be taken out. `--json` gives the data exactly, cleaned of nothing.

```text
web	source.image	ghcr.io/acme/demo-web:1.4.2
web	deploy.start	bun run start
web	deploy.restart	on-failure
web	deploy.memory	1g
web	deploy.cpus	1
web	networking.port	3000
web	variables.secrets	DATABASE_URL,SESSION_KEY
web	variables.plain.NODE_ENV	production
web	volumes.uploads	/data/uploads
worker	source.image	ghcr.io/acme/demo-worker:1.4.2
worker	deploy.start	bun run worker
worker	deploy.restart	always
worker	variables.secrets	DATABASE_URL
```

### `--json`

One JSON object on one line: the file's own data (board), with the keys in zekno's order and
nothing added. For design.md's file:
`{"zekno":1,"services":{"web":{"source":{"image":"ghcr.io/acme/demo-web:1.4.2"},"deploy":{"start":"bun run start","restart":"on-failure","memory":"1g","cpus":1},"networking":{"port":3000},"variables":{"secrets":["DATABASE_URL","SESSION_KEY"],"plain":{"NODE_ENV":"production"}},"volumes":{"uploads":"/data/uploads"}},"worker":{"source":{"image":"ghcr.io/acme/demo-worker:1.4.2"},"deploy":{"start":"bun run worker","restart":"always"},"variables":{"secrets":["DATABASE_URL"]}}}}`

### No settings to show

- **SH1** when this folder has no `zekno.app.json` and no Compose file applies.
- **SH2** when it has none and `compose.yaml` is here, or this folder's own `zekno.json` names a
  Compose file. `<file>` is that file. Nothing is read from it (FR-018). As built: the
  `zekno.json` counts only when it is signed by the team and in use here (the rule of "Which app"
  below; never asked about), and then its file is named before `compose.yaml`, since a deploy uses
  it.

Exit status 1 for both; nothing else is printed.

## `zekno settings set <service>.<setting> <value> [--yes]`

Changes one setting (FR-020 to FR-025).

**`<service>.<setting>`**: a service of the file, a dot, and one of:

| Setting | Also written | Value given as |
|---|---|---|
| `image` | `source.image` | an image reference |
| `start` | `deploy.start` | the start command, as one argument: `zekno settings set web.start "bun run start"` |
| `restart` | `deploy.restart` | `no`, `on-failure` or `always` |
| `memory` | `deploy.memory` | a size such as `512m` or `1g` |
| `cpus` | `deploy.cpus` | a number such as `0.5` or `2` |
| `port` | `networking.port` | `1` to `65535` |
| `publish` | `networking.publish` | `1` to `65535` |
| `secrets` | `variables.secrets` | names separated by `,`; spaces around each are dropped |
| `plain.<NAME>` | `variables.plain.<NAME>` | any value, empty included; a new name is added last |
| `volumes.<vol>` | | a mount path; a new volume is added last |

A later setting (`build`, `predeploy`, `healthcheck`, `replicas`, `domains`, with or without its
section) is CS6. Anything else is CS5. A service the file does not have is CS4: `set` never adds a
service.

### At a terminal (board `CmdSettings`, middle column)

```text
$ zekno settings set web.memory 1g
  web · memory limit  512m → 1g
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to use it.
```

- The change line (`Ui.settingChange`) from column 2: `<svc> · <label>` dim, two spaces, the old
  value in the text colour, ` → ` with the arrow dim, the new value bold. A value not set reads as
  the words of a setting left out (`no limit`, `the image's own`, ...; contracts/app-screen.md,
  "Words"). As built: an empty plain value reads `""`, so it is seen.
- The question is CS9 with today's yes-or-no question (`Ui.confirm`): `?` in the brand colour, its
  first sentence bold, `(y/N)` dim, and `yes` or `no` left after it. "No", Enter, Esc or Ctrl-C:
  `Nothing was done.`, status 1, nothing written.
- With `--yes` the question is not asked.
- Then CS11: `✔` green, `Written` in the text colour, `Run zekno deploy to use it.` dim, two spaces
  after it (`Ui.success(text, detail)`).

A value that is not allowed (board):

```text
$ zekno settings set web.memory lots
✖ That is not a memory limit.
  Use a size such as 512m or 1g.
```

exit status 2, without the help line (`WrongInput`, research R9, item 16), and the file is not
touched.

### Piped

The change line on standard output as `<svc> · <label>  <old> → <new>`, then, with `--yes`,
`Written  Run zekno deploy to use it.` on standard output, status 0. Without `--yes`: the change
line, then CS10 on standard error, status 1, nothing written.

### Order of checks

1. The words: no `<service>.<setting>` (CS1, status 2 with the help line), no value (CS2, same),
   anything after the value (today's ``Unexpected "<x>" after `zekno settings set`.``, 2).
2. The setting's name: CS6 or CS5 (status 2).
3. The file, read and checked whole (contracts/settings-file.md, status 1); no file: SH1 (1).
4. The service: CS4 (2).
5. The value: CS7 (2); the same as now: CS8 (0, nothing written).
6. The file with the change, checked whole as the reader checks a file: CS17 (2).
7. The change line; the question, `--yes`, or CS10 (1).
8. The write (research R5): CS12, CS13, CS14 (1); else CS11 (0).

## `zekno settings unset <service>.<setting> [--yes]`

As `set`, with no value: the setting is removed from the file (a plain variable or a volume by its
name). The change line ends with the words of a setting left out: `web · memory limit  1g → no
limit`. `image` cannot be unset (CS15, 2). A setting that is not set: CS16 (0, nothing written).
Removing a volume from the settings does not delete its data (FR-012): the docs say how to remove
it on the server.

## `zekno settings compose`

Prints the Compose text the settings turn into (FR-026, FR-027), without a server, a team or a
keychain read.

- **Piped**: the text exactly, byte for byte: each line of it with `Ui.line(line, [quiet(line)])`,
  so standard output is the text and its last line feed.
- **At a terminal**: the same lines, dim, as the board draws them. A line wider than the window
  wraps, as any line does; to copy the text, pipe it (`zekno settings compose > compose.yaml`).
- Status 0; a fault in the file: its sentence, status 1. No Compose text holds a secret's value.

## `zekno settings init`

Starts a settings file (research R8; design: "Starts a file by asking for the image and the
service's name").

At a terminal:

```text
$ zekno settings init
? Image › ghcr.io/acme/demo-web:1.4.2
? Service name › web
✔ Written zekno.app.json  Run zekno deploy to use it.
```

- IN4 first, before any question, when `zekno.app.json` is here (status 1).
- IN1, a typed answer checked with the image rule (the reason: SV8's rule, `Use an image
  reference, such as ghcr.io/acme/web:1.4.2.`); IN2, filled with `web`, checked with the service
  rule (`Use lowercase letters, digits and hyphens, starting with a letter.`).
- The file is created whole, never over another (research R5, "Creating"): IN3.
- IN6 as a note when `compose.yaml` is here too.
- Esc or Ctrl-C at a question: `Nothing was done.`, status 1, nothing written.

With no terminal: IN5, status 1, nothing written.

## Sentences

`<file>` is `zekno.app.json` as a sentence names it; `<svc>`, `<label>`, `<old>`, `<new>` as
above, each shown only after it passed its rule. Statuses in brackets.

| Id | Sentence |
|----|----------|
| SH1 | `This folder has no settings file. Run zekno settings init to start one.` (design) [1] |
| SH2 | `This folder deploys <file>, a Compose file written by hand, so it has no settings to show.` [1] |
| SH3 | `This folder's zekno.json names <compose file>, so zekno deploy uses it, not these settings.` (a warning; the status is unchanged) |
| CS1 | ``Say which setting: `zekno settings set <service>.<setting> <value>`.`` (`unset`: ``Say which setting: `zekno settings unset <service>.<setting>`.``) [2, with the help line] |
| CS2 | ``Say the new value: `zekno settings set <service>.<setting> <value>`.`` [2, with the help line] |
| CS3 | not used: CS1 covers `unset` |
| CS4 | `zekno.app.json has no service <svc>. Its services are <svc>, <svc>.` (`<svc>` given is named only when it passes the service rule, else `that service`) [2]. As built: a name that breaks the rule reads `zekno.app.json has no such service. Its services are web, worker.`; a file with one service reads `Its service is web.` |
| CS5 | `There is no such setting. The settings are image, start, restart, memory, cpus, port, publish, secrets, plain.<NAME> and volumes.<name>.` [2] |
| CS6 | The second sentence of SL1 to SL5 for that setting, such as `Domains are not in this version of zekno yet.` [2] |
| CS7 | `That is not <a label>.` then the rule (table below) [2] |
| CS8 | `<svc> · <label> is <old> already. Nothing was written.` [0] |
| CS9 | `Write this to zekno.app.json? Nothing is deployed until you deploy.` (design) |
| CS10 | ``There is no terminal to ask on. Add `--yes` to write it to zekno.app.json.`` [1] |
| CS11 | `Written` with the detail `Run zekno deploy to use it.` (design) [0] |
| CS12 | `zekno.app.json changed since zekno read it, so nothing was written. Try again.` [1] |
| CS13 | `zekno.app.json is a symbolic link. zekno changes it only as a file of its own.` [1] |
| CS14 | `Could not write zekno.app.json.` [1] |
| CS15 | `A service needs an image, so source.image cannot be unset.` [2] |
| CS16 | `<svc> · <label> is not set. Nothing was written.` [0] |
| CS17 | `That change cannot be written.` then the place and rule of the settings-file sentence it breaks, such as `web, networking.publish: set networking.port too, the port it reaches.` [2]. As built: a change that would make the file larger than 64 KiB is `That change cannot be written. zekno.app.json is larger than the 64 KiB a settings file may be.`; a sentence with `(line <n>)` names the line of the file as it would be written. |
| IN1 | `Image` (the question) |
| IN2 | `Service name` (the question) |
| IN3 | `Written zekno.app.json` with the detail `Run zekno deploy to use it.` [0] |
| IN4 | `There is already a zekno.app.json here. Change it with zekno settings set, or in an editor.` [1] |
| IN5 | `There is no terminal to ask on. Run zekno settings init at a terminal, or write zekno.app.json yourself.` [1] |
| IN6 | `This folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f <file>.` |

### Each setting's words

| Setting | `<label>` | `That is not <a label>.` | The rule |
|---|---|---|---|
| `image` | `image` | `That is not an image reference.` | `Use one such as ghcr.io/acme/web:1.4.2.` |
| `start` | `start command` | `That is not a start command zekno can run.` | the reason of SV9 (a) to (e), as a sentence: `A quote does not close.` |
| `restart` | `restart rule` | `That is not a restart rule.` | `Use no, on-failure or always.` |
| `memory` | `memory limit` | `That is not a memory limit.` (design) | `Use a size such as 512m or 1g.` (design) |
| `cpus` | `processor limit` | `That is not a processor limit.` | `Use a number of processors, such as 0.5 or 2.` |
| `port` | `port` | `That is not a port.` | `Use a port from 1 to 65535.` |
| `publish` | `published port` | `That is not a port.` | `Use a port from 1 to 65535.` |
| `secrets` | `secrets` | `That is not a list of secret names.` | `A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.` |
| `plain.<NAME>` | `<NAME>` | `That is not a value zekno can write.` | `Use one line with no control character, at most 4096 characters.` |
| `volumes.<vol>` | `volume <vol>` | `That is not a mount path.` | `Use an absolute path in the container, such as /data.` |

## Exit statuses

| Status | When |
|--------|------|
| 0 | shown, written, printed; a value the same as now; unset of a setting not set |
| 1 | no settings file; a fault in the file; "no", Esc or Ctrl-C; no terminal without `--yes`; `init` with no terminal or a file here; the file changed since read, a link, a write that failed |
| 2 | a word missing or too many; a setting this zekno does not know or has not yet; a service the file does not have; a value not allowed; a change that breaks a rule of the file; unset of `image` |

## Tests

- **Both halves for every command**: through `inkUi` with the stand-in terminal
  (`test/support/terminal.ts`), every line of the board `CmdSettings` for design.md's file, at
  100 columns, with the marks from a stand-in history; and through the plain interface, the
  exact lines above, the streams and the statuses.
- **The byte for byte test (FR-027, SC-002)**: for every settings file of the test set, the
  standard output of `zekno settings compose` (plain) equals the `compose` the deploy of the same
  folder signs, as `readSignedDeploy` reads it from the history after `zekno deploy` against the
  stand-in server; and a second run prints the same bytes.
- **`set` and `unset`**: for each setting of the table, a good value and a refused one; the file
  after a change differs from the one before in the changed setting only (read both with the
  reader); a change on the design's file changes exactly one line; no server is contacted (a
  `connect` that throws) and the keychain is not read (a key store that throws); the file
  changed between the read and the write (a stand-in that rewrites it while the question is
  open) is not overwritten, CS12; a symbolic link, CS13; a folder made read-only, CS14 and no
  temporary file left.
- **`init`**: the questions, the file it creates (the reader reads it; it equals
  `settingsText` of the answers), IN4, IN5, IN6, leaving.
- **No secret value anywhere** (SC-004): the stand-in history and secret store hold sentinel
  values; none appears in any output of any of the five commands.
