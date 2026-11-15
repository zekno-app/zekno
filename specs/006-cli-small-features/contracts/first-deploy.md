# First-Deploy Contract: `zekno deploy` at a terminal

User Story 1 (FR-010 to FR-014). `deployAtTerminal` in `apps/cli/src/asking/first-deploy.ts` runs every
`zekno deploy` at a terminal: from nothing, with something missing, and with nothing missing. With
no terminal `zekno deploy` is exactly as today (plan.md, "What each command asks"). Mock-up 3 in
[design.md](../design.md) is binding; the question looks are in [questions.md](./questions.md).

## What the person sees, from nothing

```text
$ zekno deploy
  Nothing is set up on this machine yet. Three things first: your key, a server, this app.

? Your name › ada
✔ Key created. It is in your system keychain.
  Team code    J4QF-AM29-F01W-PYWM-CS8P
  Identifies your team. A server checks it before it agrees to obey your team.

? Where is the server? › deploy@203.0.113.7
? A name for it › prod
✔ Connected over SSH
✔ Docker with Compose found
✔ Runner installed  52 MB, checksum verified
✔ Added prod to the signed team list
  Server code  MM4G-GPD7-M9VM-ACGJ-Y48R
  Identifies this server's key. Teammates compare it before they trust the server.
  You reached this server over SSH, so its identity rests on SSH's host verification.

? Name for this app › demo
? Remember this folder? It writes zekno.json, so it always deploys demo to prod. (y/N)

! compose.yaml expects 1 value that has no secret yet.
? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it

  (the deploy panel and stages, as today)
✔ demo is live on prod in 6.1s
```

Each block is drawn only when its step runs; an empty line (`Ui.gap`) comes before each block
after the first, except the deploy, whose panel has an empty line above it of its own. How each
line is drawn (the board "zekno deploy from nothing" decides the look, 2026-11-15: where this
table said `info` for the opening line and the SSH line, the board draws them dim, so they are
`note`; it draws the runner's size dim, two spaces after `Runner installed`):

| Line | `Ui` call | Words |
|------|-----------|-------|
| Opening | `note` (dim, set in by two columns) | F1 |
| `? Your name ›` | `ask`, `fill` none, check A6 | mock-up |
| `✔ Key created. It is in your system keychain.` | `success` | mock-up |
| Team code and what it is for | `code("Team code", <code>, F2)` | mock-up |
| `? Where is the server? ›` | `ask`, check A7 | mock-up |
| `? A name for it ›` | `ask`, checks A8; not asked when `--server` was given | mock-up |
| `✔ Connected over SSH` | `success`, on the installer's `connected` | mock-up (the app's step word) |
| `✔ Docker with Compose found` | `success`, on `docker` | mock-up |
| `✔ Runner installed  <size>, checksum verified` | `success("Runner installed", "<size>, checksum verified")`, on `install`: the detail dim, two spaces after the words (the board; design.md writes three spaces); `<size>` is `megabytes(bytes)` of the `download` line, the words of `megabytes` in `app/effects.ts` | mock-up |
| `✔ Runner found  <detail>` | `success("Runner found", <detail>)`, on `runner` (a runner already there), drawn as the line above; `<detail>` is the words of `foundDetail(version, carried)` in `app/effects.ts` | needs approval (the app's words) |
| `✔ Added <server> to the signed team list` | `success`, on the stage `added` | mock-up |
| Server code and what it is for | `code("Server code", <code>, F3)` | mock-up |
| SSH line | `note`, F4 (dim, as the board draws it) | research Q5 |
| A runner of another version | `warn`, `runnerWarning(...)` (W1 to W5 of feature 005), as `server add` says it | existing |
| `? Name for this app ›` | `ask`, `fill` the folder's name, check A11 | mock-up |
| `? Remember this folder? ...` | `confirm(F5, …, { leave: true })` | mock-up |
| `! <file> expects <n> value(s) that have no secret yet.` | `warn`, F6 | mock-up |
| `? Value for <NAME> (<app> on <server>):` | `askValue`, one per name | mock-up |
| The deploy | `send` (`commands/deploy.ts`): `ui.deploy(start)`, the panel and stages, then the result line | as today |

`code(label, value, about)` draws two lines at a terminal: two spaces, the label dim and padded to
11 columns, two spaces, the value bold; then two spaces and `about` dim. So `  Team code    J4QF…`
and `  Server code  MM4G…` put the codes in the same column (15).

While the server is added, the work runs in `ui.step("Connecting <server>", …, { quiet: true })`,
as `zekno server add` does, so SSH can ask for a password or a host key on the terminal (spec,
edge cases). The `✔` lines are drawn as the installer's lines arrive.

## The steps, each complete before the next question

1. **Before anything is asked** (FR-014). With no profile, a `zekno.json` that applies here cannot
   be used (there is no team to have signed it): F7 is drawn as a warning if one is found (given
   both `--app` and `--server`, it is left aside without a word, as `withProject` does). With a
   profile, `withProject(cwd, flags, ["app", "server", "file"], …)` runs as for every command,
   with `leaveAside` (questions.md): the first-use question comes first when it applies. Then the
   Compose file is read once with `readCompose` (`-f`, else the used zekno.json's file, else
   `compose.yaml` here) and must not be empty. Its failures are today's sentences (`No Compose file
   at <path>. Point to one with \`-f <file>\`.` and the rest), exit 1, before any question. The text
   read is the text that is deployed and whose expected values are listed.
