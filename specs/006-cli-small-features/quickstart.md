# Quickstart: checking the small CLI features

How to see each feature work, and where the results of each check are recorded. The contracts say
what is expected; this page says how to look. Nothing here contacts a real server: servers are the
stand-ins of `apps/cli/test/stand-in-server.ts`.

## Prerequisites

- Bun 1.4.4, from the repository root: `bun install --frozen-lockfile`.
- macOS or Linux, `/bin/sh` (and `/bin/dash` where installed, for the script tests).
- For the walkthrough: Python 3 for the pseudo-terminal driver (as in specs/004-cli-app/quickstart.md),
  kept in the scratchpad, not in the repository.

## 1. Automated checks

```bash
cd apps/cli
bun test test/version/version.test.ts test/compiled.test.ts            # the version (Phase 1)
bun test test/version/newest.test.ts                                     # the newer-release check (Phase 1)
bun test test/ui/questions.test.tsx                                 # the four kinds of question (Phase 2)
bun test test/asking/first-deploy.test.ts                               # User Story 1
bun test test/asking/asking.test.ts                                     # User Story 2
bun test test/secrets/import-file.test.ts test/secrets/import.test.ts           # User Story 3
bun test test/server/check-script.test.ts test/ops/doctor.test.ts           # User Story 4
bun test test/docs.test.ts                                       # commands, flags and docs in step
bun test                                                         # everything in apps/cli
```

From the root, at the end: `bun run typecheck`, `bun run lint`, `bun run test`, and in `apps/cli`
`bun run compile`.

Expected: every test passes; `bun test` in `apps/cli` passes after every phase.

## 2. The scenarios the tests prove

| Story | Scenario | Expected | Contract |
|-------|----------|----------|----------|
| US1 | Empty profile, a folder with a Compose file expecting one value; `zekno deploy` at a terminal; answers `ada`, `deploy@example.test`, `prod`, `demo`, `y`, a value | the app runs on the stand-in server; at most six answers; a second `zekno deploy` asks nothing | first-deploy.md |
| US1 | Leave at each question in turn, then run again | what was made stays, nothing half-made, the second run carries on | first-deploy.md, "When it stops" |
| US1 | The installer fails (no Docker, a checksum that does not match) | key kept, no server in the profile, the installer's sentence and F9 | first-deploy.md |
| US1 | No Compose file | today's sentence before any question | first-deploy.md |
| US1 | Piped | today's [NO-TEAM], [MS], [MA] and statuses | plan.md, "What each command asks" |
| US2 | Two servers, unlinked folder, each of the ten commands with no flags at a terminal | each asks exactly what it lacks, then runs | questions.md; plan.md |
| US2 | The same piped | none asks; today's sentence and status for each | plan.md |
| US2 | One server | used, `Using prod, your only server.` | questions.md, A1 |
| US2 | Esc at a list | `Nothing was done.`, status 1, nothing written or sent | questions.md, "Leaving" |
| US2 | `y` typed before a question | does not answer it | questions.md, "Keys typed before a question" |
| US3 | `.env` with new names, a replaced name, `PATH`, `my-var`, then a bad line | summary groups; nothing stored before the answer; a bad line stops all, names its number only | import.md |
| US3 | Twenty values, one command, one answer | twenty new versions; no value in any output or file but sealed (SC-003) | import.md |
| US4 | Everything in order | every check good, status 0 | doctor.md |
| US4 | Each broken setup below | the right line wrong, with its next step; status 1 | doctor.md |
| US4 | Any state | every file of the profile folder, the project folder and the stand-in server unchanged (SC-005) | doctor.md |
| Version | `zekno --version`, `zekno version`, `--json`, compiled and from source | mock-up 6; the same everywhere (SC-008) | version.md |
| Newer release | `zekno version` with a stand-in fetch answering a newer, the same, an older release, a pre-release, a hostile body, a huge body, a redirect to http, a hang, an error | `✔ This is the newest release.`, `! A newer release exists: <v>. Update zekno to get it.` or the dim `Could not check for a newer release.`; status 0 every time; nothing but the version taken from the answer | version.md |
| Newer release | `zekno --version`, and every other command but `doctor` | `deps.fetch` never called | version.md |
| Newer release | `zekno doctor` with a newer release | `! zekno` with the sentence under it; a warning, not a failure | doctor.md |

