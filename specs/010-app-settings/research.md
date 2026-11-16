# Research: App settings

Checked on 2026-11-16 on macOS with Bun 1.4.4, Docker Compose 5.3.0 (installed on this machine,
used only for `docker compose config`, which reads a file and contacts nothing) and the
repository at `f0f8303` on `010-app-settings`. What the maintainer decided (handed over in
`spec010-decisions.md`, recorded in [spec.md](./spec.md), [design.md](./design.md) and the boards
in [design/](./design/)) is binding and is marked **(maintainer)**. The rest follows from it, from
the code, or from the probes below. Nothing was run on a server and nothing used the network.

The probes ran in the session's scratchpad (`probe010/`), never in the repository:

- `yaml1.ts`: what `Bun.YAML.stringify` writes, for a Compose-shaped object and for 53 awkward
  strings, and whether `Bun.YAML.parse` reads each back.
- `emit.ts`, `example.ts`: a hand-written Compose writer (R2), its output for the design's file
  and for hostile values, read back with `Bun.YAML.parse`, with the CLI's own `expectedValues`,
  and with `docker compose config`.
- `printer.ts`: a JSON writer for the settings file (R5), compared byte for byte with the
  design's example.
- `help-probe.ts`: the app's help screen and the app screen's hint line with one more key, drawn
  through the CLI's own `AppView` at 100 by 30 and 80 by 24 (R7).

## R1. The grammar of each setting, and the limits **(maintainer: JSON, read strictly, bounded in size and counts, duplicate keys refused; a named volume only)**

