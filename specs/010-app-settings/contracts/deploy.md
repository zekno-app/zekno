# Deploy Contract: deploying from settings

User Story 1 (FR-008 to FR-013). design.md's decision 3, its words ("Deploy summary, new line",
"Both files") and the board `SettingsDeploy` are binding. The rule is `chooseSource` and
`readSource` in `apps/cli/src/settings/source.ts`; it is used by `prepareDeploy`
(`ops/deploy.ts`), by `zekno deploy` at a terminal (`asking/first-deploy.ts`), by `zekno link`
(`ops/link.ts`) and by the app's `d` (`app/effects/deploys.ts`).

## Which file a deploy uses

In this order; the first that applies decides (design, decision 3):

1. **`-f <file>`**, either kind: a file named `zekno.app.json` is read as settings, any other as a
   Compose file (research R3).
2. **The file this folder's link names**: the `zekno.json` that applies here, when it is signed by
   the team, in use here and its app is the one deployed (`withProject` gives it as `project`,
   today's rule, unchanged: FR-013). Its `compose` field may name `zekno.app.json`.
3. **The one that exists**, when only one of `compose.yaml` and `zekno.app.json` is in the folder
   the command runs in.
4. **Both, and nothing above**: at a terminal, the question DP1; with no terminal, DP2 and exit
   status 2, nothing read, signed or sent.

With neither file and nothing above: today's sentence, unchanged (FR-028):
``No Compose file at <folder>/compose.yaml. Point to one with `-f <file>`.``

Neither file is ever picked silently over the other. A `zekno.json` not signed by the team stays
as it is (FR-013): with no terminal it stops the command (S1); at a terminal it is named and left
aside, and rules 3 and 4 apply.

As built (US1, 2026-11-16): for rules 3 and 4 a file is there when anything has its name in the
folder, looked at without following a link (`present` in `settings/source.ts`, `lstat`). A link
to nowhere, a link out of the folder and a folder of that name all count, so a `compose.yaml`
that is a dangling link beside `zekno.app.json` is "both", never a silent pick of the settings;
the reader of the file chosen then says what is wrong with it (`No Compose file at ...`, SR1,
SR2, SR9). Only "no such entry" is absence.

Once chosen, the file is read once (`readSource`): a Compose file as today (`readCompose`); a
settings file as contracts/settings-file.md says, then turned into the Compose text
(contracts/compose-text.md). From there on the deploy is today's: the text that was read is the
text that is checked, signed, sent and recorded (FR-009, FR-010); the values the text expects are
asked for at a terminal (`expectedValues`, which finds each secret's `${NAME}`); rollback, status
and logs work on it as on any deploy.

A fault in the settings file stops the deploy with its sentence, status 1, before the team is
used to sign anything; at a terminal, before any question but the first-use question and DP1.

## The question for both files (board `SettingsDeploy`)

At a terminal, after the first-use question of a `zekno.json` (when there is one) and before any
other question or connection:

```text
? Deploy from which file?
  ❯ zekno.app.json  your settings
    compose.yaml    a Compose file written by hand
  ↑↓ move   enter choose   esc leave
```

- `Ui.choose` with the rows `zekno.app.json` / `your settings` and `compose.yaml` /
  `a Compose file written by hand`, in this order, `collapsed: "From"`, `missing` DP2. It draws
  as every list of single commands (`ListPrompt`): the label column `max(11, longest + 2)`
  (research R9, item 7).
- Enter: `✔ From  zekno.app.json` (or `compose.yaml`) stays, and the deploy goes on with that
  file.
- Esc or Ctrl-C: `✖ Nothing was done.`, status 1.
- "Remember this folder?" (F5 of feature 006), when it is asked, writes `zekno.json` naming the
  file chosen.
- As built: the file chosen is read as the one in this folder is (`readInside`: inside the folder
  by its real path, never through a link out of it), not as `-f` reads a file (links followed). A
  row of a list is not a path the person typed, and both files are content of the folder.
- As built: with no profile, DP1 comes before the opening line (F1) as well as before
  `Your name`, since it is asked in step 1, where the file is read.

## The summary's `from` line (board `SettingsDeploy`)

At a terminal, a deploy from settings draws one more row in the summary panel, after `server`:

```text
app      demo
server   prod deploy@203.0.113.7
from     zekno.app.json  2 services: web, worker
secrets  ...
```

- DP3: the label `from`; the file as the deploy names it (`shownFile`), in the text colour; two
  spaces; `<n> services: <names>` dim (`1 service: web` for one). The names in the file's order.
- `DeployStart` (`shared/deploy.ts`) gains `from?: { file: string; detail: string }`;
  `DeployProgress` gains `fromDetail?: string`; `Summary` (`ui/parts/deploy-summary.tsx`) draws the
  detail dim after the file. The rows of the panel are otherwise today's (research R9, items 5
  and 23).
- A deploy from a Compose file draws today's summary, with no `from` row.
- Plain output and `--json` do not change for either kind: the result line, and the one JSON
  object.

## `zekno link`

Writing a new `zekno.json` without `-f` (research R3): `compose.yaml` when only it is here (as
today), `zekno.app.json` when only it is here, DP2 and status 2 when both are (at a terminal too;
no question), and today's sentence when neither is. With `-f`, the file named, as today.

As built: at a terminal, when `zekno link` would ask for the server or the app before writing a
new `zekno.json` (no usable one applies here), DP2 is said before those questions, so nobody
answers two questions to be refused (`linkDetails` in `cli/cli.ts`); `linkFolder` says it too.

## The app's `d`

The app deploys the folder it was started in (`composeOf`, `app/effects/deploys.ts`), now by the
same rule: a linked folder, the file its link names (which may be `zekno.app.json`); a folder
that is not linked, the one of `compose.yaml` and `zekno.app.json` that exists. With both and no
link, it deploys nothing and says DP5 on the status line. With neither, today's sentence. A
settings file with a fault: its sentence as an error notice. "Remember this folder?" writes
`zekno.json` naming the file deployed. The deploy screen's `from` row shows the file's path, as
today.

As built (T034, 2026-11-16): `composeOf` uses `chooseSource` and `readSource`. A linked folder's
file is read by its name (rule 2). A folder that is not linked: both names there gives DP5 as an
error line, before "Choose an app first", with nothing read. Whether a name is there is looked at
without following a link (`present`), as for `zekno deploy`: a `compose.yaml` that is a link to
nowhere beside `zekno.app.json` is "both". The same link alone, with no `zekno.app.json`, is now
read, so the app says its reader's sentence (``No Compose file at <folder>/compose.yaml. Point to
one with `-f <file>`.``) where it said before ``There is no compose.yaml in <folder>, and no
zekno.json names another. Run zekno link -f <file> here to name one.``; that line stays for a
folder with neither name. A fault of the settings file is the reader's `CliError`, said as an
error line (the app's `failed` event) when `d` is pressed, before "remember this folder?" and
before anything connects. "Remember this folder?", its `zekno.json` and the missing-values list
name the file as `zekno.app.json` or `compose.yaml` (a folder not linked) or as the link's
`compose` field (a linked one). The Compose text signed is `composeText` of the file, the text
`zekno settings compose` prints (test/app/app-effects.test.ts).

## Sentences

| Id | Sentence | Status |
|----|----------|--------|
| DP1 | `Deploy from which file?`, rows `your settings` and `a Compose file written by hand` (design) | |
| DP2 | `This folder has zekno.app.json and compose.yaml. Say which with -f <file>.` (design), with no help line (`WrongInput`) | 2 |
| DP3 | `from` row: `<file>  <n> services: <names>` (design) | |
| DP4 | not used: `zekno link` says DP2 | |
| DP5 | `This folder has zekno.app.json and compose.yaml. Run zekno link -f <file> here to say which.` (the app, an error notice) | |

The settings file's own sentences are in contracts/settings-file.md (SR, SJ, SV, SL); a later
setting at deploy is drawn as on the board: `✖ zekno.app.json sets a domain for web.` (bold), then
`  Domains are not in this version of zekno yet.` (dim).

## What does not change

- The runner, `packages/core`, the session protocol and every message: a deploy from settings
  sends a Compose text, as every deploy does (FR-029).
- `zekno deploy` with no terminal in a folder with no settings file: the same calls, lines and
  status (FR-028; `test/plain/plain-unchanged.test.ts`).
- The rules of `zekno.json` (FR-013), the questions for a missing server, app or value, the
  stages, the deploy number, the history, rollback, status and logs (FR-010).
- Removing a service from the settings stops it at the next deploy: the runner runs
  `docker compose up -d --remove-orphans`. Removing a volume keeps its data: Compose never
  removes a named volume on `up` (FR-012).

## Tests

- **End to end against the stand-in server** (`test/support/stand-in-server.ts`, the real runner,
  the stand-in Docker): a folder with only design.md's `zekno.app.json`; `zekno deploy` with
  flags, piped: status 0; the stand-in Docker was started with the Compose text of
  contracts/compose-text.md, byte for byte; the history holds a deploy whose signed `compose` is
  that text; `zekno rollback`, `zekno status` and `zekno logs` work on it (US1, scenarios 1, 2,
  7).
- At a terminal (`answering`): a secret without a value is asked for hidden, as for a Compose
  file (US1, scenario 3); with no terminal the deploy goes on as today (research R9, item 1).
- Both files: at a terminal, DP1 with its rows, each answer, Esc; piped, DP2 and status 2 with
  nothing connected; `-f zekno.app.json` and `-f compose.yaml` each decide without a question; a
  `zekno.json` naming either decides (US1, scenario 4).
- A later setting, each fault kind of contracts/settings-file.md: nothing connected, signed or
  written; the sentence (US1, scenarios 5 and 6).
- `zekno link` in a folder with each combination of the two files.
- The summary through `inkUi`: the `from` row, its dim detail, for one service and for two; a
  Compose deploy's summary unchanged.
- The app's `d` in a folder with only a settings file, linked and not, and with both.
- From a Compose deploy to a settings deploy and back, on the same app: the second deploy's
  Compose text is the new one; a service left out is no longer in it.

## As built: after the security review (2026-11-16)

Written by the implementer of the review's fixes (`security-review.md`, "After the review: what
was fixed"). Where these notes and the sections above differ, these notes are what is built.

- **The exact name (S5).** For rules 3 and 4 a settings file is there only when the folder lists
  `zekno.app.json` exactly (`settingsFileIn`); a file of another letter case is no settings file
  on any disk, so `ZEKNO.APP.JSON` beside `compose.yaml` is not "both". The reader holds a file a
  link names to the same (contracts/settings-file.md, "As built").
- **The settings commands follow this rule (S1).** `zekno settings`, `--json`, `compose`, `set`
  and `unset` decide their file with `chooseSource` too (contracts/commands.md, "As built").
- **The app's `d` from the settings screen (needs validation, settled).** The `deploy` effect may
  carry `shown`, the SHA-256 of the settings file the settings screen showed. `readSource` now
  gives a settings file's SHA-256 with its services (`DeployText.settings.sha256`). When `shown`
  is given and the file read is not a settings file with those bytes, nothing is signed or sent:
  the app says DP6 on the status line and the screen reads the file again. `d` from the app's own
  screen carries nothing, as before.

| Id | Sentence | Status |
|----|----------|--------|
| DP6 | `The settings changed since this screen showed them, so nothing was deployed.` (the app, an error notice) | |

Test: `test/app/app-effects.test.ts`, "d on the settings screen deploys only the file it showed".

## As built: after the second pass of the review and the walkthrough (2026-11-16)

Written by the implementer. Where these notes and the sections above differ, these are built.

- **The first-use question names the file (S6).** In single commands (`useQuestion`,
  `project/project.ts`, which `zekno deploy`, `zekno link` and every command taking names from a
  `zekno.json` ask), a `zekno.json` in this folder that names another file than `compose.yaml`
  is asked about with that file: `Ada linked this folder to demo on dev, with
  deploy/zekno.app.json. Use it here?`; with `compose.yaml` the words are as before. One in a
  folder above already named its file. **Known limit:** the same question in the full-screen app
  (`useLinkWords`, `app/state/questions.ts`) names no file in this folder: the app's existing
  screens stay as they are in this feature.
- **Both files with no terminal, no link and no flags (walkthrough, difference 2).** The order of
  checks is today's for a deploy with no terminal: the server first, then the app, then the file.
  So with neither flag the missing-server sentence comes first
  (``Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.``,
  status 2, with the help line); with `--server` alone, the missing-app sentence; with `--app` and
  `--server`, DP2, status 2. Rule 4 above is reached only once the deploy knows where it goes.
- **What a settings deploy asks for (S9).** The values a deploy from settings asks for at a
  terminal, and the app lists before `d`, come from `expectedValues` of its Compose text, which no
  longer gives none for a value full of asterisks (contracts/compose-text.md, "As built").

## As built: after the review of the screens (2026-11-17)

Written by the implementer of the review of the screens no board showed (branch
`011-settings-polish`). Where these notes and the sections above differ, these are built.

- **The app's first-use question names the file (S6, closed for the app).** The known limit of the
  note above is closed in commit `cba1392`. The full-screen app asks its first-use question in one
  place: over Home, as it opens in a folder whose team-signed `zekno.json` is not yet used on this
  machine (`loadStart`, `app/effects/profile.ts`; the question `use-link`). `d` never asks it: in
  such a folder `d` says "This folder's zekno.json is not in use. Open zekno here again to be
  asked." as before. The question now names the file a yes deploys when the `zekno.json` is in
  this folder and names another file than `compose.yaml`, with the words of the single commands:
  the panel's title reads `Ada linked this folder to demo on dev, with deploy/zekno.app.json`, the
  single command's first sentence without its full stop, and the line under it is unchanged (`The
  link is signed by your team. It has not been used in this folder on this machine. Use it
  here?`). Both decide with one rule, `namedFile` in `project/project.ts`: the file is named when
  the `zekno.json`'s `compose` is not exactly `compose.yaml`, cleaned as every name shown is. With
  `compose.yaml` the words are exactly as before, and a `zekno.json` in a folder above is named
  with its folder and file as before. Only the words changed: the answers, their keys, what `y`
  records and what `d` deploys are unchanged.

  At 80 by 24, the program as the walkthrough drove it (a link naming `deploy/zekno.app.json`, the
  app opened on a second machine of the member; capture `FirstUse-80x24-deploy-1-question`):

  ```text
   ╭─ Ada linked this folder to demo on prod, with deploy/zekno.app.json ─────╮
   │ The link is signed by your team. It has not been used in this folder on  │
   │ this machine. Use it here?                                               │
  ```

  Tests: `test/project/project-flow.test.tsx`, "use this zekno.json here?, the file in this folder
  naming another file than compose.yaml" (the question and its panel at 100 by 30 and 80 by 24)
  and "the app opened on a second machine of the member in a folder whose zekno.json names
  deploy/zekno.app.json" (`loadStart` on the review's folders C and B: the file named, then the
  words unchanged for `compose.yaml`). `apps/cli/tests/link.e2e.ts`, which reads this question for
  a `compose.yaml` link, is unchanged and its words are the same.