### SC-004: ways a setup can be broken, and the line `zekno doctor` marks

| # | Broken | Line | Result | Next step |
|---|--------|------|--------|-----------|
| 1 | no profile at all | Key | ✖ | D4 |
| 2 | the keychain entry removed | Key | ✖ | D8 |
| 3 | a team list in profile.json changed | Profile | ✖ | D13 |
| 4 | a `zekno.json` not signed by the team | This folder | ✖ | D19 |
| 5 | a linked folder whose `compose.yaml` was deleted | This folder | ✖ | D25 |
| 6 | a server that is down (`ssh` stand-in `down()`) | Reachable | ✖ | D29 |
| 7 | a server where SSH would ask (`ask()`) | Reachable | ✖ | `Open zekno and press enter on <server>` |
| 8 | a server without Docker Compose (`noCompose()`) | Docker | ✖ | D33 |
| 9 | an older runner (`reportingRunner` with an older version) | Runner | ! | `Run zekno server update <server>` |
| 10 | the runner removed from its path | Runner | ✖ | D40 |
| 11 | a nearly full disk (`df(100000)`) | Disk | ✖ | D48 |
| 12 | a newer runner speaking a newer protocol | Runner | ✖ | D38 |

## 3. The pseudo-terminal walkthrough (SC-007)

Each mock-up of design.md against the real program, at 100 by 30 and at 80 by 24, with a Python
driver that reads the terminal the whole time. The driver runs a small script in the scratchpad
that calls `run(argv, deps)` from `apps/cli/src/cli.ts` with `inkUi()` and `memoryKeyStore()`, as
feature 004's walkthroughs did, so the real keychain is never touched; `deps.fetch` is a stand-in,
so no request leaves the machine; `ssh` is the stand-in of
`sshStandIn`, first on `PATH`, in front of a stand-in server whose release is the real runner with
the stand-in Docker.

| Mock-up | Steps | What to compare |
|---------|-------|-----------------|
| 1 | two servers (`prod` over the stand-in `ssh`, `staging` on this machine), `zekno status` in an unlinked folder; ↓, ↑, Enter; again with Esc; again with one server | every line and column of mock-up 1; `✔ Server  prod`; `Nothing was done.` and status 1; `Using prod, your only server.` |
| 2 | `zekno deploy` with apps `demo` and `api` on `prod`; choose `+ a new app` | the rows, `+ a new app` last, `? Name for the new app › <folder>`, `✔ App  demo` |
| 3 | empty profile; `zekno deploy`; answer each question | every line of mock-up 3, in order; the result line; then a second run asks nothing |
| 4 | `zekno secret import .env` with mock-up 4's names; `y`; then once more with a bad line | every line of mock-up 4; the bad line's number and nothing of its content |
| 5 | `prod` with an older runner, `staging` where SSH would ask; `zekno doctor` | every line and column of mock-up 5, the `–` lines included; status 1 |
| 6 | `zekno --version`; `zekno version` three times, the driver's stand-in fetch answering a newer release, the newest, and nothing; `zekno doctor` with a newer release | the two lines; each of the three third lines, `✔` green, `!` yellow, the last dim; doctor's `! zekno` line with the sentence at column 17 |
| Type-ahead | write `y` and Enter to the terminal while the in-memory key store's read is slowed, before each question | no question is answered by them |

Record for each: passed, or what differed, with the screen as the driver read it.

Not part of the walkthrough: a real request to GitHub. The tasks never use the network. The
maintainer may run `bun apps/cli/src/main.ts version` once, with the network, to see the real
answer; it changes nothing.

## Results

Added by the tasks as they complete.

### Phase results

(not yet run)

### The pseudo-terminal walkthrough

Run on 2026-11-15, branch `006-cli-small-features` at 8dfa178, macOS, Bun 1.4.4, Python 3.14 (T047).