- **Decision.** The full grammar, with a sentence for every fault, is
  [contracts/settings-file.md](./contracts/settings-file.md). In short:

  | Setting | Value | Rule |
  |---|---|---|
  | `zekno` | the number `1` | required; an integer of 2 or more is a later version (SL0) |
  | service name | key of `services` | `^[a-z][a-z0-9-]{0,62}$`: as an app name, but it starts with a letter |
  | `source.image` | string | required; a Docker image reference: `[host[:port]/]path[:tag][@sha256:<64 hex>]`, path parts `[a-z0-9]+` joined by `.`, `_`, `__` or `-`s, tag `[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}`, host parts letters, digits and inner hyphens; at most 255 characters |
  | `deploy.start` | string | words split on the developer's machine (below); 1 to 4,096 characters, 1 to 256 words, one line, no control character |
  | `deploy.restart` | string | `no`, `on-failure` or `always` |
  | `deploy.memory` | string | `^[1-9][0-9]{0,4}[mg]$`, at least `6m` (Docker's least) |
  | `deploy.cpus` | number | written as `^(0|[1-9][0-9]{0,3})(\.[0-9]{1,2})?$`, more than 0 and at most 1024 |
  | `networking.port` | number | an integer from 1 to 65535 |
  | `networking.publish` | number | an integer from 1 to 65535; needs `port`; no two services publish the same |
  | `variables.secrets` | list of strings | each `SECRET_NAME` (`^[A-Za-z_][A-Za-z0-9_]*$`), at most 128 characters, not reserved (`isReservedSecretName`), not twice; at most 256 per service, and at most 256 different names across the app (`LIMITS.secretsPerDeploy`) |
  | `variables.plain` | object of string to string | name as a secret name (reserved names allowed: R9, item 18); value one line, no control character, at most 4,096 characters, may be empty; not also a secret of the same service; at most 128 per service |
  | `volumes` | object of string to string | name `^[a-z][a-z0-9_-]{0,62}$`; mount path `^(/[A-Za-z0-9._@+-]+)+$` with no `.` or `..` part, at most 255 characters; no two volumes of a service at one path; at most 16 per service |

  Limits on the whole file: at most **65,536 bytes**, strict UTF-8, objects nested at most **6**
  deep (the file, `services`, a service, a section, `plain` or `volumes`, and nothing deeper),
  any string (key or value) at most 4,096 characters, at most **32 services**. The Compose text
  it turns into must fit the deploy limit, `LIMITS.composeBytes` (256 KiB); a file within its own
  limits can still pass it (names of one character listed many times), so that is checked last
  (SV33).

- **How it is read** **(maintainer: zod `strictObject`s, as `zekno.json` is)**. Two steps. First
  zekno's own small JSON reader (`settings/json.ts`) reads the text into values and records the
  line of every key: `JSON.parse` keeps the last of a key written twice and knows no lines, the
  design's sentences name a line (`(line 9)`), and duplicate keys must be refused at every depth
  (`objectKeys` in `project/file.ts` reads only strings and objects, which is enough for
  `zekno.json` and not for settings). Then the shape and the types are checked with zod
  `z.strictObject`s (`settings/schema.ts`), the value rules as refinements that call
  `settings/values.ts`; the known keys of each object, which the walk for unknown and later
  keys needs, are read from the same schemas' `shape`; a zod issue becomes a place and a rule by
  its path, and of several the one on the lowest line is said.

- **Every string the settings can put on a screen or into the Compose text** holds no control
  character (Unicode `Cc`, which covers C0, DEL and C1), no U+2028 or U+2029, no U+FEFF, U+FFFE or
  U+FFFF, and is well formed (no lone surrogate). The probe showed why the last matters:
  `Bun.YAML.stringify` writes a lone surrogate as it is and it does not read back the same.

- **The start command** is split into words on the developer's machine, by this grammar, and
  sent as a list (R2):

  ```text
  command = *SP word *( 1*SP word ) *SP
  word    = 1*( bare / single / double )
  bare    = any character but SP, ', ", \ and the shell characters ; & | < > ( ) $ `
  single  = "'" *( any character but ' ) "'"                ; taken as written
  double  = DQUOTE *( any character but " and \ / "\" ( DQUOTE / "\" ) ) DQUOTE
  ```

  It runs without a shell: nothing in it is expanded, on this machine or on the server. The
  shell characters outside quotes are refused, with a sentence that says to quote them or to
  start the command with `sh -c` (the usual way to get a shell in a container). `sh -c 'echo
  $PORT'` reaches the container as the three words `sh`, `-c`, `echo $PORT`, and the container's
  shell expands `$PORT` there.

- **Rationale.** Each grammar is the narrowest that holds what a person coming from a managed
  platform types, and nothing that could leave its place in the Compose text (R2). Names start
  with a letter so that `JSON.parse` keeps them in the order they were written: an object key
  that is a whole number (`"123"`) is put first by JavaScript, which would change the order of
  services and of the Compose text. A service name is also a host name the other services reach
  it by (US1, scenario 2), so it is lowercase.

- **Alternatives considered.** Compose's own looser rules (any service name of
  `[a-zA-Z0-9._-]`, `unless-stopped`, sizes in `b`, `k`, `kb`): more ways to write one thing, for
  no setting a newcomer needs. A `start` passed as one string for Compose to split (R2).

## R2. How the Compose text is produced **(maintainer: the developer's machine makes it, it is the only thing signed, a value must not break out of its place; no new dependency)**

- **What Bun can write.** `Bun.YAML.stringify(value, null, 2)` writes block YAML and chooses for
  each string whether to quote it (probe `yaml1.ts`). Its choices are made for Bun's own reader:
  every one of 53 awkward strings read back the same in `Bun.YAML.parse`, but it left
  `2026-11-16` and `1_000` unquoted, which a YAML 1.1 reader takes as a date and a number, and it
  wrote a lone surrogate raw (it did not read back). The reader that matters is the one Docker
  Compose uses on the server, not Bun's. Its output can also change with a Bun release, and the
  same settings must give the same bytes on two machines (US4, scenario 2), which may run
  different Bun versions from source.
- **Decision: write the few lines by hand** (`apps/cli/src/settings/compose.ts`), in a fixed
  form, every string double-quoted and escaped:
  - The keys Compose defines (`services`, `image`, `command`, ...) are written plain: they are
    the program's constants.
  - Every name that comes from the settings (a service, a variable, a volume) and every string
    value is written in double quotes. Inside the quotes only two characters are escaped for
    YAML, `\` as `\\` and `"` as `\"`: every other character a setting may hold (R1) stands for
    itself in a YAML double-quoted scalar. Nothing else can end the scalar, start a comment, a
    tag, an anchor, an alias, a flow collection or a new line.
  - Every `$` is written `$$`, so Compose keeps it as one literal `$` instead of reading a
    variable (`${...}` in a plain value or the start command stays as typed).
  - A secret becomes `"NAME": "${NAME}"` in `environment`: the one place the text asks Compose
    to read a variable, and only a name held to `SECRET_NAME`. The runner already starts
    `docker compose` with the app's secrets in its environment and nothing else of its own but
    `PATH`, `HOME` and Docker's (`apps/runner/src/docker/compose.ts`), so Compose fills it there.
    The text never holds a value.
  - The start command is written as a flow list of its words, `command: ["bun", "run",
    "start"]`: the exec form. Compose gets the exact words this machine split and signed.
  - The only number written plain is `cpus`, from the number held to R1's form; ports go into
    strings (`"8080:3000"`).
  - A volume is written in Compose's long form, `type: "volume"`, `source`, `target`, so it can
    only ever be a named volume (`type: "bind"` is never written, decision 6).
  - The exact lines for each setting and the full worked example are
    [contracts/compose-text.md](./contracts/compose-text.md).
- **Checked** (probe `emit.ts`): a plain value holding `"`, `\`, `$HOME`, `${X}`, `$$`, `#`, `:`,
  `{x}`, `[y]`, `&a`, `*b`, `!t`, `'s'`, accented and CJK text and an emoji, a value `no`, an empty
  value, a start command `sh -c 'echo $PORT && exit 0'`, and a service named `true`: each read
  back by `Bun.YAML.parse` exactly as meant (the `$` still doubled, as Compose expects), and
  `docker compose -p zekno-demo -f <text> config` read the file without error, gave the service
  `true` its image, `mem_limit` 1 GiB, `cpus` 1 and 0.5, `expose ["3000"]`, the port `80:8080`,
  the named volume `zekno-demo_uploads` in long form, the commands as lists, and printed every
  literal `$` as `$$`, its own escape, so none was taken as a variable. `expectedValues`, which
  lists the values a deploy asks for (`project/compose-file.ts`), found `DATABASE_URL` and
  `SESSION_KEY` and nothing else.
- **Rationale.** About 60 lines whose every output byte is decided here: stable across machines
  and Bun versions, readable by any YAML reader the same way, and checkable by a test that pins
  the bytes (the design's example is 594 bytes, SHA-256 `b2b84104158cddf3eeab5936aee8d42782fb96cf234a87cda3700c778747c11a`).
- **The start command as a list, not a string.** Compose splits a string `command` itself, with
  its own shell-like rules, on the server, and refuses an unclosed quote there, after the deploy
  was signed and sent. As a list, the words are the ones this machine split, shown by `zekno
  settings compose` and signed; a malformed command is refused before anything is signed.
- **Alternatives considered.** `Bun.YAML.stringify` (above). Quoting a string only when it needs
  it, as the board's sample shows (R9, item 4): every rule for "needs it" is a rule about some
  reader, and getting one wrong lets a value change type. A JSON Compose file (JSON is YAML): it
  would carry `$` the same way and be harder to read in a pull request.

## R3. How the link file `zekno.json` relates

- **What its signed `compose` field holds today.** A path relative to the linked folder, signed
  by a member (`packages/core/src/deploy/link.ts`, `LinkSchema`): 1 to 255 characters, no
  control, format or line-separator character, not absolute, no `\`, no `.` or `..` part. Nothing
  says it ends in `.yaml`. The CLI reads it with `readCompose({ kind: "project", link })`, inside
  the link's folder, and `signerOf` checks that the plain field equals the signed one.
- **Decision.** `zekno.json` may name `zekno.app.json` in its `compose` field. The core already
  allows it and nothing in `packages/core` changes. The CLI decides which kind of file a path is
  by its name: a file whose name is exactly `zekno.app.json` is a settings file, any other a
  Compose file, wherever the path comes from (`-f`, `zekno.json`, the folder). The signature
  covers the file's name, never its content, as it does for a Compose file today; the content
  is signed as Compose text at deploy time.
- **What `zekno link` does in a folder with a settings file** (when it writes a new
  `zekno.json`): with `-f`, the file named, as today (`zekno link -f zekno.app.json` already
  works). Without `-f`: the one that exists when only one of `compose.yaml` and `zekno.app.json`
  does; with neither, today's sentence (`No Compose file at <path>/compose.yaml. Point to one
  with -f <file>.`); with both, it stops with DP2 and exit status 2, at a terminal too, and asks
  nothing (R9, item 21). Recording a teammate's file as it is (`useAsItIs`) is unchanged.
- **The first deploy's "Remember this folder?"** and the app's "remember this folder?" write
  `zekno.json` naming the file the deploy used.
- **Risk.** A teammate whose zekno is older than this feature and who deploys a folder linked
  to `zekno.app.json` signs the settings JSON as if it were Compose text. Compose refuses it on
  the server (`additional property zekno is not allowed`), so the deploy is accepted and the app
  does not start. Nothing secret is in that text. The docs say every member needs this zekno or
  later for such a folder.

## R4. How "changed, not deployed" is known **(spec FR-019: "when this machine knows what was last deployed")**

- **What this machine keeps of the last deploy.** Every deploy it sent is in its history
  (`secrets/` is values; `history/<serverId>/<app>.json` is the signed envelopes). The signed
  deploy carries the Compose text, and `verifiedDeploys` (`shared/views.ts`) reads it from under
  the signature. "Last deployed" is the latest deploy this machine sent that the runner answered
  (`outcome` not `sent`), as the app screen counts it.
- **Decision.** A new `lastDeployedCompose(store, trust, server, app)` in `shared/views.ts`
  returns that text. `deployedSettings(text)` in `settings/compose.ts` turns it back into
  settings: it reads it with `Bun.YAML.parse` (after `tooManyAliases` and the 256 KiB bound, as
  `composeServices` does), maps each known key back, and keeps the result only if writing those
  settings again gives the very same bytes. Text that zekno did not make from settings (a
  hand-written Compose file, or one from a later zekno) does not come back, and then nothing is
  marked. Then, for each setting shown, it is marked `! changed, not deployed (was <old>)` when
  its value differs from the deployed one, `! changed, not deployed` alone when the deployed
  settings had no such service or setting to name. A start command is compared by its words, so
  a change of spacing is no change.
- **Which app and server.** `zekno settings` compares only when this folder's `zekno.json` is
  signed by the team, in use here (`standingOf` gives `used`; never asked, never accepted) and
  names this folder's `zekno.app.json`; the team is then opened once (one keychain read, as any
  command in a linked folder). The settings screen compares with the app and server it was
  opened from, the team list the app verified when it opened, and the history on disk: no
  further keychain read (R6).
- **What is shown when it cannot be known.** Nothing: no mark and no sentence. That is the case
  with no profile, no usable link, no deploy from this machine, a last deploy that was not made
  from settings, or a history that cannot be read.
- **Known limit.** Only this machine's deploys count. A teammate's later deploy from another
  machine is not seen by `zekno settings`, which contacts no server. The docs say so.
- **Alternatives considered.** Keeping the deployed settings in a new file or a new field of the
  history: a new stored format, against the rule of no format change, and one more thing to
  verify. Comparing whole Compose texts only: it can say that something changed, not which
  setting, which the boards mark row by row.

## R5. How a change is written **(maintainer: never a half-written file, never over a file that changed since it was read, never through a link)**

- **The form.** `settingsText(settings)` in `settings/text.ts` writes JSON with two spaces of
  indent, the keys in a fixed order (`zekno`, `services`; in a service `source`, `deploy`,
  `networking`, `variables`, `volumes`; in each section the order of contracts/settings-file.md),
  services, plain variables and volumes in the file's own order, a section with nothing in it
  left out, and one final line feed. An object or a list is written on one line when that line,
  with its indent, its key and a following comma, is at most 80 characters, except the file,
  `services` and each service, which always open on their own lines. The probe `printer.ts`
  gave the design's example back byte for byte with this rule, and a change of one value
  changed one line of 26.
- **Writing.** `writeSettings(read, settings)` in `settings/write.ts`:
  1. The new text is made and read back by the same reader; it must give the same settings
     (so a written file always reads).
  2. A new file is opened next to it under a name nobody can predict
     (`.zekno.app.json.<16 hex>.tmp`, flag `wx`), given the old file's permission bits, written
     whole and flushed (`fsyncSync`).
  3. The file at the path is looked at with `lstat`: it must be a regular file, not a symbolic
     link (CS13), with one name on the disk, owned by this user, the same device and inode as
     when it was read; then read again from one descriptor opened with `O_NOFOLLOW`, and its
     bytes must have the SHA-256 they had when read (CS12).
  4. Then the new file is renamed over it. The temporary file is removed in every case.
- **Creating** (`zekno settings init`): the same steps 1 and 2, then a hard link to the name,
  which fails when anything is there, as `writeProject` does (`project/write.ts`), so an existing
  file is never replaced, not even one made in between.
- **Not through a link.** A settings file that is a symbolic link may be read (it is content of
  the project, as a Compose file is) when it stays inside its folder, but is never written: the
  person is told to change the file it points to.
- **Known limit.** Between step 3 and the rename there is a window of a few system calls in
  which another program could write the file; its change would be lost. No portable lock closes
  it (an editor does not take one). The docs do not promise more than the check.
- **Alternatives considered.** Keeping the person's layout (a JSON writer that edits text in
  place): more code for no meaning, since JSON has no comments to keep. `Bun.write` over the
  file: not whole on a crash.

## R6. The settings screen in the full-screen app **(maintainer: `e` from an app's screen; its keys; built to the approved look where no board shows it)**

- **Which folder.** The folder the app was started in (`ops.cwd`), the folder whose files `d`
  deploys (`app/effects/deploys.ts`, `composeOf`). The screen shows what `d` on that app would
  deploy:
  - the folder is linked to this app on this server, or not linked: its settings file (the one
    the link names, or `zekno.app.json` here), or a sentence when it has none (SH1) or deploys a
    Compose file (SH2);
  - the folder is linked to another app or server: AS6, and nothing else;
  - the folder's `zekno.json` cannot be used (not signed by the team, not in use here): SH1 or
    SH2 for the folder itself, as for a folder not linked, since `d` would not use the file.
- **The reducer** (`app/state/settings.ts`, new) holds the screen (`{ name: "settings", server,
  app, service, row, view, change? }`), the keys, the change in progress (typing, picking, or
  asking y/N) and the value checks (pure functions of `settings/values.ts`). It never touches a
  file. **The effects** (`app/effects/settings.ts`, new) read the file, compute the rows and
  marks, and write a change; each result comes back as an event (`settings-read`,
  `setting-written`, `setting-refused`). The data model is in [data-model.md](./data-model.md)
  and the look in [contracts/app-screen.md](./contracts/app-screen.md).
- **The keychain.** Opening the screen reads the history with the team list the app already
  verified (`context.trustKnown()`) and the profile folder's store; it never opens the team
  again, so it never asks the keychain. With no verified team list yet (the app opened with none
  known), the screen shows the settings without marks.
- **Edited elsewhere while open.** Every 5 seconds, as the app screen reads what is running
  (`tick`), the settings screen reads the file again when no change is open, and draws what it
  holds now (or the fault that it now has). The last deployed text is read again only when the
  screen opens and when a deploy of this app ends. A change confirmed after the file changed
  is refused (CS12) and the screen reads the file again.
- **At 80 columns.** The board is about 110 columns wide. Below 100 columns the header shows the
  state alone (as the app screen does), the Services pane keeps its width of 22, and a value
  wider than its column goes on under itself, never under the labels. The service pane scrolls
  to keep the selected row in view, with `↑ <n> more` and `↓ <n> more` lines, as the lists of
  single commands do (`listWindow`, `ui/ink/questions.tsx`).
- **Too small, light terminal.** Below 80 by 24 the app's "too small" message shows instead, as on
  every screen; the screen and any change in progress come back as they were. Colours come from
  the theme (`useTheme`), which has the light terminal's colours.
- **Rationale.** The same split as every screen of the app (`app/state/` pure, `app/effects/`
  doing). The same source rule as `d`, so the screen never shows settings that `d` would not
  deploy.

## R7. What the key `e` on the app's screen touches

- **The hint line.** `HINTS.app` gains `["e", "settings"]` after `["x", "remove secret"]`. The
  probe drew it: at 100 columns the line no longer fits (104 characters for 98) and `esc back`
  goes on a second line, so the app screen's body loses one row; at 80 columns it wraps after
  `x remove secret` as it does today, with `e settings  tab pane  esc back` on the second line.
- **The help screen does not change.** The probe added `e settings` to its "An app" group: at
  80 by 24 the column no longer fits and the word "selected" of `remove the selected secret` is
  cut. FR-030 allows changing only the way into the settings screen, so `e` is on the app
  screen's hint line and in the docs, not in help (R9, item 8).
- **Existing tests that change.** `test/app/app-operate.test.tsx`: the board app screen's last
  line at 100 by 30 (now two lines) and the two last lines at 80 by 24 (now with `e settings`).
  `test/app/app-screens.test.tsx` (help) does not change. `test/ui/parts/ui-parts.test.tsx`
  draws its own list and does not change.
- **The agent end-to-end tests.** A recorded step replays when its start route matches
  (`decideTraceReplay`, `node_modules/e2e/dist/cache/decide.js`) and its end anchors hold. Of the
  12 recorded steps, only `tests/rollback.e2e.ts` starts on the app screen (route
  `prod › demo`); it presses `↓` and `r` and ends on the deploy screen. Its anchors are the
  deploy screen's lines and, as gone, pane texts of the app screen, never the hint line. One row
  less of body at 100 by 30 still shows those pane texts. So it is expected to replay. If it
  does not, the model is called once for that step (a few cents on the maintainer's key). The
  other tests act from Home, which does not change.
- **Not to change.** `CONTEXT` in `apps/cli/e2e.config.ts` names the app's keys for the model.
  Its digest is part of every cache entry's key (`agentContextDigest`); adding `e` there would
  make all 12 steps call the model. It is left as it is; no test asks for the settings screen.

## R8. What `zekno settings init` asks and writes **(maintainer: "starts a file by asking for the image and the service's name")**

- **Decision.** At a terminal only. In a folder that has `zekno.app.json` already, it stops with
  IN4 before asking anything. It asks `Image` (a typed answer, held to the image rule), then
  `Service name` (filled with `web`, held to the service-name rule), and creates
  `zekno.app.json` holding `{ "zekno": 1, "services": { "<name>": { "source": { "image":
  "<image>" } } } }` in the form of R5, never over a file (R5, "Creating"). Then `✔ Written
  zekno.app.json  Run zekno deploy to use it.`, and when the folder also has `compose.yaml`, the
  dim note IN6 that a deploy will ask which file. Esc or Ctrl-C: `Nothing was done.`, status 1.
- **With no terminal** it writes nothing and stops with IN5, status 1. It takes no flags for the
  image and the name: a new option of `parseArgs` would be accepted (and ignored) by every
  existing command too, where today an unknown option stops with exit status 2, which FR-028
  forbids.
- **Alternatives considered.** Asking for the start command and the port as well: the design
  says image and name; the rest is one `zekno settings set` each.

## R9. Contradictions, and what no board shows

Each item says what was chosen, and whether a person sees it. The maintainer dropped the
approval step for this feature: these are built as written here, listed in the builders'
reports, and reviewed on the real program.

**Contradictions**

1. **A secret with no value, with no terminal** (spec US1, scenario 3: "with no terminal the
   deploy stops with today's sentence"). Today a deploy with no terminal does not check values
   at all: Compose sets a missing one to empty on the server, with its own warning. There is no
   such sentence today. Chosen: today's behaviour (FR-010, FR-028). A person sees it (scripts).
2. **CI as a later setting** (spec SC-008 lists CI among the later settings with "a named place
   in the format"; design.md's approved table reserves `build`, `predeploy`, `healthcheck`,
   `replicas` and `domains`, and no place for CI). Deploys from CI are about which key signs,
   which the team list holds, not about the project's settings. Chosen: the approved table; the
   deploy v2 document (T065) says where CI belongs and why it is not a setting. A person does
   not see it.
3. **"Changed, not deployed" words.** design.md: `! changed, not deployed (was 512m)` "beside the
   value"; the board `CmdSettings` shows `! changed, not deployed` without `(was …)`; the board
   `AppSettings` shows it with. Chosen: design.md's words on both surfaces (it is binding for
   words). A person sees it.
4. **The Compose text's look.** The board `CmdSettings` shows `image: ghcr.io/...`,
   `command: bun run start`, `DATABASE_URL: ${DATABASE_URL}` unquoted. Chosen: R2's form
   (`"web":`, `image: "ghcr.io/..."`, `command: ["bun", "run", "start"]`,
   `"DATABASE_URL": "${DATABASE_URL}"`). design.md left the exact text to the plan. A person
   sees it (`zekno settings compose`).
5. **The deploy summary's secrets line.** The board `SettingsDeploy` draws
   `secrets  DATABASE_URL v3, SESSION_KEY v1` and says "Only the 'from' line is new. Everything
   else is today's deploy." Today's line is drawn by `Summary` (`ui/parts/deploy-summary.tsx`).
   Chosen: today's line; only `from` is added. A person sees it.
6. **The screen during a change.** The board `AppSettingsEdit` shows one pane (dim border) with
   the section of the setting being changed and the change box at its foot, no Services pane;
   its right column is the board's own explanation. Chosen: as drawn, literally: while a change
   is open the Services pane is not drawn and the pane shows that section only. A person sees
   it.
7. **The "which file" list.** The board draws its label column 150 px wide (about 18 columns);
   every list of single commands draws `max(11, longest label + 2)`, here 16. Chosen: the
   existing list, unchanged. A person sees it.
8. **The help screen.** It lists every key of the app, but `e` does not fit at 80 by 24 (R7).
   Chosen: help unchanged; `e` is on the app screen's hint line and in the docs. A person sees
   it.
9. **The change line's spacing.** design.md writes `web · memory limit   512m → 1g` (three
   spaces); the board two. Chosen: the board's two (it is binding for spacing). A person sees
   it.

**Not on any board, settled here as the smallest thing consistent with the boards**

10. **Where `e settings` goes** in the hint line: after `x remove secret`. At 100 columns the
    line then takes two rows (R7). A person sees it.
11. **The words of a setting that is not set** on the screen (dim): start `the image's own`
    (design.md's table), restart `no` (Compose's own default), memory and cpus `no limit`,
    port, secrets, plain and volumes `none`, published `not published` (board). A person sees
    them.
12. **How values read at a terminal.** restart `on-failure` as `on failure` (both boards), `no`
    and `always` as they are; the command's port line `3000, not published` (board) or
    `3000, published on 8080`; a plain variable `NAME=value`; a volume as its name and path.
    A person sees them.
13. **`zekno settings`' first line** without a usable link: the file's name alone, bold
    (`zekno.app.json`), since the app is not known. With one: `<app>  from <file>` (board).
    A person sees it.
14. **The board caption** "A section with nothing set is left out. Values of secrets are never
    shown." under `zekno settings` is read as the board's explanation, like the dim captions
    on `SettingsDeploy`, and is not printed. A person sees it.
15. **Plain output and `--json`.** Plain lines are the file's values (`on-failure`, not
    `on failure`), one setting a line, without marks; `--json` is the file's data only
    (board: "--json gives the file's own data"). Scripts see it.
16. **Exit status 2 without the help line.** The board gives a value not allowed exit status 2
    and shows only its two lines; the board `SettingsDeploy` does the same for both files with
    no terminal. Today a `UsageError` adds `Run zekno --help for the list of commands.` A new
    error, `WrongInput` (`cli/errors.ts`), gives status 2 without it, for these cases only.
    A person sees it.
17. **`set` names.** Both `web.memory` (board) and `web.deploy.memory` (the form plain output
    prints) are taken, so what a script reads can be given back. A plain variable is
    `web.plain.NAME`, a volume `web.volumes.name`. `set` changes a service that exists; a new
    service is added in the file (or with `init` for the first). A person sees it.
18. **Plain variables may use a name zekno keeps for secrets** (`PATH`, `DOCKER_HOST`): those
    names are kept from the runner's own environment, and a plain variable goes into the
    container's, through the Compose text. A person sees it.
19. **The start command runs without a shell**, and shell characters must be quoted (R1). The
    design says only "the start command". A person sees it.
20. **Changing from the screen.** An empty answer removes a setting that can be left out (the
    image cannot be). Adding a plain variable or a volume is done with `zekno settings set`; on
    their `none` row `enter` says so (AS7). An answer equal to the value closes the box and
    writes nothing. A person sees it.
21. **Both files, outside `zekno deploy`.** `zekno link` without `-f` stops with DP2 at a
    terminal too (no question: the question is the deploy's). The app's `d` in a folder that is
    not linked and has both says DP5 and deploys nothing: the app has no list question of this
    kind. A person sees it.
22. **The deploy question's line left behind**: `✔ From  zekno.app.json` (the word of the
    summary's `from` row), as every list leaves `✔ <word>  <choice>`. A person sees it.
23. **The deploy summary's `from` row** is added for a deploy from settings only. A deploy from
    a Compose file draws today's summary. In the app's deploy screen, a deploy from settings
    shows the settings file's path in its existing `from` row, with no list of services.
    A person sees it.
24. **`port` without `publish`** becomes `expose: ["3000"]`: Compose does nothing with it but
    record it, and other services reach the port either way (US1, scenario 2). A person sees
    it in the Compose text.
25. **The settings screen in every state no board shows**: no settings file, a Compose file,
    linked elsewhere, a fault in the file, both files; the typing and picking steps of a change
    and their hint lines; the Compose text view behind `c`; the scroll lines. The words are in
    contracts/app-screen.md. A person sees them.
26. **`zekno settings` and a `zekno.json` it cannot use**: no marks, no warning, no question,
    and when this folder's link names a Compose file while `zekno.app.json` is here too, one
    warning that `zekno deploy` uses the Compose file (SH3). A person sees it.
27. **`init` with `compose.yaml` here**: a dim note that a deploy will ask which (IN6).
    A person sees it.
28. **A published port** is published on every address of the server, as Compose does, and
    Docker's published ports can pass a host firewall such as `ufw`. The docs say so. A person
    reads it.

## R10. What cannot be met as written

- Spec US1, scenario 3, "with no terminal the deploy stops with today's sentence": there is no
  such sentence today (R9, item 1). Built as today.
- FR-024 "a file that changed since it was read MUST NOT be overwritten": checked right before
  the rename; a change made in the few system calls between the check and the rename is not
  seen (R5, "Known limit").
- FR-019 "when this machine knows what was last deployed": met for this machine's own deploys;
  a teammate's later deploy is not known (R4).
- SC-001 (under 5 minutes) is measured once in the walkthrough with stand-ins, not by a test.
- Everything else can be met without changing `packages/core`, `apps/runner` or any message
  format.
