# Feature 015: the walkthrough (T089), captured from the real program

Drawn on 2026-11-19 by `driver.ts` (one scene per process) and `walk.ts` (each with `FORCE_COLOR=3`, `TZ=UTC`, `NO_COLOR` unset and a temporary folder of its own as `TMPDIR`, removed after it), both in this folder, run with `bun --no-env-file walk.ts` from this folder (driver.ts imports the CLI by absolute path, as 014's did). Every single-command scene is `run` of `apps/cli/src/cli/cli.ts` with `inkUi` on the stand-in terminal of `apps/cli/test/support/terminal.ts` (100 columns, interactive), or with `plainUi` for no terminal; every app scene is the app's store, effects and `AppView` as `apps/cli/test/screens/scene/app.ts` opens them (100 by 30; its `command` is `zekno`). The server is the stand-in server `prod-1` at `deploy@203.0.113.7` of `test/screens/scene/server.ts` (`withServer`: `zekno init`, then `zekno server add`, which installs this repository's runner), reached over its stand-in `ssh`, with the runner's stand-in Docker of `apps/runner/test/support/docker/`. shop's folder holds a `zekno.app.json` with the shape of `test/screens/scene/files.ts` (web on port 3000 and the worker; an `api` service on port 8080 where a board names one), `DATABASE_URL` and `SESSION_KEY` set. The three effects of feature 015 are the stand-ins of `test/support/domain-stand-ins.ts`: the server's public address 203.0.113.7 (or not known), each domain's lookup (the server's address, none, 198.51.100.9, or a failure) and each HTTPS answer (a certificate until 17 Feb 2027, none, or not valid). Keys in `memoryKeyStore()`, profiles in temporary folders. No real server, network, DNS, TLS, ssh, keychain or `~/.zekno`.

Arrangements that are the tests' own: the runner's number set in its `state.json` "as deploys from elsewhere would leave it" (014's `setNumber`), so the panels say `Deploy 43` and `Deploy 44` and the app `replaces deploy 42` as the boards do; another app `blog` deployed from a folder of its own; the runner answering as 0.1.0 of protocol 3 (`reportingRunner`); the runner's answer to `status` rewritten by `test/support/wire.ts` (R9); sixteen other apps of 64 domains each (R10); the stand-in Docker told to fail a `run` on port 80, to refuse a reload, to make a container use the host's network, to keep a restart loop, or to take 15 s per health check (`script`, `change`, `app`).

Conventions, as 014's walkthrough and the docs' recipes: the first row is the typed command, dim whole (`promptRow`), where the boards draw only `$ ` dim; it is compared by its text alone. Trailing empty rows are left out; the leading empty row of a deploy block is kept, because the program draws it. Rows are `rowsOf` and `tidy` of `apps/cli/test/screens/format.ts`; the looks are in `built.json`. A space's look cannot be seen, so the looks of spaces are not compared (the boards draw, for instance, the space after the domain of A5's record bold, and the two spaces before "zekno logs to watch it" dim).

Rules that fix what differs on each run (each listed under the scene's "Fixed"): how long a deploy took, read from the clock, shown as the board shows it (`in 4.2s`, `in 3.8s` for DomainsDeploy panel 4, `in 9.4s` for DomainsHealth panel 2), as 014 did with DEPLOY_TIME; in the app, the header's time (the deploy's start moved before the drawing: `9.4s`, `4.2s`, `0.4s`), the panel's `from` row (`~/code/shop/zekno.app.json` for the temporary folder's path) and, in app-deploy, the spinner's frame (`⠹`); the deploy times of an app's screen (`today 10:28`, `today 09:28`, `atFixedTimes` of `test/screens/scene/clock.ts`). No rule for the live lines B4 and C2 at a terminal: those scenes are the screen as it was at the first moment it showed the board's spinner frame and `12s` (deploy-waiting: `⠹` and 12s; health-waiting: `⠋` and 12s). D2's date is the clock's: the certificate ends two days after the day of the run, and the run was on 2026-11-19, so it says `21 Nov` as the board does; on another day it would say another date. The not-ready, not-healthy and C4 scenes wait the program's real 60 seconds.

No row of any capture holds a path, user name or host name of this machine (checked: no `/Users/`, `/private`, `/var/folders`, the user's or the host's name, or a temporary folder's prefix in `built.json`).

The source changed while this walk was being made: another session committed 4005bc4 (docs and stored screens) and 67ef8d6 (the runner's health limit counted from when the wait begins; doctor's hint for an older proxy). Every capture below was drawn again on 67ef8d6 with a clean tree (the paragraph above "The scenes" says so, from run.json; no file of apps/cli/src, apps/runner/src, their test support or packages/core/src changed after 17:59:57, and the run began at 18:03); against the first run, on 9768fe4 with those changes coming in, only doctor-older differs (its hint).

Classes of a difference: (a) the program is wrong and should be fixed; (b) the board shows something the program has never shown or cannot know; (c) a state the program shows that no board covers.

The last run drew the scenes list, list-other, list-unreachable, list-no-address against the commit `3aa4d4a fix(cli): an empty row under the title of zekno domain, as the board draws it (015 walkthrough)`, the tree of apps/ and packages/ clean when it began and the same when it ended.

## The scenes

### `add`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has a port and the worker none, so nothing is asked of the service; y typed at the question.
- Command: `zekno domain add shop.example.com`, exit status 0
- Compared with: DomainsAdd, panel 1 (New · the first domain)

```text
$ zekno domain add shop.example.com
  web · domains  none → shop.example.com
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to use it.

  Before you deploy, create this DNS record at your DNS provider:
  A  shop.example.com  203.0.113.7
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `add-second`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); the file's web has shop.example.com and an api service on port 8080 is added, so two services have a port; enter on the first of the list (web), then y.
- Command: `zekno domain add www.example.com`, exit status 0
- Compared with: DomainsAdd, panel 2 (New · several services, a second domain)

```text
$ zekno domain add www.example.com
✔ Service  web
  web · domains  shop.example.com → shop.example.com, www.example.com
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to use it.

  Before you deploy, create this DNS record at your DNS provider:
  A  www.example.com  203.0.113.7
```

Note:

```text
While the question was open, the terminal showed:
? Which service answers for www.example.com?
  ❯ web
    api
  ↑↓ move   enter choose   esc leave
```

Differences from the board:

- row 2: the board shows `? Which service answers for www.example.com? › web` (`?` brand, the question bold, `›` dim, `web` plain); the program shows `✔ Service  web` (`✔` green, `Service` dim, `web` plain). Kind: words, mark and colour. While the question is open the program shows A7's words (`? Which service answers for www.example.com?`, then `❯ web`, `api` and `↑↓ move   enter choose   esc leave`; see the note); once answered it leaves `✔ Service  web` behind, as every list question of the CLI does. Class (a): the approved board and lines.md A7 keep the question with its answer, and the word `Service` is on no board and not in lines.md. Cause: src/commands/domain.ts `domainAdd` passes `collapsed: A7_COLLAPSED` (`Service`, src/domains/words.ts) to `deps.ui.choose`, and the list question of src/ui/ink/questions.tsx draws an answered question as `✔ <collapsed>  <answer>`.

### `rm`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; y typed.
- Command: `zekno domain rm shop.example.com`, exit status 0
- Compared with: DomainsAdd, panel 3 (New · removing)

```text
$ zekno domain rm shop.example.com
  web · domains  shop.example.com → none
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to release it.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `add-no-address`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); the stand-in sshHost answers that the server's public address is not known (as for a private address or a jump host); y typed.
- Command: `zekno domain add shop.example.com`, exit status 0
- Compared with: DomainsAdd, panel 4 (New · when zekno does not know the server's public address)

```text
$ zekno domain add shop.example.com
  web · domains  none → shop.example.com
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to use it.

  Before you deploy, point shop.example.com at the public address of prod-1 at your DNS provider.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `a10`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); the argument *.example.com, as the shell hands it over from "*.example.com".
- Command: `zekno domain add "*.example.com"`, exit status 2
- Compared with: DomainsAdd, panel 5, first command (A10)

```text
$ zekno domain add "*.example.com"
✖ *.example.com is not a domain zekno can route.
  Use a full name such as shop.example.com: no wildcard, no address, no port.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `a12`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); neither web nor the worker has a port.
- Command: `zekno domain add shop.example.com`, exit status 2
- Compared with: DomainsAdd, panel 5, second command (A12)

```text
$ zekno domain add shop.example.com
✖ web has no port, so a domain cannot reach it.
  Set the port it listens on first: zekno settings set web.port <port>.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `a13`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); the api service (port 8080) has shop.example.com already.
- Command: `zekno domain add shop.example.com --service web`, exit status 2
- Compared with: DomainsAdd, panel 5, third command (A13)

```text
$ zekno domain add shop.example.com --service web
✖ shop.example.com is already a domain of api.
  A domain reaches one service. Remove it there first: zekno domain rm shop.example.com.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `a14`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a Compose file written by hand (compose.yaml, web from ghcr.io/example/shop-web:1.4.2, reading DATABASE_URL and SESSION_KEY) and no zekno.app.json, linked to shop on the stand-in prod-1.
- Command: `zekno domain add shop.example.com`, exit status 2
- Compared with: DomainsAdd, panel 6, first command (A14)

```text
$ zekno domain add shop.example.com
✖ This folder deploys a Compose file written by hand.
  Domains need a settings file. Run zekno settings init to start one.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `a11`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7).
- Command: `zekno domain add bücher.example`, exit status 2
- Compared with: DomainsAdd, panel 6, second command (A11)

```text
$ zekno domain add bücher.example
✖ bücher.example is not a domain zekno can route yet.
  Names with letters other than a to z, digits and the hyphen are not in this version of zekno.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `a15` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has no domain.
- Command: `zekno domain rm shop.example.com`, exit status 2
- Compared with: none (lines.md A15)

```text
$ zekno domain rm shop.example.com
✖ shop.example.com is not a domain of this app.
  Run zekno domain to see its domains.
```

Differences from the board:

- Class (c): A15 at a terminal, on no board: `✖` red, the first sentence bold, the second dim under it, exit status 2, as A10 to A14 are drawn. Words: lines.md A15, word for word.

### `a16` (added: not a panel of a board)

- How: run(['domain','add','www.example.com']) with plainUi (no terminal); shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web and api have a port.
- Command: `zekno domain add www.example.com`, exit status 2
- Compared with: none (lines.md A16)
- Streams: stderr: "There is no terminal to ask on. Say which service with --service <name>."

```text
$ zekno domain add www.example.com
There is no terminal to ask on. Say which service with --service <name>.
```

Differences from the board:

- Class (c): with no terminal, A16 alone on standard error, both sentences on one line, exit status 2. Words: lines.md A16, word for word.

### `add-plain` (added: not a panel of a board)

- How: run(['domain','add','shop.example.com','--yes']) with plainUi (no terminal); shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7).
- Command: `zekno domain add shop.example.com --yes`, exit status 0
- Compared with: none (contracts/cli.md CL2, plain output)
- Streams: stdout: "web · domains  none → shop.example.com"; stdout: "Written  Run zekno deploy to use it."; stdout: "record\tA\tshop.example.com\t203.0.113.7"

```text
$ zekno domain add shop.example.com --yes
web · domains  none → shop.example.com
Written  Run zekno deploy to use it.
record	A	shop.example.com	203.0.113.7
```

Differences from the board:

- Class (c): with no terminal, `zekno domain add shop.example.com --yes` prints the change line and `Written  Run zekno deploy to use it.` as `zekno settings set` does, then `record<TAB>A<TAB>shop.example.com<TAB>203.0.113.7`, all on standard output. The record line is on no board and not in lines.md (it is CL2's).

### `add-not-linked` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web with a port, the worker) and is not linked; prod-1 added; y typed.
- Command: `zekno domain add shop.example.com`, exit status 0
- Compared with: none (lines.md A6, the spelling for a folder not linked)

```text
$ zekno domain add shop.example.com
  web · domains  none → shop.example.com
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to use it.

  Before you deploy, point shop.example.com at the public address of your server at your DNS
  provider.
```

Differences from the board:

- Class (c): in a folder that is not linked, A6 names `your server`: `Before you deploy, point shop.example.com at the public address of your server at your DNS provider.`, which wraps at 100 columns to a second row, `  provider.`, dim. This spelling of A6 is on no board and not in lines.md (src/domains/words.ts A6 with no server).

### `add-no-domain` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); zekno domain add with no domain.
- Command: `zekno domain add`, exit status 2
- Compared with: none

```text
$ zekno domain add
✖ Say which domain: zekno domain add <domain>.
  Run zekno --help for the list of commands.
```

Differences from the board:

- Class (c): `zekno domain add` with no domain: `✖ Say which domain: zekno domain add <domain>.` (bold) and `Run zekno --help for the list of commands.` (dim), exit status 2. The first sentence is on no board and not in lines.md (src/domains/words.ts SAY_WHICH_DOMAIN, in the pattern of CS1).

### `deploy-first`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1 without a domain, the runner's number set to 42 as deploys from elsewhere would leave it, then shop.example.com added to web's file; HTTPS answers at once with a certificate until 17 Feb 2027.
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsDeploy, panel 1 (New · the first deploy with a domain)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
✔ https://shop.example.com is live  certificate until 17 Feb 2027
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `deploy-waiting`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as deploy-first, with HTTPS answering nothing (no certificate yet); the screen as it was the first moment the wait line showed the spinner's frame ⠹ and 12s, as the board draws it; then HTTPS answered and the deploy ended.
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsDeploy, panel 2 (New · while the certificate is on its way)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
⠹ Waiting for the certificate of shop.example.com  12s
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `deploy-not-ready`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as deploy-first, with HTTPS answering nothing for the whole wait (60 s of the real clock).
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsDeploy, panel 3 (New · the certificate is not there in time)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
! The certificate for shop.example.com is not ready yet. Run zekno domain to see when it is.
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- row 15 (the board's row 14): the board shows ``! The certificate for shop.example.com is not ready yet. Run `zekno domain` to see when it is.`` with the backticks; the program shows `! The certificate for shop.example.com is not ready yet. Run zekno domain to see when it is.` without them (`!` yellow, the words plain on both). Kind: words (two backticks). Class (b): lines.md's habit is that a terminal drops the backticks of a command, and the program does (src/ui/ink/deploy-view.tsx `httpsPieces`, `withoutBackticks`); the board kept them. Exit status 0, as the board's note says.

### `deploy-later`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1 without a domain, the runner's number set to 42, deploy 43 with shop.example.com and www.example.com (plain), then zekno deploy at the terminal (deploy 44).
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsDeploy, panel 4 (Later deploys)
- Fixed: in 3.8s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy

╭─ Deploy 44 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
│           www.example.com                                    │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 3.8s
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `deploy-more` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as deploy-later with eight domains, a.example.com to h.example.com, held since deploy 43.
- Command: `zekno deploy`, exit status 0
- Compared with: none as a panel; DomainsDeploy, panel 4's note ("more than three end with 'and 5 more'"), lines.md B3
- Fixed: in 3.8s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy

╭─ Deploy 44 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   a.example.com                                      │
│           b.example.com                                      │
│           c.example.com                                      │
│           and 5 more                                         │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 3.8s
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Class (c): eight domains: the panel's `domains` row and two rows under it hold `a.example.com`, `b.example.com`, `c.example.com`, then `and 5 more` dim, as the note and B3 say; no board draws it.

### `deploy-plain` (added: not a panel of a board)

- How: run(['deploy']) with plainUi (no terminal); shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as deploy-first.
- Command: `zekno deploy | cat`, exit status 0
- Compared with: none (contracts/cli.md CL3, plain output)
- Streams: stdout: "dns\tshop.example.com\t203.0.113.7"; stdout: "Deploy 43 of shop is running on prod-1 with 2 secrets."; stdout: "https\tshop.example.com\tlive\t2027-02-17"

```text
$ zekno deploy | cat
dns	shop.example.com	203.0.113.7
Deploy 43 of shop is running on prod-1 with 2 secrets.
https	shop.example.com	live	2027-02-17
```

Differences from the board:

- Class (c): with no terminal, on standard output: `dns<TAB>shop.example.com<TAB>203.0.113.7` (B1), `Deploy 43 of shop is running on prod-1 with 2 secrets.`, `https<TAB>shop.example.com<TAB>live<TAB>2027-02-17` (B5). The `dns` and `https` lines are on no board and not in lines.md (they are CL3's).

### `b7`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; the lookup finds no record.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, panel 1 (New · no record yet)

```text
$ zekno deploy
✖ shop.example.com has no DNS record yet.
  Create an A record for shop.example.com with the value 203.0.113.7, then run zekno deploy again.
  Nothing was signed.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `b8`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; the lookup finds 198.51.100.9.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, panel 2 (New · it points somewhere else)

```text
$ zekno deploy
✖ shop.example.com points to 198.51.100.9, not to prod-1.
  Change its A record to 203.0.113.7, then run zekno deploy again. If something of yours stands in
  front of prod-1, deploy with --skip-dns-check. Nothing was signed.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `b14`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1 without a domain, the runner's number set to 42, shop.example.com added (it has no record), zekno deploy --skip-dns-check.
- Command: `zekno deploy --skip-dns-check`, exit status 0
- Compared with: DomainsDns, panel 3, first command (B14)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy --skip-dns-check
! DNS was not checked for shop.example.com.

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
✔ https://shop.example.com is live  certificate until 17 Feb 2027
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- rows 3 to the end: after the warning the program draws the whole deploy (an empty row, the panel with its `from` and `domains` rows, the stage row, the result, what to run next); the board's command ends with the warning. Kind: rows the board leaves out. Class (b): the board's note says "the deploy goes on" and draws only the warning; the program cannot stop there.

### `b15`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1, the runner's number set to 41, deploy 42 with shop.example.com (plain), then the lookup finds 198.51.100.9 and zekno deploy runs at the terminal (deploy 43).
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsDns, panel 3, second command (B15)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
! shop.example.com points to 198.51.100.9, no longer to prod-1. Visitors are not reaching shop
  there, and its certificate cannot be renewed.

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- rows 4 to the end: after the warning the program draws the whole deploy (an empty row, the panel with its `from` and `domains` rows, the stage row, the result, what to run next); the board's command ends with the warning. Kind: rows the board leaves out. Class (b): the board's note says "the deploy goes on" and draws only the warning; the program cannot stop there.

### `b13`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1 without a domain, the runner's number set to 42, shop.example.com added; the stand-in sshHost answers that the server's public address is not known; the lookup finds 203.0.113.7.
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsDns, panel 4 (New · zekno cannot tell)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
! zekno cannot tell whether shop.example.com points to prod-1, because this machine reaches prod-1
  at an address that is not public. It points to 203.0.113.7.

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
✔ https://shop.example.com is live  certificate until 17 Feb 2027
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 8: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `b13-no-record` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as b13, with shop.example.com having no record.
- Command: `zekno deploy`, exit status 0
- Compared with: none (lines.md B13, the spelling for a domain with no record)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
! zekno cannot tell whether shop.example.com points to prod-1, because this machine reaches prod-1
  at an address that is not public. It has no DNS record yet.

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
✔ https://shop.example.com is live  certificate until 17 Feb 2027
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 8: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Class (c): B13 when the domain has no record either ends with `It has no DNS record yet.` instead of `It points to 203.0.113.7.`; this ending is on no board and not in lines.md (src/domains/words.ts B13 with no address).

### `lookup-failed` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as deploy-first, with the stand-in resolver failing (it cannot tell) for shop.example.com.
- Command: `zekno deploy`, exit status 0
- Compared with: none (contracts/cli.md CL3)
- Fixed: in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy
! zekno could not look up shop.example.com from this machine. The deploy goes on.

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✔ shop is live on prod-1 in 4.2s
✔ https://shop.example.com is live  certificate until 17 Feb 2027
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Class (c): a lookup that fails: the warning `! zekno could not look up shop.example.com from this machine. The deploy goes on.` (`!` yellow, the words plain), then the deploy as in deploy-first, B1 left out. The sentence is on no board and not in lines.md (src/domains/words.ts LOOKUP_FAILED).

### `b9`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; blog, another app, was deployed to prod-1 from a folder of its own with shop.example.com.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, panel 5 (New · the domain is another app's)

```text
$ zekno deploy
✖ shop.example.com belongs to blog on prod-1.
  Release it there first: run zekno domain rm shop.example.com in blog's folder and deploy blog.
  Nothing was signed.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `b10`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; the runner on prod-1 answers as 0.1.0 of protocol 3 (test/support/stand-in-server.ts reportingRunner), which does not carry out routes.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, panel 6 (New · the runner is too old)

```text
$ zekno deploy
✖ The runner on prod-1 is version 0.1.0, too old for domains and health checks.
  Run zekno server update prod-1, then run zekno deploy again. Nothing was signed.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `b16`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1, the runner's number set to 41, deploy 42 with shop.example.com (plain); then the proxy container's image changed so the runner makes it again, and the stand-in Docker's next run fails "Bind for 0.0.0.0:80 failed: port is already allocated" (as scenario domains-deploy.test.ts arranges it); zekno deploy at the terminal (43).
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, panel 7 (New · after the deploy was accepted)

```text
$ zekno deploy

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✖ shop is running, but prod-1 cannot answer for its domains: port 80 is in use by another program.
  Free ports 80 and 443 on prod-1, then run zekno deploy again.
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `b11`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com and no port.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, table "The other sentences", row "A service with a domain has no port" (B11)

```text
$ zekno deploy
✖ zekno.app.json could not be read as settings.
  web, networking.domains: set networking.port too, the port it reaches.
```

Differences from the board:

- rows 2 and 3: the board's row says `web has a domain and no port. Set the port it listens on with zekno settings set web.port <port>. Nothing was signed.`; the program never says B11 through `zekno deploy`: the settings file's own rule refuses the file first, `✖ zekno.app.json could not be read as settings.` (bold) and `web, networking.domains: set networking.port too, the port it reaches.` (dim), exit status 1. Kind: words. Class (b): B11 cannot be reached from a settings file; it stays in src/ops/deploy-domains.ts as a guard (its comment says the settings file's rules refuse it first: SV38 in src/settings/domains-health.ts). The sentence `web, networking.domains: set networking.port too, the port it reaches.` is on no board and not in lines.md.

### `b12`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); shop deployed with the worker alone (deploy 1, the runner's number set to 40, deploy 41), then web with shop.example.com added and deployed (42); zekno rollback --to 41.
- Command: `zekno rollback --to 41`, exit status 1
- Compared with: DomainsDns, table "The other sentences", row "A rollback to a deploy without the routed service" (B12)

```text
$ zekno rollback --to 41
  Rolling back shop to what deploy 41 ran.
✖ What deploy 41 ran has no service named web, which shop.example.com reaches.
  Remove the domain first, or roll back to a deploy that has web. Nothing was signed.
```

Differences from the board:

- Words: the board's row, word for word. Class (c) for the drawing, which no board shows: `zekno rollback --to 41` first says `  Rolling back shop to what deploy 41 ran.` (plain, set in by two), then B12 after `✖` red, the first sentence bold, the rest dim; no panel, nothing signed, exit status 1.

### `b17`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); Docker holds no container of web (only the worker's); deploy 1, the runner's number set to 42, shop.example.com added.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, table, row "A routed service has no container" (B17)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✖ shop.example.com cannot reach web: no container of web is running.
  Run zekno logs to see why.
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Words: the board's row, word for word. Class (c) for the drawing: B1, the panel, `✔ Started`, then B17 after `✖` red, the first sentence bold, `Run zekno logs to see why.` dim; exit status 1.

### `b18`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web's container uses the host's network (networkMode host in the stand-in Docker); deploy 1, the runner's number set to 42, shop.example.com added.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, table, row "A routed service uses the host's network" (B18)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✖ shop.example.com cannot reach web: web uses the host's network, which zekno cannot route to.
  Give web a network of its own, then run zekno deploy again.
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Words: the board's row, word for word. Class (c) for the drawing, as b17.

### `b19`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1, the runner's number set to 41, deploy 42 with shop.example.com (plain), then www.example.com added and the stand-in proxy told to refuse the next reload (script reloads: ["failed"]); zekno deploy at the terminal (43).
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, table, row "The proxy did not take the new domains" (B19)

```text
$ zekno deploy
✔ www.example.com points to prod-1  203.0.113.7

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
│           www.example.com                                    │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started

✖ shop is running, but prod-1 did not take its new domains, so it answers for the ones it had.
  Run zekno doctor to see why.
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Words: the board's row, word for word. Class (c) for the drawing: B1 for the new domain www.example.com, the panel with both domains, `✔ Started`, then B19 after `✖`; exit status 1.

### `r9`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); blog deployed with shop.example.com from its own folder; the runner's answer to status rewritten by test/support/wire.ts to hold no routes, as it would have a moment before blog's deploy, so the runner itself refuses domain_taken.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, table, row "The runner refuses: the domain is another app's" (R9)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 1 ───────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting

✖ A domain of this deploy belongs to another app on that server.
  Nothing of it ran. Run zekno domain to see which.
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Words: the board's row, word for word. Class (c) for the drawing: B1 (this machine's check found the domain free), the panel `Deploy 1`, the stage row `✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting` (`✖ Starting` red), then R9 after `✖`, `A domain of this deploy belongs to another app on that server.` bold, the rest dim; exit status 1.

### `r10`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; sixteen other apps were deployed to prod-1 from folders of their own with 64 domains each (1,024 in all, LIMITS.domainsPerServer).
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsDns, table, row "The runner refuses: too many domains on the server" (R10)

```text
$ zekno deploy
✔ shop.example.com points to prod-1  203.0.113.7

╭─ Deploy 1 ───────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting

✖ That server would hold more domains than a runner keeps.
  Nothing of this deploy ran. Remove a domain from an app there first.
```

Differences from the board:

- row 7: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Words: the board's row, word for word. Class (c) for the drawing, as r9.

### `health-waiting`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1, the runner's number set to 41, deploy 42 with shop.example.com and web's health check GET /health (plain), then zekno deploy at the terminal (43) with the stand-in Docker's health check taking 15 s to answer (script checkMs); the screen as it was the first moment it showed the spinner's frame ⠋ and 12s, as the board draws it.
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsHealth, panel 1 (New · waiting to be healthy)

```text
$ zekno deploy

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ⠋ Healthy

  waiting for web to answer GET /health  12s
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `health-ok`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as health-waiting, the health check answering 200 at once.
- Command: `zekno deploy`, exit status 0
- Compared with: DomainsHealth, panel 2 (New · healthy)
- Fixed: in 9.4s (how long the deploy took, read from the clock, shown as the board shows it)

```text
$ zekno deploy

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ✔ Healthy

✔ shop is live on prod-1 in 9.4s
  zekno logs to watch it, zekno rollback to undo
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `health-failed`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as health-waiting, the stand-in Docker's health check answering 500 every time (script curl), for the whole 60 s of the real clock.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsHealth, panel 3 (New · not healthy in time)

```text
$ zekno deploy

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ✖ Healthy

✖ web did not answer GET /health with success within 60 seconds.
  shop is running as deployed, and nothing was rolled back. Run zekno logs to see why, or zekno
  rollback to go back.
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.

### `health-c4`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); as health-waiting but web's health check without a path (healthcheck {}), and web's container in a restart loop in the stand-in Docker (script restarting: each inspect finds one restart more), for the whole 60 s of the real clock.
- Command: `zekno deploy`, exit status 1
- Compared with: DomainsHealth, table "In the settings", row "Not healthy, without a path" (C4)

```text
$ zekno deploy

╭─ Deploy 43 ──────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
│ domains   shop.example.com                                   │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ✖ Healthy

✖ web did not stay up within 60 seconds.
  shop is running as deployed, and nothing was rolled back. Run zekno logs to see why, or zekno
  rollback to go back.
```

Differences from the board:

- row 6: the program draws `│ from      zekno.app.json  2 services: web, worker │` (`from` dim, `zekno.app.json` plain, `2 services: web, worker` dim) between `server` and `secrets`; the board's panel has no `from` row. Kind: a row more (the panel is one row taller; every row under it is one lower than on the board, and is otherwise the board's). Class (b): a domain needs a settings file (A14), and a deploy from a settings file always has this row (spec 010, DP3; src/commands/deploy.ts `fromRow`); the boards drew the panel of a deploy from a Compose file.
- Words: the board's row, word for word. Class (c) for the drawing, which no board shows: as health-failed, `✖ Healthy` red, then C4 after `✖`, `web did not stay up within 60 seconds.` bold, the rest dim; exit status 1.

### `checked-no-container` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has the health check GET /health and no domain, and Docker holds no container of web.
- Command: `zekno deploy`, exit status 1
- Compared with: none (src/domains/words-extra.ts)

```text
$ zekno deploy

╭─ Deploy 1 ───────────────────────────────────────────────────╮
│ app       shop                                               │
│ server    prod-1                                             │
│ from      zekno.app.json  2 services: web, worker            │
│ secrets   2                                                  │
╰──────────────────────────────────────────────────────────────╯

✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ○ Healthy

✖ web cannot be checked: no container of web is running.
  Run zekno logs to see why.
```

Differences from the board:

- Class (c): a health check without a domain, for a service with no container: the panel `Deploy 1` with no `domains` row, `✔ Checked  ✔ Signed  ✔ Sent  ✔ Started  ○ Healthy` (`○ Healthy` dim: not reached), then `✖ web cannot be checked: no container of web is running.` (bold) and `Run zekno logs to see why.` (dim); exit status 1. The sentence is on no board and not in lines.md (words-extra.ts `noContainerChecked`, B17's pattern).

### `settings`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json with one service, web (test/screens/scene/files.ts SHOP_ONE_SERVICE) with shop.example.com and the health check GET /health, linked to shop on the stand-in prod-1.
- Command: `zekno settings`, exit status 0
- Compared with: DomainsList, panel 6 (Changed · zekno settings); DomainsHealth table, row "In zekno settings, under Deploy" (C5)

```text
$ zekno settings
  shop  from zekno.app.json

  web
  Source        image     ghcr.io/example/shop-web:1.4.2
  Deploy        start     bun run start
                restart   on failure
                memory    512m
                cpus      1
                health    GET /health, within 60s
  Networking    port      3000, not published
                domains   shop.example.com
  Variables     secrets   DATABASE_URL, SESSION_KEY
                plain     NODE_ENV=production
  Volumes       uploads   /data/uploads
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `settings-no-path`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json with one service, web (test/screens/scene/files.ts SHOP_ONE_SERVICE) with shop.example.com and a health check without a path, linked to shop on the stand-in prod-1.
- Command: `zekno settings`, exit status 0
- Compared with: DomainsHealth table, row "Without a path" (C6)

```text
$ zekno settings
  shop  from zekno.app.json

  web
  Source        image     ghcr.io/example/shop-web:1.4.2
  Deploy        start     bun run start
                restart   on failure
                memory    512m
                cpus      1
                health    stays up, within 60s
  Networking    port      3000, not published
                domains   shop.example.com
  Variables     secrets   DATABASE_URL, SESSION_KEY
                plain     NODE_ENV=production
  Volumes       uploads   /data/uploads
```

Differences from the board:

- Words: `health    stays up, within 60s`, the board's row, word for word, in the place DomainsList panel 6 gives the health row. Otherwise the capture is DomainsList panel 6's.

### `settings-none`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json with one service, web (test/screens/scene/files.ts SHOP_ONE_SERVICE) with neither a domain nor a health check, linked to shop on the stand-in prod-1.
- Command: `zekno settings`, exit status 0
- Compared with: DomainsHealth table, row "Not set" (C5: `health    not set`); lines.md E1 (`domains   none`)

```text
$ zekno settings
  shop  from zekno.app.json

  web
  Source        image     ghcr.io/example/shop-web:1.4.2
  Deploy        start     bun run start
                restart   on failure
                memory    512m
                cpus      1
  Networking    port      3000, not published
  Variables     secrets   DATABASE_URL, SESSION_KEY
                plain     NODE_ENV=production
  Volumes       uploads   /data/uploads
```

Differences from the board:

- after row 9 (`cpus`) and after row 10 (`port`): the board's table and lines.md C5 say `zekno settings` shows `health    not set` under Deploy, and lines.md E1 `domains   none` under Networking; the program at a terminal draws neither row: `cpus` is followed by `Networking    port      3000, not published`, and that by `Variables`. Kind: two rows missing. Class (a): the approved words name these rows for `zekno settings`. Cause: src/settings/rows.ts `reportRows`, which adds the health row only when the file or the last deploy has a health check (`if (shows("health"))`) and calls `domainRows(service, deployed, false)`, whose `none` row is only for the settings screen. The app's settings screen does draw both, `health  not set` and `domains  none`, dim (scene app-settings-none).

### `settings-changed` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; as settings, deployed once, then zekno domain add www.example.com --yes (not deployed).
- Command: `zekno settings`, exit status 0
- Compared with: none (DomainsList panel 6 shows the rows unchanged)

```text
$ zekno settings
  shop  from zekno.app.json

  web
  Source        image     ghcr.io/example/shop-web:1.4.2
  Deploy        start     bun run start
                restart   on failure
                memory    512m
                cpus      1
                health    GET /health, within 60s
  Networking    port      3000, not published
                domains   shop.example.com
                          www.example.com  ! changed, not deployed
  Variables     secrets   DATABASE_URL, SESSION_KEY
                plain     NODE_ENV=production
  Volumes       uploads   /data/uploads
```

Differences from the board:

- Class (c): a domain added since the last deploy: `domains   shop.example.com`, then a row of its own, `www.example.com  ! changed, not deployed` (the mark and its words yellow), in the settings' own pattern.

### `settings-set-health`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json with one service, web, with no health check, linked to shop on the stand-in prod-1; y typed (the board's table row "Setting it").
- Command: `zekno settings set web.health /health`, exit status 0
- Compared with: DomainsHealth table, row "Setting it" (`zekno settings set web.health /health`)

```text
$ zekno settings set web.health /health
  web · health  not set → GET /health, within 60s
? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N) yes
✔ Written  Run zekno deploy to use it.
```

Differences from the board:

- Class (c) for what it draws: `  web · health  not set → GET /health, within 60s` (`web · health` and `→` dim, the new value bold), the question A3, `✔ Written  Run zekno deploy to use it.`. The change line of a health check is on no board and not in lines.md (its words are C5's, its pattern A1's).

### `list`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); shop's file has web (port 3000) with shop.example.com and www.example.com and an api service (port 8080) with api.example.com, deployed; then new.example.com added to web's file; DNS of www.example.com finds 198.51.100.9, HTTPS of api.example.com answers with a certificate that is not valid yet, the others with a certificate until 17 Feb 2027.
- Command: `zekno domain`, exit status 0
- Compared with: DomainsList, panel 1 (New · zekno domain)

```text
$ zekno domain
  shop on prod-1

api.example.com   api:8080  ● no certificate yet    prod-1 is asking for one
new.example.com   web:3000  ○ not deployed          run zekno deploy
shop.example.com  web:3000  ● live                  certificate until 17 Feb 2027
www.example.com   web:3000  ● DNS points elsewhere  198.51.100.9, not prod-1
```

Differences from the board:

- row 3: the empty row under `  shop on prod-1` is drawn, as the board has it. The first walk found it missing (class (a)); fixed in 3aa4d4a, and the scene drawn again.
- rows 3 to 6: the board's order is shop.example.com, www.example.com, api.example.com, new.example.com; the program's is api.example.com, new.example.com, shop.example.com, www.example.com (domain order). Kind: order. Each row, taken by its domain, is the board's row character for character and look for look (the columns, `● live` green, `● DNS points elsewhere` red, `● no certificate yet` yellow, the not-deployed row dim from `web:3000` on). Class (b): contracts/cli.md CL4 says the rows are in domain order, and src/ops/domain.ts `listDomains` sorts them so; no arrangement gives the board's order.

### `list-other`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web deployed with shop, docs, app and old.example.com; blog deployed from its own folder with blog.example.com; then web's file holds shop, docs, app and blog.example.com (old taken out, blog's added); docs.example.com has no record, app.example.com answers nothing on HTTPS, shop.example.com's certificate ends two days after the clock of the run (2026-11-21).
- Command: `zekno domain`, exit status 0
- Compared with: DomainsList, panel 2 (New · the other states)

```text
$ zekno domain
  shop on prod-1

app.example.com   web:3000  ● not answering    nothing answers on port 443 of prod-1
blog.example.com  web:3000  ✖ belongs to blog  release it there first
docs.example.com  web:3000  ● no DNS record    create an A record with the value 203.0.113.7
old.example.com   web:3000  ○ to be released   removed from the file, run zekno deploy
shop.example.com  web:3000  ● live             certificate ends 21 Nov, renewal is failing
```

Note:

```text
The certificate's last day is two days after the day of the run; the board's "21 Nov" is two days after 2026-11-19, the day this walk ran.
```

Differences from the board:

- row 3: the empty row under the title is drawn, as in `list` (fixed in 3aa4d4a).
- rows 3 to 7: the board's order is shop, docs, app, old, blog (.example.com); the program's is app, blog, docs, old, shop. Kind: order. Each row, by its domain, is the board's, character for character and look for look. Class (b), as in `list`.

### `list-plain`

- How: run(['domain']) with plainUi (no terminal, as when piped to cat); shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); shop's file has web (port 3000) with shop.example.com and www.example.com and an api service (port 8080) with api.example.com, deployed; then new.example.com added to web's file; DNS of www.example.com finds 198.51.100.9, HTTPS of api.example.com answers with a certificate that is not valid yet, the others with a certificate until 17 Feb 2027.
- Command: `zekno domain | cat`, exit status 0
- Compared with: DomainsList, panel 3 (New · with no terminal)
- Streams: stdout: "api.example.com\tapi\t8080\twaiting\t"; stdout: "new.example.com\tweb\t3000\tnot-deployed\t"; stdout: "shop.example.com\tweb\t3000\tlive\t2027-02-17"; stdout: "www.example.com\tweb\t3000\tdns-elsewhere\t"

```text
$ zekno domain | cat
api.example.com	api	8080	waiting	
new.example.com	web	3000	not-deployed	
shop.example.com	web	3000	live	2027-02-17
www.example.com	web	3000	dns-elsewhere	
```

Differences from the board:

- rows 2 to 5: the board's order is shop, www, api, new; the program's is api, new, shop, www (domain order). Kind: order. Each line, by its domain, is the board's, tabs and the empty last field included; all on standard output. Class (b), as in `list`.

### `list-json` (added: not a panel of a board)

- How: run(['domain','--json']) with plainUi; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); shop's file has web (port 3000) with shop.example.com and www.example.com and an api service (port 8080) with api.example.com, deployed; then new.example.com added to web's file; DNS of www.example.com finds 198.51.100.9, HTTPS of api.example.com answers with a certificate that is not valid yet, the others with a certificate until 17 Feb 2027.
- Command: `zekno domain --json`, exit status 0
- Compared with: none (lines.md part D: "--json gives the same")
- Streams: stdout: "[{\"domain\":\"api.example.com\",\"service\":\"api\",\"port\":8080,\"state\":\"waiting\",\"until\":null},{\"domain\":\"new.example.com\",\"service\":\"web\",\"port\":3000,\"state\":\"not-deployed\",\"until\":null},{\"domain\":\"shop.example.com\",\"service\":\"web\",\"port\":3000,\"state\":\"live\",\"until\":\"2027-02-17\"},{\"domain\":\"www.example.com\",\"service\":\"web\",\"port\":3000,\"state\":\"dns-elsewhere\",\"until\":null}]"

```text
$ zekno domain --json
[{"domain":"api.example.com","service":"api","port":8080,"state":"waiting","until":null},{"domain":"new.example.com","service":"web","port":3000,"state":"not-deployed","until":null},{"domain":"shop.example.com","service":"web","port":3000,"state":"live","until":"2027-02-17"},{"domain":"www.example.com","service":"web","port":3000,"state":"dns-elsewhere","until":null}]
```

Differences from the board:

- Class (c): one JSON list on standard output, the same facts in domain order (`until` null or the last day).

### `list-none`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); no domain in the file or on the server.
- Command: `zekno domain`, exit status 0
- Compared with: DomainsList, panel 4 (New · no domain yet)

```text
$ zekno domain
  shop has no domain. Add one with zekno domain add <domain>.
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `list-unreachable` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web has shop.example.com; the stand-in ssh refuses every connection (down).
- Command: `zekno domain`, exit status 0
- Compared with: none (contracts/cli.md CL4)

```text
$ zekno domain
remote: ssh: connect to host deploy@203.0.113.7 port 22: Connection refused
! prod-1 could not be reached over SSH. Check with: `ssh deploy@203.0.113.7 true`
  shop on prod-1

shop.example.com  web:3000  ○ not deployed  prod-1 was not asked
```

Differences from the board:

- Class (c): prod-1 cannot be reached: `remote: ssh: connect to host deploy@203.0.113.7 port 22: Connection refused` dim (what ssh said, as the CLI shows it today), then ``! prod-1 could not be reached over SSH. Check with: `ssh deploy@203.0.113.7 true` `` (a warning, its backticks kept, as today's warnings keep them), then `  shop on prod-1` and the file's row as `○ not deployed` with the detail `prod-1 was not asked`; exit status 0. `prod-1 was not asked` is on no board and not in lines.md (words-extra.ts `notAsked`, CL4).

### `list-no-address` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web with shop.example.com, deployed; then the stand-in sshHost answers that the server's public address is not known, and shop.example.com has no record.
- Command: `zekno domain`, exit status 0
- Compared with: none (lines.md D4, the spelling for an unknown address)

```text
$ zekno domain
  shop on prod-1

shop.example.com  web:3000  ● no DNS record  point it at the public address of prod-1
```

Differences from the board:

- Class (c): a domain with no record when the server's public address is not known: `● no DNS record` red with the detail `point it at the public address of prod-1` dim. The detail is on no board and not in lines.md (words-extra.ts `pointAt`).

### `domain-not-linked` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json with shop.example.com and is not linked; prod-1 added.
- Command: `zekno domain`, exit status 1
- Compared with: none (contracts/cli.md CL4)

```text
$ zekno domain
✖ This folder is not linked to an app.
  Run zekno link here, then zekno domain again.
```

Differences from the board:

- Class (c): `zekno domain` in a folder that is not linked: `✖ This folder is not linked to an app.` (bold) and `Run zekno link here, then zekno domain again.` (dim), exit status 1. On no board and not in lines.md (words-extra.ts `NOT_LINKED_HERE`).

### `status`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json with web reading DATABASE_URL and holding shop.example.com, DATABASE_URL set, deployed once to the stand-in prod-1 with --app shop --server prod-1, the folder not linked; Docker's ps reports web running (as test/screens/recipes/status.ts arranges it).
- Command: `zekno status`, exit status 0
- Compared with: DomainsList, panel 5 (Changed · zekno status)

```text
$ zekno status
  Using prod-1, your only server.
prod-1 ● reachable team list v2
shop  deploy 1  ● running
shop  https://shop.example.com
shop/DATABASE_URL  version 1
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `doctor`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web with shop.example.com and www.example.com, deployed; the stand-in df answers about 133 GB free; the newest release from a stand-in for GitHub that names this runner's own version (as test/screens/recipes/doctor.ts).
- Command: `zekno doctor`, exit status 0
- Compared with: DomainsList, panel 7 (Changed · zekno doctor)

```text
$ zekno doctor
  This machine
✔ zekno          0.1.0, installs runner 0.1.0
✔ Key            in your system keychain
✔ Profile        verified, team list v2
✔ This folder    linked to shop on prod-1, zekno.app.json is readable

  prod-1  deploy@203.0.113.7
✔ Reachable      over SSH
✔ Docker         Compose 2.40.3
✔ Runner         0.1.0
✔ Proxy          answers for 2 domains
✔ Disk           133 GB free

  No problems, no warnings.
```

Differences from the board:

- rows 3 and 11: the board shows `✔ zekno          0.1.1, installs runner 0.1.1` and `✔ Runner         0.1.1`; the program `✔ zekno          0.1.0, installs runner 0.1.0` and `✔ Runner         0.1.0`. Kind: words (the version). Class (b): this repository's zekno and runner are 0.1.0 (apps/cli/package.json, apps/runner/package.json); the board shows the number of the next release.
- row 6: the board shows `✔ This folder    linked to shop on prod-1, compose.yaml is readable`; the program `✔ This folder    linked to shop on prod-1, zekno.app.json is readable`. Kind: words. Class (b): the board's doctor is the docs' stored screen of a folder with a Compose file, with only the Proxy row added; an app with a domain is deployed from a settings file (A14), so its folder names zekno.app.json.
- row 12, `✔ Proxy          answers for 2 domains` (`✔` green, the rest plain): the board's, character for character.

### `doctor-stopped`

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web with shop.example.com and www.example.com, deployed; the stand-in df answers about 133 GB free; the newest release from a stand-in for GitHub that names this runner's own version (as test/screens/recipes/doctor.ts); then the proxy container stopped in the stand-in Docker.
- Command: `zekno doctor`, exit status 1
- Compared with: DomainsList, panel 7's note (E4); lines.md E4

```text
$ zekno doctor
  This machine
✔ zekno          0.1.0, installs runner 0.1.0
✔ Key            in your system keychain
✔ Profile        verified, team list v2
✔ This folder    linked to shop on prod-1, zekno.app.json is readable

  prod-1  deploy@203.0.113.7
✔ Reachable      over SSH
✔ Docker         Compose 2.40.3
✔ Runner         0.1.0
✖ Proxy          not running
                 Deploy an app with a domain to start it again
✔ Disk           133 GB free

  1 problem, no warnings.
```

Differences from the board:

- rows 3 and 11: the board shows `✔ zekno          0.1.1, installs runner 0.1.1` and `✔ Runner         0.1.1`; the program `✔ zekno          0.1.0, installs runner 0.1.0` and `✔ Runner         0.1.0`. Kind: words (the version). Class (b): this repository's zekno and runner are 0.1.0 (apps/cli/package.json, apps/runner/package.json); the board shows the number of the next release.
- rows 12 and 13: `✖ Proxy          not running` (`✖` red) and under it, in the detail's column, `Deploy an app with a domain to start it again` dim: the words of the note and of E4. The last row says `1 problem, no warnings.`; exit status 1. Class (c) for the drawing: the note names the words, no panel draws them.
- The note also names E5 (`✖ Proxy  port 80 is in use by another program`, `Free ports 80 and 443 on prod-1`). The program never shows it: src/ops/doctor-proxy.ts says a taken port is not a line of doctor, since the runner cannot know it without starting the proxy (research R34); the deploy that tried says B16. Class (b).

### `doctor-older` (added: not a panel of a board)

- How: `run` of apps/cli/src/cli/cli.ts with the command's words, with inkUi on test/support/terminal.ts at 100 columns, interactive; shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web with shop.example.com and www.example.com, deployed; the stand-in df answers about 133 GB free; the newest release from a stand-in for GitHub that names this runner's own version (as test/screens/recipes/doctor.ts); then the proxy container's image changed to caddy:2.10.0 in the stand-in Docker.
- Command: `zekno doctor`, exit status 0
- Compared with: none (contracts/cli.md CL6)

```text
$ zekno doctor
  This machine
✔ zekno          0.1.0, installs runner 0.1.0
✔ Key            in your system keychain
✔ Profile        verified, team list v2
✔ This folder    linked to shop on prod-1, zekno.app.json is readable

  prod-1  deploy@203.0.113.7
✔ Reachable      over SSH
✔ Docker         Compose 2.40.3
✔ Runner         0.1.0
! Proxy          an older version
                 Deploy an app with a domain to replace it
✔ Disk           133 GB free

  No problems, 1 warning.
```

Differences from the board:

- rows 3 and 11: the board shows `✔ zekno          0.1.1, installs runner 0.1.1` and `✔ Runner         0.1.1`; the program `✔ zekno          0.1.0, installs runner 0.1.0` and `✔ Runner         0.1.0`. Kind: words (the version). Class (b): this repository's zekno and runner are 0.1.0 (apps/cli/package.json, apps/runner/package.json); the board shows the number of the next release.
- Class (c): the proxy runs from another image than the runner pins: `! Proxy          an older version` (`!` yellow) and under it `Deploy an app with a domain to replace it` dim; `No problems, 1 warning.`; exit status 0. Both are on no board and not in lines.md (src/domains/words.ts `OTHER_IMAGE`; changed by commit 67ef8d6 during this walk, from `Run zekno server update prod-1 to replace it`, which the first run captured).

### `app-settings`

- How: the full-screen app as test/screens/scene/app.ts opens it (createStore, createEffects, AppView drawn with renderToString at 100 by 30), as test/screens/recipes/settings-screen.ts: shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web with shop.example.com and GET /health, deployed once, then zekno settings set web.memory 1g --yes; Home read, shop's screen opened with right and enter, then e.
- Command: `zekno`
- Compared with: DomainsApp, panel 1 (Changed · the settings screen)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › settings            ● running deploy 1

 ╭────────────────────╮ ╭─────────────────────────────────────────────────────────────────────────╮
 │ Services           │ │ web                                                      zekno.app.json │
 │ ❯ web              │ │ Source                                                                  │
 │   worker           │ │ ❯ image      ghcr.io/example/shop-web:1.4.2                             │
 │                    │ │ Deploy                                                                  │
 │                    │ │   start      bun run start                                              │
 │                    │ │   restart    on failure                                                 │
 │                    │ │   memory     1g  ! changed, not deployed (was 512m)                     │
 │                    │ │   cpus       1                                                          │
 │                    │ │   health     GET /health, within 60s                                    │
 │                    │ │ Networking                                                              │
 │                    │ │   port       3000                                                       │
 │                    │ │   published  not published                                              │
 │                    │ │   domains    shop.example.com                                           │
 │                    │ │ Variables                                                               │
 │                    │ │   secrets    DATABASE_URL, SESSION_KEY                                  │
 │                    │ │   plain      NODE_ENV=production                                        │
 │                    │ │ Volumes                                                                 │
 │                    │ │   uploads    /data/uploads                                              │
 │                    │ │                                                                         │
 │ One app, one file: │ │ ─────────────────────────────────────────────────────────────────────── │
 │ zekno.app.json     │ │ A change is written to the file. It runs after the next deploy.         │
 ╰────────────────────╯ ╰─────────────────────────────────────────────────────────────────────────╯


 ↑↓ move  enter change  tab services  c Compose text  d deploy  esc back
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `app-settings-none` (added: not a panel of a board)

- How: the full-screen app as test/screens/scene/app.ts opens it, at 100 by 30: shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); web with neither a domain nor a health check, deployed once; Home read, shop's screen opened, then e.
- Command: `zekno`
- Compared with: none (lines.md C5, E1, E6)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › settings            ● running deploy 1

 ╭────────────────────╮ ╭─────────────────────────────────────────────────────────────────────────╮
 │ Services           │ │ web                                                      zekno.app.json │
 │ ❯ web              │ │ Source                                                                  │
 │   worker           │ │ ❯ image      ghcr.io/example/shop-web:1.4.2                             │
 │                    │ │ Deploy                                                                  │
 │                    │ │   start      bun run start                                              │
 │                    │ │   restart    on failure                                                 │
 │                    │ │   memory     512m                                                       │
 │                    │ │   cpus       1                                                          │
 │                    │ │   health     not set                                                    │
 │                    │ │ Networking                                                              │
 │                    │ │   port       3000                                                       │
 │                    │ │   published  not published                                              │
 │                    │ │   domains    none                                                       │
 │                    │ │ Variables                                                               │
 │                    │ │   secrets    DATABASE_URL, SESSION_KEY                                  │
 │                    │ │   plain      NODE_ENV=production                                        │
 │                    │ │ Volumes                                                                 │
 │                    │ │   uploads    /data/uploads                                              │
 │                    │ │                                                                         │
 │ One app, one file: │ │ ─────────────────────────────────────────────────────────────────────── │
 │ zekno.app.json     │ │ A change is written to the file. It runs after the next deploy.         │
 ╰────────────────────╯ ╰─────────────────────────────────────────────────────────────────────────╯


 ↑↓ move  enter change  tab services  c Compose text  d deploy  esc back
```

Differences from the board:

- Class (c): the settings screen of an app with neither: `health     not set` under Deploy and `domains    none` under Networking, the values dim, in the board's places. The terminal leaves both rows out (scene settings-none).

### `app-domains`

- How: the full-screen app as test/screens/scene/app.ts opens it, as test/screens/recipes/app-detail.ts: shop's folder holds a zekno.app.json with one service, web, holding shop.example.com and www.example.com, DATABASE_URL and SESSION_KEY set; deployed with web 1.4.1, then with 1.4.2; Docker's ps reports web running; then DNS of www.example.com finds 198.51.100.9; Home read, shop's screen opened with right and enter, and the Domains box read.
- Command: `zekno`
- Compared with: DomainsApp, panel 2 (Changed · an app's screen)
- Fixed: today 10:28 and today 09:28 (the time of each deploy, read in UTC against the clock (test/screens/scene/clock.ts atFixedTimes))

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop                       ● running deploy 2

 ╭───────────────────────────────────────────────────────────╮ ╭──────────────────────────────────╮
 │ Deploys                                  last 50 are kept │ │ Secrets                          │
 │                                                           │ │                                  │
 │   no.   result                             when           │ │   DATABASE_URL       version 1   │
 │ ❯ 2     ● running now                      today 10:28    │ │   SESSION_KEY        version 1   │
 │   1     ✔ started                          today 09:28    │ │   + set a secret                 │
 │                                                           │ │ Values are never shown. To       │
 │                                                           │ │ change one, set it again.        │
 │                                                           │ ╰──────────────────────────────────╯
 │                                                           │ ╭──────────────────────────────────╮
 │                                                           │ │ Domains                          │
 │                                                           │ │                                  │
 │                                                           │ │   shop.example.com               │
 │                                                           │ │     ● live                       │
 │                                                           │ │   www.example.com                │
 │                                                           │ │     ● DNS points elsewhere       │
 │                                                           │ │                                  │
 │ ───────────────────────────────────────────────────────── │ │                                  │
 │ deploy 2  signed by Ada, from team list v2                │ │                                  │
 │ services  web (ghcr.io/example/shop-web:1.4.2)            │ │ Checked from this machine.       │
 │ secrets   DATABASE_URL v1, SESSION_KEY v1                 │ │ e settings to change them.       │
 ╰───────────────────────────────────────────────────────────╯ ╰──────────────────────────────────╯


 d deploy  r roll back to selected  l logs  s set secret  x remove secret  e settings  tab pane
 esc back
```

Differences from the board:

- None: the words, the order, the spacing, the looks and the marks are the board's.

### `app-deploy`

- How: the full-screen app as test/screens/scene/app.ts opens it (AppView at 100 by 30): shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1, the runner's number set to 41, deploy 42 with shop.example.com and web's health check GET /health (plain); Docker's ps reports web running; the stand-in Docker's health check taking 15 s (checkMs); Home read, shop's screen opened, d pressed; the state drawn 0.3 s after the runner's health event reached it.
- Command: `zekno`
- Compared with: DomainsApp, panel 3 (Changed · the deploy screen)
- Fixed: 9.4s (how long the deploy has run, in the deploy screen's header, read from the clock: the deploy's start moved to 9.4 seconds before the drawing); ~/code/shop/zekno.app.json (the panel's from row: the path of shop's folder on this machine, a temporary folder, shown as the board's example path); ⠹ (the spinner's frame, drawn from the clock at the moment of capture, shown as the board's)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › deploy                            9.4s

   ╭─ Deploy 43 ──────────────────────────────────────────────────╮
   │ app       shop                                               │
   │ server    prod-1                                             │
   │ from      ~/code/shop/zekno.app.json                         │
   │ secrets   2 (DATABASE_URL, SESSION_KEY)                      │
   │ domains   shop.example.com                                   │
   │ replaces  deploy 42                                          │
   ╰──────────────────────────────────────────────────────────────╯

   ✔ Checked   ✔ Signed   ✔ Sent   ✔ Started   ⠹ Healthy

   waiting for web to answer GET /health










   Leaving this screen does not cancel the deploy. Quitting zekno waits for it to finish.


 o show Docker's output  esc back, deploy keeps going
```

Differences from the board:

- row 14, the spinner before ` Healthy`: the board draws `⠹` brand, not bold; the program draws it bold and brand. Kind: bold. Class (b): the board's note says the deploy screen has the same stage as `zekno deploy` at a terminal, and the program draws it so; DomainsHealth panel 1 draws that terminal stage bold and brand (`⠋`), as the program does.

### `app-deploy-first` (added: not a panel of a board)

- How: the full-screen app, at 100 by 30: shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deploy 1 without a domain, the runner's number set to 42, shop.example.com added; Home read, shop's screen opened, d pressed; the deploy screen once it ended (HTTPS answers at once).
- Command: `zekno`
- Compared with: none (lines.md E8, B1, B5 in the app)
- Fixed: 4.2s (how long the deploy took, in the deploy screen's header, read from the clock: the deploy's start moved to 4.2 seconds before its end); ~/code/shop/zekno.app.json (the panel's from row: the path of shop's folder on this machine, a temporary folder, shown as the board's example path); in 4.2s (how long the deploy took, read from the clock, shown as the board shows it)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › deploy                            4.2s

   ✔ shop.example.com points to prod-1  203.0.113.7

   ╭─ Deploy 43 ──────────────────────────────────────────────────╮
   │ app       shop                                               │
   │ server    prod-1                                             │
   │ from      ~/code/shop/zekno.app.json                         │
   │ secrets   2 (DATABASE_URL, SESSION_KEY)                      │
   │ domains   shop.example.com                                   │
   │ replaces  deploy 1                                           │
   ╰──────────────────────────────────────────────────────────────╯

   ✔ Checked   ✔ Signed   ✔ Sent   ✔ Started

   ✔ shop is live on prod-1 in 4.2s
   ✔ https://shop.example.com is live  certificate until 17 Feb 2027










 o show Docker's output  esc back
```

Differences from the board:

- Class (c): the app's deploy screen of a first deploy with a domain: B1 above the panel (`✔` green, the words plain, the address dim), the panel with `domains`, the four stages, then `✔ shop is live on prod-1 in 4.2s` with the words plain (not bold, the time not dim, unlike the terminal's line) and B5 under it (the detail dim). No board shows the app's screen after a deploy with a domain.

### `app-b7` (added: not a panel of a board)

- How: the full-screen app, at 100 by 30: shop's folder holds a zekno.app.json (web as test/screens/scene/files.ts has it, and the worker), linked to shop on the stand-in prod-1 (deploy@203.0.113.7, this repository's runner, the runner's stand-in Docker), DATABASE_URL and SESSION_KEY set; the server's address, DNS and HTTPS from test/support/domain-stand-ins.ts (203.0.113.7); deployed once without a domain, then shop.example.com added, which has no record; Home read, shop's screen opened, d pressed; the deploy screen once it ended.
- Command: `zekno`
- Compared with: none (lines.md part B: "the app shows the panel with ✖ Checked")
- Fixed: 0.4s (how long the deploy took, in the deploy screen's header, read from the clock: the deploy's start moved to 0.4 seconds before its end); ~/code/shop/zekno.app.json (the panel's from row: the path of shop's folder on this machine, a temporary folder, shown as the board's example path)

```text
 ▀▀▀█ ▄▀▀▄ █ ▄▀ █▀▀▄ ▄▀▀▄    ▀▀▄ █▀▀▄ █▀▀▄
 ▄▀▀  █▀▀▀ █▀▄  █  █ █  █   ▄▀▀█ █▀▀  █▀▀
 ▀▀▀▀  ▀▀▀ ▀  ▀ ▀  ▀  ▀▀  ▀  ▀▀▀ ▀    ▀    › prod-1 › shop › deploy                            0.4s

   ╭─ Deploy ─────────────────────────────────────────────────────╮
   │ app       shop                                               │
   │ server    prod-1                                             │
   │ from      ~/code/shop/zekno.app.json                         │
   │ secrets   2 (DATABASE_URL, SESSION_KEY)                      │
   │ replaces  deploy 1                                           │
   ╰──────────────────────────────────────────────────────────────╯

   ✖ Checked   ○ Signed   ○ Sent   ○ Starting

   ✖ shop.example.com has no DNS record yet.
     Create an A record for shop.example.com with the value 203.0.113.7, then run zekno deploy
     again. Nothing was signed.












 o show Docker's output  esc back
```

Differences from the board:

- Class (c): the app's deploy screen stopped at B7: the panel titled `Deploy` with no number and no `domains` row (the domains are known from the checked stage on), `✖ Checked` red then `○ Signed   ○ Sent   ○ Starting` dim, then B7 after `✖`, its first sentence bold and the rest dim, wrapped at the screen's width. As lines.md says; no board draws it.

## Against the approved words (design/lines.md)

`lines.py` looks for every line of lines.md, with the example values, word for word in the captures (rows joined, backticks dropped as a terminal drops them). Found word for word: A1 to A6, A8 to A16, B1 to B10, B12 to B19, R9, R10, C1 to C4, C5's `GET /health, within 60s` and C6 (at a terminal and in the app), D1 to D10, the no-terminal line of part D, E1's `domains   shop.example.com`, E2, E3, E4, E6, E7, E8; C5's `not set` and E1's `none` only in the app's settings screen. Not found:

- A7 once answered: the question's words show while it is open, then `✔ Service  web` stays (scene add-second; class (a)).
- B11: never said; the settings file's rule SV38 refuses first (scene b11; class (b)).
- C5's `health    not set` and E1's `domains   none` in `zekno settings` at a terminal: the rows are left out (scene settings-none; class (a)).
- E5: doctor has no such line (research R34; class (b)).

## Every difference from a board, by class

(a) The program differs where it could follow the board. What was done about each:

1. add-second, row 2: board `? Which service answers for www.example.com? › web`; program `✔ Service  web` (words, mark, colour). src/commands/domain.ts `domainAdd` (`collapsed: A7_COLLAPSED`, src/domains/words.ts) and the list question of src/ui/ink/questions.tsx. Kept as built, for the maintainer to decide: every list question of zekno is drawn this way once answered.
2. list and list-other, row 3: the board's empty row under `  shop on prod-1` was not drawn. Fixed in 3aa4d4a (src/commands/domain.ts); both scenes were drawn again and match.
3. settings-none: `health    not set` (C5, the DomainsHealth table's "Not set" row) and `domains   none` (E1) are not drawn by `zekno settings` (rows missing). src/settings/rows.ts `reportRows`. Kept as built, for the maintainer to decide: `zekno settings` prints only the settings that are set (the rule of feature 010); the settings screen draws both rows.

(b) The board shows something the program never shows or cannot know:

1. Every deploy panel at a terminal (DomainsDeploy 1 to 4, DomainsDns 4 and 7, DomainsHealth 1 to 3): no `from` row on the board; the program draws `│ from      zekno.app.json  2 services: web, worker │` between `server` and `secrets`, as every deploy from a settings file does (spec 010 DP3), and a domain needs a settings file.
2. DomainsDeploy 3, its row 14: B6 with backticks around `zekno domain`; the program drops them at a terminal (lines.md's habit).
3. DomainsDns 3: B14 and B15 drawn alone; the program draws the whole deploy after each warning.
4. DomainsList 1 to 3: the rows in the order shop, www, api, new (and shop, docs, app, old, blog); the program sorts by domain (contracts/cli.md CL4).
5. DomainsList 7: `0.1.1` in two rows (this repository is 0.1.0) and `compose.yaml is readable` (an app with a domain has `zekno.app.json`).
6. DomainsList 7's note and lines.md E5: doctor never says a port is taken (src/ops/doctor-proxy.ts, research R34).
7. DomainsDns table, B11: never said (SV38 first; B11 is a guard in src/ops/deploy-domains.ts).
8. DomainsApp 3, row 14: the spinner not bold; the program draws it bold and brand, as at a terminal (DomainsHealth 1).

(c) States the program shows that no board covers: a15, a16, add-plain, add-not-linked, add-no-domain, deploy-more, deploy-plain, b13-no-record, lookup-failed, the drawing of b12, b17, b18, b19, r9, r10 and health-c4 (their words are on boards only as table rows), checked-no-container, settings-changed, settings-set-health, list-json, list-unreachable, list-no-address, domain-not-linked, doctor-stopped (only a note), doctor-older, app-settings-none, app-deploy-first, app-b7.

The same as the board, row for row and look for look (apart from the conventions above): add, rm, add-no-address, a10, a11, a12, a13, a14, b7, b8, b9, b10, list-none, status, settings, app-settings, app-domains; and, apart from the `from` row, deploy-first, deploy-waiting, deploy-later, b13, b16, health-waiting, health-ok, health-failed.

## Sentences shown that are on no board and not in lines.md

Feature 015's own (older lines, such as `Rolling back shop to what deploy 41 ran.`, the `from` row, `could not be read as settings.` or the SSH warning, are left out):

- `Service`, in `✔ Service  web` (A7_COLLAPSED; add-second)
- `web, networking.domains: set networking.port too, the port it reaches.` (SV38; b11)
- `Before you deploy, point shop.example.com at the public address of your server at your DNS provider.` (A6 for a folder not linked; add-not-linked)
- `Say which domain: zekno domain add <domain>.` (SAY_WHICH_DOMAIN; add-no-domain)
- `It has no DNS record yet.` as the end of B13 (b13-no-record)
- `zekno could not look up shop.example.com from this machine. The deploy goes on.` (LOOKUP_FAILED; lookup-failed)
- `web cannot be checked: no container of web is running. Run zekno logs to see why.` (noContainerChecked; checked-no-container)
- `prod-1 was not asked` (notAsked; list-unreachable)
- `point it at the public address of prod-1` (pointAt; list-no-address)
- `This folder is not linked to an app. Run zekno link here, then zekno domain again.` (NOT_LINKED_HERE; domain-not-linked)
- `an older version` and `Deploy an app with a domain to replace it` (OTHER_IMAGE; doctor-older; until commit 67ef8d6, `Run zekno server update prod-1 to replace it`)
- `web · health  not set → GET /health, within 60s` (the change line of a health check; settings-set-health)
- With no terminal: `record<TAB>A<TAB>shop.example.com<TAB>203.0.113.7`, `dns<TAB>shop.example.com<TAB>203.0.113.7`, `https<TAB>shop.example.com<TAB>live<TAB>2027-02-17` and the JSON of `zekno domain --json` (contracts/cli.md CL2, CL3, CL4; add-plain, deploy-plain, list-json)

In src/domains/words-extra.ts and not reached by any scene: `hostNetworkChecked` (B18's pattern for a checked service), `proxyPortTaken` and `proxyNotLoaded` (after `zekno server update`).

## Not checked

80 columns (no board draws one; the app's 80 by 24 is the tests'); a light terminal (the captures hold looks, not a theme); `enter` on the settings screen's `domains` row (DomainsApp panel 1's note); the app's deploy screen waiting for HTTPS, or not healthy; B10 for a rollback; `zekno server update` with a taken port or a refused reload; the claims of the boards' notes that are not drawn (that a deploy with neither keeps working with an older runner, that the server renews by itself), which the scenario tests hold.