**How.** A driver in the scratchpad (`drive.ts`, not in the repository) calls `run` from
`apps/cli/src/cli.ts` with `inkUi()` on its own stdin and stdout (the plain interface where
`wantsPlain` picks it, as main.ts does), with `machine()`'s `memoryKeyStore()` and temporary profile
folder, the stand-in servers and `sshStandIn` of `apps/cli/test/stand-in-server.ts` behind a routing
stand-in `ssh` (first on `PATH`, and every `ssh` the CLI starts is sent to it), releases made of the
real runner with the stand-in Docker, and a stand-in `deps.fetch`. A Python driver runs it in a
pseudo-terminal (`pty.fork`, `TERM=xterm-256color`, `COLORTERM=truecolor`, no `CI`), reads it the
whole time in a `select` loop, types one key at a time 70 ms apart, and applies every byte to a
screen model of cells (character, colour, bold, dim, inverse). The driver writes a `$ zekno ...`
line before each command, as a shell would. The real keychain, a real host and the network were
never used.

Values from the set-up are not differences: the codes, `1 MB` (the stand-in release is a small
script), durations, deploy numbers, temporary paths, `team list v3` in mock-up 5 (two servers added
make version 3). Strong text on the boards (`#ffffff`, weight 600) is drawn bold in the terminal's
own text colour (`ui/theme.ts`), counted as matching. Colours seen: `?` and `❯`
`38;2;35;131;226` (`#2383e2`), `✔` green, `!` yellow, `✖` red, hints and second lines dim.

| Mock-up | What was run | 100 by 30 | 80 by 24 |
|---------|--------------|-----------|----------|
| 1 | two servers (`prod` over the stand-in `ssh`, `staging` on this machine), `zekno status`: ↓, ↓, ↑, Enter; again with Esc; again with Ctrl-C; one server; piped | matched every line, column and colour, `✔ Server  prod`, `✖ Nothing was done.` and status 1, `  Using prod, your only server.` dim; piped: `MISSING_SERVER` and status 2. Difference 1 | as 100 by 30 |
| 2 | two servers, apps `demo` (deploy 4) and `api` (deploy 12) running on `prod`, a folder `my-folder`; `zekno deploy`: Enter (`prod`), ↓ ↓ Enter, `My App`, `demo`, Esc; again choosing `demo` | matched the rows, `+ a new app` last and dim, the hint line, `? Name for the new app › my-folder`, A11 and A12 yellow at column 2 with no `!`, `✔ App  demo`. Differences 2 and 3 | as 100 by 30; A12 goes on under itself at column 2. Difference 6 (F5) |
| 3 | empty profile, a folder `demo` expecting `DATABASE_URL`; `zekno deploy`, each answer typed; then `zekno deploy` again | matched every line of mock-up 3 and the contract (F4 included), in order, with the empty lines where they are, every look of the board; status 0; the second run asked nothing and deployed (Deploy 2) | the same lines; Difference 6 (F1, F5) |
| 4 | a folder linked to `demo` on `prod`, `API_URL` set, mock-up 4's `.env`; `zekno secret import .env`, `y`; then a `.env` whose line 7 is bad | matched every line and look, columns 2 and 14; `✖ .env, line 7: this is not a NAME=value line.` / `  Nothing was stored.`; no value and nothing of line 7 in the bytes written. Note 5 | as 100 by 30 |
| 5 | `prod` with `reportingRunner(docker, "0.1.0-dev.1", 2)`, `composeVersion("5.6.0")`, `df(129882813)`, `staging` where SSH would ask; `zekno doctor` | matched every line, column and colour, the `–` lines included (known point c); status 1 | as 100 by 30 |
| 6 | `zekno --version`; `zekno version` with a stand-in fetch answering 0.2.0, 0.1.0, failing; both with `--json`; `zekno doctor` with 0.2.0 on one good server | matched: the two lines at column 0, `✔` green, `!` yellow with its first sentence bold, the dim `  Could not check for a newer release.`, status 0 each; `--version` made no request; doctor's `! zekno` with the sentence dim at column 17, status 0. Difference 4 | as 100 by 30 |

