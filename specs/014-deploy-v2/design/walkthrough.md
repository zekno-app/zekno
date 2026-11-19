# Feature 014: the walkthrough (T075), captured from the real program

Drawn on 2026-11-19 by `driver.ts` (one scene per process) and `walk.ts` (each with `FORCE_COLOR=3`, `TZ=UTC`, `NO_COLOR` unset and a temporary folder of its own as `TMPDIR`, removed after it), both in this folder, run with `bun --no-env-file`. Every single-command scene is `run` of `apps/cli/src/cli/cli.ts` with `inkUi` on the stand-in terminal of `apps/cli/test/support/terminal.ts` (100 columns, interactive), and every app scene the app's store, effects and `AppView` as `apps/cli/test/screens/scene/app.ts` opens them (100 by 30; their `command` is `zekno`, as the docs' app recipes name it, then `d`). The server is the stand-in server `prod-1` at `deploy@203.0.113.7` of `test/screens/scene/server.ts`, reached over its stand-in `ssh`, running this repository's runner (or runner 0.1.0 extracted from git for `older-runner`) with the stand-in Docker; keys in `memoryKeyStore()`, profiles in temporary folders. No real server, network, keychain or `~/.zekno`.

Conventions, as the docs' recipes: the first row is the typed command, dim (`promptRow`; the boards draw only `$ ` dim); trailing empty rows are left out; leading empty rows are kept, because the program draws them (the deploy block's top padding). Rows are `rowsOf` and `tidy` of `apps/cli/test/screens/format.ts`; the looks are in `built.json`.

Rules that fix what differs on each run: `in 4.2s` for how long a deploy took at a terminal (DEPLOY_TIME of `scene/codes.ts`); in the app, the header's `4.2s` (the deploy's start moved to 4.2 s before its end) and the panel's `from` row (`~/code/shop/compose.yaml` for the temporary folder's path). Arrangements that are the tests' own: the runner's number set to 41 in `state.json` "as deploys from elsewhere would leave it" (`setNumber` of `test/support/deploys.ts`), a deploy request held or its answer cut by `test/support/wire.ts`, a second member from `test/support/team-of-two.ts`, a second machine from `twin`, a second terminal from `secondTerminal`, a runner answering as another version from `reportingRunner`, and runner 0.1.0's state from `olderState`.

No row of any capture holds a path, user name or host name of this machine (checked: no `/Users/`, `/private`, `/var/folders`, the user's or the host's name, or a temporary folder's prefix in `built.json`).

## The scenes

### `good`

- How: run(['deploy']) of apps/cli/src/cli/cli.ts with inkUi on test/support/terminal.ts at 100 columns, in shop's linked folder with DATABASE_URL and SESSION_KEY set, against this repository's runner (protocol 3) on the stand-in server prod-1 over the stand-in ssh, after deploy 1 and the runner's number set to 41 as deploys from elsewhere would leave it.
- Compared with: Deploy2Versions, panel 1, below the warning (the success it draws)
- Fixed: in 4.2s (how long the deploy took, read from the clock)

```text
$ zekno deploy

╭─ Deploy 42 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ secrets   2                                                  │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
  zekno logs to watch it, zekno rollback to undo
```

### `overtaken`

- How: run(['deploy']) with inkUi at 100 columns against this repository's runner on the stand-in prod-1 (runner at 41), its deploy request held by test/support/wire.ts until a second terminal of the same machine (secondTerminal, plain) had deployed 42, then let go: the runner refused it `replayed` and the CLI read the runner again.
- Compared with: Deploy2Overtaken, panel 1

```text
$ zekno deploy

╭─ Deploy 42 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ secrets   2                                                  │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting

✖ Another deploy of shop reached prod-1 first, as deploy 42.
  Nothing of this one ran. Run zekno deploy again to deploy on top of it.
```

### `cannot-tell`

- How: run(['deploy']) with inkUi at 100 columns against this repository's runner on the stand-in prod-1 (runner at 41), its deploy request held while a second terminal (secondTerminal, plain) deployed 42 with its answer cut off by test/support/wire.ts (the runner took it, the entry stayed `sent`), then let go.
- Compared with: Deploy2Overtaken, panel 2

```text
$ zekno deploy

╭─ Deploy 42 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ secrets   2                                                  │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting

✖ prod-1 holds deploy 42 of shop, and this machine signed a deploy 42 whose answer never came.
  zekno cannot tell which of the two ran. Run zekno deploy again to settle it.
```

### `removed-member`

- How: run(['deploy']) with inkUi at 100 columns against this repository's runner on the stand-in prod-1, after test/support/team-of-two.ts added Bea, Bea set DATABASE_URL (kept here and carried by deploy 1), Ada set SESSION_KEY, and Ada took Bea out of the team list without telling the runner.
- Compared with: Deploy2Secrets, panel 2

```text
$ zekno deploy
! compose.yaml expects 1 value that has no secret yet.
? Value for DATABASE_URL (shop on prod-1): skipped
✖ DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it.
  Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.
  Nothing was signed.
```

### `server-only`

- How: run(['deploy']) with inkUi at 100 columns on a second machine of the same member (twin, no records, DATABASE_URL and SESSION_KEY set there, its Compose file reading those two) against this repository's runner on the stand-in prod-1, which holds API_KEY from a version-1 deploy made while it answered as runner 0.1.0 over an older state (test/support/older-runner.ts's arrangement, reportingRunner + olderState).
- Compared with: Deploy2Secrets, panel 3