2. **The opening line**, only when the key or a server is missing (F1).
3. **Key**, when profile.json does not exist: `ask` the name, then `createTeam(deps, name)`. Then
   the verified team is opened once (`openTeam`) and every later operation gets
   `{ ...deps, team: async () => team }` (research R7). With a profile, the team is taken once from
   `teamOnce` instead.
4. **Server**, when the profile has no server:
   `ask` the destination, `ask` the name unless `--server` gave it, then `prepareServerAdd(deps',
   name, { ssh })` and `addServer` with the callbacks above. `addServer` writes the next team list
   and the server into the profile, so the team is then read again from the profile folder and
   proved again (`reopenTeam` in `context.ts`, the checks of `openTeam`) against the team code read
   with the key; the keychain is not read a second time. A `--server` that is not a server name
   stops before anything is asked, with A8's first sentence and status 2. When the profile has servers: the
   server is `--server`, else the zekno.json's, else the one server (A1), else `choose` (Which
   server?). `--server` naming no connected server stops with today's sentence.
5. **App**: `--app`, else the zekno.json's, else `choose` (Which app on `<server>`?, with
   `+ a new app`), else, when the list would be empty, `ask` (`Name for this app`).
6. **Folder**: `confirm(F5, …, { leave: true })` only when the server or the app was asked or made
   in this run, no `zekno.json` was found for this folder (none here or above), and `-f` was not
   given. `y`: `linkFolder(deps', { app, server }, confirm)`, the same checks and signature as
   `zekno link --app <app> --server <server>`; nothing more is drawn for it. `n` or Enter: nothing
   is written.
7. **Values** (research Q2): the names `expectedValues(text)` gives, less those the app has a
   current secret for (`listSecrets`). When any: F6, then for each name in that order `askValue`;
   a value is stored at once with `prepareSecretSet` and `setSecret` (one write each); Esc skips
   the name. Nothing is said for a skipped one beyond its line.
8. **Deploy**: `prepareDeploy(deps', { app, server, read })` with the text of step 1, then `send`
   with `flags` the `--app` and `--server` that were typed. The exit status is `send`'s: 0, or 1
   when the app did not start.

## A second run

| Before | What the second `zekno deploy` asks |
|--------|-------------------------------------|
| Everything done, folder remembered, every value set | nothing; it deploys |
| Folder remembered, a value skipped | that value, then it deploys |
| Folder not remembered, one server | `Using prod, your only server.`, then Which app on prod? (with `demo` and `+ a new app`), then Remember this folder?, then the values |
| Left at "Name for this app" after the server was added | `Using prod, your only server.`, then `Name for this app` (the server has no apps) and on |
| Left at "A name for it", or the installer failed | the opening line F1 without "Nothing is set up…" ("Two things first: a server, this app."), then the server again |
| Left at "Your name" | the whole flow, as the first time |

## When it stops in the middle

