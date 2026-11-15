# Questions Contract

How single commands ask at a terminal (User Stories 1 and 2). The approved mock-ups in
[design.md](../design.md) are binding for wording, symbols and order; this page writes down what
they leave open. What each command asks, in which order, and what it does with no terminal is in
[plan.md](../plan.md), "What each command asks". The first deploy is in
[first-deploy.md](./first-deploy.md).

"At a terminal" means `wantsPlain` is false (`ui/plain.ts`): standard input and output are
terminals, no `--json`, `TERM` is not `dumb`. Nothing on this page is ever drawn otherwise
(research R1).

Columns are counted from 0. A space is one column. `?`, `❯`, `✔`, `!`, `✖`, `–`, `↑` and `↓` are
each drawn as one character. Colours follow feature 004's single commands: `?` and `❯` in the brand
colour (`BRAND`, `ui/theme.ts`), `✔` green, `!` yellow, `✖` red, hints and second lines dim.

## A list

```text
? Which server?
  ❯ prod       deploy@203.0.113.7
    staging    this machine
  ↑↓ move   enter choose   esc leave
```

- Line 1: `?`, a space, the question, in the text colour.
- One line per row: two spaces; the marker column, two wide (`❯` and a space on the selected row,
  two spaces on the others); the label, padded with spaces to `max(11, longest label + 2)`; the
  detail, dim. The selected row's label is bold. A row with no detail ends after its label.
- The last line: two spaces, then `↑↓ move`, `enter choose`, `esc leave`, three spaces between
  them; each key in the text colour and its meaning dim.
- Keys: ↑ and ↓ move one row and stop at the first and last (`applySelectKey`, `ui/select.tsx`);
  Enter chooses; Esc and Ctrl-C leave; anything else does nothing. The first row is selected when
  the list opens.
- After a choice the question, its rows and the hint line are replaced by one line:
  `✔ <collapsed>  <label>` (two spaces between), for example `✔ Server  prod`, `✔ App  demo`.
- **More rows than fit.** The list may use the window's height less two lines. When the rows do not
  fit, a window of rows around the selected one is drawn, with `  ↑ <n> more` above it when rows are
  hidden above and `  ↓ <n> more` below it when rows are hidden below, dim (A13), counted in the
  height used. At least three rows are always drawn. Each row is cut at the window's width, so it
  stays one line.

## A typed answer

```text
? Your name › ada▌
```

- `?`, a space, the question, a space, `›` dim, a space, the answer so far, and the cursor (a space
  drawn inverse). A value filled in (`fill`) is the answer so far when the question opens, and can
  be changed with Backspace.
- Input follows `applyTextInput` (`ui/text-input.ts`): one line, at most 256 characters, control
  characters dropped, a paste ending in one line break is a paste and Enter, a paste of several
  lines changes nothing.
- Enter: the answer is checked. When it is wrong, the line under the question is `! <reason>` (the
  `!` yellow) and the question stays open with the answer as typed; the reason goes once Enter is
  pressed again. Esc and Ctrl-C leave.
- After a good answer the line stays as `? Your name › ada`, without the cursor (research Q1).

## A yes-or-no question

`Ui.confirm` as today: `? <question> (y/N)`, `(y/N)` dim. `y` is yes; `n` and Enter are no. Without
`{ leave: true }` Esc and Ctrl-C are no, as today; with it, they leave. After the answer, the line
`? <question> (y/N) yes` (or `no`) stays (research Q1; today it is `  <question> yes`).

## The hidden prompt that can be skipped (first deploy only)

```text
? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it
```

- `?`, a space, the question as `zekno secret set` words it (``Value for <NAME> (<app> on
  <server>): ``), `(hidden)` dim, three spaces, `esc skips it` dim. Nothing of the value is drawn,
  not even its length.
- Input follows `applySecretInput` (`ui/secret-input.ts`). Enter with a value: the value. Enter
  with nothing: `! <A9>` under the line and the prompt stays open. A paste of several lines:
  `! <A10>` and the prompt stays open, the value so far dropped. Esc: skipped. Ctrl-C: leave.
- After a value: `? Value for DATABASE_URL (demo on prod): (hidden)`. After Esc: the same line
  ending `skipped` instead of `(hidden)` (research Q1).

## Keys typed before a question

Before any of the four is drawn, and before the hidden prompt of `zekno secret set`, what was typed
and not read is thrown away (`discardTypedAhead` on the interface's input, raw mode first for a
hidden prompt). A key pressed after the question is drawn answers it (FR-007, feature 004 K12).

## Leaving

Esc or Ctrl-C at a list or a typed answer, Esc or Ctrl-C at a yes-or-no question asked with
`{ leave: true }`, and Ctrl-C at the skippable hidden prompt throw `Left`. `run` prints its sentence
through `ui.error` (at a terminal `✖ Nothing was done.`) and returns 1. Nothing more is done
(FR-005). In the first deploy, what leaving says once something was made in the run is research Q3.

## The lists each command offers