```text
$ zekno deploy
✖ prod-1 holds API_KEY for shop, and this machine cannot check who set it.
  Set it again with zekno secret set API_KEY, or remove it with zekno secret rm API_KEY. Nothing was
  signed.
```

### `newer-on-server`

- How: run(['deploy']) with inkUi at 100 columns on the machine that set SESSION_KEY twice (version 2) and deployed it, against this repository's runner on the stand-in prod-1, after a second machine of the same member (twin) deployed from the runner's records, set SESSION_KEY again (version 3) and deployed it.
- Compared with: none (C5b was approved after the boards); contracts/cli.md C5b

```text
$ zekno deploy
✖ prod-1 holds a newer SESSION_KEY for shop than the one set on this machine.
  Set it again with zekno secret set SESSION_KEY to replace it, or remove it with zekno secret rm
  SESSION_KEY. Nothing was signed.
```

### `older-runner`

- How: run(['deploy']) with inkUi at 100 columns, this zekno carrying runner 0.1.1 (deps.release), against runner 0.1.0 extracted from git (runner-v0.1.0, test support older-programs.ts olderTree) installed on the stand-in prod-1, after server add, deploy 1 and the runner's number set to 41.
- Compared with: Deploy2Versions, panel 1
- Fixed: in 4.2s (how long the deploy took, read from the clock)

```text
$ zekno deploy
! The runner on prod-1 is version 0.1.0, older than this zekno's 0.1.1, so this deploy was signed in
  the older format. Run `zekno server update prod-1` to bring it to 0.1.1.

╭─ Deploy 42 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ secrets   2                                                  │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
  zekno logs to watch it, zekno rollback to undo
```

Note:

```text
The installed runner answers `version` with {"version":"0.1.0","protocol":2}. zekno server add said, on standard error: ["The runner on prod-1 is version 0.1.0, older than this zekno's 0.1.1. Deploys still work. Some of what this zekno does needs the newer runner: run `zekno server update prod-1`."]
```

### `newer-runner`

- How: run(['deploy']) with inkUi at 100 columns, this zekno carrying 0.1.1, against this repository's runner on the stand-in prod-1 answering `version` and the session's first request as 0.1.2 of protocol 4 (reportingRunner).
- Compared with: Deploy2Versions, panel 2

```text
$ zekno deploy
✖ The runner on prod-1 is version 0.1.2, newer than this zekno's 0.1.1, and speaks a newer protocol.
  Update zekno to deploy to prod-1. Nothing was signed.
```