Differences (board or contract, then what the program draws):

1. Leaving a list (board "Questions in single commands", "Leaving with esc"): the board keeps
   `? Which server?` above `✖ Nothing was done.`; the program erases the question and draws only
   `✖ Nothing was done.` (also after Ctrl-C, and when leaving a typed question). Look.
2. Choosing `+ a new app` (mock-up 2 and its board go from the list to the typed question): the
   program draws `✔ App  + a new app`, then `? Name for the new app › my-folder`; after Esc there
   it stays above `✖ Nothing was done.`. It follows questions.md's rule for any choice. Words.
3. A refused typed answer (board "Questions in single commands"): the board draws
   `? Name for the new app › My App` with no cursor; the program keeps the inverse cursor after
   `My App` while the reason is shown (the question is still open, as questions.md says). Look.
4. `runner 0.1.0, the runner release this zekno installs` (board "The version"): the board draws
   the comma dim with the rest; the program draws `runner 0.1.0, ` in the text colour and dims from
   `the`. Look.
5. Note, not a defect by the contract: mock-up 4 and its board show
   `? Store 4 values? Values are never shown. (y/N)` with nothing after it; the program leaves
   `... (y/N) yes`, as questions.md (research Q1) says.
6. At 80 columns, a line exactly as wide as the room for it wraps with the space at the start of
   the next line, one column right of the paragraph's text (no board shows a wrapped line):
   F1 `  Nothing is set up on this machine yet. Three things first: your key, a server,` then
   `   this app.` (column 3); F5 `? Remember this folder? ... deploys demo to prod.` then ` (y/N)`
   and ` (y/N) yes` (column 1); A6 `   end.` (column 3); feature 004's status line ` to date)`
   (column 1). A10 goes on at column 0 under `!` at 100 columns, and at column 1 at 80. Look.

Known points, as drawn: (a) F8 is `✖ Nothing more was done.` (bold), then
`  What was set up so far is kept: run zekno deploy again to carry on.` (dim, backticks dropped),
where the board draws one line in the text colour; F9 is drawn the same way after the installer's
sentence. (b) `! A value cannot be empty. Press esc to skip it.` (`!` yellow, words in the text
colour); a refused typed answer is `  Use lowercase letters, ...` in yellow at column 2, no `!`.
(c) `–  Docker        not checked`: the label at column 3, `not checked` at column 17.

Type-ahead (in-memory key store slowed to 3 s, keys written while it read, before the question was
drawn), at both sizes: `y` Enter before `Which server?` (`zekno status`), before
`Store 4 values?` (`zekno secret import`), before `Name for this app › tafolder` (`zekno deploy`,
one server, no apps); `abc` Enter before the hidden prompts of `zekno secret set GREETING` and of
`zekno deploy` (`Value for DATABASE_URL`). None answered: each question was still open, unchanged;
keys typed after it was drawn answered it; the deploys then carried `typed-after`, the value typed
after the prompt, not `abc`. Raw mode was off and the cursor shown after every run. Seen: in line
mode before raw mode goes on, the terminal echoes what is typed; one line typed ahead leaves an
empty line above the question, two lines leave the first (`abc`) on the screen above it.

Every sentence marked "needs approval" in questions.md, first-deploy.md, import.md and doctor.md
was reached and saved as drawn, with the research Q1, Q3 and Q5 lines and the plain output of
`zekno doctor` and `zekno secret import`, in the scratchpad's `walkthrough-006/sentences.txt`.

Also seen: every command at a terminal ends with one empty line under its last line (two after a
deploy), Ink's last frame. Not checked: a light terminal; resizing the window while a question is
open; D51's form on the `Reachable` line (it was reached on the `Runner` line); feature 004's lines
that come after a choice (the status lines) beyond reading them.

#### After the fixes

