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

## The app's `d`

The app deploys the folder it was started in (`composeOf`, `app/effects/deploys.ts`), now by the
same rule: a linked folder, the file its link names (which may be `zekno.app.json`); a folder
that is not linked, the one of `compose.yaml` and `zekno.app.json` that exists. With both and no
link, it deploys nothing and says DP5 on the status line. With neither, today's sentence. A
settings file with a fault: its sentence as an error notice. "Remember this folder?" writes
`zekno.json` naming the file deployed. The deploy screen's `from` row shows the file's path, as
today.

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