### `runner-learned-first` (added: not one of the scenes asked for)

- How: run(['deploy']) with inkUi at 100 columns against this repository's runner on the stand-in prod-1, after Bea (team-of-two.ts) set DATABASE_URL and deploy 1 carried it, and Ada's second machine (twin) took Bea out of the team list and sent it to the runner at once (syncRunner); this machine had not heard of the removal.
- Compared with: Deploy2Secrets, panel 4 (its caption: the server learned of the removal first)

```text
$ zekno deploy

╭─ Deploy 2 ───────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ secrets   2                                                  │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting

✖ The runner is on a different version of the team list than this machine.
```

### `server-only-read` (added: not one of the scenes asked for)

- How: run(['deploy']) with inkUi at 100 columns on a second machine of the same member (twin, no records, DATABASE_URL and SESSION_KEY set there, its Compose file reading API_KEY too, esc pressed at its question) against this repository's runner on the stand-in prod-1, which holds API_KEY from a version-1 deploy made while it answered as runner 0.1.0 over an older state (test/support/older-runner.ts's arrangement, reportingRunner + olderState).
- Compared with: Deploy2Secrets, panel 3

```text
$ zekno deploy
! compose.yaml expects 1 value that has no secret yet.
? Value for API_KEY (shop on prod-1): skipped
✖ prod-1 holds API_KEY for shop, and this machine cannot check who set it.
  Set it again with zekno secret set API_KEY, or remove it with zekno secret rm API_KEY. Nothing was
  signed.
```

### `two-names`

- How: as removed-member, with Bea having set both API_KEY and DATABASE_URL.
- Compared with: none; contracts/cli.md, "Several blocked names"

```text
$ zekno deploy
! compose.yaml expects 2 values that have no secret yet.
? Value for API_KEY (shop on prod-1): skipped
? Value for DATABASE_URL (shop on prod-1): skipped
✖ API_KEY was set by someone who is no longer in the team, so shop cannot be deployed with it.
  Set it again with zekno secret set API_KEY, or remove it with zekno secret rm API_KEY.
  DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it.
  Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.
  Nothing was signed.
```

### `app-removed-member`