Run again on 2026-11-15 at `9750eaf` with the same drivers, unchanged, at 100 by 30 and 80 by 24:
mock-ups 1 (Enter, Esc, Ctrl-C, one server), 2 (`+ a new app`, `demo`), 3 (the whole flow, leaving,
refused answers, the hidden values), 4, 5 and 6, doctor with a newer release, doctor's states on
this machine, and F1's rule. The captures are in the scratchpad's
`walkthrough-006/captures-after-fixes/`, beside the first ones. Every run ended with the cursor
shown and raw mode off; the terminal wrapped no row itself (`wrapped_rows` 0 in every run).

| Difference | Now | Capture |
|------------|-----|---------|
| 1. Leaving a list | fixed: `? Which server?` (`?` blue, the question bold) stays above `✖ Nothing was done.`, after Esc and after Ctrl-C. A typed question left keeps its line with what was typed and no cursor: `? Where is the server? ›` above F8 and above `Nothing was done.`, `? Name for this app › demo`, `? Your name ›` | `m1-esc-*-final`, `m1-ctrlc-*-final`, `m3-leave-*`, `m3-refuse-*-4-final`, `s-f1-*-final` |
| 2. Choosing `+ a new app` | fixed: no `✔ App  + a new app`; `✔ Server  prod`, then `? Name for the new app › my-folder` straight after the list; after A12 and Esc, `? Name for the new app › demo` above `✖ Nothing was done.` | `m2-new-*-3-name`, `m2-new-*-6-final` |
| 3. The cursor on a refused typed answer | left as decided | `m3-refuse-*-1-A6` |
| 4. The version's comma | fixed: `runner 0.1.0` in the text colour, `, the runner release this zekno installs` dim from the comma; the words unchanged | `m6-*-final.styled.txt` |
| 5. `(y/N) yes` after an answered question | left as decided | `m4-*-2-final` |
| 6. Wrapped lines at 80 columns | fixed: F1 goes on as `  this app.` (column 2); F5 as `  (y/N)` and `  (y/N) yes` (column 2, under the question's words); A6 as `  end.` (column 2); the status line as `to date)` (column 0); A10 under its words from column 2, at 100 columns too; A12 as `  name.` (column 2). A word wider than a line, such as a long path in a doctor next step, is broken where Ink broke it | `m3-80x24-*`, `m3-refuse-80x24-1-A6`, `m1-enter-80x24-5-final`, `m3-value-*-3-A10`, `m2-new-80x24-5-A12` |
| Doctor's next steps | fixed: drawn without the backticks around a command, as error lines draw it (`Point to one with -f <file>.`); plain output keeps them | `s-doctor-machine-*-final` |

Also changed on these screens: mock-up 4's left-out group is now `PATH (zekno keeps this name),
line 7 (not a valid name)` (security review S1; the `.env` has `my-var` on line 7). Between the two
hidden prompts of `m3-value` (a value skipped with Esc, then the next one typed), raw mode stayed on
(the echo fix of the security review's "Needs validation").

Left as they are, as decided: known point (a), F8 and F9 in the common error style; (b), a refused
hidden value as `! <reason>` (A10 keeps its backticks at a terminal); (c), the label column of
doctor's "not checked" lines.

A follow-up (after `b260fe6`) made every question that can be left keep its line. Run again at
both sizes: F5 left with Esc keeps `? Remember this folder? It writes zekno.json, so it always
deploys demo to prod. (y/N)` (at 80 columns `  (y/N)` on the next line) above `✖ Nothing was
done.` (`m2-demo-*-2-final`); the hidden prompt left with Ctrl-C, after `abc` was typed, keeps `?
Value for DATABASE_URL (demo on prod): (hidden)   esc skips it`, and `abc` is in none of the bytes
written (`m3-value-ctrlc-*-final`). The import's question is asked without `leave`: Esc answers
no, and `? Store 4 values? Values are never shown. (y/N) no` stays above `✖ Nothing was done.`, as
before (`m4-esc-*-2-final`, from a scene added beside the drivers in the scratchpad's
`walkthrough-extra/`, which uses the walkthrough's harness and driver unchanged). `m3-value` and
`m3-leave` were run again and draw as above.

### The agent end-to-end tests

(not yet run)

### Checks at the end

(not yet run)