| Where | What is left | What is said |
|-------|--------------|--------------|
| Esc or Ctrl-C at any question, nothing made yet in this run | nothing new | `Nothing was done.`, status 1 |
| Esc or Ctrl-C after the key or a server was made in this run | what was made, whole | F8 (research Q3), status 1 |
| The keychain refuses the key | no profile, no keychain entry (`createTeam` writes the profile only after the keychain took the key) | `The system keychain is not available, so no signing key was created.`, status 1 |
| SSH cannot connect, or SSH asks and is not answered | the key; no server in the profile; nothing on the server | today's sentence (`<destination> could not be reached over SSH. Check that \`ssh <destination>\` works from this machine.`), then F9, status 1 |
| The installer stops (no Docker, no checksum tool, a failed download, a checksum that does not match, ...) | the key; no server in the profile; on the server, what the installer leaves on a failure (nothing installed, its temporary folder removed) | the installer's sentence (`installFailure`), then F9, status 1 |
| The runner refuses setup (another team's) | the key; no server | today's sentence, then F9, status 1 |
| Setup done, the runner does not take the new team list (`sync`) | as `zekno server add` leaves it today: the server in the profile; the next deploy carries the team lists | today's sentence, then F9, status 1 |
| Writing zekno.json fails | key and server | `linkFolder`'s sentence, then F9, status 1 |
| Storing a value fails | key, server, the values stored before it | `setSecret`'s sentence, then F9, status 1 |
| The deploy is refused or fails | key, server, the values; the deploy number used is recorded as today | as any `zekno deploy` |

F9 is added only when something was made in this run; otherwise the sentence is said alone.
"Made in this run" is any of the key, a server (also one the profile names after a failed
`sync`), zekno.json, or a value stored: after any of them "Nothing was done." would not be true,
so leaving says F8.

## Sentences

| Id | Sentence | Status |
|----|----------|--------|
| F1 | No profile: `Nothing is set up on this machine yet. ` followed by the count. The count: `<One\|Two\|Three> thing(s) first: <list>.` where the list joins, in this order and with `, `, `your key` (no profile), `a server` (no server for this deploy), `this app` (no `--app` and no zekno.json app). Drawn only when `your key` or `a server` is in the list. Examples: `Nothing is set up on this machine yet. Three things first: your key, a server, this app.`; `Two things first: a server, this app.`; `One thing first: a server.` | mock-up (the first two); the rule needs approval |
| F2 | `Identifies your team. A server checks it before it agrees to obey your team.` | mock-up (the app's words) |
| F3 | `Identifies this server's key. Teammates compare it before they trust the server.` | mock-up (the app's words) |
| F4 | `You reached this server over SSH, so its identity rests on SSH's host verification.` | existing (`server add`); research Q5 |
| F5 | `Remember this folder? It writes zekno.json, so it always deploys <app> to <server>.` | mock-up |
| F6 | `<file> expects 1 value that has no secret yet.` / `<file> expects <n> values that have no secret yet.` `<file>` as the deploy panel names it (`shownFile`) | mock-up (the first) |
| F7 | `zekno.json here is not signed by your team, so zekno does not use it. It names <app> on <server>.` (`notSignedHere`) | existing |
| F8 | ``Nothing more was done. What was set up so far is kept: run `zekno deploy` again to carry on.`` | research Q3 |
| F9 | ``What was set up so far is kept: run `zekno deploy` again to carry on.`` (after the failure's own sentence, in the same error) | research Q3 |

## Checks this flow makes, by step

- Key: the name against the team list's rule for a member's name (`MemberNameSchema`, exported
  from `profile.ts` as `isMemberName`), before `createTeam` (FR-006).
- Server: the destination against `SSH_DESTINATION` and the name against `NAME` and the connected
  servers, before anything is sent; then everything `prepareServerAdd` and `addServer` check
  (FR-012): the installer's checks, the checksum this zekno holds, the setup answer, the server code
  derived on this machine.
- App: `NAME`; for `+ a new app`, not a name the list already has.
- Folder: `linkFolder`'s checks (the server in the verified profile, the app name, the Compose file
  a file inside the folder).
- Values: `prepareSecretSet`'s (the name rule, not reserved), then `setSecret`'s (not empty, at most
  64 KiB, valid text).