- How: the full-screen app as test/screens/scene/app.ts opens it (createStore, createEffects, AppView drawn with renderToString at 100 by 30), Home read, shop's screen opened with right and enter, then `d`; the app first asked for DATABASE_URL's value, answered with esc, esc and y (deploy without it), against this repository's runner on the stand-in prod-1, in removed-member's arrangement.
- Compared with: none of the app; contracts/cli.md, "How each is shown", the app
- Fixed: 4.2s (how long the deploy took, in the deploy screen's header, read from the clock: the deploy's start moved to 4.2 seconds before its end); ~/code/shop/compose.yaml (the panel's from row: the path of shop's folder on this machine, a temporary folder, shown as the docs' example path)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › deploy                            4.2s

   ╭─ Deploy ─────────────────────────────────────────────────────╮
   │ app       shop                                               │
   │ server    prod-1                                             │
   │ from      ~/code/shop/compose.yaml                           │
   │ secrets   1 (SESSION_KEY)                                    │
   │ replaces  deploy 1                                           │
   ╰──────────────────────────────────────────────────────────────╯

   ✖ Checked   ○ Signed   ○ Sent   ○ Starting

   ✖ DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed
   with it. Set it again with `zekno secret set DATABASE_URL`, or remove it with `zekno secret rm
    DATABASE_URL`. Nothing was signed.












 o show Docker's output  esc back
```

Note:

```text
Before the deploy screen, the app showed:
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › set a secret                    1 of 1

   ! compose.yaml expects 1 value that is not set yet.
   Set it now, or press esc and deploy without it.

   ❯ DATABASE_URL              not set

   ╭─ DATABASE_URL ───────────────────────────────────────────────────────────────╮
   │ ? Value ›   hidden as you type                                               │
   │                                                                              │
   │ Pasting is fine. Nothing shows, not even the length.                         │
   │ For a value of several lines, use: zekno secret set DATABASE_URL --stdin <   │
   │ file                                                                         │
   ╰──────────────────────────────────────────────────────────────────────────────╯

   Encrypted on this machine for prod-1's key and signed by you.
   It cannot be shown again after it is set, only replaced.










 enter save  esc cancel
--- after esc, esc:
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › set a secret                    1 of 1

   ! compose.yaml expects 1 value that is not set yet.
   Set it now, or press esc and deploy without it.

   ❯ DATABASE_URL              not set

   ╭─ Deploy shop to prod-1 without DATABASE_URL? ╮
   │ y deploy  n do not deploy                    │
   ╰──────────────────────────────────────────────╯

   Encrypted on this machine for prod-1's key and signed by you.
   It cannot be shown again after it is set, only replaced.














 y deploy  n do not deploy
```

### `app-overtaken`

- How: the full-screen app as test/screens/scene/app.ts opens it (createStore, createEffects, AppView at 100 by 30), Home read, shop's screen opened, `d` pressed, its `deploy` request held by wire.ts while a second terminal (secondTerminal, plain) deployed 42, then let go, against this repository's runner on the stand-in prod-1 (runner at 41).
- Compared with: Deploy2Refusals, "One line of the app's deploy screen changes"
- Fixed: 4.2s (how long the deploy took, in the deploy screen's header, read from the clock: the deploy's start moved to 4.2 seconds before its end); ~/code/shop/compose.yaml (the panel's from row: the path of shop's folder on this machine, a temporary folder, shown as the docs' example path)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › deploy                            4.2s

   ╭─ Deploy 42 ──────────────────────────────────────────────────╮
   │ app       shop                                               │
   │ server    prod-1                                             │
   │ from      ~/code/shop/compose.yaml                           │
   │ secrets   2 (DATABASE_URL, SESSION_KEY)                      │
   │ replaces  deploy 1                                           │
   ╰──────────────────────────────────────────────────────────────╯

   ✔ Checked   ✔ Signed   ✔ Sent   ✖ Starting

   ✖ Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run
   zekno deploy again to deploy on top of it.













 o show Docker's output  esc back
```

### `plain-overtaken`

- How: run(["deploy"]) with plainUi (no terminal) on a second terminal of the machine, its deploy request held by wire.ts until another terminal deployed 42, against this repository's runner on the stand-in prod-1; every line written, with its stream.
- Compared with: none; contracts/cli.md, "How each is shown", plain
- Streams: stderr: Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run zekno deploy again to deploy on top of it.; nothing on stdout

```text
$ zekno deploy
Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run zekno deploy again to deploy on top of it.
```

### `json-overtaken` (added: not one of the scenes asked for)

- How: run(["deploy","--json"]) with plainUi (no terminal) on a second terminal of the machine, its deploy request held by wire.ts until another terminal deployed 42, against this repository's runner on the stand-in prod-1; every line written, with its stream.
- Compared with: none; contracts/cli.md, "How each is shown", --json
- Streams: stderr: Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run zekno deploy again to deploy on top of it.; nothing on stdout

```text
$ zekno deploy --json
Another deploy of shop reached prod-1 first, as deploy 42. Nothing of this one ran. Run zekno deploy again to deploy on top of it.
```

### `runner-refused`: not captured

R5 (`untrusted_secret`) cannot be reached through `zekno deploy` against the real runner. The runner checks the deploy's team list hash (K8, `stale_team`) before the records (K13, `untrusted_secret`), and the CLI stops with C4 before signing whenever its own team list says the setter left. So the case the board's fourth panel names, the server told of the removal before this machine, ends with `stale_team`'s sentence (scene `runner-learned-first` above). The runner's `untrusted_secret` refusal is reached only by a deploy signed outside `zekno` (`apps/cli/test/scenarios/removed-member.test.ts`, scenario 2, signs one by hand and calls `deployAnswer`), whose message is R5 word for word but is never drawn by `run`. Drawing that error by hand would be a fake, so it is left out.

## Against the approved sentences (contracts/cli.md, "Every line")

Each sentence on screen, its rows joined, against the contract's words with the scene's values (backticks dropped where `ErrorLine` drops them: at a terminal, for ✖; kept in C6's warning, in the app and in plain output. Since 2026-11-19 the app draws ✖ with `ErrorLine` too, so it drops them there as well): C1 (`overtaken`, `app-overtaken`, `plain-overtaken`, `json-overtaken`), C2 (`cannot-tell`), C4 (`removed-member`, `app-removed-member`), C4 for two names (`two-names`: one line per name, in name order, `Nothing was signed.` once), C5 (`server-only`, `server-only-read`), C5b (`newer-on-server`), C6 (`older-runner`), C7 (`newer-runner`): every one the same, word for word. R1 to R8 (`explainDeploy(reason, 2)`) are the contract's words, each. C8: no capture after an error shows `Number <N> is used`. Plain and `--json`: C1 alone on standard error, nothing on standard output.

## Against the boards (design/Deploy2*.dc.html)

Same in every compared scene: the words, the marks (`✔` green, `✖` red, `!` yellow, `○` dim), the bold first sentence and the dim rest of every ✖ line, the plain (not dim) text of C6's warning with its backticks, the wrapping at 100 columns, the stage rows, the result lines, and what is above the panel (C6 only). Known and accepted: the single command's panel shows app, server and the secrets count only (no `from`, no names, no `replaces`); a stop before signing (C4, C5, C5b, C7) shows the sentence alone at a terminal, and the app shows the panel with `✖ Checked`.

Differences beyond those two:

1. C4 (and C5) when the Compose file reads the secret: at a terminal, `zekno deploy` first says `! compose.yaml expects 1 value that has no secret yet.` and asks `? Value for DATABASE_URL (shop on prod-1): (hidden)   esc skips it`; C4 comes only after esc (`removed-member`, `two-names`, `server-only-read`). The app does the same: `d` opens "set a secret" for DATABASE_URL first, and the deploy screen with C4 comes after esc, esc and `y` ("Deploy shop to prod-1 without DATABASE_URL?"). The board shows `$ zekno deploy` and the stop, no question. (With no terminal nothing is asked; the docs' first-deploy steps already say values with no secret are asked for.)
2. Deploy2Secrets, panel 4 ("The same case, refused by the runner"): not reproducible as drawn. Its caption's case gives `✖ The runner is on a different version of the team list than this machine.` under `✖ Starting` (`stale_team`, today's sentence, no "Nothing of it ran."), not R5; see `runner-refused` above.
3. The app's deploy screen at C4 (no board of it; for the record): the panel's secrets row says `1 (SESSION_KEY)` where the board's terminal panel says `2 (DATABASE_URL, SESSION_KEY)`, because the stop comes before Checked and DATABASE_URL does not count on this machine. As first built, the result line kept its backticks, was not split into a bold first sentence and a dim rest, and its third row started with a space. Fixed on 2026-11-19: the app draws an error as a terminal does (`apps/cli/src/app/notice.tsx`), and the capture `app-removed-member` was taken again.
4. Deploy2Versions, "Lines that stay as they are": the board writes W3 as `... run zekno server update prod-1.`; the program (unchanged) writes `` run `zekno server update prod-1`. `` with backticks (captured from `zekno server add`, plain, in `older-runner`'s note).

Capture conventions, not the program: the prompt row is dim whole (recipes' `promptRow`), where the boards draw only `$ ` dim; the boards' `Deploy 42`, `replaces deploy 41` come from a runner at 41, which the scenes arrange the tests' way.

## Not checked

The panel's `from`, secret names and `replaces` rows at a terminal (the single commands do not fill them, research R20); a light terminal (the captures hold looks, not a theme); `zekno rollback`'s C1 (`Run zekno rollback again ...`, checked by the function only).