- **Which server?** Every server of the verified profile, in profile.json's order: label the name,
  detail the SSH destination or `this machine`. `collapsed`: `Server`. With exactly one server
  nothing is asked: the dim line `  Using <server>, your only server.` (A1) is drawn and the
  command goes on (FR-004). With none: commands other than `deploy` stop with A4.
- **Which app on `<server>`?** Read first, under the step `Asking <server>` (a spinner), from the
  server in SSH's batch mode, within 20 seconds (research R5): one row per app the runner holds
  with a deploy number of 1 or more, detail `deploy <n>, <state>` (`running`, `stopped`, `partly
  running`), or `deploy <n>` when the state is unknown. When the server could not be read: one row
  per app of this machine's verified history for that server, detail `deploy <n>`. Order: this
  machine's latest deploy first, then by name. `collapsed`: `App`.
  - `deploy` adds the row `+ a new app`, last, with no detail. Choosing it asks the typed question
    `Name for the new app` with the folder's name filled in; its check is A11 and A12.
  - With no rows at all: `deploy` asks the typed question `Name for this app` with the folder's
    name filled in (check A11); every other command stops with A5.
- **The folder's name** filled in: the last part of the current folder's real path, in lowercase,
  only when it then fits the app-name rule (`NAME`, `profile.ts`); otherwise nothing is filled in.

## A `zekno.json` that cannot be used

- Signed by the team and not used here yet: the first-use question, as today, before any other
  question and before any connection. "No" (`n`, Enter, Esc, Ctrl-C) ends with `Nothing was done.`
  and status 1, as today.
- Not signed by the team (research Q6): at a terminal it is never used; the command draws
  `! <notSignedHere(link, cwd)>` (A14) and asks for what is missing as if the file were not there.
  Given both `--app` and `--server` it is left aside without a word, as today.
- `zekno link` at a terminal, with such a file in this folder and no `--force`: it stops before
  asking anything, with A15.

## Sentences

"Mock-up" is approved wording; "existing" is a sentence the CLI already says; "needs approval" is
new (research Q4). `<server>`, `<app>`, `<NAME>` are names held to their patterns.

| Id | Where | Sentence | Status |
|----|-------|----------|--------|
| A1 | one server | `Using <server>, your only server.` (dim, two spaces in) | mock-up |
| A2 | leaving | `Nothing was done.` | mock-up, existing (`NOTHING_DONE`) |
| A3 | a command other than `deploy`, `init`, `doctor`, `version`, at a terminal, with no profile | ``No team on this machine yet. Run `zekno deploy` in a project folder, or `zekno init --name <you>`.`` | needs approval |
| A4 | a command that needs a server, other than `deploy`, at a terminal, with a profile and no server | ``No server is connected yet. Run `zekno deploy` in a project folder, or `zekno server add`.`` | needs approval |
| A5 | a command that needs an app, other than `deploy`, when the list would be empty | ``<server> has no apps yet, so there is nothing to choose from. Name one with `--app <name>`.`` | needs approval |
| A6 | reason, `Your name` | `A name is 1 to 64 characters, with no control character and no space at either end.` | needs approval |
| A7 | reason, `Where is the server?` | `That SSH destination is not valid. Use the form user@host.` | existing (`prepareServerAdd`) |
| A8 | reasons, `A name for it` | `Give the server a name of lowercase letters, digits and hyphens.`; `A server named "<name>" is already connected.` | existing (`prepareServerAdd`) |
| A9 | reason, hidden prompt, nothing typed | `A value cannot be empty. Press esc to skip it.` | needs approval |
| A10 | reason, hidden prompt, several lines pasted | ``That value has more than one line. Press esc to skip it, and set it later with `zekno secret set <NAME> --stdin`.`` | needs approval |
| A11 | reason, an app name | `Use lowercase letters, digits and hyphens, starting with a letter or a digit.` | needs approval |
| A12 | reason, `Name for the new app`, a name the list has | `<server> already has an app named <app>. Choose it from the list, or give another name.` | needs approval |
| A13 | a list taller than the window | `↑ <n> more`, `↓ <n> more` (dim, two spaces in) | needs approval |
| A14 | a `zekno.json` not signed by the team, at a terminal | `zekno.json here is not signed by your team, so zekno does not use it. It names <app> on <server>.` (or the file's path in place of `zekno.json here` when it is in a folder above) | existing (`notSignedHere`, the app's Home) |
| A15 | `zekno link` at a terminal, a file not signed by the team in this folder, no `--force` | ``There is already a zekno.json in <folder>. Run `zekno link --force` to replace it.`` | existing (`writeProject`) |

## The plain interface

`asks` is false. `choose` and `ask` throw `question.missing`; `askValue` throws
``There is no terminal to ask on. Pipe the value in and add `--stdin`.``; `confirm` throws its
refusal, as today; `note` writes its text on standard output; `code` writes `<label>: <value>` and
then the text of what it is for; `groups` writes `<label>\t<text>` per line; `gap` writes nothing;
`doctorReport` writes the plain lines of [doctor.md](./doctor.md). No command reaches the first
four in plain output (research R1).
